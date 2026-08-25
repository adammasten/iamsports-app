// Schedule tab — a UNIFIED typed agenda (games + practices + events) in one
// chronological list with type-filter chips. Coaches add/edit any event type;
// existing games flow in via the events↔games link (film/tagging/stats untouched).
// Dark-themed to match the app. Slice 1 of the scheduling build.
import { COACH_ROLES, useTeamContext } from '@/context';
import {
  buildICS, eventTypeLabel, isGameFamily, loadAttendance, loadEvents, loadRosterCounts, loadTournaments, matchesFilter, setRsvp,
  type Attendance, type RsvpStatus, type ScheduleEvent, type ScheduleFilter,
} from '@/lib/core/schedule';
import type { UserKidRow } from '@/context';
import { sendTeamPush } from '@/lib/core/push';
import { claimSnack, loadSnacks, releaseSnack, type SnackSignup } from '@/lib/core/snacks';
import { addEventsToDeviceCalendar } from '@/lib/native/deviceCalendar';
import { supabase } from '@/supabase';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebTopNav from '../components/WebTopNav';

function todayYMD(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Parse a YYYY-MM-DD as LOCAL (no UTC shift) and format "Sat · Aug 23".
function fmtDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function fmtTime(ev: ScheduleEvent): string {
  if (ev.timeStatus === 'tbd') return 'Time TBD';
  if (ev.timeStatus === 'all_day') return 'All day';
  if (!ev.startsAt) return 'Time TBD';
  try { return new Date(ev.startsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: ev.eventTimezone }); } catch { return ''; }
}
// A universal maps link (opens Google/Apple Maps on phones, the map site on web).
function mapsUrl(ev: ScheduleEvent): string | null {
  const q = ev.venueAddress?.trim() || ev.venueName?.trim();
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}
function scoreLabel(ev: ScheduleEvent): string | null {
  if (ev.teamScore == null || ev.opponentScore == null) return null;
  const wl = ev.teamScore === ev.opponentScore ? 'T' : ev.teamScore > ev.opponentScore ? 'W' : 'L';
  return `${wl} ${ev.teamScore}-${ev.opponentScore}`;
}
const TYPE_COLOR: Record<string, string> = {
  game: '#ff6a2c', scrimmage: '#e0a52e', tournament_game: '#e2574a', practice: '#3ec46d', team_event: '#4a90e2',
};

// A schedule row is either a standalone event or a tournament (a dated group of
// its games). Tournament groups are anchored by their earliest (asc) / latest
// (desc) date so they slot chronologically among the standalone events.
type AgendaItem =
  | { kind: 'event'; date: string; ev: ScheduleEvent }
  | { kind: 'tourn'; date: string; id: string; name: string; events: ScheduleEvent[] };

function buildAgenda(list: ScheduleEvent[], names: Map<string, string>, dir: 'asc' | 'desc'): AgendaItem[] {
  const groups = new Map<string, ScheduleEvent[]>();
  const items: AgendaItem[] = [];
  for (const ev of list) {
    if (ev.tournamentId) { const g = groups.get(ev.tournamentId) ?? []; g.push(ev); groups.set(ev.tournamentId, g); }
    else items.push({ kind: 'event', date: ev.localDate, ev });
  }
  for (const [id, evs] of groups) {
    const dates = evs.map(e => e.localDate).sort();
    evs.sort((a, b) => a.localDate.localeCompare(b.localDate));
    items.push({ kind: 'tourn', date: dir === 'asc' ? dates[0] : dates[dates.length - 1], id, name: names.get(id) ?? 'Tournament', events: evs });
  }
  items.sort((a, b) => (dir === 'asc' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));
  return items;
}

function fmtRange(dates: string[]): string {
  const lo = dates[0], hi = dates[dates.length - 1];
  return lo === hi ? fmtDate(lo) : `${fmtDate(lo)} – ${fmtDate(hi)}`;
}

const FILTERS: { key: ScheduleFilter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'games', label: 'Games' },
  { key: 'practices', label: 'Practices' }, { key: 'events', label: 'Events' },
];

export default function ScheduleScreen() {
  const insets = useSafeAreaInsets();
  const { activeTeam, activeRole, userId, userKids, userTeams } = useTeamContext();
  const isCoach = !!activeRole && COACH_ROLES.includes(activeRole);
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [rosterCounts, setRosterCounts] = useState<Record<string, number>>({});
  const [snacks, setSnacks] = useState<Map<string, SnackSignup>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ScheduleFilter>('all');
  const [scope, setScope] = useState<'team' | 'all'>('team');
  const [importing, setImporting] = useState(false);
  const [addingToCal, setAddingToCal] = useState(false);
  const [tournamentNames, setTournamentNames] = useState<Map<string, string>>(new Map());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleTournament = useCallback((id: string) => {
    setCollapsed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  const teamNameById = useMemo(() => {
    const m = new Map<string, string>();
    userTeams.forEach(t => { if (!m.has(t.team_id)) m.set(t.team_id, t.name); });
    return m;
  }, [userTeams]);
  const scopeTeamIds = useMemo(
    () => (scope === 'all' ? Array.from(new Set(userTeams.map(t => t.team_id))) : activeTeam ? [activeTeam.id] : []),
    [scope, userTeams, activeTeam],
  );

  const load = useCallback(async () => {
    if (scopeTeamIds.length === 0) { setEvents([]); setAttendance([]); setLoading(false); return; }
    setLoading(true);
    try {
      const [evs, rc, tourns] = await Promise.all([loadEvents(scopeTeamIds), loadRosterCounts(scopeTeamIds), loadTournaments(scopeTeamIds)]);
      setEvents(evs); setRosterCounts(rc);
      setTournamentNames(new Map(tourns.map(t => [t.id, t.name])));
      const eventIds = evs.map(e => e.id);
      const [att, snk] = await Promise.all([loadAttendance(eventIds), loadSnacks(eventIds)]);
      setAttendance(att); setSnacks(snk);
    } catch { setEvents([]); setAttendance([]); }
    setLoading(false);
  }, [scopeTeamIds]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Optimistic RSVP — reflect the tap immediately, persist, reload on failure.
  const onRsvp = useCallback(async (eventId: string, playerId: string, status: RsvpStatus) => {
    if (!userId) return;
    setAttendance(prev => [...prev.filter(a => !(a.eventId === eventId && a.playerId === playerId)), { eventId, playerId, status }]);
    try { await setRsvp(eventId, playerId, status, userId); } catch { load(); }
  }, [userId, load]);

  // Snack sign-up (optimistic): claim or release the single snack slot per event.
  const onClaimSnack = useCallback(async (ev: ScheduleEvent) => {
    if (!userId) return;
    setSnacks(prev => new Map(prev).set(ev.id, { eventId: ev.id, claimedByUserId: userId, claimerName: 'You' }));
    try { await claimSnack(ev.id, ev.teamId, userId); } catch (e: any) { Alert.alert('Snacks', e?.message ?? 'Could not sign up.'); load(); }
  }, [userId, load]);
  const onReleaseSnack = useCallback(async (ev: ScheduleEvent) => {
    if (!userId) return;
    setSnacks(prev => { const n = new Map(prev); n.delete(ev.id); return n; });
    try { await releaseSnack(ev.id, userId); } catch (e: any) { Alert.alert('Snacks', e?.message ?? 'Could not update.'); load(); }
  }, [userId, load]);

  const today = todayYMD();
  const { upcoming, past } = useMemo(() => {
    const shown = events.filter(e => matchesFilter(e.eventType, filter));
    const up = shown.filter(e => e.localDate >= today && e.status !== 'canceled' && e.status !== 'completed')
      .sort((a, b) => a.localDate.localeCompare(b.localDate));
    const pa = shown.filter(e => !(e.localDate >= today && e.status !== 'canceled' && e.status !== 'completed'))
      .sort((a, b) => b.localDate.localeCompare(a.localDate));
    return { upcoming: up, past: pa };
  }, [events, filter, today]);

  // Web: download the upcoming schedule as a .ics the coach/parent can add to
  // Apple/Google/Outlook. (Native "add to device calendar" is a fast-follow.)
  function exportCalendar() {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const upcomingAll = events.filter(e => e.localDate >= today && e.status !== 'canceled');
    if (upcomingAll.length === 0) return;
    const ics = buildICS(upcomingAll, scope === 'all' ? 'My teams' : (activeTeam?.name ?? 'Team'));
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'iamsports-schedule.ics';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  // Subscribe to the LIVE team calendar (webcal://) — one tap, updates forever.
  // Distinct from Export (a one-time snapshot) and native Add (writes once).
  async function subscribeCalendar() {
    if (!activeTeam) return;
    try {
      const { data } = await supabase.from('teams').select('ics_token').eq('id', activeTeam.id).maybeSingle();
      const token = (data as any)?.ics_token;
      if (!token) { Alert.alert('Calendar', 'The team feed isn’t ready yet — try again in a moment.'); return; }
      Linking.openURL(`webcal://wscfpkaltajnrhiusoze.supabase.co/functions/v1/team-calendar?token=${token}`);
    } catch (e: any) { Alert.alert('Calendar', e?.message ?? 'Could not open the calendar.'); }
  }

  // Native: add the upcoming schedule straight into the phone's calendar app.
  async function addToDeviceCalendar() {
    const upcomingAll = events.filter(e => e.localDate >= today && e.status !== 'canceled');
    if (upcomingAll.length === 0) { Alert.alert('Add to calendar', 'Nothing upcoming to add.'); return; }
    setAddingToCal(true);
    try {
      const n = await addEventsToDeviceCalendar(upcomingAll, scope === 'all' ? 'IamSports' : (activeTeam?.name ?? 'Team'));
      Alert.alert('Added to calendar', `${n} event${n === 1 ? '' : 's'} added to your calendar.`);
    } catch (e: any) {
      Alert.alert('Add to calendar', e?.message ?? 'Could not add events.');
    } finally { setAddingToCal(false); }
  }

  // Photo import: pick an image of a printed/emailed schedule, extract via the
  // edge function, then hand the rows to an editable preview before anything saves.
  async function importFromPhoto() {
    if (!activeTeam) return;
    const res = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.5, mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (res.canceled || !res.assets?.[0]?.base64) return;
    setImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke('extract-schedule', {
        body: { image: res.assets[0].base64, mediaType: res.assets[0].mimeType ?? 'image/jpeg' },
      });
      if (error) {
        let msg = 'Import failed — try again.';
        try { const b = await (error as any).context?.json?.(); if (b?.error) msg = b.error; } catch {}
        Alert.alert('Import schedule', msg); return;
      }
      const rows = (data as any)?.rows ?? [];
      if (rows.length === 0) { Alert.alert('Import schedule', 'No games were found in that image. Try a clearer, straight-on photo.'); return; }
      router.push({ pathname: '/import-schedule', params: { rows: JSON.stringify(rows), teamId: activeTeam.id } });
    } catch (e: any) {
      Alert.alert('Import schedule', e?.message ?? 'Import failed.');
    } finally { setImporting(false); }
  }

  function openEvent(ev: ScheduleEvent) {
    if (isCoach) { router.push({ pathname: '/edit-event', params: { event: JSON.stringify(ev) } }); return; }
    if (isGameFamily(ev.eventType) && ev.gameId) router.push({ pathname: '/box-score', params: { gameId: ev.gameId, title: ev.title ?? 'Game' } });
  }

  // Coach taps "Remind to RSVP" → push the whole team about this event.
  const remindRsvp = useCallback(async (ev: ScheduleEvent) => {
    const label = ev.title || (isGameFamily(ev.eventType) && ev.opponent ? `vs ${ev.opponent}` : eventTypeLabel(ev.eventType));
    const teamName = teamNameById.get(ev.teamId) ?? 'Team';
    try {
      const r = await sendTeamPush({
        teamId: ev.teamId, title: `🔔 ${teamName}: please RSVP`,
        body: `${label} on ${fmtDate(ev.localDate)} — tap to let us know if you're coming.`, data: { url: '/schedule' },
      });
      Alert.alert('Reminder sent', r.note ?? `Sent to ${r.recipients} member${r.recipients === 1 ? '' : 's'}.`);
    } catch (e: any) {
      Alert.alert('Remind to RSVP', e?.message ?? 'Could not send the reminder.');
    }
  }, [teamNameById]);

  const renderRow = (ev: ScheduleEvent, canRsvp: boolean) => (
    <Row key={ev.id} ev={ev} onPress={() => openEvent(ev)} canRsvp={canRsvp}
      teamLabel={scope === 'all' ? teamNameById.get(ev.teamId) : undefined}
      isCoach={isCoach} myKids={canRsvp ? userKids.filter(k => k.team_id === ev.teamId) : []}
      att={attendance.filter(a => a.eventId === ev.id)} rosterCount={rosterCounts[ev.teamId] ?? 0} onRsvp={onRsvp}
      onRemind={isCoach && canRsvp ? () => remindRsvp(ev) : undefined}
      snack={snacks.get(ev.id)} myUserId={userId}
      onClaimSnack={canRsvp ? () => onClaimSnack(ev) : undefined} onReleaseSnack={() => onReleaseSnack(ev)} />
  );

  const renderAgenda = (list: ScheduleEvent[], canRsvp: boolean, dir: 'asc' | 'desc') =>
    buildAgenda(list, tournamentNames, dir).map(it =>
      it.kind === 'event' ? renderRow(it.ev, canRsvp) : (
        <TournamentGroup
          key={it.id} name={it.name} range={fmtRange(it.events.map(e => e.localDate))} count={it.events.length}
          collapsed={collapsed.has(it.id)} onToggle={() => toggleTournament(it.id)}
          onAddGame={isCoach && scope === 'team' ? () => router.push({ pathname: '/edit-event', params: { type: 'tournament_game', tournamentId: it.id, date: it.date } }) : undefined}
        >
          {it.events.map(ev => renderRow(ev, canRsvp))}
        </TournamentGroup>
      ),
    );

  if (!activeTeam) {
    return (
      <View style={styles.root}>
        {Platform.OS === 'web' ? <WebTopNav /> : null}
        <View style={{ paddingTop: insets.top + 40, paddingHorizontal: 20 }}><Text style={styles.empty}>Pick a team to see its schedule.</Text></View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {Platform.OS === 'web' ? <WebTopNav /> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: Platform.OS === 'web' ? 16 : insets.top + 12, paddingHorizontal: 16, paddingBottom: 44, maxWidth: 760, width: '100%', alignSelf: 'center' }}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.caption} numberOfLines={1}>{scope === 'all' ? 'All my teams' : activeTeam.name}</Text>
          <Text style={styles.title}>Schedule</Text>
        </View>
        <TouchableOpacity style={styles.iconCircle} onPress={() => router.push('/messages')} accessibilityLabel="Team messages">
          <Ionicons name="chatbubble-ellipses-outline" size={20} color="#c7d2dc" />
        </TouchableOpacity>
      </View>

      {userTeams.length > 1 ? (
        <View style={styles.scopeRow}>
          {(['team', 'all'] as const).map(s => (
            <TouchableOpacity key={s} onPress={() => setScope(s)} style={[styles.scopeBtn, scope === s && styles.scopeBtnOn]}>
              <Text style={[styles.scopeTxt, scope === s && styles.scopeTxtOn]}>{s === 'team' ? 'This team' : 'All my teams'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={{ gap: 8, paddingRight: 12 }}>
        {FILTERS.map(f => (
          <TouchableOpacity key={f.key} onPress={() => setFilter(f.key)} style={[styles.chip, filter === f.key && styles.chipOn]}>
            <Text style={[styles.chipTxt, filter === f.key && styles.chipTxtOn]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Compact action row: primary "+ Add event" pill (coach) + icon-only utilities.
          Everything above "Upcoming" now fits in the top third — first event shows without scrolling. */}
      <View style={styles.actionsRow}>
        {isCoach && scope === 'team' ? (
          <TouchableOpacity style={styles.addPill} onPress={() => router.push('/edit-event')}>
            <Ionicons name="add" size={16} color="#160b02" />
            <Text style={styles.addPillTxt}>Add event</Text>
          </TouchableOpacity>
        ) : null}
        {isCoach && scope === 'team' ? (
          <TouchableOpacity style={styles.iconBtn} onPress={importFromPhoto} disabled={importing} accessibilityLabel="Import schedule from a photo">
            {importing ? <ActivityIndicator color="#9db0bd" size="small" /> : <Ionicons name="camera-outline" size={18} color="#9db0bd" />}
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.iconBtn} onPress={subscribeCalendar} accessibilityLabel="Subscribe to the live calendar feed">
          <Ionicons name="calendar-outline" size={18} color="#9db0bd" />
        </TouchableOpacity>
        {Platform.OS === 'web' ? (
          <TouchableOpacity style={styles.iconBtn} onPress={exportCalendar} accessibilityLabel="Export the schedule">
            <Ionicons name="download-outline" size={18} color="#9db0bd" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.iconBtn} onPress={addToDeviceCalendar} disabled={addingToCal} accessibilityLabel="Add upcoming to my calendar">
            {addingToCal ? <ActivityIndicator color="#9db0bd" size="small" /> : <Ionicons name="download-outline" size={18} color="#9db0bd" />}
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color="#ff6a2c" style={{ marginTop: 30 }} />
      ) : upcoming.length === 0 && past.length === 0 ? (
        <Text style={styles.empty}>Nothing scheduled yet.{isCoach ? '\nTap “＋ Add event” to add a game or practice.' : ''}</Text>
      ) : (
        <>
          {upcoming.length > 0 ? (
            <>
              <Text style={styles.section}>Upcoming</Text>
              {renderAgenda(upcoming, true, 'asc')}
            </>
          ) : null}
          {past.length > 0 ? (
            <>
              <Text style={styles.section}>Past &amp; completed</Text>
              {renderAgenda(past, false, 'desc')}
            </>
          ) : null}
        </>
      )}
      </ScrollView>
    </View>
  );
}

// A collapsible container for a tournament's games (a dated multi-game group).
function TournamentGroup({ name, range, count, collapsed, onToggle, onAddGame, children }: {
  name: string; range: string; count: number; collapsed: boolean;
  onToggle: () => void; onAddGame?: () => void; children: ReactNode;
}) {
  return (
    <View style={styles.tourn}>
      <TouchableOpacity style={styles.tournHead} onPress={onToggle} activeOpacity={0.7}>
        <Text style={styles.tournChevron}>{collapsed ? '▸' : '▾'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.tournName} numberOfLines={1}>🏆 {name}</Text>
          <Text style={styles.tournMeta} numberOfLines={1}>{range} · {count} game{count === 1 ? '' : 's'}</Text>
        </View>
        {onAddGame ? (
          <TouchableOpacity onPress={onAddGame} hitSlop={8} style={styles.tournAdd}><Text style={styles.tournAddTxt}>＋ Game</Text></TouchableOpacity>
        ) : null}
      </TouchableOpacity>
      {!collapsed ? <View style={styles.tournBody}>{children}</View> : null}
    </View>
  );
}

const RSVP_ON: Record<RsvpStatus, object> = { going: { backgroundColor: '#3ec46d', borderColor: '#3ec46d' }, maybe: { backgroundColor: '#e0a52e', borderColor: '#e0a52e' }, out: { backgroundColor: '#c0392b', borderColor: '#c0392b' } };

function Row({ ev, onPress, teamLabel, isCoach, myKids, att, rosterCount, canRsvp, onRsvp, onRemind, snack, myUserId, onClaimSnack, onReleaseSnack }: {
  ev: ScheduleEvent; onPress: () => void; teamLabel?: string; isCoach: boolean;
  myKids: UserKidRow[]; att: Attendance[]; rosterCount: number; canRsvp: boolean;
  onRsvp: (eventId: string, playerId: string, status: RsvpStatus) => void;
  onRemind?: () => void;
  snack?: SnackSignup; myUserId: string | null;
  onClaimSnack?: () => void; onReleaseSnack?: () => void;
}) {
  const canceled = ev.status === 'canceled';
  const dir = !canceled ? mapsUrl(ev) : null;
  const score = scoreLabel(ev);
  // Drop the redundant type title (the chip says it) — but keep a meaningful heading:
  // the opponent for games, or a custom title for team events.
  const subheading = ev.title || (isGameFamily(ev.eventType) && ev.opponent ? `vs ${ev.opponent}` : null);
  const venue = ev.venueName?.trim() || ev.venueAddress?.trim()?.split(',')[0]?.trim() || null;
  const going = att.filter(a => a.status === 'going').length;
  const noAnswer = Math.max(0, rosterCount - att.length);
  const color = TYPE_COLOR[ev.eventType] ?? '#4a90e2';
  const showCounts = !canceled && (rosterCount > 0 || att.length > 0);

  return (
    <View style={[styles.card, canceled && { opacity: 0.7 }]}>
      {/* Row 1 — identity: chip + date·time (primary bold) + chevron */}
      <TouchableOpacity style={styles.cardHead} onPress={onPress} activeOpacity={0.7}>
        <View style={[styles.badge, { backgroundColor: color + '22', borderColor: color }]}>
          <Text style={[styles.badgeTxt, { color }]}>{eventTypeLabel(ev.eventType)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardWhen, canceled && styles.canceled]} numberOfLines={1}>{fmtDate(ev.localDate)} · {fmtTime(ev)}</Text>
          {(subheading || teamLabel || ev.homeAway || ev.seriesId) ? (
            <Text style={styles.cardSub} numberOfLines={1}>
              {[teamLabel, subheading, ev.homeAway ? (ev.homeAway === 'home' ? 'Home' : 'Away') : null, ev.seriesId ? '↻' : null].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
        </View>
        {canceled ? <Text style={styles.canceledTag}>Canceled</Text> : score ? <Text style={styles.score}>{score}</Text> : null}
        <Text style={styles.arrow}>›</Text>
      </TouchableOpacity>

      {/* Row 2 — venue: one full-width tappable line → maps (fixes the truncated pill) */}
      {venue && dir ? (
        <TouchableOpacity style={styles.venueRow} onPress={() => Linking.openURL(dir)} hitSlop={4}>
          <Text style={styles.venueTxt} numberOfLines={1}>📍 {venue} · <Text style={styles.venueDir}>directions</Text></Text>
        </TouchableOpacity>
      ) : dir ? (
        <TouchableOpacity style={styles.venueRow} onPress={() => Linking.openURL(dir)} hitSlop={4}>
          <Text style={styles.venueDir} numberOfLines={1}>📍 Directions</Text>
        </TouchableOpacity>
      ) : venue ? (
        <Text style={[styles.venueTxt, styles.venueRow]} numberOfLines={1}>📍 {venue}</Text>
      ) : null}

      {/* Row 3 — RSVP: the primary control. Full-width segmented, one tap, no navigation. */}
      {canRsvp && !canceled ? myKids.map(k => {
        const cur = att.find(a => a.playerId === k.player_id)?.status ?? null;
        return (
          <View key={k.player_id} style={styles.rsvpBlock}>
            {myKids.length > 1 ? <Text style={styles.rsvpKid} numberOfLines={1}>{k.name}</Text> : null}
            <View style={styles.rsvpSeg}>
              {(['going', 'maybe', 'out'] as RsvpStatus[]).map(s => (
                <TouchableOpacity key={s} onPress={() => onRsvp(ev.id, k.player_id, s)} style={[styles.seg, cur === s && RSVP_ON[s]]}>
                  <Text style={[styles.segTxt, cur === s && styles.segTxtOn]}>{s === 'going' ? '✓ Going' : s === 'maybe' ? 'Maybe' : 'Out'}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        );
      }) : null}

      {/* Row 4 — counts caption (tap → event detail) + (coach) Remind link */}
      {showCounts ? (
        <View style={styles.countsRow}>
          <TouchableOpacity onPress={onPress} hitSlop={4}>
            <Text style={styles.counts}>{going} going · {noAnswer} haven&apos;t answered</Text>
          </TouchableOpacity>
          {onRemind ? <Text style={styles.remindLink} onPress={onRemind}>Remind</Text> : null}
        </View>
      ) : null}

      {/* Row 5 — snacks footer: subordinate to RSVP, the only green element on the card */}
      {!canceled && ev.snacksEnabled ? (
        <View style={styles.snackFoot}>
          <Text style={styles.snackLabel} numberOfLines={1}>🍎 Snacks · {snack ? (snack.claimedByUserId === myUserId ? 'you' : snack.claimerName) : 'nobody signed up'}</Text>
          {snack ? (
            snack.claimedByUserId === myUserId ? (
              <Text style={styles.snackMine}>You&apos;re bringing them · <Text style={styles.snackUndo} onPress={onReleaseSnack}>undo</Text></Text>
            ) : (
              <Text style={styles.snackCovered}>Covered</Text>
            )
          ) : onClaimSnack ? (
            <Text style={styles.snackClaim} onPress={onClaimSnack}>I&apos;ll bring them</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e1b2c' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  caption: { color: '#8b96a3', fontSize: 12.5, fontWeight: '700', letterSpacing: 0.3 },
  title: { color: '#f1f4f6', fontSize: 24, fontWeight: '800', letterSpacing: -0.4, marginTop: 2 },
  iconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, alignItems: 'center', justifyContent: 'center' },

  scopeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  scopeBtn: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  scopeBtnOn: { backgroundColor: '#1b2c44', borderColor: '#534AB7' },
  scopeTxt: { color: '#9db0bd', fontSize: 13, fontWeight: '700' },
  scopeTxtOn: { color: '#f1f4f6' },

  chipRow: { flexGrow: 0, marginBottom: 10 },
  chip: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  chipOn: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
  chipTxt: { color: '#c7d2dc', fontSize: 13, fontWeight: '700' },
  chipTxtOn: { color: '#fff' },

  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  addPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#8b7bff', borderRadius: 999, paddingHorizontal: 14, height: 36 },
  addPillTxt: { color: '#160b02', fontSize: 14, fontWeight: '800' },
  iconBtn: { width: 36, height: 36, borderRadius: 9, borderWidth: 1, borderColor: '#25333f', backgroundColor: '#16232f', alignItems: 'center', justifyContent: 'center' },

  section: { color: '#62707e', fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 14, marginBottom: 8 },

  card: { backgroundColor: '#12202e', borderColor: '#1f2f3d', borderWidth: 1, borderRadius: 14, padding: 13, marginBottom: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { borderWidth: 1, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4, minWidth: 66, alignItems: 'center' },
  badgeTxt: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  cardWhen: { color: '#f1f4f6', fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  cardSub: { color: '#8b96a3', fontSize: 12.5, marginTop: 2, fontWeight: '600' },
  canceled: { textDecorationLine: 'line-through', color: '#8b96a3' },
  canceledTag: { color: '#c0392b', fontSize: 12, fontWeight: '800' },
  score: { color: '#ff6a2c', fontSize: 14, fontWeight: '800' },
  arrow: { color: '#3a4b5a', fontSize: 20 },

  venueRow: { marginTop: 9 },
  venueTxt: { color: '#c7d2dc', fontSize: 13, fontWeight: '600' },
  venueDir: { color: '#6ea8ff', fontWeight: '700' },

  rsvpBlock: { marginTop: 12 },
  rsvpKid: { color: '#9db0bd', fontSize: 12.5, fontWeight: '700', marginBottom: 6 },
  rsvpSeg: { flexDirection: 'row', gap: 6 },
  seg: { flex: 1, borderWidth: 1, borderColor: '#2a3a48', borderRadius: 10, paddingVertical: 9, alignItems: 'center' },
  segTxt: { color: '#c7d2dc', fontSize: 13.5, fontWeight: '800' },
  segTxtOn: { color: '#0a1210' },

  countsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  counts: { color: '#8b96a3', fontSize: 12.5, fontWeight: '700' },
  remindLink: { color: '#8b7bff', fontSize: 12.5, fontWeight: '800' },

  snackFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 11, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#1b2735' },
  snackLabel: { color: '#8b96a3', fontSize: 12.5, fontWeight: '600', flex: 1 },
  snackMine: { color: '#9db0bd', fontSize: 12.5, fontWeight: '700' },
  snackUndo: { color: '#8b96a3', fontWeight: '700', textDecorationLine: 'underline' },
  snackCovered: { color: '#62707e', fontSize: 12.5, fontWeight: '700' },
  snackClaim: { color: '#3ec46d', fontSize: 13, fontWeight: '800' },

  tourn: { backgroundColor: '#12202e', borderColor: '#25333f', borderWidth: 1, borderRadius: 12, marginBottom: 10, overflow: 'hidden' },
  tournHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13, paddingVertical: 12, backgroundColor: '#16283b' },
  tournChevron: { color: '#8b7bff', fontSize: 15, fontWeight: '800', width: 14 },
  tournName: { color: '#f1f4f6', fontSize: 15.5, fontWeight: '800' },
  tournMeta: { color: '#9db0bd', fontSize: 12.5, marginTop: 2, fontWeight: '600' },
  tournAdd: { borderWidth: 1, borderColor: '#534AB7', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  tournAddTxt: { color: '#8b7bff', fontSize: 12.5, fontWeight: '800' },
  tournBody: { paddingHorizontal: 13, paddingTop: 4 },

  empty: { color: '#8b96a3', fontSize: 15, textAlign: 'center', marginTop: 40, lineHeight: 22 },
});

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
// Full time RANGE — "4:00 – 5:00 PM". Per spec this line must never truncate.
function fmtTimeRange(ev: ScheduleEvent): string {
  if (ev.timeStatus === 'tbd') return 'Time TBD';
  if (ev.timeStatus === 'all_day') return 'All day';
  if (!ev.startsAt) return 'Time TBD';
  const t = (iso: string) => { try { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: ev.eventTimezone }); } catch { return ''; } };
  const start = t(ev.startsAt);
  const end = ev.endsAt ? t(ev.endsAt) : '';
  return end ? `${start} – ${end}` : start;
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
// Event-type badge palette — a small map (not conditionals) so future event
// types slot in with their own color. game-family shares green; practice = blue.
const TYPE_BADGE: Record<string, { bg: string; fg: string }> = {
  game: { bg: '#123a25', fg: '#3ec46d' },
  scrimmage: { bg: '#123a25', fg: '#3ec46d' },
  tournament_game: { bg: '#123a25', fg: '#3ec46d' },
  practice: { bg: '#0f2942', fg: '#6ea8ff' },
  team_event: { bg: '#241f3a', fg: '#a894f0' },
};
function railParts(ymd: string): { dow: string; day: string; mon: string } {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return {
    dow: dt.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
    day: String(d),
    mon: dt.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
  };
}
function sportIcon(sport: string | null): keyof typeof Ionicons.glyphMap {
  switch ((sport || '').toLowerCase()) {
    case 'football': return 'american-football';
    case 'soccer': return 'football';
    case 'baseball': case 'softball': return 'baseball';
    case 'volleyball': return 'tennisball';
    default: return 'basketball';
  }
}
// State color rule (consistent app-wide): blue = needs your input, green =
// handled, gray = resolved/inactive, amber = tentative (Maybe).
function rsvpLabel(s: RsvpStatus | null): string {
  return s === 'going' ? 'Going ✓' : s === 'maybe' ? 'Maybe' : s === 'out' ? 'Not going' : 'Are you going?';
}
function rsvpColor(s: RsvpStatus | null): string {
  return s === 'going' ? '#3ec46d' : s === 'maybe' ? '#e0a52e' : s === 'out' ? '#8b96a3' : '#6ea8ff';
}

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
  const [scopePref, setScopePref] = useState<'team' | 'all'>('team');
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
  // From Home (no active team) the Schedule is a COMBINED agenda across every team
  // the user is on; picking a specific team narrows it. With a team active, the
  // This-team / All toggle governs. So the EFFECTIVE scope is always 'all' when no
  // team is selected, regardless of the stored preference.
  const scope: 'team' | 'all' = activeTeam ? scopePref : 'all';
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
    <Row key={ev.id} ev={ev} onPress={() => openEvent(ev)}
      teamName={teamNameById.get(ev.teamId) ?? activeTeam?.name ?? 'Team'}
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

  return (
    <View style={styles.root}>
      {Platform.OS === 'web' ? <WebTopNav /> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: Platform.OS === 'web' ? 16 : insets.top + 12, paddingHorizontal: 16, paddingBottom: 44, maxWidth: 760, width: '100%', alignSelf: 'center' }}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.caption} numberOfLines={1}>{scope === 'all' ? 'All my teams' : (activeTeam?.name ?? 'Schedule')}</Text>
          <Text style={styles.title}>Schedule</Text>
        </View>
        {isCoach && activeTeam ? (
          <TouchableOpacity style={styles.iconCircle} onPress={() => router.push('/team-settings')} accessibilityLabel="Team settings">
            <Ionicons name="settings-outline" size={19} color="#c7d2dc" />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.iconCircle} onPress={() => router.push('/messages')} accessibilityLabel="Team messages">
          <Ionicons name="chatbubble-ellipses-outline" size={20} color="#c7d2dc" />
        </TouchableOpacity>
      </View>

      {activeTeam && userTeams.length > 1 ? (
        <View style={styles.scopeRow}>
          {(['team', 'all'] as const).map(s => (
            <TouchableOpacity key={s} onPress={() => setScopePref(s)} style={[styles.scopeBtn, scope === s && styles.scopeBtnOn]}>
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
        {activeTeam ? (
          <TouchableOpacity style={styles.iconBtn} onPress={subscribeCalendar} accessibilityLabel="Subscribe to the live calendar feed">
            <Ionicons name="calendar-outline" size={18} color="#9db0bd" />
          </TouchableOpacity>
        ) : null}
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

// One card skeleton for every event; only content + state vary (spec §5). Four
// zones: header · date-rail+details · footer(attendance[, snacks]) · accent border.
function Row({ ev, onPress, teamName, isCoach, myKids, att, rosterCount, onRsvp, onRemind, snack, myUserId, onClaimSnack, onReleaseSnack }: {
  ev: ScheduleEvent; onPress: () => void; teamName: string; isCoach: boolean;
  myKids: UserKidRow[]; att: Attendance[]; rosterCount: number;
  onRsvp: (eventId: string, playerId: string, status: RsvpStatus) => void;
  onRemind?: () => void;
  snack?: SnackSignup; myUserId: string | null;
  onClaimSnack?: () => void; onReleaseSnack?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const accent = ev.teamAccentColor;
  const canceled = ev.status === 'canceled';
  const badge = TYPE_BADGE[ev.eventType] ?? { bg: '#22303c', fg: '#9db0bd' };
  const rail = railParts(ev.localDate);
  const isGame = isGameFamily(ev.eventType);
  const title = isGame
    ? (ev.opponent ? `vs. ${ev.opponent}` : (ev.title || 'Game'))
    : (ev.title || (ev.eventType === 'practice' ? 'Team practice' : eventTypeLabel(ev.eventType)));
  const dir = !canceled ? mapsUrl(ev) : null;
  const venue = ev.venueName?.trim() || ev.venueAddress?.trim()?.split(',')[0]?.trim() || null;
  const score = scoreLabel(ev);
  const going = att.filter(a => a.status === 'going').length;
  const pending = Math.max(0, rosterCount - att.length);

  // Inline RSVP only for a single-kid household; >1 kid routes to detail (Adam's
  // call), 0-kid coach gets a Remind action, other 0-kid users get no action.
  const soloKid = myKids.length === 1 ? myKids[0] : null;
  const soloStatus = soloKid ? (att.find(a => a.playerId === soloKid.player_id)?.status ?? null) : null;
  const setSolo = (s: RsvpStatus) => { if (soloKid) { onRsvp(ev.id, soloKid.player_id, s); setExpanded(false); } };

  return (
    <View style={[styles.card, { borderLeftColor: accent }, canceled && { opacity: 0.65 }]}>
      {/* Zone 1 — header: team icon + name (never truncate) + type badge */}
      <TouchableOpacity style={styles.z1} onPress={onPress} activeOpacity={0.7}>
        <View style={[styles.teamIcon, { backgroundColor: accent + '22' }]}>
          <Ionicons name={sportIcon(ev.teamSport)} size={13} color={accent} />
        </View>
        <Text style={styles.teamName}>{teamName}</Text>
        {canceled ? <Text style={styles.canceledTag}>Canceled</Text>
          : score ? <Text style={styles.scoreChip}>{score}</Text> : null}
        <View style={[styles.typeBadge, { backgroundColor: badge.bg }]}>
          <Text style={[styles.typeBadgeTxt, { color: badge.fg }]}>{eventTypeLabel(ev.eventType)}</Text>
        </View>
      </TouchableOpacity>

      {/* Zone 2 — date rail + details */}
      <TouchableOpacity style={styles.z2} onPress={onPress} activeOpacity={0.7}>
        <View style={styles.rail}>
          <Text style={styles.railDow}>{rail.dow}</Text>
          <Text style={styles.railDay}>{rail.day}</Text>
          <Text style={styles.railMon}>{rail.mon}</Text>
          {isGame && ev.homeAway ? (
            <View style={styles.haChip}><Text style={styles.haChipTxt}>{ev.homeAway === 'home' ? 'HOME' : 'AWAY'}</Text></View>
          ) : null}
        </View>
        <View style={styles.hairV} />
        <View style={styles.details}>
          <Text style={[styles.evTitle, canceled && styles.strike]}>{title}</Text>
          {/* Time — full range, NEVER truncated (wins over everything, spec §1/§5) */}
          <View style={styles.timeRow}>
            <Ionicons name="time-outline" size={13} color="#9db0bd" />
            <Text style={styles.timeTxt}>{fmtTimeRange(ev)}</Text>
          </View>
          {venue || dir ? (
            <View style={styles.locRow}>
              <Ionicons name="location-outline" size={12} color="#7d8a97" />
              {venue ? <Text style={styles.locTxt} numberOfLines={1}>{venue}</Text> : null}
              {dir ? <Text style={styles.locDir} onPress={() => Linking.openURL(dir)}>{venue ? ' · directions' : 'directions'}</Text> : null}
            </View>
          ) : null}
        </View>
      </TouchableOpacity>

      {/* Zone 3 — footer: attendance (always) + snacks (per team setting) */}
      {!canceled ? (
        <View style={styles.footer}>
          <View style={styles.fRow}>
            <View style={styles.fLeft}>
              <Ionicons name="people-outline" size={13} color="#7d8a97" />
              <Text style={styles.fLabel} numberOfLines={1}>{going} going · {pending} pending</Text>
            </View>
            {expanded && soloKid ? (
              <View style={styles.rsvpBtns}>
                <TouchableOpacity style={[styles.rsvpBtn, soloStatus === 'going' && styles.rsvpGoing]} onPress={() => setSolo('going')} accessibilityLabel="Going"><Text style={[styles.rsvpBtnTxt, soloStatus === 'going' && styles.rsvpBtnTxtOn]}>✓</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.rsvpBtn, soloStatus === 'maybe' && styles.rsvpMaybe]} onPress={() => setSolo('maybe')} accessibilityLabel="Maybe"><Text style={[styles.rsvpBtnTxt, soloStatus === 'maybe' && styles.rsvpBtnTxtOn]}>Maybe</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.rsvpBtn, soloStatus === 'out' && styles.rsvpOut]} onPress={() => setSolo('out')} accessibilityLabel="Not going"><Text style={[styles.rsvpBtnTxt, soloStatus === 'out' && styles.rsvpBtnTxtOn]}>✗</Text></TouchableOpacity>
              </View>
            ) : soloKid ? (
              <TouchableOpacity onPress={() => setExpanded(true)} hitSlop={6}>
                <Text style={[styles.fAction, { color: rsvpColor(soloStatus) }]}>{rsvpLabel(soloStatus)}</Text>
              </TouchableOpacity>
            ) : myKids.length > 1 ? (
              <TouchableOpacity onPress={onPress} hitSlop={6}><Text style={[styles.fAction, { color: '#6ea8ff' }]}>RSVP ›</Text></TouchableOpacity>
            ) : onRemind ? (
              <TouchableOpacity onPress={onRemind} hitSlop={6}><Text style={[styles.fAction, { color: '#8b7bff' }]}>Remind</Text></TouchableOpacity>
            ) : null}
          </View>

          {ev.snacksEnabledForType ? (
            <View style={[styles.fRow, styles.fRowTop]}>
              <View style={styles.fLeft}>
                <Ionicons name="nutrition-outline" size={13} color="#7d8a97" />
                <Text style={styles.fLabel} numberOfLines={1}>Snacks · {snack ? (snack.claimedByUserId === myUserId ? 'you' : snack.claimerName) : 'nobody yet'}</Text>
              </View>
              {snack ? (
                snack.claimedByUserId === myUserId ? (
                  <TouchableOpacity onPress={onReleaseSnack} hitSlop={6}><Text style={[styles.fAction, { color: '#3ec46d' }]}>You&apos;re bringing them ✓</Text></TouchableOpacity>
                ) : null
              ) : onClaimSnack ? (
                <TouchableOpacity onPress={onClaimSnack} hitSlop={6}><Text style={[styles.fAction, { color: '#3ec46d' }]}>I&apos;ll bring them</Text></TouchableOpacity>
              ) : null}
            </View>
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

  // ── Card (spec §1 anatomy): 3px accent left border, square left / 14px right ──
  card: {
    backgroundColor: '#12202e', borderColor: '#1f2f3d', borderWidth: 1, borderLeftWidth: 3,
    borderTopRightRadius: 14, borderBottomRightRadius: 14, borderTopLeftRadius: 0, borderBottomLeftRadius: 0,
    padding: 12, marginBottom: 12,
  },
  // Zone 1 — header
  z1: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  teamIcon: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  teamName: { flex: 1, color: '#e9eef2', fontSize: 14, fontWeight: '500' }, // wraps, never truncates
  scoreChip: { color: '#ff8a4c', fontSize: 13, fontWeight: '800' },
  canceledTag: { color: '#e2574a', fontSize: 11, fontWeight: '800' },
  typeBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  typeBadgeTxt: { fontSize: 11, fontWeight: '500', letterSpacing: 0.2 },
  // Zone 2 — date rail + details
  z2: { flexDirection: 'row', marginTop: 12 },
  rail: { width: 52, alignItems: 'center' },
  railDow: { color: '#7d8a97', fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
  railDay: { color: '#f1f4f6', fontSize: 26, fontWeight: '500', lineHeight: 30 },
  railMon: { color: '#7d8a97', fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
  haChip: { marginTop: 5, backgroundColor: '#1b2735', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  haChipTxt: { color: '#9db0bd', fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  hairV: { width: StyleSheet.hairlineWidth, backgroundColor: '#283644', marginHorizontal: 12, alignSelf: 'stretch' },
  details: { flex: 1, justifyContent: 'center' },
  evTitle: { color: '#f1f4f6', fontSize: 17, fontWeight: '500' }, // wraps, never truncates
  strike: { textDecorationLine: 'line-through', color: '#8b96a3' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  timeTxt: { color: '#c7d2dc', fontSize: 15, fontWeight: '500' }, // NEVER truncated — no numberOfLines
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  locTxt: { color: '#8b96a3', fontSize: 13, flexShrink: 1 }, // venue truncates first
  locDir: { color: '#6ea8ff', fontSize: 13, fontWeight: '600' },
  // Zone 3 — footer (label-left / action-right, always same positions)
  footer: { marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#283644' },
  fRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 24, gap: 8 },
  fRowTop: { marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1b2735' },
  fLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  fLabel: { color: '#8b96a3', fontSize: 12, fontWeight: '500', flexShrink: 1 },
  fAction: { fontSize: 12, fontWeight: '500' },
  rsvpBtns: { flexDirection: 'row', gap: 6 },
  rsvpBtn: { minWidth: 44, minHeight: 34, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: '#2a3a48', alignItems: 'center', justifyContent: 'center' },
  rsvpBtnTxt: { color: '#c7d2dc', fontSize: 13, fontWeight: '700' },
  rsvpBtnTxtOn: { color: '#0a1210' },
  rsvpGoing: { backgroundColor: '#3ec46d', borderColor: '#3ec46d' },
  rsvpMaybe: { backgroundColor: '#e0a52e', borderColor: '#e0a52e' },
  rsvpOut: { backgroundColor: '#8b96a3', borderColor: '#8b96a3' },

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

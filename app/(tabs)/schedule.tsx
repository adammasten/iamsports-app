// Schedule tab — a UNIFIED typed agenda (games + practices + events) in one
// chronological list with type-filter chips. Coaches add/edit any event type;
// existing games flow in via the events↔games link (film/tagging/stats untouched).
// Dark-themed to match the app. Slice 1 of the scheduling build.
import { COACH_ROLES, useTeamContext } from '@/context';
import {
  eventTypeLabel, isGameFamily, loadAttendance, loadEvents, loadRosterCounts, matchesFilter, setRsvp,
  type Attendance, type RsvpStatus, type ScheduleEvent, type ScheduleFilter,
} from '@/lib/core/schedule';
import type { UserKidRow } from '@/context';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
function scoreLabel(ev: ScheduleEvent): string | null {
  if (ev.teamScore == null || ev.opponentScore == null) return null;
  const wl = ev.teamScore === ev.opponentScore ? 'T' : ev.teamScore > ev.opponentScore ? 'W' : 'L';
  return `${wl} ${ev.teamScore}-${ev.opponentScore}`;
}
const TYPE_COLOR: Record<string, string> = {
  game: '#ff6a2c', scrimmage: '#e0a52e', tournament_game: '#e2574a', practice: '#3ec46d', team_event: '#4a90e2',
};

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
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ScheduleFilter>('all');
  const [scope, setScope] = useState<'team' | 'all'>('team');

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
      const [evs, rc] = await Promise.all([loadEvents(scopeTeamIds), loadRosterCounts(scopeTeamIds)]);
      setEvents(evs); setRosterCounts(rc);
      setAttendance(await loadAttendance(evs.map(e => e.id)));
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

  const today = todayYMD();
  const { upcoming, past } = useMemo(() => {
    const shown = events.filter(e => matchesFilter(e.eventType, filter));
    const up = shown.filter(e => e.localDate >= today && e.status !== 'canceled' && e.status !== 'completed')
      .sort((a, b) => a.localDate.localeCompare(b.localDate));
    const pa = shown.filter(e => !(e.localDate >= today && e.status !== 'canceled' && e.status !== 'completed'))
      .sort((a, b) => b.localDate.localeCompare(a.localDate));
    return { upcoming: up, past: pa };
  }, [events, filter, today]);

  function openEvent(ev: ScheduleEvent) {
    if (isCoach) { router.push({ pathname: '/edit-event', params: { event: JSON.stringify(ev) } }); return; }
    if (isGameFamily(ev.eventType) && ev.gameId) router.push({ pathname: '/box-score', params: { gameId: ev.gameId, title: ev.title ?? 'Game' } });
  }

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
      <Text style={styles.title}>{scope === 'all' ? 'All my teams' : activeTeam.name}</Text>
      <Text style={styles.subtitle}>Schedule</Text>

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

      {isCoach && scope === 'team' ? (
        <TouchableOpacity style={styles.addRow} onPress={() => router.push('/edit-event')}>
          <Text style={styles.addTxt}>＋ Add event</Text>
        </TouchableOpacity>
      ) : null}

      {loading ? (
        <ActivityIndicator color="#ff6a2c" style={{ marginTop: 30 }} />
      ) : upcoming.length === 0 && past.length === 0 ? (
        <Text style={styles.empty}>Nothing scheduled yet.{isCoach ? '\nTap “＋ Add event” to add a game or practice.' : ''}</Text>
      ) : (
        <>
          {upcoming.length > 0 ? (
            <>
              <Text style={styles.section}>Upcoming</Text>
              {upcoming.map(ev => (
                <Row key={ev.id} ev={ev} onPress={() => openEvent(ev)} canRsvp
                  teamLabel={scope === 'all' ? teamNameById.get(ev.teamId) : undefined}
                  isCoach={isCoach} myKids={userKids.filter(k => k.team_id === ev.teamId)}
                  att={attendance.filter(a => a.eventId === ev.id)} rosterCount={rosterCounts[ev.teamId] ?? 0} onRsvp={onRsvp} />
              ))}
            </>
          ) : null}
          {past.length > 0 ? (
            <>
              <Text style={styles.section}>Past &amp; completed</Text>
              {past.map(ev => (
                <Row key={ev.id} ev={ev} onPress={() => openEvent(ev)} canRsvp={false}
                  teamLabel={scope === 'all' ? teamNameById.get(ev.teamId) : undefined}
                  isCoach={isCoach} myKids={[]} att={attendance.filter(a => a.eventId === ev.id)} rosterCount={rosterCounts[ev.teamId] ?? 0} onRsvp={onRsvp} />
              ))}
            </>
          ) : null}
        </>
      )}
      </ScrollView>
    </View>
  );
}

const RSVP_ON: Record<RsvpStatus, object> = { going: { backgroundColor: '#3ec46d', borderColor: '#3ec46d' }, maybe: { backgroundColor: '#e0a52e', borderColor: '#e0a52e' }, out: { backgroundColor: '#c0392b', borderColor: '#c0392b' } };

function Row({ ev, onPress, teamLabel, isCoach, myKids, att, rosterCount, canRsvp, onRsvp }: {
  ev: ScheduleEvent; onPress: () => void; teamLabel?: string; isCoach: boolean;
  myKids: UserKidRow[]; att: Attendance[]; rosterCount: number; canRsvp: boolean;
  onRsvp: (eventId: string, playerId: string, status: RsvpStatus) => void;
}) {
  const canceled = ev.status === 'canceled';
  const score = scoreLabel(ev);
  const heading = ev.title || (isGameFamily(ev.eventType) && ev.opponent ? `vs ${ev.opponent}` : eventTypeLabel(ev.eventType));
  const going = att.filter(a => a.status === 'going').length;
  const maybe = att.filter(a => a.status === 'maybe').length;
  const out = att.filter(a => a.status === 'out').length;
  const noAnswer = Math.max(0, rosterCount - att.length);

  return (
    <View style={[styles.row, canceled && { opacity: 0.7 }]}>
      <TouchableOpacity style={styles.rowTop} onPress={onPress}>
        <View style={[styles.badge, { backgroundColor: (TYPE_COLOR[ev.eventType] ?? '#4a90e2') + '22', borderColor: TYPE_COLOR[ev.eventType] ?? '#4a90e2' }]}>
          <Text style={[styles.badgeTxt, { color: TYPE_COLOR[ev.eventType] ?? '#4a90e2' }]}>{eventTypeLabel(ev.eventType)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, canceled && styles.canceled]} numberOfLines={1}>
            {heading}{ev.homeAway ? <Text style={styles.rowHa}>  {ev.homeAway === 'home' ? '· Home' : '· Away'}</Text> : null}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {teamLabel ? `${teamLabel} · ` : ''}{fmtDate(ev.localDate)} · {fmtTime(ev)}{ev.venueName ? ` · ${ev.venueName}` : ''}
          </Text>
        </View>
        {canceled ? <Text style={styles.canceledTag}>Canceled</Text> : score ? <Text style={styles.score}>{score}</Text> : null}
        <Text style={styles.arrow}>›</Text>
      </TouchableOpacity>

      {canRsvp && myKids.length > 0 ? (
        <View style={styles.rsvpWrap}>
          {myKids.map(k => {
            const cur = att.find(a => a.playerId === k.player_id)?.status ?? null;
            return (
              <View key={k.player_id} style={styles.rsvpRow}>
                {myKids.length > 1 ? <Text style={styles.rsvpName} numberOfLines={1}>{k.name}</Text> : null}
                {(['going', 'maybe', 'out'] as RsvpStatus[]).map(s => (
                  <TouchableOpacity key={s} onPress={() => onRsvp(ev.id, k.player_id, s)} style={[styles.rsvpPill, cur === s && RSVP_ON[s]]}>
                    <Text style={[styles.rsvpTxt, cur === s && styles.rsvpTxtOn]}>{s === 'going' ? 'Going' : s === 'maybe' ? 'Maybe' : 'Out'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            );
          })}
        </View>
      ) : null}

      {isCoach && canRsvp ? (
        <Text style={styles.headcount}>{going} going · {maybe} maybe · {out} out{noAnswer > 0 ? ` · ${noAnswer} no answer` : ''}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e1b2c' },
  title: { color: '#f1f4f6', fontSize: 22, fontWeight: '800' },
  subtitle: { color: '#8b96a3', fontSize: 14, fontWeight: '600', marginBottom: 14 },
  chipRow: { flexGrow: 0, marginBottom: 12 },
  chip: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
  chipTxt: { color: '#c7d2dc', fontSize: 13, fontWeight: '700' },
  chipTxtOn: { color: '#fff' },
  addRow: { borderWidth: 1, borderColor: '#534AB7', borderStyle: 'dashed', borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginBottom: 14 },
  addTxt: { color: '#8b7bff', fontSize: 15, fontWeight: '800' },
  section: { color: '#62707e', fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 14, marginBottom: 8 },
  scopeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  scopeBtn: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  scopeBtnOn: { backgroundColor: '#1b2c44', borderColor: '#534AB7' },
  scopeTxt: { color: '#9db0bd', fontSize: 13, fontWeight: '700' },
  scopeTxtOn: { color: '#f1f4f6' },
  row: { paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#1b2735' },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  rsvpWrap: { marginTop: 9, gap: 6 },
  rsvpRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  rsvpName: { color: '#9db0bd', fontSize: 12.5, fontWeight: '700', marginRight: 4, minWidth: 48 },
  rsvpPill: { borderWidth: 1, borderColor: '#2a3a48', borderRadius: 999, paddingHorizontal: 13, paddingVertical: 6 },
  rsvpTxt: { color: '#c7d2dc', fontSize: 12.5, fontWeight: '700' },
  rsvpTxtOn: { color: '#0a1210' },
  headcount: { color: '#8b96a3', fontSize: 12, fontWeight: '700', marginTop: 8 },
  badge: { borderWidth: 1, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4, minWidth: 66, alignItems: 'center' },
  badgeTxt: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  rowTitle: { color: '#f1f4f6', fontSize: 15.5, fontWeight: '700' },
  rowHa: { color: '#8b96a3', fontSize: 13, fontWeight: '600' },
  rowMeta: { color: '#8b96a3', fontSize: 12.5, marginTop: 2 },
  canceled: { textDecorationLine: 'line-through', color: '#8b96a3' },
  canceledTag: { color: '#c0392b', fontSize: 12, fontWeight: '800' },
  score: { color: '#ff6a2c', fontSize: 14, fontWeight: '800' },
  arrow: { color: '#3a4b5a', fontSize: 20 },
  empty: { color: '#8b96a3', fontSize: 15, textAlign: 'center', marginTop: 40, lineHeight: 22 },
});

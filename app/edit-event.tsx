// Add / edit a schedule event (coach-only; RLS enforces is_team_coach). Works on
// web + native with plain inputs (a native date/time picker is a later polish).
// Game-family types create/update a linked games row so film/tagging/stats attach.
import { useTeamContext } from '@/context';
import {
  cancelEvent, cancelSeries, createPracticeSeries, createTournament, EVENT_TYPES, eventTypeLabel, isGameFamily, loadTournaments, saveEvent, updateSeriesForward,
  type EventInput, type EventType, type ScheduleEvent, type Tournament,
} from '@/lib/core/schedule';
import { sendTeamPush } from '@/lib/core/push';
import { goBackOrHome } from '@/lib/nav';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import DateTimeField from './components/DateTimeField';
import { Alert, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const DEVICE_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'America/Chicago'; } })();

function todayYMD(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function validYMD(s: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(s.trim()) && !Number.isNaN(new Date(s.trim() + 'T00:00:00').getTime()); }

// Lenient time parse: "6:00 PM" / "6pm" / "18:00" / "6:30" → {h,m} (or null).
function parseTime(s: string): { h: number; m: number } | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}
function combine(ymd: string, t: { h: number; m: number }): string {
  const [y, mo, d] = ymd.split('-').map(Number);
  return new Date(y, mo - 1, d, t.h, t.m, 0, 0).toISOString();
}
function fmtTimeInput(iso: string | null, tz: string): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }); } catch { return ''; }
}
// "Sat, Aug 30" from a YYYY-MM-DD (parsed as local, no UTC shift).
function fmtNice(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function EditEventScreen() {
  const insets = useSafeAreaInsets();
  const { userId, activeTeam } = useTeamContext();
  const params = useLocalSearchParams();
  const existing: ScheduleEvent | null = useMemo(() => {
    const raw = Array.isArray(params.event) ? params.event[0] : params.event;
    try { return raw ? (JSON.parse(raw as string) as ScheduleEvent) : null; } catch { return null; }
  }, [params.event]);
  const editing = !!existing;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const prefillType = one(params.type) as EventType | undefined;
  const prefillDate = one(params.date);
  const prefillTournamentId = one(params.tournamentId);

  const [type, setType] = useState<EventType>(existing?.eventType ?? prefillType ?? 'game');
  const [date, setDate] = useState(existing?.localDate ?? prefillDate ?? todayYMD());
  const [timeTbd, setTimeTbd] = useState(existing ? existing.timeStatus === 'tbd' : false);
  const tz = existing?.eventTimezone ?? DEVICE_TZ;
  const [startTime, setStartTime] = useState(fmtTimeInput(existing?.startsAt ?? null, tz));
  const [arrivalTime, setArrivalTime] = useState(fmtTimeInput(existing?.arrivalAt ?? null, tz));
  const [endTime, setEndTime] = useState(fmtTimeInput(existing?.endsAt ?? null, tz));
  const [venueName, setVenueName] = useState(existing?.venueName ?? '');
  const [venueAddress, setVenueAddress] = useState(existing?.venueAddress ?? '');
  const [opponent, setOpponent] = useState(existing?.opponent ?? '');
  const [homeAway, setHomeAway] = useState<'home' | 'away' | null>(existing?.homeAway ?? null);
  const [uniform, setUniform] = useState(existing?.uniform ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [saving, setSaving] = useState(false);

  // Recurrence (practice / team_event only, create-only). Weekday = 0..6 (Sun..Sat).
  const initialWeekday = (() => { const [y, m, d] = (existing?.localDate ?? prefillDate ?? todayYMD()).split('-').map(Number); return new Date(y, m - 1, d).getDay(); })();
  const [repeat, setRepeat] = useState(false);
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set([initialWeekday]));
  const [untilDate, setUntilDate] = useState('');
  const [applyFuture, setApplyFuture] = useState(false); // edit: this + future occurrences

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [tournamentId, setTournamentId] = useState<string | null>(existing?.tournamentId ?? prefillTournamentId ?? null);
  const [newTournament, setNewTournament] = useState('');
  const [addingTournament, setAddingTournament] = useState(false);

  const gameFamily = isGameFamily(type);

  useEffect(() => {
    if (!activeTeam) return;
    loadTournaments([activeTeam.id]).then(setTournaments).catch(() => {});
  }, [activeTeam]);

  // Ask the coach whether to push the team about a change; resolves to their choice.
  function confirmNotify(kind: 'update' | 'canceled'): Promise<boolean> {
    const q = kind === 'canceled' ? 'Notify the team this event is canceled?' : 'Notify the team about this change?';
    return new Promise(resolve => {
      if (Platform.OS === 'web') { resolve(window.confirm(q)); return; }
      Alert.alert('Notify the team?', q, [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Notify', onPress: () => resolve(true) },
      ]);
    });
  }
  // On a coach's confirmation, push the whole team about this edit/cancel.
  async function offerChangeNotify(kind: 'update' | 'canceled') {
    if (!activeTeam) return;
    if (!(await confirmNotify(kind))) return;
    const label = title.trim() || (gameFamily && opponent.trim() ? `vs ${opponent.trim()}` : eventTypeLabel(type));
    const when = `${fmtNice(date)}${!timeTbd && startTime.trim() ? ` · ${startTime.trim()}` : ''}`;
    const pushTitle = kind === 'canceled' ? `❌ ${activeTeam.name}` : `🗓️ ${activeTeam.name}`;
    const pushBody = kind === 'canceled' ? `${label} on ${fmtNice(date)} is canceled.` : `Update: ${label} — ${when}.`;
    try {
      await sendTeamPush({ teamId: activeTeam.id, title: pushTitle, body: pushBody, data: { url: '/schedule' } });
    } catch (e: any) {
      Alert.alert('Notify team', e?.message ?? 'Could not send the notification.');
    }
  }

  async function onSave() {
    if (!activeTeam || !userId) { Alert.alert('Not ready', 'No team selected.'); return; }
    if (!validYMD(date)) { Alert.alert('Date', 'Enter the date as YYYY-MM-DD.'); return; }
    let st: { h: number; m: number } | null = null, at: { h: number; m: number } | null = null, et: { h: number; m: number } | null = null;
    if (!timeTbd) {
      st = parseTime(startTime);
      if (startTime.trim() && !st) { Alert.alert('Start time', 'Try a time like “6:00 PM”.'); return; }
      at = parseTime(arrivalTime);
      if (arrivalTime.trim() && !at) { Alert.alert('Arrival time', 'Try a time like “5:30 PM”.'); return; }
      et = parseTime(endTime);
      if (endTime.trim() && !et) { Alert.alert('End time', 'Try a time like “8:00 PM”.'); return; }
    }
    const startsAt = st ? combine(date, st) : null;
    const arrivalAt = at ? combine(date, at) : null;
    const endsAt = et ? combine(date, et) : null;
    const hhmm = (t: { h: number; m: number } | null) => (t ? `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}` : null);
    const canRepeat = !editing && !gameFamily;

    // Recurring practice / team event → materialize the whole series server-side.
    if (canRepeat && repeat) {
      if (weekdays.size === 0) { Alert.alert('Repeat', 'Pick at least one day of the week.'); return; }
      if (!validYMD(untilDate)) { Alert.alert('Repeat until', 'Enter the end date as YYYY-MM-DD.'); return; }
      if (untilDate.trim() < date.trim()) { Alert.alert('Repeat until', 'The end date must be on or after the first date.'); return; }
      setSaving(true);
      try {
        const n = await createPracticeSeries({
          teamId: activeTeam.id, eventType: type as 'practice' | 'team_event', title: title.trim() || null,
          firstDate: date.trim(), untilDate: untilDate.trim(), weekdays: Array.from(weekdays),
          startTime: hhmm(st), arrivalTime: hhmm(at), endTime: hhmm(et),
          eventTimezone: tz, venueName, venueAddress, uniform, notes,
        });
        Alert.alert('Recurring event', `Added ${n} occurrence${n === 1 ? '' : 's'}.`, [{ text: 'OK', onPress: () => router.back() }]);
      } catch (e: any) {
        Alert.alert('Recurring event', e?.message ?? String(e));
      } finally { setSaving(false); }
      return;
    }

    // Edit → apply to this + every later occurrence in the series (times recompute per date).
    if (editing && existing?.seriesId && applyFuture) {
      setSaving(true);
      try {
        const n = await updateSeriesForward({
          seriesId: existing.seriesId, fromDate: existing.localDate, title: title.trim() || null,
          startTime: hhmm(st), arrivalTime: hhmm(at), endTime: hhmm(et), eventTimezone: tz,
          venueName, venueAddress, uniform, notes,
        });
        Alert.alert('Series updated', `Updated ${n} occurrence${n === 1 ? '' : 's'}.`, [{ text: 'OK', onPress: () => router.back() }]);
      } catch (e: any) {
        Alert.alert('Update series', e?.message ?? String(e));
      } finally { setSaving(false); }
      return;
    }

    setSaving(true);
    try {
      // A game-family event can carry a tournament; create one on the fly if named.
      let resolvedTournamentId = gameFamily ? tournamentId : null;
      if (gameFamily && addingTournament && newTournament.trim()) {
        resolvedTournamentId = await createTournament(activeTeam.id, newTournament, userId);
      }
      const input: EventInput = {
        id: existing?.id, teamId: activeTeam.id, eventType: type, title: title.trim() || null,
        localDate: date.trim(), startsAt, endsAt, arrivalAt,
        eventTimezone: tz, timeStatus: timeTbd ? 'tbd' : 'confirmed',
        homeAway: gameFamily ? homeAway : null,
        venueName, venueAddress, uniform, notes,
        tournamentId: resolvedTournamentId, seasonId: existing?.seasonId ?? null,
        opponent: gameFamily ? opponent : null,
        version: existing?.version, gameId: existing?.gameId ?? null,
      };
      await saveEvent(input, userId);
      if (editing) await offerChangeNotify('update');
      router.back();
    } catch (e: any) {
      Alert.alert('Save event', e?.message ?? String(e));
    } finally { setSaving(false); }
  }

  async function onCancelSeries() {
    if (!existing?.seriesId) return;
    const from = existing.localDate;
    const run = async () => {
      try { const n = await cancelSeries(existing.seriesId!, from); Alert.alert('Series canceled', `Canceled ${n} upcoming occurrence${n === 1 ? '' : 's'}.`, [{ text: 'OK', onPress: () => router.back() }]); }
      catch (e: any) { Alert.alert('Cancel series', e?.message ?? String(e)); }
    };
    if (Platform.OS === 'web') { if (window.confirm('Cancel this and every later occurrence in the series? Past ones stay as history.')) run(); return; }
    Alert.alert('Cancel series', 'Cancel this and every later occurrence? Past ones stay as history.', [
      { text: 'Keep them' }, { text: 'Cancel series', style: 'destructive', onPress: run },
    ]);
  }

  async function doCancel() {
    if (!existing) return;
    try { await cancelEvent(existing.id); await offerChangeNotify('canceled'); router.back(); }
    catch (e: any) { Alert.alert('Cancel event', e?.message ?? String(e)); }
  }
  async function onCancelEvent() {
    if (!existing) return;
    if (Platform.OS === 'web') { if (window.confirm(`Cancel “${existing.title ?? 'this event'}”? It stays on the schedule marked canceled.`)) await doCancel(); return; }
    Alert.alert('Cancel event', `Mark “${existing.title ?? 'this event'}” canceled? It stays on the schedule, struck through.`, [
      { text: 'Keep it', style: 'cancel' }, { text: 'Cancel event', style: 'destructive', onPress: doCancel },
    ]);
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 18, paddingBottom: 60, maxWidth: 620, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
      <TouchableOpacity onPress={goBackOrHome} hitSlop={8} style={styles.back}><Text style={styles.backTxt}>← Back</Text></TouchableOpacity>
      <Text style={styles.h1}>{editing ? 'Edit event' : 'New event'}</Text>

      <Text style={styles.label}>Type</Text>
      <View style={styles.typeRow}>
        {EVENT_TYPES.map(t => (
          <TouchableOpacity
            key={t.value}
            onPress={() => { if (!editing) setType(t.value); }}
            style={[styles.typeChip, type === t.value && styles.typeChipOn, editing && type !== t.value && { opacity: 0.35 }]}
          >
            <Text style={[styles.typeTxt, type === t.value && styles.typeTxtOn]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {editing ? <Text style={styles.hint}>Type is fixed once an event is created.</Text> : null}

      <Text style={styles.label}>Date</Text>
      <DateTimeField mode="date" value={date} onChange={setDate} placeholder="YYYY-MM-DD" />

      <View style={styles.rowBetween}>
        <Text style={styles.label}>Time TBD</Text>
        <Switch value={timeTbd} onValueChange={setTimeTbd} />
      </View>
      {!timeTbd ? (
        <>
          <Text style={styles.label}>Start time</Text>
          <DateTimeField mode="time" value={startTime} onChange={setStartTime} placeholder="e.g. 6:00 PM" />
          <Text style={styles.label}>Arrival time</Text>
          <DateTimeField mode="time" value={arrivalTime} onChange={setArrivalTime} placeholder="be there by… (optional)" />
          <Text style={styles.label}>End time</Text>
          <DateTimeField mode="time" value={endTime} onChange={setEndTime} placeholder="optional" />
        </>
      ) : <Text style={styles.hint}>Time is TBD — add it later (e.g. once the bracket is set).</Text>}

      {gameFamily ? (
        <>
          <Text style={styles.label}>Opponent</Text>
          <TextInput style={styles.input} value={opponent} onChangeText={setOpponent} placeholder="Opponent name" placeholderTextColor="#666" />
          <Text style={styles.label}>Home / Away</Text>
          <View style={styles.typeRow}>
            {(['home', 'away'] as const).map(v => (
              <TouchableOpacity key={v} onPress={() => setHomeAway(h => (h === v ? null : v))} style={[styles.typeChip, homeAway === v && styles.typeChipOn]}>
                <Text style={[styles.typeTxt, homeAway === v && styles.typeTxtOn]}>{v === 'home' ? 'Home' : 'Away'}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Tournament (optional)</Text>
          <View style={styles.typeRow}>
            <TouchableOpacity
              onPress={() => { setTournamentId(null); setAddingTournament(false); }}
              style={[styles.typeChip, tournamentId === null && !addingTournament && styles.typeChipOn]}
            >
              <Text style={[styles.typeTxt, tournamentId === null && !addingTournament && styles.typeTxtOn]}>None</Text>
            </TouchableOpacity>
            {tournaments.map(t => (
              <TouchableOpacity
                key={t.id}
                onPress={() => { setTournamentId(t.id); setAddingTournament(false); }}
                style={[styles.typeChip, tournamentId === t.id && !addingTournament && styles.typeChipOn]}
              >
                <Text style={[styles.typeTxt, tournamentId === t.id && !addingTournament && styles.typeTxtOn]}>{t.name}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              onPress={() => { setAddingTournament(true); setTournamentId(null); }}
              style={[styles.typeChip, addingTournament && styles.typeChipOn]}
            >
              <Text style={[styles.typeTxt, addingTournament && styles.typeTxtOn]}>+ New</Text>
            </TouchableOpacity>
          </View>
          {addingTournament ? (
            <TextInput style={[styles.input, { marginTop: 8 }]} value={newTournament} onChangeText={setNewTournament} placeholder="Tournament name (e.g. Labor Day Classic)" placeholderTextColor="#666" />
          ) : null}
        </>
      ) : (
        <>
          <Text style={styles.label}>Title (optional)</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder={type === 'practice' ? 'Practice' : 'e.g. Team dinner'} placeholderTextColor="#666" />

          {!editing ? (
            <>
              <View style={styles.rowBetween}>
                <Text style={styles.label}>Repeat weekly</Text>
                <Switch value={repeat} onValueChange={setRepeat} />
              </View>
              {repeat ? (
                <>
                  <Text style={styles.hint}>The “Date” above is the first occurrence. We’ll add one {type === 'practice' ? 'practice' : 'event'} for each chosen day through the end date.</Text>
                  <Text style={styles.label}>On these days</Text>
                  <View style={styles.typeRow}>
                    {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d, i) => (
                      <TouchableOpacity
                        key={i}
                        onPress={() => setWeekdays(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; })}
                        style={[styles.dayChip, weekdays.has(i) && styles.typeChipOn]}
                      >
                        <Text style={[styles.typeTxt, weekdays.has(i) && styles.typeTxtOn]}>{d}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={styles.label}>Repeat until</Text>
                  <DateTimeField mode="date" value={untilDate} onChange={setUntilDate} placeholder="YYYY-MM-DD (last date)" />
                </>
              ) : null}
            </>
          ) : null}
        </>
      )}

      <Text style={styles.label}>Venue</Text>
      <TextInput style={styles.input} value={venueName} onChangeText={setVenueName} placeholder="Field / gym name" placeholderTextColor="#666" />
      <TextInput style={styles.input} value={venueAddress} onChangeText={setVenueAddress} placeholder="Address (tap-for-directions later)" placeholderTextColor="#666" />

      <Text style={styles.label}>Uniform</Text>
      <TextInput style={styles.input} value={uniform} onChangeText={setUniform} placeholder="e.g. White jerseys" placeholderTextColor="#666" />

      <Text style={styles.label}>Notes</Text>
      <TextInput style={[styles.input, { minHeight: 64, textAlignVertical: 'top' }]} value={notes} onChangeText={setNotes} placeholder="Anything else the team should know" placeholderTextColor="#666" multiline />

      {editing && existing?.seriesId ? (
        <>
          <View style={styles.rowBetween}>
            <Text style={styles.label}>Apply to this &amp; all future</Text>
            <Switch value={applyFuture} onValueChange={setApplyFuture} />
          </View>
          <Text style={styles.hint}>{applyFuture ? 'Time, venue, uniform & notes will update on this and every later occurrence in the series (date changes are ignored).' : 'Off: changes affect only this occurrence.'}</Text>
        </>
      ) : null}

      <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={onSave} disabled={saving}>
        <Text style={styles.saveTxt}>{saving ? 'Saving…' : editing ? 'Save changes' : repeat && !gameFamily ? 'Create recurring events' : 'Create event'}</Text>
      </TouchableOpacity>
      {editing && gameFamily && existing?.gameId ? (
        <TouchableOpacity style={styles.linkBtn} onPress={() => router.push({ pathname: '/box-score', params: { gameId: existing.gameId!, title: existing.title ?? 'Game' } })}>
          <Text style={styles.linkTxt}>View box score &amp; stats →</Text>
        </TouchableOpacity>
      ) : null}
      {editing ? (
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancelEvent}>
          <Text style={styles.cancelTxt}>Cancel this {existing?.seriesId ? 'occurrence' : 'event'}</Text>
        </TouchableOpacity>
      ) : null}
      {editing && existing?.seriesId ? (
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancelSeries}>
          <Text style={styles.cancelTxt}>Cancel this &amp; all future in the series</Text>
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e1b2c' },
  back: { alignSelf: 'flex-start', paddingVertical: 6 },
  backTxt: { color: '#ff6a2c', fontSize: 14, fontWeight: '700' },
  h1: { color: '#f1f4f6', fontSize: 26, fontWeight: '800', marginTop: 4, marginBottom: 10 },
  label: { color: '#8b7bff', fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 16, marginBottom: 6 },
  hint: { color: '#62707e', fontSize: 12.5, marginTop: 6, lineHeight: 17 },
  input: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 10, color: '#f1f4f6', paddingHorizontal: 12, paddingVertical: 11, fontSize: 15 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8 },
  dayChip: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 999, width: 42, paddingVertical: 9, alignItems: 'center' },
  typeChipOn: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
  typeTxt: { color: '#c7d2dc', fontSize: 13, fontWeight: '700' },
  typeTxtOn: { color: '#fff' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  saveBtn: { backgroundColor: '#ff6a2c', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 28 },
  saveTxt: { color: '#160b02', fontSize: 16, fontWeight: '800' },
  linkBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 14 },
  linkTxt: { color: '#8b7bff', fontSize: 14, fontWeight: '800' },
  cancelBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 6 },
  cancelTxt: { color: '#c0392b', fontSize: 14, fontWeight: '700' },
});

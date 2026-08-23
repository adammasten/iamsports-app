// Add / edit a schedule event (coach-only; RLS enforces is_team_coach). Works on
// web + native with plain inputs (a native date/time picker is a later polish).
// Game-family types create/update a linked games row so film/tagging/stats attach.
import { useTeamContext } from '@/context';
import {
  cancelEvent, EVENT_TYPES, eventTypeLabel, isGameFamily, saveEvent,
  type EventInput, type EventType, type ScheduleEvent,
} from '@/lib/core/schedule';
import { goBackOrHome } from '@/lib/nav';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
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

export default function EditEventScreen() {
  const insets = useSafeAreaInsets();
  const { userId, activeTeam } = useTeamContext();
  const params = useLocalSearchParams();
  const existing: ScheduleEvent | null = useMemo(() => {
    const raw = Array.isArray(params.event) ? params.event[0] : params.event;
    try { return raw ? (JSON.parse(raw as string) as ScheduleEvent) : null; } catch { return null; }
  }, [params.event]);
  const editing = !!existing;

  const [type, setType] = useState<EventType>(existing?.eventType ?? 'game');
  const [date, setDate] = useState(existing?.localDate ?? todayYMD());
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

  const gameFamily = isGameFamily(type);

  async function onSave() {
    if (!activeTeam || !userId) { Alert.alert('Not ready', 'No team selected.'); return; }
    if (!validYMD(date)) { Alert.alert('Date', 'Enter the date as YYYY-MM-DD.'); return; }
    let startsAt: string | null = null, arrivalAt: string | null = null, endsAt: string | null = null;
    if (!timeTbd) {
      const st = parseTime(startTime);
      if (startTime.trim() && !st) { Alert.alert('Start time', 'Try a time like “6:00 PM”.'); return; }
      const at = parseTime(arrivalTime);
      if (arrivalTime.trim() && !at) { Alert.alert('Arrival time', 'Try a time like “5:30 PM”.'); return; }
      const et = parseTime(endTime);
      if (endTime.trim() && !et) { Alert.alert('End time', 'Try a time like “8:00 PM”.'); return; }
      startsAt = st ? combine(date, st) : null;
      arrivalAt = at ? combine(date, at) : null;
      endsAt = et ? combine(date, et) : null;
    }
    const input: EventInput = {
      id: existing?.id, teamId: activeTeam.id, eventType: type, title: title.trim() || null,
      localDate: date.trim(), startsAt, endsAt, arrivalAt,
      eventTimezone: tz, timeStatus: timeTbd ? 'tbd' : 'confirmed',
      homeAway: gameFamily ? homeAway : null,
      venueName, venueAddress, uniform, notes,
      tournamentId: existing?.tournamentId ?? null, seasonId: existing?.seasonId ?? null,
      opponent: gameFamily ? opponent : null,
      version: existing?.version, gameId: existing?.gameId ?? null,
    };
    setSaving(true);
    try {
      await saveEvent(input, userId);
      router.back();
    } catch (e: any) {
      Alert.alert('Save event', e?.message ?? String(e));
    } finally { setSaving(false); }
  }

  async function onCancelEvent() {
    if (!existing) return;
    const ok = Platform.OS === 'web' ? window.confirm(`Cancel “${existing.title ?? 'this event'}”? It stays on the schedule marked canceled.`) : true;
    if (Platform.OS !== 'web') {
      Alert.alert('Cancel event', `Mark “${existing.title ?? 'this event'}” canceled? It stays on the schedule, struck through.`, [
        { text: 'Keep it' }, { text: 'Cancel event', style: 'destructive', onPress: async () => { await cancelEvent(existing.id); router.back(); } },
      ]);
      return;
    }
    if (!ok) return;
    try { await cancelEvent(existing.id); router.back(); } catch (e: any) { Alert.alert('Cancel event', e?.message ?? String(e)); }
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
      <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor="#666" autoCapitalize="none" />

      <View style={styles.rowBetween}>
        <Text style={styles.label}>Time TBD</Text>
        <Switch value={timeTbd} onValueChange={setTimeTbd} />
      </View>
      {!timeTbd ? (
        <>
          <Text style={styles.label}>Start time</Text>
          <TextInput style={styles.input} value={startTime} onChangeText={setStartTime} placeholder="e.g. 6:00 PM" placeholderTextColor="#666" />
          <Text style={styles.label}>Arrival time</Text>
          <TextInput style={styles.input} value={arrivalTime} onChangeText={setArrivalTime} placeholder="be there by… (optional)" placeholderTextColor="#666" />
          <Text style={styles.label}>End time</Text>
          <TextInput style={styles.input} value={endTime} onChangeText={setEndTime} placeholder="optional" placeholderTextColor="#666" />
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
        </>
      ) : (
        <>
          <Text style={styles.label}>Title (optional)</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder={type === 'practice' ? 'Practice' : 'e.g. Team dinner'} placeholderTextColor="#666" />
        </>
      )}

      <Text style={styles.label}>Venue</Text>
      <TextInput style={styles.input} value={venueName} onChangeText={setVenueName} placeholder="Field / gym name" placeholderTextColor="#666" />
      <TextInput style={styles.input} value={venueAddress} onChangeText={setVenueAddress} placeholder="Address (tap-for-directions later)" placeholderTextColor="#666" />

      <Text style={styles.label}>Uniform</Text>
      <TextInput style={styles.input} value={uniform} onChangeText={setUniform} placeholder="e.g. White jerseys" placeholderTextColor="#666" />

      <Text style={styles.label}>Notes</Text>
      <TextInput style={[styles.input, { minHeight: 64, textAlignVertical: 'top' }]} value={notes} onChangeText={setNotes} placeholder="Anything else the team should know" placeholderTextColor="#666" multiline />

      <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={onSave} disabled={saving}>
        <Text style={styles.saveTxt}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create event'}</Text>
      </TouchableOpacity>
      {editing ? (
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancelEvent}>
          <Text style={styles.cancelTxt}>Cancel this event</Text>
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
  typeChipOn: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
  typeTxt: { color: '#c7d2dc', fontSize: 13, fontWeight: '700' },
  typeTxtOn: { color: '#fff' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  saveBtn: { backgroundColor: '#ff6a2c', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 28 },
  saveTxt: { color: '#160b02', fontSize: 16, fontWeight: '800' },
  cancelBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 6 },
  cancelTxt: { color: '#c0392b', fontSize: 14, fontWeight: '700' },
});

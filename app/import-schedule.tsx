// Editable preview of an AI-extracted schedule photo. NOTHING is saved until the
// coach reviews/edits and taps Confirm (spec rule: never silently save AI data).
// Each confirmed row becomes a game-family event (+ its linked games row).
import { useTeamContext } from '@/context';
import { goBackOrHome } from '@/lib/nav';
import { supabase } from '@/supabase';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { webAlert, alertThenGo } from '@/lib/webAlert';

const DEVICE_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'America/Chicago'; } })();

type Row = { date: string; time: string; opponent: string; location: string; home: boolean };

function validYMD(s: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(s.trim()); }
function parseHHMM(s: string): { h: number; m: number } | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = +m[1], min = +m[2];
  return h <= 23 && min <= 59 ? { h, m: min } : null;
}
function combine(ymd: string, t: { h: number; m: number }): string {
  const [y, mo, d] = ymd.split('-').map(Number);
  return new Date(y, mo - 1, d, t.h, t.m, 0, 0).toISOString();
}

export default function ImportScheduleScreen() {
  const insets = useSafeAreaInsets();
  const { userId } = useTeamContext();
  const params = useLocalSearchParams();
  const teamId = (Array.isArray(params.teamId) ? params.teamId[0] : params.teamId) as string;

  const initial: Row[] = useMemo(() => {
    const raw = Array.isArray(params.rows) ? params.rows[0] : params.rows;
    try {
      const arr = JSON.parse((raw as string) ?? '[]') as any[];
      return arr.map(r => ({
        date: r.date ?? '', time: r.time ?? '', opponent: r.opponent ?? '',
        location: r.location ?? '', home: r.home_away === 'home',
      }));
    } catch { return []; }
  }, [params.rows]);

  const [rows, setRows] = useState<Row[]>(initial);
  const [saving, setSaving] = useState(false);

  const set = (i: number, patch: Partial<Row>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => setRows(rs => rs.filter((_, j) => j !== i));

  async function confirm() {
    if (!userId || !teamId) { webAlert('Import', 'Not ready.'); return; }
    const valid = rows.filter(r => validYMD(r.date));
    if (valid.length === 0) { webAlert('Import', 'No rows have a valid date (YYYY-MM-DD). Fix the dates or cancel.'); return; }
    // Insert the whole batch in ONE transaction with notifications suppressed —
    // a season import must not fire one alert per game.
    const payload = valid.map(r => {
      const t = r.time ? parseHHMM(r.time) : null;
      const startsAt = t ? combine(r.date, t) : null;
      return {
        date: r.date.trim(), starts_at: startsAt, time_status: startsAt ? 'confirmed' : 'tbd',
        home_away: r.home ? 'home' : 'away', venue_name: r.location.trim() || null,
        opponent: r.opponent.trim() || null, tz: DEVICE_TZ,
      };
    });
    setSaving(true);
    const { data, error } = await supabase.rpc('import_game_events', { p_team_id: teamId, p_rows: payload });
    setSaving(false);
    if (error) { webAlert('Import', error.message); return; }
    const n = (data as number) ?? valid.length;
    alertThenGo('Done', `${n} game${n === 1 ? '' : 's'} added to the schedule.`, () => router.replace('/schedule'));
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 60, maxWidth: 620, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
      <TouchableOpacity onPress={goBackOrHome} hitSlop={8} style={styles.back}><Text style={styles.backTxt}>← Cancel</Text></TouchableOpacity>
      <Text style={styles.h1}>Review before adding</Text>
      <Text style={styles.sub}>We read {rows.length} game{rows.length === 1 ? '' : 's'} from your photo. Fix anything that's off, delete rows you don't want, then add them. Nothing saves until you confirm.</Text>

      {rows.map((r, i) => {
        const badDate = !validYMD(r.date);
        return (
          <View key={i} style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.cardNum}>{i + 1}</Text>
              <TouchableOpacity onPress={() => remove(i)} hitSlop={8}><Text style={styles.remove}>Remove</Text></TouchableOpacity>
            </View>
            <Text style={styles.lbl}>Date (YYYY-MM-DD)</Text>
            <TextInput style={[styles.input, badDate && styles.inputBad]} value={r.date} onChangeText={v => set(i, { date: v })} placeholder="2026-09-12" placeholderTextColor="#666" autoCapitalize="none" />
            <View style={styles.two}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lbl}>Time (24h, optional)</Text>
                <TextInput style={styles.input} value={r.time} onChangeText={v => set(i, { time: v })} placeholder="18:00 or blank = TBD" placeholderTextColor="#666" />
              </View>
              <View style={styles.haBox}>
                <Text style={styles.lbl}>{r.home ? 'Home' : 'Away'}</Text>
                <Switch value={r.home} onValueChange={v => set(i, { home: v })} />
              </View>
            </View>
            <Text style={styles.lbl}>Opponent</Text>
            <TextInput style={styles.input} value={r.opponent} onChangeText={v => set(i, { opponent: v })} placeholder="Opponent" placeholderTextColor="#666" />
            <Text style={styles.lbl}>Location</Text>
            <TextInput style={styles.input} value={r.location} onChangeText={v => set(i, { location: v })} placeholder="Field / venue" placeholderTextColor="#666" />
          </View>
        );
      })}

      {rows.length === 0 ? <Text style={styles.empty}>No rows left. Cancel and try another photo.</Text> : null}

      <TouchableOpacity style={[styles.confirm, (saving || rows.length === 0) && { opacity: 0.5 }]} onPress={confirm} disabled={saving || rows.length === 0}>
        <Text style={styles.confirmTxt}>{saving ? 'Adding…' : `Add ${rows.filter(r => validYMD(r.date)).length} game${rows.filter(r => validYMD(r.date)).length === 1 ? '' : 's'} to schedule`}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e1b2c' },
  back: { alignSelf: 'flex-start', paddingVertical: 6 },
  backTxt: { color: '#ff6a2c', fontSize: 14, fontWeight: '700' },
  h1: { color: '#f1f4f6', fontSize: 24, fontWeight: '800', marginTop: 4 },
  sub: { color: '#9db0bd', fontSize: 14, marginTop: 6, marginBottom: 14, lineHeight: 20 },
  card: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 12 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardNum: { color: '#62707e', fontSize: 12, fontWeight: '800' },
  remove: { color: '#c0392b', fontSize: 13, fontWeight: '700' },
  lbl: { color: '#8b7bff', fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 10, marginBottom: 5 },
  input: { backgroundColor: '#0e1b2c', borderColor: '#25333f', borderWidth: 1, borderRadius: 9, color: '#f1f4f6', paddingHorizontal: 11, paddingVertical: 10, fontSize: 15 },
  inputBad: { borderColor: '#c0392b' },
  two: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  haBox: { alignItems: 'center' },
  empty: { color: '#9db0bd', fontSize: 14, textAlign: 'center', marginVertical: 20 },
  confirm: { backgroundColor: '#ff6a2c', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 10 },
  confirmTxt: { color: '#160b02', fontSize: 16, fontWeight: '800' },
});

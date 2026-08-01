// Schedule tab — team's games ordered by date. Tap a game to open its box
// score. Games are split into "Upcoming" (future date or undated) and
// "Completed" (past date or scored) purely for display; the DB doesn't have a
// status column.
//
// Coaches see a "+ Add Game" inline form (matches the Roster tab pattern) —
// creates a games row directly, no video required. Useful for entering past
// games from memory, or scheduling upcoming games for stat entry later.
import { COACH_ROLES, useTeamContext } from '@/context';
import { supabase } from '@/supabase';
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Game = {
  id: string;
  title: string;
  opponent: string | null;
  game_date: string | null;
  team_score: number | null;
  opponent_score: number | null;
};

// Postgres date columns come back as YYYY-MM-DD strings. Split-and-reorder to
// DD/MM/YYYY without ever instantiating a Date object (which would re-introduce
// timezone risk — a coach in Central would see games shift by a day).
function formatDate(ymd: string | null): string {
  if (!ymd) return 'No date';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

// Extract local YYYY-MM-DD from a Date. Never .toISOString() (UTC-shifts).
function dateToLocalYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayYMD(): string { return dateToLocalYMD(new Date()); }

function scoreLabel(g: Game): string | null {
  if (g.team_score == null || g.opponent_score == null) return null;
  const wl = g.team_score === g.opponent_score ? 'T' : g.team_score > g.opponent_score ? 'W' : 'L';
  return `${wl} ${g.team_score}-${g.opponent_score}`;
}

export default function ScheduleScreen() {
  const insets = useSafeAreaInsets();
  const { activeTeam, activeRole } = useTeamContext();
  const isCoach = !!activeRole && COACH_ROLES.includes(activeRole);

  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);

  // Add-game form
  const [showAdd, setShowAdd] = useState(false);
  const [opponent, setOpponent] = useState('');
  const [gameDate, setGameDate] = useState<Date>(new Date());
  const [teamScore, setTeamScore] = useState('');
  const [oppScore, setOppScore] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!activeTeam) { setGames([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from('games')
      .select('id, title, opponent, game_date, team_score, opponent_score')
      .eq('team_id', activeTeam.id)
      .order('game_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    setGames((data ?? []) as Game[]);
    setLoading(false);
  }, [activeTeam]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function openAddForm() {
    setGameDate(new Date());              // reset picker default to today on each open
    setOpponent('');
    setTeamScore('');
    setOppScore('');
    setShowAdd(true);
  }

  function onDateChange(_: DateTimePickerEvent, selected?: Date) {
    if (selected) setGameDate(selected);
  }

  function openAndroidPicker() {
    DateTimePickerAndroid.open({ value: gameDate, mode: 'date', onChange: onDateChange });
  }

  async function saveGame() {
    if (!activeTeam) return;
    const opp = opponent.trim();
    if (!opp) { Alert.alert('Add game', 'Enter an opponent name.'); return; }
    setSaving(true);
    // Coerce optional scores; empty string → null.
    const ts = teamScore.trim() === '' ? null : parseInt(teamScore.trim(), 10);
    const os = oppScore.trim() === '' ? null : parseInt(oppScore.trim(), 10);
    if ((ts != null && Number.isNaN(ts)) || (os != null && Number.isNaN(os))) {
      Alert.alert('Add game', 'Scores must be numbers.'); setSaving(false); return;
    }
    const { error } = await supabase.from('games').insert({
      team_id: activeTeam.id,
      title: `vs ${opp}`,
      opponent: opp,
      game_date: dateToLocalYMD(gameDate),
      team_score: ts,
      opponent_score: os,
    });
    setSaving(false);
    if (error) { Alert.alert('Add game', error.message); return; }
    setShowAdd(false);
    await load();
  }

  if (!activeTeam) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 24, paddingHorizontal: 16 }]}>
        <Text style={styles.empty}>Pick a team to see its schedule.</Text>
      </View>
    );
  }

  const today = todayYMD();
  const isPast = (g: Game) => scoreLabel(g) != null || (g.game_date != null && g.game_date < today);
  const past = games.filter(isPast);
  const upcoming = games.filter(g => !isPast(g));

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>{activeTeam.name}</Text>
      <Text style={styles.subtitle}>Schedule</Text>

      {isCoach && (showAdd ? (
        <View style={styles.addBox}>
          <TextInput
            style={styles.input}
            placeholder="Opponent name"
            placeholderTextColor="#999"
            value={opponent}
            onChangeText={setOpponent}
            autoFocus
            editable={!saving}
          />
          <View style={styles.dateRow}>
            <Text style={styles.dateLabel}>Game date:</Text>
            {Platform.OS === 'ios' ? (
              <DateTimePicker value={gameDate} mode="date" display="compact" onChange={onDateChange} />
            ) : (
              <TouchableOpacity style={styles.dateBtn} onPress={openAndroidPicker} disabled={saving}>
                <Text style={styles.dateBtnText}>{formatDate(dateToLocalYMD(gameDate))}</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.scoreRow}>
            <TextInput
              style={[styles.input, styles.scoreInput]}
              placeholder="Us"
              placeholderTextColor="#999"
              value={teamScore}
              onChangeText={setTeamScore}
              keyboardType="number-pad"
              editable={!saving}
            />
            <Text style={styles.scoreDash}>–</Text>
            <TextInput
              style={[styles.input, styles.scoreInput]}
              placeholder="Them"
              placeholderTextColor="#999"
              value={oppScore}
              onChangeText={setOppScore}
              keyboardType="number-pad"
              editable={!saving}
            />
          </View>
          <View style={styles.addBtns}>
            <TouchableOpacity style={[styles.btn, styles.btnPrimary]} disabled={saving} onPress={saveGame}>
              <Text style={styles.btnPrimaryText}>{saving ? 'Saving…' : 'Save game'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btn} disabled={saving} onPress={() => setShowAdd(false)}>
              <Text style={styles.btnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>No video needed. You can add stats after saving from the game&apos;s box score.</Text>
        </View>
      ) : (
        <TouchableOpacity style={styles.addRow} onPress={openAddForm}>
          <Text style={styles.addRowText}>＋ Add game</Text>
        </TouchableOpacity>
      ))}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 28 }} color="#534AB7" />
      ) : games.length === 0 ? (
        <Text style={styles.empty}>No games yet.{isCoach ? '\nTap “Add game” above.' : ''}</Text>
      ) : (
        <>
          {upcoming.length > 0 && (
            <>
              <Text style={styles.section}>Upcoming</Text>
              {upcoming.map(g => <GameRow key={g.id} game={g} />)}
            </>
          )}
          {past.length > 0 && (
            <>
              <Text style={styles.section}>Completed</Text>
              {past.map(g => <GameRow key={g.id} game={g} />)}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

function GameRow({ game }: { game: Game }) {
  const score = scoreLabel(game);
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => router.push({ pathname: '/box-score', params: { gameId: game.id, title: game.title } })}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{game.title}</Text>
        <Text style={styles.rowMeta}>{formatDate(game.game_date)}</Text>
      </View>
      {score ? <Text style={styles.rowScore}>{score}</Text> : null}
      <Text style={styles.rowArrow}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: '800', color: '#1a1a1a' },
  subtitle: { fontSize: 14, fontWeight: '600', color: '#888', marginBottom: 20 },
  empty: { color: '#888', fontSize: 15, textAlign: 'center', marginTop: 40, lineHeight: 22 },
  section: { fontSize: 12, fontWeight: '800', color: '#888', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 16, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e5e5', gap: 12 },
  rowTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  rowMeta: { fontSize: 12, color: '#999', marginTop: 2 },
  rowScore: { fontSize: 14, fontWeight: '800', color: '#534AB7' },
  rowArrow: { fontSize: 20, color: '#ccc' },

  addRow: { marginBottom: 16, paddingVertical: 14, borderRadius: 10, borderWidth: 1, borderColor: '#534AB7', borderStyle: 'dashed', alignItems: 'center' },
  addRowText: { color: '#534AB7', fontWeight: '700', fontSize: 15 },
  addBox: { marginBottom: 16, backgroundColor: '#fafafa', borderRadius: 12, padding: 14, gap: 10 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#1a1a1a', backgroundColor: '#fff' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dateLabel: { fontSize: 15, color: '#333' },
  dateBtn: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#fff', flex: 1 },
  dateBtnText: { fontSize: 15, color: '#333' },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scoreInput: { flex: 1, textAlign: 'center' },
  scoreDash: { fontSize: 18, fontWeight: '700', color: '#888' },
  addBtns: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', backgroundColor: '#eee' },
  btnText: { fontWeight: '700', color: '#555' },
  btnPrimary: { backgroundColor: '#534AB7' },
  btnPrimaryText: { fontWeight: '700', color: '#fff' },
  hint: { fontSize: 12, color: '#888', lineHeight: 16 },
});

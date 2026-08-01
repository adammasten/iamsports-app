// Schedule tab — team's games ordered by date. Tap a game to open its box
// score. Games are split into "Upcoming" (future date or undated) and
// "Completed" (past date or scored) purely for display; the DB doesn't have a
// status column.
import { useTeamContext } from '@/context';
import { supabase } from '@/supabase';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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

function todayYMD(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function scoreLabel(g: Game): string | null {
  if (g.team_score == null || g.opponent_score == null) return null;
  const wl = g.team_score === g.opponent_score ? 'T' : g.team_score > g.opponent_score ? 'W' : 'L';
  return `${wl} ${g.team_score}-${g.opponent_score}`;
}

export default function ScheduleScreen() {
  const insets = useSafeAreaInsets();
  const { activeTeam } = useTeamContext();
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);

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

  if (!activeTeam) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 24, paddingHorizontal: 16 }]}>
        <Text style={styles.empty}>Pick a team to see its schedule.</Text>
      </View>
    );
  }

  const today = todayYMD();
  // "Completed" if it has a final score, or its date is before today. Everything
  // else is "Upcoming" — including games with no date set at all.
  const isPast = (g: Game) => scoreLabel(g) != null || (g.game_date != null && g.game_date < today);
  const past = games.filter(isPast);
  const upcoming = games.filter(g => !isPast(g));

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 40 }}
    >
      <Text style={styles.title}>{activeTeam.name}</Text>
      <Text style={styles.subtitle}>Schedule</Text>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 28 }} color="#534AB7" />
      ) : games.length === 0 ? (
        <Text style={styles.empty}>No games yet.{'\n'}Add one from the Team tab.</Text>
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
});

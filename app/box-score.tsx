// Box score for a single game. Reads resolved_game_stats (manual-if-any-else-
// derived) and lays out an NCAA-style table with a fixed player column on the
// left and horizontally-scrolling stat columns on the right.
//
// Read-only for now — manual entry / edit UI lands in a follow-up. Empty state
// says so plainly instead of dangling a disabled button.
import { supabase } from '@/supabase';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type StatRow = {
  game_id: string;
  player_id: string | null;   // NULL = TEAM row (unattributed)
  player_name: string;
  stat_side: 'own' | 'opponent';
  fgm: number; fga: number;
  fg3m: number; fg3a: number;
  ftm: number; fta: number;
  oreb: number; dreb: number; reb: number;
  ast: number; tov: number; stl: number; blk: number; pf: number; tf: number;
  pts: number;
  source: 'manual' | 'tagged';
};

type Game = {
  id: string;
  title: string;
  game_date: string | null;
  team_score: number | null;
  opponent_score: number | null;
};

// See schedule.tsx — parse the YYYY-MM-DD string without instantiating Date to
// keep local dates local.
function formatDate(ymd: string | null): string {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

function ma(m: number, a: number): string {
  return `${m}-${a}`;
}

export default function BoxScoreScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const gameId = Array.isArray(params.gameId) ? params.gameId[0] : params.gameId;
  const paramTitle = Array.isArray(params.title) ? params.title[0] : params.title;

  const [game, setGame] = useState<Game | null>(null);
  const [rows, setRows] = useState<StatRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: gameData }, { data: statRows }] = await Promise.all([
        supabase.from('games').select('id, title, game_date, team_score, opponent_score').eq('id', gameId).maybeSingle(),
        supabase.from('resolved_game_stats').select('*').eq('game_id', gameId),
      ]);
      if (cancelled) return;
      setGame(gameData as Game | null);
      setRows((statRows ?? []) as StatRow[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [gameId]);

  const ownRows = rows.filter(r => r.stat_side === 'own').sort(sortRows);
  const oppRows = rows.filter(r => r.stat_side === 'opponent').sort(sortRows);
  // All rows in one game share a source per the override-per-game model.
  const source = rows[0]?.source ?? null;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.title} numberOfLines={1}>{game?.title ?? paramTitle ?? 'Box score'}</Text>
      {game?.game_date ? <Text style={styles.date}>{formatDate(game.game_date)}</Text> : null}
      {(game?.team_score != null && game?.opponent_score != null) ? (
        <Text style={styles.score}>{game.team_score} – {game.opponent_score}</Text>
      ) : null}
      {source ? (
        <Text style={styles.sourceLabel}>
          {source === 'tagged' ? '📊 From tagged clips' : '✏️ Manually entered'}
        </Text>
      ) : null}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#534AB7" />
      ) : rows.length === 0 ? (
        <Text style={styles.empty}>
          No stats for this game yet.{'\n'}
          Tag clips to build the box score, or manual entry is coming next.
        </Text>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }}>
          {ownRows.length > 0 && (
            <>
              <Text style={styles.section}>Team</Text>
              <StatTable rows={ownRows} />
            </>
          )}
          {oppRows.length > 0 && (
            <>
              <Text style={styles.section}>Opponent</Text>
              <StatTable rows={oppRows} />
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// TEAM row sinks to the bottom, everyone else alphabetical. NCAA box scores
// convention is players first then aggregate rows.
function sortRows(a: StatRow, b: StatRow): number {
  if (a.player_name === 'TEAM' && b.player_name !== 'TEAM') return 1;
  if (a.player_name !== 'TEAM' && b.player_name === 'TEAM') return -1;
  return a.player_name.localeCompare(b.player_name);
}

const COLS: Array<{ key: string; label: string; w: number }> = [
  { key: 'pts', label: 'PTS', w: 44 },
  { key: 'fg',  label: 'FG',  w: 56 },
  { key: 'fg3', label: '3FG', w: 56 },
  { key: 'ft',  label: 'FT',  w: 56 },
  { key: 'reb', label: 'REB', w: 44 },
  { key: 'ast', label: 'AST', w: 44 },
  { key: 'stl', label: 'STL', w: 44 },
  { key: 'blk', label: 'BLK', w: 44 },
  { key: 'tov', label: 'TO',  w: 44 },
  { key: 'pf',  label: 'PF',  w: 44 },
];

function cellValue(row: StatRow, key: string): string {
  switch (key) {
    case 'pts': return String(row.pts);
    case 'fg':  return ma(row.fgm, row.fga);
    case 'fg3': return ma(row.fg3m, row.fg3a);
    case 'ft':  return ma(row.ftm, row.fta);
    case 'reb': return String(row.reb);
    case 'ast': return String(row.ast);
    case 'stl': return String(row.stl);
    case 'blk': return String(row.blk);
    case 'tov': return String(row.tov);
    case 'pf':  return String(row.pf);
    default: return '';
  }
}

function StatTable({ rows }: { rows: StatRow[] }) {
  return (
    <View style={styles.tableWrap}>
      <View style={styles.fixedCol}>
        <View style={styles.headerCell}><Text style={styles.playerHeader}>PLAYER</Text></View>
        {rows.map(r => (
          <View key={r.player_id ?? 'team'} style={styles.rowCell}>
            <Text style={styles.playerName} numberOfLines={1}>{r.player_name}</Text>
          </View>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row' }}>
        {COLS.map(col => (
          <View key={col.key} style={[styles.statCol, { width: col.w }]}>
            <View style={styles.headerCell}><Text style={styles.statHeader}>{col.label}</Text></View>
            {rows.map(r => (
              <View key={`${r.player_id ?? 'team'}-${col.key}`} style={styles.rowCell}>
                <Text style={styles.statCell}>{cellValue(r, col.key)}</Text>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 16 },
  header: { marginBottom: 8 },
  back: { color: '#534AB7', fontSize: 16, fontWeight: '600' },
  title: { fontSize: 22, fontWeight: '800', color: '#1a1a1a' },
  date: { fontSize: 13, color: '#888', marginTop: 2 },
  score: { fontSize: 24, fontWeight: '800', color: '#1a1a1a', marginTop: 6 },
  sourceLabel: { fontSize: 12, color: '#888', marginTop: 4, marginBottom: 8 },
  empty: { color: '#888', fontSize: 15, textAlign: 'center', marginTop: 40, lineHeight: 22 },
  section: { fontSize: 12, fontWeight: '800', color: '#888', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 16, marginBottom: 8 },
  tableWrap: { flexDirection: 'row' },
  fixedCol: { minWidth: 120, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: '#e5e5e5', backgroundColor: '#fff' },
  statCol: { alignItems: 'center' },
  headerCell: { height: 36, justifyContent: 'center', alignItems: 'center' },
  rowCell: { height: 36, justifyContent: 'center', paddingHorizontal: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#f0f0f0' },
  playerHeader: { fontSize: 11, fontWeight: '800', color: '#888', letterSpacing: 0.5 },
  statHeader: { fontSize: 11, fontWeight: '800', color: '#888', letterSpacing: 0.5 },
  playerName: { fontSize: 14, fontWeight: '700', color: '#1a1a1a' },
  statCell: { fontSize: 14, color: '#333', textAlign: 'center' },
});

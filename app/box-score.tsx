// Box score for a single game. Reads resolved_game_stats (Model D — per-row
// override) and lays out an NCAA-style table with a fixed player column on
// the left and horizontally-scrolling stat columns on the right.
//
// Two modes:
//   VIEW  — default; anyone with read access sees resolved rows only.
//   EDIT  — coach-only toggle (top-right); fetches roster, merges with
//           resolved rows so every player is tappable (even those with no
//           stats yet). Tap opens the per-player editor sheet.
//
// Each row shows a source badge (📊 tagged / ✏️ manual) so a coach can see
// at a glance which values are derived and which are hand-entered.
// "Revert all manual entries" wipes every game_stat_lines row for this game
// (the whole game falls back to tagged / empty).
import { COACH_ROLES, useTeamContext } from '@/context';
import { supabase } from '@/supabase';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatEditorSheet, type EditorTarget, type StatValues } from './components/StatEditorSheet';

type StatRow = {
  game_id: string;
  player_id: string | null;
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
  team_id: string;
  title: string;
  game_date: string | null;
  team_score: number | null;
  opponent_score: number | null;
};

type RosterEntry = { playerId: string; name: string; jersey: string | null };

function formatDate(ymd: string | null): string {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

function ma(m: number, a: number): string { return `${m}-${a}`; }

const ZERO_VALUES: StatValues = {
  fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0,
  oreb: 0, dreb: 0, ast: 0, tov: 0, stl: 0, blk: 0, pf: 0, tf: 0,
};

function statValuesFromRow(r: StatRow): StatValues {
  return {
    fgm: r.fgm, fga: r.fga, fg3m: r.fg3m, fg3a: r.fg3a,
    ftm: r.ftm, fta: r.fta, oreb: r.oreb, dreb: r.dreb,
    ast: r.ast, tov: r.tov, stl: r.stl, blk: r.blk,
    pf: r.pf, tf: r.tf,
  };
}

// Merge resolved rows with roster (edit mode only). For each roster player who
// isn't already in the resolved list, add a zero-row so the coach can tap and
// enter stats. Also guarantees a TEAM row on 'own' side (always tappable) and
// on the opponent side (opponent stats live on this synthetic TEAM row —
// there's no per-opponent-player entry).
function buildEditRows(resolved: StatRow[], roster: RosterEntry[], gameId: string): { own: DisplayRow[]; opp: DisplayRow[] } {
  const ownById = new Map<string, StatRow>();
  const ownTeam = resolved.find(r => r.stat_side === 'own' && r.player_id === null) ?? null;
  const oppTeam = resolved.find(r => r.stat_side === 'opponent' && r.player_id === null) ?? null;
  resolved.filter(r => r.stat_side === 'own' && r.player_id != null).forEach(r => ownById.set(r.player_id!, r));

  const ownRows: DisplayRow[] = roster.map(p => {
    const r = ownById.get(p.playerId);
    return r
      ? toDisplay(r, p.jersey)
      : { key: p.playerId, gameId, playerId: p.playerId, playerName: p.name, jersey: p.jersey, side: 'own', values: ZERO_VALUES, pts: 0, source: null };
  });
  // TEAM row (own): always present, tappable
  ownRows.push(
    ownTeam
      ? toDisplay(ownTeam, null)
      : { key: 'own-team', gameId, playerId: null, playerName: 'TEAM', jersey: null, side: 'own', values: ZERO_VALUES, pts: 0, source: null }
  );

  // Opponent: TEAM row only (no per-opponent-player tracking).
  const oppRows: DisplayRow[] = [
    oppTeam
      ? toDisplay(oppTeam, null)
      : { key: 'opp-team', gameId, playerId: null, playerName: 'OPPONENT', jersey: null, side: 'opponent', values: ZERO_VALUES, pts: 0, source: null },
  ];
  // Rename the OPPONENT TEAM row for clarity in edit mode
  if (oppTeam) oppRows[0] = { ...oppRows[0], playerName: 'OPPONENT' };

  return { own: ownRows, opp: oppRows };
}

// View-mode rows come straight from resolved. Sort TEAM last, others alphabetical.
function buildViewRows(resolved: StatRow[]): { own: DisplayRow[]; opp: DisplayRow[] } {
  const sorter = (a: DisplayRow, b: DisplayRow) => {
    if (a.playerName === 'TEAM' && b.playerName !== 'TEAM') return 1;
    if (a.playerName !== 'TEAM' && b.playerName === 'TEAM') return -1;
    return a.playerName.localeCompare(b.playerName);
  };
  const own = resolved.filter(r => r.stat_side === 'own').map(r => toDisplay(r, null)).sort(sorter);
  const opp = resolved.filter(r => r.stat_side === 'opponent').map(r => toDisplay(r, null)).sort(sorter);
  // Rename OPPONENT TEAM row
  const oppRenamed = opp.map(r => r.playerName === 'TEAM' ? { ...r, playerName: 'OPPONENT' } : r);
  return { own, opp: oppRenamed };
}

type DisplayRow = {
  key: string;
  gameId: string;
  playerId: string | null;
  playerName: string;
  jersey: string | null;
  side: 'own' | 'opponent';
  values: StatValues;
  pts: number;
  source: 'manual' | 'tagged' | null;      // null = no stats yet (edit-mode zero row)
};

function toDisplay(r: StatRow, jersey: string | null): DisplayRow {
  return {
    key: `${r.stat_side}-${r.player_id ?? 'team'}`,
    gameId: r.game_id,
    playerId: r.player_id,
    playerName: r.player_name,
    jersey,
    side: r.stat_side,
    values: statValuesFromRow(r),
    pts: r.pts,
    source: r.source,
  };
}

export default function BoxScoreScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const gameId = Array.isArray(params.gameId) ? params.gameId[0] : params.gameId;
  const paramTitle = Array.isArray(params.title) ? params.title[0] : params.title;
  const { activeTeam, activeRole, userId } = useTeamContext();

  const [game, setGame] = useState<Game | null>(null);
  const [rows, setRows] = useState<StatRow[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editing, setEditing] = useState<EditorTarget | null>(null);

  // Coach check: activeRole is scoped to activeTeam. If this game belongs to a
  // different team, the Edit toggle is hidden — coaches only manage their own.
  const isCoachOfGameTeam = !!activeRole
    && COACH_ROLES.includes(activeRole)
    && !!game
    && !!activeTeam
    && activeTeam.id === game.team_id;

  const loadStats = useCallback(async () => {
    if (!gameId) return;
    const { data } = await supabase.from('resolved_game_stats').select('*').eq('game_id', gameId);
    setRows((data ?? []) as StatRow[]);
  }, [gameId]);

  const loadRoster = useCallback(async (teamId: string) => {
    const { data } = await supabase
      .from('player_teams')
      .select('player_id, jersey_number, players ( id, name )')
      .eq('team_id', teamId)
      .is('left_at', null);
    const list: RosterEntry[] = ((data ?? []) as any[])
      .filter(r => r.players)
      .map(r => ({ playerId: r.player_id, name: r.players.name ?? 'Unnamed', jersey: r.jersey_number ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
    setRoster(list);
  }, []);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: gameData } = await supabase
        .from('games').select('id, team_id, title, game_date, team_score, opponent_score')
        .eq('id', gameId).maybeSingle();
      if (cancelled) return;
      setGame(gameData as Game | null);
      await loadStats();
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [gameId, loadStats]);

  // Roster is only needed in edit mode. Fetch once when we flip in.
  useEffect(() => {
    if (editMode && game?.team_id && roster.length === 0) {
      loadRoster(game.team_id);
    }
  }, [editMode, game?.team_id, roster.length, loadRoster]);

  const hasAnyManual = rows.some(r => r.source === 'manual');

  function openEditorForRow(row: DisplayRow) {
    setEditing({
      gameId: row.gameId,
      playerId: row.playerId,
      playerName: row.playerName,
      jersey: row.jersey,
      statSide: row.side,
      initial: row.values,
      isManual: row.source === 'manual',
    });
  }

  async function onSheetSaved() {
    setEditing(null);
    await loadStats();
  }

  function confirmRevertAll() {
    Alert.alert(
      'Revert all manual entries?',
      'Every hand-entered stat line for this game will be removed. If the game has tagged clips, tagged stats will show again.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Revert all', style: 'destructive', onPress: async () => {
          if (!gameId) return;
          const { error } = await supabase.from('game_stat_lines').delete().eq('game_id', gameId);
          if (error) { Alert.alert('Revert failed', error.message); return; }
          await loadStats();
        }},
      ]
    );
  }

  const { own, opp } = editMode
    ? buildEditRows(rows, roster, gameId ?? '')
    : buildViewRows(rows);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        {isCoachOfGameTeam && (
          <View style={styles.headerRight}>
            {editMode && hasAnyManual && (
              <TouchableOpacity onPress={confirmRevertAll}>
                <Text style={styles.revertAll}>Revert all</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => setEditMode(v => !v)}>
              <Text style={styles.editToggle}>{editMode ? 'Done' : 'Edit'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <Text style={styles.title} numberOfLines={1}>{game?.title ?? paramTitle ?? 'Box score'}</Text>
      {game?.game_date ? <Text style={styles.date}>{formatDate(game.game_date)}</Text> : null}
      {(game?.team_score != null && game?.opponent_score != null) ? (
        <Text style={styles.score}>{game.team_score} – {game.opponent_score}</Text>
      ) : null}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#534AB7" />
      ) : !editMode && rows.length === 0 ? (
        <Text style={styles.empty}>
          No stats for this game yet.{'\n'}
          {isCoachOfGameTeam ? 'Tap Edit to enter a box score, or tag clips.' : 'Tag clips to build the box score.'}
        </Text>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }}>
          {own.length > 0 && (
            <>
              <Text style={styles.section}>Team</Text>
              <StatTable rows={own} editMode={editMode} onTap={openEditorForRow} />
            </>
          )}
          {opp.length > 0 && (
            <>
              <Text style={styles.section}>Opponent</Text>
              <StatTable rows={opp} editMode={editMode} onTap={openEditorForRow} />
            </>
          )}
        </ScrollView>
      )}

      <StatEditorSheet target={editing} userId={userId} onClose={() => setEditing(null)} onSaved={onSheetSaved} />
    </View>
  );
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

function cellValue(row: DisplayRow, key: string): string {
  const v = row.values;
  switch (key) {
    case 'pts': return String(row.pts);
    case 'fg':  return ma(v.fgm, v.fga);
    case 'fg3': return ma(v.fg3m, v.fg3a);
    case 'ft':  return ma(v.ftm, v.fta);
    case 'reb': return String(v.oreb + v.dreb);
    case 'ast': return String(v.ast);
    case 'stl': return String(v.stl);
    case 'blk': return String(v.blk);
    case 'tov': return String(v.tov);
    case 'pf':  return String(v.pf);
    default: return '';
  }
}

function sourceBadge(source: DisplayRow['source']): string {
  if (source === 'manual') return '✏️';
  if (source === 'tagged') return '📊';
  return '';
}

function StatTable({ rows, editMode, onTap }: { rows: DisplayRow[]; editMode: boolean; onTap: (r: DisplayRow) => void }) {
  return (
    <View style={styles.tableWrap}>
      <View style={styles.fixedCol}>
        <View style={styles.headerCell}><Text style={styles.playerHeader}>PLAYER</Text></View>
        {rows.map(r => {
          const inner = (
            <View style={styles.playerCellInner}>
              <Text style={styles.playerName} numberOfLines={1}>{r.playerName}</Text>
              {r.source ? <Text style={styles.badge}>{sourceBadge(r.source)}</Text> : null}
            </View>
          );
          return editMode ? (
            <TouchableOpacity key={r.key} style={[styles.rowCell, styles.editableRow]} onPress={() => onTap(r)}>
              {inner}
            </TouchableOpacity>
          ) : (
            <View key={r.key} style={styles.rowCell}>{inner}</View>
          );
        })}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row' }}>
        {COLS.map(col => (
          <View key={col.key} style={[styles.statCol, { width: col.w }]}>
            <View style={styles.headerCell}><Text style={styles.statHeader}>{col.label}</Text></View>
            {rows.map(r => (
              <View key={`${r.key}-${col.key}`} style={styles.rowCell}>
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
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  back: { color: '#534AB7', fontSize: 16, fontWeight: '600' },
  editToggle: { color: '#534AB7', fontSize: 15, fontWeight: '700' },
  revertAll: { color: '#c0392b', fontSize: 14, fontWeight: '700' },
  title: { fontSize: 22, fontWeight: '800', color: '#1a1a1a' },
  date: { fontSize: 13, color: '#888', marginTop: 2 },
  score: { fontSize: 24, fontWeight: '800', color: '#1a1a1a', marginTop: 6 },
  empty: { color: '#888', fontSize: 15, textAlign: 'center', marginTop: 40, lineHeight: 22 },
  section: { fontSize: 12, fontWeight: '800', color: '#888', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 16, marginBottom: 8 },
  tableWrap: { flexDirection: 'row' },
  fixedCol: { minWidth: 140, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: '#e5e5e5', backgroundColor: '#fff' },
  statCol: { alignItems: 'center' },
  headerCell: { height: 36, justifyContent: 'center', alignItems: 'center' },
  rowCell: { height: 36, justifyContent: 'center', paddingHorizontal: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#f0f0f0' },
  editableRow: { backgroundColor: '#fbfaff' },
  playerHeader: { fontSize: 11, fontWeight: '800', color: '#888', letterSpacing: 0.5 },
  statHeader: { fontSize: 11, fontWeight: '800', color: '#888', letterSpacing: 0.5 },
  playerCellInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  playerName: { fontSize: 14, fontWeight: '700', color: '#1a1a1a', flexShrink: 1 },
  badge: { fontSize: 12 },
  statCell: { fontSize: 14, color: '#333', textAlign: 'center' },
});

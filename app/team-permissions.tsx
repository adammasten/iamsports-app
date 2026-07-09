import { COACH_ROLES, useTeamContext } from '@/context';
import { PERMISSIONS, resolvePermission, type PermissionKey, type PermissionMeta } from '@/lib/core/permissions';
import { supabase } from '@/supabase';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Player = { player_id: string; name: string };
// Per-player overrides: player_id -> (permission -> allowed). Absent = inherit.
type Overrides = Record<string, Partial<Record<PermissionKey, boolean>>>;
type TeamData = {
  players: Player[];
  defaults: Partial<Record<PermissionKey, boolean>>;   // team_permission_defaults
  overrides: Overrides;                                 // team_player_permissions
  loading: boolean;
};

export default function TeamPermissionsScreen() {
  const { teamId: paramTeamId } = useLocalSearchParams<{ teamId?: string }>();
  const { userTeams } = useTeamContext();

  const coachTeams = Array.from(
    new Map(userTeams.filter(t => COACH_ROLES.includes(t.role)).map(t => [t.team_id, t])).values(),
  );

  const [data, setData] = useState<Record<string, TeamData>>({});
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(paramTeamId ? [paramTeamId] : coachTeams.slice(0, 1).map(t => t.team_id)),
  );

  useEffect(() => {
    coachTeams.forEach(t => loadTeam(t.team_id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userTeams]);

  async function loadTeam(teamId: string) {
    setData(d => ({ ...d, [teamId]: { players: [], defaults: {}, overrides: {}, loading: true } }));
    const [{ data: pt }, { data: def }, { data: ov }] = await Promise.all([
      supabase.from('player_teams').select('player_id, players ( id, name )').eq('team_id', teamId),
      supabase.from('team_permission_defaults').select('permission, allowed').eq('team_id', teamId),
      supabase.from('team_player_permissions').select('player_id, permission, allowed').eq('team_id', teamId),
    ]);
    const players: Player[] = (pt || [])
      .map((r: any) => ({ player_id: r.player_id, name: r.players?.name ?? 'Unnamed player' }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const defaults: Partial<Record<PermissionKey, boolean>> = {};
    (def || []).forEach((r: any) => { defaults[r.permission as PermissionKey] = r.allowed; });
    const overrides: Overrides = {};
    (ov || []).forEach((r: any) => {
      (overrides[r.player_id] ??= {})[r.permission as PermissionKey] = r.allowed;
    });
    setData(d => ({ ...d, [teamId]: { players, defaults, overrides, loading: false } }));
  }

  function toggleExpanded(teamId: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId); else next.add(teamId);
      return next;
    });
  }

  // Local optimistic writers (also used to revert on error).
  function applyOverride(teamId: string, playerId: string, key: PermissionKey, value: boolean | undefined) {
    setData(d => {
      const t = d[teamId]; if (!t) return d;
      const ov = { ...t.overrides };
      const row = { ...(ov[playerId] || {}) };
      if (value === undefined) delete row[key]; else row[key] = value;
      ov[playerId] = row;
      return { ...d, [teamId]: { ...t, overrides: ov } };
    });
  }
  function applyDefault(teamId: string, key: PermissionKey, value: boolean) {
    setData(d => {
      const t = d[teamId]; if (!t) return d;
      return { ...d, [teamId]: { ...t, defaults: { ...t.defaults, [key]: value } } };
    });
  }

  // Confirm on the risky changes only: REMOVING an ability (new value OFF), or
  // GRANTING a dangerous one (Delete content / Manage roster). Low-risk grants
  // (turning a normal permission ON) go through silently.
  function needsConfirm(next: boolean, meta: PermissionMeta): boolean {
    return next === false || (next === true && meta.dangerous);
  }

  // Plain-language confirm, then run() on Confirm.
  function confirmChange(meta: PermissionMeta, who: string, next: boolean, run: () => void) {
    const title = next ? `Grant “${meta.label}”?` : `Turn off “${meta.label}”?`;
    const message = next
      ? `${who} will be able to ${meta.action}.`
      : `${who} won’t be able to ${meta.action}.`;
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: next ? 'Grant' : 'Turn off', style: 'destructive', onPress: run },
    ]);
  }

  // Tap a PLAYER cell: toggle. If the new value equals the team default, CLEAR the
  // override (stay sparse); otherwise write it. Optimistic, reverts on error.
  function togglePlayer(teamId: string, playerId: string, key: PermissionKey) {
    const t = data[teamId]; if (!t) return;
    const meta = PERMISSIONS.find(p => p.key === key)!;
    const prev = t.overrides[playerId]?.[key];                          // may be undefined
    const cur = resolvePermission(meta, prev, t.defaults[key]);
    const next = !cur;
    const inherited = resolvePermission(meta, undefined, t.defaults[key]);
    const clear = next === inherited;
    const who = t.players.find(p => p.player_id === playerId)?.name ?? 'this player';

    const commit = async () => {
      applyOverride(teamId, playerId, key, clear ? undefined : next);   // optimistic
      const { error } = clear
        ? await supabase.rpc('clear_team_player_permission', { p_team_id: teamId, p_player_id: playerId, p_permission: key })
        : await supabase.rpc('set_team_player_permission', { p_team_id: teamId, p_player_id: playerId, p_permission: key, p_allowed: next });
      if (error) {
        applyOverride(teamId, playerId, key, prev);                     // revert
        Alert.alert('Could not save', error.message);
      }
    };

    if (needsConfirm(next, meta)) confirmChange(meta, who, next, commit);
    else commit();
  }

  // Tap the "All players (default)" cell: set the team-wide default.
  function toggleDefault(teamId: string, key: PermissionKey) {
    const t = data[teamId]; if (!t) return;
    const meta = PERMISSIONS.find(p => p.key === key)!;
    const prev = t.defaults[key];                                       // may be undefined
    const cur = resolvePermission(meta, undefined, prev);
    const next = !cur;

    const commit = async () => {
      applyDefault(teamId, key, next);                                  // optimistic
      const { error } = await supabase.rpc('set_team_default_permission', { p_team_id: teamId, p_permission: key, p_allowed: next });
      if (error) {
        applyDefault(teamId, key, prev ?? meta.systemDefault);          // revert (best-effort)
        Alert.alert('Could not save', error.message);
      }
    };

    if (needsConfirm(next, meta)) confirmChange(meta, 'All players', next, commit);
    else commit();
  }

  // A single on/off cell. `explicit` = an override/default row explicitly stored
  // (ringed), vs inherited (plain). Tappable when onPress is given.
  function Cell({ on, explicit, onPress }: { on: boolean; explicit?: boolean; onPress?: () => void }) {
    const dot = <View style={[styles.dot, on ? styles.dotOn : styles.dotOff, explicit && styles.dotExplicit]} />;
    return onPress
      ? <TouchableOpacity style={styles.cell} onPress={onPress}>{dot}</TouchableOpacity>
      : <View style={styles.cell}>{dot}</View>;
  }

  function TeamGrid({ teamId }: { teamId: string }) {
    const td = data[teamId];
    if (!td || td.loading) return <ActivityIndicator color="#534AB7" style={{ marginVertical: 20 }} />;

    const overrideCount = Object.values(td.overrides).reduce((n, r) => n + Object.keys(r).length, 0);

    return (
      <View>
        {__DEV__ ? (
          <Text style={styles.debug}>
            {td.players.length} players · {Object.keys(td.defaults).length} defaults · {overrideCount} overrides · tap to toggle
          </Text>
        ) : null}

        <View style={styles.legend}>
          {PERMISSIONS.map(p => (
            <Text key={p.key} style={styles.legendItem}>
              <Text style={styles.legendName}>{p.short}</Text>  {p.label} — {p.description}
            </Text>
          ))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.gridInner}>
          <View>
            {/* Header */}
            <View style={styles.row}>
              <View style={styles.rowLabelCol} />
              {PERMISSIONS.map(p => (
                <View key={p.key} style={styles.cell}><Text style={styles.colHead}>{p.short}</Text></View>
              ))}
            </View>

            {/* Team-wide default row */}
            <View style={[styles.row, styles.rowEmphasize]}>
              <View style={styles.rowLabelCol}>
                <Text style={styles.rowLabelEmphasize} numberOfLines={1}>All players (default)</Text>
              </View>
              {PERMISSIONS.map(p => (
                <Cell
                  key={p.key}
                  on={resolvePermission(p, undefined, td.defaults[p.key])}
                  explicit={td.defaults[p.key] !== undefined}
                  onPress={() => toggleDefault(teamId, p.key)}
                />
              ))}
            </View>

            {/* One row per player */}
            {td.players.length === 0 ? (
              <Text style={styles.empty}>No players on this team yet.</Text>
            ) : (
              td.players.map(pl => (
                <View key={pl.player_id} style={styles.row}>
                  <View style={styles.rowLabelCol}>
                    <Text style={styles.rowLabel} numberOfLines={1}>{pl.name}</Text>
                  </View>
                  {PERMISSIONS.map(p => {
                    const ov = td.overrides[pl.player_id]?.[p.key];
                    return (
                      <Cell
                        key={p.key}
                        on={resolvePermission(p, ov, td.defaults[p.key])}
                        explicit={ov !== undefined}
                        onPress={() => togglePlayer(teamId, pl.player_id, p.key)}
                      />
                    );
                  })}
                </View>
              ))
            )}
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <View />
      </View>
      <Text style={styles.heading}>Team permissions</Text>
      <Text style={styles.subtitle}>Tap a cell to change it. ● on · ○ off · ringed = set here (vs inherited).</Text>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {coachTeams.length === 0 ? (
          <Text style={styles.empty}>You don’t coach any teams.</Text>
        ) : (
          coachTeams.map(t => {
            const open = expanded.has(t.team_id);
            return (
              <View key={t.team_id} style={styles.section}>
                <TouchableOpacity style={styles.sectionHead} onPress={() => toggleExpanded(t.team_id)}>
                  <Text style={styles.sectionTitle}>{t.name}</Text>
                  <Text style={styles.chevron}>{open ? '▾' : '▸'}</Text>
                </TouchableOpacity>
                {open ? <TeamGrid teamId={t.team_id} /> : null}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const CELL_W = 44;
const LABEL_W = 150;

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 60, backgroundColor: '#000' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  back: { color: '#534AB7', fontSize: 15, fontWeight: '600' },
  heading: { color: '#fff', fontSize: 26, fontWeight: '700', letterSpacing: -0.3 },
  subtitle: { color: '#888', fontSize: 13, lineHeight: 18, marginTop: 4, marginBottom: 14 },
  debug: { color: '#ffe680', fontSize: 11, fontFamily: 'Courier', marginBottom: 8 },

  section: { marginBottom: 18, borderWidth: 1, borderColor: '#333', borderRadius: 10, overflow: 'hidden' },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1a1a1a', padding: 14 },
  sectionTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  chevron: { color: '#888', fontSize: 16 },

  legend: { paddingHorizontal: 14, paddingTop: 12, gap: 4 },
  legendItem: { color: '#aaa', fontSize: 12, lineHeight: 17 },
  legendName: { color: '#fff', fontWeight: '700' },

  gridInner: { padding: 14 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  rowEmphasize: { backgroundColor: '#161326', borderRadius: 6 },
  rowLabelCol: { width: LABEL_W, paddingRight: 8, justifyContent: 'center' },
  rowLabel: { color: '#ddd', fontSize: 13 },
  rowLabelEmphasize: { color: '#fff', fontWeight: '700', fontSize: 13 },
  colHead: { color: '#888', fontSize: 11, fontWeight: '700', textAlign: 'center' },

  cell: { width: CELL_W, alignItems: 'center', justifyContent: 'center', paddingVertical: 6 },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2 },
  dotOn: { backgroundColor: '#1D9E75', borderColor: '#1D9E75' },
  dotOff: { backgroundColor: 'transparent', borderColor: '#555' },
  dotExplicit: { borderColor: '#fff' },

  empty: { color: '#666', fontSize: 14, textAlign: 'center', padding: 20 },
});

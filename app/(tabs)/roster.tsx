import { COACH_ROLES, useTeamContext } from '@/context';
import { supabase } from '@/supabase';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// The team Roster tab. Coaches manage the roster (hold spots, share the team
// join code + each player's guardian code, remove unclaimed spots). Parents who
// are members see the roster read-only and can fix their own kid's name — but no
// codes for other kids (RLS hides them) and no permissions/coach tools.
type RosterPlayer = {
  playerId: string;
  name: string;
  jersey: string | null;
  guardianCount: number;
  isMine: boolean;
};

export default function RosterScreen() {
  const insets = useSafeAreaInsets();
  const { activeTeam, activeRole, userId } = useTeamContext();
  const isCoach = !!activeRole && COACH_ROLES.includes(activeRole);

  const [players, setPlayers] = useState<RosterPlayer[]>([]);
  const [teamCode, setTeamCode] = useState<string | null>(null);
  const [dupes, setDupes] = useState<{ keep_id: string; keep_name: string; dup_id: string; dup_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newJersey, setNewJersey] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const load = useCallback(async () => {
    if (!activeTeam) { setPlayers([]); setTeamCode(null); setLoading(false); return; }
    setLoading(true);
    const teamId = activeTeam.id;

    const { data: team } = await supabase.from('teams').select('join_code').eq('id', teamId).maybeSingle();
    setTeamCode(team?.join_code ?? null);

    const { data: pt } = await supabase
      .from('player_teams')
      .select('player_id, jersey_number, players ( id, name )')
      .eq('team_id', teamId);
    const rows = (pt || []) as any[];
    const ids = rows.map(r => r.player_id);

    const countById = new Map<string, number>();
    const mine = new Set<string>();
    if (ids.length) {
      // Guardian counts: RLS returns rows the user may read (coach → all team
      // players; parent → own kid), so counts are accurate where we show them.
      const { data: links } = await supabase
        .from('parent_player_links').select('player_id, parent_user_id').in('player_id', ids);
      (links || []).forEach((l: any) => {
        countById.set(l.player_id, (countById.get(l.player_id) ?? 0) + 1);
        if (l.parent_user_id === userId) mine.add(l.player_id);
      });
    }

    setPlayers(rows
      .map(r => ({
        playerId: r.player_id,
        name: r.players?.name ?? 'Unnamed',
        jersey: r.jersey_number ?? null,
        guardianCount: countById.get(r.player_id) ?? 0,
        isMine: mine.has(r.player_id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)));

    // Coach-only: possible-duplicate suggestions (RPC is coach-gated; a non-coach
    // just gets an error → empty list).
    const { data: d } = await supabase.rpc('suggest_duplicate_players', { p_team_id: teamId });
    setDupes((d as any[]) ?? []);
    setLoading(false);
  }, [activeTeam, userId]);

  function mergeDupe(d: { keep_id: string; keep_name: string; dup_id: string; dup_name: string }) {
    Alert.alert(
      'Merge players',
      `“${d.keep_name}” and “${d.dup_name}” might be the same player. Which name should stay?`,
      [
        { text: `Keep ${d.keep_name}`, onPress: () => doMerge(d.keep_id, d.dup_id) },
        { text: `Keep ${d.dup_name}`, onPress: () => doMerge(d.dup_id, d.keep_id) },
        { text: 'Not duplicates', style: 'cancel' },
      ],
    );
  }
  async function doMerge(keep: string, dup: string) {
    const { error } = await supabase.rpc('merge_players', { p_keep: keep, p_dup: dup });
    if (error) { Alert.alert('Merge', error.message); return; }
    load();
  }

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function addPlayer() {
    if (!activeTeam) return;
    if (!newName.trim() && !newJersey.trim()) { Alert.alert('Add player', 'Enter a name or a jersey number.'); return; }
    setBusy(true);
    const { error } = await supabase.rpc('create_roster_placeholder', {
      p_team_id: activeTeam.id, p_name: newName.trim() || null, p_jersey: newJersey.trim() || null,
    });
    setBusy(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setNewName(''); setNewJersey(''); setShowAdd(false);
    load();
  }

  async function saveEdit(playerId: string) {
    const next = editName.trim();
    setEditingId(null);
    if (!next) return;
    const { error } = await supabase.rpc('update_kid_profile', { p_player_id: playerId, p_name: next });
    if (error) { Alert.alert('Error', error.message); return; }
    load();
  }

  function removePlaceholder(p: RosterPlayer) {
    Alert.alert('Remove spot', `Remove “${p.name}” from the roster? This can’t be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('players').delete().eq('id', p.playerId);
        if (error) { Alert.alert('Error', error.message); return; }
        load();
      } },
    ]);
  }

  const shareCode = (label: string, code: string) => Share.share({ message: `${label}: ${code}` });

  function resetTeamCode() {
    if (!activeTeam) return;
    Alert.alert(
      'Reset team code?',
      'The current code stops working immediately. Anyone who has the old one can’t join until you share the new code.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: async () => {
          const { data, error } = await supabase.rpc('regenerate_team_code', { p_team_id: activeTeam.id });
          if (error) { Alert.alert('Reset', error.message); return; }
          setTeamCode(data as string);
        } },
      ],
    );
  }

  if (!activeTeam) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.empty}>Pick a team from Home to see its roster.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 40 }}>
      <Text style={styles.title}>{activeTeam.name}</Text>
      <Text style={styles.subtitle}>Roster</Text>

      {isCoach && teamCode && (
        <View style={styles.codeCard}>
          <Text style={styles.codeCardLabel}>Team join code</Text>
          <View style={styles.codeRow}>
            <Text style={styles.codeBig}>{teamCode}</Text>
            <View style={styles.codeBtns}>
              <TouchableOpacity style={styles.shareBtn} onPress={() => shareCode(`Join ${activeTeam.name} on IamSports`, teamCode)}>
                <Text style={styles.shareBtnText}>Share</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.resetBtn} onPress={resetTeamCode}>
                <Text style={styles.resetBtnText}>Reset</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.hint}>A parent enters this on their kid’s profile to join the team.</Text>
        </View>
      )}

      {isCoach && dupes.length > 0 && (
        <View style={styles.dupeCard}>
          <Text style={styles.dupeTitle}>Possible duplicates</Text>
          {dupes.map((d, i) => (
            <TouchableOpacity key={i} style={styles.dupeRow} onPress={() => mergeDupe(d)}>
              <Text style={styles.dupeText} numberOfLines={1}>{d.keep_name} · {d.dup_name}</Text>
              <Text style={styles.dupeMerge}>Merge</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 28 }} color="#534AB7" />
      ) : (
        <>
          {players.length === 0 && (
            <Text style={styles.empty}>No players yet.{isCoach ? ' Add a spot below.' : ''}</Text>
          )}

          {players.map(p => (
            <View key={p.playerId} style={styles.row}>
              <View style={styles.jersey}><Text style={styles.jerseyText}>{p.jersey || '—'}</Text></View>

              <View style={{ flex: 1 }}>
                {editingId === p.playerId ? (
                  <TextInput
                    style={styles.editInput}
                    value={editName}
                    onChangeText={setEditName}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={() => saveEdit(p.playerId)}
                    onBlur={() => saveEdit(p.playerId)}
                  />
                ) : (
                  <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                )}

                {(isCoach || p.isMine) && (
                  <Text style={styles.meta}>
                    {p.guardianCount === 0 ? 'Unclaimed' : `${p.guardianCount} guardian${p.guardianCount === 1 ? '' : 's'}`}
                    {p.isMine ? ' · yours' : ''}
                  </Text>
                )}
              </View>

              {p.isMine && editingId !== p.playerId && (
                <TouchableOpacity hitSlop={8} onPress={() => { setEditingId(p.playerId); setEditName(p.name); }}>
                  <Text style={styles.action}>Edit</Text>
                </TouchableOpacity>
              )}
              {isCoach && p.guardianCount === 0 && (
                <TouchableOpacity hitSlop={8} onPress={() => removePlaceholder(p)}>
                  <Text style={[styles.action, styles.danger]}>Remove</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}

          {isCoach && (showAdd ? (
            <View style={styles.addBox}>
              <TextInput style={styles.input} placeholder="First name (optional)" placeholderTextColor="#999" value={newName} onChangeText={setNewName} />
              <TextInput style={styles.input} placeholder="Jersey # (optional)" placeholderTextColor="#999" value={newJersey} onChangeText={setNewJersey} keyboardType="number-pad" />
              <View style={styles.addBtns}>
                <TouchableOpacity style={[styles.btn, styles.btnPrimary]} disabled={busy} onPress={addPlayer}>
                  <Text style={styles.btnPrimaryText}>{busy ? 'Adding…' : 'Add player'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btn} onPress={() => { setShowAdd(false); setNewName(''); setNewJersey(''); }}>
                  <Text style={styles.btnText}>Cancel</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.hint}>Hold a spot with a name or just a number — the family claims it with the code and can fix the name.</Text>
            </View>
          ) : (
            <TouchableOpacity style={styles.addRow} onPress={() => setShowAdd(true)}>
              <Text style={styles.addRowText}>＋ Add player / hold a spot</Text>
            </TouchableOpacity>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: '800', color: '#1a1a1a' },
  subtitle: { fontSize: 14, fontWeight: '600', color: '#888', marginBottom: 16 },
  empty: { color: '#888', fontSize: 15, textAlign: 'center', marginTop: 24 },

  codeCard: { backgroundColor: '#f5f4fb', borderRadius: 12, padding: 16, marginBottom: 20 },
  codeCardLabel: { fontSize: 13, fontWeight: '700', color: '#534AB7', textTransform: 'uppercase', letterSpacing: 0.5 },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  codeBig: { fontSize: 30, fontWeight: '800', letterSpacing: 4, color: '#1a1a1a' },
  codeBtns: { flexDirection: 'row', gap: 8 },
  shareBtn: { backgroundColor: '#534AB7', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  shareBtnText: { color: '#fff', fontWeight: '700' },
  resetBtn: { backgroundColor: '#eee', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  resetBtnText: { color: '#555', fontWeight: '700' },
  hint: { fontSize: 12, color: '#888', marginTop: 8, lineHeight: 16 },

  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e5e5', gap: 12 },
  jersey: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#eee', alignItems: 'center', justifyContent: 'center' },
  jerseyText: { fontWeight: '800', color: '#555' },
  name: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  meta: { fontSize: 12, color: '#999', marginTop: 2 },
  codeSmall: { fontSize: 13, color: '#534AB7', fontWeight: '600', marginTop: 4 },
  editInput: { fontSize: 16, fontWeight: '700', color: '#1a1a1a', borderBottomWidth: 1, borderBottomColor: '#534AB7', paddingVertical: 2 },
  action: { color: '#534AB7', fontWeight: '700', fontSize: 14, paddingHorizontal: 4 },
  danger: { color: '#c0392b' },

  addBox: { marginTop: 16, backgroundColor: '#fafafa', borderRadius: 12, padding: 14, gap: 10 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#1a1a1a' },
  addBtns: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', backgroundColor: '#eee' },
  btnText: { fontWeight: '700', color: '#555' },
  btnPrimary: { backgroundColor: '#534AB7' },
  btnPrimaryText: { fontWeight: '700', color: '#fff' },
  addRow: { marginTop: 16, paddingVertical: 14, borderRadius: 10, borderWidth: 1, borderColor: '#534AB7', borderStyle: 'dashed', alignItems: 'center' },
  addRowText: { color: '#534AB7', fontWeight: '700', fontSize: 15 },

  dupeCard: { backgroundColor: '#fff7ed', borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#f5c890' },
  dupeTitle: { color: '#b06a1a', fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  dupeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  dupeText: { color: '#333', fontSize: 15, fontWeight: '600', flex: 1 },
  dupeMerge: { color: '#534AB7', fontWeight: '800', fontSize: 14 },
});

import { COACH_ROLES, useTeamContext } from '@/context';
import { confirm } from '@/lib/confirm';
import { supabase } from '@/supabase';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
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
  guardianCode: string | null;
};

// A possible-duplicate pair from suggest_duplicate_players, with per-side
// guardians + attached content (footage/stats) so the chooser can show — and
// recommend — the real, content-bearing profile to keep.
type DupePair = {
  keep_id: string; keep_name: string; keep_guardians: number; keep_content: number;
  dup_id: string; dup_name: string; dup_guardians: number; dup_content: number;
};

export default function RosterScreen() {
  const insets = useSafeAreaInsets();
  const { activeTeam, activeRole, userId, refreshTeams } = useTeamContext();
  const isCoach = !!activeRole && COACH_ROLES.includes(activeRole);
  const [editingTeamName, setEditingTeamName] = useState(false);
  const [teamNameInput, setTeamNameInput] = useState('');

  const [players, setPlayers] = useState<RosterPlayer[]>([]);
  const [teamCode, setTeamCode] = useState<string | null>(null);
  const [coachCode, setCoachCode] = useState<string | null>(null);
  const [staff, setStaff] = useState<{ user_id: string; display_name: string; role: string }[]>([]);
  const [dupes, setDupes] = useState<DupePair[]>([]);
  // Merge chooser (cross-platform: Alert.alert's buttons are dead on web).
  const [mergePair, setMergePair] = useState<DupePair | null>(null);
  const [merging, setMerging] = useState(false);
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

    const { data: team } = await supabase.from('teams').select('join_code, coach_code').eq('id', teamId).maybeSingle();
    setTeamCode(team?.join_code ?? null);
    setCoachCode((team as any)?.coach_code ?? null);

    // Team staff (coach-tier members) for the Coaches section.
    const { data: st } = await supabase.rpc('list_team_staff', { p_team_id: teamId });
    setStaff((st as any[]) ?? []);

    const { data: pt } = await supabase
      .from('player_teams')
      .select('player_id, jersey_number, players ( id, name )')
      .eq('team_id', teamId)
      .is('left_at', null); // active roster only; soft-left kids drop off
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

    // Per-player guardian codes — a coach may read them (player_guardian_codes_read
    // RLS). This is the code a parent enters under "Have a code?" to claim THAT kid.
    const codeById = new Map<string, string>();
    if (ids.length) {
      const { data: codes } = await supabase.from('player_guardian_codes').select('player_id, code').in('player_id', ids);
      (codes || []).forEach((c: any) => codeById.set(c.player_id, c.code));
    }

    setPlayers(rows
      .map(r => ({
        playerId: r.player_id,
        name: r.players?.name ?? 'Unnamed',
        jersey: r.jersey_number ?? null,
        guardianCount: countById.get(r.player_id) ?? 0,
        isMine: mine.has(r.player_id),
        guardianCode: codeById.get(r.player_id) ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)));

    // Coach-only: possible-duplicate suggestions (RPC is coach-gated; a non-coach
    // just gets an error → empty list).
    const { data: d } = await supabase.rpc('suggest_duplicate_players', { p_team_id: teamId });
    setDupes((d as any[]) ?? []);
    setLoading(false);
  }, [activeTeam, userId]);

  // Open the cross-platform chooser (works on web AND native, unlike a
  // multi-button Alert.alert which silently no-ops on RN Web).
  function mergeDupe(d: { keep_id: string; keep_name: string; dup_id: string; dup_name: string }) {
    setMergePair(d);
  }
  // After the coach picks which profile to keep, spell out — in plain words —
  // exactly what happens before doing the irreversible merge: which player is
  // absorbed, what moves, and that it can't be undone.
  async function chooseKeep(keepSide: 'keep' | 'dup') {
    const d = mergePair;
    if (!d) return;
    const keeper = keepSide === 'keep'
      ? { id: d.keep_id, name: d.keep_name }
      : { id: d.dup_id, name: d.dup_name };
    const loser = keepSide === 'keep'
      ? { id: d.dup_id, name: d.dup_name, g: d.dup_guardians, c: d.dup_content }
      : { id: d.keep_id, name: d.keep_name, g: d.keep_guardians, c: d.keep_content };
    const moves: string[] = [];
    if (loser.c > 0) moves.push(`${loser.c} clip${loser.c === 1 ? '' : 's'} / stats`);
    if (loser.g > 0) moves.push(`${loser.g} guardian${loser.g === 1 ? '' : 's'}`);
    const movesLine = moves.length
      ? `Everything on “${loser.name}” (${moves.join(' and ')}) moves onto “${keeper.name}”, then “${loser.name}” is removed.`
      : `“${loser.name}” is empty, so it’s simply removed and “${keeper.name}” stays.`;
    const ok = await confirm({
      title: `Combine into “${keeper.name}”?`,
      message: `${movesLine}\n\nThis can’t be undone.`,
      confirmText: 'Combine',
      destructive: true,
    });
    if (!ok) return;
    doMerge(keeper.id, loser.id);
  }

  async function doMerge(keep: string, dup: string) {
    setMerging(true);
    const { error } = await supabase.rpc('merge_players', { p_keep: keep, p_dup: dup });
    setMerging(false);
    setMergePair(null);
    if (error) { Alert.alert('Merge', error.message); return; }
    load();
  }

  // One-line description of what a side has, so a coach can tell the real
  // claimed profile from an empty placeholder.
  function sideMeta(guardians: number, content: number): string {
    const parts: string[] = [];
    parts.push(guardians > 0 ? `Claimed · ${guardians} guardian${guardians === 1 ? '' : 's'}` : 'Placeholder · unclaimed');
    parts.push(content > 0 ? `${content} clip${content === 1 ? '' : 's'} / stats attached` : 'No footage yet');
    return parts.join(' · ');
  }
  // Recommend keeping the fuller profile: claimed beats unclaimed, then more
  // content, then the longer (usually full) name. Returns 'keep' | 'dup'.
  function recommendedKeep(d: DupePair): 'keep' | 'dup' {
    const score = (g: number, c: number, name: string) => g * 1000 + c * 10 + name.trim().length;
    return score(d.keep_guardians, d.keep_content, d.keep_name) >= score(d.dup_guardians, d.dup_content, d.dup_name)
      ? 'keep' : 'dup';
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

  async function removePlaceholder(p: RosterPlayer) {
    if (!activeTeam) return;
    // Message is honest about what the guarded RPC will actually do: a blank
    // placeholder is deleted outright; a claimed kid (guardians/footage/stats)
    // is only removed from THIS roster and keeps all history.
    const hasHistory = p.guardianCount > 0;
    const ok = await confirm({
      title: hasHistory ? 'Remove from roster' : 'Delete placeholder',
      message: hasHistory
        ? `Remove “${p.name}” from ${activeTeam.name}? Their guardians and any footage/stats are kept — this only takes them off this team’s roster.`
        : `Delete the empty placeholder “${p.name}”? This can’t be undone.`,
      confirmText: hasHistory ? 'Remove' : 'Delete',
      destructive: true,
    });
    if (!ok) return;
    // Guarded RPC: soft-leaves (keeps everything) for a kid with history; only
    // hard-deletes a truly blank placeholder. Returns 'deleted' | 'left' | 'detached'.
    const { data, error } = await supabase.rpc('remove_roster_placeholder', { p_player_id: p.playerId, p_team_id: activeTeam.id });
    if (error) { Alert.alert('Error', error.message); return; }
    load();
    if (data === 'deleted') Alert.alert('Deleted', `“${p.name}” was removed.`);
    else Alert.alert('Removed', `“${p.name}” was taken off ${activeTeam.name}. Their history is kept.`);
  }

  const shareCode = async (label: string, code: string) => {
    if (Platform.OS === 'web') {
      // Desktop browsers don't reliably support the native share sheet — copy instead.
      try { await navigator.clipboard.writeText(code); Alert.alert('Copied', `${label}: ${code}`); }
      catch { Alert.alert(label, code); }
    } else {
      Share.share({ message: `${label}: ${code}` });
    }
  };

  async function resetTeamCode() {
    if (!activeTeam) return;
    const ok = await confirm({
      title: 'Reset team code?',
      message: 'The current code stops working immediately. Anyone who has the old one can’t join until you share the new code.',
      confirmText: 'Reset', destructive: true,
    });
    if (!ok) return;
    const { data, error } = await supabase.rpc('regenerate_team_code', { p_team_id: activeTeam.id });
    if (error) { Alert.alert('Reset', error.message); return; }
    setTeamCode(data as string);
  }

  async function generateCode() {
    if (!activeTeam) return;
    const { data, error } = await supabase.rpc('regenerate_team_code', { p_team_id: activeTeam.id });
    if (error) { Alert.alert('Error', error.message); return; }
    setTeamCode(data as string);
  }

  async function getGuardianCode(playerId: string) {
    const { data, error } = await supabase.rpc('regenerate_guardian_code', { p_player_id: playerId });
    if (error) { Alert.alert('Error', error.message); return; }
    setPlayers(prev => prev.map(p => p.playerId === playerId ? { ...p, guardianCode: data as string } : p));
  }

  // Coach access: a team code that grants the coach role (Coaches' Corner + tools).
  async function makeCoachCode() {
    if (!activeTeam) return;
    const { data, error } = await supabase.rpc('regenerate_coach_code', { p_team_id: activeTeam.id });
    if (error) { Alert.alert('Error', error.message); return; }
    setCoachCode(data as string);
  }
  async function removeCoach(uid: string, name: string) {
    if (!activeTeam) return;
    const ok = await confirm({ title: `Remove ${name}?`, message: `Remove ${name}'s coach access to ${activeTeam.name}? Their own parent access (if any) is kept.`, confirmText: 'Remove', destructive: true });
    if (!ok) return;
    const { error } = await supabase.rpc('remove_team_coach', { p_team_id: activeTeam.id, p_user_id: uid });
    if (error) { Alert.alert('Remove coach', error.message); return; }
    load();
  }
  const roleLabel = (r: string) => r === 'admin' ? 'Admin' : r === 'head_coach' ? 'Head coach' : 'Coach';

  // Rename the team (RLS: is_team_coach). Updates the shared context so the name
  // changes everywhere (home rail, feed, etc.), not just this screen.
  async function saveTeamName() {
    if (!activeTeam) return;
    const name = teamNameInput.trim();
    if (!name) { Alert.alert('Team name', 'Enter a team name.'); return; }
    if (name === activeTeam.name) { setEditingTeamName(false); return; }
    const { error } = await supabase.from('teams').update({ name }).eq('id', activeTeam.id);
    if (error) { Alert.alert('Rename team', error.message); return; }
    setEditingTeamName(false);
    await refreshTeams();
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
      {editingTeamName ? (
        <View style={styles.teamNameEditRow}>
          <TextInput
            style={styles.teamNameInput}
            value={teamNameInput}
            onChangeText={setTeamNameInput}
            autoFocus
            placeholder="Team name"
            placeholderTextColor="#666"
            onSubmitEditing={saveTeamName}
            returnKeyType="done"
          />
          <TouchableOpacity onPress={saveTeamName}><Text style={styles.teamNameSave}>Save</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setEditingTeamName(false)}><Text style={styles.teamNameCancel}>Cancel</Text></TouchableOpacity>
        </View>
      ) : (
        <View style={styles.teamNameRow}>
          <Text style={styles.title}>{activeTeam.name}</Text>
          {isCoach ? (
            <TouchableOpacity onPress={() => { setTeamNameInput(activeTeam.name); setEditingTeamName(true); }} hitSlop={8}>
              <Text style={styles.teamNameEdit}>✎ Edit</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}
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

      {isCoach && !teamCode && !loading && (
        <View style={styles.codeCard}>
          <Text style={styles.codeCardLabel}>Team join code</Text>
          <Text style={[styles.hint, { marginTop: 6, marginBottom: 12 }]}>This team doesn’t have a join code yet. Generate one to invite players and parents.</Text>
          <TouchableOpacity style={styles.shareBtn} onPress={generateCode}>
            <Text style={styles.shareBtnText}>Generate join code</Text>
          </TouchableOpacity>
        </View>
      )}

      {isCoach && (
        <View style={styles.codeCard}>
          <Text style={styles.codeCardLabel}>Coaches</Text>
          {staff.length > 0 ? staff.map(s => (
            <View key={s.user_id} style={styles.staffRow}>
              <Text style={styles.staffName} numberOfLines={1}>{s.display_name}</Text>
              <Text style={styles.staffRole}>{roleLabel(s.role)}</Text>
              {activeRole === 'admin' && s.role !== 'admin' && s.user_id !== userId ? (
                <TouchableOpacity onPress={() => removeCoach(s.user_id, s.display_name)} hitSlop={6}>
                  <Text style={styles.staffRemove}>Remove</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )) : <Text style={[styles.hint, { marginTop: 6 }]}>No coaches yet.</Text>}

          {coachCode ? (
            <>
              <View style={[styles.codeRow, { marginTop: 12 }]}>
                <Text style={styles.codeBig}>{coachCode}</Text>
                <View style={styles.codeBtns}>
                  <TouchableOpacity style={styles.shareBtn} onPress={() => shareCode(`Coach access to ${activeTeam.name} on IamSports`, coachCode)}>
                    <Text style={styles.shareBtnText}>Share</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.resetBtn} onPress={makeCoachCode}>
                    <Text style={styles.resetBtnText}>Reset</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={styles.hint}>Share this coach code. Whoever enters it (Home → “Join as coach”) gets coach access — Coaches’ Corner + tools. A coach can also be a parent of their own kid.</Text>
            </>
          ) : (
            <TouchableOpacity style={[styles.shareBtn, { marginTop: 12, alignSelf: 'flex-start' }]} onPress={makeCoachCode}>
              <Text style={styles.shareBtnText}>Create a coach code</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {isCoach && dupes.length > 0 && (
        <View style={styles.dupeCard}>
          <Text style={styles.dupeTitle}>Possible duplicates</Text>
          <Text style={styles.dupeSub}>Same player added twice? Combine them into one — all footage, clips, guardians and stats end up on a single profile.</Text>
          {dupes.map((d, i) => (
            <TouchableOpacity key={i} style={styles.dupeRow} onPress={() => mergeDupe(d)}>
              <Text style={styles.dupeText} numberOfLines={1}>{d.keep_name} · {d.dup_name}</Text>
              <Text style={styles.dupeMerge}>Review →</Text>
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

                {isCoach && (p.guardianCode ? (
                  <TouchableOpacity onPress={() => shareCode(`${p.name}’s invite code for IamSports`, p.guardianCode!)}>
                    <Text style={styles.codeSmall}>Code {p.guardianCode} · tap to share</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity onPress={() => getGuardianCode(p.playerId)}>
                    <Text style={styles.codeSmall}>Get invite code</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {p.isMine && editingId !== p.playerId && (
                <TouchableOpacity hitSlop={8} onPress={() => { setEditingId(p.playerId); setEditName(p.name); }}>
                  <Text style={styles.action}>Edit</Text>
                </TouchableOpacity>
              )}
              {isCoach && (
                <TouchableOpacity hitSlop={8} onPress={() => removePlaceholder(p)}>
                  <Text style={[styles.action, styles.danger]}>{p.guardianCount === 0 ? 'Delete' : 'Remove'}</Text>
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

      {/* Merge chooser — cross-platform (web + native). Everything from both
          combines onto the profile you keep; the choice only sets which
          name/identity survives. Each side shows its guardians + content, and
          the fuller one is recommended. */}
      <Modal visible={!!mergePair} transparent animationType="fade" onRequestClose={() => setMergePair(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Merge duplicate players</Text>
            <Text style={styles.modalBody}>
              These look like the same player. Everything — footage, clips, guardians and stats — combines onto the one you keep. Nothing is lost; you’re just choosing which name and profile stays.
            </Text>
            {mergePair && (() => {
              const rec = recommendedKeep(mergePair);
              const Side = ({ side, name, guardians, content }: { side: 'keep' | 'dup'; name: string; guardians: number; content: number }) => (
                <TouchableOpacity
                  style={[styles.mergeOption, rec === side && styles.mergeOptionRec]}
                  disabled={merging}
                  onPress={() => chooseKeep(side)}
                >
                  <View style={styles.mergeOptionHead}>
                    <Text style={styles.mergeOptionName} numberOfLines={1}>Keep “{name}”</Text>
                    {rec === side && <Text style={styles.mergeRecTag}>Recommended</Text>}
                  </View>
                  <Text style={styles.mergeOptionMeta}>{sideMeta(guardians, content)}</Text>
                </TouchableOpacity>
              );
              return (
                <>
                  <Side side="keep" name={mergePair.keep_name} guardians={mergePair.keep_guardians} content={mergePair.keep_content} />
                  <Side side="dup" name={mergePair.dup_name} guardians={mergePair.dup_guardians} content={mergePair.dup_content} />
                </>
              );
            })()}
            <Text style={styles.modalHint}>Tip: keep the family’s claimed profile with the correct full name — usually the one marked Recommended.</Text>
            <TouchableOpacity style={styles.modalBtn} disabled={merging} onPress={() => setMergePair(null)}>
              <Text style={styles.modalBtnText}>{merging ? 'Merging…' : 'Not duplicates'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'center', paddingHorizontal: 28 },
  modalCard: { backgroundColor: '#16161a', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#2a2a32', gap: 10, maxWidth: 440, width: '100%', alignSelf: 'center' },
  modalTitle: { color: '#f4f4f6', fontSize: 18, fontWeight: '800' },
  modalBody: { color: '#b8bcc6', fontSize: 14, lineHeight: 20, marginBottom: 4 },
  modalBtn: { paddingVertical: 13, borderRadius: 10, alignItems: 'center', backgroundColor: '#22222a' },
  modalBtnText: { color: '#cfd2da', fontSize: 15, fontWeight: '700' },
  modalHint: { color: '#8a8f9a', fontSize: 12.5, lineHeight: 18, marginTop: 2, marginBottom: 4 },
  mergeOption: { backgroundColor: '#1d1d24', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#2f2f39' },
  mergeOptionRec: { borderColor: '#6c63d6', backgroundColor: '#211f34' },
  mergeOptionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  mergeOptionName: { color: '#f4f4f6', fontSize: 16, fontWeight: '800', flex: 1 },
  mergeRecTag: { color: '#b9b1f0', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  mergeOptionMeta: { color: '#9fa4af', fontSize: 13, marginTop: 4 },
  title: { fontSize: 22, fontWeight: '800', color: '#f4f4f6' },
  subtitle: { fontSize: 14, fontWeight: '600', color: '#9096a3', marginBottom: 16 },
  teamNameRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  teamNameEdit: { color: '#8b7bff', fontSize: 13, fontWeight: '700' },
  teamNameEditRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  teamNameInput: { flex: 1, backgroundColor: '#17171d', color: '#f4f4f6', fontSize: 20, fontWeight: '800', borderRadius: 8, borderWidth: 1, borderColor: '#333', paddingHorizontal: 12, paddingVertical: 8 },
  teamNameSave: { color: '#3ec48c', fontSize: 14, fontWeight: '800' },
  teamNameCancel: { color: '#9096a3', fontSize: 14, fontWeight: '700' },
  empty: { color: '#9096a3', fontSize: 15, textAlign: 'center', marginTop: 24 },

  codeCard: { backgroundColor: '#16161a', borderRadius: 12, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: '#2a2a32' },
  codeCardLabel: { fontSize: 13, fontWeight: '700', color: '#8b7bff', textTransform: 'uppercase', letterSpacing: 0.5 },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  codeBig: { fontSize: 30, fontWeight: '800', letterSpacing: 4, color: '#f4f4f6' },
  codeBtns: { flexDirection: 'row', gap: 8 },
  shareBtn: { backgroundColor: '#534AB7', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  shareBtnText: { color: '#fff', fontWeight: '700' },
  resetBtn: { backgroundColor: '#24242c', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#2a2a32' },
  resetBtnText: { color: '#c9ccd3', fontWeight: '700' },
  hint: { fontSize: 12, color: '#62626c', marginTop: 8, lineHeight: 16 },
  staffRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  staffName: { flex: 1, color: '#f4f4f6', fontSize: 15, fontWeight: '700' },
  staffRole: { color: '#8b7bff', fontSize: 12, fontWeight: '700' },
  staffRemove: { color: '#c0392b', fontSize: 13, fontWeight: '700' },

  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2a2a32', gap: 12 },
  jersey: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#24242c', alignItems: 'center', justifyContent: 'center' },
  jerseyText: { fontWeight: '800', color: '#c9ccd3' },
  name: { fontSize: 16, fontWeight: '700', color: '#f4f4f6' },
  meta: { fontSize: 12, color: '#62626c', marginTop: 2 },
  codeSmall: { fontSize: 13, color: '#8b7bff', fontWeight: '600', marginTop: 4 },
  editInput: { fontSize: 16, fontWeight: '700', color: '#f4f4f6', borderBottomWidth: 1, borderBottomColor: '#6c5ce7', paddingVertical: 2 },
  action: { color: '#8b7bff', fontWeight: '700', fontSize: 14, paddingHorizontal: 4 },
  danger: { color: '#e2574a' },

  addBox: { marginTop: 16, backgroundColor: '#16161a', borderRadius: 12, padding: 14, gap: 10, borderWidth: 1, borderColor: '#2a2a32' },
  input: { borderWidth: 1, borderColor: '#2a2a32', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#f4f4f6', backgroundColor: '#1b1e26' },
  addBtns: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', backgroundColor: '#24242c' },
  btnText: { fontWeight: '700', color: '#c9ccd3' },
  btnPrimary: { backgroundColor: '#534AB7' },
  btnPrimaryText: { fontWeight: '700', color: '#fff' },
  addRow: { marginTop: 16, paddingVertical: 14, borderRadius: 10, borderWidth: 1, borderColor: '#534AB7', borderStyle: 'dashed', alignItems: 'center' },
  addRowText: { color: '#8b7bff', fontWeight: '700', fontSize: 15 },

  dupeCard: { backgroundColor: '#1f1a10', borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#4a3a1a' },
  dupeTitle: { color: '#e0a94a', fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  dupeSub: { color: '#c9b892', fontSize: 12.5, lineHeight: 18, marginBottom: 10 },
  dupeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  dupeText: { color: '#e8e8ea', fontSize: 15, fontWeight: '600', flex: 1 },
  dupeMerge: { color: '#8b7bff', fontWeight: '800', fontSize: 14 },
});

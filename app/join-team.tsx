import { useTeamContext } from '@/context';
import { goBackOrHome } from '@/lib/nav';
import { supabase } from '@/supabase';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Parent join flow: enter the team code → SEE the roster → tap your player to
// claim an open spot (no duplicate). Already-claimed players are locked (a
// co-guardian needs that player's own code). If your kid isn't listed, attach an
// existing one or add a new one.
type PreviewPlayer = { player_id: string; first_name: string; jersey: string | null; claimed: boolean };
type Preview = { team_id: string; team_name: string; players: PreviewPlayer[] };

export default function JoinTeamScreen() {
  const insets = useSafeAreaInsets();
  const { userKids, refreshKids, refreshTeams } = useTeamContext();

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [showMine, setShowMine] = useState(false);
  const [newName, setNewName] = useState('');

  const cleanCode = () => code.trim().toUpperCase();

  async function lookup() {
    if (!code.trim()) return;
    setLoading(true);
    const { data, error } = await supabase.rpc('preview_roster_by_code', { p_code: cleanCode() });
    setLoading(false);
    if (error || !data) { Alert.alert('Team code', error?.message ?? 'Invalid code'); return; }
    setPreview(data as Preview);
  }

  async function finish(msg: string) {
    await Promise.all([refreshKids(), refreshTeams()]);
    Alert.alert('Joined', msg, [{ text: 'OK', onPress: () => goBackOrHome() }]);
  }

  async function claimSpot(p: PreviewPlayer) {
    if (!preview) return;
    setBusy(true);
    const { error } = await supabase.rpc('claim_roster_spot', { p_code: cleanCode(), p_player_id: p.player_id });
    setBusy(false);
    if (error) { Alert.alert('Claim', error.message); return; }
    finish(`${p.first_name} is on ${preview.team_name}.`);
  }

  async function attachMyKid(playerId: string, name: string) {
    if (!preview) return;
    setBusy(true);
    const { error } = await supabase.rpc('join_team_with_code', { p_code: cleanCode(), p_player_id: playerId });
    setBusy(false);
    if (error) { Alert.alert('Join', error.message); return; }
    finish(`${name} is on ${preview.team_name}.`);
  }

  async function addNewAndJoin() {
    const name = newName.trim();
    if (!name || !preview) { Alert.alert('Add player', 'Enter your player’s name.'); return; }
    setBusy(true);
    const { data: newId, error: e1 } = await supabase.rpc('create_kid', { name });
    if (e1 || !newId) { setBusy(false); Alert.alert('Add player', e1?.message ?? 'Could not create player'); return; }
    const { error: e2 } = await supabase.rpc('join_team_with_code', { p_code: cleanCode(), p_player_id: newId });
    setBusy(false);
    if (e2) { Alert.alert('Join', e2.message); return; }
    finish(`${name} is on ${preview.team_name}.`);
  }

  const myKidsNotHere = preview
    ? userKids.filter(k => !preview.players.some(p => p.player_id === k.player_id))
    : [];

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <TouchableOpacity onPress={goBackOrHome} style={styles.back} hitSlop={8}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      {!preview ? (
        <View style={styles.pad}>
          <Text style={styles.title}>Join a team</Text>
          <Text style={styles.sub}>Enter the code your coach gave you.</Text>
          <TextInput
            style={styles.codeInput}
            placeholder="TEAM CODE"
            placeholderTextColor="#666"
            value={code}
            onChangeText={t => setCode(t.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            maxLength={8}
          />
          <TouchableOpacity style={styles.primaryBtn} onPress={lookup} disabled={loading || !code.trim()}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Continue</Text>}
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>{preview.team_name}</Text>
          <Text style={styles.sub}>Tap your player to join. A player that already has a family is locked — ask them for that player’s code to be added as a co-guardian.</Text>

          {preview.players.map(p => (
            <TouchableOpacity
              key={p.player_id}
              style={[styles.playerRow, p.claimed && styles.playerRowLocked]}
              disabled={p.claimed || busy}
              onPress={() => claimSpot(p)}
            >
              <View style={styles.jersey}><Text style={styles.jerseyText}>{p.jersey || '—'}</Text></View>
              <Text style={styles.playerName} numberOfLines={1}>{p.first_name}</Text>
              {p.claimed
                ? <Text style={styles.locked}>Taken</Text>
                : <Text style={styles.claim}>This is my player →</Text>}
            </TouchableOpacity>
          ))}

          {preview.players.length === 0 && (
            <Text style={styles.sub}>No players on this roster yet — add yours below.</Text>
          )}

          {!showMine ? (
            <TouchableOpacity style={styles.linkRow} onPress={() => setShowMine(true)}>
              <Text style={styles.link}>My player isn’t listed</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.mineBox}>
              {myKidsNotHere.length > 0 && (
                <>
                  <Text style={styles.mineLabel}>Add one of your players</Text>
                  {myKidsNotHere.map(k => (
                    <TouchableOpacity key={k.player_id} style={styles.mineRow} disabled={busy} onPress={() => attachMyKid(k.player_id, k.name)}>
                      <Text style={styles.mineName} numberOfLines={1}>{k.name}</Text>
                      <Text style={styles.claim}>Add →</Text>
                    </TouchableOpacity>
                  ))}
                </>
              )}
              <Text style={styles.mineLabel}>Or add a new player</Text>
              <TextInput style={styles.input} placeholder="Player’s name" placeholderTextColor="#666" value={newName} onChangeText={setNewName} />
              <TouchableOpacity style={styles.primaryBtn} onPress={addNewAndJoin} disabled={busy}>
                <Text style={styles.primaryBtnText}>{busy ? 'Adding…' : 'Add & join'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  back: { paddingHorizontal: 16, paddingVertical: 8 },
  backText: { color: '#888', fontSize: 16 },
  pad: { padding: 20, gap: 14 },
  title: { color: '#fff', fontSize: 26, fontWeight: '800' },
  sub: { color: '#999', fontSize: 14, lineHeight: 20 },
  codeInput: { backgroundColor: '#17171d', color: '#fff', fontSize: 24, fontWeight: '800', letterSpacing: 6, textAlign: 'center', borderRadius: 12, paddingVertical: 16, marginTop: 8 },
  input: { backgroundColor: '#17171d', color: '#fff', fontSize: 16, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  primaryBtn: { backgroundColor: '#534AB7', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },

  playerRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#17171d', borderRadius: 12, padding: 14, gap: 12 },
  playerRowLocked: { opacity: 0.45 },
  jersey: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#2a2a33', alignItems: 'center', justifyContent: 'center' },
  jerseyText: { color: '#ccc', fontWeight: '800' },
  playerName: { color: '#fff', fontSize: 17, fontWeight: '700', flex: 1 },
  claim: { color: '#8b83e6', fontWeight: '700', fontSize: 13 },
  locked: { color: '#777', fontWeight: '700', fontSize: 13 },

  linkRow: { paddingVertical: 12, alignItems: 'center' },
  link: { color: '#8b83e6', fontWeight: '700', fontSize: 15 },
  mineBox: { backgroundColor: '#0f0f14', borderRadius: 12, padding: 14, gap: 10 },
  mineLabel: { color: '#888', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
  mineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#17171d', borderRadius: 10, padding: 12 },
  mineName: { color: '#fff', fontSize: 16, fontWeight: '600', flex: 1 },
});

import { useTeamContext } from '@/context';
import { goBackOrHome } from '@/lib/nav';
import { alertThenGo, webAlert } from '@/lib/webAlert';
import { supabase } from '@/supabase';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// A co-guardian (co-parent / grandparent) enters a kid's code to be added as a
// guardian of that kid. Enter code → confirm which kid → claim_or_link_guardian.
type Preview = { player_id: string; first_name: string; guardian_count: number; already_mine: boolean; full: boolean };

export default function ClaimKidScreen() {
  const insets = useSafeAreaInsets();
  const { refreshKids, refreshTeams } = useTeamContext();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);

  const cleanCode = () => code.trim().toUpperCase();

  // Arriving from the onboarding one-box: pre-fill + look up the player code.
  const params = useLocalSearchParams();
  useEffect(() => {
    const c = (Array.isArray(params.code) ? params.code[0] : params.code) as string | undefined;
    if (c && !preview) { setCode(c.toUpperCase()); lookup(c); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function lookup(override?: string) {
    const cc = (override ?? code).trim().toUpperCase();
    if (!cc) return;
    setLoading(true);
    const { data, error } = await supabase.rpc('preview_guardian_code', { p_code: cc });
    setLoading(false);
    if (error || !data) { webAlert('Player code not found', 'That didn’t match a player’s invite code.\n\nIf it’s a TEAM join code (to join a whole team), go back and use “Join team” instead.'); return; }
    setPreview(data as Preview);
  }

  async function confirmAttach() {
    if (!preview) return;
    if (preview.already_mine) { alertThenGo('Already added', `You’re already ${preview.first_name}’s guardian.`, goBackOrHome); return; }
    if (preview.full) { webAlert('Full', `${preview.first_name}’s guardian list is full (4).`); return; }
    setBusy(true);
    const { error } = await supabase.rpc('claim_or_link_guardian', { p_code: cleanCode() });
    setBusy(false);
    if (error) { webAlert('Add guardian', error.message); return; }
    await Promise.all([refreshKids(), refreshTeams()]);
    alertThenGo('Added', `You’re now ${preview.first_name}’s guardian.`, goBackOrHome);
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <TouchableOpacity onPress={goBackOrHome} style={styles.back} hitSlop={8}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      {!preview ? (
        <View style={styles.pad}>
          <Text style={styles.title}>Have a player code?</Text>
          <Text style={styles.sub}>Enter the code a parent shared to be added as a guardian of their kid.</Text>
          <TextInput
            style={styles.codeInput}
            placeholder="PLAYER CODE"
            placeholderTextColor="#666"
            value={code}
            onChangeText={t => setCode(t.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            maxLength={8}
          />
          <TouchableOpacity style={styles.primaryBtn} onPress={() => lookup()} disabled={loading || !code.trim()}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Continue</Text>}
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.pad}>
          <Text style={styles.title}>{preview.first_name}</Text>
          <Text style={styles.sub}>
            {preview.already_mine
              ? `You’re already ${preview.first_name}’s guardian.`
              : preview.full
                ? `${preview.first_name}’s guardian list is full (4).`
                : `Add yourself as ${preview.first_name}’s guardian? You’ll see their film and stats.`}
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={confirmAttach} disabled={busy || preview.full || preview.already_mine}>
            <Text style={styles.primaryBtnText}>{busy ? 'Adding…' : `Yes, add me as ${preview.first_name}’s guardian`}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => setPreview(null)}>
            <Text style={styles.secondaryText}>Enter a different code</Text>
          </TouchableOpacity>
        </View>
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
  sub: { color: '#999', fontSize: 15, lineHeight: 21 },
  codeInput: { backgroundColor: '#17171d', color: '#fff', fontSize: 24, fontWeight: '800', letterSpacing: 6, textAlign: 'center', borderRadius: 12, paddingVertical: 16, marginTop: 8 },
  primaryBtn: { backgroundColor: '#534AB7', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 16, textAlign: 'center' },
  secondaryBtn: { alignItems: 'center', paddingVertical: 12 },
  secondaryText: { color: '#8b83e6', fontWeight: '700' },
});

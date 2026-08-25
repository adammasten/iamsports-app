import { useTeamContext } from '@/context';
import { goBackOrHome } from '@/lib/nav';
import { alertThenGo, webAlert } from '@/lib/webAlert';
import { supabase } from '@/supabase';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Enter a team's COACH code → join as a coach (Coaches' Corner + coach tools).
// The coach code is created/shared by an admin from the roster. A coach can also
// be a parent of their own kid (they claim the kid separately with its code).
export default function JoinCoachScreen() {
  const insets = useSafeAreaInsets();
  const { refreshTeams, setActiveTeam } = useTeamContext();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function redeem() {
    if (!code.trim()) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('redeem_coach_code', { p_code: code.trim().toUpperCase() });
    setBusy(false);
    if (error || !data) { webAlert('Coach code', error?.message ?? 'That code didn’t match a team.'); return; }
    await refreshTeams();
    setActiveTeam(data as string);
    alertThenGo('You’re in', 'You’ve joined as a coach — you now have Coaches’ Corner and the coach tools.', () => router.replace('/'));
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <TouchableOpacity onPress={goBackOrHome} style={styles.back} hitSlop={8}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <View style={styles.pad}>
        <Text style={styles.title}>Have a coach code?</Text>
        <Text style={styles.sub}>Enter the coach code a team admin shared to join their team as a coach. (If you’re a parent joining your kid, go back and use “Join team” instead.)</Text>
        <TextInput
          style={styles.codeInput}
          placeholder="COACH CODE"
          placeholderTextColor="#666"
          value={code}
          onChangeText={t => setCode(t.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          maxLength={8}
        />
        <TouchableOpacity style={styles.primaryBtn} onPress={redeem} disabled={busy || !code.trim()}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Join as coach</Text>}
        </TouchableOpacity>
      </View>
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
});

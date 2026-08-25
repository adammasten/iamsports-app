// First-run screen. The post-login resolver in app/_layout.tsx routes brand-new
// users (no confirmed team + no linked kid) here. Four ways in, so anyone can act
// in one tap: ONE code box (team/player/coach, auto-detected via resolve_any_code)
// up top, then Start a team, Add a kid, or Upload a video (personal footage tied to
// the uploader — no team required).
import { supabase } from '@/supabase';
import { webAlert } from '@/lib/webAlert';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

export default function OnboardingScreen() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function submitCode() {
    const c = code.trim();
    if (!c) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('resolve_any_code', { p_code: c });
    setBusy(false);
    if (error) { webAlert('Code', error.message); return; }
    const r = data as { type?: string } | null;
    // Route to the existing flow with the code pre-filled — it confirms the details.
    if (r?.type === 'team') router.push({ pathname: '/join-team', params: { code: c } });
    else if (r?.type === 'coach') router.push({ pathname: '/join-coach', params: { code: c } });
    else if (r?.type === 'player') router.push({ pathname: '/claim-kid', params: { code: c } });
    else webAlert('Code not found', 'That code didn’t match a team, player, or coach invite. Double-check it — or start fresh below.');
  }

  const Option = ({ icon, title, desc, onPress }: { icon: string; title: string; desc: string; onPress: () => void }) => (
    <Pressable style={styles.opt} onPress={onPress}>
      <View style={styles.ic}><Text style={styles.icTxt}>{icon}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.optTtl}>{title}</Text>
        <Text style={styles.optDsc}>{desc}</Text>
      </View>
      <Text style={styles.arrow}>→</Text>
    </Pressable>
  );

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.hi}>You’re in 🏀</Text>
        <Text style={styles.sub}>Start with whatever you’ve got — a code, a team, a kid, or just some film.</Text>

        <View style={styles.codebox}>
          <Text style={styles.codeLbl}>ENTER YOUR CODE</Text>
          <TextInput
            style={styles.codeField}
            value={code}
            onChangeText={t => setCode(t.toUpperCase())}
            placeholder="TEAM · PLAYER · COACH"
            placeholderTextColor="#3a4a5a"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
            onSubmitEditing={submitCode}
            returnKeyType="go"
          />
        </View>
        <Pressable style={[styles.cont, (busy || !code.trim()) && { opacity: 0.5 }]} disabled={busy || !code.trim()} onPress={submitCode}>
          <Text style={styles.contTxt}>{busy ? 'Checking…' : 'Continue'}</Text>
        </Pressable>
        <Text style={styles.auto}>One box — team, player, or coach, auto-detected</Text>

        <View style={styles.divider}><View style={styles.line} /><Text style={styles.divTxt}>or start fresh</Text><View style={styles.line} /></View>

        <Option icon="🏀" title="Start a team" desc="I’m a coach setting one up" onPress={() => router.push({ pathname: '/select-team', params: { action: 'newteam' } })} />
        <Option icon="👦" title="Add a kid" desc="Set up your player’s profile" onPress={() => router.push({ pathname: '/select-team', params: { action: 'newkid' } })} />
        <Option icon="🎬" title="Upload a video" desc="Try it now — no team needed" onPress={() => router.push('/upload')} />

        <Pressable style={styles.skip} onPress={() => router.replace('/select-team')}>
          <Text style={styles.skipTxt}>Skip for now →</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b1622' },
  content: { padding: 24, paddingTop: 72, maxWidth: 480, width: '100%', alignSelf: 'center' },
  hi: { color: '#f1f4f6', fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  sub: { color: '#9db0bd', fontSize: 14.5, marginTop: 8, marginBottom: 22, lineHeight: 21 },
  codebox: { backgroundColor: '#0c1a28', borderColor: '#6c5ce7', borderWidth: 1.5, borderRadius: 14, padding: 15 },
  codeLbl: { color: '#8b7bff', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  codeField: { color: '#f1f4f6', fontSize: 24, fontWeight: '800', letterSpacing: 4, marginTop: 8, paddingVertical: 2 },
  cont: { backgroundColor: '#6c5ce7', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  contTxt: { color: '#fff', fontSize: 15.5, fontWeight: '800' },
  auto: { color: '#7a8fa0', fontSize: 12, marginTop: 8, textAlign: 'center' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 22 },
  line: { flex: 1, height: 1, backgroundColor: '#243544' },
  divTxt: { color: '#5c6f7f', fontSize: 12, fontWeight: '600' },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#16232f', borderColor: '#26404f', borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 10 },
  ic: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#20364a', alignItems: 'center', justifyContent: 'center' },
  icTxt: { fontSize: 20 },
  optTtl: { color: '#f1f4f6', fontSize: 15.5, fontWeight: '700' },
  optDsc: { color: '#8ba0b0', fontSize: 12.5, marginTop: 1 },
  arrow: { color: '#6c7f8f', fontSize: 17 },
  skip: { alignItems: 'center', paddingVertical: 18, marginTop: 6 },
  skipTxt: { color: '#6c7f8f', fontSize: 14, fontWeight: '600' },
});

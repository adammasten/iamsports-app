// Text alerts (Stage 6 UI) — opt in to SMS with a verification code + the required
// consent disclosure (TCPA/carrier: clear terms + "msg & data rates" + STOP at the
// point of opt-in). Cross-platform. Fully gated: if Twilio isn't configured yet, it
// says so gracefully. Verified numbers get "gravity" texts (canceled / time / venue
// changes + snack reminders) via the notification backbone.
import { useTeamContext } from '@/context';
import { checkPhoneCode, loadPhoneStatus, removePhone, sendPhoneCode } from '@/lib/core/phone';
import { goBackOrHome } from '@/lib/nav';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function webSafeAlert(title: string, message: string) {
  if (Platform.OS === 'web') { if (typeof window !== 'undefined') window.alert(message); return; }
  Alert.alert(title, message);
}
function confirmRemove(): Promise<boolean> {
  const q = 'Turn off text alerts and remove your number?';
  return new Promise(resolve => {
    if (Platform.OS === 'web') { resolve(window.confirm(q)); return; }
    Alert.alert('Text alerts', q, [{ text: 'Keep', style: 'cancel', onPress: () => resolve(false) }, { text: 'Turn off', style: 'destructive', onPress: () => resolve(true) }]);
  });
}

export default function TextAlertsScreen() {
  const insets = useSafeAreaInsets();
  const { userId } = useTeamContext();
  const [loading, setLoading] = useState(true);
  const [verifiedPhone, setVerifiedPhone] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notEnabled, setNotEnabled] = useState(false);

  useEffect(() => {
    if (!userId) return;
    loadPhoneStatus(userId).then(s => { if (s.verified) setVerifiedPhone(s.phone); }).catch(() => {}).finally(() => setLoading(false));
  }, [userId]);

  async function onSend() {
    if (!phone.trim()) { webSafeAlert('Text alerts', 'Enter your mobile number.'); return; }
    setBusy(true);
    try {
      const r = await sendPhoneCode(phone);
      if (r.notEnabled) { setNotEnabled(true); return; }
      setCodeSent(true);
    } catch (e: any) { webSafeAlert('Text alerts', e?.message ?? 'Could not send the code.'); }
    finally { setBusy(false); }
  }
  async function onVerify() {
    setBusy(true);
    try {
      const p = await checkPhoneCode(code.trim());
      setVerifiedPhone(p); setCodeSent(false); setCode(''); setPhone('');
      webSafeAlert('Text alerts on', 'Your number is verified. You’ll get texts for canceled games, time/venue changes, and snack reminders.');
    } catch (e: any) { webSafeAlert('Text alerts', e?.message ?? 'Could not verify.'); }
    finally { setBusy(false); }
  }
  async function onRemove() {
    if (!(await confirmRemove())) return;
    setBusy(true);
    try { await removePhone(); setVerifiedPhone(null); } catch (e: any) { webSafeAlert('Text alerts', e?.message ?? 'Could not update.'); }
    finally { setBusy(false); }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 18, paddingBottom: 60, maxWidth: 600, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
      <TouchableOpacity onPress={goBackOrHome} hitSlop={8} style={styles.back}><Text style={styles.backTxt}>← Back</Text></TouchableOpacity>
      <Text style={styles.h1}>📲 Text alerts</Text>
      <Text style={styles.sub}>Get a text for the things that matter — a game canceled, a time or field change, and when you’re on snacks. Push covers the rest.</Text>

      {loading ? <ActivityIndicator color="#ff6a2c" style={{ marginTop: 24 }} /> : notEnabled ? (
        <View style={styles.card}><Text style={styles.notYet}>Text alerts aren’t turned on yet — they’re coming soon. Check back and you’ll be able to add your number here.</Text></View>
      ) : verifiedPhone ? (
        <View style={styles.card}>
          <Text style={styles.onTitle}>✅ Text alerts are on</Text>
          <Text style={styles.onPhone}>{verifiedPhone}</Text>
          <TouchableOpacity style={[styles.removeBtn, busy && { opacity: 0.5 }]} onPress={onRemove} disabled={busy}>
            <Text style={styles.removeTxt}>Turn off &amp; remove number</Text>
          </TouchableOpacity>
        </View>
      ) : !codeSent ? (
        <View style={styles.card}>
          <Text style={styles.label}>Mobile number</Text>
          <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="(555) 123-4567" placeholderTextColor="#667" keyboardType="phone-pad" autoComplete="tel" />
          <Text style={styles.consent}>
            By tapping “Send code,” you agree to receive team schedule alerts from IamSports at this number (game/practice changes, snack reminders). Message frequency varies. Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help.{' '}
            <Text style={styles.link} onPress={() => router.push('/terms')}>Terms</Text> · <Text style={styles.link} onPress={() => router.push('/privacy')}>Privacy</Text>
          </Text>
          <TouchableOpacity style={[styles.primary, busy && { opacity: 0.5 }]} onPress={onSend} disabled={busy}>
            <Text style={styles.primaryTxt}>{busy ? 'Sending…' : 'Send code'}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.label}>Enter the 6-digit code we texted you</Text>
          <TextInput style={[styles.input, { letterSpacing: 6, textAlign: 'center', fontSize: 22 }]} value={code} onChangeText={setCode} placeholder="000000" placeholderTextColor="#667" keyboardType="number-pad" maxLength={6} autoFocus />
          <TouchableOpacity style={[styles.primary, (busy || code.trim().length !== 6) && { opacity: 0.5 }]} onPress={onVerify} disabled={busy || code.trim().length !== 6}>
            <Text style={styles.primaryTxt}>{busy ? 'Verifying…' : 'Verify'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setCodeSent(false); setCode(''); }} style={{ paddingVertical: 10, alignItems: 'center' }}>
            <Text style={styles.altTxt}>Use a different number</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e1b2c' },
  back: { alignSelf: 'flex-start', paddingVertical: 6 },
  backTxt: { color: '#ff6a2c', fontSize: 14, fontWeight: '700' },
  h1: { color: '#f1f4f6', fontSize: 26, fontWeight: '800', marginTop: 4 },
  sub: { color: '#9db0bd', fontSize: 14, marginTop: 6, marginBottom: 16, lineHeight: 20 },
  card: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 14, padding: 16 },
  label: { color: '#8b7bff', fontSize: 12, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 },
  input: { backgroundColor: '#0e1b2c', borderColor: '#25333f', borderWidth: 1, borderRadius: 10, color: '#f1f4f6', paddingHorizontal: 12, paddingVertical: 12, fontSize: 16 },
  consent: { color: '#8b96a3', fontSize: 12, lineHeight: 18, marginTop: 12 },
  link: { color: '#8b7bff', fontWeight: '700' },
  primary: { backgroundColor: '#ff6a2c', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  primaryTxt: { color: '#160b02', fontSize: 16, fontWeight: '800' },
  altTxt: { color: '#9db0bd', fontSize: 13, fontWeight: '700' },
  onTitle: { color: '#3ec46d', fontSize: 16, fontWeight: '800' },
  onPhone: { color: '#f1f4f6', fontSize: 18, fontWeight: '700', marginTop: 6 },
  removeBtn: { marginTop: 18, alignItems: 'center', paddingVertical: 12 },
  removeTxt: { color: '#c0392b', fontSize: 14, fontWeight: '700' },
  notYet: { color: '#c7d2dc', fontSize: 14, lineHeight: 21 },
});

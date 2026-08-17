import { supabase } from '@/supabase';
import * as Linking from 'expo-linking';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

// Login is the bridge between the (light) marketing landing and the (dark) app.
// On WEB it matches the landing — cream/ink/orange — for a seamless hand-off from
// iamsports.com; on NATIVE it stays dark to match the app you drop into. The
// ?signup=1 param (from the landing's "Get started") opens the create-account form.
const isWeb = Platform.OS === 'web';
const DISPLAY = isWeb ? 'Barlow Condensed' : undefined;
const BODY = isWeb ? 'Barlow' : undefined;
const T = isWeb
  ? { bg: '#FAF9F6', text: '#0E1B2C', sub: '#415062', border: '#E4E0D8', primary: '#F25C1F', ph: '#9aa0a8', onPrimary: '#fff' }
  : { bg: '#000', text: '#fff', sub: '#aaa', border: '#333', primary: '#534AB7', ph: '#888888', onPrimary: '#fff' };

export default function LoginScreen() {
  const { signup } = useLocalSearchParams<{ signup?: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(signup === '1');
  // Passwordless (magic-link + OTP) state. otpSent flips the UI to code entry.
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');

  async function handleAuth() {
    setLoading(true);
    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) Alert.alert('Error', error.message);
      else Alert.alert('Success!', 'Check your email to confirm your account!');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) Alert.alert('Error', error.message);
    }
    setLoading(false);
  }

  // Passwordless send: one signInWithOtp call delivers BOTH a magic link
  // (emailRedirectTo) and an 8-digit code ({{ .Token }} in the email template).
  // shouldCreateUser:true means this also works as sign-up.
  async function sendOtp() {
    if (!email) { Alert.alert('Enter your email first'); return; }
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: Linking.createURL('/'),
        shouldCreateUser: true,
      },
    });
    setLoading(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setOtpSent(true);
    Alert.alert('Check your email', `We sent an 8-digit code (and a sign-in link) to ${email}. Enter the code below.`);
  }

  // OTP code path — works WITHOUT deep-linking. On success we do NOT navigate;
  // the AuthGate resolver in _layout.tsx routes once the session is set.
  async function verifyCode() {
    if (!otpCode.trim()) { Alert.alert('Enter the code from your email'); return; }
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({ email, token: otpCode.trim(), type: 'email' });
    setLoading(false);
    if (error) Alert.alert('Invalid or expired code', error.message);
    // success → AuthGate handles routing (no router.replace here).
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
      <View style={styles.card}>
      <Text style={styles.wordmark}>IAM<Text style={{ color: T.primary }}>SPORTS</Text></Text>
      {otpSent ? (
        <>
          <Text style={styles.subtitle}>Enter your code</Text>
          <Text style={styles.hint}>We emailed an 8-digit code to {email}.</Text>
          <TextInput
            style={styles.input}
            placeholder="8-digit code"
            placeholderTextColor={T.ph}
            value={otpCode}
            onChangeText={setOtpCode}
            keyboardType="number-pad"
            autoCapitalize="none"
            maxLength={8}
            autoFocus
          />
          <TouchableOpacity style={styles.button} onPress={verifyCode} disabled={loading}>
            <Text style={styles.buttonText}>{loading ? 'Verifying...' : 'Verify code'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={sendOtp} disabled={loading}>
            <Text style={styles.toggle}>Resend code</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setOtpSent(false); setOtpCode(''); }}>
            <Text style={styles.toggle}>← Use email &amp; password instead</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.subtitle}>{isSignUp ? 'Create your account' : 'Welcome back, coach.'}</Text>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={T.ph}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={T.ph}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <TouchableOpacity style={styles.button} onPress={handleAuth} disabled={loading}>
            <Text style={styles.buttonText}>{loading ? 'Loading...' : isSignUp ? 'Sign Up' : 'Log In'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setIsSignUp(!isSignUp)}>
            <Text style={styles.toggle}>{isSignUp ? 'Already have an account? Log in' : "Don't have an account? Sign up"}</Text>
          </TouchableOpacity>

          <View style={styles.divider}>
            <Text style={styles.dividerText}>or</Text>
          </View>

          <TouchableOpacity style={styles.secondaryButton} onPress={sendOtp} disabled={loading}>
            <Text style={styles.secondaryButtonText}>Email me a sign-in code</Text>
          </TouchableOpacity>
        </>
      )}
      </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.bg },
  container: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  // Centered, capped-width card. Web gets a white card (matches the landing); native
  // stays chrome-less on the dark screen so it never reaches the cap on a phone.
  card: {
    width: '100%', maxWidth: 400, alignSelf: 'center', alignItems: 'center',
    ...(isWeb ? { backgroundColor: '#fff', borderWidth: 1, borderColor: T.border, borderRadius: 18, padding: 32 } : {}),
  },
  wordmark: { fontFamily: DISPLAY, fontStyle: 'italic', fontWeight: '800', fontSize: 34, letterSpacing: -0.5, color: T.text, marginBottom: 6 },
  subtitle: { fontFamily: BODY, fontSize: 16, color: T.sub, marginBottom: 28, textAlign: 'center' },
  input: { width: '100%', borderWidth: 1, borderColor: T.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 12, fontSize: 16, color: T.text, backgroundColor: isWeb ? '#fff' : 'transparent', fontFamily: BODY },
  button: { width: '100%', backgroundColor: T.primary, borderRadius: 10, padding: 15, alignItems: 'center', marginBottom: 14 },
  buttonText: { color: T.onPrimary, fontSize: 16, fontWeight: '700', fontFamily: BODY },
  toggle: { color: T.primary, fontSize: 14, fontWeight: '600', fontFamily: BODY, marginBottom: 4, textAlign: 'center' },
  hint: { color: T.sub, fontSize: 13, marginBottom: 16, textAlign: 'center', fontFamily: BODY },
  divider: { marginVertical: 14 },
  dividerText: { color: T.sub, fontSize: 13, fontFamily: BODY },
  secondaryButton: { width: '100%', borderWidth: 1.5, borderColor: isWeb ? T.text : T.primary, borderRadius: 10, padding: 14, alignItems: 'center' },
  secondaryButtonText: { color: isWeb ? T.text : T.primary, fontSize: 15, fontWeight: '700', fontFamily: BODY },
});

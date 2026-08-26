import { supabase } from '@/supabase';
import * as Linking from 'expo-linking';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

// Login is the bridge between the (light) marketing landing and the (dark) app.
// On WEB it matches the landing — cream/ink/orange; on NATIVE it stays dark.
// ?signup=1 (from the landing's "Get started") opens the create-account form.
//
// ALL feedback is shown INLINE (state-driven), never via Alert.alert. On the web
// Alert maps to window.alert(), and mobile browsers SILENTLY SUPPRESS an alert()
// fired after an `await` (the tap's user-gesture is gone) — which is why "check
// your email" never appeared after signup. Inline messages are reliable everywhere.
const isWeb = Platform.OS === 'web';
const DISPLAY = isWeb ? 'Barlow Condensed' : undefined;
const BODY = isWeb ? 'Barlow' : undefined;
const T = isWeb
  ? { bg: '#FAF9F6', text: '#0E1B2C', sub: '#415062', border: '#E4E0D8', primary: '#F25C1F', ph: '#9aa0a8', onPrimary: '#fff', error: '#c0271a' }
  : { bg: '#000', text: '#fff', sub: '#aaa', border: '#333', primary: '#534AB7', ph: '#888888', onPrimary: '#fff', error: '#ff6b6b' };

export default function LoginScreen() {
  const { signup } = useLocalSearchParams<{ signup?: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(signup === '1');
  // Passwordless (magic-link + OTP) state. otpSent flips the UI to code entry.
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  // Inline feedback (see file header — no Alert.alert on web).
  const [authError, setAuthError] = useState<string | null>(null);
  const [signupSent, setSignupSent] = useState(false);

  async function handleAuth() {
    setAuthError(null);
    if (!email || !password) { setAuthError('Enter your email and a password.'); return; }
    setLoading(true);
    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password });
      setLoading(false);
      if (error) { setAuthError(error.message); return; }
      setSignupSent(true);   // → the inline "Check your email" screen
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (error) setAuthError(error.message);
      // success → AuthGate (in _layout.tsx) routes; nothing to do here.
    }
  }

  async function resendSignup() {
    setAuthError(null);
    setLoading(true);
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    setLoading(false);
    if (error) setAuthError(error.message);
  }

  // Passwordless send: one signInWithOtp delivers BOTH a magic link and an 8-digit
  // code. otpSent switching the view IS the on-screen confirmation.
  async function sendOtp() {
    setAuthError(null);
    if (!email) { setAuthError('Enter your email first.'); return; }
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: Linking.createURL('/'), shouldCreateUser: true },
    });
    setLoading(false);
    if (error) { setAuthError(error.message); return; }
    setOtpSent(true);
  }

  async function verifyCode() {
    setAuthError(null);
    if (!otpCode.trim()) { setAuthError('Enter the code from your email.'); return; }
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({ email, token: otpCode.trim(), type: 'email' });
    setLoading(false);
    if (error) setAuthError('Invalid or expired code. Please try again.');
    // success → AuthGate handles routing.
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

      {signupSent ? (
        <>
          <Text style={styles.bigIcon}>✉️</Text>
          <Text style={styles.subtitle}>Check your email</Text>
          <Text style={styles.hint}>We sent a confirmation link to {email}. Tap it to finish creating your account, then come back here and log in.</Text>
          {authError ? <Text style={styles.error}>{authError}</Text> : null}
          <TouchableOpacity style={styles.button} onPress={() => { setSignupSent(false); setIsSignUp(false); setPassword(''); setAuthError(null); }}>
            <Text style={styles.buttonText}>Back to log in</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={resendSignup} disabled={loading}>
            <Text style={styles.toggle}>{loading ? 'Sending…' : "Didn't get it? Resend email"}</Text>
          </TouchableOpacity>
        </>
      ) : otpSent ? (
        <>
          <Text style={styles.subtitle}>Enter your code</Text>
          <Text style={styles.hint}>We emailed an 8-digit code to {email}.</Text>
          <TextInput
            style={styles.input}
            placeholder="8-digit code"
            placeholderTextColor={T.ph}
            value={otpCode}
            onChangeText={t => { setOtpCode(t); setAuthError(null); }}
            keyboardType="number-pad"
            autoCapitalize="none"
            maxLength={8}
            autoFocus
          />
          {authError ? <Text style={styles.error}>{authError}</Text> : null}
          <TouchableOpacity style={styles.button} onPress={verifyCode} disabled={loading}>
            <Text style={styles.buttonText}>{loading ? 'Verifying...' : 'Verify code'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={sendOtp} disabled={loading}>
            <Text style={styles.toggle}>Resend code</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setOtpSent(false); setOtpCode(''); setAuthError(null); }}>
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
            onChangeText={t => { setEmail(t); setAuthError(null); }}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={T.ph}
            value={password}
            onChangeText={t => { setPassword(t); setAuthError(null); }}
            secureTextEntry
          />
          {authError ? <Text style={styles.error}>{authError}</Text> : null}
          <TouchableOpacity style={styles.button} onPress={handleAuth} disabled={loading}>
            <Text style={styles.buttonText}>{loading ? 'Loading...' : isSignUp ? 'Sign Up' : 'Log In'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setIsSignUp(!isSignUp); setAuthError(null); }}>
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

      {/* Public legal links — discoverable to a logged-out visitor / A2P reviewer.
          These open the STANDALONE static pages (not the in-app routes), so they
          load clean with no app chrome and no redirect. */}
      {isWeb ? (
        <View style={styles.legalRow}>
          <Text style={styles.legalLink} onPress={() => Linking.openURL('https://www.iamsports.com/legal/privacy')}>Privacy Policy</Text>
          <Text style={styles.legalDot}> · </Text>
          <Text style={styles.legalLink} onPress={() => Linking.openURL('https://www.iamsports.com/legal/terms')}>Terms of Use</Text>
        </View>
      ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.bg },
  container: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%', maxWidth: 400, alignSelf: 'center', alignItems: 'center',
    ...(isWeb ? { backgroundColor: '#fff', borderWidth: 1, borderColor: T.border, borderRadius: 18, padding: 32 } : {}),
  },
  wordmark: { fontFamily: DISPLAY, fontStyle: 'italic', fontWeight: '800', fontSize: 34, letterSpacing: -0.5, color: T.text, marginBottom: 6 },
  bigIcon: { fontSize: 44, marginTop: 6, marginBottom: 4 },
  subtitle: { fontFamily: BODY, fontSize: 16, color: T.sub, marginBottom: 20, textAlign: 'center' },
  input: { width: '100%', borderWidth: 1, borderColor: T.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 12, fontSize: 16, color: T.text, backgroundColor: isWeb ? '#fff' : 'transparent', fontFamily: BODY },
  error: { width: '100%', color: T.error, fontSize: 13, fontWeight: '600', fontFamily: BODY, textAlign: 'center', marginBottom: 12 },
  button: { width: '100%', backgroundColor: T.primary, borderRadius: 10, padding: 15, alignItems: 'center', marginBottom: 14 },
  buttonText: { color: T.onPrimary, fontSize: 16, fontWeight: '700', fontFamily: BODY },
  toggle: { color: T.primary, fontSize: 14, fontWeight: '600', fontFamily: BODY, marginBottom: 4, textAlign: 'center' },
  hint: { color: T.sub, fontSize: 13, marginBottom: 16, textAlign: 'center', fontFamily: BODY, lineHeight: 19 },
  divider: { marginVertical: 14 },
  dividerText: { color: T.sub, fontSize: 13, fontFamily: BODY },
  secondaryButton: { width: '100%', borderWidth: 1.5, borderColor: isWeb ? T.text : T.primary, borderRadius: 10, padding: 14, alignItems: 'center' },
  secondaryButtonText: { color: isWeb ? T.text : T.primary, fontSize: 15, fontWeight: '700', fontFamily: BODY },
  legalRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 22 },
  legalLink: { color: T.sub, fontSize: 13, fontFamily: BODY, fontWeight: '600', textDecorationLine: 'underline' },
  legalDot: { color: T.sub, fontSize: 13, fontFamily: BODY },
});

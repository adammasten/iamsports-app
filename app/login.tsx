import { supabase } from '@/supabase';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
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
      <Text style={styles.title}>🏀 IamSports</Text>
      {otpSent ? (
        <>
          <Text style={styles.subtitle}>Enter your code</Text>
          <Text style={styles.hint}>We emailed an 8-digit code to {email}.</Text>
          <TextInput
            style={styles.input}
            placeholder="8-digit code"
            placeholderTextColor="#888888"
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
          <Text style={styles.subtitle}>{isSignUp ? 'Create account' : 'Welcome back'}</Text>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#888888"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#888888"
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  container: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 36, marginBottom: 8, color: '#fff' },
  subtitle: { fontSize: 18, color: '#aaa', marginBottom: 32 },
  input: { width: '100%', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 14, marginBottom: 12, fontSize: 16, color: '#FFFFFF' },
  button: { width: '100%', backgroundColor: '#534AB7', borderRadius: 8, padding: 16, alignItems: 'center', marginBottom: 16 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  toggle: { color: '#534AB7', fontSize: 14 },
  hint: { color: '#aaa', fontSize: 13, marginBottom: 16, textAlign: 'center' },
  divider: { marginVertical: 16 },
  dividerText: { color: '#666', fontSize: 13 },
  secondaryButton: { width: '100%', borderWidth: 1, borderColor: '#534AB7', borderRadius: 8, padding: 16, alignItems: 'center' },
  secondaryButtonText: { color: '#534AB7', fontSize: 16, fontWeight: '600' },
});
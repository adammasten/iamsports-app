import { supabase } from '@/supabase';
import { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);

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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🏀 IamSports</Text>
      <Text style={styles.subtitle}>{isSignUp ? 'Create account' : 'Welcome back'}</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 36, marginBottom: 8 },
  subtitle: { fontSize: 18, color: '#666', marginBottom: 32 },
  input: { width: '100%', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 14, marginBottom: 12, fontSize: 16 },
  button: { width: '100%', backgroundColor: '#534AB7', borderRadius: 8, padding: 16, alignItems: 'center', marginBottom: 16 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  toggle: { color: '#534AB7', fontSize: 14 },
});
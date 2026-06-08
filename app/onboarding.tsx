import { router } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

// STUB onboarding screen. The post-login resolver in app/_layout.tsx routes
// brand-new users (zero confirmed team memberships) here — and, for now,
// pending-invite-only users too (see the TODO in _layout.tsx). The real
// "how will you use IamSports?" flow is a separate task; this placeholder just
// gives new users a way forward (create/join a team via select-team).
export default function OnboardingScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to IamSports 🏀</Text>
      <Text style={styles.body}>
        Let&apos;s get you set up. Full onboarding is coming soon — for now you can
        create or join a team to get started.
      </Text>
      <TouchableOpacity style={styles.btn} onPress={() => router.replace('/select-team')}>
        <Text style={styles.btnText}>Get started</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  title: { fontSize: 26, fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  body: { fontSize: 15, color: '#666', textAlign: 'center', marginBottom: 28, lineHeight: 21 },
  btn: { backgroundColor: '#534AB7', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

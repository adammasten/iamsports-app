import { SUPPORT_EMAIL } from '@/constants/legal';
import { colors } from '@/constants/theme';
import { supabase } from '@/supabase';
import { router } from 'expo-router';
import { goBackOrHome } from '@/lib/nav';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Account controls. Two very different "leaving" paths, deliberately ranked:
//   • Deactivate (top, friendly) — reversible; NOTHING is deleted. Log back in
//     and everything's restored (see reactivate_my_account in the auth gate).
//   • Delete (bottom, destructive) — permanent. Removes the account + personal
//     data; team-shared film stays with the team (Option B, see the
//     delete-account Edge Function). Apple requires a real deletion path.
export default function AccountScreen() {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    await supabase.auth.signOut(); // AuthGate routes to /login when the session clears.
  }

  function confirmDeactivate() {
    Alert.alert(
      'Deactivate account',
      'Your teams, film, clips, and reels all stay saved — nothing is deleted. You’ll be signed out; log back in anytime to pick up exactly where you left off.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deactivate',
          onPress: async () => {
            setBusy(true);
            const { error } = await supabase.rpc('deactivate_my_account');
            if (error) { setBusy(false); Alert.alert('Error', error.message); return; }
            await supabase.auth.signOut();
            setBusy(false);
          },
        },
      ],
    );
  }

  function confirmDelete() {
    Alert.alert(
      'Delete account?',
      'This permanently deletes your account and personal data — your login, profile, personal uploads, and reels. It can’t be undone.\n\nFilm you shared with a team stays with the team so other coaches don’t lose it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete forever',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            const { error } = await supabase.functions.invoke('delete-account');
            if (error) { setBusy(false); Alert.alert('Couldn’t delete account', error.message); return; }
            await supabase.auth.signOut();
            setBusy(false);
          },
        },
      ],
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <TouchableOpacity onPress={goBackOrHome} style={styles.back}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
      <Text style={styles.title}>Account</Text>

      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        {/* Friendly, reversible — the one we want people to reach for. */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Take a break</Text>
          <Text style={styles.cardBody}>Step away without losing anything. Your teams, film, clips, and reels stay exactly as they are — come back whenever and log right back in.</Text>
          <TouchableOpacity style={styles.btnPrimary} onPress={confirmDeactivate} disabled={busy}>
            <Text style={styles.btnPrimaryText}>Deactivate my account</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.signOutRow} onPress={signOut} disabled={busy}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Help &amp; safety</Text>
          <Text style={styles.cardBody}>Report content or block a user by long-pressing it anywhere it&apos;s shared. Questions or concerns — reach us anytime.</Text>
          <TouchableOpacity style={styles.linkRow} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}>
            <Text style={styles.linkText}>Contact support</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.linkRow} onPress={() => router.push('/terms')}>
            <Text style={styles.linkText}>Terms of Use</Text>
          </TouchableOpacity>
        </View>

        {/* Permanent — clearly the serious one, at the bottom. */}
        <View style={[styles.card, styles.dangerCard]}>
          <Text style={styles.dangerTitle}>Delete account</Text>
          <Text style={styles.cardBody}>Permanently deletes your account and personal data — login, profile, personal uploads, and reels. Film you shared with a team stays with the team. This can’t be undone.</Text>
          <TouchableOpacity style={styles.btnDanger} onPress={confirmDelete} disabled={busy}>
            <Text style={styles.btnDangerText}>Delete my account</Text>
          </TouchableOpacity>
        </View>

        {busy ? <ActivityIndicator style={{ marginTop: 20 }} color={colors.brand} /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20 },
  back: { paddingVertical: 8 },
  backText: { color: colors.brand, fontSize: 16 },
  title: { color: colors.text, fontSize: 28, fontWeight: '700', marginBottom: 16, marginTop: 8 },

  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 18, borderWidth: 1, borderColor: colors.border, marginBottom: 16 },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 6 },
  cardBody: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 14 },

  btnPrimary: { backgroundColor: colors.brand, borderRadius: 8, padding: 14, alignItems: 'center' },
  btnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  signOutRow: { padding: 14, alignItems: 'center', marginBottom: 24 },
  signOutText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  linkRow: { paddingVertical: 8 },
  linkText: { color: colors.brandLight, fontSize: 15, fontWeight: '600' },

  dangerCard: { borderColor: colors.danger },
  dangerTitle: { color: colors.danger, fontSize: 17, fontWeight: '700', marginBottom: 6 },
  btnDanger: { borderWidth: 1, borderColor: colors.danger, borderRadius: 8, padding: 14, alignItems: 'center' },
  btnDangerText: { color: colors.danger, fontSize: 15, fontWeight: '700' },
});

import { SUPPORT_EMAIL } from '@/constants/legal';
import { colors } from '@/constants/theme';
import { useTeamContext } from '@/context';
import { supabase } from '@/supabase';
import { confirm } from '@/lib/confirm';
import { router } from 'expo-router';
import { goBackOrHome } from '@/lib/nav';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { webAlert } from '@/lib/webAlert';
import { isWebPushInstallGated, requestWebPushPermission, webPushStatus } from '@/lib/native/push';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// 🧪 Phase 0b spike toggle — shows the background-upload test card even in a
// TestFlight/release build. Set to false (or delete the card) once 0b is done.
const SPIKE_SHOW_BG_TEST = false;

// Account controls. Two very different "leaving" paths, deliberately ranked:
//   • Deactivate (top, friendly) — reversible; NOTHING is deleted. Log back in
//     and everything's restored (see reactivate_my_account in the auth gate).
//   • Delete (bottom, destructive) — permanent. Removes the account + personal
//     data; team-shared film stays with the team (Option B, see the
//     delete-account Edge Function). Apple requires a real deletion path.
export default function AccountScreen() {
  const insets = useSafeAreaInsets();
  const { userId } = useTeamContext();
  const [busy, setBusy] = useState(false);

  // Push notifications. 'install-required' is the iOS-Safari-without-Home-Screen
  // case, which is a real state rather than a failure — the card explains it
  // instead of showing a button that could never work.
  const [pushState, setPushState] =
    useState<'granted' | 'denied' | 'default' | 'unsupported' | 'install-required'>('default');
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    setPushState(isWebPushInstallGated() ? 'install-required' : webPushStatus());
  }, []);

  async function enablePush() {
    if (!userId) return;
    setPushBusy(true);
    const result = await requestWebPushPermission(userId);
    setPushBusy(false);
    setPushState(result === 'unsupported' ? 'unsupported' : result);
    if (result === 'denied') {
      webAlert('Notifications blocked', 'Turn notifications back on for IamSports in your browser or system settings, then try again.');
    }
  }

  // Display name — what teams/families see on your shares and coach comments.
  // Reuses the same set_my_display_name RPC the first-run name gate uses.
  const [name, setName] = useState('');
  const [nameLoading, setNameLoading] = useState(true);
  const [nameSaving, setNameSaving] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('user_profiles').select('display_name').eq('user_id', userId).maybeSingle();
      if (!cancelled) { setName(data?.display_name ?? ''); setNameLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  async function saveName() {
    const next = name.trim();
    if (!next) { webAlert('Name required', 'Enter what you’d like to be called.'); return; }
    setNameSaving(true);
    const { error } = await supabase.rpc('set_my_display_name', { p_name: next });
    setNameSaving(false);
    if (error) { webAlert('Error', error.message); return; }
    webAlert('Saved', `You’ll show as “${next}” on your shares and comments.`);
  }

  async function signOut() {
    await supabase.auth.signOut(); // AuthGate routes to /login when the session clears.
  }

  async function confirmDeactivate() {
    const ok = await confirm({
      title: 'Deactivate account',
      message: 'Your teams, film, clips, and reels all stay saved — nothing is deleted. You’ll be signed out; log back in anytime to pick up exactly where you left off.',
      confirmText: 'Deactivate',
    });
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.rpc('deactivate_my_account');
    if (error) { setBusy(false); webAlert('Error', error.message); return; }
    await supabase.auth.signOut();
    setBusy(false);
  }

  async function confirmDelete() {
    const ok = await confirm({
      title: 'Delete account?',
      message: 'This permanently deletes your account and personal data — your login, profile, personal uploads, and reels. It can’t be undone.\n\nFilm you shared with a team stays with the team so other coaches don’t lose it.',
      confirmText: 'Delete forever', destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.functions.invoke('delete-account');
    if (error) { setBusy(false); webAlert('Couldn’t delete account', error.message); return; }
    await supabase.auth.signOut();
    setBusy(false);
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <TouchableOpacity onPress={goBackOrHome} style={styles.back}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
      <Text style={styles.title}>Account</Text>

      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        {/* Display name — shown on your shares + coach comments. */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your name</Text>
          <Text style={styles.cardBody}>What teams and families see when you share or comment. Use whatever you like — “Coach Masten,” your name, or a nickname.</Text>
          {nameLoading ? (
            <ActivityIndicator color={colors.brand} />
          ) : (
            <>
              <TextInput
                style={styles.nameInput}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Coach Masten"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="words"
                maxLength={60}
                editable={!nameSaving}
              />
              <TouchableOpacity style={styles.btnPrimary} onPress={saveName} disabled={nameSaving}>
                <Text style={styles.btnPrimaryText}>{nameSaving ? 'Saving…' : 'Save name'}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Push notifications. One card for all three platforms: the app uses
            expo-notifications, the web app and mobile browser use Web Push.
            Both register into device_push_tokens, so this reads the same either
            way. Permission is only ever requested from this button — never on
            page load, which is the fastest way to get permanently blocked. */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🔔 Push notifications</Text>
          <Text style={styles.cardBody}>
            {pushState === 'granted'
              ? 'On for this device. You’ll get a heads-up when new film lands, someone shares with your kid, or a game changes.'
              : pushState === 'denied'
                ? 'Blocked for this device. Turn notifications back on for IamSports in your browser or system settings, then come back.'
                : pushState === 'install-required'
                  ? 'On iPhone, Safari only allows notifications once IamSports is on your Home Screen. Tap Share → “Add to Home Screen”, open it from there, then turn this on.'
                  : 'Get a heads-up when new film lands, someone shares with your kid, or a game changes.'}
          </Text>
          {pushState !== 'granted' && pushState !== 'denied' && (
            <TouchableOpacity style={styles.btnPrimary} onPress={enablePush} disabled={pushBusy}>
              <Text style={styles.btnPrimaryText}>
                {pushBusy ? 'Turning on…' : 'Turn on notifications'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Text alerts — opt in to SMS for schedule disruptions + snack reminders. */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>📲 Text alerts</Text>
          <Text style={styles.cardBody}>Get a text when a game is canceled, a time or field changes, or you’re on snacks. Push covers everything else.</Text>
          <TouchableOpacity style={styles.btnPrimary} onPress={() => router.push('/text-alerts')}>
            <Text style={styles.btnPrimaryText}>Manage text alerts</Text>
          </TouchableOpacity>
        </View>

        {/* 🧪 Phase 0b background-upload spike harness. Visible in TestFlight too
            (a plain __DEV__ gate would hide it in a release build). Flip
            SPIKE_SHOW_BG_TEST to false / remove this card when 0b is done. */}
        {SPIKE_SHOW_BG_TEST && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>🧪 Dev: Background upload test</Text>
            <TouchableOpacity style={styles.btnPrimary} onPress={() => router.push('/bg-upload-test')}>
              <Text style={styles.btnPrimaryText}>Open BG upload test</Text>
            </TouchableOpacity>
          </View>
        )}

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
          <TouchableOpacity style={styles.linkRow} onPress={() => router.push('/privacy')}>
            <Text style={styles.linkText}>Privacy Policy</Text>
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
  nameInput: { backgroundColor: colors.bg, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 12, color: colors.text, fontSize: 16, marginBottom: 12 },

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

import { TeamProvider, useTeamContext } from '@/context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { reconcilePendingUploads } from '@/lib/native/upload-reconcile';
import { reconcile as reconcileVideoCache } from '@/lib/native/video-cache';
import { supabase } from '@/supabase';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, router, useRootNavigationState, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, View } from 'react-native';
import 'react-native-reanimated';
import { TERMS_VERSION } from '@/constants/legal';
import NameCaptureSheet from './components/NameCaptureSheet';
import TermsAcceptSheet from './components/TermsAcceptSheet';

export const unstable_settings = {
  anchor: '(tabs)',
};

// Role-aware post-login resolver. Lives INSIDE <TeamProvider> so it can read the
// already-computed session + membership state (no duplicate queries). This is
// the SINGLE routing chokepoint — no other file should call router.replace for
// auth/landing decisions.
function AuthGate() {
  const { sessionResolved, userId, membershipsLoaded, kidsLoaded, userTeams, userKids } = useTeamContext();
  const navState = useRootNavigationState();
  const pathname = usePathname();
  const colorScheme = useColorScheme();
  const [booted, setBooted] = useState(false);
  // Which user we've already routed for — so we DON'T re-route on later
  // membership refreshes or token-refresh auth events (which would yank the
  // user out of whatever screen they're on).
  const decidedForUserRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!navState?.key) return;       // navigator not mounted yet — can't route
    if (!sessionResolved) return;     // session not determined yet → keep loading

    // Logged OUT (or just logged out).
    if (!userId) {
      // Public web pages a logged-out visitor is allowed to sit on (don't yank them
      // to the landing): the landing itself, login, and the legal pages.
      const onPublic = ['/landing', '/login', '/terms', '/privacy'].some(r => pathname === r || pathname.startsWith(r + '/'));
      if (decidedForUserRef.current !== null) {
        decidedForUserRef.current = null;
        // Web gets the marketing landing as the front door; native goes straight
        // to login. But never bounce a logged-out visitor off a public web page.
        if (!(Platform.OS === 'web' && onPublic)) {
          router.replace(Platform.OS === 'web' ? '/landing' : '/login');
        }
      }
      setBooted(true);
      return;
    }

    // Logged in: wait for BOTH memberships and kids before deciding. Both flags are
    // derived from userId in context, so they're reliably false until THIS user's
    // data has loaded (no stale-loaded race). We therefore NEVER reach the
    // teams/kids check below while still loading — critical so a guardian who's
    // only claimed a kid isn't mistaken for empty and sent to onboarding.
    if (!membershipsLoaded || !kidsLoaded) return;

    // Decide exactly once per user (cold start or fresh login).
    if (decidedForUserRef.current !== userId) {
      decidedForUserRef.current = userId;
      // Preserve an explicit deep-link the user opened directly (the Playbook
      // routes) — don't yank a logged-in user to home on cold start when they
      // asked for a specific route. Scoped to /playbook* so it can't change
      // normal login/landing routing.
      if (pathname.startsWith('/playbook') || pathname.startsWith('/my-playbook')) {
        // leave them where they navigated
      } else if (userTeams.length === 0 && userKids.length === 0) {
        // TRULY new user: no confirmed team memberships AND no linked kids → onboarding.
        // A guardian who's only claimed a child (kid, no team) has userKids > 0, so
        // they skip this and land straight on home — no Welcome screen every launch.
        // TODO(pending-invites): when the invite system exists, branch here — a
        // user with pending invites (and no confirmed memberships) should go to
        // an invite-accept screen. Until then, pending-invite-only users
        // intentionally fall through to onboarding.
        router.replace('/onboarding');   // STUB screen — real onboarding is a separate task
      } else {
        // Has a confirmed team OR a linked kid → into the working app. (Role-aware
        // home ordering is a later task; everyone lands here for now.)
        router.replace('/select-team');
      }
    }
    setBooted(true);
  }, [navState?.key, sessionResolved, userId, membershipsLoaded, kidsLoaded, userTeams.length, userKids.length, pathname]);

  if (!booted) {
    return (
      <View style={[styles.loadingGate, { backgroundColor: colorScheme === 'dark' ? '#000' : '#fff' }]}>
        <ActivityIndicator size="large" color="#534AB7" />
      </View>
    );
  }
  return null;
}

// First-run display-name capture. Independent of AuthGate's routing — it never
// calls router.replace; it just overlays a bottom sheet on top of whatever the
// app routed to. Runs once per user on session resolve: reads the caller's own
// user_profiles row and, if display_name is null/empty, prompts for one.
function NameCaptureGate() {
  const { sessionResolved, userId } = useTeamContext();
  const [needsName, setNeedsName] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Which user we've already run the name check for — avoids re-prompting on
  // token-refresh auth events or re-renders.
  const checkedForUserRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!sessionResolved) return;
    if (!userId) { setNeedsName(false); checkedForUserRef.current = null; return; }
    if (checkedForUserRef.current === userId) return;
    checkedForUserRef.current = userId;

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('display_name, deactivated_at')
        .eq('user_id', userId)
        .maybeSingle();
      if (cancelled) return;
      // On error (e.g. migration not yet applied) don't block the app — skip.
      if (error) { setNeedsName(false); return; }
      // Logging back in reactivates a deactivated account — "come back anytime".
      if (data?.deactivated_at) supabase.rpc('reactivate_my_account').then(() => {});
      const name = data?.display_name;
      setNeedsName(!name || name.trim() === '');
    })();
    return () => { cancelled = true; };
  }, [sessionResolved, userId]);

  async function handleSubmit(name: string) {
    setSubmitting(true);
    const { error } = await supabase.rpc('set_my_display_name', { p_name: name.trim() });
    setSubmitting(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setNeedsName(false);
  }

  if (!needsName) return null;
  return <NameCaptureSheet onSubmit={handleSubmit} submitting={submitting} />;
}

// First-login Terms/EULA gate (App Store Guideline 1.2 — affirmative agreement
// before posting UGC). Blocks the app until the user accepts the current terms
// version, or declines and signs out. Mirrors NameCaptureGate's once-per-user
// check. Skips silently on error (e.g. migration not yet applied).
function TermsGate() {
  const { sessionResolved, userId } = useTeamContext();
  const [needsAccept, setNeedsAccept] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const checkedForUserRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!sessionResolved) return;
    if (!userId) { setNeedsAccept(false); checkedForUserRef.current = null; return; }
    if (checkedForUserRef.current === userId) return;
    checkedForUserRef.current = userId;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('user_profiles').select('accepted_terms_version').eq('user_id', userId).maybeSingle();
      if (cancelled) return;
      if (error) { setNeedsAccept(false); return; }
      setNeedsAccept((data?.accepted_terms_version ?? 0) < TERMS_VERSION);
    })();
    return () => { cancelled = true; };
  }, [sessionResolved, userId]);

  async function accept() {
    setSubmitting(true);
    const { error } = await supabase.rpc('accept_terms', { p_version: TERMS_VERSION });
    setSubmitting(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setNeedsAccept(false);
  }
  async function decline() {
    setNeedsAccept(false);
    await supabase.auth.signOut();
  }

  if (!needsAccept) return null;
  return <TermsAcceptSheet onAccept={accept} onDecline={decline} submitting={submitting} />;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  // Hydrate the video-cache manifest and drop entries for files iOS evicted.
  // Independent of auth — runs once per app launch regardless of session state.
  useEffect(() => {
    reconcileVideoCache().catch(e => console.warn('[video-cache] reconcile failed:', e));
    // Resolve videos left 'uploading' by a killed/backgrounded upload: size-verify
    // and flip to 'ready', or mark stale stragglers 'failed'. Self-guards on session.
    reconcilePendingUploads().catch(e => console.warn('[upload-reconcile] failed:', e));
  }, []);

  return (
    <TeamProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="landing" options={{ headerShown: false }} />
          <Stack.Screen name="playbook-dev" options={{ headerShown: false }} />
          <Stack.Screen name="playbook" options={{ headerShown: false }} />
          <Stack.Screen name="playbook-install" options={{ headerShown: false }} />
          <Stack.Screen name="playbook-all" options={{ headerShown: false }} />
          <Stack.Screen name="playbook-edit" options={{ headerShown: false }} />
          <Stack.Screen name="playbook-play" options={{ headerShown: false }} />
          <Stack.Screen name="playbook-link" options={{ headerShown: false }} />
          <Stack.Screen name="my-playbook" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen name="game" options={{ headerShown: false }} />
          <Stack.Screen name="tagging-overlay" options={{ headerShown: false, contentStyle: { backgroundColor: '#000' } }} />
          <Stack.Screen name="team-archive" options={{ headerShown: false }} />
          <Stack.Screen name="notifications" options={{ headerShown: false }} />
          <Stack.Screen name="search" options={{ headerShown: false }} />
          <Stack.Screen name="edit-lineup" options={{ headerShown: false }} />
          <Stack.Screen name="clips" options={{ headerShown: false }} />
          <Stack.Screen name="export" options={{ headerShown: false }} />
          <Stack.Screen name="select-team" options={{ headerShown: false }} />
          <Stack.Screen name="join-team" options={{ headerShown: false }} />
          <Stack.Screen name="claim-kid" options={{ headerShown: false }} />
          <Stack.Screen name="join-coach" options={{ headerShown: false }} />
          <Stack.Screen name="kid" options={{ headerShown: false }} />
          <Stack.Screen name="team" options={{ headerShown: false }} />
          <Stack.Screen name="clips-library" options={{ headerShown: false }} />
          <Stack.Screen name="my-work" options={{ headerShown: false }} />
          <Stack.Screen name="coaches-corner" options={{ headerShown: false }} />
          <Stack.Screen name="team-permissions" options={{ headerShown: false }} />
          <Stack.Screen name="upload" options={{ headerShown: false }} />
          <Stack.Screen name="shared-viewer" options={{ headerShown: false }} />
          <Stack.Screen name="edit-game" options={{ headerShown: false }} />
          <Stack.Screen name="game-detail" options={{ headerShown: false }} />
          <Stack.Screen name="game-player" options={{ headerShown: false }} />
          <Stack.Screen name="edit-reel" options={{ headerShown: false }} />
          <Stack.Screen name="box-score" options={{ headerShown: false }} />
          <Stack.Screen name="account" options={{ headerShown: false }} />
          <Stack.Screen name="recently-deleted" options={{ headerShown: false }} />
          <Stack.Screen name="terms" options={{ headerShown: false }} />
          <Stack.Screen name="privacy" options={{ headerShown: false }} />
        </Stack>
        <AuthGate />
        <NameCaptureGate />
        <TermsGate />
        <StatusBar style="auto" />
      </ThemeProvider>
    </TeamProvider>
  );
}

const styles = StyleSheet.create({
  loadingGate: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
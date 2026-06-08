import { TeamProvider, useTeamContext } from '@/context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { reconcile as reconcileVideoCache } from '@/lib/native/video-cache';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, router, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import 'react-native-reanimated';

export const unstable_settings = {
  anchor: '(tabs)',
};

// Role-aware post-login resolver. Lives INSIDE <TeamProvider> so it can read the
// already-computed session + membership state (no duplicate queries). This is
// the SINGLE routing chokepoint — no other file should call router.replace for
// auth/landing decisions.
function AuthGate() {
  const { sessionResolved, userId, membershipsLoaded, userTeams } = useTeamContext();
  const navState = useRootNavigationState();
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
      if (decidedForUserRef.current !== null) {
        decidedForUserRef.current = null;
        router.replace('/login');
      }
      setBooted(true);
      return;
    }

    // Logged in: wait for memberships before deciding. membershipsLoaded is
    // derived from userId in context, so it's reliably false until THIS user's
    // memberships have loaded (no stale-loaded race). We therefore NEVER reach
    // the userTeams.length check while still loading.
    if (!membershipsLoaded) return;

    // Decide exactly once per user (cold start or fresh login).
    if (decidedForUserRef.current !== userId) {
      decidedForUserRef.current = userId;
      if (userTeams.length === 0) {
        // Brand-new user: zero confirmed memberships → onboarding.
        // TODO(pending-invites): when the invite system exists, branch here — a
        // user with pending invites (and no confirmed memberships) should go to
        // an invite-accept screen. Until then, pending-invite-only users
        // intentionally fall through to onboarding.
        router.replace('/onboarding');   // STUB screen — real onboarding is a separate task
      } else {
        // >=1 confirmed membership → into the working app. (Role-aware home
        // ordering is a later task; everyone lands here for now.)
        router.replace('/select-team');
      }
    }
    setBooted(true);
  }, [navState?.key, sessionResolved, userId, membershipsLoaded, userTeams.length]);

  if (!booted) {
    return (
      <View style={[styles.loadingGate, { backgroundColor: colorScheme === 'dark' ? '#000' : '#fff' }]}>
        <ActivityIndicator size="large" color="#534AB7" />
      </View>
    );
  }
  return null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  // Hydrate the video-cache manifest and drop entries for files iOS evicted.
  // Independent of auth — runs once per app launch regardless of session state.
  useEffect(() => {
    reconcileVideoCache().catch(e => console.warn('[video-cache] reconcile failed:', e));
  }, []);

  return (
    <TeamProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen name="game" options={{ headerShown: false }} />
          <Stack.Screen name="tagging" options={{ headerShown: false }} />
          <Stack.Screen name="tagging-overlay" options={{ headerShown: false }} />
          <Stack.Screen name="clips" options={{ headerShown: false }} />
          <Stack.Screen name="export" options={{ headerShown: false }} />
          <Stack.Screen name="select-team" options={{ headerShown: false }} />
        </Stack>
        <AuthGate />
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
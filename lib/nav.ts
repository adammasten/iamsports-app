import { router } from 'expo-router';

// Back-navigate if there's somewhere to go, otherwise land on the app home.
//
// Calling router.back() unguarded throws "GO_BACK was not handled by any
// navigator" whenever the screen is the ROOT of the stack (index 0) — which the
// app's replace-heavy routing, a deep link, or restored nav state can all
// produce. This helper checks canGoBack() first and falls back to the app home
// (select-team) so back navigation can never throw.
//
// Note: NOT for _layout.tsx's post-auth routing — that's the single routing
// chokepoint and uses router.replace deliberately.
export function goBackOrHome() {
  if (router.canGoBack()) router.back();
  else router.replace('/select-team');
}

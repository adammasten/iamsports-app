// Debug-overlay gate. The yellow diagnostic panels (DebugPanel) show which
// screen is rendering + row counts — they're what caught the orphaned-file bug
// (edits landing in home.tsx while index.tsx rendered). They're OFF everywhere
// now, including Expo Go / dev, because we no longer need to watch them.
//
// NOT deleted — to bring them back (dev only), flip this to `return __DEV__;`
// (or `return true;` to force them on in every build). The DebugPanel component
// and both call sites (select-team.tsx, (tabs)/index.tsx) are still in place.
export function useDebugEnabled(): boolean {
  return false;
}

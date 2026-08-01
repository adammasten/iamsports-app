// Debug-overlay gate. The yellow diagnostic panels (DebugPanel) render ONLY in
// development — __DEV__ is compile-time true in a dev/Metro build and is
// eliminated (false) in preview + release/TestFlight builds, so the overlays
// disappear in anything shipped while staying available whenever you run a dev
// build. They're the instrument that caught the orphaned-file bug (edits landing
// in home.tsx while index.tsx rendered) — kept reachable via dev, not deleted.
//
// (There used to be a persisted runtime flag + hidden Account long-press toggle
// that could force the overlays on in preview builds. That override was removed
// so nothing shipped can surface them — gate is __DEV__ only now.)
export function useDebugEnabled(): boolean {
  return __DEV__;
}

# IamSports — iOS Landscape/Fullscreen Bug: Root Cause & Fix Instructions

**Audience:** Claude Code (implementation agent)
**Scope:** `app.json`, `app/game-player.tsx`, `app/tagging-overlay.tsx`, root layout
**Goal:** Eliminate the "half-rotate → snap back → retry 2–3× → sticks" bug when entering landscape on iOS.

---

## 1. Root cause (do not re-diagnose — implement the fix below)

There are **two competing authorities** answering iOS's "what orientations are supported?" query:

1. **expo-screen-orientation** — its registry is updated by `ScreenOrientation.lockAsync(...)`.
2. **react-native-screens** — every expo-router route is wrapped in an RNSScreen view controller, which answers the orientation query itself. When RNSScreen view controllers are present, expo-screen-orientation yields control to them (and newer react-native-screens versions, ≥ ~4.23.0, globally swizzle `supportedInterfaceOrientations`, bypassing expo's mask entirely). Tracked upstream in expo/expo #43692 and #43802.

Because `app.json` declares `"orientation": "portrait"`, the Info.plist app-level mask is **portrait-only**. iOS intersects per-VC masks with the app-level mask. So when the react-native-screens side wins the mid-rotation re-query, the only legal answer is portrait → iOS **aborts the in-flight rotation and snaps back**. The "half-size video" is just the `absoluteFill` VideoView rendering into a mid-transition frame when the rotation aborts — a symptom, not a cause. Retries eventually stick when the two registries happen to converge.

**Fix strategy:** make react-native-screens (via expo-router screen options) the *single* orientation authority, and widen the Info.plist mask so landscape is legal at the app level. Remove all `ScreenOrientation.lockAsync` calls from these screens.

> ⚠️ **Do both halves together.** Changing only `app.json` will appear to improve things but leaves the race in place.

---

## 2. Changes

### 2.1 `app.json`

```jsonc
{
  "expo": {
    "orientation": "default",          // was "portrait" — landscape must be in the app-level mask
    "newArchEnabled": true,
    "reactCompiler": true,
    "plugins": [
      // ...existing plugins...
      ["expo-screen-orientation", { "initialOrientation": "PORTRAIT" }]
      // covers the window before JS loads so the app doesn't launch/rotate freely
    ]
  }
}
```

Note: this requires a **new native build** (dev client / EAS build). It will not take effect in an existing binary.

### 2.2 Root layout (`app/_layout.tsx`) — portrait by default, everywhere

```tsx
<Stack screenOptions={{ orientation: 'portrait' /* ...existing options... */ }}>
```

This replaces the old app-wide portrait guarantee that `"orientation": "portrait"` used to provide. Every screen is portrait unless it explicitly opts out.

### 2.3 `app/tagging-overlay.tsx` — landscape via navigator option

Declare the screen landscape (either in the layout's `<Stack.Screen name="tagging-overlay" options={{ orientation: 'landscape' }} />` or inline in the route file):

```tsx
// tagging-overlay.tsx
<Stack.Screen options={{ orientation: 'landscape' }} />
```

Then **remove** the now-obsolete workarounds in this file:

- ❌ The `useFocusEffect` that calls `ScreenOrientation.lockAsync(LANDSCAPE)` on focus.
- ❌ The `AppState` listener that re-locks landscape on `'active'`.
- ❌ The `InteractionManager.runAfterInteractions(() => lockAsync(PORTRAIT_UP))` on blur.
- ❌ The awaited `lockAsync(PORTRAIT_UP)` inside `handleBack()` — `handleBack` becomes just `goBackOrHome()`. The navigator restores portrait on pop, correctly sequenced with the transition.
- ⏸ **Keep (for now)** the pinned landscape dimensions (`landW = Math.max(winW, winH)` etc.). Remove them in a follow-up commit only after verifying push/pop transitions look correct on device — they're harmless insurance during the transition frames.
- Remove the `expo-screen-orientation` import if nothing else in the file uses it.

### 2.4 `app/game-player.tsx` — ⛶ toggle via `navigation.setOptions`

Replace the `lockAsync` toggle with the navigator option:

```tsx
import { useNavigation } from 'expo-router';

const navigation = useNavigation();

const toggleFullscreen = useCallback(() => {
  if (Platform.OS === 'web') { /* existing browser Fullscreen API path — unchanged */ return; }
  const goLandscape = !isLandscape;
  didLockLandscapeRef.current = goLandscape;
  navigation.setOptions({ orientation: goLandscape ? 'landscape' : 'portrait' });
}, [isLandscape, navigation]);
```

Unmount cleanup:

```tsx
useEffect(() => {
  return () => {
    try { player.pause(); } catch {}   // KEEP — prevents the "distorted freeze" on teardown
    // ❌ REMOVE the lockAsync(PORTRAIT_UP) restore. The screen's own option reverts
    // with the navigator; the root stack default ('portrait') governs the next screen.
  };
}, [player]);
```

Remove the `expo-screen-orientation` import if unused afterward.

### 2.5 Global sweep

- `grep -r "ScreenOrientation.lockAsync" app/ lib/ components/` — after this change there should be **zero** call sites on native code paths. Any survivor recreates the two-authorities race.
- Do **not** touch the video pipeline: signed-URL loading, cold-load retry, `player.replace`, `contentFit="contain"`, `nativeControls={false}` are all fine and unrelated.
- Check `package.json` / lockfile for `react-native-screens`. SDK 54 pins ~4.16.x; if it has drifted to ≥4.23.0, restore the Expo-recommended version (`npx expo install react-native-screens`). The ≥4.23 swizzle is a known regression.

---

## 3. Things NOT to do

- **No key-bumps or forced re-measure on `VideoView`** — that fights the half-size symptom on every occurrence instead of eliminating the aborted rotation.
- **No expo-video native fullscreen** — it presents AVPlayerViewController with native controls; custom controls can't overlay it. The rotate-the-screen approach stays.
- **Don't keep `lockAsync` as a "belt and suspenders" alongside navigator options** — that IS the bug, in a new costume.

## 4. Fallback (only if flakiness survives the above on some iOS version)

Fake landscape: never rotate the OS. Keep the app portrait and render the player/tagger inside a container with `transform: [{ rotate: '90deg' }]` and swapped width/height (gesture coordinates must be mapped). Immune to every orientation race by construction. **Do not implement unless the primary fix demonstrably fails on device.**

---

## 5. Verification checklist (physical iPhone, dev build)

1. Cold-launch → app opens portrait, does not auto-rotate when the phone is turned.
2. Open game player → tap ⛶ → rotates to landscape **on the first try**, full-size video, no snap-back. Repeat 10×.
3. Toggle ⛶ back to portrait → clean rotation, controls laid out correctly.
4. Enter tagging overlay → lands in landscape immediately, video full-size.
5. Back out of tagger (button AND swipe gesture) → returns portrait, no jam, no squished column, no stuck orientation.
6. Background the app while in the tagger → return → still landscape (navigator option persists; the old AppState re-lock is not needed).
7. Rapid cycle: home → tagger → back → tagger → back ×5 — no degradation across cycles (the upstream bug worsened with repeated navigation).
8. Regression: other screens (home, rosters, etc.) do not rotate when the phone is turned.

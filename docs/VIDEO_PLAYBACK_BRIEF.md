# Video playback / landscape brief — for outside review

Self-contained summary of a persistent bug so an outside AI can diagnose it.
Written 2026-08-27.

## The symptom
Playing a game **or** tagging a game, when the user goes to **landscape/fullscreen**:
the video **goes to a half/partial size, then snaps back to portrait**. Retry →
half, snaps back. Retry again → it finally rotates to landscape and plays.
Intermittent but persistent. Happens on the **native iOS app** (TestFlight).

## Stack
- **Expo SDK 54**, React Native, **New Architecture on** (`newArchEnabled: true`),
  React Compiler on.
- Video: **`expo-video`** (`useVideoPlayer` + `VideoView`, custom controls,
  `nativeControls={false}`, `contentFit="contain"`).
- Orientation: **`expo-screen-orientation`** (`ScreenOrientation.lockAsync`).
- Private storage: every video URL is a short-lived signed URL minted by a
  `sign-media` Edge Function (`getSignedVideoUrl`, 3h TTL).
- Two playback surfaces: **`app/game-player.tsx`** (play a game) and
  **`app/tagging-overlay.tsx`** (tag a game — always landscape).

## ⭐ Leading hypothesis: the app is portrait-locked at the OS level
`app.json` contains:
```json
{ "expo": { "orientation": "portrait" } }
```
Expo turns this into an iOS `Info.plist` that supports **only portrait**
interface orientations. But both screens then try to **force landscape at
runtime** with `ScreenOrientation.lockAsync(LANDSCAPE)`. iOS is unreliable about
rotating to an orientation the app doesn't declare in
`UISupportedInterfaceOrientations` — the rotate half-applies and the OS snaps it
back. That precisely matches "goes half, snaps back, retry, retry, then sticks."

**Candidate fix (unverified):** set `app.json` `"orientation": "default"` (allow
all orientations so the Info.plist includes landscape), and keep controlling
orientation programmatically per-screen (portrait-lock the normal screens,
landscape-lock the player/tagger). Open question: does that reintroduce
unwanted auto-rotation elsewhere, and is per-screen locking enough to contain it?

## The relevant code

### game-player.tsx — landscape is a manual ⛶ toggle (lockAsync)
```tsx
const { width, height } = useWindowDimensions();
const isLandscape = width > height;
const didLockLandscapeRef = useRef(false);

const toggleFullscreen = useCallback(() => {
  if (Platform.OS === 'web') { /* browser Fullscreen API */ return; }
  const goLandscape = !isLandscape;
  didLockLandscapeRef.current = goLandscape;
  ScreenOrientation.lockAsync(
    goLandscape ? ScreenOrientation.OrientationLock.LANDSCAPE
                : ScreenOrientation.OrientationLock.PORTRAIT_UP
  ).catch(() => {});
}, [isLandscape]);

// On unmount: pause playback, then restore portrait ONLY if we locked landscape.
useEffect(() => {
  return () => {
    try { player.pause(); } catch {}
    if (Platform.OS !== 'web' && didLockLandscapeRef.current) {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    }
  };
}, [player]);

// VideoView (native fills; web needs measured px because absoluteFill renders small):
<VideoView player={player}
  style={Platform.OS === 'web' ? { width: box.w, height: box.h } : StyleSheet.absoluteFill}
  nativeControls={false} contentFit="contain" />
```

### game-player.tsx — cold-load retry (the "crossed-out then plays")
```tsx
const loadCurrent = useCallback(async (preferCache) => {
  const v = videosRef.current[currentIndex];
  const cached = preferCache ? getCachedPathSync(v.id) : null;
  const src = cached ?? await getSignedVideoUrl(v.url, { forceRefresh: true });
  if (!src) { setLoadError(true); return; }
  try { player.replace(src); if (Platform.OS !== 'web') player.play(); } catch {}
}, [currentIndex, player]);

// status → ready, or bounded auto-retry (re-mint signed URL up to 3×), then tap-to-retry
useEffect(() => {
  if (status?.status === 'readyToPlay') { setVideoReady(true); ... }
  if (status?.status === 'error') {
    if (retryRef.current < 3) { retryRef.current++; setTimeout(() => loadCurrent(false), 2000); }
    else setLoadError(true);
  }
}, [status, loadCurrent]);
```

### tagging-overlay.tsx — always landscape; lock on focus, restore on blur
```tsx
useFocusEffect(useCallback(() => {
  ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
  const sub = AppState.addEventListener('change', s => {
    if (s === 'active') ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
  });
  return () => {
    sub.remove();
    // deferred so the OS rotate doesn't preempt the nav transition (was leaving
    // the user stuck in portrait on this screen)
    InteractionManager.runAfterInteractions(() => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    });
  };
}, []));

// Back: rotate to portrait FIRST (awaited), THEN navigate — else a physical
// phone-turn mid-transition jams the screen (landscape overlay squished into a
// portrait column).
async function handleBack() {
  try { await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP); } catch {}
  goBackOrHome();
}

// Root is pinned to a landscape shape so it doesn't collapse into a portrait
// column during the rotate window:
const landW = Math.max(winW, winH);
const landH = Math.min(winW, winH);
<GestureHandlerRootView style={[styles.container, { width: landW, height: landH }]}>
  <VideoView player={player} style={StyleSheet.absoluteFillObject}
    nativeControls={false} allowsFullscreen={false} contentFit="contain" />
```

## What we've already tried (from git history + code comments)
- **Guarded/reworked orientation locks** repeatedly (`ad74f2f "fix game playback
  (play-after-load race) + guard orientation"`).
- **Deferring the portrait restore** with `InteractionManager.runAfterInteractions`
  so the OS rotate doesn't preempt the nav transition.
- **Awaiting portrait BEFORE navigating** on Back (`handleBack`) to avoid a
  half-rotated/half-navigated jam.
- **Re-locking landscape on `AppState` "active"** (returning from background).
- **Pinning the tagger root to a max/min landscape shape** so it doesn't collapse
  into a portrait column while the window briefly reports portrait dims.
- **Custom controls instead of expo-video native fullscreen** (native fullscreen
  "hid the controls").
- **Cold-load retry**: re-mint the signed URL and retry up to 3× on a cold
  `error`, then a tap-to-retry overlay (`68cbdf9`, the "distorted freeze on back"
  fix; the retry loop above).
- **`didLockLandscapeRef`** so we only restore portrait when we actually rotated.
- None of these touched `app.json orientation: "portrait"` — the Info.plist
  supported-orientations set was never changed.

## Open questions for a fresh perspective
1. Is `app.json orientation:"portrait"` (portrait-only Info.plist) the root cause
   of `lockAsync(LANDSCAPE)` being flaky, and is `"default"` the right fix — or
   should it be a more targeted `UISupportedInterfaceOrientations` config?
2. On SDK 54 + New Architecture, is there a known race between
   `ScreenOrientation.lockAsync` and `expo-video`'s `VideoView` re-layout on
   rotation that produces the "half then snap back"?
3. Should landscape be achieved by **rotating the whole screen** (current
   approach) or by using **`expo-video`'s native fullscreen** (which we abandoned
   because it hid our custom controls)? Is there a way to keep custom controls in
   native fullscreen?
4. Is the "half size" a video **layout** problem (VideoView measuring during the
   rotate) rather than an orientation-lock problem — i.e. would an explicit
   post-rotation re-measure / `key` bump fix it without touching orientation?
5. Any interaction with **React Compiler** memoizing the orientation effects in a
   way that drops a needed re-run?

## Files
`app/game-player.tsx` · `app/tagging-overlay.tsx` (+ `.web.tsx`) ·
`app/shared-viewer.tsx` · `lib/native/video-url.ts` · `lib/native/video-cache.ts` ·
`app.json` (orientation) · `docs/VIDEO_PLAYBACK_STANDARD.md`.

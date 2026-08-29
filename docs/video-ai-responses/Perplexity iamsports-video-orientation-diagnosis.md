# IamSports Video Handling & Persistent Landscape/Playback Bug

## Executive summary

The most likely and most actionable root cause is a contradiction between the iOS app’s native orientation declaration and its runtime orientation behavior.

The app is built with:

```json
{ "expo": { "orientation": "portrait" } }
```

but both the game player and tagging studio request:

```ts
ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
```

A portrait-only Expo orientation setting is native build configuration, not merely an initial/default UI preference. On iOS, it affects the supported interface-orientation set in `Info.plist` (`UISupportedInterfaceOrientations`). If landscape is not supported in the built app, a runtime request for landscape can enter a partial rotation/layout transition and then be rejected or reconciled back to portrait.

That is a strong match for the observed symptom:

1. User asks to enter landscape/fullscreen.
2. UIKit/native layout and the `VideoView` begin adapting.
3. The orientation is not valid under the app’s native supported-orientation policy.
4. The interface snaps back to portrait.
5. Repeated attempts occasionally appear to work because several asynchronous orientation, navigation, layout, and playback operations are racing.

The visible “half-size landscape” state is likely a layout symptom during a failed or incomplete orientation transaction. It is probably not the fundamental source of the failure.

The first fix should be to allow landscape natively, rebuild the iOS app, and move to a single, deterministic owner for screen-orientation policy.

---

## Current stack

- Expo SDK 54
- React Native with New Architecture enabled (`newArchEnabled: true`)
- React Compiler enabled (`reactCompiler: true`)
- `expo-video` using `useVideoPlayer` and `VideoView`
- Custom controls (`nativeControls={false}`)
- `contentFit="contain"`
- `expo-screen-orientation` using `ScreenOrientation.lockAsync(...)`
- App configuration currently declares portrait only
- Private Supabase Storage bucket with short-lived signed URLs from a `sign-media` Edge Function
- Railway ffmpeg optimization pipeline producing 720p H.264/yuv420p assets with `-movflags +faststart`

There are two native playback surfaces:

1. `app/game-player.tsx`: a fullscreen, plays-through game player with custom transport, scrubber, and a landscape/fullscreen control.
2. `app/tagging-overlay.tsx`: a landscape-only film-tagging studio.

---

## Most likely root cause

### Native orientation policy conflicts with runtime locks

The core architectural mismatch is:

- Native configuration says the app supports portrait only.
- Runtime code repeatedly requests landscape.

On iOS, the native supported-orientation list is a capability ceiling. It defines what the application can validly present. A runtime landscape request cannot reliably override a binary that only declares portrait support.

This makes the following code structurally unreliable if the iOS binary does not support landscape:

```ts
ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
```

The lock request may resolve, a partial layout transition may occur, or a native surface may resize briefly, but iOS can still return the interface to portrait because the supported-orientation policy does not permit landscape.

### Why this matches the observed symptom

The reported sequence—“it goes half screen and goes back; try again; then eventually it works”—is consistent with several subsystems reacting to an orientation transition that should not be allowed:

- UIKit interface-orientation transition.
- React Native window-dimension updates.
- React Navigation focus/blur/mount/unmount work.
- Native `VideoView` / AVPlayer layer bounds updates.
- `useWindowDimensions()` calculations.
- Imperative `lockAsync` requests from multiple paths.
- Source replacement and video playback actions.

The app can briefly display a landscape-shaped composition before UIKit and the native orientation policy settle the screen back to portrait.

### Important conclusion

Treat the portrait-only native declaration as the first issue to fix. Do not begin with a `VideoView` remount, a post-rotation key bump, or another timing delay. Those may mask a symptom but cannot make an unsupported landscape orientation reliably valid.

---

## Recommended native configuration

### Allow both portrait and landscape in the built app

The simplest Expo configuration is:

```json
{
  "expo": {
    "orientation": "default",
    "ios": {
      "requireFullScreen": true
    },
    "plugins": [
      [
        "expo-screen-orientation",
        {
          "initialOrientation": "DEFAULT"
        }
      ]
    ],
    "newArchEnabled": true,
    "reactCompiler": true
  }
}
```

This should be treated as a starting point. The critical requirement is that the generated iOS configuration supports the orientations that the app requests at runtime.

Recommended supported orientations:

| Target | Supported orientations |
|---|---|
| iPhone | Portrait, Landscape Left, Landscape Right |
| iPad | Portrait, Landscape Left, Landscape Right; include Portrait Upside Down only if deliberately supported |
| Runtime policy | Portrait for ordinary screens; landscape for player and tagger screens |

### Rebuild is required

Changing `app.json` alone does not alter an IPA already installed on a device. Generate and test a fresh native iOS build.

After prebuild or in the built artifact, inspect the actual values of:

- `UISupportedInterfaceOrientations`
- `UISupportedInterfaceOrientations~ipad`

Confirm that landscape-left and landscape-right are present wherever the app needs to lock landscape.

### iPad note

If orientation locking is required on iPad, use:

```json
"ios": {
  "requireFullScreen": true
}
```

Split View can prevent the normal full-screen orientation behavior needed for reliable locking.

---

## Does allowing native landscape cause unwanted rotation?

Not if orientation is owned at the screen/navigation level.

There is a critical distinction:

- **Native supported orientations**: orientations the app is allowed to use.
- **Screen-level orientation policy**: orientation desired by the currently active screen.

Setting the app to native `default` means that landscape is available when the app needs it. It does not mean every ordinary portrait screen must freely rotate.

Use a portrait policy for standard routes and a landscape policy for player/tagger routes. Do not prevent unwanted rotation by deleting landscape from the native orientation capability set, because the app genuinely requires landscape on some screens.

---

## Better orientation architecture

### Prefer navigator-owned orientation

Use the navigator or screen container as the authoritative orientation owner whenever possible. For Expo Router/React Navigation stacks that use `react-native-screens`, configure route orientation directly in navigation options.

Illustrative Expo Router structure:

```tsx
// app/_layout.tsx
import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="(tabs)"
        options={{ orientation: 'portrait' }}
      />
      <Stack.Screen
        name="game-player"
        options={{
          orientation: 'landscape',
          presentation: 'fullScreen',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="tagging-overlay"
        options={{
          orientation: 'landscape',
          presentation: 'fullScreen',
          headerShown: false,
        }}
      />
    </Stack>
  );
}
```

Adjust the exact route names and options to match the installed Expo Router / React Navigation versions and the project’s actual layout. The architectural goal is what matters: navigation lifecycle and native screen presentation should own orientation, instead of individual component callbacks and cleanup effects competing to lock global orientation state.

### Why the current pattern is fragile

`ScreenOrientation.lockAsync` is global process-level/native state, but the current implementation has multiple independent paths that can issue locks:

- `toggleFullscreen`
- game player unmount cleanup
- tagger `useFocusEffect`
- tagger blur cleanup
- tagger back handler
- tagger AppState-active listener
- navigation focus and transition lifecycle

Each individual workaround is understandable. Collectively, they create an async ordering problem.

Example failure:

1. The tagger loses focus.
2. Its cleanup schedules a delayed portrait lock through `InteractionManager.runAfterInteractions`.
3. A new screen asks for landscape.
4. The delayed cleanup arrives later and wins, forcing portrait over the new landscape request.

A race like this can resemble an intermittent iOS rotation bug even when the root is stale application-level lock ownership.

### If navigator-owned orientation is not viable

Create a central orientation coordinator. It should:

- Have one explicit active orientation policy.
- Serialize all native lock requests.
- Use a monotonically increasing generation/request identifier.
- Ignore stale focus/cleanup requests.
- Expose an orientation-settled state.
- Restore portrait only when the currently active route calls for it.

Illustrative implementation shape:

```ts
import * as ScreenOrientation from 'expo-screen-orientation';

type DesiredOrientation = 'portrait' | 'landscape';

let generation = 0;
let activeRequest: Promise<void> = Promise.resolve();

export function requestOrientation(next: DesiredOrientation) {
  const requestId = ++generation;
  const lock =
    next === 'landscape'
      ? ScreenOrientation.OrientationLock.LANDSCAPE
      : ScreenOrientation.OrientationLock.PORTRAIT_UP;

  activeRequest = activeRequest
    .catch(() => undefined)
    .then(async () => {
      await ScreenOrientation.lockAsync(lock);
      if (requestId !== generation) return;
    });

  return activeRequest;
}
```

This is an illustration rather than a complete drop-in implementation. It must be integrated with the app’s route lifecycle. The main objective is to prevent a stale cleanup operation from overriding a newer active-screen request.

---

## Fullscreen player architecture

### Treat landscape player as a route, not a mutable mode

The current game player uses an in-place fullscreen toggle that changes the entire screen orientation. A more robust iOS pattern is:

1. Present a normal portrait screen or preview/player.
2. User taps expand.
3. Navigate or present a dedicated landscape player route.
4. Let navigation own landscape orientation.
5. Mount/show custom player controls in that dedicated screen.
6. Back dismisses the landscape route.
7. The destination screen’s portrait policy becomes active.

This reduces the number of simultaneous concerns during one action. Instead of changing global orientation inside a mounted portrait screen while a native video surface is active, the app performs a screen-level transition to a screen designed for the new orientation.

The tagging studio should follow the same idea. It already behaves conceptually as a dedicated landscape route; formalize that ownership and remove redundant manual orientation paths once the native setup is corrected.

---

## Native fullscreen and custom controls

For `expo-video`, native controls are always enabled in fullscreen mode because of platform limitations. Native fullscreen therefore does not provide a clean custom-controls-only experience.

This means native `VideoView` fullscreen is not a good fit for:

- bespoke transport controls;
- custom scrubbing;
- tagging canvases;
- overlay controls;
- interactive film analysis UI;
- controls that must remain visible while fullscreen.

The correct approach for this product is likely the existing conceptual approach, implemented more cleanly:

- Do not use native `VideoView` fullscreen for the tagger or custom player.
- Use a dedicated landscape route/presentation.
- Keep `nativeControls={false}`.
- Render custom controls and tagging UI as sibling overlays above `VideoView`.

Example:

```tsx
<View style={StyleSheet.absoluteFill}>
  <VideoView
    player={player}
    style={StyleSheet.absoluteFill}
    nativeControls={false}
    allowsFullscreen={false}
    allowsPictureInPicture={false}
    contentFit="contain"
  />

  <CustomTransportControls />
  <TaggingOverlay />
</View>
```

---

## VideoView and layout behavior

### Is the half-size state a layout bug?

Possibly, but it is more likely a secondary effect than the initiating fault.

During an attempted rotation, UIKit, React Native, and the native video surface can briefly report or consume different bounds. A partial state can result when:

- the window is still reporting portrait dimensions;
- a React layout pass is using stale dimensions;
- the `VideoView` parent changes bounds;
- the AVPlayer layer is resizing during an interrupted rotation;
- the app subsequently receives a forced portrait resolution.

`contentFit="contain"` will center and letterbox within the bounds it is given. If those bounds are temporarily wrong, the display can look shrunken or half-sized.

### Do not use a key bump as the primary fix

Remounting the `VideoView` through a changed React `key` may repair a stale native layer measurement in some circumstances, but it is not a strong first-line solution. It can cause:

- black flashes;
- dropped frames;
- interrupted audio or playback;
- AVPlayer layer churn;
- additional memory pressure;
- lost UI state;
- a hidden orientation-policy flaw that still affects other components.

Only consider a controlled remount after proving all of the following:

1. Landscape is declared in the native iOS orientation support set.
2. Orientation ownership is centralized.
3. Stale cleanup locks are eliminated.
4. The screen received a confirmed landscape orientation event.
5. The `VideoView` still has incorrect bounds after stable dimensions/layout.

If a key bump is needed, do it after confirmed stable landscape—not immediately after requesting the lock.

---

## Avoid coupling video source replacement to rotation

### Use `replaceAsync()` on iOS

The current code uses:

```ts
player.replace(src);
if (Platform.OS !== 'web') player.play();
```

On iOS, `expo-video` documents that synchronous `replace()` can load asset data on the UI thread and may block the UI for an extended period. `replaceAsync()` is preferable where source loading may overlap with visible UI transitions.

Recommended pattern:

```ts
const loadGenerationRef = useRef(0);

const loadCurrent = useCallback(async (preferCache: boolean) => {
  const loadId = ++loadGenerationRef.current;
  const v = videosRef.current[currentIndex];
  const cached = preferCache ? getCachedPathSync(v.id) : null;
  const src = cached ?? await getSignedVideoUrl(v.url, { forceRefresh: true });

  if (!src || loadId !== loadGenerationRef.current) {
    if (!src) setLoadError(true);
    return;
  }

  try {
    await player.replaceAsync(src);

    if (loadId !== loadGenerationRef.current) return;
    if (Platform.OS !== 'web') player.play();
  } catch {
    if (loadId !== loadGenerationRef.current) return;
    setLoadError(true);
  }
}, [currentIndex, player]);
```

Use project-specific cancellation/error/retry state as appropriate. The important part is not to let an old async load start playback after the user has navigated to another video or another route.

### Sequence loading after rotation settles

For a dedicated landscape route:

1. Navigate/present the landscape route.
2. Let native navigation/orientation policy request landscape.
3. Wait for a landscape orientation event or stable dimensions.
4. Render/reveal the full interactive tagging/player UI.
5. Replace or attach the source if it was not preloaded.
6. Start/resume playback.

Do not make source replacement, `play()`, native rotation, navigation, and major layout changes one simultaneous transaction if it can be avoided.

### Preloading

Keep the signed URL strategy. It is not a likely explanation for an orientation snap-back. The video files are optimized with `faststart`, and signed URLs are refreshed on demand.

Where useful, prepare/preload the next video before attaching it to the visible `VideoView`, then switch after the landscape route is stable. This reduces user-perceived startup delay without making rotation depend on network or source replacement timing.

---

## Render only after orientation settles

The max/min landscape-shaped root is a reasonable emergency workaround, but it indicates that the component is trying to render a landscape UI before native rotation has completed.

Prefer explicit orientation-settled state. Illustrative pattern:

```tsx
const [orientationReady, setOrientationReady] = useState(false);

useEffect(() => {
  let mounted = true;

  const sub = ScreenOrientation.addOrientationChangeListener(({ orientationInfo }) => {
    const orientation = orientationInfo.orientation;
    const isLandscape =
      orientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
      orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT;

    if (isLandscape && mounted) {
      requestAnimationFrame(() => setOrientationReady(true));
    }
  });

  return () => {
    mounted = false;
    sub.remove();
  };
}, []);
```

Use this to gate the expensive, interactive UI layer rather than necessarily unmounting the whole player. For example:

- show a black background or poster frame while orientation settles;
- keep the outer video host full-screen/flex-based;
- reveal tagging controls only after confirmed landscape;
- avoid hard-coded width/height where `flex: 1` is sufficient.

`useWindowDimensions()` is still appropriate for responsive layout. It should not be treated as proof that the native iOS interface-orientation transaction has finished.

---

## React Compiler assessment

React Compiler is very unlikely to be the primary root cause.

React Compiler is intended to preserve React semantics while optimizing memoization. It should not silently discard a required effect run if the effect has correct dependencies and lifecycle conditions.

However, this code should still be audited for normal React async/effect hazards:

- stale values captured by callbacks;
- missing dependencies;
- async completions after unmount or blur;
- cleanup work firing after a newer route request;
- manual event listeners surviving longer than intended;
- unguarded source-load completions.

The stronger explanation is that several independent lifecycle paths compete to mutate global native orientation state.

---

## What to remove or simplify after the native fix

Do not remove all guards at once in production. First test the corrected orientation declaration and navigator ownership in a focused branch/build. Once stable, simplify toward this model:

- Remove per-component landscape locks when navigator route options own orientation.
- Remove deferred portrait restore on blur when the next route owns portrait.
- Remove unmount portrait restore when navigation owns route orientation.
- Remove AppState re-lock unless background/foreground testing proves it is still necessary.
- Retain playback pause on unmount if it solves an independently reproducible AV surface teardown problem.
- Keep bounded signed-URL retry for genuine transport/load failures, but separate it from orientation logic.

The goal is not merely fewer lines of code. It is one source of truth for a global native setting.

---

## Concrete implementation plan

### Phase 1: native orientation correction

1. Change Expo orientation configuration from `portrait` to `default`, or explicitly add portrait and both landscape orientations in native iOS configuration.
2. Add `ios.requireFullScreen: true` if iPad locking is required.
3. Generate a fresh iOS build.
4. Verify the resulting `UISupportedInterfaceOrientations` and `UISupportedInterfaceOrientations~ipad` arrays.
5. Test the current code without adding further layout workarounds first.

### Phase 2: navigator ownership

1. Mark normal application routes as portrait.
2. Mark `game-player` and `tagging-overlay` routes as landscape/full-screen.
3. Remove routine imperative `lockAsync` calls from component lifecycle code.
4. Make expand/open-player navigate to a dedicated landscape player route.
5. Make Back dismiss/navigate out of the landscape route rather than manually forcing portrait before a competing navigation transition.

### Phase 3: playback and layout stability

1. Change iOS loads from `player.replace()` to awaited `player.replaceAsync()`.
2. Add a source-load generation/cancellation guard.
3. Avoid replacing source and beginning playback during the exact rotation transition.
4. Track orientation-settled state.
5. Reveal interactive overlays after a confirmed landscape event and one layout frame.
6. Use `flex: 1`/absolute fill for the video host before retaining max/min dimension pinning.

### Phase 4: only then assess residual defect

If a confirmed landscape route still has a wrongly measured `VideoView`:

1. Log actual parent `onLayout` bounds.
2. Log window dimensions and orientation events with timestamps.
3. Confirm the orientation is stable.
4. Consider a narrowly-scoped post-settlement layout refresh or `VideoView` remount.
5. Do not remount during the initial orientation request.

---

## Instrumentation plan

Add structured logs with timestamps, a route/session ID, and a monotonically increasing orientation request ID.

Log each of the following:

- Route focus.
- Route blur.
- Route mount/unmount.
- Each `lockAsync` request.
- Each lock completion or failure.
- Requested orientation and request generation ID.
- Orientation-change events.
- `useWindowDimensions()` changes.
- `VideoView` parent `onLayout` width/height.
- Video player `statusChange` events.
- Source load start/end.
- `replaceAsync` start/end/error.
- `play()` call.
- AppState transitions.

A useful record shape:

```ts
logEvent({
  event: 'orientation-request',
  sessionId,
  requestId,
  desired: 'landscape',
  route: 'tagging-overlay',
  window: { width, height },
  timestamp: Date.now(),
});
```

This will identify whether a stale portrait cleanup, a focus effect, an AppState listener, or a navigation event is winning after a landscape request.

---

## Test matrix

Test with a fresh build after changing native orientation support.

- Clean launch into a regular portrait screen.
- Portrait to game player.
- Portrait to tagging studio.
- First tap on fullscreen/expand.
- Fast repeated fullscreen taps.
- Back from player/tagger to portrait.
- Device held in portrait before opening landscape route.
- Device held in landscape before opening landscape route.
- Both Landscape Left and Landscape Right.
- Background/foreground while in the tagger.
- Background/foreground while in the landscape game player.
- Video loaded from local cache.
- Video loaded via a newly minted signed URL.
- Cold load and warm load.
- Navigation during an in-progress source replacement.
- At least one recent iPhone.
- At least one iPad if iPad is supported.

For every failure, preserve the orientation/log timeline rather than immediately adding another delay or lock call.

---

## Direct answers

| Question | Answer |
|---|---|
| Is `orientation: "portrait"` the root cause of flaky `lockAsync(LANDSCAPE)`? | It is the leading root-cause candidate and the first thing to change. Portrait-only native orientation support conflicts with genuine landscape routes. |
| Is `orientation: "default"` the correct fix? | It is the simplest correct starting point. The essential requirement is that the generated iOS supported-orientation arrays include both landscape directions. |
| Is a targeted `UISupportedInterfaceOrientations` change better? | It can be used for exact iPhone/iPad control. It must include portrait and both landscape directions for this app’s intended routes. |
| Will native `default` make other screens rotate freely? | Not if portrait is enforced by the active screen/navigation policy. Native support is a capability ceiling, not an instruction for all routes to rotate. |
| Is there a known Expo SDK 54/New Architecture `VideoView` race? | A relayout race is plausible, but there is no need to assume a framework defect first. The native policy contradiction and multiple async global orientation requests are stronger explanations. |
| Is half-size video a layout issue? | Likely a layout symptom during a failed or incomplete orientation transition. It can coexist with a native video-layer measurement issue, but it is not proof that the orientation lock itself succeeded. |
| Would a post-rotation key bump fix it? | It might mask a stale measurement, but it should be a late fallback after native orientation support and centralized ownership are fixed. |
| Can Expo native fullscreen retain fully custom controls? | Not cleanly. Native controls are always enabled in `expo-video` fullscreen. A dedicated landscape route with `nativeControls={false}` is the better fit for custom controls and tagging overlays. |
| Could React Compiler be dropping needed orientation effects? | Very unlikely as the primary issue. Audit ordinary effect dependencies and stale async completion, but focus on competing global orientation locks. |
| Is the overall pattern fundamentally wrong? | The flawed part is portrait-only native support plus runtime landscape forcing. The sound pattern is broad native support, deterministic route-level policy, dedicated landscape player/tagger screens, and separated video-load/rotation transitions. |

---

## Bottom line

The winning fix is unlikely to be another `InteractionManager` delay, a new cleanup guard, or a `VideoView` remount.

Use this architecture instead:

1. Declare landscape as a valid native iOS capability.
2. Rebuild and verify the final iOS orientation arrays.
3. Make navigation/screens the single owner of portrait vs. landscape.
4. Present full-screen custom video playback and tagging as dedicated landscape routes.
5. Keep `nativeControls={false}` and use custom overlays.
6. Do not replace/play video sources in the same critical window as a rotation transition.
7. Use `replaceAsync()` on iOS and protect async loads with generation/cancellation guards.
8. Instrument orientation requests, route lifecycles, dimensions, and video layout before adding any remaining workaround.

This resolves the fundamental policy conflict and removes the competing global lock calls that likely make the failure intermittent.
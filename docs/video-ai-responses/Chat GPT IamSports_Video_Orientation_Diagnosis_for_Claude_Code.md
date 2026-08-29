# IamSports — Video Orientation / Fullscreen Bug
## Diagnosis + Recommended Fix for Claude Code

**Purpose:** This document is an implementation brief for fixing the persistent intermittent landscape/fullscreen bug in the native iOS IamSports app.

---

## 1. Current Problem

IamSports is a React Native / Expo youth-sports app where coaches and parents watch and tag game film.

Current stack:

- Expo SDK 54
- React Native New Architecture enabled
- React Compiler enabled
- `expo-video`
- `expo-screen-orientation`
- Expo Router / native screens
- Custom video controls
- Private Supabase Storage with signed URLs
- Optimized H.264 720p video with `-movflags +faststart`

The application is currently declared portrait-only:

```json
{
  "expo": {
    "orientation": "portrait",
    "newArchEnabled": true,
    "reactCompiler": true
  }
}
```

Two screens need landscape:

1. `app/game-player.tsx`
   - Usually portrait.
   - User taps a fullscreen button.
   - Screen calls `ScreenOrientation.lockAsync(LANDSCAPE)`.

2. `app/tagging-overlay.tsx`
   - Intended to be landscape-only.
   - Calls `ScreenOrientation.lockAsync(LANDSCAPE)` when focused.
   - Restores portrait when leaving.

### User-visible symptom

On native iOS:

1. User enters fullscreen or the tagger.
2. The screen starts rotating toward landscape.
3. It becomes partially or half-sized landscape.
4. It snaps back to portrait.
5. User tries again.
6. Same thing may happen.
7. On the second or third attempt it often succeeds.

This has persisted despite multiple orientation, layout, navigation, and video workarounds.

---

# 2. Primary Diagnosis

## Most likely root cause

The most likely problem is **conflicting ownership of orientation plus asynchronous iOS geometry/navigation transitions**.

The application currently combines all of the following:

- An app-level native declaration that says the app is portrait-only.
- Runtime calls asking iOS to rotate particular screens into landscape.
- Navigation transitions happening near the same time as orientation changes.
- `react-native-screens` / Expo Router participating in native screen presentation.
- React Native Fabric relayout during the orientation transition.
- A native `VideoView` that must resize while all of that happens.

This creates a race.

The most likely sequence is:

```text
portrait screen
    ↓
JS calls lockAsync(LANDSCAPE)
    ↓
iOS requests new window geometry
    ↓
screen begins rotating
    ↓
navigation / screen lifecycle / supported orientation state changes
    ↓
layout recalculates mid-rotation
    ↓
orientation request loses or is superseded
    ↓
iOS snaps back to portrait
```

The half-size video is likely a **visual artifact of the failed transition**, not the fundamental cause.

---

# 3. Important Finding About `lockAsync()`

Do not assume this:

```ts
await ScreenOrientation.lockAsync(...)
```

means:

> "The physical iPhone rotation animation has completely finished."

It does not necessarily provide that guarantee.

On modern iOS, orientation handling involves requesting a window scene geometry update.

So code like this:

```ts
await ScreenOrientation.lockAsync(
  ScreenOrientation.OrientationLock.PORTRAIT_UP
);

router.back();
```

can still effectively behave like:

```text
request portrait
request accepted
Promise resolves
navigation begins
iOS is still physically changing geometry
```

That means navigation and orientation changes can overlap even though the JavaScript looks sequential.

This explains why previous fixes involving:

- awaiting portrait before navigation
- `InteractionManager.runAfterInteractions`
- delayed restore
- AppState re-locks
- repeated orientation locks

may reduce the problem without eliminating it.

They are attempting to time two native state machines rather than removing the conflict.

---

# 4. `orientation: "portrait"` Should Be Removed

Change:

```json
{
  "expo": {
    "orientation": "portrait"
  }
}
```

to:

```json
{
  "expo": {
    "orientation": "default"
  }
}
```

Final configuration should remain approximately:

```json
{
  "expo": {
    "orientation": "default",
    "newArchEnabled": true,
    "reactCompiler": true
  }
}
```

## Important

This requires a **new native iOS build**.

It is not merely a JavaScript / OTA change because supported orientations are part of the generated native application configuration.

---

# 5. Recommended Architecture

## Main recommendation

**Stop treating landscape as an imperative effect that runs while a screen is already mounted.**

Instead:

> Make orientation a property of the native navigation screen.

The application should support the required orientations globally, then individual routes should specify the orientation they require.

Conceptually:

```tsx
<Stack>
  <Stack.Screen
    name="index"
    options={{
      orientation: "portrait_up",
    }}
  />

  <Stack.Screen
    name="game-player"
    options={{
      orientation: "portrait_up",
    }}
  />

  <Stack.Screen
    name="game-player-fullscreen"
    options={{
      orientation: "landscape",
    }}
  />

  <Stack.Screen
    name="tagging-overlay"
    options={{
      orientation: "landscape",
    }}
  />
</Stack>
```

Exact Expo Router syntax should be adapted to the existing routing structure.

The important architectural rule is:

```text
Navigation owns orientation.
```

Not:

```text
Screen mounts
→ useEffect/useFocusEffect runs
→ JS tells iOS to rotate
→ screen simultaneously navigates/reflows
```

---

# 6. Change the Game Player Architecture

Current approach:

```text
game-player portrait route
        ↓
user taps fullscreen
        ↓
same screen calls lockAsync(LANDSCAPE)
        ↓
same native hierarchy rotates in place
```

Recommended approach:

```text
game-player portrait route
        ↓
user taps fullscreen
        ↓
navigate to game-player-fullscreen
        ↓
fullscreen route is declared landscape
```

So instead of:

```ts
ScreenOrientation.lockAsync(
  ScreenOrientation.OrientationLock.LANDSCAPE
);
```

the fullscreen control should conceptually become:

```ts
router.push({
  pathname: "/game-player-fullscreen",
  params: {
    // current game / video state
  },
});
```

The fullscreen route should be landscape by native navigation configuration.

On exit:

```ts
router.back();
```

No explicit portrait restore should be necessary if the destination route is declared portrait.

---

# 7. Change the Tagging Overlay Architecture

The tagging overlay should be a native landscape route.

Once that is implemented, remove the orientation choreography currently used in the tagger.

The following logic should become unnecessary:

```ts
ScreenOrientation.lockAsync(
  ScreenOrientation.OrientationLock.LANDSCAPE
);
```

Remove the AppState re-lock:

```ts
const sub = AppState.addEventListener("change", s => {
  if (s === "active") {
    ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.LANDSCAPE
    );
  }
});
```

Remove the delayed portrait restore:

```ts
InteractionManager.runAfterInteractions(() => {
  ScreenOrientation.lockAsync(
    ScreenOrientation.OrientationLock.PORTRAIT_UP
  );
});
```

Remove the explicit portrait lock before navigation:

```ts
await ScreenOrientation.lockAsync(
  ScreenOrientation.OrientationLock.PORTRAIT_UP
);

goBackOrHome();
```

Back should simply navigate:

```ts
goBackOrHome();
```

The route being returned to should itself be portrait.

---

# 8. Remove the Forced Landscape Dimension Hack

Current tagger code forces landscape dimensions:

```ts
const { width: winW, height: winH } = useWindowDimensions();

const landW = Math.max(winW, winH);
const landH = Math.min(winW, winH);

<GestureHandlerRootView
  style={[
    styles.container,
    {
      width: landW,
      height: landH,
    },
  ]}
/>
```

This exists because JS sometimes sees portrait dimensions while the app is attempting to become landscape.

That is evidence of the underlying orientation race.

Once the route itself is natively landscape, change the root back to normal layout:

```tsx
<GestureHandlerRootView style={styles.container}>
```

with:

```ts
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
```

Do not manually synthesize landscape dimensions unless testing later proves it is still necessary.

---

# 9. Do Not Key-Bump `VideoView` Yet

Avoid attempting to solve this with:

```tsx
<VideoView
  key={orientation}
  ...
/>
```

A key change destroys and recreates the native video view.

That can introduce:

- playback interruptions
- surface recreation
- flashes
- stalls
- temporary black frames
- timeline discontinuities
- new race conditions

The current evidence suggests the video view is reacting to an unstable window rather than creating the unstable window.

Fix orientation ownership first.

---

# 10. Diagnostic Test: Remove Video Completely

Before blaming `expo-video`, perform a controlled test.

Temporarily replace:

```tsx
<VideoView
  player={player}
  style={StyleSheet.absoluteFill}
/>
```

with:

```tsx
<View style={StyleSheet.absoluteFill} />
```

Then repeatedly test:

```text
portrait
→ landscape
→ portrait
→ landscape
```

at least 20–30 times.

### Interpretation

If the screen still:

- half rotates
- becomes partially sized
- snaps back
- requires several attempts

then `expo-video` is effectively ruled out as the initiating cause.

If the orientation becomes perfectly stable without `VideoView` and becomes unstable again when `VideoView` returns, then investigate `expo-video` / Fabric relayout separately.

The expectation is that orientation architecture will remain the primary problem.

---

# 11. What Probably Is Not Causing This

These components are unlikely to explain an iOS interface beginning a rotation and then returning to portrait:

### Signed URLs

The app requests temporary signed playback URLs from Supabase.

URL authentication failures can cause:

- load failure
- player error
- retry
- buffering

They should not change supported interface orientation.

### Video encoding

Current optimized files are:

- 720p
- H.264
- yuv420p
- `faststart`

That is a reasonable playback format.

Video encoding problems can create:

- decode errors
- playback errors
- stalls
- black frames

They should not cause iOS to reject a landscape interface transition.

### Cold-load retries

The existing signed-URL retry logic solves a separate failure class.

Do not combine playback retry logic with orientation recovery.

---

# 12. React Compiler

React Compiler is a very low-probability suspect.

The symptom:

```text
partial rotation
→ reversal
→ retry
→ eventual success
```

does not strongly resemble a memoized effect being permanently skipped.

Keep:

```json
"reactCompiler": true
```

during the primary fix.

If orientation remains broken after the architecture change, one diagnostic native build with React Compiler disabled is reasonable:

```json
"reactCompiler": false
```

but it should not be the first fix.

---

# 13. Native Fullscreen vs. Custom Controls

`expo-video` native fullscreen is not the preferred solution for the tagging experience.

IamSports needs:

- custom transport controls
- tagging controls
- overlays
- scrubber
- tagging UI
- custom gestures
- custom workflow

Native fullscreen hands much of the presentation to the platform and does not provide the same custom overlay architecture.

Therefore:

### Normal playback

Native fullscreen can potentially be considered if Apple's controls are acceptable.

### IamSports tagging / custom game player

Use a dedicated landscape application route.

The app should own the screen.

---

# 14. Recommended Implementation Order

Do not change everything at once.

The goal is to identify which change eliminates the bug.

## Build 1 — Fix the app-level orientation declaration

Change:

```json
"orientation": "portrait"
```

to:

```json
"orientation": "default"
```

Keep the existing screen logic otherwise unchanged.

Create a new native iOS build.

Stress-test orientation 30+ times.

Record whether the failure rate changes.

---

## Build 2 — Convert Tagger to Native Route Orientation

Configure `tagging-overlay` as:

```text
landscape
```

through the native stack / Expo Router screen configuration.

Remove from the tagger:

- `ScreenOrientation.lockAsync(LANDSCAPE)`
- AppState landscape re-lock
- delayed portrait restore
- awaited portrait lock before navigation
- forced `landW` / `landH`

Test repeatedly.

This is probably the cleanest screen for proving the architecture because the tagger is always supposed to be landscape.

---

## Build 3 — Add Dedicated Fullscreen Player Route

Create:

```text
game-player
```

Portrait route.

Create:

```text
game-player-fullscreen
```

Landscape route.

The fullscreen button navigates between these routes instead of rotating the same route.

Preserve playback state explicitly.

Possible state to carry/share:

- game id
- current video id
- current video index
- current playback time
- playing / paused state
- playlist
- tagging context if applicable

Prefer sharing stable state rather than tearing down/recreating large amounts of player state unnecessarily.

---

## Build 4 — Remove Legacy Orientation Workarounds

Once native route orientation works, remove old workaround code that could reintroduce races.

Search the project for:

```text
ScreenOrientation.lockAsync
OrientationLock.LANDSCAPE
OrientationLock.PORTRAIT_UP
InteractionManager.runAfterInteractions
AppState.addEventListener
didLockLandscapeRef
Math.max(winW, winH)
Math.min(winW, winH)
```

Determine whether each remaining usage is still justified.

The goal is to have as few independent orientation authorities as possible.

---

# 15. Desired End State

The final architecture should behave approximately like this:

```text
APP
│
├── portrait routes
│   ├── home
│   ├── schedule
│   ├── team
│   ├── normal game player
│   └── other application screens
│
└── landscape routes
    ├── tagging overlay
    └── fullscreen game player
```

And orientation behavior should be:

```text
navigate to route
        ↓
native navigator knows required orientation
        ↓
iOS presents screen in supported orientation
        ↓
React Native lays out actual resulting window
        ↓
VideoView fills stable window
```

instead of:

```text
navigate
+
screen mounts
+
JS orientation effect
+
native geometry change
+
Fabric relayout
+
VideoView relayout
+
navigation transition
```

---

# 16. Root Cause Ranking

### High confidence

**Conflicting orientation ownership and asynchronous iOS geometry/navigation transitions.**

### High confidence

**The app-level `"orientation": "portrait"` declaration is incorrect for an application that intentionally contains landscape screens.**

### Medium confidence

**Fabric / react-native-screens / VideoView relayout makes the failed orientation transition visually appear half-sized or malformed.**

### Low confidence

**`expo-video` itself initiates the orientation failure.**

### Very low confidence

**React Compiler drops or memoizes a required orientation effect.**

### Essentially unrelated

- Supabase signed URL TTL
- storage object paths
- H.264 transcode
- yuv420p
- `faststart`
- playback retry behavior

---

# 17. Acceptance Test

After the architecture change, test all of the following on a physical iPhone.

## Game player

Repeat at least 30 times:

```text
open game
→ play video
→ enter fullscreen
→ exit fullscreen
→ enter fullscreen
```

Expected:

- first attempt always works
- no half-size state
- no snap-back
- no distorted surface
- playback remains usable

## Tagger

Repeat at least 30 times:

```text
portrait screen
→ open tagger
→ landscape
→ back
→ portrait
```

Expected:

- first entry succeeds
- no portrait column
- no half-sized UI
- no orientation bouncing

## Additional stress tests

Test:

```text
enter tagger
→ background app
→ foreground app
```

Test:

```text
enter landscape
→ physically rotate device
→ return
```

Test:

```text
rapidly enter/exit fullscreen
```

Test:

```text
video playing while orientation changes
```

Test:

```text
video paused while orientation changes
```

Test:

```text
cold video load while entering landscape
```

Test both:

- Wi-Fi
- cellular

Playback networking should not influence orientation.

---

# 18. Logging Worth Adding During Testing

For the test build, log:

```text
route name
screen focus
screen blur
window width
window height
reported orientation
requested orientation
player status
video id
timestamp
```

Example:

```ts
console.log("[orientation-debug]", {
  route: pathname,
  width,
  height,
  isFocused,
  timestamp: Date.now(),
});
```

Also subscribe temporarily to orientation-change events if useful.

The goal is to determine whether a failed attempt looks like:

```text
portrait
→ landscape geometry begins
→ portrait request/state returns
```

or:

```text
orientation remains landscape
→ layout alone becomes malformed
```

Those are very different bugs.

---

# 19. What Not to Do Yet

Do not add more timing patches before completing the architecture experiment.

Avoid adding:

```text
setTimeout
extra retries
extra lockAsync calls
extra AppState locks
extra InteractionManager delays
VideoView key bumps
manual remeasure loops
manual window-size transformations
```

Every extra timing mechanism increases the number of actors participating in the race.

The objective is subtraction.

---

# 20. Bottom Line

The strongest working diagnosis is:

> IamSports is asking iOS to dynamically rotate individual screens into landscape while the native application is globally configured as portrait and while navigation/layout/video systems are simultaneously updating. The intermittent half-landscape/snap-back state is most likely the visible result of competing orientation and geometry transitions.

The preferred fix is:

> **Allow the app to support the required orientations globally, make each screen's orientation part of native navigation configuration, and stop imperatively rotating screens during mount/focus/navigation.**

Start with:

```json
"orientation": "default"
```

Then convert the always-landscape tagger to a native landscape route.

Then convert fullscreen playback into a dedicated landscape route.

Only investigate `VideoView`, React Compiler, or additional layout workarounds if the bug survives that architecture.

---

## Primary files likely involved

```text
app.json
app/game-player.tsx
app/tagging-overlay.tsx
app/_layout.tsx
```

Potentially also any nested Expo Router layout files that configure the native stack.

---

## References

Expo Screen Orientation:

https://docs.expo.dev/versions/v54.0.0/sdk/screen-orientation/

Expo app configuration:

https://docs.expo.dev/versions/v54.0.0/config/app/

Expo Video:

https://docs.expo.dev/versions/v54.0.0/sdk/video/

Apple supported interface orientations:

https://developer.apple.com/documentation/bundleresources/information-property-list/uisupportedinterfaceorientations

React Native Screens:

https://github.com/software-mansion/react-native-screens

Expo:

https://github.com/expo/expo

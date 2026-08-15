# Video Playback Standard — every video plays the same way

**Rule:** EVERY video surface behaves consistently. If a user can watch it, it
must **fill + center** its area, render at the **correct aspect ratio**, sit in a
**centered (not edge-to-edge) layout on web**, and offer **fullscreen**. This
covers **all upload categories** (Game, Practice, Scout, Scrimmage, Skills),
**reels**, **content shared to a wall**, and **any future video type**.

**The one exception: the tagging studio.** `app/tagging-overlay.tsx` (native) and
`app/tagging-overlay.web.tsx` (web) are a deliberately different, full-bleed
immersive tagger with their own tag board + custom transport. **Do NOT apply this
standard to the tagger — leave it untouched.** (The tagger has its own fixes for
web sizing; that's separate.)

---

## What "works this way" means (web is where it breaks)

1. **Fill + center the frame.** The video fills the player area and is centered,
   letterboxed cleanly — never small, stretched, or pinned to the top-left.
   - **Gotcha:** on web, expo-video's `VideoView` with `StyleSheet.absoluteFill`
     does NOT size reliably (the frame renders small/top-left). **Fix:** measure
     the container (`onLayout` → `{width,height}`) and pass the `VideoView`
     **explicit pixel dimensions**, then `contentFit="contain"` fills + centers.
     OR use a definite-size wrapper (a fixed `aspectRatio` box). Never rely on
     bare `absoluteFill` for web sizing.
2. **Correct aspect ratio.** `contentFit="contain"` (never `cover`/`fill` for
   playback) so nothing is stretched or cropped.
3. **Centered layout on web.** The viewer is capped at a max width and centered —
   no full-bleed sprawl.
4. **Fullscreen on web.** Provide a fullscreen affordance:
   - **Custom-control players** (own scrubber/buttons, e.g. `game-player`):
     a `⛶` button using the browser **Fullscreen API**
     (`document.documentElement.requestFullscreen()` / `exitFullscreen()`), with
     the icon synced to `fullscreenchange`. (Native orientation-lock is
     phone-only and does nothing on web.)
   - **Native-control viewers** (e.g. `shared-viewer`): `nativeControls` (the
     default) already includes a browser fullscreen button — that's acceptable.

---

## The surfaces (keep this list current)

| Surface | File | Plays | Status |
|---|---|---|---|
| Game / event player | `app/game-player.tsx` | Games + **all** event types (Game/Practice/Scout/Scrimmage/Skills) — every upload lands in a game/event container and plays here | ✅ explicit-dims fill/center + web `⛶` fullscreen |
| Shared / reel viewer | `app/shared-viewer.tsx` | Reels + content shared to a wall | ✅ centered max-width; fullscreen via native controls |
| **Tagging studio** | `app/tagging-overlay.tsx` / `.web.tsx` | tagging only | 🚫 EXCLUDED — leave untouched |

**Event type is only a label.** Game/Practice/Scout/Scrimmage/Skills all play
through the SAME `game-player` — there is no per-category player. Fixing
`game-player` fixes all five.

---

## RULE for any NEW video surface

Any new screen that plays a video is **not done** until it: fills + centers the
frame (explicit dims on web), uses `contentFit="contain"`, sits in a centered
max-width layout on web, and offers fullscreen. Add it to the table above. The
tagger is the only exception.

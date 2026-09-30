# MOBILE WEB TAGGER — UI LOCK

```
STATUS:            LOCKED
PLATFORM:          Mobile web / phone browser ONLY  (isPhoneFrame)
OWNER APPROVAL:    Adam Masten
APPROVED COMMIT:   0a5a517812443dfb3f1ed15a2ac3a3814598b55c
DATE APPROVED:     2026-09-30
LIVE FILE:         app/tagging-overlay.web.tsx   (phone path = isPhoneFrame)
DEPLOYED VIA:      Vercel, built from main (vercel.json -> npx expo export -p web)
GUARDS:            test_mobile_web_tagger_parity.ts   (100 assertions, npx tsx)
```

## THE RULE

**The mobile-web tagger UI/UX described in this document may NOT be changed unless
Adam explicitly authorizes unlocking the specific element being changed.**

Do not infer permission from another feature request. See [§10](#10-change-control).

## RUNTIME IS THE SOURCE OF TRUTH

This lock was earned over five deploys in which the source read correctly and the
phone did not. **Static guards passing is not evidence that anything works.** Two
of the five defects were invisible to any amount of source reading, and one was
caused by an earlier fix in this same sequence. Verify on a real iPhone, on a
video that has saved clips, before claiming anything.

---

## 1. The approved baseline

`0a5a517` contains the whole sequence:

| Commit | What it contributed |
|---|---|
| `3b2ac73` | Phone frame matched to the locked native iPhone tagger: one upper-right action region, the fixed bottom rail, board-mode rule, clip markers, hide/inspect |
| `c23d56d` | `playsInline` — Play no longer hands the video to Safari's own fullscreen player |
| `7870842` | Real visible viewport, honest playback state, reachable tag columns, native rail colours |
| `7ea8357` | A reliable way back from inspection: 500 ms tap window + the `TAG ↑` chip; pan clamp unified |
| `0a5a517` | `TAG` becomes one two-state toggle; pointer-sequence guard on the restore chip |

Verify with `git merge-base --is-ancestor <sha> HEAD` before trusting any claim
that a deploy contains this baseline.

---

## 2. Platform gate — the thing most likely to be broken by accident

```js
const isPhone      = coarsePointer && Math.min(winW, winH) <= 820;  // touch-immersive branch
const isPhoneFrame = isPhone && Math.min(winW, winH) <= 500;        // THIS LOCK
```

`app/tagging-overlay.web.tsx` serves **desktop, tablet browser and phone browser
from one file.** Three rules follow, and all three are guarded:

1. **`isPhone`'s 820 threshold also catches tablet browsers** (iPad mini portrait
   744, iPad 10.9" 820). Narrowing it would shove tablets into the desktop
   layout. **Do not touch it.**
2. **Everything in this lock is gated on `isPhoneFrame`.** Tablet browsers keep
   the pre-parity rendering; desktop never enters the branch at all
   (coarse-pointer gate).
3. **Phone styles are added as new keys, never by editing a shared one.** Shared
   keys (`mTBtn`, `mMark`, `mMarkTxt`, `mTime`, `mTransport`, `mSave`) each have
   exactly one definition; the phone uses separate `*Tight` / `*Phone` variants.
   A guard counts the definitions.

When tablet web gets its own review, `isPhone` and `isPhoneFrame` should
collapse into one. **Until then they stay separate.**

---

## 3. The frame

Same frame as the locked native iPhone tagger
([`NATIVE_IPHONE_TAGGER_UI_LOCK.md`](NATIVE_IPHONE_TAGGER_UI_LOCK.md)), rendered
by the browser. One shell, sport-specific content inside it.

**Top bar:** Back · period rail · phase rail · sport-specific slot (DN/DIST/DR,
flag only) · **`+ Group` then `Save clip`** in one action region, Save far-right.

**Board:** `≤ 5` columns render fixed and share the width; `6+` scroll
horizontally. Decided by column count, **never by sport**. Each column scrolls
vertically inside the bounded board.

**Right rail:** `TAG ↓` · `★` Highlight · `!` POE · `✓` Good Play.

**Bottom:** scrubber with saved-clip markers, then one non-scrolling row —
`TIME · −5s · −1s · play/pause · +1s · +5s · speed · ◄ Tag · Tag ► · Start · End`.

**No per-sport layout branch exists.** The only sport term in the phone branch is
the flag DN/DIST/DR content slot. A guard fails if a second appears.

---

## 4. The viewport — `visualViewport`, never `innerHeight`

**iPhone WebKit has no element Fullscreen API, and Chrome for iOS is WebKit**, so
the address bar and landscape toolbar cannot be dismissed by script.
`requestFullscreen` is simply absent on a non-video element. Do not add a
fake one, and do not touch the viewport meta to chase it — **`user-scalable=no`
and `maximum-scale` must never appear**, and a guard asserts that.

What the phone frame does instead: it measures `window.visualViewport` and
re-measures on its `resize` and `scroll` events, falling back to
`useWindowDimensions` where unavailable.

**`window.innerHeight` is the LAYOUT viewport.** It does not shrink for browser
chrome. Sizing to it puts the bottom of the tagger — and the last tag of every
column — underneath the browser UI. That was a real shipped bug. Every phone
dimension comes from `phoneW` / `phoneH`.

The only remaining path to a true full screen on iPhone is **Add to Home Screen**
(the PWA manifest and `apple-mobile-web-app-capable` are already in
`app/+html.tsx`), which launches standalone with no browser chrome.

---

## 5. Tag columns must reach their last tag

The board's floor is derived from the **measured** height of the bottom bar
(`onLayout` → `mBottomH`), never a hard-coded number. Columns `alignSelf:
stretch` into that bounded height and each scrolls with `flex: 1`,
`overscrollBehavior: 'contain'` and bottom padding so the final chip clears the
floor **and stays there** after the gesture ends.

**Never reintroduce a `maxHeight` derived from a fraction of the window.** The
original bug was `maxHeight: winH * 0.62` — a fraction of the wrong viewport,
unrelated to the box it lived in — which pushed the column's bottom off screen so
reaching the last tag meant rubber-banding the page, which springs back.

**Do not shrink columns to avoid scrolling.**

---

## 6. Playback state is observed, never assumed

`expo-video`'s web player **calls `video.play()` and discards the promise**, then
sets `playing = true` unconditionally — in `play()` *and* in `replace()`, which
fires an unsolicited play on every source swap
(`node_modules/expo-video/build/VideoPlayer.web.js`).

Two rules follow:

1. **No non-gesture autoplay on a phone.** iOS refuses it and the refusal is
   invisible through the player, leaving the transport claiming playback over a
   video parked at 0:00. The first play must be the user's own tap.
2. **The phone transport drives the real `<video>` element**, so the promise is
   available: a rejection is logged and surfaced to the user, and `el.paused` is
   the single source of truth for the play/pause icon. Driving the element keeps
   expo-video in sync, because it listens to that element's own `play`/`pause`
   events.

`playsInline` is **mandatory** on the phone video. Without it mobile Safari hands
the element to its own fullscreen player on `play()`, which looks exactly like the
tagger hiding itself.

**Never show a play state that was not observed.**

---

## 7. Hide / inspect / restore

**Visible:** the full tagging interface. Two ways in to inspection, both setting
the same state:

- tapping exposed video space (`mTapLayer`)
- pressing **`TAG ↓`** in the right rail

**`mChromeHidden` is the ONE authoritative visible/hidden state on a phone.**
`mBoardFS` — the legacy board compact-vs-fullscreen state — is **inert on the
phone path** (§5 made the two variants identical) and is **bypassed, not
deleted**: it is still live for tablet browsers and the desktop fullscreen board.

**Hidden:** video is the inspection surface. Pinch **1×–4×**, pan clamped to
`(dimension × (scale − 1)) / 2` from the **visible** viewport so the frame can
never be dragged away. Two ways back:

- pressing **`TAG ↑`**, the chip in the upper right
- a clean tap on the video

Restoring animates the video back to **1× centred**. **Pinching back to 1× must
NOT auto-restore** — returning to the whole frame while still inspecting is
deliberate.

**Zoom is VIEW ONLY.** It must never alter the source video, a saved clip, crop,
timestamp, export, highlight, tagging data, upload, processing or media metadata.
Nothing about it is persisted. At 1× the transform is the identity.

### Gesture rules that are load-bearing

- Composition is `Gesture.Exclusive(Gesture.Simultaneous(pinch, drag), tapBack)`
  with **tapBack LAST**, so a finger lifted after panning or pinching can never
  restore.
- `tapBack.maxDuration` must be **≥ 500 ms** (RNGH's own default). It was 250,
  which armed a fail timer at touch start and silently killed any deliberate
  300–400 ms press.
- `touchAction: 'none'` appears **exactly once**, on the inspection surface, so
  site-wide accessibility zoom is untouched.

### The ghost-click rule

**`react-native-web`'s `PressResponder` fires `onPress` from a bare DOM `click`
with no preceding pointerdown** — its own source says so — and iOS dispatches a
compatibility click after `touchend` against whatever occupies those coordinates
by then.

So the restore chip is **armed by `onPressIn` and only an armed press restores**;
the arm is consumed either way.

This is why the hide control and the restore control must **not overlap**: their
hit areas clear each other by 6pt (`TAG ↑` + hitSlop ends at y=50, rail `TAG ↓`
starts at y=56), and a guard computes that from the style values. **Moving either
one requires re-checking that clearance.**

---

## 8. Control interaction ≠ video-surface interaction

The chrome-toggle surface is a **self-closing `Pressable` with no children**,
rendered **before** the top bar, board, rail and bottom rail — so those controls
paint above it and their events bubble to their own ancestors. DOM events never
reach a preceding sibling. **Do not give that element children, and do not move
it after the chrome.**

Inside the chrome, **only the rail `TAG ↓` may toggle the mode.** The top bar,
the tag board and the bottom rail may never — guarded per region.

---

## 9. Functional freeze

Future mobile-web work must not modify: taxonomy · categories · category order ·
tag definitions · bundle semantics · `clip_tags` behaviour · save semantics ·
`+ Group` semantics · player authorization · Basketball sticky defense · Football
DN/DIST/DR · right-rail semantics · scrubber behaviour · Start/End · Previous/Next
semantics · zoom behaviour · export · Highlights · RLS / security · video
processing · upload pipeline.

**The web `clips` query must never request `clip_tags.id`.** `clip_tags` is a
composite-key join (`clip_id, tag_id, bundle_number, stat_side`) with no `id`
column; asking for one makes PostgREST reject the whole request with `42703`. On
native that silently removed Previous/Next, the scrub markers and the clip pill
at once. The web query has always been correct — keep it that way.

---

## 10. Change control

A request to add a tag, change taxonomy, fix another sport, modify export or
highlights, change processing or upload, change native/tablet/desktop, or add a
feature elsewhere **does not implicitly authorize changes to the locked
mobile-web frame.**

If future work genuinely requires changing a locked element:

1. Identify the exact locked element.
2. Explain why it must change.
3. Obtain explicit approval from Adam.
4. Change only that element.
5. Re-run the checklist below **on a real iPhone**.
6. Obtain runtime approval again.
7. Update this document's baseline block.

---

## 11. Platform isolation

This lock covers **only the phone-browser path** (`isPhoneFrame`) of
`app/tagging-overlay.web.tsx`.

It does **not** lock: native iPhone (its own lock) · native iPad · **tablet
browser** · desktop web · desktop immersive/fullscreen.

Tablet browser and desktop share this file and are **explicitly unreviewed**.
Work on them must not be treated as permission to alter the phone path, and the
reverse also holds.

---

## 12. Regression checklist — run on a real iPhone

**FLAG FOOTBALL**
- [ ] OFF / DEF / SP boards
- [ ] DN / DIST / DR present and functional
- [ ] `+ Group` and `Save clip` separate, no overlap
- [ ] Previous/Next on a video **with clips**
- [ ] `TAG ↓` hides · `TAG ↑` restores · `TAG ↓` hides again
- [ ] Free-space tap still enters inspection
- [ ] Pinch zoom + pan while hidden; restore returns to 1× centred

**BASKETBALL**
- [ ] OFF / DEF boards; sticky Their Defense / Our Defense, independent
- [ ] Same shell geometry as Flag Football
- [ ] Right rail colours: `★` #f5c518, `!` #DC3545, `✓` #1e8449/#2ecc71

**THIRD SPORT** (Soccer or Lacrosse)
- [ ] Shell identical; all categories reachable; Players column present

**ALL**
- [ ] Play actually advances the video, inline, tagger stays visible
- [ ] Pause works; the icon reflects real playback
- [ ] Every column reaches its **last** tag and it stays put after the gesture
- [ ] ≤5 fixed / 6+ horizontal scroll
- [ ] Vertical column scroll and horizontal board scroll don't fight
- [ ] Scrubber, clip markers, transport, Start/End, Prev/Next all usable
- [ ] Tagger fills the viewport the browser actually gives it
- [ ] Nothing overlaps; nothing sits under browser chrome

**Videos that have clips** (verified live 2026-09-28) — testing Prev/Next on an
untagged video proves nothing:

| Video | Sport | Clips |
|---|---|---|
| `4c2b7e1e-b224-4cf8-bced-07fe88854fbf` — Vs. Bills | Flag Football | 44 |
| AYS Legends '36 | Basketball | 101 |
| Vs AYS | Basketball | 79 |
| QA Soccer Board Test | Soccer | 4 |

**Also sanity-check:** tablet-browser and desktop-web breakpoints unchanged.

---

## 13. Automated guards

`test_mobile_web_tagger_parity.ts` — `npx tsx test_mobile_web_tagger_parity.ts`.
**100 assertions**, source-and-contract style matching
`test_export_ecosystem_contract.ts`:

| § | Covers |
|---|---|
| A | The phone guard is explicit and narrow |
| B | Desktop and tablet isolation |
| C | Previous/Next fixed, visible, outside any scroller |
| D | `+ Group` and `Save clip` in one action region |
| E | Board mode rule (≤5 fixed, 6+ scrolls) |
| F | One shell, every sport |
| G | Inspect zoom scoped and view-only |
| H | The native `clip_tags` lesson carries forward |
| I | Control interaction ≠ video-surface interaction |
| J | Real visible viewport |
| K | Tag columns can reach their last tag |
| L | Playback state observed, never assumed |
| M | Right rail matches the locked native semantics |
| N | Hidden-inspection restore |
| O | Inspection clamps use one viewport |
| P | `TAG` is one two-state toggle on phone |
| Q | Ghost-click cannot restore the chrome |

**They are not a substitute for §12.** Every defect in this sequence shipped with
its guards green.

---

## 14. Canonical screenshots

`docs/ui-locks/mobile-web-tagger/` — see the README there. **Adam's approved
runtime screenshots still need to be added.**

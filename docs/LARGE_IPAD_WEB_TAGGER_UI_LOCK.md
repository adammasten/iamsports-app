# LARGE-IPAD WEB TAGGER — UI LOCK

```
STATUS:            LOCKED
PLATFORM:          Large-iPad browser ONLY  (isTabletWeb)
OWNER APPROVAL:    Adam Masten
APPROVED COMMIT:   025c6ea40affa4b0b3ba406cae3df4e4ddaecc7e
DATE APPROVED:     2026-10-02
LIVE FILE:         app/tagging-overlay.web.tsx   (tablet path = isTabletWeb)
DEPLOYED VIA:      Vercel, built from main (vercel.json -> npx expo export -p web)
GUARDS:            test_large_ipad_web_tagger_lock.ts   (56 assertions, npx tsx)
NOT COVERED:       iPad Mini / small tablets — still OPEN, see §12
```

## THE RULE

**The large-iPad web tagger UI/UX described in this document may NOT be changed unless
Adam explicitly authorizes unlocking the specific element being changed.**

Do not infer permission from another feature request. A request to change a sport's tags,
fix an unrelated bug, or improve desktop web does **not** authorize touching this surface.
See [§11](#11-change-control).

## RUNTIME IS THE SOURCE OF TRUTH

`app/tagging-overlay.web.tsx` serves **desktop, tablet browser and phone browser from one
file**. The guards are source assertions, and **source assertions passing is not evidence
that the iPad works.** The mobile-web lock was earned over five deploys where the source
read correctly and the device did not. Verify on a real large iPad, in Chrome, on a video
that has saved clips, before claiming anything about this surface.

---

## 1. The approved baseline

`025c6ea` contains the whole large-iPad sequence:

| Commit | What it contributed |
|---|---|
| `6df1b28` | The large-iPad web tagging layout: video-as-canvas, columns over the video, the real 300px clips panel as a layout column |
| `cdc4257` | Stopped depending on true browser fullscreen; duplicate `fsClips` panel deleted so one clips panel serves every presentation |
| `7e16f10` | `+ Group` made legible in the utility rail (it read as absent at `opacity: 0.4` over bright video) |
| `025c6ea` | `⛶` restored on tablet, and Save moved into the utility rail |

Verify with `git merge-base --is-ancestor 025c6ea HEAD` before trusting any claim that a
deploy contains this baseline. For the web, also confirm the live bundle: check the
deployed `entry-*.js` actually changed, not just that Vercel reported success.

---

## 2. The platform gate — the thing most likely to be broken by accident

```js
const LARGE_TABLET_MIN_W   = 1000;
const LARGE_TABLET_MIN_H   = 700;
const LARGE_TABLET_MAX_SIDE = 1500;

const touchDevice = (navigator.maxTouchPoints ?? 0) > 0 || coarsePointer;
const viewportFitsLargeTablet =
  winW >= LARGE_TABLET_MIN_W && winH >= LARGE_TABLET_MIN_H &&
  Math.max(winW, winH) <= LARGE_TABLET_MAX_SIDE;
const isTabletWeb = touchDevice && !isPhone && viewportFitsLargeTablet;
```

Three things here are load-bearing and each has already been got wrong once:

1. **`maxTouchPoints`, not `pointer: coarse` alone.** Attach a Magic Keyboard or trackpad
   and iPadOS reports a **fine, hover-capable** pointer. A media-query-only test fails on
   exactly the rig Adam tags with.
2. **The USABLE viewport, not the screen.** iPad Chrome/Safari spend ~90px of height on
   the address bar. A screen-size threshold is wrong, and the gate is re-evaluated on
   every resize/rotation.
3. **`MIN_H = 700` is what separates a full-size iPad from an iPad Mini** (Mini landscape
   usable height ≈ 654). **Lowering this number silently admits a device that is NOT
   locked and NOT approved.** It is not a tuning constant.

Measured landscape usable heights, iPad Chrome:

| Device | Usable | In this lock? |
|---|---|---|
| iPad Pro 13" | 1366 × ~934 | yes |
| iPad 11" | 1194 × ~744 | yes |
| iPad 10.9" | 1180 × ~730 | yes |
| iPad 9th gen | 1080 × ~720 | yes |
| **iPad mini** | **1133 × ~654** | **NO — excluded on height** |

---

## 3. The layout does NOT depend on the Fullscreen API

```js
const fsLayout = isFS || isTabletWeb;
```

**This is the most important line on this surface.** On a tablet the immersive
presentation is driven by `isTabletWeb` **alone**, never by the Fullscreen API. Losing the
fullscreen flag therefore costs the **browser chrome only** and never the tagging
workspace.

Any change that makes the tablet layout depend on `isFS` reintroduces the defect
`cdc4257` removed: an iPadOS fullscreen dismiss would drop the iPad back into the desktop
split mid-game.

---

## 4. KNOWN AND ACCEPTED PLATFORM LIMITATION — WebKit fullscreen dismiss

**iPadOS/WebKit can dismiss true browser fullscreen on a downward drag. This is NOT an
IamSports defect and is NOT to be worked around.**

Investigated to conclusion on 2026-10-02. The decisive finding: **the Fullscreen API
defines only `fullscreenchange` and `fullscreenerror`, both fired *after* the transition,
neither cancellable.** There is no `beforefullscreenexit`. No page has standing to refuse
a fullscreen exit — deliberately, as an anti-abuse rule. Re-entering automatically is also
impossible: `requestFullscreen()` requires transient user activation, which a
UA-initiated exit does not grant.

Also established:

- `overscroll-behavior: contain` **is** supported (iOS Safari 16.0+) and **is already
  applied** to `mColScroll` and `tabClipsScroll`. It governs scroll **chaining**, not the
  UA dismiss gesture. It was already tried.
- `react-native-web` 0.21.2 does emit `overscrollBehavior` (it appears in
  `invalidMultiValueShortforms`, meaning *single values only*), so the containment is real
  and reaching the DOM — not silently dropped.
- `navigationUI: 'hide'` governs entry chrome only and is ignored by WebKit.

**DO NOT ADD, now or later, without Adam explicitly reopening this:**

| Rejected | Why |
|---|---|
| `preventDefault` on touch | Cannot veto the exit (no cancellable event) and breaks scrolling |
| `touchmove` interception | Destroys momentum scrolling |
| `scrollTop` pinning / reset | Fights the user instead of the platform |
| `touch-action` hacks on the columns | Kills the vertical tag scrolling this lock protects |
| Momentum-scroll compromises | The columns must scroll like native |

**The non-fullscreen large-iPad Chrome workspace is itself an approved experience.** When
the OS drops fullscreen, Adam taps `⛶` again. That is the accepted cost.

---

## 5. Video as canvas — columns over the video, video not darkened

- `tabBoardClear` makes the board container **transparent**: the approved look backs the
  **columns**, not the whole video.
- `tabCol` carries its own `rgba(0,0,0,0.38)` backing, which is what keeps chips legible
  without dimming the film.

Darkening the full video to improve chip contrast is a regression, not an improvement.

---

## 6. Scrolling — every tag must stay reachable

The tablet uses a **definite-height scroll chain**, because a content-sized column cannot
scroll and that is how tags became unreachable before:

```
definite board height → tabBoardScroll (flex:1, horizontal)
  → mBoardRowStretch → tabCol (alignSelf: stretch)
    → mColScroll (flex:1, overscrollBehavior: contain)
```

- **Tag columns** scroll vertically; `overscroll-behavior: contain` stops a column that
  hits its end from chaining into the clips rail.
- **The clips rail** scrolls independently (`tabClipsScroll`, also `contain`).

---

## 7. One shared clips panel

`cdc4257` deleted the duplicate `fsClips` panel. There is now **one** real 300px
`clipsPanel`, used as a layout column in every presentation. Two panels drift apart; do
not reintroduce a second one.

- **Starts OPEN** on tablet. The tablet keeps its **own** collapse memory
  (`iamsports.tagger.clipsCollapsed.tablet`), because desktop and tablet have very
  different width budgets and a shared key made the iPad open collapsed.
- Absent key → open (the check is `=== '1'`, so anything absent is false).
- Collapses to the thin `clipsStrip` and reopens from it.
- **Edit and Delete stay available** on every clip card, with the tablet's larger 34px
  hit areas and a full `Delete` word rather than the cramped `✕`.

---

## 8. Utility rail — presence and order

Top to bottom in `fsRail`:

| # | Control | Notes |
|---|---|---|
| 1 | `TAG ↑/↓` | board size toggle |
| 2 | **`Save`** | tablet only; the SAME `commitClip` / `canSave`, relocated — never a second implementation. Purple `#534AB7`; disabled uses an **opaque** muted purple, because a translucent fill over bright video took the label with it |
| 3 | **`+Grp`** | shared `addGroup` / `canAddGroup` / `groupCount`. **Solid green `#1D9E75`** enabled, `#14543F` disabled-but-legible. At `opacity: 0.4` over video it read as **absent** next to TAG/★/!/✓ — that is the regression `7e16f10` fixed |
| 4 | `★` | highlight |
| 5 | `!` | POE |
| 6 | `✓` | Good Play (only when the global tag exists) |

`fsRail` is its own style key. **`mRail` is NOT repurposed** — the locked phone frame
renders from `mRail`.

Also required on this surface:

- **`‹` Back** — present on tablet because the solid top bar that normally carries Back is
  not rendered there. Without it the tablet has no way out of the tagger.
- **`⛶` / `⤡` fullscreen** — the shared `toggleFS`, offered again as of `025c6ea`.
- **Start / End** mark controls in the bottom transport row.
- **Scrubber with saved-clip markers** — a tablet never sees the split scrubber, so
  without these there is nothing showing where the tagged plays are.

---

## 9. Game-state controls are the large treatment

`tabTop` (min-height 60), `tabChip` (38 × 34), `tabChipTxt` (14), `tabLbl`, `tabNum`,
`tabColHead` (12). Period / phase / DN / DIST / DR all take these. Reverting any of them
to the phone sizes makes the controls unusable at arm's length on a 13" iPad.

---

## 10. Shared semantics — no second implementation

Columns come from `categoriesForSport` + `withPlayersColumn`; sticky context from
`stickyContextCategory` / `stickyPhaseForCategory`; tap / group / save from the shared
`tapTag` / `addGroup` / `commitClip`. The tablet is a **presentation** of the one tagging
model, never a fork of it.

---

## 11. Change control

To change anything in this document:

1. Adam names **the specific element** being unlocked, in writing.
2. The change is scoped to that element. Keep it behind `isTabletWeb`, and **add new
   `tab*` style keys rather than editing shared ones** — editing a shared key moves
   desktop and the locked phone frame too.
3. Update this document in the same commit, including the approved commit SHA.
4. Update `test_large_ipad_web_tagger_lock.ts` in the same commit.
5. Re-verify on a real large iPad before the lock is considered re-established.

A change that skips these is reverted, not patched.

---

## 12. iPad Mini / small tablets are NOT covered

**Explicitly open.** The gate excludes them (`MIN_H = 700`), so today a Mini renders
whatever the non-tablet web path gives it. That experience has **not** been reviewed or
approved, and nothing in this document blesses it.

When Adam wants to evaluate small tablets, that is its own phase. **Do not widen
`LARGE_TABLET_MIN_H` to admit a Mini as a side effect of any other work.**

---

## 13. Platform isolation

| Surface | Governed by |
|---|---|
| Large-iPad browser | **this document** (`isTabletWeb`) |
| Phone browser | `docs/MOBILE_WEB_TAGGER_UI_LOCK.md` (`isPhoneFrame`, locked) |
| Native iPhone | `docs/NATIVE_IPHONE_TAGGER_UI_LOCK.md` (`!isTablet`, locked) |
| Native large iPad | `docs/LARGE_IPAD_NATIVE_TAGGER_UI_LOCK.md` (`isTablet`, locked) |
| Desktop web | not locked |
| iPad Mini / small tablet | **not locked, not reviewed** |

The phone branch must never read `isTabletWeb`, and this branch must never read
`isPhoneFrame`. Both directions are asserted by the guards.

---

## 14. Regression checklist — run on a real large iPad, in Chrome

1. Open a game with saved clips. The tagger opens in the immersive layout **without**
   entering fullscreen.
2. Clips panel is **open**. Collapse it → video reclaims 300px. Reopen it.
3. Scroll a long tag column (e.g. *Our Player Action*) to its last tag. It reaches the end
   and does **not** drag the clips rail with it.
4. Scroll the clips rail independently.
5. `+Grp` is clearly visible both enabled and disabled. Tap two tags → `+Grp` → it shows a
   count.
6. `Save` is in the rail, purple, and commits the clip.
7. `Start` / `End` set the window; the scrubber shows markers for saved clips.
8. `Edit` and `Delete` work on a clip card.
9. `‹` Back leaves the tagger.
10. `⛶` enters fullscreen. Swipe down → fullscreen may drop. **The workspace must look
    identical afterwards** — only browser chrome returns. Tap `⛶` again.
11. Rotate to portrait → the layout leaves the tablet presentation (width < 1000). Rotate
    back → it returns.

---

## 15. Automated guards

```bash
npx tsx test_large_ipad_web_tagger_lock.ts     # 56 assertions
npx tsx test_mobile_web_tagger_parity.ts       # phone frame must not move
npx tsx test_native_iphone_tagger_shell_lock.ts
npx tsx test_large_ipad_native_tagger_lock.ts
npx tsx test_basketball_sticky_contract.ts
npx tsx test_export_ecosystem_contract.ts
npx tsc --noEmit
```

The guards are mutation-tested. Lowering `MIN_H`, making `fsLayout` depend on `isFS`, or
reverting `+Grp` to the invisible treatment each turn the suite red.

**What the guards deliberately do NOT lock:** exact pixel values that do not change the
approved UX, comment text, internal variable names, or the order of unrelated JSX. A
refactor that preserves the gate, the regions, the scrolling, the clips architecture and
the control set is free to land.

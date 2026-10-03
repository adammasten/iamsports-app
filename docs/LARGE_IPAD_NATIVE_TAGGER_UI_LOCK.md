# LARGE-IPAD NATIVE TAGGER — UI LOCK

```
STATUS:            LOCKED
PLATFORM:          Native iPad tablet path  (isTablet)  — APPROVED ON A LARGE iPAD
OWNER APPROVAL:    Adam Masten
APPROVED COMMIT:   025c6ea40affa4b0b3ba406cae3df4e4ddaecc7e
DATE APPROVED:     2026-10-02
LIVE FILE:         app/tagging-overlay.tsx   (tablet path = isTablet)
GUARDS:            test_large_ipad_native_tagger_lock.ts   (51 assertions, npx tsx)
COEXISTS WITH:     docs/NATIVE_IPHONE_TAGGER_UI_LOCK.md — that lock is NOT weakened
NOT COVERED:       iPad Mini / small tablets — still OPEN, see §9
```

## THE RULE

**The large-iPad native tagger UI/UX described in this document may NOT be changed unless
Adam explicitly authorizes unlocking the specific element being changed.**

This lock exists for **regression protection**, not to force the native iPad to match web
pixel-for-pixel. The two surfaces are allowed to differ; what is locked is that neither
quietly loses a control or a region. See [§8](#8-change-control).

## RUNTIME IS THE SOURCE OF TRUTH

These are source assertions. **They passing is not evidence the iPad works.** The native
iPhone lock records a defect class that no amount of source reading catches (the
`clip_tags`-has-no-`id` trap that silently emptied `existingClips`). Verify in a real
TestFlight build on a real large iPad, on a video that has saved clips.

---

## 1. The approved baseline

**No redesign happened.** `git log 56da2f2..HEAD -- app/tagging-overlay.tsx` returns only
`4f07a97` — the native iPhone lock commit itself. The native iPad presentation Adam
approved on 2026-10-02 is therefore the **same code that was already shipping** at the
iPhone lock; this document records approval of the existing behaviour and adds guards
around it, exactly as asked.

Verify with `git merge-base --is-ancestor 025c6ea HEAD`.

---

## 2. ⚠️ SCOPE: the native gate includes an iPad Mini — the approval does not

```js
const isTablet = Math.min(winW, winH) >= 700;
```

An iPad Mini is **744 × 1133**, so on **native** `isTablet` is **true** for a Mini. There
is no browser chrome to subtract, which is why the native gate behaves differently from
the web one.

So, precisely:

- **What is locked:** the **shell contract** of the `isTablet` branch — its regions,
  control sets, ordering and handler wiring.
- **What is NOT locked:** the claim that this shell is *right for a Mini*. Adam reviewed
  it on a large iPad only.
- **Consequence:** introducing a narrower native large-iPad gate later is **permitted**,
  because the Mini is not locked. That would be a scope change to this document, not a
  violation of it.

The **web** lock has no such ambiguity — its gate structurally excludes the Mini.

---

## 3. Two bottom-corner rails, centre floor clear

The phone keeps a horizontal controls row; the iPad tucks everything into two narrow
vertical stacks in the bottom corners so the centre of the video stays clear.

Both rails are `pointerEvents="box-none"` (the video stays reachable between them) and
both are measured for the clip pill (`measurePill('leftRail'…)`, `measurePill('rightRail'…)`).

### LEFT rail — playback, play/pause at the very bottom

| # | Control |
|---|---|
| 1 | `◄ Tag` / `Tag ►` — prev/next tagged play (`jumpToTag`), only when `existingClips.length > 0` |
| 2 | timecode |
| 3 | speed |
| 4 | `-5s` / `+5s` |
| 5 | `-1s` / `+1s` |
| 6 | **play/pause — last, at the very bottom, under the thumb** |

### RIGHT rail — clip actions, Start at the very bottom

| # | Control | Wiring |
|---|---|---|
| 1 | `TAG ↑/↓` | board size toggle |
| 2 | `! POE` | `togglePOE`, disabled until `videoReady` |
| 3 | `★` Highlight | disabled until `videoReady` |
| 4 | Good Play | — |
| 5 | `+ Group` | shared `addGroup` |
| 6 | `Save clip` | shared `saveClip`, `!canSave → saveBtnDisabled` |
| 7 | `End` | `setEndTime(player.currentTime)` |
| 8 | `Start` | `setStartTime(player.currentTime)` |

This order is the **iPad cross-sport standard** recorded in CLAUDE.md and is the same on
every sport. A control disappearing from either rail is the regression these guards exist
to catch.

> Note for a future tidy, not a defect: the rail renders Save from `iSaveBtn2`, and an
> `iSaveBtn` key also exists in the stylesheet. Harmless; left alone deliberately because
> this task is lock-only.

---

## 4. Tag board on tablet

- Headers, chips and chip text take the tablet sizes: `colHeaderBig`, `tagChipBig`,
  `tagChipTextBig`. Reverting any to the phone sizes makes the board unusable at arm's
  length.
- **Six-plus-column sports scroll horizontally**, count-based:
  `needsColumnScroll = visibleCategories.length > 5 && tagBoardW > 0`, with
  `pinnedColW = (tagBoardW − TAG_COL_GAP × 4) / 5`. Columns are **pinned to the 5-column
  width and overflow**; they are never squeezed. Flex children would shrink to ~16.7%,
  which is exactly what must not happen.
- **≤5 columns keep the original untouched flex path** (`styles.tagColumn`), so those
  boards are pixel-identical by construction.
- Per-column vertical scrolling is intact.
- The column strip is built once (`tagColumnEls`) and reused by both branches —
  duplicating the tree remounts every column and loses its scroll position.

---

## 5. iPad geometry / safe area

| Region | Tablet value |
|---|---|
| board left | `insets.left + 104` |
| board right | `insets.right + 120` |
| board bottom | `insets.bottom + 40` |
| scrubber left | `insets.left + 112` |
| scrubber right | `insets.right + 124` |

These clear the two corner rails. Losing them puts the board under the controls.

---

## 6. Top bar routing — and one KNOWN OPEN gap

- **Flag football** renders its top bar on tablet and phone alike (`isFlag || !isTablet`).
  Flag is the reference layout.
- **Non-football sports on iPad** (`iPadNonFootball = isTablet && !isFootball`) render
  their period/phase clusters **in the top bar** — the `14b0918` cross-sport move.

**KNOWN OPEN DEVIATION:** **Football and 7-on-7 on iPad still use the floating clusters**
(`isTablet && !isFlag && !iPadNonFootball`), not the top bar. That diverges from the
CLAUDE.md iPad standard, it is a **pre-existing queued item**, and **this lock does not
bless it.** The guards deliberately do **not** assert it, so closing that gap later will
not trip them.

---

## 7. Shared semantics — no second implementation

Columns from `categoriesForSport` + `withPlayersColumn`. Sticky basketball context from
`stickyContextCategory` / `stickyPhaseForCategory` (guarded separately by
`test_basketball_sticky_contract.ts`). Phase display stays **display-only** —
`displayPhaseForSport(...) ?? sportPhases?.[0]?.code ?? null` — so opening a board never
writes a possession. The clip pill is the shared `ClipPill`.

---

## 8. Change control

1. Adam names **the specific element** being unlocked, in writing.
2. The change is scoped to that element. Add new `i*` / `*Big` style keys rather than
   editing shared phone keys — **editing a shared key moves the locked native iPhone
   shell.**
3. Update this document in the same commit, including the approved commit SHA and build.
4. Update `test_large_ipad_native_tagger_lock.ts` in the same commit.
5. Re-verify in a TestFlight build on a real large iPad.

A change that skips these is reverted, not patched.

---

## 9. iPad Mini / small tablets are NOT covered

**Explicitly open**, and on native this matters more than on web: as §2 explains, a Mini
*does* currently enter this branch. Nothing here says that is the right experience for it.

When Adam evaluates small tablets, that is its own phase, and narrowing the native gate is
one of the legitimate outcomes.

---

## 10. Platform isolation — the iPhone lock is not weakened

| Surface | Governed by | Gate |
|---|---|---|
| Native iPhone | `docs/NATIVE_IPHONE_TAGGER_UI_LOCK.md` (build 76, `56da2f2`) | `!isTablet` |
| Native large iPad | **this document** | `isTablet` |
| Phone browser | `docs/MOBILE_WEB_TAGGER_UI_LOCK.md` | `isPhoneFrame` |
| Large-iPad browser | `docs/LARGE_IPAD_WEB_TAGGER_UI_LOCK.md` | `isTabletWeb` |
| iPad Mini / small tablet | **not locked, not reviewed** | — |

The two native locks coexist: the phone shell renders from the `!isTablet` path, the iPad
from `isTablet`. The guards assert in **both** directions — that the phone-only controls
row and clusters stay `!isTablet`, that the iPad rails never render on the phone, and that
both the phone style key and its tablet override exist separately.

---

## 11. Regression checklist — run on a real large iPad, TestFlight

1. Open a game with saved clips. Both bottom-corner rails appear; the centre of the video
   is clear.
2. Left rail: `◄ Tag` / `Tag ►` jump between tagged plays. Play/pause is at the very
   bottom.
3. `-1s` / `+1s` and `-5s` / `+5s` all step the playhead.
4. Right rail, top to bottom: `TAG`, `! POE`, `★`, Good Play, `+ Group`, `Save clip`,
   `End`, `Start`. Nothing missing, nothing reordered.
5. `POE` and `★` are visibly disabled until the video is ready.
6. Tag a basketball **DEF** board (6 columns): the strip scrolls sideways, columns 1–5 are
   at normal width, column 6 is off-screen until swiped. Per-column vertical scroll still
   works.
7. Tag a basketball **OFF** board (5 columns): no horizontal scroll, original widths.
8. `Start` / `End` / `Save clip` commit a clip; the clip pill appears when the playhead is
   inside it.
9. Flag football: top bar carries periods / OFF-DEF-SP / DN-DIST-DR.
10. Basketball: periods and OFF/DEF are in the **top bar** (not floating).
11. The board and scrubber clear both rails — nothing is under a control.

---

## 12. Automated guards

```bash
npx tsx test_large_ipad_native_tagger_lock.ts     # 51 assertions
npx tsx test_native_iphone_tagger_shell_lock.ts   # phone shell must not move
npx tsx test_large_ipad_web_tagger_lock.ts
npx tsx test_mobile_web_tagger_parity.ts
npx tsx test_basketball_sticky_contract.ts
npx tsx test_export_ecosystem_contract.ts
npx tsc --noEmit
```

Mutation-tested: removing `Save clip` from the right rail turns three assertions red
(presence, order, and wiring).

**What the guards deliberately do NOT lock:** exact inset pixel values beyond the ones
listed in §5, comment text, internal variable names, JSX order of unrelated regions, or
the Football/7-on-7 top-bar deviation in §6. A refactor that preserves the gate, the two
rails, the control sets and ordering, the board scroll behaviour and the shared wiring is
free to land.

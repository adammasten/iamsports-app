# NATIVE IPHONE TAGGER — UI LOCK

```
STATUS:                   LOCKED
PLATFORM:                 Native iPhone only
OWNER APPROVAL:           Adam Masten
APPROVED TESTFLIGHT BUILD: 76  (version 1.0.0)
APPROVED COMMIT:          56da2f27b5d93f5e275e0c2e126aef153cf51c9a
EAS BUILD ID:             4e62ac54-f0fb-493d-88e2-e8fbe83c2c4b
SUBMISSION ID:            3016a3ac-5ae1-4882-a40b-d131ee0186a9
DATE APPROVED:            2026-09-29
LIVE FILE:                app/tagging-overlay.tsx   (phone path = !isTablet)
```

## THE RULE

**The native-iPhone tagger UI/UX described in this document may NOT be changed
unless Adam explicitly authorizes unlocking the specific element being changed.**

Do not infer permission from another feature request. See
[§13 Change control](#13-change-control).

## RUNTIME SCREENSHOTS > SOURCE-CODE ASSUMPTIONS

A future implementation is **not** equivalent because its JSX or styles look
equivalent. This lock was earned by three TestFlight builds in which the source
looked right and the screen did not. Verify on a device, on a video that has
saved clips, before claiming anything works.

---

## 1. The approved baseline

HEAD `56da2f2` contains all three commits that produced the approved state:

| Commit | What it contributed |
|---|---|
| `50bc423` | Canonical native-phone top shell; Basketball / non-flag phone shell normalization; Save Clip / + Group collision fix; bottom-rail zoning |
| `9ac1f07` | Final fixed bottom control rail (no scroller); native-phone hidden-overlay pinch-zoom / pan inspection mode |
| `56da2f2` | `existingClips` / `clip_tags` query regression fix — restores clip markers, clip pill and Previous/Next data loading |

Verify with `git merge-base --is-ancestor <sha> HEAD` before trusting any claim
that a build contains this baseline.

---

## 2. ONE LOCKED FRAME, SPORT-SPECIFIC CONTENT INSIDE IT

The approved shell is **not** a Football or Basketball design. It is the
canonical native-iPhone tagger frame for **every** sport, present and future.

**The shell owns geometry. The sport configuration owns content.**

### Top rail (single row, in the black band above the video)

```
Back | period rail | phase rail | [sport-specific slot] | + Group | Save clip
```

- Every native-iPhone sport renders this same rail.
- Basketball and other non-flag sports **must not** return to the legacy
  floating period/phase clusters (absolute `periodCluster`, `width:120`,
  `flexWrap`) — those wrapped six periods into 2–3 rows that collided with the
  first category header. They are now iPad-only and must stay that way.
- The absence of sport-specific metadata **must not** cause a sport to collapse
  or wrap its period controls into the board. **Empty optional space is
  preferable to a different frame.**

### Centre

- Same board top boundary, bottom boundary and left/right shell boundaries for
  every sport. On phone these are constants — no sport term appears in them.
- Same relationship to the video; same right-rail position.

### Right action rail

`TAG ↑/↓` (hide/show the board) · `★` Highlight · `!` POE · `✓` Good Play

`TAG ↑/↓` is the board hide/show control. **It is not Previous/Next tagged-play
navigation.** They are separate features and are never to be conflated.

### Bottom

Scrubber with clip markers, then one non-scrolling row:

```
TIME | -5s | -1s | play/pause | +1s | +5s | speed | ◄ Tag | Tag ► | Start | End
```

### Interaction

Tap to hide/show the tagging chrome · pinch-zoom + pan while the chrome is
hidden · restoring the chrome resets the video to 1× centred · Previous/Next ·
scrubber · Start/End · Save / + Group.

### Safe area

One native-phone safe-area strategy shared by every sport: `insets.left/right +
12` on the top bar and control rail, `insets.bottom + 76` for the side strip,
`insets.left + 12` / `insets.right + SIDE_STRIP_W + 24` for the board.

---

## 3. The sport-specific control slot

The frame intentionally reserves a region in the top rail for sport-specific
controls. Football demonstrates why it exists: Flag Football fills it with
**DN / DIST / DR**.

Other sports may put different controls there, fewer, or none. A sport with
nothing to put there leaves it empty. **Do not reflow the shell to consume it.**

**Do not generalise Football metadata to sports where it is not persisted.**
`saveClip` writes `clip_football` only when `isFlagFootball(sport)`, so DN/DIST/DR
renders for Flag Football only. Rendering it for Football-11v11 or 7-on-7 would
put a control on screen that silently never saves. Widening it is a **product**
change (widen the save path first), not a layout change.

---

## 4. NO isFlag-STYLE SHELL FORKS

The historical failure: `isFlagFootball()` matches only the exact string
`'flag football'`, so Flag Football got the good top-bar rail while Basketball,
Soccer, Lacrosse, 7-on-7 and Football-11v11 fell through to a legacy phone
shell. That architecture must not return.

**Sport checks may determine CONTENT. They must never determine phone shell
geometry.**

Forbidden:

```
isFootball   ? footballPhoneLayout   :
isBasketball ? basketballPhoneLayout :
isSoccer     ? soccerPhoneLayout     : ...
```

Required shape (the rule matters more than the file structure — do not refactor
purely to rename things):

```
Canonical native-phone shell   <- owns geometry
  ├── period configuration      (lib/core/periods.ts)
  ├── phase configuration       (lib/core/tag-categories.ts)
  ├── optional sport controls   (the reserved slot)
  ├── sport taxonomy board      (lib/core/tag-categories.ts)
  └── roster / player data
```

### Audit of the approved baseline (2026-09-29, `56da2f2`)

Every sport conditional on the phone path was classified. **Zero
sport-specific shell-geometry forks remain.**

| Line | Condition | Phone effect | Verdict |
|---|---|---|---|
| top rail gate | `!isWatch && (isFlag \|\| !isTablet)` | always true on phone | shell — one rail, every sport |
| DN/DIST/DR | `isFlag` | inside the reserved slot | **content** — allowed |
| `iPadNonFootball` block | `isTablet && !isFootball` | never on phone | iPad only |
| `topReadout` | `isTablet && !isFlag` | never on phone | iPad only |
| legacy period cluster | `isTablet && !isFlag && !iPadNonFootball` | never on phone | iPad only |
| legacy phase cluster | `isTablet && !isFlag && !iPadNonFootball` | never on phone | iPad only |
| board left/right/bottom | `isTablet ? … : <constant>` | constant | shell — no sport term |
| scrubber padding | `isTablet ? … : 12` | constant | shell — no sport term |
| `topActions`, `sideStrip`, `controlsRow` | `!isTablet` | all phone sports | shell |
| `possOptions` filter | `isFootball \|\| name !== 'Special Teams'` | which phases exist | **content** — allowed |

---

## 5. Sport matrix

Every currently supported sport. Generated from the real contract
(`lib/core/tag-categories.ts`, `lib/core/periods.ts`), not hand-written.

**The invariant for every row is: SHELL = CANONICAL NATIVE-IPHONE SHELL.**
Only the configuration changes.

| Sport | Period model | Phases | Sport controls | Columns (per phase) | Board mode | Sticky | Exceptions |
|---|---|---|---|---|---|---|---|
| **Flag Football** | Q1–Q4, 1H, 2H | OFF / DEF / SP | **DN / DIST / DR** | OFF 6, DEF 6, SP 4 | scroll / scroll / fixed | none | SP hidden for 5v5 format; only sport writing `clip_football` |
| **Football** (11v11) | Q1–Q4, 1H, 2H | OFF / DEF / SP | *(slot empty)* | OFF 6, DEF 6, SP 4 | scroll / scroll / fixed | none | DN/DIST/DR withheld — not persisted for this sport |
| **7-on-7** | Q1–Q4, 1H, 2H | OFF / DEF | *(slot empty)* | OFF 6, DEF 6 | scroll | none | DN/DIST/DR withheld — not persisted |
| **Basketball** | Q1–Q4, 1H, 2H | OFF / DEF | *(slot empty)* | OFF 5, DEF 6 | fixed / scroll | **OFF→`off_opp_look`, DEF→`def_scheme`** | Only sport with sticky context |
| **Soccer** | 1H, 2H | OFF / DEF | *(slot empty)* | OFF 6, DEF 6 | scroll | none | — |
| **Lacrosse** | Q1–Q4 | OFF / DEF | *(slot empty)* | OFF 6, DEF 6 | scroll | none | — |
| **Baseball** | 1–9, EX | OFF / DEF | *(slot empty)* | OFF 3, DEF 4 | fixed | none | Innings as periods |
| **Softball** | 1–9, EX | OFF / DEF | *(slot empty)* | OFF 3, DEF 4 | fixed | none | Innings as periods |
| **Volleyball** | S1–S5 | *(flat, no phases)* | *(slot empty)* | 5 | fixed | none | Sets as periods; phase rail empty |
| *(fallback `_default`)* | none | *(flat)* | *(slot empty)* | 4 | fixed | none | Unknown sport — board never renders blank |

Teams live in production today for: basketball (6), flag football (1),
soccer (1), lacrosse (1). The other rows are seeded and reachable.

Column counts include the roster-sourced Players column, which the sport
definition positions (Basketball OFF puts it **third**, not last — that is
taxonomy, and it is correct).

### Future sports

A new sport does **not** get a new native-iPhone tagger UI. Adding a sport means
supplying its period model, phases, optional sport metadata, taxonomy,
categories, tags and roster behaviour **into the existing canonical shell**.
Never copy `tagging-overlay.tsx` to make another sport-specific phone
implementation.

---

## 6. Board behaviour

- **≤ 5 columns** → the approved fixed native board path.
- **6+ columns** → the approved horizontal board scrolling path
  (`needsColumnScroll = visibleCategories.length > 5`), five columns pinned to
  the board width and the rest scrolled to.
- **Do not shrink columns to force 6+ categories into the 5-column frame.** The
  outer shell stays fixed; the category board scrolls internally.
- Players is positioned by the sport definition (`withPlayersColumn`), not by
  the shell.

---

## 7. Previous / Next tagged-play navigation

**Required functionality, not optional polish.**

When the current video contains saved navigable clips, `◄ Tag` and `Tag ►` must
be **visible in the fixed bottom rail**. The rail must never require horizontal
scrolling to discover them. `jumpToTag` semantics are unchanged and locked:
Previous works, Next works, first-tag boundary works, last-tag boundary works,
navigation follows existing saved tagged plays.

Geometry that makes this deterministic — three zones in `controlsRow`:

| Zone | Contents | Flex |
|---|---|---|
| 1 | time, −5s, −1s, play/pause, +1s, +5s, speed | `flex: 1`; timecode is the only `flexShrink: 1` element |
| 2 | `◄ Tag` / `Tag ►` | `flexShrink: 0`, fixed 52×32 each |
| 3 | `Start` / `End` | `flexShrink: 0`, fixed 84 wide each |

Only zone 1 may give up width, and it does so by truncating the timecode.
Measured fixed cost 554pt against 643pt usable on the narrowest supported
landscape phone.

### REGRESSION GUARD — the failure signature

`17360cf` (the clip-pill slice) added `id` to the `clip_tags` embed:

```js
.select('id, start_time, end_time, clip_tags ( id, bundle_number, ... ')
                                                ^^ NO SUCH COLUMN
```

`clip_tags` is a composite-key join table — `clip_id, tag_id, bundle_number,
stat_side`. There is **no `id` column**. PostgREST rejected the entire request
with `42703`, and `if (error || !data) return;` swallowed it, so
`existingClips` was `[]` on every video. Builds 73, 74 and 75 all shipped it.

**That one broken query removed three things at once:**

1. Previous / Next tag navigation
2. Scrubber clip markers
3. The clip pill

**If all three disappear on a video you know is tagged, investigate
`loadExistingClips` — the query and its error — BEFORE touching layout.**
No amount of room in the rail will reveal controls whose gate never passes.

Rules that follow:

- **Never add `id` to a `clip_tags` embed.**
- **Never silently swallow a `loadExistingClips` failure.** It is now surfaced
  via `console.warn` + `Alert`, because an empty tagger on a tagged video is
  indistinguishable from an untagged video.
- When verifying a "missing UI" claim, replay the exact query under the user's
  own JWT with RLS enforced (`set local role authenticated` +
  `request.jwt.claims`) and check the **projection**, not just the row filter.

---

## 8. Save clip / + Group

Both live in one deterministic upper-right action row (`topActions`) in the top
bar: `+ Group` then `Save clip`, with **Save clip remaining far-right**.
Readable, separate tap targets, no overlap, actions and semantics unchanged,
group-count badge retained on `+ Group`.

### Historical regression — do not restore

`+ Group` previously lived in `sideStrip`, absolutely positioned with **both**
`top: insets.top + 60` and `bottom: insets.bottom + 76`. In landscape that box
was shorter than its five children (~231pt); `justifyContent: 'flex-end'` packed
the excess **upward** past the container top, and RN's default
`overflow: 'visible'` painted it over the top bar, colliding with Save clip.

`sideStrip` now carries **no `top`** — it sizes to its content and grows up from
`bottom`, so it can never reach the top bar. **Do not reintroduce `top` on
`sideStrip`, and do not move `+ Group` back into it.**

---

## 9. Bottom transport

Preserve the approved compact geometry. Do not casually enlarge individual
controls in a way that pushes Previous/Next off-screen.

Locked present: time · −5s · −1s · play/pause · +1s · +5s · speed · `◄ Tag` ·
`Tag ►` · `Start` · `End`.

Start/End remain fixed and visible. Previous/Next remain fixed and visible
whenever navigable clips exist. **Do not reintroduce the overflow in which
Start/End painted over Previous/Next** — the original cause was a single
`leftGroup` (`gap:12`, no wrap, no scroll, RN `flexShrink:0` default) needing
~524pt plus Start/End's 200pt against ~702pt of usable width, with `markGroup`
rendering after and painting over the tail. It regressed at `7714b66` when the
speed chip added ~52pt to a row that had ~18pt of headroom.

---

## 10. Hidden-overlay pinch zoom

Approved native-iPhone behaviour.

**Chrome visible:** normal tagging. No gesture interference with chips, rails,
scrubber or transport. The zoom surface is *unmounted*.

**Chrome hidden:** the video is the inspection surface — pinch zoom bounded
**1×–4×**, pan enabled and clamped to `(dimension × (scale − 1)) / 2` so the
video can never be panned completely away. Tap restores the chrome, which
animates the video back to **1× centred**.

Non-interference is structural, not incidental: the surface mounts only when
`!isTablet && !controlsVisible`, and the chrome layer is `pointerEvents:'none'`
exactly when the surface is mounted.

**Zoom is VIEW ONLY.** It must never alter the source video, a saved clip, crop,
timestamp, export, highlight, tagging data, upload, processing or media
metadata. Nothing about it is persisted. At 1× the transform is the identity.

Do not remove this behaviour without explicit approval.

---

## 11. Functional freeze

Future native-iPhone tagger work must **not** accidentally modify:

taxonomy · categories · category order · tag definitions · bundle semantics ·
`clip_tags` behaviour · save semantics · `+ Group` semantics · player
authorization · Basketball sticky defense · Football DN/DIST/DR · right-rail
semantics · scrubber behaviour · Start/End behaviour · Previous/Next semantics ·
zoom behaviour · export · Highlights · RLS / security · video processing ·
upload pipeline.

Each of those requires its own explicit product change.

---

## 12. Platform isolation

This lock applies **only to the native iPhone tagger** (`app/tagging-overlay.tsx`,
`!isTablet` path).

It does **not** lock: iPad native · mobile web · tablet web · desktop web ·
desktop immersive/fullscreen. Those will be reviewed separately.

Work on those platforms must **not** be treated as permission to alter the
native iPhone shell — and the reverse also holds: `app/tagging-overlay.web.tsx`
and the `isTablet` branches were deliberately untouched by this lock's baseline.

---

## 13. Change control

A future request to add a tag, change taxonomy, fix another sport, modify
export, modify highlights, change video processing, change upload, change
iPad/web, or add a feature elsewhere **does not implicitly authorize changes to
the locked native-iPhone shell.**

If future work genuinely requires changing a locked element:

1. Identify the exact locked element.
2. Explain why it must change.
3. Obtain explicit approval from Adam.
4. Change only that element.
5. Re-run the regression checklist below.
6. Obtain runtime approval again (device, not JSX).
7. Update this document's baseline block.

---

## 14. Regression checklist

Run in full for any explicitly-authorized native-iPhone tagger change.
Use a video that **has saved clips** — see the note at the end.

**FLAG FOOTBALL**
- [ ] OFF board
- [ ] DEF board
- [ ] SP board (where the format offers it)
- [ ] DN / DIST / DR present and functional
- [ ] Previous/Next on a video with clips
- [ ] Save clip / + Group separated, no overlap
- [ ] Hide tags
- [ ] Pinch zoom + pan
- [ ] Restore tags → video back to 1× centred

**BASKETBALL**
- [ ] OFF board
- [ ] DEF board
- [ ] Sticky Their Defense (OFF) and Our Defense (DEF), independent
- [ ] Previous/Next on a video with clips
- [ ] Save clip / + Group separated, no overlap
- [ ] Hide tags
- [ ] Pinch zoom + pan
- [ ] Restore tags

**THIRD SPORT** (Soccer or Lacrosse)
- [ ] Shell alignment identical to Football/Basketball
- [ ] All categories reachable
- [ ] Players column present
- [ ] Previous/Next where clips exist

**ALL**
- [ ] Canonical top rail; nothing wraps into the board
- [ ] Board begins at the canonical boundary
- [ ] Right rail aligned
- [ ] Scrubber aligned; clip markers present
- [ ] Clip pill appears inside a saved clip
- [ ] Bottom transport aligned; every control present
- [ ] Start / End aligned
- [ ] ≤5 column fixed behaviour
- [ ] 6+ column horizontal scrolling
- [ ] No overlap anywhere
- [ ] Safe areas correct on a notched phone in landscape

**Videos that have clips** (verified live 2026-09-28):

| Video | Sport | Clips |
|---|---|---|
| `4c2b7e1e-b224-4cf8-bced-07fe88854fbf` — Vs. Bills (Regents Bengals) | Flag Football | 44 |
| AYS Legends '36 (Legends 2036) | Basketball | 101 |
| Vs AYS (Centex Attack Regents) | Basketball | 79 |
| Vs Ravens | Flag Football | 43 |
| QA Soccer Board Test | Soccer | 4 |

Testing Previous/Next on an untagged video proves nothing — the controls are
correctly hidden there. Several of Adam's basketball videos have zero clips.

---

## 15. Automated guards

`test_native_iphone_tagger_shell_lock.ts` — run with
`npx tsx test_native_iphone_tagger_shell_lock.ts`.

It asserts, against the real source and the real sport contract:

- **A.** The `clips` query embeds only columns that exist on `clip_tags`
  (`clip_id`, `tag_id`, `bundle_number`, `stat_side`) — `id` can never come back.
- **B.** `loadExistingClips` surfaces its error instead of swallowing it.
- **C.** Previous/Next is gated on `existingClips.length > 0`, sits in a
  `flexShrink: 0` zone, and no scroller exists in the bottom control rail.
- **D.** Platform guards: the legacy floating clusters and `topReadout` stay
  `isTablet`-gated; the phone board insets carry no sport term; the top rail
  reaches every phone sport.
- **E.** Every sport in the contract flows through the one shell, and the sport
  matrix above still matches the contract.

These are source-and-contract assertions in the style already used by
`test_export_ecosystem_contract.ts` and `test_background_upload_durability.ts`.
They are not a substitute for the device checklist — runtime remains the source
of truth.

---

## 16. Canonical screenshots

`docs/ui-locks/native-iphone-tagger/` — see the README there. **Adam's approved
Build 76 runtime screenshots still need to be added.** They were not available
to the session that wrote this document, and fabricated references would defeat
the purpose of a visual lock.

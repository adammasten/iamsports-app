# Unified Card System — Plan (approved 2026-08-10)

One reusable card component + one detail screen, applied to every surface that
renders a game or reel. **Interaction model from Adam's spec; visual language from
the "IamSports — Dark UI System" artifact** (claude.ai/code/artifact/9ee1c722…).
Build slice by slice, verify one surface on device before rollout.

---

## The model (two layers)

1. **The card is a POSTER** — quiet, scannable, decide-whether-to-open:
   thumbnail · name + date (+ result e.g. "Won 48-41") · a `≡ N clips` chip (hidden
   if 1) · small icon buttons for game-level actions (share ↗, offline ⬇ — NOT
   today's oversized buttons) · a **share-status indicator** · (Wall only) a ▶ play
   button on the thumbnail for watch-in-place.
2. **Tap opens a DETAIL screen** where all complexity lives — clip ROWS (1st Half /
   2nd Half / OT), tap a row = play with **auto-advance 1→2→3**, a per-row `⋯`
   overflow SHEET (Watch / Tag this clip / View clips / Move / Rename / Remove), and
   game-level actions as a bottom button row. Player has a **dual progress bar**
   (segmented game timeline on top, within-clip bar below).

**Uniform tap rule:** tapping a card always opens it. Walls just add the ▶ on the
thumbnail.

---

## Visual tokens (from the design-system artifact → `constants/theme.ts`)

| token | hex | use |
|---|---|---|
| bg | `#000000` | page ground (no white screens) |
| surface | `#1A1A1A` | cards |
| surfaceAlt | `#0D0D0D` | inputs / thumbnail wells |
| border | `#333333` | hairlines |
| borderSubtle | `#2A2A2A` | inner dividers |
| text / textMuted / text-3 | `#FFFFFF` / `#AAAAAA` / `#888888` | primary / secondary / meta |
| brand / brandLight / brandTint | `#534AB7` / `#8B82E8` / `#2A2740` | one accent; links; team-chip bg |
| success | `#1D9E75` / `#32D74B` | done / posted / "all tagged" |
| danger | `#DC3545` | delete only |
| amber | `#C8742B` | GAME badge / highlight |
| tag-status ring | red `#FF453A` · yellow `#FFD60A` · green `#32D74B` | tagging progress ring on GAME badge |

Radii: card 10, panel 14, button 8, badge 10, chip/pill 16–20, thumb 8. Card
padding 14; thumbnail 72×46 (≈16:10). Title 15/700 ellipsis; meta 12/`#888`. System
font. Amber/green/red are **semantic only**, never decoration; brand purple carries
all primary actions.

**Two card states from the artifact worth keeping:** a GAME badge **status ring**
(red=not started → yellow=tagging → green=done) and a green "done" card treatment
(green border + `#14241a` tint) when all videos are tagged. These are *tagging*
status (coach-facing, Film Room). The new **share** status is separate (below).

---

## Component architecture

```
components/content-card/
  ContentCard.tsx      THE poster. Prop-driven per surface.
  ShareStatusPill.tsx  "Only you" (weighted) vs shared (quiet ↗/✓)
  ClipCountChip.tsx    "≡ N clips" (hidden when 1)
  CardNote.tsx         note box below the card (wraps existing ShareNote)
  CardIconButton.tsx   small share ↗ / offline ⬇ buttons
constants/theme.ts     extend with the tokens above (already exists)
app/game-detail.tsx    NEW detail screen (replaces the my-work accordion + game.tsx's viewer role)
  components/detail/
    ClipRow.tsx
    DualProgressBar.tsx  segmented game timeline + within-clip bar (NET-NEW)
    OverflowSheet.tsx    bottom sheet (Modal — copy attach-to-game sheet) replacing Alert menus
    WatchTagToggle.tsx   Film Room ONLY; isolated + removable (open decision)
lib/core/shareStatus.ts  shared helper (extract my-work's batch pattern)
lib/core/playQueue.ts    auto-advance controller (NET-NEW)
```

Reuse existing: `ContentTypeBadge` (REEL/GAME pill), `ShareNote`.

`<ContentCard>` contract: `{ thumbnail, title, date, result?, clipCount?,
shareStatus, note?, actions[], tagStatus?, showPlayOnThumb?, onOpen }`. Tap → onOpen.

---

## Share status (the new requirement)

Uploading does NOT auto-publish — coaches lose track of what's unshared.
- **SHARED** → quiet indicator (small ↗ / ✓), low-key.
- **NOT SHARED** → a muted **"Only you"** pill with slightly more weight, so unshared
  content stands out in the Film Room. Muted, not alarming (some content is
  intentionally private — don't nag). **Weight the unshared state.**

Data: no new schema. `shares` batch query (`select id, audience, team_id,
target_player_id, visible, note where content_type in (…) and content_id in (ids)`)
→ **N cards = 1 query** (pattern already in my-work). `destinations.length === 0`
= "Only you". `lib/core/shareStatus.ts` centralizes it so every surface agrees.

---

## Notes below the card

`shares.note` (NOT `share_comments`). Per-destination, RLS-inherited, author-editable
anytime via `set_share_note(share_id, text)`. A card with a note shows it's there;
the `<CardNote>` box holds the text — **same treatment on every wall**. Already read
in `homeFeed.ts` + rendered by `<ShareNote>`; we consolidate into `<CardNote>`.

---

## Thumbnails

- **Now (auto):** the card takes a `thumbnail` prop that **falls back to the
  type icon** (🏀 GAME / 🎬 REEL) exactly like the artifact — so cards ship before any
  real thumbnails exist. Real auto-thumbnails come from the **optimize pipeline**: an
  ffmpeg poster-frame (`-ss 1 -vframes 1`) written to `thumbnails/<videoId>.jpg`, a new
  `videos.thumb_path` column, served through `sign-media` (which already does image
  keys + a resize transform). Ties into the auto-optimize-on-upload work.
- **Future (flagged, don't build yet):** let a user **lock a custom thumbnail** (pick
  a frame) and **zoom/crop** to reframe the poster. Easy-ish once poster extraction
  exists; parked until asked.

---

## Every surface (grouped)

| Role | Files | Gets |
|---|---|---|
| Workbench | `my-work.tsx` | full card + share-status weighting + tag-status ring + **Watch/Tag toggle** on detail |
| Walls (watch-only) | `(tabs)/index.tsx`, `kid.tsx`, `coaches-corner.tsx`, `select-team.tsx` (home feed), `team.tsx`\*, `team-archive.tsx` | card + **▶ on thumb**, note box, no toggle |
| Shared/recipient | `shared-viewer.tsx`, `shared-game.tsx` | card + detail (recipient-safe RPC path) |
| Clips | `clips.tsx`, `clips-library.tsx` | evaluate — lighter variant (clips ≠ games/reels) |
| Pickers (likely out of scope) | `export.tsx`, `search.tsx` | functional lists; flag, probably leave |

\* `team.tsx` near-duplicates the tab wall — consolidation opportunity.

---

## Slice order (build one, verify on device, roll out)

1. **`<ContentCard>` + `shareStatus` + `CardNote` → Film Room only.** Highest value,
   exercises share-status most. Verify on device.
2. **`app/game-detail.tsx`** — rows, tap-to-play, auto-advance, dual bar, overflow
   sheet, bottom actions + the **isolated Watch/Tag toggle**. Biggest net-new; verify.
3. **Roll `<ContentCard>` to the walls** (team, kid, coaches-corner, home feed) with ▶.
4. **Remaining** (shared-game, team-archive, clips variant); decide pickers.

---

## The one open decision — FLAGGED, not picked

**Watch/Tag toggle (Film Room detail only).** Build as isolated `WatchTagToggle.tsx`,
wired so removal = delete one component + one prop. **Never load-bearing.** Adam
decides later: keep the toggle, or drop it and make tagging a per-row button. Wall
never shows it (parents only watch).

---

## Related / parked (not this project, don't lose)

- **Per-season rosters** — a team (e.g. "Regents 2032") plays multiple seasons/years;
  need rosters scoped per season (and maybe per year). `players`, `games`, `videos`,
  and `shares` already carry `season_id`; the roster-per-season UX/model is a separate
  future feature. Flagged here so season scoping isn't designed away.

## Drift cleanup — DONE (2026-08-10)
- `migration_share_content_add_game.sql` records the `'game'` enum value (repo↔live).
- CLAUDE.md `shares` bullet updated: `note`, `on_wall`, `season_id` + the note vs
  share_comments distinction.

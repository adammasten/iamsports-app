# Family Film Room — tagged games in parents' rooms (coach-toggleable)

**Status:** Plan / not built. Written 2026-08-29 from a read-only investigation.
**Related:** `PLAYER_IDENTITY_AND_TAG_POLARITY_PLAN.md` (the identity + polarity
spine this builds on), `feed_filmroom_and_leaving_teams_design.md`.

---

## The problem
When a parent logs in, their **Film Room is empty**, because the Film Room only
shows footage *they uploaded* — and parents don't upload; coaches do. So the
value a parent gets is limited to whatever a coach chooses to share.

## Root cause (verified in code)
`app/my-work.tsx` `loadGames()` scopes the query with
`.eq('uploaded_by_user_id', userId)` — it fetches only videos the current user
uploaded, never videos they merely have *access* to. It's not a sharing or RLS
problem; the query never asks for anyone else's games.

## What already exists (verified against live DB)
- **`videos_read` RLS already grants a linked parent read** to a coach's game
  video via an `is_lineup_parent(game_id)` branch. A parent *can* already watch
  their kid's game — the Film Room query just doesn't fetch it.
- **Data is present:** `parent_player_links` = 11, player-category `clip_tags`
  applications = 143, `game_lineups` = 29 rows.
- **Two gaps:**
  1. `clips_read` has **no** parent branch → a parent can watch a game but
     **can't read its clips/tags to build a highlight** (unless they're also a
     full `team_member`; 8 parents are).
  2. **Coverage:** of 17 games, only **4 have lineups** but **6 have
     player-tagged clips** — i.e. tagging a kid does NOT currently create a
     lineup row, so `is_lineup_parent` under-fires. **The player-tag is the more
     complete "my kid played here" signal than the lineup.**

## The keystone
Define **"my kid's tagged games" from player tags on clips** (auto-captured every
time a coach tags the kid), and use it to populate the linkage the RLS already
consumes. This is the same `is_my_kids_content` identity spine the polarity, feed,
and leaving-teams docs all call make-or-break — build it once, unlock all of them.

---

## The coach toggle
A **per-team** setting, `teams.parent_film_visible` (coach-controlled, in
`app/team-settings.tsx` beside the accent/snack settings):

- **ON** → parents linked to a roster kid can see (and, later, make highlights
  from) their **own kid's** tagged games from this team's film.
- **OFF** → parents get none of this team's coach film in their room (their own
  uploads and anything the coach explicitly *shares* are unaffected).

The toggle is enforced in RLS (the parent branches check
`parent_film_visible = true`), not just hidden in the UI — so turning it off
actually revokes read access, it doesn't merely hide a button.

**Scope of the toggle:** it gates a parent's access to *coach-uploaded team film
about their own kid*. It never affects: the parent's own uploads, the coach's
deliberate `shares`, or a coach's own access. **Positives-only** still applies to
parents once polarity lands (parents never see/export "lowlights").

**Decision D1 — default value:** recommend **default ON** (maximizes the
empty-room fix; a family accessing their own kid's film matches the app's ethos).
Flag for Adam; could ship OFF if coaches should opt in.

---

## Build order (slices)

### Slice 0 — Verify the identity mapping ✅ DONE 2026-08-29 (GREEN LIGHT)
Verified against the live DB:
- **`tags.player_id` is a direct link and 100% populated** (25/25 player tags) —
  the app's `tagger_player_tags` RPC already resolves via `tags.player_id →
  players.id`. No name/jersey matching needed.
- **The chain reaches real parents:** across the 6 tagged games, player tags →
  17 linked players → **5 distinct real parents** via `parent_player_links`.
- **`is_lineup_parent(game_id)`** = `exists(game_lineups gl where gl.game_id=…
  and is_linked_parent(gl.player_id))` — it consumes `game_lineups.player_id`,
  exactly what Slice 2 writes from `tags.player_id`. Direct fit.
- **Conclusion:** the auto-lineup approach is viable; the cross-team
  `player_lineage_id` work is NOT required for same-team parent access.
- **For Slice 2:** confirm/add a UNIQUE constraint on
  `game_lineups(game_id, player_id)` so the tag→lineup upsert is idempotent.

### Slice 1 — Coach toggle (data + UI, no behavior yet) ✅ DONE 2026-08-29
- `teams.parent_film_visible boolean not null default true` — applied live +
  `migration_teams_add_parent_film_visible.sql`.
- Toggle added to `app/team-settings.tsx` ("Family film" section, coach-only),
  matching the snack-toggle pattern. Writes the column; nothing reads it yet.

### Slice 2 — Auto-populate `game_lineups` from tags ✅ DONE 2026-08-29
- `AFTER INSERT` trigger on `clip_tags` (`sync_lineup_from_clip_tag`, SECURITY
  DEFINER) upserts `game_lineups(game_id, player_id)` from `tags.player_id` when a
  player tag lands on a clip in a game. Idempotent via the existing PK. Add-only.
- Backfilled the tagged games (game_lineups 29 → 40; all tagged games now
  covered). `migration_sync_game_lineups_from_player_tags.sql`.
- `is_lineup_parent(game_id)` now fires for every tagged game.

### Slice 3 — Gate the parent RLS on the toggle ✅ DONE 2026-08-29
- New helper `is_family_film_parent(game_id)` = `is_lineup_parent` semantics AND
  the game's team `parent_film_visible = true` (single toggle-enforcement point).
- `videos_read`: lineup-parent branch now uses `is_family_film_parent`.
- `clips_read`: added a parent branch (clip → video → game →
  `is_family_film_parent`), restricted to `team`/`public_link` visibility so
  `coaches_only`/creator-private clips are never exposed to a parent.
- **Verified (parent impersonation):** own-kid game → TRUE; game their kid isn't
  in → FALSE (no cross-kid leak); toggle OFF → FALSE. `migration_family_film_parent_rls.sql`.
- NOTE: interim pre-polarity, a parent can read ALL their own kid's team clips
  (positives + negatives). Slice 6 (polarity) filters lowlights. Own-kid-only, so
  low sensitivity; keep in mind for the parent-facing UI in Slice 4/7.

### Slice 4 — Parent Film Room query (WATCH) ✅ DONE 2026-08-29
- Added a tight parent branch to `game_lineups_read` (own kid's rows, toggle-aware)
  so the client can resolve "my kid's games" — `migration_game_lineups_read_family_parent.sql`.
- `my-work.tsx` `loadGames()` now runs two queries: (A) my uploads, (B) my kids'
  games (lineups → videos), merged + deduped by video id. Games with no footage
  of mine are flagged `myKidGame`.
- Card gating for family games: labelled "Your child's game"; **read-safe actions
  only** (Download / Combine / open-to-watch) — no Share/Rename/Delete/edit-lineup
  and no offline-cache (a parent doesn't own or tag it). Avoids silent RLS failures.
- **Milestone reached:** tagged games now appear in parents' Film Rooms. Needs a
  build to see on device.

### Slice 5 — Parent self-upload prominence *(parallel, coach-independent)*
- Make it obvious a parent can upload their own footage (already supported as
  teamless/loose upload). Guarantees content even where no coach tags. Optional.

### Slice 6 — Tag polarity ✅ DONE 2026-08-29
- `tags.tag_polarity` text + CHECK (positive/neutral/negative), default neutral.
  Auto-seeded from `stat_made`/`stat_primitive` + curated positive/negative name
  lists; plays/players/periods stay neutral. Result: 49 positive / 16 negative /
  131 neutral. `migration_tags_add_tag_polarity.sql`.
- **Enforcement — REVISED 2026-08-29** (Adam changed the model): polarity IS now
  enforced in RLS for the parent's view of OTHER players. Rule: a parent sees a
  clip in their kid's game if it's **about their kid** (any polarity) OR it's
  **not a lowlight** — so everything about your own kid, plus other players'
  good/neutral plays; other players' pure-bad plays are hidden. Helpers
  `clip_involves_my_kid` + `clip_is_pure_negative`; `migration_clips_read_family_polarity.sql`.
  Verified: kid's 48 clips visible; 13 other-player lowlights hidden; 35 other
  good/neutral visible. ("Lowlight" = negative tag & no positive tag — mixed
  clips stay visible; tighten to "any negative" if wanted.)

### Slice 7 — Parent "Make my kid's highlight" ✅ DONE 2026-08-29
**Entry (Home UI):** the persistent **blue "Make a highlight" bar** on Home
(`select-team.tsx`) — smart-labels off the Players lens ("Make Lars's highlights"
when a kid is filtered, else "Make a highlight"). The **Players** filter moved
inline into the FilterBar row (new `playerSlot` prop on `FilterBar`), renamed
"Players". The **"+" stays upload-only** (untouched). One file → mobile + web.

**Flow (`app/make-highlight.tsx`):** pick kid (auto-skip if one) → pick games
(checklist, default all, select-all) → auto-gather the kid's clips that involve
them AND have a positive tag → render via the shared engine → save to My Work +
optional save-to-device. Honest empty state when a kid has no highlights yet.

**Shared engine:** extracted `lib/core/render-reel.ts` (`renderReel` POST+poll,
`saveHighlightReel`, `deriveStoragePath`) — RN-agnostic, used by the new flow.
Download reuses `lib/native/download-media`. Compiles clean (0 errors).

**Follow-ups:** migrate `app/export.tsx` onto `render-reel.ts` (kill the inline
duplicate); add contextual entry points (kid page, game); optional home hero card.
Needs a TestFlight build + device test.

---

## Data invariants (per CLAUDE.md)
- **Required = DB-required:** `parent_film_visible` has a default → never blocks
  team creation. ✅
- **Creatable → editable:** the coach can flip the toggle anytime. ✅
- **Never fail silently:** OFF *intentionally* removes parent access (that's the
  feature, enforced in RLS) — pair with a clear empty state so a parent isn't
  confused by an empty room. Give the "Make highlight" action a real error if a
  parent lacks clips access.
- **Media speed:** no upload/download path changes (Slices 1–6). Slice 7 reuses
  the existing export pipeline. ✅

## Child-safety notes
- Parents only ever get **their own kid's** content (RLS scoped via
  `parent_player_links`); verify no cross-kid or cross-team leak in Slice 3.
- **Positives-only** for parents (Slice 6/7) — lowlights never surface or export.
- The coach toggle is the coach's control valve; families' own uploads/shares are
  never gated by it.

## Open decisions
- **D1** — toggle default ON vs OFF (recommend ON).
- **D2** — does "my kid's games" also drive the **home feed** and the
  leaving-teams frozen-team card, or just the Film Room to start? (They share the
  same identity spine.)
- **D3** — auto-lineup via DB trigger vs tagger-side write (recommend trigger for
  coverage; confirm in Slice 0 that tag→player_id is clean enough for a trigger).

# Feed vs Film Room, filters, and leaving-a-team — consolidated design

Status: **design, pre-build.** Consolidates the player-identity tag work, the
leave-a-team lifecycle, share durability, and a 102-agent deep-research pass
(2026-07-31). Grounded on live DB + code investigations this session.

## The validated model (matches industry best practice)
Every studied product uses a **two-layer split**: an auto-populated browsable
stream on top, a durable manually-curated collection underneath, with
**editing/creation tools gated to the curated layer**:
- Instagram: Stories auto-archive (private) → **Highlights** are hand-picked.
- Google Photos: everything auto-lands in the library → **Albums** are manual.
- GameChanger / Hudl: stats accrue automatically → **highlight clips** are
  manually selected onto an athlete-owned profile.

Adam's proposed model is exactly this, so we adopt it.

## Recommendation (a) — Feed auto, Film Room is the manual editable set
- **Everything shared to the family auto-appears in the Home feed** — no manual
  save to *view*. Filterable, kept, accessible forever.
- **"Save to Film Room" is the explicit step that unlocks editing** — tagging
  clips + building/exporting reels operate only on Film Room items. Not in Film
  Room = watchable from the feed, but not taggable/exportable.
- This keeps Film Room a small, intentional workspace (no clutter) while nothing
  is ever lost from the feed. Matches the app's already-shipped feed + Film Room
  split and the "creatable → editable" invariant.

## Recommendation (b) — Filter set for the Home feed
**Player · Team · Season/Year · Type (game/reel/clip/video)**, newest-first
default. The app's FilterBar already has Player/Team/Type/Sort/Event-Season-
Tournament — so the set is essentially right; the load-bearing addition is
**Season/Year as a first-class axis** (maps to the existing `seasons` table),
because year is what makes a 5-year archive navigable. Do NOT add folder
hierarchies. Defer free-text/date search + a time scrubber until depth demands.

## Recommendation (c) — Leaving a team: keep access + frozen past-team card
The athlete-identity model (GameChanger/Hudl): **content follows the athlete via
a durable family/player relationship, not active team membership** — "only teams
where you had a family or player relationship appear." That is *exactly* the
app's parent↔kid link, which already survives leaving. So minimal build:

1. **Access spine = the durable parent↔kid player-audience shares** (already
   survive leaving — access rides the kid link, not membership).
2. **Record which games the kid played** via the unused `game_lineups` table, so
   past content is athlete-attributed (this is also what "his games" needs).
3. **Frozen past-team card** — each departed team shows as a snapshot card (name/
   logo, season, roster-as-it-was) that opens **read-only** reels/games. This is
   literally TeamSnap's documented pattern: archive a season read-only, carry
   over roster/schedule/photos, and **access survives roster removal**.
4. **Access stays an entitlement-checked read path** (`sign-media`), **never a
   downloadable public link** — minor-privacy: revocation can't un-distribute
   copies, so we never hand out public links.

## The identity spine (prerequisite, already scoped separately)
None of the "his games follow him" behavior works unless plays attach to the
**kid's `player_id`**, not a team-bound name string. That's the auto-provisioned
linked player tag + `game_lineups` work — build it first; it's the foundation
this archive computes "his games / his teams" from. See
`tag_review_edit_surface_design.md` and the roster/player-tag investigation.

## DECIDED — generous keep, scoped to the kid
**A family keeps every game their kid PLAYED IN** (from `game_lineups`) as a
durable kid-attached grant — even games a coach only posted to the team wall —
**scoped strictly to their own kid** (never the rest of the old team's content;
that's the child-safety boundary). Locked by Adam 2026-07-31.

## Team logos (added — Adam)
Coaches can upload a **team logo**; it renders as the team's circle avatar on the
team rail / wall, and — the fun part — it **persists on the frozen past-team
card** so a family revisiting an old team sees that team's identity intact.
- Schema: `teams.logo_path text` (storage object key, mirrors `players.photo_path`).
- Storage: `Videos` bucket, `team-logos/<team_id>/<ts>.jpg`; coach-only upload;
  read via the existing `sign-media` / photo-view authorizer (private, no public
  URL).
- "Frozen": the logo lives on the team row and teams are never deleted, so it
  persists for free. A true point-in-time snapshot (if a team later rebrands) is
  a later nicety, not v1.

## Other open implementation questions (from research)
- **Snapshot mechanism:** copy/denormalize roster+team at leave-time (true
  frozen) vs reconstruct live (cheaper, but "roster as it was" needs history).
  Cheapest v1: show the team card + the kid's own games/reels read-only; add a
  true roster snapshot later.
- **RLS:** granting the frozen-archive read without a broad/public storage read —
  extend the player-audience/`game_lineups` entitlement in the `authorize_*`
  functions; the highest-care phase (minors' footage).

## Phased build plan (safest/reversible first, RLS on minors' footage last)
Risk key: 🟢 low · 🟠 medium · 🔴 high-care (minors' footage / irreversible).

**Phase 0 — Guard history-destroying deletes. 🟠**
Before anything relies on history surviving, stop the cascades that erase it.
Deleting a game cascades to its videos + `game_lineups`; deleting a player/team
destroys more. Audit `deleteGame`/player/team paths; make destructive deletes
confirm + (where possible) soft-delete. (`migration_history_cascade_restrict.sql`
may already cover some — verify first.) No user-visible feature; pure safety.

**Phase 1 — Identity spine: auto-linked player tags. 🟢 (BUILD FIRST)**
- Migration: partial unique index `tags(team_id, player_id) where
  category='players'`; `AFTER INSERT ON player_teams` trigger →
  `ensure_player_tag()` (SECURITY DEFINER, snapshot first name, on-conflict
  do-nothing); one-row backfill (Conrad @ Centex Attack Bobby).
- Extend `update_kid_profile` to sync the tag name on rename.
- Additive, no RLS change. Makes every rostered kid taggable + linked to their
  `player_id`; also unblocks the stats GP fix. This is the foundation everything
  else computes "his games / his teams" from.

**Phase 2 — Team logos. 🟢 (easy, visible win)**
- Migration: `teams.logo_path text`.
- Coach-only upload to `Videos/team-logos/...`; read via `sign-media`.
- UI: circle avatar on the team rail + wall header (reused later on the frozen
  card). Independent of everything else — good morale/demo win.

**Phase 3 — Feed auto / Film Room gates editing. 🟠 (mostly UX)**
- Confirm the Home feed already surfaces all durable shares (it does via
  `loadContentFeed`) — no manual save to VIEW.
- Make **tag + export require the item be in the Film Room** (a `saved_items`
  save, or own-team content). Shared items you don't own → "Save to Film Room"
  before editing. UX/labelling + a gate check; no schema.

**Phase 4 — Season/Year filter on the Home feed. 🟢**
- Add Season/Year as a first-class FilterBar facet (maps to the `seasons`
  table). The axis that makes a multi-year archive navigable.

**Phase 5 — Populate `game_lineups` (athlete attribution). 🟠**
- Record which kids played each game: snapshot the team roster into
  `game_lineups` when a game is created (editable lineup after). This is the data
  that defines "every game my kid played" (the generous-keep set).
- Backfill old games? Lean NO (start forward-only); revisit.

**Phase 6 — Leave = soft flag + frozen past-team card. 🟠**
- Migration: `player_teams` gains a soft-leave state (`left_at` / status) — a
  `leave_team` RPC that NEVER hard-deletes. Roster = active; past teams =
  inactive.
- UI: active vs past teams; a **frozen past-team card** (logo from Phase 2,
  season, roster-as-it-was) → opens **read-only** reels/games for MY kid only.

**Phase 7 — RLS: durable kid-scoped read for games the kid played. 🔴 (LAST, extra review)**
- The generous grant: a linked parent may read games/videos/reels where their
  kid is in `game_lineups` (or player-tagged), **scoped to their own kid**, even
  after leaving — an additive branch in `games_read` / `videos_read` /
  `authorize_video_playback` / `_reel_playback` + `sign-media`.
- Adds access, removes none. Verify survival on a non-member-but-linked test
  account before/after a simulated leave. Highest care: minors' footage.

Sources: GameChanger athlete profiles, Hudl player profile, TeamSnap archived
seasons, Instagram Highlights/Archive, Google Photos library/albums, iCloud
shared-album privacy. Related: `project_footage_survives_leaving_team`,
`project_share_tags_travel_with_video`.

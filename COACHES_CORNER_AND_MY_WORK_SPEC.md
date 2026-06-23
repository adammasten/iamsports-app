# Coaches' Corner & My Work — Design Spec

**Status:** Design locked, not yet built (except where noted). Author: planning session, captured by investigation of the live codebase.

> Grounding note: every table/column/file reference below was checked against the
> repo. Where the live Supabase DB diverges from the repo's `migration_*.sql`
> files (the project applies SQL in the Supabase editor and reconciles into
> migration files later), that is called out explicitly.

---

## The Core Idea

**Make footage findable.** Today the only way to see tagged clips is to enter
**export mode** (`app/export.tsx` — a 3-step games→tags→review wizard). That makes
export the *only door* to your footage.

The goal: **My Work (`app/my-work.tsx`) becomes where you VIEW and FILTER all your
clips and reels** without entering export. **Export becomes one action you launch
*from* My Work**, not the only way in.

The same filtering tool is reused in **Coaches' Corner** (`app/coaches-corner.tsx`),
a per-team coaches-only board you post reels/clips to.

---

## The Three+ Video Layers (mostly PARKED)

Four kinds of video object exist or are implied today:

| Layer | What it is | Status in code |
|---|---|---|
| **Clips** | Individual tagged moments | Exist: `clips` table, tagged via `clip_tags` |
| **Reels** | Finished videos stitched from clips | Exist: `highlight_reels`, built from `source_clip_ids uuid[]` |
| **Games** | Full game-video upload | Exist: `videos` rows tied to a `games` row |
| **Uploads / scout film** | Untethered raw video (e.g. "Apex vs Legends" film grabbed to scout an opponent) — not tied to our roster/games | Partially: `videos` allows `game_id`/`team_id` NULL (personal uploads), but there is no first-class "scout" concept or name |

### ⛔ PARKED ARCHITECTURAL QUESTION — do not solve now
Should we **formally TYPE video objects at upload time** (let the user choose
clip / reel / game / scout when footage enters the system)? Today "type" is
implicit and inferred (a reel is a `highlight_reels` row; a scout upload is a
`videos` row with NULL `game_id`/`team_id`). **Captured as an open question only —
no decision in this spec.** See *Parked / Open Questions*.

---

## Locked Design

### 1. Reel tagging (the main new build)

- **New `reel_tags` table**, mirroring `clip_tags`.
  - `clip_tags` actual columns ([migration_step1.sql:132](migration_step1.sql#L132)):
    `clip_id uuid`, `tag_id uuid`, `bundle_number int default 0`, `PRIMARY KEY (clip_id, tag_id, bundle_number)`.
  - `reel_tags` should be `reel_id uuid → highlight_reels(id)`, `tag_id uuid → tags(id)`,
    `PRIMARY KEY (reel_id, tag_id)`. **Deliberately drop `bundle_number`** — bundles
    are a clip-authoring concept (clip-level vs grouped tags); a reel is a finished
    artifact with a flat tag set. (Flag during build; mirror `ON DELETE CASCADE`
    and the `idx_..._tag` index pattern from `clip_tags`.)

- **AUTO-ATTACH on reel creation.** When a reel is created, copy the **distinct**
  tags from all its source clips into `reel_tags`.
  - **Exact hook location:** `saveReelRecord()` in [app/export.tsx:111](app/export.tsx#L111).
    It already inserts the `highlight_reels` row at [export.tsx:131](app/export.tsx#L131)
    (called from `handleExport` at [export.tsx:406](app/export.tsx#L406)). After that
    insert succeeds, gather `clip_tags.tag_id` for the included clip ids (the
    function already has `includedClipObjects` with `c.id` in scope), dedupe, and
    bulk-insert into `reel_tags`. **This is the only reel-creation path in the app**
    (confirmed: the only `highlight_reels` inserts are here; the other
    `highlight_reels` touches in `my-work.tsx` are read/update/delete).

- **Reel tags are INDEPENDENT of clip tags after creation.** Auto-attach is a
  one-time **snapshot copy**. Explicitly:
  - Editing a clip's tags later does **NOT** change reels already made.
  - Removing a tag from a reel does **NOT** touch the underlying clips.
  - This independence is the whole reason for a denormalized `reel_tags` table
    rather than always deriving from `source_clip_ids` (see *Key Technical Note*).

- **EDITABLE after creation.** A coach can:
  - **Add** a tag → insert a `reel_tags` row.
  - **Remove** a tag → delete a `reel_tags` row.
  - **Rename** the reel → update `highlight_reels.name` (already implemented in
    `my-work.tsx` inline rename at [my-work.tsx:234](app/my-work.tsx#L234); RLS
    creator-update branch already allows it).

- **Scout film case.** A reel/upload with **no source clips** is created with
  **zero** `reel_tags`, and is tagged **manually** via the same add-tags UI. This
  is how untethered scout film becomes filterable.

### 2. Clip tag editing

- Also allow editing a **clip's** tags after the fact (add/remove on `clip_tags`).
- This is **separate** from reel editing — clips and reels each own their tag set.
- Today clip tags are only authored during initial tagging (`app/tagging.tsx` /
  `app/tagging-overlay.tsx`), inserted as a batch on save. Post-hoc add/remove is
  net-new UI but reuses the same `clip_tags` contract (preserve `bundle_number`
  semantics — default `0` for clip-level adds).

### 3. Filtering (one reusable tool)

- **A single filter/search component**, pointed at **clips** in some contexts and
  **reels** in others. **Same facets everywhere.**
- **Used in:** My Work (filter my clips AND my reels) and Coaches' Corner (filter
  what's been posted there).
- **Facets** (each verified against schema — FREE = data already exists, NEW =
  needs plumbing):

  | Facet | Source | FREE / NEW |
  |---|---|---|
  | Tags / categories (`offense`/`defense`/`plays`/`players`/`special`) | `tags.category` (text + CHECK) via `clip_tags` | **FREE for clips**; **NEW for reels** (needs `reel_tags`) |
  | Player | **Only** via `players`-category tags — there is **no structural `clip→player` FK** (`clips`/`clip_tags` have no `player_id`) | **FREE but limited** — tag-based only, decoupled from the `players`/`player_teams` roster |
  | Opponent | `games.opponent` | **FREE-ish** — ⚠️ column is **live-DB-only, not in any repo migration** (app reads/writes it at [(tabs)/index.tsx:85](app/(tabs)/index.tsx#L85)) |
  | Date | `games.game_date` | **FREE-ish** — ⚠️ same live-DB-only caveat as opponent |
  | Season | `season_id` on `games`/`videos`/`players`/`highlight_reels` (`migration_seasons.sql`) | **FREE** |
  | ★ Highlight (`is_starred`) | `clips.is_starred boolean` | **FREE for clips**; NEW to surface at reel level |
  | POE (`is_point_of_emphasis`) | `clips.is_point_of_emphasis boolean` | **FREE for clips**; NEW at reel level |
  | Visibility | `clips.visibility` / `videos.visibility` (`content_visibility`: `coaches_only`/`team`/`public_link`/`private_to_creator`) | **FREE** |
  | Duration | `clips` `end_time - start_time`; `highlight_reels.duration_seconds` | **FREE** |
  | Created date | `created_at` on every table | **FREE** |

### 🔑 Key Technical Note — tags live ONLY at the clip level today

`clip_tags` links clips→tags. **`highlight_reels` has no tag data** — only a
`source_clip_ids uuid[]` ([migration_walls_reels_sharing.sql:31](migration_walls_reels_sharing.sql#L31)).
Two ways to get reel-level tag filtering:

- **(A) Derive at query time:** unnest `source_clip_ids` → join `clip_tags` → `tags`.
  - Breaks for **scout film** (no source clips → no tags).
  - Breaks for **deleted clips**: `source_clip_ids` is a plain `uuid[]` with **no
    foreign key**, so ids can dangle after clips are deleted.
  - Couples reel facets to current clip state (contradicts the locked
    "independent after creation" rule).
- **(B) `reel_tags` denormalization** (auto-attach on create + manual edits).

**RECOMMENDATION: choose (B), `reel_tags`.** It's the only option that (1) supports
manually-tagged scout film, (2) survives source-clip deletion, and (3) honors the
locked rule that a reel's tags are independent of its clips after creation. (A) is
rejected as the primary mechanism for all three reasons.

### 4. Coaches' Corner

- A **post-to destination**, **per-team**, **coaches-only**.
  - Audience value **`'coaches'` already exists** in the `share_audience` enum
    ([migration_walls_reels_sharing.sql:20](migration_walls_reels_sharing.sql#L20): `('public','team','player','coaches')`).
  - The **read RLS already understands it**: `shares_read` allows
    `audience='coaches' AND is_team_coach(team_id)`
    ([migration_rls_lockdown_15_shares.sql:32](migration_rls_lockdown_15_shares.sql#L32)).
  - The **nav tab + stub screen already exist and are committed**:
    `app/coaches-corner.tsx` (placeholder), reached from the clipboard icon in the
    `select-team.tsx` bottom nav, registered in `app/_layout.tsx`.
- **Postable units: both REELS and CLIPS.** `share_content` enum already has
  `('reel','video','clip')` — both are first-class postable content types.
- **Each post can carry a NOTE** (1–2 line coach comment, e.g. "work with Max on
  his handle").
  - v1: note authored by the **posting coach, author-edits-only**.
  - Comment threads are a **LATER feature, not v1.**
- **Filtering** works on the Corner feed the same way as in My Work (same component).

---

## What Exists vs. Net-New (grounded in real code)

### Already exists (reuse, don't rebuild)
- **`highlight_reels` table** + creator-scoped RLS (read/insert/update/delete on
  `created_by_user_id = auth.uid()`), `team_id` nullable
  ([migration_walls_reels_sharing.sql](migration_walls_reels_sharing.sql),
  [migration_reels_nullable_creator.sql](migration_reels_nullable_creator.sql)).
- **Reel creation path:** `saveReelRecord` → `highlight_reels` insert
  ([export.tsx:111](app/export.tsx#L111)). The single auto-attach hook point.
- **My Work screen** (`app/my-work.tsx`): lists my reels, where-it-lives badges
  from `shares`, inline rename, delete, play via `/shared-viewer`, search + sort.
- **`clips` + `clip_tags` + `tags`** with the full tag taxonomy
  (`category ∈ offense|defense|plays|players|special`,
  [migration_step1.sql](migration_step1.sql) + [migration_special_tags.sql](migration_special_tags.sql)).
- **`shares` table** + `post_to_wall` RPC + audience-aware `shares_read` RLS,
  including the `'coaches'` audience read path.
- **Coaches' Corner nav + stub screen** (committed).
- **`/shared-viewer`** playback (signed-URL minting from a storage path) — reused
  by both clips and reels.
- **Filter facet data:** `is_starred`, `is_point_of_emphasis`, `visibility`,
  `season_id`, durations, `created_at` — all already stored.

### Net-new (must build)
- **`reel_tags` table** (`reel_id`, `tag_id`, PK both) + RLS mirroring
  `clip_tags`/reel ownership.
- **Auto-attach logic** in `saveReelRecord` (copy distinct source-clip tags → `reel_tags`).
- **Reel tag editing UI** (add/remove `reel_tags`) — net-new, plus **manual tagging
  for scout film** (zero-source-clip reels/uploads).
- **Post-hoc clip tag editing UI** (add/remove `clip_tags` outside the initial
  tagging flow).
- **Reusable filter/search component** parameterized over clips vs reels.
- **Reel-level facet plumbing** (surfacing `is_starred`/POE-equivalents and tag
  filters at reel granularity — `reel_tags` is the foundation).
- **Coaches' Corner posting flow** — and note the **two gaps below**.
- **Post note**: `shares` has **no `note` column today**
  ([migration_walls_reels_sharing.sql:47](migration_walls_reels_sharing.sql#L47) —
  columns are `id, content_type, content_id, team_id, season_id, audience,
  target_player_id, shared_by_user_id, hidden_by_family, visible, created_at`).
  Net-new: add `shares.note text` (or a side table). Author-edits-only ⇒ gate
  update on `shared_by_user_id = auth.uid()` (already the `shares_update` branch).

### ⚠️ Two posting-gate gaps for Coaches' Corner (write side is NOT wired)
The **read** side of `'coaches'` is wired; the **write/post** side is not:
1. **`post_to_wall` cannot create a `'coaches'` post for a non-parent coach.** Its
   non-`'player'` branch gates on **super-admin OR linked-parent-of-target-player**
   ([migration_post_to_wall_widen_player.sql](migration_post_to_wall_widen_player.sql)),
   not on `is_team_coach`. A coach who isn't the player's parent is rejected.
   → Net-new: widen `post_to_wall` for `audience='coaches'` to gate on
   `is_team_coach(p_team_id)`, **or** add a dedicated coaches-post RPC.
2. **`'coaches'` posts need a `team_id`, but `post_to_wall` only requires/validates
   `team_id` for `audience='team'`.** A coaches board is inherently team-scoped.
   → Net-new: require + validate `team_id` for `'coaches'`.
   - Also note: a coaches-only board is **team-scoped, not player-scoped**, yet
     `shares` and `post_to_wall` are built around `target_player_id`. Decide
     whether coaches posts carry a `target_player_id` at all (the table's UNIQUE
     constraint includes it). This is a design seam, not a mechanical change.

---

## Build Order (slices) — smallest/safest first, reuse existing patterns

> Adjusted from the planning-session order based on what's actually in the code.
> Each slice is independently shippable.

1. **`reel_tags` table + auto-attach on reel creation.**
   - Migration: create `reel_tags` (mirror `clip_tags` minus `bundle_number`) + RLS.
   - Hook auto-attach into `saveReelRecord` ([export.tsx:111](app/export.tsx#L111)).
   - Foundation for everything reel-filterable. No UI yet. Backfill for existing
     reels is optional (derive once from `source_clip_ids`).

2. **View + filter CLIPS in My Work** *(easiest — no new plumbing)*.
   - Clip tags already exist; build the reusable filter component pointed at clips
     first. Proves the facet model with FREE data.

3. **Reel filter UI in My Work** *(depends on slice 1)*.
   - Point the same filter component at reels via `reel_tags`.

4. **Edit reel tags + rename + edit clip tags.**
   - Rename already exists. Add/remove `reel_tags`; add/remove `clip_tags`
     post-hoc; manual tagging entry point for scout film (zero-tag reels).

5. **Coaches' Corner posting (reels + clips) with note.**
   - Resolve the **two posting-gate gaps** (widen/replace `post_to_wall` for
     `'coaches'`; add `shares.note`). Post reels and clips to a team's board.

6. **Coaches' Corner filtering.**
   - Reuse the slice-2/3 filter component on the Corner feed.

---

## Parked / Open Questions

1. **⛔ Formally typing video objects at upload time?** Should footage be tagged
   clip/reel/game/scout when it enters the system, instead of type being implicit?
   Affects schema (a `videos.kind`? a unified `media` table?) and every browse
   surface. **No decision — captured only.**

2. **Scout film identity.** Untethered scout uploads ("Apex vs Legends") have no
   clean name, no roster link, no `games` row. How are they named, where do they
   live (`videos` with NULL `game_id`/`team_id`?), and how does a coach create one
   to then manually tag? Naming/UX undecided.

3. **Player as a structural facet.** Player filtering is currently **only** via
   `players`-category tags, which are **decoupled** from the `players`/`player_teams`
   roster (a "Player" tag is a free-text `tags` row, not FK'd to `players.id`).
   Do we want a real `clip→player` link eventually? Out of scope for v1.

4. **Opponent/date as repo-tracked schema.** `games.opponent` and `games.game_date`
   exist in the live DB but **not in any repo migration**. Before building filters
   on them, reconcile the schema into a migration file so the facet is durable.

5. **Coaches' Corner target model.** Is a coaches post team-scoped only, or does it
   still carry a `target_player_id` (per the `shares` UNIQUE constraint)? Decide
   before slice 5.

6. **Comment threads on Corner posts.** Explicitly LATER (v1 is author-only note).

7. **`reel_tags` for existing reels.** Backfill strategy (derive once from
   `source_clip_ids`) vs leave historical reels untagged. Minor; decide at slice 1.

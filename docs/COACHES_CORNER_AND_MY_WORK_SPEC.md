# Coaches' Corner & My Work — Design Spec

**Status:** Design locked in a planning session. Not yet built (except the Coaches' Corner nav tab + stub screen, which are committed). Grounded against the live IamSports codebase.

---

## The Core Idea

Make footage **findable**. Today the only way to see tagged clips is to enter export mode — clips are trapped behind the "build a reel" flow. We want **My Work ("my stuff")** to become the place where you VIEW and FILTER all your clips and reels *without* going into export. Export becomes one action you can launch from My Work, not the only door to your own footage.

The same filtering capability also powers **Coaches' Corner**, a per-team, coaches-only board you post reels and clips to.

One filter tool, pointed at different content in different places.

---

## The Video Layers (mostly PARKED — see Open Questions)

The system has several distinct "video" things:

- **Clips** — individual tagged moments. Already exist, already tagged via `clip_tags`.
- **Reels** — finished videos stitched from clips. Stored in `highlight_reels`, built from `source_clip_ids`.
- **Games** — a full game-video upload.
- **Uploads / scout film** — untethered raw video (e.g. "Apex vs Legends" film grabbed to scout an opponent). Not tied to our roster or our games. No clean name yet.

**PARKED ARCHITECTURAL QUESTION (do NOT solve now):** Should we formally *type* video objects at upload time (choose clip / reel / game / scout)? Captured as an open question only — it does not block the filtering work below.

---

## Locked Design

### 1. My Work becomes a view-and-filter workspace
- My Work shows BOTH your clips and your reels.
- Both are filterable by the same facets (see Filtering).
- Clips become viewable on their own — no need to enter export mode just to see what you've tagged.
- Export becomes an action launched from My Work, not the sole path to footage.

### 2. Reel tagging (the main new build)
- **New `reel_tags` table**, mirroring `clip_tags`. Confirmed `clip_tags` shape: `(clip_id, tag_id, bundle_number)`. Reels won't need `bundle_number`, so `reel_tags` is `(reel_id, tag_id)`.
- **Auto-attach:** when a reel is created, copy the distinct tags from all its source clips onto the reel (into `reel_tags`). The hook goes in `saveReelRecord` (app/export.tsx:111; the `highlight_reels` insert is at export.tsx:131).
- **Reel tags are INDEPENDENT of clip tags after creation.** Editing a clip's tags later does NOT change reels already made. Removing a tag from a reel does NOT touch the clips it came from. The reel's tags become their own thing the moment it's created.
- **Editable after creation:** a coach can ADD and REMOVE tags on a reel, and RENAME the reel. (Add = insert `reel_tags` row; remove = delete row; rename = update `highlight_reels.name` — a rename path already exists at my-work.tsx:234.)
- **Scout film case:** a reel/upload with no source clips arrives with ZERO tags and is tagged MANUALLY via the same add-tags UI. This is how untethered scout film becomes filterable.

### 3. Clip tag editing
- Allow editing a clip's tags after the fact (add/remove on `clip_tags`).
- This is SEPARATE from reel editing and does not ripple into already-made reels.

### 4. Filtering (one reusable tool)
- A single filter/search component, pointed at clips in some contexts and reels in others. Same facets everywhere.
- Used in My Work (filter my clips AND my reels) and Coaches' Corner (filter what's been posted there).
- UI direction (from mockups): collapsible dropdown with checkbox facets, Apply-to-commit, active-filter chips shown after collapse. Multi-select within a facet (OR), stack across facets (AND).

### 5. Coaches' Corner
- A POST-TO destination, per-team, coaches-only. `audience='coaches'` is already in the `share_audience` enum. `share_content` already includes `'reel'`, `'clip'`, `'video'`. The nav tab + stub screen already exist (app/coaches-corner.tsx, committed).
- You post REELS and/or CLIPS to a team's Coaches' Corner. Both are postable units.
- Each post can carry a NOTE (1–2 line coach comment, e.g. "work with Max on his handle"). For v1 the note is authored by the posting coach, author-edits-only. Comment threads are a LATER feature, not v1.
- Filtering works on the Corner feed the same way it does in My Work.

---

## What Exists vs. Net-New

### Already exists (reuse)
- `clips` + `clip_tags` — clips are already tagged. **Filtering clips in My Work needs no new tag plumbing.**
- `tags` taxonomy — one table, category is a string with a CHECK constraint. 5 categories: `offense`, `defense`, `plays`, `players`, `special` (★ Highlight, POE). Category labels/colors are a hardcoded `CATEGORIES` constant in TS (tagging.tsx:295, tags.tsx:10, export.tsx:483).
- `highlight_reels` — reels table. Rename path exists (my-work.tsx:234). Reel creation at `saveReelRecord` (export.tsx:111).
- `share_audience` enum already has `'coaches'`; `share_content` already has `'clip'`/`'video'`/`'reel'`.
- `games.opponent` and `games.game_date` — exist in the LIVE DB and the app already filters/sorts on them.
- Coaches' Corner nav tab + stub screen — committed.

### Net-new (build)
- `reel_tags` table (+ RLS).
- Auto-attach logic in `saveReelRecord` (copy distinct clip tags → `reel_tags`).
- Reel tag add/remove UI; reel rename is mostly there.
- Clip tag add/remove-after-the-fact UI.
- The shared filter/search component.
- Clip viewing/filtering surfaced in My Work (outside export).
- A `note` field for Coaches' Corner posts — **`shares` has NO note column today**, so this is net-new (add column or related table).
- Coaches' Corner posting flow (post reel/clip with note) + the `audience='coaches'` posting gate (same `is_team_coach` shape as the inbox widen already shipped).
- Coaches' Corner feed + filter.

### Filter facets — FREE vs. needs plumbing
**Free (data already exists):**
- Tags / categories on CLIPS (`clip_tags` → `tags.category`).
- Opponent (`games.opponent`), date (`games.game_date`), season (`season_id` threads through games/videos/players/reels).
- `is_starred` (★), `is_point_of_emphasis` (POE), `visibility`, duration (`end_time − start_time`), `created_at` — all on `clips`.
- Reel-level: `status`, `overlay_mode`, `duration_seconds`, `team_id`, `season_id`, `created_at`, shared-vs-not (`public_share_token`).

**Needs new plumbing:**
- **Reel-level tag filtering** — tags live ONLY at the clip level today. To filter reels by tag you must either derive (unnest `source_clip_ids` → `clip_tags` → `tags` at query time) OR denormalize via `reel_tags`. **Chosen approach: `reel_tags` + auto-attach.** Why: derivation breaks for scout film (no source clips) and for reels whose source clips were deleted (`source_clip_ids` is a plain `uuid[]` with no FK, so deleted clips leave dangling ids). `reel_tags` is fast to query, survives clip deletion, and is the only path that works for scout film.
- **Scout-film tags** — no clips to inherit from, so must be added manually (same add-tags UI).

### Known data caveats
- **Player filtering is tag-based, not structural.** `clips`/`clip_tags` have no `player_id`. The only clip↔player path is a `players`-category tag. Those player tags are NOT FK'd to the `players` roster — a player tag is just a string-named `tags` row. `game_lineups` links games↔players but not clips↔players.
- **Repo migrations are behind the live DB.** `games.opponent` and `games.game_date` exist in Supabase but are in NO migration file. Works today; worth a reconciliation migration eventually so the schema-of-record matches reality.

---

## Build Order (slices — smallest/safest first)

Each slice ships and is tested before the next. Reuse existing patterns throughout.

1. **`reel_tags` table + auto-attach on reel creation.** New table + RLS; hook the copy-up into `saveReelRecord`. After this, every newly created reel carries its clips' tags automatically.
2. **View + filter CLIPS in My Work.** Easiest real value — clips are already tagged, so this is mostly display + filter, no new tag plumbing. Surfaces footage currently locked behind export.
3. **Reel filter UI in My Work.** The shared filter component, pointed at reels (now tagged via slice 1).
4. **Edit reel tags + rename; edit clip tags.** Add/remove UIs. This also enables manual tagging of scout film.
5. **Coaches' Corner posting (reels + clips) with note.** Add the `note` storage, the posting flow, and the `audience='coaches'` gate (`is_team_coach`).
6. **Coaches' Corner filtering.** Reuse the shared filter component on the Corner feed.

> Adjust ordering based on what a read-only investigation of each surface turns up before building it.

---

## Parked / Open Questions

- **Video-type taxonomy:** do we formally type video objects at upload (clip / reel / game / scout)? Parked.
- **Scout film as a first-class object:** leaning "it's just a reel with no source clips, tagged manually" — but confirm before building the scout path.
- **Comment threads** on Coaches' Corner posts (multiple coaches replying). v1 is a single author note only; threads are a later, deliberate build.
- **Player filtering done right:** today it's tag-based and decoupled from the roster. A future improvement could FK clips↔roster players, but that's its own project.
- **Schema reconciliation:** add a migration capturing `games.opponent` / `games.game_date` so the repo matches the live DB.
- **Auto-attach noise:** a 10-clip reel could inherit many tags. Starting position: copy ALL distinct tags (completeness over tidiness); revisit if filters feel noisy.

---

## Key IDs / locations (reference)
- Reel creation hook: `app/export.tsx` → `saveReelRecord` (line 111; insert line 131).
- Reel rename exists: `app/my-work.tsx:234`.
- `clip_tags`: `(clip_id, tag_id, bundle_number)` — migration_step1.sql:132.
- `highlight_reels`: migration_walls_reels_sharing.sql:31.
- `shares` (no note column): migration_walls_reels_sharing.sql:47.
- Enums: `share_audience ('public','team','player','coaches')`, `share_content ('reel','video','clip')` — migration_walls_reels_sharing.sql.
- Coaches' Corner stub: `app/coaches-corner.tsx` (committed).

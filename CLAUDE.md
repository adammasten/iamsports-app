# CLAUDE.md

Guidance for Claude Code when working in this repo.

> **Accuracy rule for this file:** every factual claim here was verified against
> the live Supabase database (via the Supabase MCP) or the current code. If you
> add a claim, verify it the same way — or mark it unverified. This file became
> dangerous once because claims accreted that nobody re-checked; don't restart
> that. Use the Supabase MCP (`.mcp.json` wires it up) to check live schema/RLS
> before asserting anything about the database.

## Overview

**IamSports** (slug `iamsports`, bundle `com.masten32.iamsports`) — Expo / React
Native + Supabase app for youth-sports coaches and parents to tag game film, cut
clips, build highlight reels, and share them to team/kid walls. Repo dir is
`hoops-app`; product is "IamSports". A separate Railway-hosted ffmpeg service
(`https://web-production-1bf7f.up.railway.app`) renders the reels.

## MCP servers available

This project wires up MCP servers in `.mcp.json` (project-scoped, git-tracked).
**Reach for these instead of asking Adam to do things by hand** — a past session
forgot the Supabase MCP existed and wasted his time. If a server's tools aren't
showing, it needs a reconnect/approval: `/mcp reconnect all`, approve the project
trust prompt, or reload the VS Code window (stdio servers need a one-time approval).

| Server | Transport | What it's for |
|---|---|---|
| **supabase** | HTTP (`mcp.supabase.com`, project `wscfpkaltajnrhiusoze`) | Live DB — read-only SQL (`execute_sql`), list/apply migrations, advisors, storage. **Verify schema/data against the live DB here before writing SQL or diagnosing "missing data."** Needs interactive OAuth. |
| **context7** | stdio (`npx -y @upstash/context7-mcp`) | Live, version-accurate library docs (Expo, RN, Supabase, RevenueCat…). **Use instead of possibly-stale training data** for API/library specifics. Optional API key for higher rate limits. |
| **playwright** | stdio (`npx @playwright/mcp@latest`) | Real-browser automation to drive/test the **web app** (iamsports.com): sign-up, cold-start, click-throughs, screenshots. First run may need `npx playwright install chromium`. |

**GitHub is NOT an MCP** — GitHub access is the `gh` CLI + git over SSH, not a
configured server. Keep this table in sync whenever an MCP is added or removed.

## Commands

```bash
npm run start    # or: npx expo start — Metro dev server
```
```bash
npm run ios      # expo start --ios
```
```bash
npm run android  # expo start --android
```
```bash
npm run web      # expo start --web
```
```bash
npm run lint     # expo lint (eslint-config-expo, flat config)
```

No test runner is configured. Builds are driven by EAS (`eas.json`:
`development` / `preview` / `production`). Path alias `@/*` maps to the repo root
(`@/supabase`, `@/context`, `@/components/...`). TypeScript is `strict` and Expo
Router `typedRoutes` is on, so route params are typed.

## High-level architecture

### Auth & navigation

`app/_layout.tsx` is the root: on mount it calls `supabase.auth.getSession()` and
routes to `/login` (no session) or `/select-team`. An `onAuthStateChange`
subscription mirrors that. A Terms/EULA gate and a name-capture gate can block
ahead of the app (see Security model). Screens mount under one `Stack`, with the
tab navigator at `(tabs)`.

- `/login` — email/password against Supabase Auth.
- `/select-team` (`app/select-team.tsx`) — the app home. Shows a **kid rail**
  (the user's linked players) + a **team rail** (their confirmed team
  memberships) + a **content feed** (`loadContentFeed` in `lib/core/homeFeed.ts`
  — newest videos + reels across all the user's teams/kids, with a Player /
  Team / Type / Sort / Event/Season/Tournament FilterBar). There is **no
  "pick a profile" step**.

`useTeamContext()` (`context.tsx`) exposes
`{ userId, userTeams, userKids, activeTeam, activeRole, sessionResolved,
membershipsLoaded, kidsLoaded, setActiveTeam, refreshTeams, refreshKids }`.
`activeTeam` is derived from `activeTeamId: string | null` (**null = no team
selected**; there is no `'all'` sentinel — `'all'` only appears as FilterBar
dropdown option values). `userTeams` = confirmed `team_memberships`;
`userKids` = `parent_player_links` (guardian → player).

Tabs (`app/(tabs)/_layout.tsx`) register **`index`** (a single team's wall,
`loadTeamWall`) and **`tags`** (tag management).

### Data model (Supabase Postgres — verified column names)

- **`user_profiles`** — one row per auth user: `user_id` (PK), `display_name`,
  `accepted_terms_at` / `accepted_terms_version` (Terms gate), `deactivated_at`.
- **`players`** — the kids: `id`, `team_id?`, `name`, `jersey_number?`,
  `user_id?`, `season_id?`, `grad_class?`, `photo_path?`, `player_lineage_id?`.
- **`parent_player_links`** — guardian ↔ player: `parent_user_id`, `player_id`,
  `relationship?`.
- **`teams`** — `id`, `name`, `sport` (both NOT NULL), `created_by_user_id`,
  `grad_class?`. Membership is via `team_memberships`.
- **`team_memberships`** — `team_id`, `user_id`, `role` (`membership_role`:
  admin/head_coach/coach/parent/player/follower), `status` (`membership_status`:
  pending/confirmed, default confirmed), `season_id?`. UNIQUE `(team_id, user_id,
  role)` — a user can hold several roles on one team.
- **`player_teams`** — player ↔ team link (read-scoped by membership/parent).
- **`games`** — an **event container**. NOT NULL: `team_id`, `title`. Nullable:
  `game_date`, `opponent`, `season_id`, `tournament_id`, `team_score`,
  `opponent_score`. **There is no `event_type` on `games`** — the kind
  (game/practice/scrimmage/…) lives on its videos.
- **`videos`** — `id`, `game_id?` (null = **loose footage**), `team_id?`,
  `uploaded_by_user_id`, `url` (**storage object KEY, not a URL**), `label`,
  `sort_order`, `visibility` (`content_visibility`: team / coaches_only /
  public_link / private_to_creator), `player_id?`, `event_type` (text:
  game/practice/scrimmage/tournament/skills), `event_date?`, `sport?`,
  `season_id?`, `tagging_complete`.
- **`clips`** — `id`, `video_id`, `team_id?`, `created_by_user_id?`,
  `start_time`, `end_time` (numeric), `is_starred`, `is_point_of_emphasis`,
  `note`, `visibility`.
- **`tags`** — `id`, `team_id?`, `name`, `category` (text:
  offense/defense/plays/players — hardcoded in the tagging + `edit-reel.tsx`
  CATEGORIES arrays), `sort_order`, `scope`. Per live `tags_read` RLS, tags are
  **global or team-scoped** (`scope='global'` OR team member); there is **no
  `profile_id` column and no player scope**.
- **`clip_tags`** — join `{ clip_id, tag_id, bundle_number }`. See Bundles.
- **`highlight_reels`** — `id`, `team_id?`, `season_id?`, `created_by_user_id?`,
  `name`, `storage_path?` (object key), `source_clip_ids[]`, `duration_seconds?`,
  `overlay_mode`, `status`, `public_share_token?` (dead — retire-Public; zero app
  refs).
- **`shares`** — the single sharing chokepoint (see Security model):
  `content_type` (`share_content`: reel/video/clip/**game** — `'game'` added via
  `migration_share_content_add_game.sql`), `content_id`, `team_id?`, `season_id?`
  (a team can play multiple seasons — shares are season-scoped; see per-season
  rosters note below), `audience` (`share_audience`: team/coaches/player — **no
  public**, retired), `target_player_id?`, `shared_by_user_id`, `visible`,
  `hidden_by_family`, `note` (per-destination caption, set via `set_share_note`;
  the text that renders **below the card** — distinct from `share_comments`, the
  coaches-only thread), `on_wall` (guardian posted it to the kid's wall).
- **`seasons`**, **`tournaments`**, **`game_lineups`**, **`saved_items`** ("My
  Film" bookmarks), **`content_reports`** / **`user_blocks`** (moderation),
  **`super_admins`**, **`team_member_permissions`** /
  **`team_permission_defaults`** / **`team_player_permissions`** (permission
  system), **`video_tagging_rights`**, **`admin_audit_log`**, **`followers`**
  (see "Don't relitigate").

### Security & RLS model

**RLS is real and granular on every table** — not a placeholder (see the
correction in "Don't relitigate"). Policies lean on SECURITY DEFINER helpers:
`is_super_admin()`, `is_team_member(team_id)` (confirmed membership),
`is_team_coach(team_id)` (confirmed admin/head_coach/coach),
`is_linked_parent(player_id)` (via `parent_player_links`). A richer
`has_team_permission(team_id, team_permission)` exists (per-person override →
team default → code default) but is **not yet referenced by any RLS policy**.

- **Sharing = the `shares` table.** `shares_read` grants: own rows, `team` to
  team members, `coaches` to team coaches, `player` to a linked parent of
  `target_player_id`. **No public branch — "Public" is retired.**
- **A kid's wall = player-audience shares** posted by a guardian
  (`shared_by_user_id = a guardian`, `audience='player'`). Content merely shared
  *to* a kid sits in the inbox until a guardian posts it to the wall
  (approval). The guardian's own posts go straight on — they control the account.
- **Storage: the `Videos` bucket is PRIVATE.** `storage.objects` has three
  policies (all `authenticated`, bucket-scoped): INSERT, UPDATE, and an
  **owner-scoped SELECT** (`bucket_id='Videos' AND owner = auth.uid()`). Clients
  never read storage directly for playback/export: **`sign-media` (Edge
  Function, service role) is the ONLY client path to a media URL** — it
  entitlement-checks (`authorize_video_playback` / `_reel_playback` /
  `_photo_view`) then signs. `getSignedVideoUrl` → `sign-media`. There is **no
  `getPublicUrl` anywhere**. The **Railway** ffmpeg server reaches the bucket
  with the **service-role key** (bypasses RLS).
- **Moderation is live:** report content + block user (`content_reports` /
  `user_blocks`, filtered in `lib/core/moderation.ts`).
- **Terms/EULA gate is live** (`user_profiles.accepted_terms_at/version`).
  **Account deactivate/delete** backend is live (`deactivated_at` +
  `supabase/functions/delete-account`).

### Tagging & bundles

The live tagging screen is **`app/tagging-overlay.tsx`** (full-screen landscape
overlay). (The old `app/tagging.tsx` orphan has since been deleted.)

`clip_tags.bundle_number` is the heart of the model:
- `0` → **clip-level** tag (whole play).
- `1, 2, 3, …` → tags grouped into a **bundle** ("Player A + Assist" vs "Player
  B + Made Shot").

`app/export.tsx`'s `clipMatchesGroup`: a group of N tags matches a clip iff all N
are in the clip-level set, OR all N are in `clip-level ∪ some single bundle`.
Tags across two bundles do NOT combine. Preserve this if you touch tag
save/filter — it's how "Player A made a shot" avoids matching "A defended, B
scored." All rows for a clip are inserted in one batch on save.

#### Per-sport possession + structured clips — INVARIANT (don't drift)

**Every new sport must consciously address (a) how a coach marks OUR-team
possession (offense vs defense) and (b) how any structured play data is READ back
downstream (export/breakdown) — or explicitly decide it needs neither.** Adding a
sport's tags without this is the drift to avoid: it leaves "our defense" vs "the
opponent's defense we tagged while on offense" indistinguishable at export, and it
buries captured data nothing reads.

**Current state (audited 2026-09-04 — this IS the drift, not the target):**
- **Football only** (`Football` / `7-on-7` / `Flag Football`, `isFootballSport`)
  has a real model: a sticky **ODK toggle** (offense/defense/kicking) that stamps
  `clip_football.odk` (+ down/distance, `off_formation`, `def_front`, `play_type`,
  `result`, `drive_id`). It is **WEB-ONLY** (`tagging-overlay.web.tsx`); the native
  tagger has no football mode (port planned). Football vocab is shared in
  `lib/core/football.ts` so web + the native port never diverge.
- **Every other sport** (Basketball, Soccer, Lacrosse, Baseball, Softball,
  Volleyball) has **NO possession stamp** — their offense/defense are only tag
  *categories* (groupings of `clip_tags` chips), plus `clips.period`. There is no
  `clip_<sport>` table for them (only `clip_football` exists).
- **`clip_football` is write-only:** nothing downstream reads it — `export.tsx` is
  football-blind (filters `clip_tags` groups only), and there's no stats/breakdown
  view. So football's rich structured tagging currently can't be exported at all.

**Two open builds this implies:** (1) a football-aware export/filter that reads
`clip_football` (filter by ODK + play type + formation + result) — this is what
makes football tagging usable, arguably higher-value than the native port; (2) a
possession indicator for the non-football sports if their offense/defense needs to
be disambiguated the way football's is. Don't add another sport without deciding
where it lands on this.

### Media pipeline (upload / download) — SPEED MATTERS (see rule below)

`lib/native/video-upload.ts` is the shared upload module
(`uploadVideoToBucket` → `uploadVideoWeb` / `uploadVideoMobile` + `patchChunk`),
called by `app/upload.tsx` and `app/game.tsx` (add-to-existing-game).

- **Web** uses `tus-js-client` with a Blob (`chunkSize` 6 MB).
- **Mobile** uses a hand-rolled chunked PATCH loop against the TUS resumable
  endpoint, `CHUNK_SIZE` 15 MB, reading each chunk via
  `readAsStringAsync({ encoding: Base64, position, length })` then decoding to
  bytes in JS. Chunks upload **sequentially** (one in flight; decode doesn't
  overlap the network) — a known speed cost, not yet optimized.
- Tokens refresh mid-upload via `getFreshToken(forceRefresh)` (< 5 min left, or
  every retry). Never cache a token across an upload.
- After upload, the caller inserts the **object key** (`fileName`) into
  `videos.url` (not a URL). Playback later signs via `sign-media`.
- **`app/upload.tsx` creates a `games` (event) row whenever a team is
  selected** (title falls back to `"Game · Jul 28"` / `"Practice · …"` when no
  opponent). Teamless uploads stay loose (see "Events require a team").

### Highlight export

`app/export.tsx` is a 3-step wizard (games → tag groups → review). It `POST`s
`{ url, start_time, end_time }` clips (url = bare object key) to Railway
`/export`, polls `/job/{id}`, then downloads the result via
`FileSystem.downloadAsync` to the camera roll. Clip selection is the
bundle-aware `clipMatchesGroup`.

## Supabase client

`supabase.js` (JS) hardcodes the project URL + anon key (no `.env`). Auth
persists via `AsyncStorage` (native) / default web storage. Import the
singleton: `import { supabase } from '@/supabase'`. Don't create a second client.

## Data invariants — apply to EVERY create/edit/attach/delete flow

Before building any create/edit flow, state which of these it satisfies and
which it doesn't. If one genuinely can't be met (e.g. a NOT NULL forbids it), say
why — don't ship the gap quietly.

1. **Only DB-required fields are required.** A nullable column must never block
   creation. Never gate creating one thing on an *optional* field of another.
2. **Anything creatable is editable afterward** — every field, not just the
   create-form ones.
3. **Anything attachable is re-attachable** — attach / detach / move must all
   exist if X can be created attached to Y.
4. **Anything creatable is deletable by its owner.**
5. **Never fail silently.** If an action doesn't do what the UI implies, say so
   at that moment. A swallowed error or silently-skipped step is a bug, always.
6. **Delete means gone everywhere — or ask.** Deleting a thing must remove it
   from EVERY surface it appears on, not just the card in front of the user. A
   game is the worst offender: it's linked 1:1 to a schedule `events` row
   (`games.event_id`), yet `delete_game` today soft-deletes only the game + its
   videos and leaves the calendar/schedule event behind. The rule: a game delete
   either cascades to everything associated (its videos, clips, **and** its
   schedule event) or **prompts "Delete everywhere?"** and lets the owner choose
   the scope — never leave an orphan on another screen. **Status: DONE for
   games** (2026-08-29). `events` gained a reversible `deleted_at`
   (`migration_events_add_deleted_at_soft_delete.sql`); `delete_game` now also
   soft-deletes the linked event and `restore_game` un-deletes it (mirror pair,
   `migration_delete_game_cascades_to_linked_event.sql` /
   `migration_restore_game_also_restores_linked_event.sql`); `loadEvents`
   (lib/core/schedule.ts) filters `deleted_at`; the Film Room delete prompt now
   says "Delete everywhere?" and names the schedule entry. Cascade is ALWAYS —
   there is no film-only-vs-everywhere scope *choice* yet (add an RPC param if a
   user wants to keep the calendar entry). **Still open:** deleting a single
   *video* or detaching the last one still leaves an empty parent game, and
   `game-detail` "Remove from game"/rename use raw `Alert.alert` (a no-op on
   web) — separate orphan/swallow bugs from the pre-launch audit.

## Media transfer speed is a product requirement

Coaches upload full games from phones on tournament wifi; slow transfer = they
abandon the app. Speed is a requirement, not a later optimization.

Before writing or changing ANY code on an upload, download, or media path, state
its effect on transfer speed:
- Does it add work **per chunk or per byte**?
- Does it add a **network round trip**?
- Does it **block the transfer on something that could run in parallel**?

If a change trades speed for quality (resolution, bitrate, fidelity), **say so
explicitly and let Adam decide — never silently.** Never ship a media-path change
without stating what it costs.

## Every viewable video MUST be faststart (web-playable) — NON-NEGOTIABLE

Web browsers refuse to STREAM a non-faststart MP4 (the `moov` index atom sits at
the END, so the browser would have to download the whole file first). Native
players tolerate it; **the web does not** — a non-faststart video simply won't play
in a browser. So **anything a user can view must be served faststart.**

This is NOT per-content-type. `practice` / `scout` / `scrimmage` / `skills` / `game`
are just an `event_type` **label on a video** — there is ONE video pipeline, and it
already faststarts every upload regardless of label. The producing paths, all of
which MUST end faststart:

- **Uploaded videos (any `event_type`):** auto-optimize on upload → 720p H.264
  yuv420p **faststart** (`-movflags +faststart`); `videos.url` repoints to that copy.
- **Rendered reels (`/export`):** the concat step includes `-movflags +faststart`
  (a `-c copy` concat drops the per-clip faststart otherwise).

**RULE: any NEW flow that produces a viewable video is not "done" until its output
is faststart** — add `-movflags +faststart` (or a `-c copy` faststart pass). When in
doubt, faststart it. Backfills exist to repair pre-existing non-faststart assets
(`/optimize-all` for videos, `/reel-faststart-backfill` for reels) — run them after
shipping a fix, don't leave old assets unplayable on web.

## Every video plays the same way (fill + center + fullscreen) — except tagging

Every video surface must behave consistently: **fill + center** the frame at the
correct aspect (`contentFit="contain"`), a **centered max-width layout on web**
(no full-bleed sprawl), and a **fullscreen** affordance. This covers ALL upload
categories (Game/Practice/Scout/Scrimmage/Skills — event type is just a label,
all play through `app/game-player.tsx`), **reels + shared content**
(`app/shared-viewer.tsx`), and any future video. **WEB gotcha:** expo-video's
`VideoView` + `StyleSheet.absoluteFill` renders small/top-left — feed it **explicit
measured px dims** (`onLayout`) or a definite-`aspectRatio` box. For custom-control
players, wire the browser Fullscreen API to a `⛶` button. **THE ONE EXCEPTION: the
tagging studio** (`app/tagging-overlay.tsx` / `.web.tsx`) is a deliberate
full-bleed immersive tagger — **leave it untouched.** Full spec + surface table:
`docs/VIDEO_PLAYBACK_STANDARD.md`. Any NEW video screen isn't done until it meets
this (add it to that table).

## Events require a team

A `games` row is an **event** container and `games.team_id` is NOT NULL
(`games_insert` requires `is_team_coach(team_id)`), so an event cannot be
teamless. Rule: if the user **explicitly marks an upload as a game / practice /
scrimmage** and has no team selected, upload must **BLOCK with a clear message**
— never silently land it as loose footage. **Plain personal footage (no event
designation) stays teamless and loose** — a parent recording in the driveway
shouldn't need a team. (Current upload gates game-detail fields on a team and
shows a teamless note, but does not yet hard-block a marked event — align when
touched.)

## Conventions worth keeping

- Surface Supabase errors via `Alert.alert('Error', error.message)`.
- Tap = primary action, long-press = delete (games, videos, clips, tags).
- `formatTime(seconds)` is duplicated across a few screens; leave duplicates
  unless you're already editing more than one.
- Prefer `router.push({ pathname: '/foo', params: {...} })` (typedRoutes is on).
- New architecture (`newArchEnabled`) and React Compiler (`reactCompiler`) are
  both on — don't disable without a reason.
- New business logic goes in `lib/core/` (RN-agnostic) for iOS+Web reuse; UI
  stays platform-specific.

## Product context

- Solo project by Adam Masten. Self-described vibe-coder (beginner-intermediate
  RN). Default to **shipping over polish**; long-term goal is side income.
- Target users: AAU / youth basketball coaches and parents in Adam's network.
- **Launch plan:** ship **free** and **unlisted** on the App Store (real app,
  link-only distribution, full review) — **not** TestFlight (coaches found it a
  pain). Adults manage youth footage (Hudl model); kids are not users.
- Pricing post-launch: ~$9.99/mo individual (~$5 net). Subscriptions use
  **RevenueCat**, which begins **post-App-Store launch, not before** (includes
  per-coach affiliate codes).

## Working style

- Adam uses **VS Code exclusively** — never suggest nano/vim/TextEdit.
- Put **each terminal command in its own code block** (Adam copies one at a
  time).
- Rhythm: tag real games → find worst friction → fix it → repeat. Real-user
  friction beats theoretical priorities; resist refactor-for-its-own-sake.

## Debugging protocol — investigate before proposing

When Adam reports a bug, the DEFAULT is **investigate read-only and report
findings BEFORE proposing or writing any fix.** No code changes until findings
are seen and the fix is approved.

1. **Trace the actual code — don't guess.** Follow the real execution path to
   where the data dies.
2. **Confirm real schema against the live DB** (use the Supabase MCP) before
   writing SQL. We've hit repeated errors from assumed names.
3. **Confirm the fix lands in the LIVE file that renders — flag orphans.** We've
   been burned by the two-file trap. The Home tab is `app/(tabs)/index.tsx`
   (team wall); the app-home is `app/select-team.tsx`; the live tagger is
   `app/tagging-overlay.tsx` (not `tagging.tsx`). One file per screen.
4. **Prove which stage the data dies at with real numbers / on-screen debug
   output** — not theory.
5. **No code changes until findings are seen and the fix is approved.**

### Root pattern: this codebase "fails safe" by swallowing errors

Recurring root cause: code hides failures and shows nothing (empty feed, dropped
items, assumed-zero-rows) instead of surfacing them. Prefer surfacing a failure
over defaulting to empty — Adam can't debug at 1000+ users if failures are
silent. (This is why invariant 5 exists.)

## Cleanup rule — no orphans, no drift (NON-NEGOTIABLE)

Clean up behind yourself: no orphaned files, dead code, duplicate
tables/functions/policies, repo↔live drift, or described-but-unwritten
migrations. When you supersede something:

1. **Rewire everything to the ONE real thing**, then search the whole codebase
   AND live DB for every remaining reference.
2. **Zero references = the bar.**
3. **Only then retire the old thing** — and tell Adam before a destructive drop.
4. **Give a proof-based cleanup report** with the actual search output.
5. Keep repo `migration_*.sql` files in sync with live (there's a
   `migration_*.sql` per applied change; a header pointer marks any superseded
   one, e.g. `migration_storage_rls_videos.sql`).

## "Don't relitigate" — settled decisions

- **CORRECTION — RLS is NOT `allow_all`.** An earlier version of this file
  claimed "RLS is `allow_all` (expression `true`) on every table." **That was
  wrong.** Verified this session: every public table has real, granular RLS, and
  the last blanket `allow_all` policy (on `team_memberships`) was dropped
  (`migration_close_team_memberships_escalation.sql`). Do **not** treat RLS as a
  not-yet-real MVP placeholder or "fix" it back to open.
- **Public is retired** for kid-attached content (child-safety data-leak).
  `shares` audiences are team/coaches/player only; the storage read-leak is
  closed (owner-scoped SELECT + `sign-media`). Don't reintroduce a public
  audience or a broad storage SELECT.
- **Kid-login doors are CLOSED (2026-09-02, `migration_close_kid_login_doors.sql`).**
  Kids are never app users — guardians act for them. `players.user_id` was DROPPED
  (there's no column to attach a kid to an auth account), and the three RLS branches
  that granted access via a kid's own account (`att_write`, `players_read`,
  `install_receipts_read`) were removed (coach/guardian/team/own branches kept). The
  `player` membership role stays in the enum but is **reserved/unused — never grant
  access through it**. Don't re-add `players.user_id` or a kid-account access path.
- **Web uploads use `tus-js-client`; mobile uses the hand-rolled chunked PATCH
  loop.** The split is intentional — don't unify. (But see the speed rule: the
  sequential loop + base64 decode are fair game to optimize *without* a quality
  trade.)
- **15 MB mobile chunk size is tuned** (smaller = too many requests; larger =
  memory pressure on old iPhones). Changing it is a media-path change — state
  the speed effect.
- **`getFreshToken(forceRefresh)` mid-upload is required** — long uploads
  outlive the JWT. Never cache the token across an upload.
- **BACKGROUND UPLOAD IS A LAUNCH PREREQUISITE (requirement, NOT yet
  implemented).** Switching to another app mid-upload must not stop the
  transfer. This existed once (commit `5f356cc`, `FileSystem.uploadAsync`
  `sessionType: BACKGROUND`) and was removed **53 minutes later** by `b1fd23f`
  in favour of the current chunked base64 TUS loop — which does **not** survive
  backgrounding (a suspended JS runtime stalls the fetch loop). **Today's upload
  does NOT background; this line is a requirement to restore, not a description
  of current behavior.** Do not trade backgrounding away again. If a change to
  the upload path would break (or keep broken) app-switch survival, say so before
  making it.
- **`followers` is RESERVED — zero app-code references (verified), but it now
  has full RLS policies.** Don't wire it, build on it, or delete it. Team
  membership (not followers) handles seeing teammates' content. Confirm with
  Adam before touching it.
- **Railway server internals are NOT verifiable from this repo** (separate
  codebase). Prior sessions established the `fps=30` filter + `-fps_mode cfr`
  flag as the variable-frame-rate fix for concatenation — treat as
  don't-remove, but unverified here.

## Operational knowledge (carried forward — re-verify before a build)

The Supabase project ID below was used via the MCP this session; the rest are
carried from prior notes and **not re-verified this session** — confirm against
`eas.json` / `app.json` / App Store Connect before relying on them.

| Thing | Value |
|---|---|
| Bundle ID | `com.masten32.iamsports` |
| EAS Project ID | `ff1f3af9-f645-4ac5-9411-7ba489daea92` |
| Apple Team ID | `CAUQR2A8KW` |
| Supabase Project ID | `wscfpkaltajnrhiusoze` (verified via MCP) |
| App Store Connect API Key ID | `W2VGU58N39` |
| ASC Issuer ID | `a5304c77-d367-498e-8478-104da9bc056f` |
| ASC API Key path (local) | `~/Downloads/AuthKey_W2VGU58N39.p8` |

- **EAS builds** require API-key auth (not password); env vars
  `EXPO_ASC_API_KEY_PATH`, `EXPO_ASC_KEY_ID`, `EXPO_ASC_ISSUER_ID`.
- **Storage bucket** is **`Videos`** (capital V — wrong case fails silently);
  exports go to the `exports/` subfolder. Bucket is private (owner-scoped SELECT
  + `sign-media`); file-size limit raised to 10 GB (Supabase Pro).
- **Schema cache trap:** after modifying tables, PostgREST may serve stale schema
  ("column not found"). Fix with `NOTIFY pgrst, 'reload schema';` in the SQL
  editor before debugging further.

## Current work

Storage lockdown and the sharing/child-safety model are **done and verified**
(Public retired; owner-scoped storage; `sign-media`; membership-escalation
closed with a regression test `test_rls_escalation.sql`). Recent work is the
**Film Room** CRUD: team uploads become games (blank opponent allowed), attach /
move / remove loose footage to games, and game/reel editors (`edit-game.tsx` /
`edit-reel.tsx`).

Per-video rename ("Q1"→"Q3") is DONE — `game-detail.tsx`'s ⋯ overflow sheet has a
cross-platform "Rename" (an in-app modal writing `videos.label`; replaced the
iOS-only `Alert.prompt`). **Launch prep** remaining: host the privacy page / terms
URL, App Store listing assets, NCMEC ESP registration. Don't start larger queued
items (offline tagging, etc.) without Adam's go-ahead.

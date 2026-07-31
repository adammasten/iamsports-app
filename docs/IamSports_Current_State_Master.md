# IamSports — Current State Master Doc
*Living reference. Replaces the 220-page accumulated handoff archive as the working source of truth. Last consolidated: June 7, 2026.*

> **How to use this doc:** This is the single document to hand a fresh Claude chat, Claude Code session, or collaborator to get oriented. It is organized by topic, not by date. Where a decision changed over time, only the latest locked version is here. The old 220-page doc is retained as a dated archive for history; this is the one you maintain going forward.

---

## 1. What IamSports Is

A mobile-first React Native / Expo app for tagging youth-sports game video and building highlight reels, for AAU coaches and parents. Launches **multi-sport** (basketball first-built, but football/volleyball/soccer/etc. at launch). Built solo by **Adam Masten** (Texas) — self-described "vibe-coder." Primary test user is his son **Lars** (basketball).

**Core architectural concept:** Clips are NOT stored as separate video files. Only timestamps + metadata are stored. The actual highlight video is rendered (via FFmpeg) only at export time. Storage cost scales with games uploaded, not clips tagged — tag 500 clips on one game, zero extra storage.

**The core loop (built and working):** upload a game → tag moments → clips created → build a reel from clips → export/share.

**Competitive wedge:** the only pure-software, phone-only, individual-coach/parent, low-cost, deep-tagging option. Competitors: Hudl (~$1B, enterprise/desktop/expensive), SnipBack AI (hardware ~$3,500/yr, going upmarket — leaves the mobile consumer lane open), BallerCam (consumer hardware + auto-film), stat-trackers (numbers, no video). Thesis: "professional tagging without the professional cost — no hardware, any phone, ~$5/mo."

---

## 2. Launch Scope (CORRECTED June 6 — overrides all older "ship thin v1" language)

**v1 is already shipped and behind us. The launch target is the COMPLETE V3 product, multi-sport, all at once.** This is a deliberate, eyes-open decision — one big complete launch, not a thin MVP. Do not relitigate "ship something smaller"; that conversation is closed. Flag genuine risks (security, youth-safety, legal) as they arise, but support the full build.

**Everything below must ship together at launch:**
- Multi-sport (per-sport global tag sets, sport-aware fetching, sport picker on team creation)
- Walls (public wall = growth engine + team wall + player walls)
- Permissions product surface (coach lens, sharing controls, reshare grant, hidden-by-family, team settings/governance) — *RLS itself is done*
- Full designed UX (export redesign, cloud library, team home, parent home + parent tagging, "Sent" view, onboarding, notifications)
- Storage privacy fix (signed URLs)
- Payments (RevenueCat + Apple IAP — Universal tier alone is enough to launch)
- Clip-ownership model (team-owned vs personal, keyed to whether clipper held a tagging grant)

Adam's stance (recorded so it's not re-litigated): he knows it's a heavy solo lift, chose it deliberately because the product only works as intended fully built, and is enjoying the build regardless of outcome.

**Launch target date:** Sept 9, 2026, iOS + web at feature parity. Android post-launch only if 20+ paying users demand it.

---

## 3. Technical Identifiers (load-bearing — do not lose)

| Thing | Value |
|---|---|
| App repo | `~/hoops-app` (GitHub: adammasten/iamsports-app, private) |
| Server repo | `~/iamsports-server` (GitHub: adammasten/iamsports-server, private) |
| Server (Railway) | `https://web-production-1bf7f.up.railway.app` (Railway project "dependable enchantment") |
| Supabase Project ID | `wscfpkaltajnrhiusoze` (`https://wscfpkaltajnrhiusoze.supabase.co`) |
| Supabase storage URL | `https://wscfpkaltajnrhiusoze.storage.supabase.co` (hardcoded in `app/game.tsx`) |
| Supabase publishable key (in app, public by design) | `sb_publishable_CEXx7MDP_EMAExvLDHcdAg_Z5Cs_dvv` |
| Bundle ID | `com.masten32.iamsports` (permanent) |
| App scheme | `hoopsapp` |
| EAS Project ID | `ff1f3af9-f645-4ac5-9411-7ba489daea92` |
| Apple Team ID | `CAUQR2A8KW` |
| ASC App ID (numeric) | `6770808270` |
| ASC API Key ID | `W2VGU58N39` (.p8 at `~/Downloads/AuthKey_W2VGU58N39.p8` — ⚠️ do not lose) |
| ASC Issuer ID | `a5304c77-d367-498e-8478-104da9bc056f` |
| Distribution cert serial | `5EA4593AC8687A155E776DD0DD080C2C` (valid to May 5, 2027) |
| Super-admin account | `adam.admin@iamsports.com` (separate from everyday account; seeded in `super_admins`) |
| Everyday test account | `adammasten@gmail.com` |
| Adam's real team | "Centex2026 6th Grade" (basketball), Adam = Admin |

**EAS build command** (run in a plain terminal, NOT inside Claude Code, so prompts can be answered live):
```
EXPO_ASC_API_KEY_PATH=~/Downloads/AuthKey_W2VGU58N39.p8 EXPO_ASC_KEY_ID=W2VGU58N39 EXPO_ASC_ISSUER_ID=a5304c77-d367-498e-8478-104da9bc056f npx eas-cli build --platform ios --profile production
```
Build prompt answers (locked, corrected against CC's wrong guesses): Apple Team Type = **Individual**; provisioning profile = **reuse existing**; export compliance = **Y**.

---

## 4. Tech Stack

**Frontend:** React Native + Expo SDK 54; expo-router; expo-video; expo-image-picker; expo-media-library; expo-file-system/legacy (chunked reads); tus-js-client (web upload); @react-native-community/datetimepicker; react-native-gesture-handler. (DraggableFlatList was abandoned for tag reorder due to gesture conflict — use ▲▼ arrow buttons instead.)

**Backend/DB/storage:** Supabase Pro (Postgres + auth + storage). Bucket file size limit raised to 10GB. supabase-js ^2.105.1 (supports new key system).

**Video processing:** Node.js + Express on Railway, FFmpeg via Dockerfile, background jobs + polling, re-encodes/normalizes/scales to 1280x720 letterboxed, concatenates. Server holds the service-role/secret key (bypasses RLS); only the client app is RLS-governed.

**Build:** EAS Build (Starter plan). Apple Individual Developer enrollment (active).

**Shared-lib principle (applies to ALL new code, for iOS+Web parity):**
- `lib/core/` — pure TypeScript, zero RN/expo/browser imports, reusable by future web client. (Examples: `clip-filtering.ts`, `tag-reorder.ts`, future `cache-policy.ts`.)
- `lib/native/` — wraps RN-only I/O (FileSystem, MediaLibrary, AsyncStorage, signed-URL minting). Web gets a parallel `lib/web/`. (Examples: `video-cache.ts`, `video-url.ts`.)
- App screens call `lib/native/`, never import expo-* directly for shared logic. Don't refactor existing code under this principle — new code only.

---

## 5. Database Schema (V3 — "teams own everything")

**Foundational model:** A login is a *person*, not a role. The same human can be coach on Team A, parent on Team B, player on Team C simultaneously. **Teams own content** (games/videos/clips/tags), not users. Roles are **per-team** and **per-season**. The old `profiles`/`profileId` model is fully gone.

**Core tables:**
- `teams` — id, name, sport, created_by_user_id, **grad_class** (text, editable, supports ranges like "2032/2033"; lives on the team as lineage identity), created_at
- `team_memberships` — team_id, user_id, role, status (pending/confirmed), invited_by_user_id, season_id (nullable), joined_at. **UNIQUE(team_id, user_id, role)** → one login can hold multiple roles on one team. `status` is the approval gate.
- `players` — id, team_id (NOT NULL), name, jersey_number (text, nullable), **user_id (nullable** — roster entry can exist with no login), season_id (nullable), **player_lineage_id** (groups a kid's rows across seasons). Per-team (Lars-basketball and Lars-football are separate rows).
- `parent_player_links` — parent_user_id → auth.users, player_id → players, relationship. UNIQUE(parent_user_id, player_id). M2M (one parent↔many kids, one kid↔many parents).
- `seasons` — id, team_id, name, starts_on, ends_on, status (active/archived), created_by, created_at. UNIQUE(team_id, name). Team = permanent container; season = one instance; new coach does NOT inherit past seasons (granted, not inherited).
- `games` — team_id (NOT NULL), title, opponent, game_date (real Postgres date; handle local Y/M/D, never UTC round-trip), season_id, created_at
- `videos` — game_id (nullable), team_id (nullable — both nullable supports personal uploads), uploaded_by_user_id, url (**stores storage PATH after privacy fix, not public URL**), label, sort_order, visibility, season_id, created_at
- `clips` — video_id, team_id (nullable), created_by_user_id, start_time, end_time, note, visibility, season_id, created_at. (`is_starred`/`is_point_of_emphasis`/`point_of_emphasis_for_users[]` are now DEAD — ★/POE are tags; columns retained until a deliberate later drop.)
- `tags` — team_id (nullable), name, category (CHECK: offense/defense/plays/players/**special**), sort_order, scope (CHECK: **global | team**), season-agnostic, created_at
- `clip_tags` — clip_id, tag_id, **bundle_number** (0 = clip-level, 1+ = attribution bundles). Composite PK.
- `game_lineups` — game_id, player_id, added_by_user_id. Flat set, no per-quarter tracking.

**Access-control / sharing tables:**
- `video_tagging_rights` — per-video grant: video_id, granted_to_user_id, granted_by_user_id, can_tag, **names_hidden** (true = tagger sees numbers not names), status (active/revoked/expired), expires_at. UNIQUE(video_id, granted_to_user_id). A tagger is a per-video GRANT, never a roster member.
- `highlight_reels` — team_id, season_id, created_by, name, storage_path, source_clip_ids[], duration, overlay_mode (clean/film_breakdown), status (rendering/ready/failed), public_share_token (unique)
- `shares` — POLYMORPHIC (content_type reel/video/clip + content_id), team_id, season_id, audience (public/team/player/coaches), target_player_id, shared_by, **hidden_by_family**, visible. **Walls are VIEWS over `shares`, not separate tables.** Same content on multiple walls = multiple share rows. "Change visibility anytime" = add/remove/flip share rows; content never moves. Recall = set visible=false.
- `followers` — follower_user_id, scope (team/player), team_id, player_id, approved_by, status (pending/approved/revoked)
- `super_admins` — user_id PK, granted_at, note, **acting_as_user_id** (impersonation/view-as)
- `admin_audit_log` — actor_user_id, action (free text), target_user_id, target_table, target_id, detail (jsonb), created_at. Append-only (RLS-enforced: insert + super-admin read, no update/delete).

**Enums:** `content_visibility` = coaches_only | team | public_link | private_to_creator. `membership_role` = admin | head_coach | coach | parent | player | follower (**assistant_coach NOT yet in the enum** — `is_team_coach` omits it intentionally; add via ALTER TYPE if built).

**Migration discipline (lessons learned):** Never paste SQL through Claude Code chat (corrupts) — write to a file, `cat` in plain terminal, run in Supabase SQL Editor. After any `ALTER`/DDL: `NOTIFY pgrst, 'reload schema';`. Committing a migration file to git does NOT apply it — only running it in Supabase does. Always catalog-check after each policy: `SELECT policyname, cmd FROM pg_policies WHERE tablename='X';`. If a combined DROP+CREATE reports Success but catalog is empty, re-run the CREATE alone.

---

## 6. Security & RLS Status

**✅ DONE:**
- **Supabase key migration** — removed leaked hardcoded service_role JWT from server; server uses `sb_secret_` via Railway env `SUPABASE_SERVICE_ROLE_KEY`; app uses publishable key. Both tested + pushed.
- **All 15 RLS tables locked + verified + committed** (last hash `35a6489`) — the #1 launch blocker, DONE. Every table moved off `allow_all` to real role/membership policies with `is_super_admin()` break-glass woven through.
- **Helper functions** (all SECURITY DEFINER, STABLE, search_path=public, return false on NULL): `is_super_admin()`, `effective_user_id()` (impersonation), `is_team_member(team_id)` (any confirmed role), `is_team_coach(team_id)` (admin/head_coach/coach).
- **Storage privacy fix** (June 7) — Videos bucket private; signed URLs end-to-end (client mints via `lib/native/video-url.ts`, server via service-role key; server mints its OWN to avoid TTL race); storage RLS authenticated-only.

**⬜ STILL PENDING (security/housekeeping):**
- **Rotate the leaked service-role JWT in `iamsports-server` git history** (still in history since ~May 18).
- **Disable legacy Supabase keys** in dashboard — *after* next TestFlight build (would break the current build until rebuilt).
- **Multi-role testing pass** — log in as coach/parent/follower/tagger test accounts, confirm each sees only what it should.
- Supabase org **QUOTA-EXCEEDED** warning, grace until **Jun 9, 2026** — check billing.

**Permissions philosophy:** least privilege; tight-then-loosen (loose-then-tighten is unsafe). Widening later = one helper + a few lines. Public-reel storage/share policy is the subtle one — must allow anonymous read for genuinely public reels (the growth-engine share link for logged-out Grandma) without leaking private files.

---

## 7. Tag Architecture (the authoritative model)

**Two independent axes** (never conflate):
- **CATEGORY** (what kind of tag → screen placement): offense / defense / plays / players / **special**. Future: user-definable categories with a hide-on-mobile flag (pairs with web/desktop build).
- **SCOPE** (who owns/sees it): currently **global | team**. Future: add an **owner/personal** middle scope (a coach's tag set across all their teams of one sport) — tied to the org/multi-team tier.

**Sport is a cross-cutting filter on everything** — basketball tags never appear on a football game. Global and owner tag sets are per-sport. Don't hardcode "tags = basketball."

**Scope hierarchy (tags flow down and merge):** GLOBAL (built) → OWNER/personal (future) → TEAM (built). A team's tagging screen shows the union for that sport, minus hidden tags.

**★ Highlight and POE are now real global tags in the `special` category** (not boolean columns). They function exactly like any tag (compose, bundle, stand alone, export-filter) but render only via their dedicated buttons (gold ★, red POE "!"), excluded from the offense/defense/plays/players columns. Toggled via the normal `toggleTag`/bundle/`clip_tags` path. (CHECK constraint was widened to allow `special`.)

**Player attribution IS a tag** (resolved June 7) — a player-category tag ("Adam #32") hit in the moment on the tagging overlay, same fast flow as any tag. Label and identity are decoupled: the player-tag exists as a label first; linking to a real roster player/profile happens later in a roomy screen (rides on nullable `players.user_id`). Reroutable later (UI reskin, not migration) as long as player-tags stay flagged as player-category. Attribution ≠ visibility.

**Bundles:** `clip_tags.bundle_number` (0 = clip-level, 1+ = attribution bundles). A bundle = one meaningful unit ("Lars + Made 3 + ★"). Filtering supports co-occurrence ("clips where Lars AND Transition are tagged").

**Visibility — hide, don't delete:** users can HIDE a global/inherited tag from a team's view (per-team hidden list, non-destructive, reversible) but never DELETE what they don't own. (Why the global set is kept lean.) Owned team/personal tags can be truly edited/deleted.

**Current lean global tag set (13, basketball):** OFFENSE — MADE 2, miss 2, MADE 3, miss 3, MADE FT, miss ft, Assist, Reb O, Turnover. DEFENSE — Steal, Block, Reb D, Foul D. (Casing intentional: MAKES in caps, misses lowercase, glanceable mid-game.) Plays category left empty in globals (teams build their own). Players never global (per-team roster).

> ⚠️ Seed-file caveat: committed `seed_global_tags.sql` uses `WHERE NOT EXISTS` which inserts 0 rows on an empty table — the live 13 tags came from a plain VALUES insert (`/tmp/seed_simple.sql`, never committed). Replace the committed file's body with a plain VALUES insert before relying on it for a fresh environment.

**NEW LAUNCH TASK:** define the **default multi-sport starter tag set** per sport, categorized (incl. Player category + ★/POE specials). Because everyone starts with the same tags and *prunes down* (delete + reorder are easy), the starter set matters — it's the first thing every user sees.

---

## 8. Product Design — Home, Walls, Sharing (V3 vantage)

### Home screen — one shell, role-driven hero
A login is a person, not a role; the screen shows everything you are at once (no mode-switch). Stacked rails: header (search + bell) → **"Your kids"** rail (circles, only if you're a parent of any player; "+ Add kid") → **"Your teams"** rail (circles with your per-team role label; "+ New team") → filter chips (All / Highlights / This weekend / Just me / Sent) → recent reels → bottom nav (Home / Search / **+** center / Library / Profile). The signup question sets default rail order only (kid-plays → kids on top); rails populate from `team_memberships` / `parent_player_links`. Org admin = longer team rail, no separate org home.

**Borrowed social patterns:** circle rail (IG Stories), vertical fullscreen video on tap (TikTok/Reels), profile-as-identity (player wall), one-tap save/share. **Deliberately SKIP the algorithmic infinite-scroll feed** (wrong + unsafe for a minor-heavy app).

### Team home — three tabs
- **Wall** — chronological highlight feed of finished reels; members see only what's shared.
- **Roster** — players list with a per-kid **"sent" count** (how many clips the coach sent that kid — a relationship metric, nudges coaching everyone; underlying sharing is launch, the count/dashboard is fast-follow).
- **Film** (renamed from "Games") — raw uploaded game video, coach-only workshop. Pipeline: upload → Film (raw) → tag → clips → build reel → post to Wall. Keeps 2-hr raw footage out of the feed.

**Film organization at scale (48+ games):** group by **event** (tournament/season, collapsible) — stable, vs filing by visibility which changes constantly. One grouping layer only + search + a couple smart filters. Two coach-only status icons per game: visibility (shared/private) and tagging progress (not-started = 0 clips / in-progress = has clips / done = coach manually marks reviewed — don't auto-detect "done").

**Player wall** = the kid's identity page (hero photo, name/#/position, content counts — recommend content counts not stat-engine for launch; reels grid; share button; future "Sent to you" inbox). Team wall = a FEED; player wall = a PAGE.

### Sharing / visibility model (LOCKED)
Separate two powers: **audience** (who can view) and **re-share permission** (can they propagate it). Five audience levels underneath: Private (default for every new upload) → Sent to a kid/family (for under-13 = sent to the managing parent; the emotionally key channel) → Available to lineup players (quiet access, not broadcast) → Posted to team wall (broadcast) → Public link (anyone, no account — the growth engine).

**Launch sharing UI = 3 buttons + 1 toggle:** Who can see this (Just the family / The whole team / Anyone with a link) + "Let them share it onward?" toggle. Lineup quietly handles which team players see it. The richer 5-level model is the architecture underneath, exposed gradually.

**Youth-safety defaults:** new uploads are private by default; coach→player shares land **hidden by default** on the player's wall — the family unhides. "Shared to player" ≠ "visible on player's wall." The player wall is family-controlled; a coach can never post directly to a kid's public wall. Re-share OFF = "study this privately, don't post it."

### Search & discovery — "shareable, NOT searchable" (key child-safety principle)
- **Teams are searchable/discoverable** (filters: name, sport, state, city, age/grade, gender). Pairs with find-your-team/join flow. *Build note: those fields need to live on the team record + a search UI.*
- **Kids are NEVER searchable** (no name search, no username lookup). A child is reached only via 3 adult-INITIATED paths: (1) existing relationship (parent_player_link / team membership), (2) **share link** (surgical, one-off, no account — family/Grandma path + growth loop), (3) **invite to follow** (ongoing, account required). All push, never pull.
- **COPPA anchor:** under-13 = no account; the managing adult is gatekeeper for every share and invite.

### Team privacy & approval (the verification backbone)
Verification is **social, not technical** — the coach knows their team IRL and approves. Two gates: onto a TEAM = coach/admin approves; access to a KID = parent approves. Two join directions: coach-initiated (create roster player → invite parent) or parent-initiated (request → PENDING → coach approves). `team_memberships.status` IS the approval gate. **Creator = admin by default** (live; transferable). Team privacy toggle (admin-controlled): Private/invite-only (not in search) vs Open/discoverable (in search, people request, admin still approves). Toggle controls discovery+request, never auto-join.

### Referral / virality (Adam-flagged UX priority)
Make inviting players/parents/assistant-coaches super easy with several entry points. When sharing a video, unobtrusively prompt users to invite people — sharing IS the marketing. The viral team-seeding mechanic: a parent can create a team and invite the real coach to take over (admin transfers on accept; if coach never accepts, parent stays admin — no orphaned team).

---

## 9. Export & Reel-Building Design (DEFINITIVE)

**Whole flow:** Home → Scope picker → Batch Builder → Review → Render → lands in Cloud Library.

**One tool, four users** (parent / player / coach / AAU admin) — they differ only by where they start and how wide they set scope, never a role mode.

**Scope picker:** same component as the home team list, but checkable. Multi-team allowed; AAU grouping/select-all layer appears only when the list is long. **One reel = one sport** (a kid's teams grouped by sport; can't blend basketball + volleyball).

**Batch Builder = a CART of filtered batches.** Filters (Games → Players → Tags) are the lens for the *next* batch; the cart survives filter changes (Lars's clips stay after you deselect Lars). Each batch remembers + displays its filter, has an X to remove. Example: pick 3 games + Lars + check makes/misses → Add (batch 1); clear player + check Turnover/BLOB → Add (batch 2).
- Games: game-first default (memory anchor); Gmail-style multi-select + one-tap Select-all (non-negotiable, enables season reels); two entrances (in-game fast path + multi-select picker); organize by date + tournament.
- Players: select a player → counts recompute to just them. **No "Team" concept** — absence of a player filter IS the team-wide view. Player never baked into a tag ("Lars highlights" = select Lars + tap ★).
- Tags: keep offense/defense/plays grouping, collapsible sections, **show counts incl. 0** (scope-aware), 2-up grid, multi-select checkboxes, then "Add N clips." NO clip drilldown here.

**Review screen** (the heart of the back half): default organization **by tag** (alternates: game flow, shuffle). **Duplicates SHOWN not merged** — a clip appears in every tag section it qualifies for, flagged "also in X"; final dedupe is a render-step concern. Requested tags **highlighted**, the clip's other tags shown plain (contrast is information). "Don't make me press play" — the tag stack IS the clip's identity. Per-clip: keep/cut instant (green check ↔ red X, live "N kept" count); tap → expand inline → Watch / Trim / Re-tag. **Bundle display rule: action · player, always** ("Turnover · Lars"); bare tag = unattributed; ★/POE ride at the end as bare flags. **Scroll rule:** no inner scroll container (the nested-scroll jank that killed DraggableFlatList) — expanded rows grow the outer page; one scroll; virtualize for perf.

**Render screen:** header truth line ("26 clips · ~3:40 · 1 duplicate removed"); editable reel name (smart default); **Save to** cloud (pre-checked, gets shareable link, counts to storage) and/or device (camera roll); **Tag overlay** = Clean reel (default, no tags) vs Film breakdown (burns in **only the requested tag**, not the full stack); build runs on server with notification. No visibility decision at export — reel lands private-to-creator; visibility set later in the library.

**Cloud Library:** rows-of-shelves (scales phone→desktop). Search bar → filter chips (All/This weekend/Highlights/Mine/Shared — cross-cutting axes) → Players row → Teams row → Recent reels → Browse-by-tag chips. Don't add a 5th shelf (clutter is the failure mode). Peek-scroll with chevrons. Two tangled jobs: organizing reels + per-reel visibility (mutable anytime).

**Playback/seek is the #1 launch risk** — Review/Trim quality rides on it. Fixes: (1) background download/pre-cache via expo-file-system `createDownloadResumable` (shipped); (2) Railway FFmpeg re-encode with `-g 30 -keyint_min 30 -movflags +faststart` (front-loads metadata, makes seek cheap). FFmpeg trim locked: `-ss` before `-i`, `-t duration` not `-to endtime`.

---

## 10. Pricing (FINAL — v3, May 28)

| Tier | Price | Type | Renew | Scope |
|---|---|---|---|---|
| Universal | $4.99/mo or $39/yr | Recurring | Yes | User-scoped, portable across all teams |
| Team Pass | $200 / 4 months | ONE-TIME | NO | Team-scoped (one team; coach re-buys each season) |
| Pro Coach | $19.99/mo or $149/yr | Recurring | Yes | Power features |
| Org / Program | $49.99–$299+/mo | Recurring | Yes | Leagues, multi-team |
| Storage Archive | $1.99/mo | Recurring | Yes | Auto-fallback over storage cap |

- **Apple IAP only at launch** (no web Stripe until post-launch, ~after first 100 paying subs). Use **RevenueCat** (free under $2.5K MRR), with **per-coach affiliate/referral codes**.
- Must apply for **Apple Small Business Program** = 15% rate.
- **NO intro offer** for Team Pass (Apple's 1-per-user limit breaks multi-team users). Team Pass: day 121 → grace → paywall; 60-day content retention.
- **Universal tier alone is enough to launch with.**
- **Cut (don't bring back):** Single Game, Pay-Per-Game, in-app breakdown marketplace (moved to Upwork; schema reserved).

**Free vs paid model — "give away the trophy, charge for the workshop":** FREE = the polished output (public highlight reels — shareable, no login, branded "made with IamSports"); PAID = the tools + raw material (tagging, full games, breakdowns, private reels, library, full team page). Public reels ARE the marketing — coaches/parents spread branded reels to exactly the right audience (other AAU families). Free users cannot upload full games. Full games are paid-only to view. Limited free taste on a team's public page (~last 4-5 highlights, tunable later). Reconsider whether player highlight walls should also be free billboards (Grandma shouldn't hit a paywall on a proud-moment reel).

---

## 11. Permissions / Roles Model (consolidated)

**Roles:** admin (top — roles/billing/delete-team), head_coach, coach, assistant_coach (a permission view — trusted parent with coach-like visibility, never outranks a real coach), parent/player (merged — permissions target the adult account), follower (view-only; team-follower approved by coach, player-follower "grandma" approved by parent), tagger (per-video grant, not a roster member, sees numbers only, owns nothing, revocable/expiring), super-admin (you).

**Content ownership (the master rule):** team uploads are TEAM-owned (uploader recorded for attribution, not ownership); personal uploads are INDIVIDUAL-owned. Consequence — the hostage problem is impossible: a departing coach can't delete team film. **Clip-ownership keys to which hat the clipper wore** (granted-tagger = team's; no grant = personal) — needs a clip-level ownership marker not yet in schema (deferred design).

**Tagging rights:** tag a video only if you uploaded it OR were granted rights on that specific video. Watching ≠ tagging. Parents tag their own uploads freely.

**Visibility:** coach/admin controls all team-content visibility (default: team sees nothing except what coach shares). Players don't auto-see clips about themselves. Per-player filtering defaults OFF (anti-bullying — stops "all of Tommy's turnovers"). Admin sits above coach.

**Editability principle:** everything user-created is editable by the appropriate role (never delete-and-recreate). Renames preserve identity (same underlying record). Rename = same lineage; new team = new lineage.

**Identity/anonymization:** a player has name + jersey number. On deletion, name drops, number stays → departed kid becomes "#32." Satisfies the family's deletion right while preserving the team's footage/tags. Underlying player record persists for referential integrity.

**Retention/deletion (matches Hudl):** no auto-purge; lapsed = retained behind paywall, dormant, resubscribe to restore; hard delete = explicit request → 60-day window → purge. Guardian-consent gate at minor-account creation (COPPA); under-13 = no login, parent-controlled.

**Accounts:** two guardians / two logins / one family account (hard cap two; third = follower). One player = one guardian included; second guardian = +$4.99 (revisit).

**Organizations:** org admin sees everything across org teams except parents'/players' private personal clips; can override coaches; org-paid access is team-specific; org is the season-continuity thread.

**Super-admin / break-glass:** view-as/impersonation (read-only default, writing-as is separate + logged), global read, append-only audit log, god-view dashboard, account-fix actions. `is_super_admin()` is SECURITY DEFINER so it can't be locked out.

**Still-open permission decisions:** admin succession (what happens when the only admin leaves — pick a default; content is safe regardless), coach-notification when a parent removes a coach's video from their own view, exact invite split (who can invite whom), team-only wall name ("inner circle"?), coach's "allow parents to reshare" switch (no column yet — build with sharing UI).

---

## 12. Onboarding / First-Run (designed June 7)

Onboarding IS the retention lever (40-60% of early cancels are failed onboarding; ~75% abandon week one without fast value). Drive everyone to the **aha moment** in 2-5 min, role-personalized, skippable/non-blocking checklist.

**Two aha moments:** Coach = tag a game → build a reel. **Parent = clip my kid → SEND IT TO FAMILY** (pride + the viral loop in one — the thing the parent loves IS the growth event).

**Flow:** passwordless sign-in → one multi-select routing question ("How will you use it? My kid plays / I coach / I run an org" — "my kid plays" soft default, kids-on-top; reassurance: "you can do all of these later") → skippable role-based checklist.
- **Parent checklist (hero):** Add a video of [kid] (from camera roll) → Star a great moment → **Send it to family** ("Grandma's gonna love this"). Team setup demoted to "Later · Skip for now" — value first, setup second.
- **Coach checklist:** create/find team → tag a game → build a reel.

Empty state = warm/inviting ("Add your first video of [kid] →"), not a tutorial carousel. Practice/demo sandbox deferred to fast-follow.

**Team formation:** Find-vs-Create fork (dedupe — search first to prevent ghost teams). Creator = admin, with the smart question "Are you running this, or should we invite the coach?" Parent→coach "here's the full game" contribution flow (parent supplies footage, coach tags).

---

## 13. Roadmap / Build Order

**Next foundational builds (priority order):**
1. **Invite/membership system (the approval engine)** — biggest foundational next build; pending-state/approval/join-code/admin-transfer; everything multi-user depends on it. Build ALONGSIDE auth, not as a fast-follow.
2. **"Your kids" rail** — add-kid flow (insert players + parent_player_links) + render. ⚠️ Needs a **linked-parent branch added to `players_read` RLS** (current policy is super-admin OR team-member OR user_id=self — a non-member parent can't read their kid's player row).
3. **Apple/Google sign-in** — gated by Apple Individual→Org conversion (Google requires Sign in with Apple, ship together).
4. **Magic-link deep-link handler** — link sends but doesn't complete sign-in yet; OTP code path works. Native URL handler is net-new.
5. Filter chips → real data; bottom-nav real targets + upload entry for center "+".
6. Real onboarding screen (replace stub); pending-invite branch in AuthGate; default multi-sport tag set.
7. Notifications (a dependency, not a nice-to-have — invite-the-coach and several flows are dead without it).

**Locked future / post-launch roadmap:**
- **Cloud highlight reels** (critical) — export → Supabase storage → team Highlight Reels library + in-app + public link + downloadable; replaces camera-roll-only export.
- **Burned tag overlay on export** — drawtext via Railway FFmpeg, toggle, default OFF.
- **Player-first export flow (v2)** — select player → their tags+counts → defaults highlights-only.
- **AI auto-breakdown (long-term moat)** — every human-tagged clip = labeled training data. Phases: AI-1 suggestion (coach approves), AI-2 assisted ($15-25/game), AI-3 autonomous ($5-15/game). Bridge: paid manual breakdown ~$25/game. Add `training_data_consent` boolean to users. Reserve `breakdown_orders` schema.
- **Scout tier** (coach-to-coach full-game film exchange, paid upsell) — post-traction (liquidity + youth-consent reasons); deliberate coach-to-coach send gated by tier, not a browsable library. Rides existing sharing infra.
- **Lineup tagging & minutes-played** (time-aware lineups w/ substitutions); **shot charting & stats** (latent stat data from tags — dedicated design session Adam wants); vertical/horizontal video orientation support; member-to-member direct re-sharing; rail-level rearranging; user-definable tag categories + hide-on-mobile (with web/desktop tool).
- **App Store legal:** ToS/Privacy/EULA must include a marketing-license clause for uploaded clips/reels (opt-out-able or tiered); coordinate with `training_data_consent`.

**App Store name / trademark:** launch name "**IamSportsCoach**" (placeholder; bare "IamSports" blocked by a Dutch fitness app, Apple ID 6740399404). Plan: file USPTO TM (Class 9 + 41), then Apple IP dispute citing TM + prior use (~10-15 mo timeline). Trademark is background, not a launch gate.

**Business/legal parallel track (start early — silent blockers):** form **Texas LLC** → get **D-U-N-S number** (weeks of lead time) → flip Apple Developer account **Individual → Organization** (painful to do after launch) → enroll in Small Business Program (15%). Plus: Apple Paid Apps agreement + tax + banking; Privacy Policy + EULA + App Privacy questionnaire (COPPA); guardian-consent gate in-flow; store listing assets. Worth a one-time attorney/CPA consult given youth-data + paid.

---

## 14. Other Active Projects (brief — not IamSports)

- **hub.ai** — platform for professional support agencies (chat + documents). Early stage.
- **HIPAA-compliant lab infrastructure** — clinical laboratory; recommended: keep Google Workspace (with accepted BAA) for collaboration, build the lab system on Azure. Compliance platforms noted: Vanta, Drata, Thoropass, Secureframe, Aptible. Only BAA-covered AI endpoints (Azure OpenAI, AWS Bedrock, Anthropic under BAA) may handle PHI.
- **ShotDNA AI** — real-time shooting coach (wrist + forearm wearable + app). Recommended hardware: Seeed XIAO nRF52840 Sense (~$16, BLE + 6-axis IMU). Exploration phase.
- **Ambient** — passive health recorder ("black box for the body"); HealthKit + Health Connect cover ~80% of wearable data. MVP 0 = single-user iOS, 14-day validation.
- **Drug Trends platform** — toxicology lab internal sales tool (animated US drug-trend map). Blueprint done.
- **Estate planning** — Texas-specific questionnaire (community property, Lady Bird/TOD deed, independent administration, no state estate tax); nine-section Word doc generated; some items flagged for a TX estate attorney.

---

## 15. Working Style & Process

- **Tooling split:** Claude Code (CC) runs in the Mac **Terminal** for code; this Claude chat does architecture/strategy/decisions and generates CC prompts; Adam runs SQL in the **Supabase SQL Editor**; **VS Code only** (never suggest nano/vim/TextEdit). CC and this chat don't talk — Adam relays.
- **CC workflow:** Adam prefers seeing the **complete diff at once** before approving (reject hunk-by-hunk approval, request full diff as plain text). CC pattern: writes to `/tmp` → type-checks via swap-and-restore → shows design notes + diff → Adam approves → overwrite real file → commit per step. Don't push or trigger EAS builds — Adam does those himself. Auto-apply small visual/non-data changes (<~30 lines, not touching upload paths/data layer/deps); pause for explicit greenlight on upload paths, data-layer changes, new deps, >50-line changes, CLAUDE.md, structural changes.
- **Communication:** Adam uses **voice-to-text** (expect transcription artifacts / run-on phrasing). Non-expert at terminal/git; needs explicit one-step-at-a-time guidance; highly visual/auditory; prefers step-by-step with explicit confirmation. **One terminal command per copyable code block.** Direct path lookups, not broad home-dir scans (triggers macOS permission prompts).
- **Documentation over memory:** durable handoff docs are the source of truth, not rolling memory. End sessions by updating the doc.
- **Known baseline typecheck errors** (ignore, watch only for NEW): `game.tsx:173`, `game.tsx:265`, `video-cache.ts:250` (stale expo-file-system/legacy types — defer to a future FS-types cleanup).
- Claude can't set reminders or initiate contact — Adam sets his own.

---

*End of Current State Master Doc. Maintain this going forward; retire the 220-page accumulated doc to archive/reference.*

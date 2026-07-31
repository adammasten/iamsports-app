# IamSports — Handoff (end of June 12 session)

*Picks up from the prior handoff. Covers: Team Wall commit, the Clips-library → "My Work" pivot, the reels-persistence keystone (built + working end-to-end), and a production server outage that was diagnosed and fixed. Workflow unchanged: architecture/decisions in Claude chat; execution in Claude Code (now also available as a VS Code panel); SQL only via Supabase SQL Editor (never through CC); VS Code for editing.*

---

## HEADLINE WINS TODAY
1. **Team Wall** shipped + committed (displays `audience='team'` shares).
2. **Reels keystone built and WORKING END-TO-END** — an export now persists a `highlight_reels` record. Confirmed with a real row in the DB.
3. **Production export server outage fixed** — the live render server was missing/misnamed its Supabase key env var; exports had been silently broken. Now working.
4. **VS Code Claude Code extension** installed (Anthropic, official) — inline diffs, sees open files. Execution workflow now lives in the editor.
5. Two architecture docs locked earlier in the session (pre-launch homepages; the "My Work" / publishing model).

---

## 1. TEAM WALL — SHIPPED ✅
- New `app/team.tsx` (route `/team`): loads shares where `team_id = teamId AND audience = 'team'`, newest first, resolved via `resolve_shared_content`, cards tap → `/shared-viewer`. Empty state "Nothing on the team wall yet."
- Registered `/team` in `app/_layout.tsx`.
- Option-A entry point: a "Team Wall" button on the games home (`app/(tabs)/index.tsx`) — games flow untouched.
- Tested on device, **committed + pushed**.
- Deferred follow-ons: all-teams aggregate, moderation/take-down, roster, posting from the screen, showing which kid each post is about.

## 2. CLIPS LIBRARY → REPURPOSED INTO "MY WORK" (decision)
- Built a unified coach Clips library (`app/clips-library.tsx`, folder-icon entry in `select-team.tsx`) — but on review, **raw "all clips" is low-value** (a game has hundreds of clips; nobody scrolls them).
- **Decision: repurpose that screen into "My Work"** — a library of REELS (finished exports), not raw clips. ~80% of the screen is reusable (team chips, cards, tap-to-play); it just points at `highlight_reels` instead of `clips`, plus status badges.
- `clips-library.tsx` is **uncommitted** — do NOT commit as-is; it's being reworked into My Work.
- See the locked spec: **`iamsports_my_work_and_publishing_model.md`** (My Work = everything you've made, each item badged with where it lives: unshared / shared-with-Lars / team wall / coaches' board / public; create-once-publish-anywhere model; 5 spaces; reels are the unit, not clips).

## 3. REELS PERSISTENCE — THE KEYSTONE (built + working) ✅
**Goal:** an export must leave a findable record (previously it only hit the camera roll and vanished).

**Migration (already RUN in Supabase):** `migration_reels_nullable_creator.sql`
- Made `highlight_reels.team_id` nullable + added a **creator-ownership RLS branch** (`created_by_user_id = auth.uid()` on read/insert/update/delete) so a parent (or anyone) can own a reel with NO team, while team reels still work. (Real fix was the INSERT policy gaining the creator branch — `team_id` was already nullable at the column level; the insert RLS was the gatekeeper.)
- Note: the `highlight_reels` table already existed (from earlier walls/sharing work) — we did NOT build a new table.

**App code (`app/export.tsx` — UNCOMMITTED, needs commit):**
- `deriveStoragePath()` — strips `job.url` down to the bare `exports/<file>.mp4` key (matches the `videos.url` convention so reels play later via signed URLs).
- `saveReelRecord()` — after the render finishes, inserts one `highlight_reels` row: `created_by_user_id` from session (REQUIRED for RLS), `team_id: null`, `name` synthesized from game titles, `storage_path`, `source_clip_ids`, `duration_seconds`, `overlay_mode: 'clean'`, `status: 'ready'`. Wrapped in try/catch — best-effort, can't break the export or camera-roll save.
- Added `[export]` diagnostic console.logs (handleExport called / includedClips count / POSTing to Railway / server rejected / FAILED). Kept for now — handy, harmless.

**VERIFIED WORKING** — after fixing the server (below), a real export produced this row:
```
id: 8dbe1bf5-...   created_by_user_id: 7f1122bd-... (Adam)
team_id: null   name: "vs Apex Highlights"
storage_path: exports/1781321295809.mp4   duration_seconds: 328.6   status: ready
```

**TODO (first thing tomorrow): commit `app/export.tsx`.** Suggested message:
`"Persist exports as highlight_reels records (creator-owned, team_id null)"`

## 4. PRODUCTION SERVER OUTAGE — DIAGNOSED + FIXED ✅
**Symptom:** export hung at "Processing… 0%" forever, never completed (so no reel saved).

**Diagnosis chain:** app logs proved the app was POSTing correctly → curl proved the server was alive (`200` health, `400` on empty `/export`) → live Deploy Logs showed the real crash, repeating: `Error: supabaseKey is required.` at `processExport (/app/index.js:61)`.

**Root cause:** the render server reads `process.env.SUPABASE_SERVICE_ROLE_KEY` (no fallback, confirmed in `iamsports-server/index.js:11`). The live server had the key stored under the WRONG name (`SUPABASE_SERVICE_KEY`, missing `_ROLE_`), so the code got `undefined` and crashed on every export.

**Fix:** added a correctly-named `SUPABASE_SERVICE_ROLE_KEY` variable on the live Railway service, with the same key value, then deployed. (Watch out: a first attempt had a typo — `SUPABASE_SEREVICE_ROLE_KEY` — which still failed; corrected to exact spelling.)

**CRITICAL CONTEXT — TWO RAILWAY PROJECTS (cleanup needed):**
- **`strong-vibrancy`** = THE LIVE SERVER. Domain `web-production-1bf7f.up.railway.app` = the exact URL the app POSTs to. **This is the one that was fixed.**
- **`dependable-enchantment`** = a DUPLICATE/orphan (domain `web-production-40559`). The app does NOT use it. A key was mistakenly added here during debugging — irrelevant.
- These are two copies of the same server (likely deployed from GitHub twice). The duplicate caused real confusion tonight (logs looked idle because we were watching the wrong one).

---

## TOMORROW'S DOCKET (in order)
1. **Commit `app/export.tsx`** (the reel-persistence work — confirmed working, just needs committing/pushing).
2. **Delete the orphan `dependable-enchantment` Railway project** (5 min) — removes the two-projects confusion permanently. Keep only `strong-vibrancy` (web-production-1bf7f).
3. **(Optional but due) Rotate the Supabase service-role key** — it's been hardcoded in git history (the long-standing "leaked service-role JWT" item). Rotate in Supabase → update the now-correctly-named `SUPABASE_SERVICE_ROLE_KEY` on strong-vibrancy → redeploy → re-test an export. Fixes the export AND closes the security hole in one move.
4. **Build "My Work"** (the real next feature):
   - Repoint the clips-library screen to list `highlight_reels` (the user's reels) instead of raw clips.
   - **Reel naming/editing** — let users rename a reel (default today is auto "vs X Highlights"; users will want "Lars windmill dunk" etc.). NEW REQUEST from Adam — important for organizing.
   - Status badges per reel (where it lives: unshared / kid / team / coaches / public).
   - Team chips (multi-select) + filter.
   - Fix the sparse/weak visual density flagged earlier; match the modern dark aesthetic.

## PARKED / LONGER-TERM (captured, not built)
- **Reels-of-reels** (NEW idea from Adam): combine multiple reels into a bigger film. A reel is already a list of source clips; a mega-reel = a reel whose sources can be reels. Data model can support it later. Build after My Work + sharing are solid.
- The follower/invite system (3 tiers) + public content viewing path — post-launch growth package (in the pre-launch architecture doc).
- Coaches' Board (`audience='coaches'` — value already in the enum) — part of the My Work / publishing model.
- Server on **Node 18** (deprecation warnings) — upgrade to Node 20+ eventually.
- The resume-after-background export path doesn't write a reel (clips not in memory there) — wire later if needed.
- Design-system unification (legacy light screens vs. dark modern ones).
- Vertical video support investigation.

## STATE OF THE TREE (uncommitted)
- `app/export.tsx` — reel insert + deriveStoragePath + `[export]` logs → **COMMIT tomorrow** (works).
- `app/clips-library.tsx` + its `_layout.tsx` route + `select-team.tsx` folder wiring — being reworked into My Work; **don't commit as-is**.
- `migration_reels_nullable_creator.sql` — already run in Supabase; fine to keep in repo.

## ONE-LINE STATUS
Reels now persist on export (verified with a real DB row); the production export server is fixed (was a misnamed `SUPABASE_SERVICE_ROLE_KEY` on the live `strong-vibrancy`/`1bf7f` project). Tomorrow: commit export.tsx, delete the orphan Railway project, optionally rotate the key, then build "My Work" (reels list + rename + badges).

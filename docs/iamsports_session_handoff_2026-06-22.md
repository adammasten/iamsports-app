# IamSports — Full Session Handoff (My Work Destinations + Org Tier)

*Paste this as the FIRST message of a fresh chat to continue. Workflow unchanged: architecture/decisions in Claude chat; execution in Claude Code (CC) in the Mac terminal / VS Code panel; SQL only via Supabase SQL Editor (never CC); VS Code for editing. One terminal command per code block. One step at a time, confirm before proceeding. Honest pushback wanted.*

---

## SHIPPED & VERIFIED (this session, June 22 — all committed, all live in Supabase, on-device confirmed)

DB check returned all four `true`: `user_profiles_exists`, `set_name_rpc_exists`, `get_name_rpc_exists`, `post_to_wall_widened`.

**Commits on `main` (confirm all pushed to origin — Adam pushes from a separate terminal; the SSH key is passphrase-protected so CC's non-interactive shell can't load it):**
- `0cdeab8` — My Work media-card reel layout
- `a92e833` — My Work multi-select **VisibilityPicker** (Only me / Friends & Family / Public / Team wall); default-private, no open-web by default
- `d142688` — `kid.tsx` inbox uses the shared VisibilityPicker
- `5ed50d5` — `kid.tsx` inbox shows sharer **display name** via `get_user_display_name` (From {name} / you / someone, no UUID)
- `0be2589` — **First-run name capture** overlay (`_layout.tsx` NameCaptureGate + `components/NameCaptureSheet.tsx`)
- `72230ff` — My Work **grouped player-picker** (Your kids + coached-team players, deduped)
- `155e348` — Migration: **`post_to_wall` widened** for inbox sends
- `acb3794` — Migration: **`user_profiles`** table + display-name RPCs

**Both migrations are LIVE in Supabase** (verified), so the committed app code is fully backed.

### `post_to_wall` widen (live) — who can send to a player's inbox (`audience='player'`)
Allowed: super-admin, OR linked parent, OR confirmed **coach/admin** (`is_team_coach` → admin/head_coach/coach) of a team the player is on, OR confirmed **player-role teammate** on that team. **Followers and other parents are NOT allowed.** Other audiences (public/team/coaches) unchanged: super-admin or linked parent only.

### `user_profiles` (live)
- `user_profiles` table (1:1 with `auth.users`, RLS self-read only).
- AFTER INSERT trigger auto-creates an empty row for every new account (both signup paths) + idempotent backfill.
- `get_user_display_name(p_user_id)` — gated to shared context (self / common linked player / shared confirmed team / parent-of-player-on-target's-team / super-admin), else null.
- `set_my_display_name(p_name)` — self-only upsert.

### On-device test result (important nuance)
The grouped picker renders correctly: sheet titled "Post to wall" → **"YOUR KIDS"** header → Lars Masten, Conrad Masten. **No team group appears** because the only `player_teams` rows are Lars + Conrad themselves (Adam's kids, on teams Adam coaches), and the dedupe correctly keeps a kid out of a team group. So the team-player path is **built and correct but dormant** until a non-kid player exists on a roster. NOT a bug.

`player_teams` currently has exactly 2 rows: Conrad Masten → Centex Attack Bobby; Lars Masten → Centex2026 6th Grade.

---

## THE REDESIGN: "POST TO A PERSON" → "POST TO A DESTINATION" (LOCKED)

The current My Work picker is built around posting to a *person*. A coach with **no kids and no non-kid roster players** hits a dead-end ("No kids yet — add a kid first"), which is wrong for a coach. The picker also can't post to a **team wall directly** or to the **Coaches' Corner**. The redesign turns the picker into a list of **destinations**:

- **Your kids** — *renders only if the user has linked kids*
  - Pick a kid → choose visibility: **Only me / Friends & Family / Public**
  - *(Built and working today. Keep it.)*
- **Your teams** — *renders only if the user coaches ≥1 team (admin/head_coach/coach via `is_team_coach`; team **admin** is included here)*
  - Show a **list of the user's teams**. Pick a team → second step:
    - **Post to team wall** → choose visibility: **Public / Team-only**
    - **Send to a player** → pick a player from **that team's roster** (`player_teams` for that `team_id`) → lands in **that player's inbox** (`audience='player'`)
- **Coaches' Corner** — *renders only if the user coaches ≥1 team*
  - Pick **which team's board** → posts **coaches-only** (`audience='coaches'`)
- **Empty-state rule:** a group with no members simply **doesn't render** (the `pickerGroups` memo already only emits populated groups). No "add a kid" dead-end for a coach.

### OPEN DECISION (settle before building the team-wall-direct slice)
When a coach posts a **team-owned reel** straight to the team wall, the coach decides **Public vs. Team-only outright, no family in the loop** (no minor's personal wall involved). Adam + Claude instinct: **yes**. Confirm and lock.

---

## BUILD ORDER (smallest + safest first — do NOT stack; each ships + is tested before the next)

1. **Slice 1 — empty-state copy fix (app only, no RLS). IN PROGRESS / NEXT.**
   The `pickerGroups` memo *already* only emits populated groups (guards at the `length > 0` lines), so the ONLY remaining dead-end is the empty-state Alert inside `confirmPostToWall` (around lines 245-249 of `app/my-work.tsx`): it currently fires `Alert.alert('No kids yet', 'Add a kid first to post a reel to their wall.')` when `total === 0`.
   **The change:** edit ONLY that Alert's text to be role-neutral, e.g. title `'Nothing to post to'`, message `'Add a kid, or join a team as a coach, to post a reel.'` Keep the `total === 0` logic and everything else byte-for-byte. Typecheck (ignore the 3 known `lib/native/` errors), show the diff, commit.
   *(This is the whole slice — it's a one-line copy change. App is pre-launch, single user (Adam), so no "coming soon" language needed.)*
2. **Coaches' Corner send.** `audience='coaches'` already in the enum. Needs: picker option (pick a team's board) + a `post_to_wall` path/gate for `coaches` (use `is_team_coach`, same shape as the inbox widen already done) + a board-view screen. Medium; reuses known patterns.
3. **Direct team-wall post with visibility (Public / Team-only).** NEW: posting to a *place*, not a person — touches the locked "post-to-person" model. **Build only after the OPEN DECISION above is locked.** Child-safety-adjacent — do rested.
4. **Nested team → individual-player send.** Most child-safety-sensitive. GOOD NEWS: the DB is **already done** (the `post_to_wall` widen this session already allows a coach to send to a player on their team's inbox). Remaining work is **purely surfacing those players in the picker** (roster from `player_teams` for the chosen team). Read-only investigate first, build slow, rested.

---

## CURRENT `app/my-work.tsx` PICKER INTERNALS (for reference)
- `useTeamContext()` provides `userId, userKids, userTeams` (line ~46).
- `COACH_ROLES = ['admin','head_coach','coach']`.
- `coachedTeamIds` useMemo = `userTeams.filter(t => COACH_ROLES.includes(t.role)).map(t => t.team_id)`.
- `coachedPlayers` state — loaded by an effect querying `player_teams` `.select('team_id, players ( id, name )').in('team_id', coachedTeamIds)`, filtered for RLS-nulled rows, flattened to `{player_id, name, team_id}`.
- `pickerGroups` useMemo — builds "Your kids" first (deduped), then one group per coached team (deduped, kid-relationship-wins, only pushes groups with `players.length > 0`).
- `confirmPostToWall(reel)` — sums `pickerGroups` player counts; if `total === 0` fires the empty-state Alert (**slice 1 target**), else opens the bottom-sheet (`setPickerReel`).
- `postReelToKid(reel, playerId, kidName)` — does the actual send via `post_to_wall` with `audience='player'`. **Do not touch** when adding the picker copy fix.
- The grouped bottom-sheet renders at `pickerGroups.map(...)`; section headers + tappable player rows; Cancel + backdrop dismiss.

---

## PERMISSION TIERS — keep NAMED DISTINCTLY (do not tangle)
- **Platform super-admin** *(exists: `super_admins` table, `acting_as_user_id`, `is_super_admin()`)* — system/platform override (Adam/Anthropic-side), "act as any user," acts across the whole platform. **NOT an org role.**
- **Org admin** *(NEW — not in schema yet)* — multiple allowed per organization; controls everything across **all teams within their own org only** (not other orgs). The org "master key." Coaches have the **least** control.
- **Coach** *(exists: admin/head_coach/coach per team)* — single team, least control.

⚠️ Naming trap: never call org-admins "super admins" in code — `super_admin` already means the platform override. Tangling these is how a child-safety gate ends up checking the wrong thing.

---

## MAJOR FUTURE ARCHITECTURE ITEM (own design session — do NOT bolt onto the picker)
**Organizations tier.** An org owning many teams, with multiple **org-admins** above the team level (org > team > coach). Foundational schema build: new `organizations` table, org membership, org-admin role, RLS changes across teams/walls/boards. Bigger than everything built this session combined. Park it; design it separately. Open questions: does an org-admin see all member teams' walls/boards in the picker? how is org membership granted/revoked? how do existing teams attach to an org? Many org-admins allowed per org.

---

## KEY INFRA / IDS (stable)
- Supabase project `wscfpkaltajnrhiusoze`; app repo `adammasten/iamsports-app`; server repo `adammasten/iamsports-server`.
- Railway backend `web-production-1bf7f.up.railway.app` (project `strong-vibrancy`); bundle `com.masten32.iamsports`.
- 3 pre-existing typecheck errors are ALWAYS ignored: `lib/native/video-cache.ts:250`, `lib/native/video-upload.ts:84`, `lib/native/video-upload.ts:205`.
- `share_audience` enum: `public | team | player | coaches`. `membership_role` enum: `admin | head_coach | coach | parent | player | follower`.
- Adam's kids: Lars Masten, Conrad Masten. Teams (Adam = Admin): Centex2026 6th Grade, Centex Attack Bobby.

---

## ONE-LINE STATUS
My Work picker is being reshaped from "post to a person" → "post to a **destination**" (Your kids w/ visibility / Your teams → team wall w/ visibility OR send to a roster player / Coaches' Corner), groups rendering only when populated. Slice 1 (next, trivial, app-only): change the lone empty-state Alert in `confirmPostToWall` from the kid-centric "add a kid first" to role-neutral copy. Slices 2-4 (Coaches' Corner → team-wall direct post → individual-player send) touch child-safety RLS and are best built fresh; slice 4's DB is already done via the `post_to_wall` widen. Separately flagged for its own session: an **Organizations tier** with multiple org-admins, named distinctly from platform `super_admin`.

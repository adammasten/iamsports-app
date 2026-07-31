# IamSports — My Work Destination Picker + Org Tier (handoff)

*Paste as the first message of a fresh chat to continue. Workflow unchanged: architecture/decisions in Claude chat; execution in Claude Code (CC) in the Mac terminal / VS Code panel; SQL only via Supabase SQL Editor (never CC); VS Code for editing. One terminal command per code block. One step at a time with confirmation. Honest pushback wanted.*

---

## WHERE WE ARE (verified this session, June 22)

All committed AND confirmed live in Supabase. Four booleans came back `true`:
`user_profiles_exists`, `set_name_rpc_exists`, `get_name_rpc_exists`, `post_to_wall_widened` — all true.

**Shipped + DB-backed + on-device confirmed:**
- My Work multi-select **VisibilityPicker** (Only me / Friends & Family / Public / Team wall) — default-private, no open-web by default. (`a92e833`)
- `kid.tsx` inbox uses the shared VisibilityPicker (`d142688`); inbox shows sharer **display name** via `get_user_display_name` (`5ed50d5`).
- **First-run name capture** overlay (`0be2589`).
- My Work **grouped player-picker** — "Your kids" + (eventually) coached-team players, deduped (`72230ff`).
- Migration **`post_to_wall` widened** for inbox sends: a `player`-audience send is now allowed from super-admin, linked parent, confirmed coach/admin (`is_team_coach`), or confirmed player-role teammate — NOT followers/other parents (`155e348`, live).
- Migration **`user_profiles`** + display-name RPCs (`acb3794`, live).

**On-device test result (important):** The grouped picker renders correctly ("YOUR KIDS" → Lars, Conrad). No team group appears **because the only `player_teams` rows are Lars + Conrad themselves** (kids on teams Adam coaches), and the dedupe correctly keeps a kid out of a team group. So the team-player path is *built and correct but dormant* until a non-kid player exists on a roster. Not a bug.

**Open housekeeping:** confirm the 3 commits (`acb3794`, `155e348`, `72230ff`) are pushed to origin (Adam pushes from a separate terminal; earlier SSH key is passphrase-protected and can't be loaded from CC's non-interactive shell).

---

## THE GAP THIS REDESIGN FIXES

Today the My Work picker is built around **"post to a person."** A coach with **no kids and no non-kid roster players** hits a dead-end: the empty state literally says *"No kids yet — add a kid first,"* which is wrong for a coach. The picker also can't post to a **team wall directly** or to the **Coaches' Corner** — both of which a coach needs. The redesign turns the picker from "list of people" into "list of **destinations**."

---

## THE DESTINATION PICKER MODEL (LOCKED)

From a reel in **My Work → "Post to wall"**, show a destination sheet:

- **Your kids** — *renders only if the user has linked kids*
  - Pick a kid → choose visibility: **Only me / Friends & Family / Public**
  - *(This is what's built today. Keep it.)*
- **Your teams** — *renders only if the user coaches ≥1 team (admin / head_coach / coach via `is_team_coach`)*
  - Show a **list of the user's teams**. Pick a team → second step:
    - **Post to team wall** → choose visibility: **Public / Team-only**
    - **Send to a player** → pick a player from **that team's roster** (`player_teams` for that `team_id`) → lands in **that player's inbox** (`audience='player'`)
- **Coaches' Corner** — *renders only if the user coaches ≥1 team*
  - Pick **which team's board** → posts **coaches-only** (`audience='coaches'`)
- **Empty-state rule:** if a group has no members, that group simply **doesn't render**. A kid-less coach sees Teams + Coaches' Corner and NO "add a kid" message. A coach with nothing at all (no kids, no teams) is the only true empty state.

### Decision still OPEN (settle before building slice 3)
- **Team-wall direct post visibility:** when a coach posts a team-owned reel straight to the team wall, does the **coach decide Public vs. Team-only outright, with no family in the loop?** (Adam's instinct + Claude's: yes — it's a team reel the coach made, no minor's personal wall is involved. CONFIRM and lock.)

---

## BUILD ORDER (smallest + safest first — do NOT stack)

Each slice ships and is tested before the next (especially the child-safety ones) begins.

1. **Empty-state + grouping fix (app only, no new RLS).** Make the picker coach-aware: drop the "add a kid" dead-end; render only the groups that have members; show Teams / Coaches' Corner placeholders even with no kids. *Safe to do tired. This is slice one.*
2. **Coaches' Corner send.** `audience='coaches'` already in the enum. Needs: picker option (pick team's board) + a `post_to_wall` path/gate for `coaches` (using `is_team_coach`, same shape as the inbox widen already done) + a board-view screen. Medium; reuses known patterns.
3. **Direct team-wall post with visibility (Public / Team-only).** NEW: posting to a *place*, not a person — touches the locked "post-to-person" model. **Build only after the open decision above is locked.**
4. **Nested team → individual-player send.** Most child-safety-sensitive. GOOD NEWS: the DB is **already done** — `post_to_wall` was widened this session to allow a coach to send to a player on their team's inbox. Remaining work is **purely surfacing those players in the picker** (roster from `player_teams` for the chosen team). Still: read-only investigate first, build slow, rested.

---

## PERMISSION TIERS — keep these NAMED DISTINCTLY (do not tangle)

- **Platform super-admin** *(exists today: `super_admins` table, `acting_as_user_id`, `is_super_admin()`)* — system/platform override (Adam/Anthropic-side), can act across the whole platform / "act as any user." This is NOT an org role.
- **Org admin** *(NEW — does not exist in schema yet)* — multiple allowed per organization; controls everything across **all teams within their own organization only** (not other orgs). The org "master key."
- **Coach** *(exists: admin / head_coach / coach per team)* — scoped to a single team, **least** control.

⚠️ Naming trap: do not call org-admins "super admins" in code — `super_admin` already means the platform override. Tangling these is exactly how a child-safety gate checks the wrong thing.

---

## MAJOR FUTURE ARCHITECTURE ITEM (own design session — do NOT bolt onto the picker)

**Organizations tier.** An org that owns many teams, with multiple **org-admins** above the team level (org > team > coach). This is a **foundational schema build**: a new `organizations` table, org membership, org-admin role, and RLS changes across teams/walls/boards. It is bigger than everything built this session combined. Park it here; design it on its own, distinct from both per-team admin and platform super_admin. Open questions: does an org-admin see all member teams' walls/boards in the picker? how is org membership granted/revoked? how do existing teams get attached to an org?

---

## ONE-LINE STATUS
My Work picker is being redesigned from "post to a person" → "post to a **destination**": Your kids (visibility) / Your teams (→ team wall w/ visibility OR send to a roster player) / Coaches' Corner — groups render only when populated, killing the kid-less-coach dead-end. Build in 4 slices, safest first (empty-state fix → Coaches' Corner → team-wall direct post → individual-player send; the last's DB is already done via the `post_to_wall` widen). Separately flagged: an **Organizations tier** with multiple org-admins (named distinctly from platform `super_admin`) as a foundational future build.

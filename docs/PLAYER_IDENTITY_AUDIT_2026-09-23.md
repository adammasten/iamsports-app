# IamSports — Player Identity Forensic Audit + Architecture Review
**Date:** 2026-09-23 · **Mode:** READ-ONLY. No code, migrations, data changes, or deploys were made.
**Evidence standard:** every claim is tagged **FACT** (verified in live DB via Supabase MCP, or in current code),
**INFERENCE** (strongly implied, not directly proven), or **RECOMMENDATION** (proposed future design).

---

## 1. EXECUTIVE SUMMARY

**What represents a child today?** One row in `players`. It has exactly one identity-ish field: `name text NOT NULL`.
No first/last split, no DOB, no nickname, no `created_by`. It also carries three *relationship* columns that
should not be on an identity row: `team_id`, `season_id`, `jersey_number`. **FACT**

**Is player identity actually global?** *Structurally yes, operationally no.* The relationship layer
(`player_teams` + team-scoped `tags.player_id`) genuinely supports one child on many teams — and one child in
your live data proves it: **Lars Masten `e34c2405` is one `player_id` on two teams with two team-scoped chips and
80 tagged clips (36 + 44)**. But *authorization and readability still key off the legacy `players.team_id`
column*, and the claim flows create a new row far more easily than they reuse an existing one. **FACT**

**Is the architecture fundamentally sound?** Yes. `players` / `player_teams` / `parent_player_links` /
`tags.player_id` is the right four-table shape and I would not replace it. The problems are not the model —
they are (a) one legacy column still acting as the security key, (b) claim UX that defaults to creating,
(c) a name-based duplicate suggester with no dismissal, and (d) a merge that leans on `ON DELETE CASCADE`.

**Where are duplicates created?** Almost entirely at `claim_roster_spot` — a parent taps their kid's first name
on a coach's roster and gets linked to the coach's placeholder row, with **zero check against the children that
parent already has**. **FACT** ([app/join-team.tsx:58](../app/join-team.tsx#L58))

**Can a parent reliably reuse an existing child?** Only if they find it. The reuse path exists but is hidden
behind a "My player isn't listed" link *below* the roster list, and it is filtered to kids not already on that
roster. The create-new path (`create_kid`) sits directly beneath it — **and is currently broken** (see §3, F1). **FACT**

**Can multiple parents link to the same child?** Yes, and this part is well built: `parent_player_links` is
unique on `(parent_user_id, player_id)`, so mom + dad + grandparent → one `player_id` all coexist, and one adult
→ many children works. Live: 3 adults have >1 kid; 2 players have >1 adult; the 4-guardian cap is enforced in
`claim_or_link_guardian`. **FACT**

**Is there a safe merge path?** There is a merge (`merge_players`) and it is thoughtfully written for the
dependencies it knows about — but it repoints only 7 of the 14 tables that reference `players.id` and lets
`ON DELETE CASCADE` take the rest. It is also irreversible with no alias/tombstone. **FACT**

**Biggest identity risk:** **the same child's film is already split across multiple identities in production, and
because all parent access resolves through `parent_player_links → player_id`, the split silently removes a real
parent's access to their real child's real film.** Live proof: Conrad Masten exists as **four** `players` rows;
two of them (`045968e6` on Legends 2036 with 21 tagged clips, `25411e20` on Regents Bangels with 11 tagged clips)
have **zero guardians**, so no parent path reaches those 32 clips at all. **FACT**

---

## 2. CURRENT DATABASE MODEL

### 2.1 `players` — exact live schema **FACT**

| column | type | null | notes |
|---|---|---|---|
| `id` | uuid | NO | PK, `gen_random_uuid()` |
| `team_id` | uuid | YES | **legacy denormalized "home team". Still the RLS key.** |
| `name` | text | NO | the *only* name field — no first/last/nickname/preferred |
| `jersey_number` | text | YES | legacy; the real per-team jersey lives on `player_teams` |
| `created_at` | timestamptz | NO | |
| `season_id` | uuid | YES | legacy; unused for scoping |
| `player_lineage_id` | uuid | YES | identity-grouping id — **write-only, 22/49 NULL** |
| `grad_class` | text | YES | |
| `photo_path` | text | YES | storage key, served via `authorize_photo_view` |

**Absent:** `first_name`, `last_name`, `display_name`, `nickname`, `preferred_name`, `dob`, `gender`, `position`,
`created_by`, `organization_id`, `deleted_at`/archive field, `metadata`. **FACT**
(For contrast, `user_profiles` — the *adults* — does have `first_name` / `last_name`. **FACT**)

`players.user_id` was dropped by `migration_close_kid_login_doors.sql:36`; the column is confirmed absent live. **FACT**

### 2.2 What one `players` row actually represents

**Answer: D — inconsistent, depending on creation path.** **FACT**, traced:

- `create_kid()` → a **global, teamless child** (`team_id = null`), owned by a guardian link.
- `create_roster_placeholder()` → a **team roster slot** (`team_id` = that team, plus a `player_teams` row).
- `join_team_with_code()` → promotes a global child by *stamping* `players.team_id = <first team joined>`,
  then leaves it alone on subsequent teams (`update players set team_id = t_id where id = ... and team_id is null`).

So a row is "a global child" or "a player on one team" depending on who made it, and the `team_id` column means
"the first team this child was ever attached to" — which nothing in the product actually wants to know.

### 2.3 `player_teams` — the relationship layer **FACT**

`id, player_id, team_id, jersey_number, added_by_user_id, created_at, left_at, joined_on (NOT NULL, default CURRENT_DATE), left_on, season_id`

- Unique: `player_teams_current_key` on `(player_id, team_id) WHERE left_on IS NULL` — one *open* spell per team.
- Index `player_teams_spell_idx (team_id, player_id, joined_on, left_on)` — spells model, per season-rosters plan.
- Trigger `sync_player_teams_left_at` keeps `left_at` in step with `left_on`.
- Trigger `on_player_teams_insert → ensure_player_tag()` auto-creates the team-scoped player chip.
- Trigger `trg_prune_future_lineups` on `left_on` change.
- **Is it already the reusable relationship layer?** **Yes — by design and in one live case.**
  `player_id ABC → (Team A, 2026) + (Team B, 2026) + (Team C, 2027)` is fully legal: uniqueness is per open
  spell, not per player. **FACT**
- **Where the app diverges:** `roster_for_season` and `is_roster_parent` read `player_teams` correctly, but
  RLS on `players`, `parent_player_links`, and `lib/core/player-links.ts` all read `players.team_id`. **FACT**
- Note: `player_teams.season_id` is **NULL on every live row** (0 players span multiple seasons); season scoping
  currently works off the `joined_on`/`left_on` date window vs `seasons.starts_on/ends_on`. **FACT**

### 2.4 `parent_player_links` — the authorization layer **FACT**

`id, parent_user_id, player_id, relationship, created_at, receives_logistics_alerts`
- Unique `(parent_user_id, player_id)`; FK to players is **ON DELETE RESTRICT** (the only non-cascade FK).
- Trigger `trg_revoke_guardian_seat` revokes a purchased seat on unlink.
- **Multi-adult → one child: SUPPORTED.** **Multi-child → one adult: SUPPORTED.** Nothing structural blocks either.
- The 4-guardian cap lives in `claim_or_link_guardian` (paid seats bypass it via `player_guardian_seats`).
- "Already claimed" logic lives **only** in `claim_roster_spot`, which hard-rejects if *any* link exists:
  `'This player is already claimed — ask their family for their invite code to be added.'` That is the correct
  guardrail; the second adult's path is the per-player guardian code (`claim-kid.tsx`). **FACT**

### 2.5 Relationship diagram (current, as built)

```
auth.users ──┐
             │ 1:N  parent_player_links (parent_user_id, player_id)  [UQ, ON DELETE RESTRICT]
             ▼
          players ───────────────► players.team_id  ⚠ LEGACY, but is the RLS key
          (id, name, …)           players.player_lineage_id  ⚠ write-only, 45% NULL
             │
             │ 1:N  player_teams (player_id, team_id, season_id, joined_on, left_on)   ← real relationship layer
             ▼
           teams ──► seasons
             │
             └─ 1:N  tags (team_id, player_id, category='players')  [UQ (team_id, player_id)]
                        │
                        └─ clip_tags (tag_id, clip_id, bundle_number) ──► clips ──► videos ──► games
```

### 2.6 RLS on the identity tables (live policy expressions) **FACT**

| table | cmd | expression |
|---|---|---|
| `players` | SELECT | `is_super_admin() OR is_team_member(team_id) OR is_linked_parent(id)` |
| `players` | INSERT/UPDATE/DELETE | `is_team_coach(team_id) OR is_super_admin()` |
| `player_teams` | SELECT | `is_super_admin() OR is_team_member(team_id) OR is_linked_parent(player_id)` |
| `player_teams` | INSERT/UPDATE/DELETE | **no policy → writes only via SECURITY DEFINER RPCs** |
| `parent_player_links` | SELECT | `is_super_admin() OR parent_user_id = auth.uid() OR coach of players.team_id` |
| `parent_player_links` | INSERT | `is_super_admin() OR coach of players.team_id` ⚠ see F14 |
| `parent_player_links` | UPDATE | own row, or coach of `players.team_id` |
| `parent_player_links` | DELETE | `is_super_admin() OR coach of players.team_id` (a parent cannot self-unlink directly; `remove_guardian` RPC covers it) |
| `tags` | SELECT | `scope='global' OR is_team_member(team_id) OR is_super_admin() OR can_read_team_tag(team_id, category)` |
| `game_lineups` | SELECT | team member, or `is_linked_parent(player_id) AND is_roster_film_parent(game_id)` |
| `player_guardian_codes` | SELECT | `is_super_admin() OR is_linked_parent(player_id)` |

Helpers: `is_team_member(t)` / `is_team_coach(t)` require `status='confirmed' AND left_on IS NULL`;
`is_linked_parent(p)` = a row in `parent_player_links` for `auth.uid()`. All SECURITY DEFINER, `search_path` pinned. **FACT**

---

## 3. PLAYER CREATION MAP

Every path that can produce a `players` row. **FACT** (traced; no other insert path exists — RLS gives `players`
INSERT only to a coach of `players.team_id`, so every non-coach path must be a SECURITY DEFINER RPC, and there
are exactly three.)

| # | Creation path | User type | Screen / function | players row | player_teams | parent link | guardian code | Risks |
|---|---|---|---|---|---|---|---|---|
| 1 | `create_kid(name)` | parent | [select-team.tsx:314](../app/select-team.tsx#L314) "Add a kid" | ✅ teamless | ❌ | ✅ `'parent'` | ✅ 6-char | **BROKEN TODAY (F1).** No dedupe, not idempotent — double-tap = 2 kids |
| 2 | `create_kid` + `join_team_with_code` | parent | [join-team.tsx:77-79](../app/join-team.tsx#L77) "Add & join" | ✅ | ✅ | ✅ | ✅ | **BROKEN TODAY (F1).** Two RPCs, not atomic: kid can be created and then fail to join |
| 3 | `create_roster_placeholder(team, name, jersey)` | coach | [roster.tsx:197](../app/(tabs)/roster.tsx#L197) "Add player" | ✅ team-stamped | ✅ | ❌ | ✅ 8-char | **The duplicate factory.** No check against existing players/lineages; coach can add the same kid twice |
| 4 | `claim_roster_spot(code, player_id)` | parent | [join-team.tsx:58](../app/join-team.tsx#L58) | ❌ (links to #3's row) | ❌ | ✅ `'parent'` | — | **Creates the duplicate *identity*** by linking the parent to a second row for a child they already have |
| 5 | `join_team_with_code(code, player_id)` | parent | [join-team.tsx:67](../app/join-team.tsx#L67) | ❌ | ✅ | ❌ (requires existing) | — | The one *correct* reuse path. Side effect: stamps `players.team_id` if null |
| 6 | `attach_kid_to_team(player, team, jersey)` | coach | [kid.tsx:279](../app/kid.tsx#L279) | ❌ | ✅ upsert | ❌ | — | Idempotent. But rewrites the chip label with the naive formula (F9) |
| 7 | `claim_or_link_guardian(code)` | 2nd adult | [claim-kid.tsx:56](../app/claim-kid.tsx#L56) | ❌ | ❌ | ✅ `'guardian'` | — | Correct. Also back-fills `parent` memberships on all the kid's current teams |
| 8 | `merge_players(keep, dup)` | coach/guardian-of-both/super | [roster.tsx:168](../app/(tabs)/roster.tsx#L168) | **deletes one** | repoints | repoints | cascades away | F5 — cascade data loss |

**Do different pathways create fundamentally different identity behavior? Yes.** Paths 1/2 make a *child*;
path 3 makes a *roster slot*; path 4 turns a roster slot into a *claimed child* without consulting the
parent's existing children. Three different meanings for one table. **FACT**

### F1 — `create_kid` is broken in production **FACT · CRITICAL**

The live function body is:

```sql
insert into players (name, team_id, user_id) values (clean_name, null, null) returning id into new_id;
```
(verified via `pg_get_functiondef` on the live DB)

`players.user_id` no longer exists — dropped by `migration_close_kid_login_doors.sql:36`, confirmed absent from
`information_schema.columns`. plpgsql resolves column names at execution, so **every call raises
`42703: column "user_id" of relation "players" does not exist`.**

Both callers surface it as an error alert and do nothing:
- [app/select-team.tsx:314](../app/select-team.tsx#L314) — "Add a kid" on the app home
- [app/join-team.tsx:77](../app/join-team.tsx#L77) — "Add & join" in the parent join flow
- Also reachable from [onboarding.tsx:71](../app/onboarding.tsx#L71) → `/select-team?action=newkid`

Corroborating evidence: the newest teamless player was created **2026-08-24**; the kid-login-doors work is dated
2026-09-02 in CLAUDE.md. No teamless child has been created since the column was dropped. **INFERENCE** (dates
line up; not proof of causation, but the runtime failure above is proof enough on its own).

Also worth noting: `migration_close_kid_login_doors.sql` is **not** in `supabase_migrations.schema_migrations`,
i.e. it was applied by hand in the SQL editor. **FACT** — repo↔live ledger drift.

---

## 4. CURRENT CLAIM / INVITE FLOWS (end-to-end)

### 4.A Parent joins a team with the team join code — the primary path

1. **User** opens `/join-team` (or types any code in `/onboarding`, which calls `resolve_any_code` and routes
   `type='team'` → `/join-team?code=…`). **FACT**
2. **Frontend** → `preview_roster_by_code(p_code)`. **FACT**
3. **RPC** (SECURITY DEFINER, no auth beyond "logged in"): looks up `teams.join_code`, checks
   `join_code_expires_at`, and returns **every** roster row as
   `{player_id, first_name: split_part(name,' ',1), jersey, claimed: exists(parent_player_links)}`.
   *Note: it reads `player_teams` with no `left_on` filter, so kids who have left the team are still listed.* **FACT**
4. **Rows queried:** `teams`, `player_teams`, `players`, `parent_player_links`.
5. **User taps a first name** → `claim_roster_spot(code, player_id)`:
   - re-validates the code; requires an **open** `player_teams` spell for that player on that team;
   - `perform 1 from players where id = p_player_id for update` (row lock — this path is race-safe);
   - **rejects if ANY parent link already exists** → "already claimed";
   - `insert into parent_player_links (uid, player_id, 'parent')`;
   - `insert into team_memberships (team, uid, 'parent', 'confirmed') on conflict do nothing`.
6. **Permissions checked:** team code validity + roster membership. **No check of the caller's existing children.**
7. **Result:** adult → *the coach's row*. If the adult already had a row for that human, there are now two. **FACT**

### 4.B Parent attaches an existing child — the correct path, but secondary

Same steps 1-4. Then the parent must tap the text link **"My player isn't listed"**
([join-team.tsx:140](../app/join-team.tsx#L140)) to reveal `myKidsNotHere` — `userKids` filtered to kids whose
`player_id` isn't already on that roster ([join-team.tsx:85-87](../app/join-team.tsx#L85)). Tapping one calls
`join_team_with_code(code, playerId)`, which verifies guardianship, inserts the `player_teams` spell
(`on conflict … do nothing`), stamps `players.team_id` if null, and upserts the `parent` membership. **FACT**

This is the only flow that produces the intended "one child, many teams" outcome — and it is **below** the
roster list, behind a link, with "Or add a new player" immediately under it.

### 4.C Second adult (co-parent / grandparent)

`/claim-kid` → `preview_guardian_code(code)` returns `{player_id, first_name, guardian_count, already_mine,
full, has_seat, can_buy_seat}` → `claim_or_link_guardian(code)` locks the player row, enforces the 4-guardian cap
(unless a live `player_guardian_seats` row exists), inserts the link as `'guardian'` (or `'parent'` if first),
notifies existing guardians, then upserts `parent` memberships for every **open** team spell. **FACT**
This flow is correct and race-safe.

### 4.D Coach invites a family

Coach shares the per-player 8-char code from `player_guardian_codes` ([roster.tsx:270](../app/(tabs)/roster.tsx#L270)
`regenerate_guardian_code`) or the team join code. There is **no invitations table** — codes *are* the invitation
system, so there is no per-invite target, no expiry per adult, and no record of who was invited. **FACT**

---

## 5. CROSS-TEAM TEST — "Adam is linked to Lars (PLAYER_A) on Basketball Team A; Football Team B now exists"

**Answer: D — behaviour depends entirely on which path Adam takes, and two of the three paths produce a duplicate.** **FACT**

| Path Adam takes | What actually happens |
|---|---|
| Team B's coach has **not** rostered Lars; Adam uses `/join-team` → "My player isn't listed" → taps **Lars** | ✅ **Outcome A.** `join_team_with_code` adds a `player_teams` spell for PLAYER_A on Team B. `ensure_player_tag` mints a *second*, team-scoped chip for the same `player_id`. One identity, two teams. |
| Team B's coach **has** rostered "Lars" as a placeholder (PLAYER_B); Adam taps that name in the roster list | ❌ **Outcome C.** `claim_roster_spot` links Adam to **PLAYER_B**. Adam now has two "Lars Masten" entries in his kid rail; Lars's Team A film stays on PLAYER_A, Team B film accrues on PLAYER_B. Nothing warns him, nothing offers PLAYER_A. |
| Adam uses "Or add a new player" and retypes the name | ❌ **Outcome B** — would create PLAYER_C. *Currently this simply errors out* (F1). |

**Live proof that outcome A works:** `e34c2405` "Lars Masten" → `player_teams` on `ca9ab2bb` (Centex Attack
Regents, joined 2026-08-13) **and** `07e44046` (Centex2026 6th Grade, joined 2026-06-10); two chips both named
"Lars"; 36 + 44 tagged clips. **FACT**

**Live proof that outcome C happens:** `f3924843` "Lars Masten" — 0 teams, 0 clips, linked to `smmasten@gmail.com`
as `'parent'`; the same adult is also linked to `e34c2405` as `'guardian'`. One human, two rows, one adult holding
both. Same pattern for `aaronfcastillo@gmail.com`: linked to both "Neo" (`8be773b5`, 16 clips) and
"Neo Castillo" (`2f7540e9`, 0 clips). **FACT**

### F2 — the legacy `players.team_id` breaks the cross-team case that *does* work **FACT · CRITICAL**

`players_read = is_super_admin() OR is_team_member(team_id) OR is_linked_parent(id)`.
`join_team_with_code` only sets `players.team_id` when it is null, so a multi-team child's `team_id` is
permanently the **first** team. Consequence for a coach of the **second** team who is not a member of the first:

- [roster.tsx:87-89](../app/(tabs)/roster.tsx#L87) selects `player_teams → players ( id, name )`. The nested
  read is filtered by `players_read` → returns `null` → [roster.tsx:115](../app/(tabs)/roster.tsx#L115) maps it to
  **`'Unnamed'`**. The kid appears on the roster as *Unnamed*. **FACT**
- [box-score.tsx:178-184](../app/box-score.tsx#L178) does the same select and then `.filter(r => r.players)` →
  the kid **vanishes from the box score** for that coach. **FACT**
- `players_update` / `players_delete` are also `is_team_coach(team_id)` → the second team's coach cannot rename or
  remove that child. `parent_player_links` INSERT/DELETE are likewise gated on `players.team_id`, so a coach of the
  second team cannot add or remove a guardian. **FACT**

Lars `e34c2405` has `team_id = 07e44046`, so any coach of `ca9ab2bb` who is not also on `07e44046` sees him as
"Unnamed" today. Adam is a member of both, which is why this has stayed invisible. **FACT / INFERENCE on the
"why invisible" half.**

---

## 6. COACH-CREATED PLAYER TEST — PLAYER_B already has history

**Exactly what happens today: the app links Adam to PLAYER_B, does not recognise PLAYER_A, never offers it, and
never suggests a merge.** **FACT**

Trace, with files:
1. Coach runs `create_roster_placeholder('Lars', '12')` → PLAYER_B with `team_id = TeamB`, a `player_teams` spell,
   an 8-char guardian code, and (via `ensure_player_tag`) a chip `"Lars #12"` carrying `player_id = PLAYER_B`.
   Tagging then accrues `clip_tags` → `sync_lineup_from_clip_tag` writes `game_lineups` rows for PLAYER_B; games
   created later snapshot PLAYER_B into lineups via `snapshot_game_lineup`. **FACT**
2. Adam opens `/join-team`, enters the team code → `preview_roster_by_code` returns `first_name: 'Lars'`,
   `claimed: false`. **FACT**
3. Adam taps it → `claim_roster_spot` → link to **PLAYER_B**. **FACT**
4. `suggest_duplicate_players` will **not** flag PLAYER_A vs PLAYER_B, because it only compares players who share
   a team (`join player_teams tb on tb.team_id = ta.team_id`) — and PLAYER_A is on a different team. **FACT**
5. Result: Adam's kid rail ([context.tsx:148](../context.tsx#L148) — a flat `parent_player_links → players` read
   with **no lineage grouping and no dedupe**) shows "Lars Masten" twice. Film, clips, lineups and stats stay
   split by `player_id` forever. **FACT**

**Nothing in the product recognises PLAYER_A at this moment.** There is no "is this one of your existing children?"
step anywhere in the codebase. The nearest thing — the `myKidsNotHere` list — is only reachable by *declining* the
roster list, and it is never shown alongside a roster name.

**Live proof, on Adam's own family:** four `players` rows named "Conrad Masten" **FACT**

| player_id | legacy team | roster spells | guardians | videos | lineups | tagged clips | chip |
|---|---|---|---|---|---|---|---|
| `1b95a1c4` | Centex2026 6th Grade | Centex Attack Bobby | 2 (adammasten@, smmasten@) | 5 | 6 | 26 | "Conrad" ×2 teams |
| `045968e6` | Legends 2036 | Legends 2036 | **0** | 0 | 2 | **21** | "Conrad #32" |
| `25411e20` | Regents Bangels 3rd | Regents Bangels 3rd | **0** | 0 | 3 | **11** | "Conrad" |
| `4637e2d0` | — (teamless) | none | 1 (smmasten@) | 0 | 0 | 0 | — |

32 tagged clips of Conrad sit on identities with **no guardian at all**. No parent path reaches them. **FACT**

---

## 7. PARENT / GUARDIAN AUTHORIZATION MODEL

**How the system knows "this adult is authorized for this child":** a row in `parent_player_links`. That is the
single source of truth, and it is checked through `is_linked_parent(player_id)` or an inline
`exists (select 1 from parent_player_links …)`. **FACT**

The resolution chain, verified in the live function bodies:

```
auth.uid()
  └─ parent_player_links.parent_user_id
       └─ player_id                                   ← the security boundary
            ├─ direct:  videos.player_id  ·  shares.target_player_id  ·  players.photo_path
            ├─ tags.player_id → clip_tags → clips     (clip_involves_my_kid)
            └─ player_teams (spell window)            (is_roster_parent → is_roster_film_parent)
                 └─ games.team_id / seasons
```

- `authorize_video_playback(video)`: super admin → uploader → team visibility → `can_tag_video` →
  **`v.player_id` + linked parent** → **`is_roster_film_parent(game_id)`** → a matching `shares` row
  (`audience='player'` resolves through `parent_player_links` too). **FACT**
- `is_roster_parent(game)` is the generous, correct one — three branches: an open/овerlapping `player_teams` spell
  covering `games.game_date`, OR a `game_lineups` row, OR a season-pinned spell. Gated by
  `teams.parent_film_visible` in `is_roster_film_parent`. **FACT**
- `authorize_reel_playback` / `is_roster_reel_parent` / `is_roster_share_parent` / `authorize_photo_view`:
  same shape. `authorize_photo_view` additionally grants any **member of any team the child is on**. **FACT**
- `game_lineups_read` grants a parent `is_linked_parent(player_id) AND is_roster_film_parent(game_id)`. **FACT**

**Nothing in the authorization chain reads `player_lineage_id`.** **FACT** — so linking two rows as "the same human"
grants exactly zero additional access today.

### F4 — duplicate identities cost a legitimate parent access to their own child's film **FACT · CRITICAL**

Because access is `player_id`-exact:
- Adam is linked to Conrad `1b95a1c4`. He is **not** linked to `045968e6` or `25411e20`. For those 32 clips,
  `clip_involves_my_kid` is false and `v.player_id`/`shares.target_player_id` don't match. He only sees that film
  through his **coach/team membership**, not as a parent — and a non-coach parent in the same situation sees nothing.
- `smmasten@gmail.com`'s kid rail today lists **Conrad Masten twice and Lars Masten twice**, and the second entry
  of each pair is an empty shell (0 teams, 0 clips). **FACT**
- The reverse is also true and worse: any *wrong* link grants full parent access — film, clips, photo, wall,
  notifications, schedule — to another family's child. There is no confirmation step on the other family's side.

### F14 — a coach can link an arbitrary adult to a child **FACT · HIGH (latent)**

`parent_player_links_insert` WITH CHECK is
`is_super_admin() OR exists (select 1 from players p where p.id = parent_player_links.player_id and is_team_coach(p.team_id))`.
There is **no requirement that `parent_user_id = auth.uid()`**. A coach of the child's legacy team can therefore
insert a guardian link for **any** user id, granting that account permanent parent-level access to that child.
No current app code does this (all links go through the RPCs), so this is a latent hole rather than a live leak. **FACT**

---

## 8. DUPLICATE / MERGE AUDIT — the false-positive you saw

**Found it.** It is `suggest_duplicate_players`, surfaced as a banner on the Roster tab. It is *not* the
player-chip duplicate-name work (that is `player_chip_label`, §10) — they were built for the same symptom but are
different mechanisms.

1. **Files:** [app/(tabs)/roster.tsx](../app/(tabs)/roster.tsx) — state `dupes` (L56), fetch (L128), banner
   (L452-459), chooser `mergeDupe`/`chooseKeep` (L136-165), execution `doMerge` (L168), recommendation
   `recommendedKeep` (L186), side summary `sideMeta` (L178).
2. **Components:** the `dupes.length > 0` banner + the `mergePair` modal chooser. No separate component file.
3. **Functions:** DB `public.suggest_duplicate_players(p_team_id uuid)` and `public.merge_players(p_keep, p_dup)`.
   Repo: `migration_merge_players.sql`, superseded by `migration_merge_dupe_counts.sql`.
4. **Matching algorithm** (live, verbatim predicate):
   ```sql
   where ta.team_id = p_team_id and pa.id < pb.id
     and ( similarity(pa.name, pb.name) > 0.3
           or lower(split_part(pa.name,' ',1)) = lower(split_part(pb.name,' ',1)) )
   ```
   pg_trgm similarity on the **whole name string**, **OR exact first-name equality**. Scoped to players who
   share a team.
5. **Fields compared:** `players.name` only.
6. **first name → YES.** It is an explicit equality branch. **FACT**
7. **full name → YES** (trigram).
8. **DOB → no** (no such column).
9. **parent relationship → no.** (`migration_merge_dupe_counts.sql` added guardian *counts* for the chooser, but
   guardianship is not part of the match.)
10. **team → yes, as a filter** (both must be on `p_team_id`) — which is why it misses every real duplicate.
11. **jersey → no.**
12. **nickname → no** (no such column).
13. **UI only, or changes data?** The suggestion is read-only. The **merge is real and destructive** — see F5.
14. **Does a merge operation exist?** Yes: `merge_players`, coach/guardian-of-both/super-admin gated, transactional.
15. **Dismissal?** **None.** There is no dismiss affordance, no state, no table.
16. **Does dismissal persist?** N/A — nothing to persist.
17. **Why it keeps coming back:** [roster.tsx:195](../app/(tabs)/roster.tsx#L195)
    `useFocusEffect(useCallback(() => { load(); }, [load]))` re-runs `load()` on **every focus** of the Roster tab,
    and `load()` unconditionally re-calls `suggest_duplicate_players` (L128). With no negative-match store, the
    same pair is recomputed and re-rendered forever. **FACT**

### What it returns on your live data — right now

Replicating the exact predicate across all teams (read-only), the **entire** current output is one pair: **FACT**

| team | A | B | similarity | triggered by | share a guardian? |
|---|---|---|---|---|---|
| Regents Bangels 3rd Grade 2026 | Jackson Schneider `00195563` | Jackson Tochman `b8c7c29b` | 0.31 | **first-name equality** | no |

Two unmistakably different children, flagged solely because both are named Jackson — and offered a **destructive,
irreversible "Combine"** button. That is the bug you remembered.

**And the mirror image:** every genuine duplicate in your database is **not** suggested, because the pairs live on
different teams: Conrad ×4, Lars ×2, Tommy Allen ×2, Neo/Neo Castillo. The suggester is currently 0-for-9 on true
positives and 1-for-1 on false positives. **FACT**

### F5 — `merge_players` loses history via `ON DELETE CASCADE` **FACT · HIGH**

The function repoints **7** dependents (`videos`, `shares`, `game_lineups`, `player_teams`,
`parent_player_links`, `team_player_permissions`, `tags`+`clip_tags`), copies `player_lineage_id` if the keeper
lacks one, writes one `admin_audit_log` row, then `delete from players where id = p_dup`. The delete cascades:

| dependent | FK delete rule | handled by merge? | consequence of a merge today |
|---|---|---|---|
| `event_attendance` | **CASCADE** | ❌ | RSVP history deleted (0 rows live) |
| `game_stat_lines` | **CASCADE** | ❌ | **manual box-score stats deleted** (0 rows live) |
| `notifications.target_player_id` | **CASCADE** | ❌ | notification history deleted (**10 rows live**) |
| `player_guardian_codes` | **CASCADE** | ❌ | code deleted (acceptable; unique per player) |
| `player_guardian_seats` | **CASCADE** | ❌ | **a purchased guardian seat is destroyed** (0 rows live) |
| `followers` | **CASCADE** | ❌ | reserved table, 0 rows |
| `event_snack_signups` | SET NULL | ❌ | signup orphaned to "team" |
| `parent_player_links` | RESTRICT | ✅ repointed first | safe |

Plus: no reversibility, no alias/tombstone (so any external/cached reference to the dead `player_id` dangles),
and the `admin_audit_log.detail` records only `{kept, merged}` — not enough to reconstruct what moved. **FACT**

---

## 9. NICKNAME / DISPLAY-NAME AUDIT

**Current state: `players.name text NOT NULL` and nothing else.** No `first_name`, `last_name`, `display_name`,
`nickname`, `preferred_name`, or legal-name field. **FACT**

Everything that needs a first name computes `split_part(name, ' ', 1)` and everything that needs a last initial
computes `split_part(name, ' ', 2)`. This appears in at least: `player_chip_label`, `ensure_player_tag`,
`attach_kid_to_team`, `update_kid_profile`, `preview_roster_by_code`, `preview_guardian_code`, `resolve_any_code`. **FACT**

Consequences, all **FACT**:
- "William Jackson Smith" → first name "William", last initial "J." (the *middle* name) — wrong.
- A single-token name ("Austin", "Will", "Max") has no last initial at all, so the disambiguator falls through to
  jersey, then to a numeric suffix.
- A number-only roster spot is stored as `name = '#12'` (`create_roster_placeholder`), i.e. the name column doubles
  as a sentinel — `player_chip_label` and `ensure_player_tag` both special-case `like '#%'`.
- There is no way to show "Will" on the board while keeping "William Jackson Smith" on the profile.

**RECOMMENDATION (smallest clean addition):** three nullable columns on `players` —
`first_name text`, `last_name text`, `preferred_name text` — keep `name` as the display fallback and the
already-written legal/full name, and change the *derivation* order to
`preferred_name → first_name → split_part(name,' ',1)`. Do not add a `display_name`; that is what the chip label
is. Backfill by splitting `name` on the first space, leaving `name` untouched. Never let any of them participate
in identity resolution — see §15.

---

## 10. PLAYER TAG IDENTITY AUDIT

**Roster-generated chips carry a real `player_id`: CONFIRMED.** 41 player tags live, **0** with a null
`player_id`. **FACT**

- `uq_tags_team_player` — `UNIQUE (team_id, player_id) WHERE category='players' AND player_id IS NOT NULL`.
  One chip per player per team; the same `player_id` legitimately holds a *different* chip on each team. **FACT**
- `ensure_player_tag()` fires `AFTER INSERT ON player_teams`, so every roster-add path funnels through it
  (`create_roster_placeholder`, `join_team_with_code`, `attach_kid_to_team`, `claim_roster_spot`'s prerequisite). **FACT**
- `reject_unlinked_player_tag()` fires `BEFORE INSERT ON tags` and raises `23514` for
  `category='players' AND player_id IS NULL` — **manual creation of an identity-less player tag is blocked at the
  database**, for every client including installed builds. **FACT**
- **Labels are display-only: CONFIRMED.** `make-highlight`, `export`'s bundle matcher,
  `sync_lineup_from_clip_tag`, `clip_involves_my_kid` and `tagger_player_tags` all key on `tags.player_id` or
  `tags.id`. Renaming a chip changes nothing about identity. **FACT**
  (One exception at the stats layer — see F8.)
- **Same child, different labels per team, one identity: CONFIRMED live.** Lars `e34c2405` → "Lars" on
  `ca9ab2bb` and "Lars" on `07e44046`; Conrad `1b95a1c4` → "Conrad" on two teams; `045968e6` → "Conrad #32". **FACT**

### The actual fallback order in `player_chip_label(p_team, p_player, p_jersey)` **FACT**

```
1. name starts with '#'                        → the name as-is                    ("#12")
2. no other chip on this team shares the first name
                                               → "First"  + " #jersey" if jersey    ("Conrad", "Conrad #32")
3. a peer shares the first name, and this kid's last initial is unique among those peers
                                               → "First L."                         ("Jackson S.")
4. otherwise, jersey present                   → "First #jersey"                     ("Will #12")
5. otherwise                                   → "First N", N incrementing until unique ("Will 1", "Will 2")
```
Peers are counted from the team's existing **chips** (`tags` joined to `players`), not from roster membership.
`ensure_player_tag` additionally re-labels *all* same-first-name chips on the team after an insert, so adding the
second Jackson relabels the first. **FACT**

### F9 — two paths bypass the disambiguator **FACT · MEDIUM**

`attach_kid_to_team` and `update_kid_profile` both rewrite the chip with the older, naive formula:

```sql
name = case when split_part(p.name,' ',1) like '#%' then split_part(p.name,' ',1)
            else split_part(p.name,' ',1) || coalesce(' #' || nullif(trim(jersey),''), '') end
```

No peer check. So renaming a kid, or attaching/re-jerseying a kid, can collapse "Jackson S." back to "Jackson" and
reintroduce two identical chips on one team. **FACT**

Live labels `"JS"` and `"Tochman Jackson"` on the Regents Bangels team match no formula in the codebase; per
`supabase/migrations/20260922130040_player_tag_disambiguation.sql`'s own header, the pre-fix workaround was
hand-creating chips on My Tags (which then carried no `player_id` and silently dropped kids out of lineups/box
score). These two were evidently hand-made and later linked to a `player_id`. **INFERENCE.**

---

## 11. COMPLETE PLAYER-ID REFERENCE MAP

### 11.1 Declared foreign keys to `players.id` — all 14 **FACT** (`pg_constraint`, live)

| # | reference | type | FK | ON DELETE | ON UPDATE | merge impact | notes |
|---|---|---|---|---|---|---|---|
| 1 | `parent_player_links.player_id` | uuid | ✅ | **RESTRICT** | NO ACTION | must be repointed *first* or the delete fails | ✅ handled |
| 2 | `player_teams.player_id` | uuid | ✅ | CASCADE | NO ACTION | repoint, dedupe on `(player_id, team_id) WHERE left_on IS NULL` | ✅ handled |
| 3 | `tags.player_id` | uuid | ✅ | **SET NULL** | NO ACTION | must repoint *and* fold `clip_tags` onto the keeper's chip | ✅ handled; a raw player delete would leave a `player_id`-less chip that the trigger would have rejected on insert |
| 4 | `game_lineups.player_id` | uuid | ✅ | SET NULL | NO ACTION | repoint, dedupe on PK `(game_id, player_id)` | ✅ handled |
| 5 | `videos.player_id` | uuid | ✅ | SET NULL | NO ACTION | repoint | ✅ handled (6 rows live) |
| 6 | `shares.target_player_id` | uuid | ✅ | CASCADE | NO ACTION | repoint | ✅ handled (3 rows live) |
| 7 | `team_player_permissions.player_id` | uuid | ✅ | CASCADE | NO ACTION | repoint, dedupe on `(team, player, permission)` | ✅ handled (0 rows) |
| 8 | `game_stat_lines.player_id` | uuid | ✅ | **CASCADE** | NO ACTION | **must repoint — cascade destroys manual stats** | ❌ **unhandled** (0 rows) |
| 9 | `event_attendance.player_id` | uuid | ✅ | **CASCADE** | NO ACTION | must repoint; UQ `(event_id, player_id)` | ❌ **unhandled** (0 rows) |
| 10 | `event_snack_signups.player_id` | uuid | ✅ | SET NULL | NO ACTION | should repoint | ❌ unhandled (0 rows) |
| 11 | `notifications.target_player_id` | uuid | ✅ | **CASCADE** | NO ACTION | should repoint | ❌ **unhandled (10 rows live)** |
| 12 | `player_guardian_codes.player_id` | uuid | ✅ (PK) | **CASCADE** | NO ACTION | one code per player — decide keeper's code, revoke the other | ❌ unhandled |
| 13 | `player_guardian_seats.player_id` | uuid | ✅ | **CASCADE** | NO ACTION | **must repoint — a paid seat is destroyed** | ❌ **unhandled** (0 rows) |
| 14 | `followers.player_id` | uuid | ✅ | **CASCADE** | NO ACTION | reserved table — don't wire, but a merge must not silently empty it | ❌ unhandled (0 rows) |

### 11.2 Logical (non-FK) references **FACT**

| reference | kind | keyed on | merge impact |
|---|---|---|---|
| `stat_events` (view) | view over `clip_tags`+`tags` | `tags.player_id` + `tags.name` | follows the tags repoint automatically |
| `game_box_score` (view) | view over `stat_events` | groups incl. `player_id`, **displays `player_name`** | label-sensitive display (F8) |
| `resolved_game_stats` (view) | `game_stat_lines` ∪ `game_box_score` | matches sides on `player_id` | safe once #8 is repointed |
| `season_player_stats` (view) | view over `stat_events`, `game_lineups` | **`player_name` text only — no `player_id`** | **F8: name-keyed stats** |
| `set_game_lineup(p_game_id, uuid[])` | RPC | `player_id[]` array param | ephemeral; validates each id against `player_teams` |
| `highlight_reels.source_clip_ids` | uuid[] | clip ids, **not** player ids | no impact |
| `admin_audit_log.detail` | jsonb | `{kept, merged}` player ids from merges | historical record only; 0 rows currently mention a player |
| `notification_outbox.payload`, `schedule_notifications.data` | jsonb | scanned: **0 rows contain a player key** | no impact today |
| Edge Functions | `supabase/functions/*` | only `sign-media` mentions "player", via `authorize_photo_view(p_player_id)` | no stored player ids |
| Railway ffmpeg service | external | receives `{url, start_time, end_time}` only | **no player ids leave the DB** |
| `lib/core/homeFeed.ts:60`, `app/make-highlight.tsx:106` | client | `players.select('id,name').in('id', …)` | display only |

**No `player_id` is stored in any JSON column, array column, cache, queue job, AI table, or export structure
today.** There are no AI / player-recognition tables in the schema. **FACT**

### 11.3 RLS policies and functions that gate on player identity **FACT**

Policies: `players_read/insert/update/delete`, `player_teams_read`, `parent_player_links_read/insert/update/delete`,
`player_guardian_codes_read`, `player_guardian_seats_read`, `game_lineups_read/insert/delete`, `tags_*`.
Functions (52 identity-adjacent; the load-bearing ones): `is_linked_parent`, `is_primary_guardian`,
`is_roster_parent`, `is_roster_film_parent`, `is_roster_reel_parent`, `is_roster_share_parent`,
`clip_involves_my_kid`, `was_on_roster`, `can_link_player`, `authorize_video_playback`, `authorize_reel_playback`,
`authorize_photo_view`, `kid_guardians`, `kid_team_audience`, `list_player_guardians`, `roster_for_season`,
`close_orphaned_parent_memberships`, `remove_guardian`, `grant_guardian_seat`, `merge_players`, `link_players`,
`unlink_player`, `suggest_duplicate_players`, `player_chip_label`, `ensure_player_tag`,
`reject_unlinked_player_tag`, `sync_lineup_from_clip_tag`, `snapshot_game_lineup`, `set_game_lineup`,
`create_kid`, `create_roster_placeholder`, `claim_roster_spot`, `claim_or_link_guardian`, `join_team_with_code`,
`attach_kid_to_team`, `remove_roster_placeholder`, `leave_team`, `update_kid`, `update_kid_profile`,
`set_kid_photo`, `preview_roster_by_code`, `preview_guardian_code`, `resolve_any_code`,
`revoke_guardian_seat_on_unlink`, `prune_future_lineups_on_leave`, `sync_player_teams_left_at`.
Triggers touching identity: `on_player_teams_insert`, `trg_prune_future_lineups`,
`trg_sync_player_teams_left_at`, `trg_reject_unlinked_player_tag`, `trg_revoke_guardian_seat`,
`trg_sync_lineup_from_clip_tag`, `on_games_insert`.

---

## 12. LIVE DATA AUDIT (read-only)

| # | check | result |
|---|---|---|
| 1 | total `players` | **49** |
| 2 | players on >1 team | **1** (Lars `e34c2405`) |
| 3 | players in >1 season | **0** (`player_teams.season_id` is NULL on every row) |
| 4 | parents linked to >1 player | **3** |
| 5 | players linked to >1 adult | **2** (`e34c2405` Lars ×3, `1b95a1c4` Conrad ×2) |
| 6 | same-**full**-name player pairs | **12** pairs |
| 7 | likely-duplicate records | **4 candidate groups** (below) |
| 8 | same-name players who are clearly different people | **≥3** (Jackson S./Jackson T.; Will/Will; Henry/Henry, Max/Max, Austin/Austin across teams) |
| 9 | parent accounts linked to multiple apparent copies of one child | **3 adults** — `smmasten@` (Conrad ×2 **and** Lars ×2), `aaronfcastillo@` (Neo ×2) |
| 10 | orphan players (no team **and** no guardian) | **6** |
| 11 | players with no `player_teams` row | **10** |
| 12 | `player_teams` rows whose player's legacy `team_id` points elsewhere | **1** |
| 13 | player tags missing `player_id` | **0** ✅ |
| 14 | duplicate player tags for one (team, player) | **0** ✅ (blocked by `uq_tags_team_player`) |
| 15 | player tags for a player not on that team's roster | **1** — chip "Conrad" on `07e44046` for `1b95a1c4`, who has no `player_teams` row for that team |
| 16 | guardian links to players with no roster anywhere | **4** (the teamless kids) |
| 17 | duplicate `team_memberships` | **0** ✅ |
| 18 | name-based identity assumptions in DB code | **3** — `suggest_duplicate_players` (first-name equality), `season_player_stats` (groups by name), `game_box_score` (displays `player_name`) |
| 19 | history rows referencing missing players | **0** ✅ (FKs hold; `parent_player_links` is RESTRICT) |
| 20 | other anomalies | `players.player_lineage_id` **NULL on 22/49**; `players.team_id` set but no matching `player_teams` row on **7**; `migration_close_kid_login_doors.sql` absent from `schema_migrations` |

### Duplicate candidates — **candidates only; names are not proof**

| candidate group | rows | why a candidate | why not certain |
|---|---|---|---|
| **Conrad Masten** | `1b95a1c4`, `045968e6`, `25411e20`, `4637e2d0` | identical full name; `1b95a1c4` + `4637e2d0` share guardian `smmasten@`; all four on Adam's own teams; the two unguarded rows are on teams Adam coaches | three different teams could plausibly hold three different Conrad Mastens — only Adam knows |
| **Lars Masten** | `e34c2405`, `f3924843` | identical full name; **both linked to the same adult** (`smmasten@`), one as parent one as guardian; `f3924843` is an empty shell | the empty row could in principle be a different child never rostered |
| **Tommy Allen** | `0475cd77`, `2844aaa8` | identical full name; `0475cd77` teamless + guardian `tallen@practicetransitions…`; `2844aaa8` rostered on Regents Bangels with 5 tagged clips — the classic parent-created + coach-placeholder pair | different guardians (one has none) |
| **Neo** | `2f7540e9` "Neo Castillo", `8be773b5` "Neo" | **same guardian** `aaronfcastillo@` on both; one is an empty shell, the other has 16 clips | names differ (one has a surname) |

**Explicitly NOT duplicates** (different children who merely share a first name): Jackson Schneider /
Jackson Tochman; Will `452f3fa6` / Will `ec94088b`; Henry `8666b71e` / Henry `d99ef299`; Max `0e92a2ee` /
Max `1bbcbb28`; Austin `6af148c8` / Austin `c8eab819`. **INFERENCE** (different teams/rosters with independent
clip histories; the Jacksons have distinct surnames on one roster).
Note `Max 0e92a2ee` and `Max 1bbcbb28` **already share a lineage id** — someone linked them via
`/link-players`. That may be correct or may be a mis-link; it grants nothing today either way. **FACT**

### SQL used (representative)

```sql
-- 2/3/11: multi-team, multi-season, no-roster
with pt as (select player_id, count(distinct team_id) t, count(distinct season_id) s
            from player_teams group by 1)
select (select count(*) from pt where t>1), (select count(*) from pt where s>1),
       (select count(*) from players p where not exists
          (select 1 from player_teams x where x.player_id=p.id));

-- 8/18: exactly what suggest_duplicate_players returns today
select t.name, pa.name, pb.name, similarity(pa.name,pb.name),
       lower(split_part(pa.name,' ',1))=lower(split_part(pb.name,' ',1)) as first_name_trigger
from player_teams ta join players pa on pa.id=ta.player_id
join player_teams tb on tb.team_id=ta.team_id join players pb on pb.id=tb.player_id
join teams t on t.id=ta.team_id
where pa.id<pb.id and (similarity(pa.name,pb.name)>0.3
      or lower(split_part(pa.name,' ',1))=lower(split_part(pb.name,' ',1)));

-- 15: player chips pointing at a player who isn't on that team
select t.name, p.name from tags t join players p on p.id=t.player_id
where t.category='players' and t.player_id is not null
  and not exists (select 1 from player_teams pt
                  where pt.player_id=t.player_id and pt.team_id=t.team_id);
```

### Data-sample deep dive

- **Example A — normal:** `1bbcbb28` "Max" · 1 team (Centex Attack Regents) · 1 guardian (`jcostello1972@`) ·
  chip "Max" · 13 tagged clips · 5 lineups · 0 stat lines. Clean.
- **Example B — one child, multiple teams:** `e34c2405` "Lars Masten" · `player_teams` on `07e44046` (joined
  2026-06-10) and `ca9ab2bb` (joined 2026-08-13) · 3 guardians · 2 chips both "Lars" · 44 + 36 tagged clips ·
  8 lineups · 1 video. **This is the target architecture, working.**
- **Example C — multiple adults, one child:** `e34c2405` → `adammasten@` (`parent`), `smmasten@` (`guardian`),
  `adam@emeraldnational.com` (`guardian`). One `player_id`, three adults, no duplication. Works.
- **Example D — same first name on one roster:** Regents Bangels `ea52c5b6` — Jackson Schneider `00195563`
  (chip "JS", 7 clips, 2 lineups) and Jackson Tochman `b8c7c29b` (chip "Tochman Jackson", 5 clips, 2 lineups).
  Distinct `player_id`s, distinct clip histories, **and a standing merge suggestion between them.**
- **Example E — likely duplicate pair:** `e34c2405` (2 teams, 3 guardians, 80 clips, 1 video, 8 lineups) vs
  `f3924843` (0 teams, 1 guardian, 0 of everything). Merging these is low-risk *because* the loser is empty —
  which is exactly the case the current merge handles well. The dangerous one is Conrad: `1b95a1c4` (26 clips,
  5 videos, 2 guardians) vs `045968e6` (21 clips, 2 lineups, 0 guardians) vs `25411e20` (11 clips, 3 lineups,
  0 guardians) — three content-bearing rows, and `suggest_duplicate_players` sees none of them.

---

## 13. ACCESS CONTROL / RLS AUDIT

See §7 for the chain. The identity-specific conclusions:

**Can duplicate identities cost a legitimate parent access to their child's content? YES — and it already has.**
32 tagged clips of Conrad Masten sit on `player_id`s with no guardian link. `clip_involves_my_kid`,
`is_roster_parent`, `authorize_video_playback`'s `v.player_id` branch and `shares.target_player_id` all miss them.
Only Adam's coach membership reaches that film. **FACT · CRITICAL**

**Can an incorrect link expose another child's content? YES.** A `parent_player_links` row is unconditional
parent-level access: film (`authorize_video_playback`), reels, photos (`authorize_photo_view` — which also grants
to any member of any team the child is on), the kid's wall and inbox, `game_lineups`, guardian codes
(`player_guardian_codes_read` → `is_linked_parent`), and notifications. There is no second-party confirmation and
no audit trail on link creation. Two ways a wrong link happens today: (a) the parent taps the wrong first name in
`preview_roster_by_code` — the list shows **first name + jersey only**, so two same-first-name kids are
indistinguishable at exactly the moment a stranger is claiming one; (b) F14, a coach inserting an arbitrary
`parent_user_id`. **FACT · HIGH**

**Is identity global while visibility stays scoped?** Mostly yes, and that part is well designed: `tags` are
team-scoped, `player_teams` is spell-scoped, `roster_for_season` is season-windowed, and a coach sees a child
only through a team they're confirmed on. The exception is `players` itself — `players_read` leaks a child's row
to every confirmed member of the legacy `team_id`, including `parent` and `follower` roles, and
`authorize_photo_view` grants the photo to any member of any team the child has ever been on. Since
`players.name` + `grad_class` + `photo_path` is the whole global profile, the current leak is small — but the
moment DOB or a richer profile lands on `players`, that policy becomes the wrong shape. **FACT**

---

## 14. FAILURE MODES, RANKED BY SEVERITY

### CRITICAL

1. **`create_kid` is dead → "Add a kid" and "Add & join" both fail** (F1). A brand-new parent with no team code
   cannot create a child at all; onboarding's "Add a kid" path is a dead end. **FACT**
2. **Duplicate identity is the default outcome of the main parent flow** (F3). `claim_roster_spot` never consults
   the parent's existing children, and the reuse path is hidden. 4× Conrad, 2× Lars, 2× Tommy, 2× Neo live. **FACT**
3. **A real parent loses access to their real child's film when identity splits** (F4). 32 clips currently
   unreachable by any parent path. **FACT**
4. **`players.team_id` is still the security key** (F2) → on a second team a multi-team child renders as
   "Unnamed" on the roster, disappears from the box score, and cannot be renamed, removed, or re-guardianed by
   that team's coach. **FACT**

### HIGH

5. **`merge_players` destroys history via cascade** (F5): `game_stat_lines`, `event_attendance`,
   `notifications`, `player_guardian_seats`, `followers`. Harmless today only because four of those five tables
   are empty. It is also irreversible with no tombstone. **FACT**
6. **The duplicate suggester is name-based, un-dismissible, and inverted** (F6/§8): it offers an irreversible
   "Combine" on two different children (Jackson S. / Jackson T.) on every Roster-tab focus, and flags none of the
   nine real duplicates. **FACT**
7. **A wrong guardian link exposes another family's child**, with first-name-only disambiguation at claim time and
   no second-party confirmation. **FACT**
8. **A coach can link an arbitrary adult account to a child** (F14) — latent RLS hole, no app code uses it. **FACT**

### MEDIUM

9. **`player_lineage_id` is write-only and half-populated** (F7): 22/49 NULL, nothing maintains it, nothing reads
   it for access, and `loadCoachPlayers` filters on the legacy `team_id` so the teamless duplicates — the ones
   that most need linking — can never appear in `/link-players`. It creates a *belief* that identity was fixed
   while changing nothing. **FACT**
10. **`season_player_stats` keys stats on the player-name string** (F8) — two same-named kids merge, one
    cross-team kid with different chip labels splits. Not consumed by app code today, so latent. **FACT**
11. **`attach_kid_to_team` / `update_kid_profile` bypass `player_chip_label`** (F9), re-creating identical chips
    on a same-first-name roster. **FACT**
12. **No idempotency on creation**: `create_kid` has no dedupe and no natural key (double-tap → two children);
    `create_roster_placeholder` lets a coach add the same kid twice; `create_kid` + `join_team_with_code` in
    [join-team.tsx:77-79](../app/join-team.tsx#L77) are two separate RPCs, so a failure between them leaves an
    orphan child. (The *claim* paths are safe — both take `SELECT … FOR UPDATE` on the player row, and the
    attach paths use `ON CONFLICT`.) **FACT**
13. **No DOB / first-last split / preferred name** (§9), so there is no non-name signal to suggest a match with,
    and no way to show "Will" while storing "William". **FACT**
14. **Orphan artifacts**: 6 orphan players, 10 players with no roster, 1 chip pointing at a player who isn't on
    that team, 7 players whose legacy `team_id` has no matching spell. **FACT**

### LOW

15. **Season rollover**: there is **no rollover / copy-roster / clone-season code anywhere** (grepped repo + SQL).
    A new season means a new `seasons` row; `player_teams` spells and `players` rows persist untouched, and
    `roster_for_season` resolves membership by date window. **So identity survives 2026→2027 correctly, by
    virtue of the feature not existing.** The risk is only that whoever *builds* rollover could copy rosters by
    creating new `players` rows. **FACT**
16. **Repo↔live ledger drift**: `migration_close_kid_login_doors.sql` not in `schema_migrations`; the
    `player_lineage_id` backfill in `migration_player_lineage_linking.sql` ran once and is not maintained. **FACT**
17. **`preview_roster_by_code` lists kids who have left the team** (no `left_on` filter) and exposes every roster
    kid's first name + jersey + claimed-status to anyone holding the team code. **FACT**

---

## 15. RECOMMENDED LONG-TERM MODEL

**Verdict on your proposal: adopt it. It is the right model, and it is already 80% built.** **RECOMMENDATION**

I pressure-tested the alternatives and reject both:
- *A separate `person` / `athlete_identity` table above `players`* — this is what `player_lineage_id` already
  tries to be, and it has failed in practice because nothing reads it. Adding a real table would mean rewriting
  14 FKs and every authorization function. The cost is a rewrite; the benefit over "make `players` the identity"
  is zero.
- *Keeping `players` per-team and resolving identity through lineage* — this is today's de-facto model. It splits
  film, stats and guardians by construction, and every consumer would need a lineage-aware rewrite. Reject.

So: **`players.id` IS the durable human identity.** Everything team- or season-shaped moves off it.

```
players                     ← ONE ROW PER HUMAN CHILD. The identity.
  id, name (legal/full), first_name, last_name, preferred_name,
  grad_class, photo_path, dob?, created_by_user_id, created_at
  ⟂ no team_id, no season_id, no jersey_number

player_teams                ← athlete ↔ team/season, as spells. Already correct.
  player_id, team_id, season_id, jersey_number, position?, roster_status?,
  joined_on, left_on

parent_player_links         ← adult ↔ athlete. Already correct.
  parent_user_id, player_id, relationship, receives_logistics_alerts
  UQ (parent_user_id, player_id)

tags (category='players')   ← the athlete's chip in one team's tagging context. Already correct.
  team_id, player_id, name (display label only)
  UQ (team_id, player_id)
```

**Global identity vs team-scoped visibility.** Identity being global must not mean every coach sees every
attribute. Keep the split explicit:

| stays on `players` (global) | moves to / stays on `player_teams` (team+season) |
|---|---|
| legal/full name, first/last, preferred name | jersey number |
| photo / avatar | position, roster status, captain, depth chart |
| grad class | team-specific notes |
| DOB (if added) — **coach-visible only as an age band, never a raw date** | the spell window itself |

And change `players_read` from `is_team_member(players.team_id)` to
`is_team_member(<any team with an open-or-overlapping spell>) OR is_linked_parent(id)`. That single change fixes
F2 and simultaneously *tightens* the policy (a coach of a team the child has left stops reading the live row).

**Duplicate detection — evidence-based, never name-based.** Replace `suggest_duplicate_players` with a scorer
whose *only* high-confidence signals are durable relationships, and where a name is a tiebreaker, never a trigger:

| signal | weight |
|---|---|
| the same adult holds guardian links to both rows | **decisive — surface first** |
| a guardian code for one row was redeemed by a guardian of the other | strong |
| same grad class **and** same DOB (when DOB exists) | strong |
| overlapping teams/seasons with the same jersey | weak |
| name similarity | **tiebreaker only — never sufficient to surface a pair** |

On your live data that scorer would surface Lars, Conrad (×2 pairs), Tommy Allen and Neo — the four real ones —
and would **not** surface either Jackson. The inverse of today.

**False-match dismissal.** Smallest sensible model — one table, symmetric key, permanent:
```
player_match_dismissals (player_a uuid, player_b uuid, dismissed_by_user_id uuid, dismissed_at timestamptz,
                         PRIMARY KEY (player_a, player_b), CHECK (player_a < player_b))
```
Normalise the pair with `least/greatest` so order can't reintroduce it; the suggester left-joins and excludes.
Dismissal is a **team-independent statement of fact about two humans**, so do not scope it to a user or a team —
"these are different children" stays true on every screen for everyone. **RECOMMENDATION**

**Real reconciliation.** Keep `merge_players`, but make it complete and reversible:
1. Repoint **all 14** FK dependents explicitly — never let the final `DELETE` cascade anything.
2. **Never delete the losing row.** Soft-retire it: `players.merged_into_id uuid` + `merged_at` + `merged_by`.
   The old id keeps resolving, external references don't dangle, and reversal is possible.
3. Log the full move set (row counts per table) in `admin_audit_log.detail`, not just `{kept, merged}`.
4. Authority (see §18 Q3 for the open part): a **guardian of both** rows, or a **coach of a team both rows are
   on**, or a super admin — i.e. today's gate, which is sound. When the two rows have *different* guardians, or
   sit in different organisations, do **not** auto-merge: create a **merge request** that both sides confirm.
5. Alias/tombstone via `merged_into_id` beats a separate `player_identity_aliases` table — one nullable
   self-referencing column, no join, no second source of truth. **Adopt the column, skip the ledger table.**
6. Reversibility is bounded, not free: with `merged_into_id` you can restore the row and re-split
   `parent_player_links` / `player_teams`, but clips folded onto one chip cannot be re-attributed. Say so in the
   UI: *"Reversible for 30 days, except tagged clips."*

**Constraints worth adding** (all compatible with one child ↔ many teams, many seasons, many adults):
- `player_teams`: keep `UQ (player_id, team_id) WHERE left_on IS NULL`; add
  `CHECK (left_on IS NULL OR left_on >= joined_on)`.
- `parent_player_links`: keep `UQ (parent_user_id, player_id)`; add a **DB-level** 4-guardian cap (trigger) so the
  cap doesn't live only in `claim_or_link_guardian`.
- `tags`: keep `uq_tags_team_player`; add `UNIQUE (team_id, lower(name)) WHERE category='players'` so two chips
  on one team can never be indistinguishable.
- `players`: add `CHECK (id <> merged_into_id)`; **do not** add any uniqueness on `name` — names are not identity.
- Change `game_stat_lines`, `event_attendance`, `player_guardian_seats` and `notifications` FKs from
  `ON DELETE CASCADE` to `RESTRICT` so a stray player delete can never silently erase history.

---

## 16. RECOMMENDED FUTURE UX

**The governing rule: when a parent who already has children in IamSports is about to attach a child, the
existing children are shown FIRST and creating a new one is the last option, not the default.** **RECOMMENDATION**

### A. Parent adds an existing child to another team
Enter team code → **"Which of your players is joining {Team}?"** — the parent's kids listed first (with the teams
they're already on, so it's obviously the same kid), then the unclaimed roster spots, then "Add a new player".
Picking their kid → `join_team_with_code`. This is the existing correct path, promoted from a hidden link to the
primary action.

### B. Parent claims a coach-created roster player *(the important one)*
Enter team code → roster list → tap "Lars #12". **Interstitial:**
> **Is this one of your players?**
> Lars #12 · Football Team B
> [ **Lars Masten** — Basketball Team A ]  ← existing
> [ Conrad Masten — Legends 2036 ]
> [ Penelope Masten ]
> ——
> [ No — this is a different child ]

Picking an existing child reconciles (§16F architecture below). "No" runs today's `claim_roster_spot`, and records
a dismissal for that pair so the parent is never asked again. Show the interstitial whenever the parent has ≥1
child, regardless of name similarity — cheap, and it catches the "Conrad" case where names differ in spelling.

### C. Second parent links to the same child
Unchanged — `/claim-kid` with the per-player guardian code is correct. Two improvements: let the first guardian
**send** the code (SMS/share) from the kid screen rather than reading it aloud, and show the new guardian the
child's teams before they confirm, so a mis-typed code is caught before the link exists.

### D. Parent creates a genuinely new child
Fix `create_kid` (F1), make it idempotent on `(parent_user_id, trim(lower(name)))` within a short window so a
double-tap can't produce twins, and merge the two-RPC "Add & join" into one transactional RPC.
If the parent already has a child with a similar name, confirm once: *"You already have a Conrad Masten — is this
a different child?"* → Yes creates; No routes to reconciliation.

### E. System suspects a duplicate but they are different children
Coach or parent taps "Not the same child" → row in `player_match_dismissals` → the pair never surfaces again for
anyone. The banner should read *"Possible duplicate"* and lead with **"Different children"** as the safe default,
with "Combine" second and destructive-styled.

### F. Parent confirms two records are genuinely the same child
**Architecture question — my answer: (C) reconcile PLAYER_B into PLAYER_A, with the canonical row chosen by
content, not by who initiated.** **RECOMMENDATION**

Why not (A) or (B): "attach PLAYER_A to the roster relationship" and "replace PLAYER_B inside the membership"
both leave PLAYER_B's history — its chip, its `clip_tags`, its lineups, its stats — stranded on a row nobody owns.
That is exactly the state Conrad is in today on two teams. Reconciliation must move the *history*, not just the
roster pointer.

Concretely, when a parent confirms:
1. Pick the canonical row by content, not by who asked: guardians > tagged clips > videos > lineups > longer name.
   (`recommendedKeep` in [roster.tsx:186](../app/(tabs)/roster.tsx#L186) already does this — reuse it.)
2. Repoint all 14 dependents onto the canonical row; fold the losing chip's `clip_tags` onto the keeper's chip
   **per team** (the existing `merge_players` tag logic is right, it just needs to run per (team, player) rather
   than once).
3. Soft-retire the loser with `merged_into_id`.
4. Tell the parent in plain words what moved, and that clips can't be un-merged.
5. **When the two rows have different guardians** — the genuinely hard case — do not merge on one parent's word.
   Create a merge request; notify the other guardian(s); merge on confirmation or on a coach/admin adjudication.

---

## 17. MINIMUM CHANGE PATH

Smallest safe sequence to get from here to §15. **Nothing below is implemented. Each step is independently
shippable and independently revertible, and each obeys CLAUDE.md invariant 4 (additive first, migrate later).**
**RECOMMENDATION — for approval, not execution.**

| step | change | why it's first / safe | risk |
|---|---|---|---|
| **0** | **Fix `create_kid`** — drop `user_id` from the INSERT | one-line, unblocks a dead primary flow, no schema change | none |
| **1** | **Stop the false merge suggestion** — either gate `suggest_duplicate_players` to pairs that share a guardian, or ship `player_match_dismissals` + a "Different children" action | stops offering a destructive op on two different kids; pure subtraction | none — no data touched |
| **2** | **Make `merge_players` complete** — repoint all 14 dependents; add `merged_into_id`/`merged_at`/`merged_by`; stop deleting the row; log the full move set | must land **before** anyone merges the real Conrad/Lars duplicates | med — rewrite of a destructive fn; test on a throwaway pair first |
| **3** | **`players_read` off `players.team_id`, onto `player_teams`** — plus the same for `players_update/delete` and `parent_player_links_*` | fixes "Unnamed" + the box-score disappearance + second-coach lockout; additive (strictly more correct, slightly tighter) | med — RLS change; needs the escalation regression test re-run (`test_rls_escalation.sql`) |
| **4** | **Claim interstitial (§16B)** — "Is this one of your players?" before `claim_roster_spot` | client-only; the RPC and DB are untouched | low |
| **5** | **Reconcile the existing live duplicates** — Adam confirms each pair by hand, then run the fixed merge: Lars ×2, Conrad ×4 (3 content-bearing), Tommy Allen ×2, Neo ×2 | must come **after** 2 and 3. Do it with Adam naming each pair explicitly — never from a name match | high — real data; per CLAUDE.md, one pair at a time with a before/after query |
| **6** | **`first_name` / `last_name` / `preferred_name`** (nullable) + derivation order `preferred → first → split_part` | additive; backfill by splitting `name`; `name` untouched | low |
| **7** | **Route `attach_kid_to_team` + `update_kid_profile` through `player_chip_label`** | removes the F9 bypass | low |
| **8** | **Retire `players.team_id` / `players.season_id` / `players.jersey_number`** — only after 3 and 5, only after a build that reads neither is confirmed installed (invariant 4) | the actual cleanup; must be last | med |
| **9** | **Either wire `player_lineage_id` into the new merge as the pre-merge "same human" marker, or retire it and `/link-players` with it** | it currently creates false confidence; pick one | low |

Steps 0 and 1 are strictly subtractive and could ship together. Everything from 2 onward is a locked-change loop
per CLAUDE.md invariant 7 (pre-code report → go → code → post-code report → go → commit).

---

## 18. QUESTIONS FOR ADAM

Only the ones the repo and database genuinely cannot answer.

1. **Are the four "Conrad Masten" rows one child or more than one?** I can prove they're four identities with
   split film (26 / 21 / 11 / 0 clips across Centex Attack Bobby, Legends 2036, Regents Bangels, teamless). I
   cannot prove they're the same human — and the rule is that only you can. Same question for **Lars Masten ×2**,
   **Tommy Allen ×2** (`0475cd77` teamless + `2844aaa8` on Regents Bangels), and **Neo Castillo / Neo**
   (same guardian, `aaronfcastillo@`).
2. **`Max 0e92a2ee` and `Max 1bbcbb28` already share a lineage id** — someone linked them via `/link-players`.
   Two different teams, independent clip histories, no shared guardian. Was that deliberate, or a test?
3. **Who may initiate a real reconciliation when the two rows have different guardians?** My recommendation is a
   merge *request* requiring the other guardian's confirmation — but that's a product/trust call, and it's the
   difference between "a coach can consolidate two kids" and "only families can".
4. **Do you want DOB on `players`?** It is the only strong non-name identity signal, and without it duplicate
   suggestion will stay weak. It is also the most sensitive field you'd hold on a minor, with COPPA/App-Store
   implications. My recommendation if yes: store it, but expose **only an age band** to coaches — never the raw
   date, never in an export.
5. **Should a child's identity be visible across organisations?** Today `players` is effectively
   organisation-scoped by the `team_id` RLS accident. Once §15 lands, one `player_id` genuinely spans clubs — so
   a coach at Club B could learn the child plays for Club A (via a shared lineage/roster). Is that acceptable, or
   should cross-org roster visibility be explicitly suppressed?
6. **`followers` has a CASCADE FK to `players` and zero rows** — CLAUDE.md says confirm before touching. A safe
   merge should repoint it. Do I include it, or leave it out of the merge entirely?
7. **What should the UI say when a parent's kid rail shows two copies of one child?** Silently hide one is wrong
   (hides broken data); showing both is confusing. My recommendation: show both with a *"Looks like the same
   child — combine?"* affordance, as a way to surface reconciliation to the person who actually knows.

---

**STOP.** Audit complete. No code written, no migration created, no data modified, nothing deployed.
Nothing in §15-§17 is built or scheduled.

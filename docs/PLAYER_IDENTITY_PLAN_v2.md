# IamSports — Player Identity: Revised Architecture + Slice Plan (v2)

**Date:** 2026-09-23 · **Status:** ARCHITECTURE FOR APPROVAL. Nothing here is implemented.
**Supersedes** §15–§17 of [PLAYER_IDENTITY_AUDIT_2026-09-23.md](PLAYER_IDENTITY_AUDIT_2026-09-23.md).
The audit (§1–§14) stands as the evidence record and is unchanged.

Incorporates Adam's 12 product corrections of 2026-09-23. Each correction is traced to the design decision it
produced, so nothing gets quietly dropped.

**Tags:** **FACT** = verified in live DB or current code · **DESIGN** = proposed, awaiting approval ·
**OPEN** = needs Adam's judgment before it can be built.

---

## 0.0 DECISION LOG — settled, do not relitigate

| # | decision | date | where it lands |
|---|---|---|---|
| D1 | `players.id` = one durable human child; identity global, access relationship-scoped; names are display data and never identity; no automatic name-based merging | 2026-09-23 | §1, §10 |
| D2 | Disable the current name-based suggester entirely — do not tune it | 2026-09-23 | §2, Slice A |
| D3 | No name-based idempotency; use an explicit request UUID | 2026-09-23 | §3 |
| D4 | Global identity ≠ global coach edit rights; family owns identity fields, team owns relationship fields | 2026-09-23 | §4 |
| D5 | **No DOB.** Primary identity resolution is explicit guardian confirmation, not probabilistic matching | 2026-09-23 | §6.1 |
| D6 | Cross-org: a coach must not learn the child's other clubs from their own access | 2026-09-23 | §5 |
| D7 | Merge authority: same-guardian-both → direct; different guardian sets → request + confirmation or admin path; coach may only FLAG; narrow exception for two unclaimed placeholders on the coach's own team | 2026-09-23 | §7.2 |
| D8 | Tombstone, never hard-delete; repoint every dependency explicitly; no cascade reliance; full audit counts; **no user-facing "30-day reversal"** — permanent in the UI, support-recoverable underneath | 2026-09-23 | §8 |
| D9 | No live merge until the safety system + local + production-scratch test gates all pass | 2026-09-23 | §9, Slice E |
| D10 | Name model: `first_name` / `last_name` / `preferred_name`, `players.name` kept untouched, **no blind split backfill**, display fallback only | 2026-09-23 | §10 |
| D11 | Claim UX: existing children offered first, unconditionally, not gated on name similarity | 2026-09-23 | §11 |
| **D12** | **A dismissal re-surfaces ONCE, and only on genuinely new hard relationship evidence** — another authenticated guardian linked to both, or a parent explicitly attempting to connect the two identities, or a comparably strong recorded relationship. **Never** on name/nickname/jersey similarity or any new fuzzy algorithm. Labelled clearly as new information; otherwise the dismissal stands | 2026-09-23 | §6.3 |
| **D13** | **Case 4 approved:** claimed child + unclaimed coach-created row, initiated outside the team-code claim flow → guardian **requests**, a coach authorized for the unclaimed row's team must **confirm**. Inside the claim flow, the coach-issued team code is the coach-side authorization | 2026-09-23 | §7.2 |
| **D14** | **Former coaches:** once a child has left a team, a former coach retains **no** access to the child's current family-owned `players` record. The former team **does** retain its historical team-owned material — games, film, clips, stats, lineups, roster/season history | 2026-09-23 | §4.4, §5.4 |
| **D15** | **Followers:** preserve and union/repoint to the canonical player; never silently delete; protect from cascade loss. **Do not build out or expand the follower feature** — this is data-loss prevention only | 2026-09-23 | §8.2 step 14 |
| **D16** | **Max is a confirmed identity match** (explicit human confirmation, not a name inference) — a Slice E candidate only, after every gate in §9.3. Adam re-verifies the two ids and their before-state at execution time | 2026-09-23 | §12 Slice E, §13 |

---

## 0. WHAT CHANGED FROM v1, AND WHY

| # | Adam's correction | What it changed in the plan |
|---|---|---|
| 1 | Disable the suggester entirely, don't tune it | Became **Slice A**, and the kill has to happen **in the database first** — a client-only change leaves the banner alive on every installed build (§2.1) |
| 2 | No name-based idempotency | Dropped `(user, normalized name)` keying. Replaced with an explicit `creation_request_id` (§3) — which now also has to cover the *reconciliation* RPC, not just `create_kid` |
| 3 | Global identity ≠ global coach edit rights | Forced a **field-ownership split** and a rewrite of `update_kid_profile`, which today lets a coach rewrite a child's global name (§4). Turned out to be the sharpest finding of this round |
| 4 | No DOB | Removed DOB from the model **and** gutted the evidence-based suggester — with no DOB, only one non-name signal is left that is a *fact* rather than a guess (§6.1) |
| 5 | Cross-org privacy | Surfaced a live leak vector: `kid_team_audience` returns every club the child plays for, gated on a coach of the *legacy* team (§5) |
| 6 | Merge authority | Replaced v1's single gate with a 5-case authority matrix; today's `merge_players` coach gate is **wrong** and must be tightened, not just extended (§7) |
| 7 | Merge safety, no false reversal promise | Kept the tombstone; dropped the "30-day reversible" copy; made "no cascade reliance" **structural** by flipping 5 FKs to RESTRICT (§8) |
| 8 | Don't merge live duplicates yet | Became **Slice E**, gated behind a full-coverage test harness on throwaway records (§9) |
| 9 | Don't blind-split names | Changed the backfill from automatic to **none** — new columns stay NULL until typed, and parsing is display-only (§10) |
| 10 | Claim UX approved | Kept, and resolved its authority question: the team join code *is* the coach-side authorization (§11) |
| 11 | Dismissal authority | New three-tier scoped model, because a coach dismissal must not bind families (§6.2) |
| 12 | Revised build order | §12, following A–G exactly |

---

## 1. THE MODEL (agreed)

```
players                       ← ONE ROW PER HUMAN CHILD. The durable identity. FAMILY-OWNED.
  id
  name              (legacy full/historical name — kept, untouched)
  first_name        (new, nullable)
  last_name         (new, nullable)
  preferred_name    (new, nullable)
  photo_path
  grad_class
  created_by_user_id        (new)
  creation_request_id       (new — idempotency, §3)
  merged_into_id / merged_at / merged_by_user_id   (new — tombstone, §8)
  ⟂ NO team_id · NO season_id · NO jersey_number        (retired in Slice G)
  ⟂ NO dob                                              (correction 4)

player_teams                  ← child ↔ team/season, as dated spells. TEAM-OWNED.
  player_id, team_id, season_id, jersey_number,
  position?, roster_status?, captain?, team_note?        (future, coach-owned)
  joined_on, left_on

parent_player_links           ← adult ↔ child. Already correct.
  parent_user_id, player_id, relationship   UQ (parent_user_id, player_id)

tags (category='players')     ← the child's chip in ONE team's tagging context. Already correct.
  team_id, player_id, name (display label only)   UQ (team_id, player_id)
```

**Already proven live: this works.** Lars Masten `e34c2405` is one `player_id` on two teams, two team-scoped
chips, 80 tagged clips, three guardians. **FACT**

**The load-bearing rule:** `players.id` is identity. `player_teams` is relationship. `tags.name` is display.
Nothing else is identity — not `name`, not `first_name`, not `preferred_name`, not jersey, not lineage.

---

## 2. CORRECTION 1 — KILL THE SUGGESTER (Slice A)

### 2.1 It must die in the database first **DESIGN**

`suggest_duplicate_players` is called from [roster.tsx:128](../app/(tabs)/roster.tsx#L128) on every focus of the
Roster tab. **A client-only removal does nothing for builds already on phones** — TestFlight build 57 and anything
else installed keeps calling the RPC and keeps rendering the banner, including the Jackson Schneider /
Jackson Tochman pair with its irreversible "Combine" button. **FACT**

So the order inside Slice A is not negotiable:

1. **DB first:** replace the function body with an immediate empty return, keeping the **exact same return
   signature** (9 OUT columns per `migration_merge_dupe_counts.sql`). Every installed build gets zero rows,
   `dupes.length > 0` is false, the banner stops rendering everywhere within one migration. No client update, no
   App Store wait.
2. **Client second:** remove the `dupes` state, the fetch, the banner, the `mergePair` chooser and
   `recommendedKeep`/`sideMeta` from `roster.tsx`. (Keep `recommendedKeep`'s scoring logic somewhere — Slice B
   reuses it to pick the canonical row.)

Do **not** drop the function — a missing RPC makes installed builds throw instead of showing nothing.
Do **not** change the signature — same reason.

`merge_players` itself stays callable during Slice A (nothing reaches it once the banner is gone), and gets
replaced wholesale in Slice B.

**Jackson Schneider / Jackson Tochman will not be offered for merge again** — not at a tuned threshold, not at any
threshold. First-name and trigram matching are removed from the product, not adjusted. Nothing automatic replaces
them until §6 exists.

### 2.2 What is lost, honestly

Zero true positives. The suggester currently finds **none** of the nine real duplicates in the live database
(they're all on different teams, and it only compares within one team). Turning it off costs nothing and removes
the only destructive false positive. **FACT**

---

## 3. CORRECTION 2 — IDEMPOTENCY WITHOUT NAMES

**Two different children may legally have identical names, so no name — normalized, trimmed, lowercased or
otherwise — may ever participate in deduplication.** Not for identity, not for idempotency.

### 3.1 Mechanism: explicit client-generated request id **DESIGN**

```
players.creation_request_id  uuid  NULL
UNIQUE INDEX players_creation_request_key
  ON players (created_by_user_id, creation_request_id)
  WHERE creation_request_id IS NOT NULL
```

- `create_kid(p_name text, p_request_id uuid)` inserts with the request id.
- On unique violation, it **re-selects the existing row and returns its id** — but only when
  `created_by_user_id = auth.uid()`. Scoping the uniqueness to the creating user is what stops a caller from
  passing someone else's request id and getting back a `player_id` they have no business seeing.
- Old signature stays for installed builds (see §12 Slice A/B notes): `create_kid(p_name)` keeps working and
  simply generates its own request id server-side — non-idempotent, exactly as bad as today, but not *worse*.
  The new two-arg overload is what the updated client calls.

**Client side:** generate the uuid **once per form open**, not per tap — `useRef(crypto.randomUUID())` — and reset
it after a success so the next child gets a fresh key. A double-tap, a network retry, and a resubmit after a
timeout all collapse onto one row.

### 3.2 Idempotency is needed in four places, not one **DESIGN**

| operation | today | needed |
|---|---|---|
| `create_kid` | no key, not idempotent, **and currently broken** (F1) | request id |
| "Add & join" ([join-team.tsx:77-79](../app/join-team.tsx#L77)) | **two separate RPCs** — a failure between them orphans a child | one transactional RPC, one request id |
| `create_roster_placeholder` | no key — a coach double-tap makes two roster slots | request id |
| **reconciliation** (§7) | doesn't exist yet | request id — a double-tapped "Yes, this is my Lars" must not merge twice |

The claim/attach paths (`claim_roster_spot`, `claim_or_link_guardian`, `join_team_with_code`,
`attach_kid_to_team`) are **already safe** — the first two take `SELECT … FOR UPDATE` on the player row, the
others use `ON CONFLICT`. No change needed. **FACT**

---

## 4. CORRECTION 3 — FIELD OWNERSHIP (the sharpest finding of this round)

### 4.1 The violation that exists today **FACT**

`update_kid_profile(p_player_id, p_name, p_jersey, p_grad_class)` is gated:

```sql
if not (is_linked_parent(p_player_id) or is_super_admin()
        or (t is not null and is_team_coach(t)))   -- t = players.team_id
```

…and then writes **`players.name`, `players.jersey_number`, `players.grad_class`** in one statement. So a coach of
the child's legacy team can rewrite the child's **global name**. The Roster tab calls it for exactly that
([roster.tsx:210](../app/(tabs)/roster.tsx#L210), `p_name` only). This is the precise thing correction 3 forbids,
and it is live.

By contrast, `set_kid_photo` and `update_kid` are **already** guardian/super-admin only — family-owned, correct. **FACT**

### 4.2 The ownership split **DESIGN**

| field | owner | who may write |
|---|---|---|
| `name` (legacy/full), `first_name`, `last_name`, `preferred_name` | **FAMILY** | guardian, super admin — **and a coach only while the child has no guardian** (§4.3) |
| `photo_path` | **FAMILY** | guardian, super admin. Never a coach. (Already true.) |
| `grad_class` | **FAMILY** | guardian, super admin, or a coach of an unclaimed placeholder |
| `player_teams.jersey_number` | **TEAM** | coach of *that* team |
| `player_teams.position`, `roster_status`, `captain`, `team_note` (future) | **TEAM** | coach of *that* team |
| `player_teams.joined_on` / `left_on` | **TEAM** | coach of that team; guardian may end a spell (`leave_team`) |

**RPC shape:** split `update_kid_profile` into two, so the *capability* is separated, not just the check:
- `update_player_identity(p_player_id, p_first, p_last, p_preferred, p_name, p_grad_class, …)` — family-owned.
- `update_player_team_details(p_player_id, p_team_id, p_jersey, …)` — coach-of-that-team-owned, writes
  `player_teams` only.

Keep `update_kid_profile` as a thin, deprecated shim that forwards to the identity writer, so installed builds
keep working (invariant 4: additive first).

### 4.3 The unclaimed-placeholder carve-out **DESIGN**

A coach building a roster must be able to type a name onto a slot nobody owns — that's how every roster starts.
So the rule is ownership-by-claim, not ownership-by-role:

> A coach may write a child's identity fields **only while that child has no guardian link.** The moment a family
> claims the child, identity becomes family-owned and the coach keeps only `player_teams`.

This is a clean, checkable predicate (`NOT EXISTS (SELECT 1 FROM parent_player_links WHERE player_id = …)`), it
matches what coaches actually need, and it means claiming a child *transfers* identity authority to the family at
the exact right moment.

### 4.4 RLS specification **DESIGN**

Two new SECURITY DEFINER helpers (mirroring `is_team_member`/`is_team_coach`, spell-aware):

```sql
is_current_team_member_of_player(p_player uuid)  -- member of ANY team with an open spell for this child
is_current_team_coach_of_player(p_player uuid)   -- coach of ANY team with an open spell for this child
player_has_guardian(p_player uuid)               -- EXISTS parent_player_links
```

| policy | today **FACT** | revised **DESIGN** | effect |
|---|---|---|---|
| `players_read` | `is_super_admin() OR is_team_member(team_id) OR is_linked_parent(id)` | `is_super_admin() OR (merged_into_id IS NULL AND (is_linked_parent(id) OR is_current_team_member_of_player(id)))` | fixes the "Unnamed"/box-score bug (F2); **tightens** — a coach of a team the child has left stops reading the row; hides tombstones from everyone but support |
| `players_insert` | `is_team_coach(team_id)` | `is_super_admin()` only | all creation is already via definer RPCs (**FACT**, §4.5) — closes direct insert |
| `players_update` | `is_team_coach(team_id)` | `is_super_admin() OR is_linked_parent(id) OR (NOT player_has_guardian(id) AND is_current_team_coach_of_player(id))` | coach loses write authority the moment a family claims the child |
| `players_delete` | `is_team_coach(team_id)` | `is_super_admin()` only | blank-placeholder deletion stays in `remove_roster_placeholder` (definer), which already has the right rule |
| `parent_player_links_insert` | `is_super_admin() OR coach of players.team_id` ⚠ **arbitrary `parent_user_id`** | `is_super_admin() OR parent_user_id = auth.uid()` | closes **F14** — a coach can no longer grant an arbitrary account guardian access to a child |
| `parent_player_links_delete` | `is_super_admin() OR coach of players.team_id` | `is_super_admin() OR parent_user_id = auth.uid()` | self-unlink direct; removing *another* guardian stays in `remove_guardian` (which enforces primary-guardian rules) |
| `parent_player_links_read` | own row, or coach of `players.team_id` | `is_super_admin() OR parent_user_id = auth.uid()` | coach-visible guardian info moves entirely to `list_player_guardians` (admin/head_coach gated). Note [roster.tsx:100](../app/(tabs)/roster.tsx#L100) reads this table for guardian **counts** — it needs a definer RPC returning counts only |
| `player_teams_read` | `is_super_admin() OR is_team_member(team_id) OR is_linked_parent(player_id)` | **unchanged** | already correctly per-row team-scoped — this is what protects correction 5 |

### 4.5 Why this RLS change is low-risk **FACT**

I grepped every client write to the three identity tables:

```
$ grep -rnE "from\('(players|player_teams|parent_player_links)'\)" … | grep -E "\.update\(|\.insert\(|\.delete\(|\.upsert\("
(no matches)
```

**Not one client code path writes these tables directly.** All four client reads are SELECTs
([make-highlight.tsx:106](../app/make-highlight.tsx#L106), [kid.tsx:113](../app/kid.tsx#L113),
[player-links.ts:24](../lib/core/player-links.ts#L24), [homeFeed.ts:60](../lib/core/homeFeed.ts#L60)), plus the
`parent_player_links` count read at [roster.tsx:100](../app/(tabs)/roster.tsx#L100) and the nested
`players ( id, name )` joins at [roster.tsx:89](../app/(tabs)/roster.tsx#L89) /
[box-score.tsx:179](../app/box-score.tsx#L179) / [team-permissions.tsx:47](../app/team-permissions.tsx#L47).

So tightening INSERT/UPDATE/DELETE cannot break a client call path. **Enforcement of per-*field* ownership lives
in the RPCs, not in RLS** — Postgres RLS is row-level, and column-level `GRANT UPDATE (col)` would not bind our
SECURITY DEFINER functions (they run as owner). RLS is the backstop for direct writes; the RPC split in §4.2 is
the actual mechanism. Stating that plainly so nobody later assumes RLS is doing work it cannot do.

---

## 5. CORRECTION 5 — CROSS-ORGANIZATION PRIVACY

**Principle:** identity is global; **visibility is per-relationship.** A coach sees the child through a team they
are authorized for, and learns nothing about the child's other clubs from that access.

### 5.0 There is no organization layer — "cross-org" means "cross-team" **FACT**

An `information_schema.tables` sweep for `%org%` / `%club%` returns **nothing**. There is no `organizations`
table, no `clubs` table, and no `organization_id` column anywhere in the schema. A "club" in IamSports is
just a `teams` row, and the only trust boundary that exists is `team_memberships`.

Two consequences for decisions 1, 4 and 7:
- **Good news:** "one identity across unrelated organizations" needs no new layer. It already works, because
  `player_teams` doesn't care whether two teams belong to the same club — and `player_teams_read` is evaluated
  per row, so a coach at Club B cannot see the child's Club A spell (§5.1).
- **The catch:** because there is no org object, there is also no place to hang org-level policy — no
  org-scoped admin, no org-wide roster visibility, no "this club may not see that club". Every privacy rule has
  to be expressed at the **team** level. That is sufficient for decision 4 today, and it is the reason §5.3's
  rules are written as per-team predicates rather than per-org ones. If an org layer is ever added, it must sit
  **beside** `teams` (teams belong to an org) and must never become a scope on `players`.

### 5.1 What already protects this **FACT**

- `player_teams_read` is evaluated **per row** with `is_team_member(team_id)`, so Coach B reads only the spells
  for Coach B's own teams. The child's Team A membership is already invisible to Coach B.
- `tags` are team-scoped; `roster_for_season` is `is_team_member(p_team_id)`-gated; `clips`/`videos`/`games` are
  all team-scoped.
- The Railway ffmpeg service receives `{url, start_time, end_time}` only — **no player ids leave the database**.

### 5.2 The live leak vector **FACT · must be fixed in Slice C**

`kid_team_audience(p_player_id)` is gated:

```sql
if not (is_linked_parent(p_player_id) or is_super_admin()
        or is_team_coach((select team_id from players where id = p_player_id)))
```

…and then returns, for **every open spell** the child has: `team_id`, `team_name`, `member_count`, and the full
coach list (`user_id`, display name, role) of each team.

So a coach of the child's **legacy** team can enumerate every other club the child plays for and who coaches
there. Today it is only called from [kid.tsx:180](../app/kid.tsx#L180) (a guardian surface), so no shipped screen
exposes it to a coach — but the function is granted to `authenticated` and a coach of the legacy team can call it
directly. **Fix: drop the coach branch. This is a family surface — guardian + super admin only.**

### 5.4 D14 — a former coach loses the child's profile, the former team keeps its history

D14 has two halves that pull against each other, and resolving them turned up a live trap.

**Half 1 — former coach loses the current profile.** Satisfied by §4.4's `players_read`: membership of a team with
an **open** spell, or a guardian link. When the child's spell closes, coaches of that team stop reading the child's
`players` row — name, photo, grad class, and the future name fields. **DESIGN**

**Half 2 — the former team keeps its historical material.** This mostly already holds, because the historical
surfaces are keyed on **team-owned** data, not on `players`: **FACT**
- `games`, `videos`, `clips`, `clip_tags` are team-scoped and untouched by `players_read`.
- `game_lineups_read` is `is_team_member(g.team_id)` — a coach who is still on the team keeps every lineup row for
  departed children.
- **Historical display names already come from the team's own chip.** `stat_events.player_name` is `tags.name`, and
  `game_box_score` renders `COALESCE(se.player_name,'TEAM')`. `tags` are team-scoped and survive a child's
  departure, so a past box score keeps its names regardless of `players_read`.
- `roster.tsx` already filters `.is('left_at', null)`, so a departed child never appeared on the current roster
  anyway — blast radius of Half 1 is far smaller than it first looks.
- `team-archive.tsx` renders no child names at all (grepped — zero matches).

**The trap this surfaced — `resolved_game_stats`' manual branch. FACT · RISK:**

```sql
manual AS (SELECT gsl.game_id, gsl.player_id, COALESCE(p.name, 'TEAM') AS player_name, …
           FROM game_stat_lines gsl LEFT JOIN players p ON p.id = gsl.player_id)
```

The views are `security_invoker` (`migration_stats_views_security_invoker_lockdown.sql`), so that `LEFT JOIN` is
subject to `players_read`. Once Half 1 lands, a **departed** child's manually-entered stat line joins to nothing
and `COALESCE(p.name,'TEAM')` silently relabels their historical stats as **"TEAM"** — corrupting a past box score
and folding an individual's numbers into the team row. `game_stat_lines` has **0 rows** live, so there is no
current damage, but this would have shipped as a latent history-corrupting bug.

**Fix (Slice C, same slice as the RLS change):** resolve the display name from the **team-owned chip** first, and
fall back to `players.name` only for a child the caller may still read:
```
tags.name for (that game's team, player_id)  →  players.name  →  'TEAM' only when player_id IS NULL
```
Same principle as Half 2: **team-owned history renders with team-owned data.** Also fix `box-score.tsx`'s
edit-mode roster merge ([box-score.tsx:178-184](../app/box-score.tsx#L178)), the one place that still reads
`players ( id, name )` to list roster players with no stats yet.

**Standing rule for every surface built later:** before rendering a child's name, decide whether the surface is
**current** (reads `players`, gated by open spell or guardian) or **historical** (reads the team-scoped chip).
Never let a historical surface depend on the family-owned identity row.

### 5.3 Rules for everything built later **DESIGN**

1. No screen, RPC, or suggestion may name a team the caller is not a confirmed member of. Where a cross-team fact
   must be conveyed, convey it **without the team**: *"This player is already on another team in IamSports"* — never
   *"…on Legends 2036, coached by …"*.
2. The reconciliation UI a **guardian** sees may name teams — a family is entitled to their own child's full
   history. The UI a **coach** sees may not.
3. `merge_players`'s per-side summary ([roster.tsx:178](../app/(tabs)/roster.tsx#L178) `sideMeta`) must not report
   content or guardian counts from teams the caller can't see. Slice B's counts get filtered to the caller's teams.
4. A retired (`merged_into_id IS NOT NULL`) row is readable by super admin only, so a tombstone can't be used to
   enumerate a child's history either.

---

## 6. CORRECTION 4 + 11 — DUPLICATE DETECTION AND DISMISSAL

### 6.1 With no DOB, automatic suggestion is nearly dead — and that's correct **DESIGN**

Correction 4 makes explicit guardian confirmation the primary mechanism. Correction 2 forbids names. What's left:

| signal | is it a fact or a guess? | use |
|---|---|---|
| **The same authenticated adult holds guardian links to both rows** | **a FACT recorded in the database** | ✅ surface it — this is the *only* automatic suggestion that ships |
| A guardian code issued for row X was redeemed by an adult already guardian of row Y | a fact | ✅ surface (same shape as above once redeemed) |
| A **coach flags** a pair on their own team | a human assertion, explicitly attributed | ✅ surface to the family, never auto-merge |
| Overlapping team + same jersey | guess | ❌ not used |
| Name similarity, first name, trigram, nickname | guess, and forbidden | ❌ **never** |

So the replacement for `suggest_duplicate_players` is not a matcher. It's `list_identity_conflicts()` — a
**deterministic query over recorded relationships**, scoped to the caller:

- **For a guardian:** "You are listed as guardian of two records that may be the same child." On Adam's live data
  this surfaces exactly the right pairs: **Lars** `e34c2405`/`f3924843` (both held by `smmasten@`), **Conrad**
  `1b95a1c4`/`4637e2d0` (both held by `smmasten@`), **Neo** `8be773b5`/`2f7540e9` (both held by
  `aaronfcastillo@`). **FACT**
- **For a coach:** nothing automatic. A "Possible duplicate — flag for the family" action on their own roster only.
- Jackson Schneider / Jackson Tochman: **never surfaced by anything**, because no adult holds both and no one has
  flagged them. Correction 1 satisfied structurally, not by threshold.

Note what this does *not* find: Conrad `045968e6` (21 clips) and `25411e20` (11 clips) have **no guardian at all**,
so no automatic signal exists for them. They can only be reconciled by Adam naming them (Slice E) or by a coach
flagging them to a family. That is the honest cost of dropping DOB, and I think it's the right trade — it's a
handful of rows found by a human, versus a matcher that gets families wrong.

### 6.2 Dismissal authority and scoping **DESIGN · needs sign-off**

Correction 11 is right that a random coach must not silence a real identity problem for every family forever. So
dismissal is **scoped by who asserted it**:

| tier | who | scope | effect | revocable by |
|---|---|---|---|---|
| **Guardian determination** | an adult with a guardian link to **either** row | **global** | the pair is never surfaced to anyone again | the other side's guardian, or super admin |
| **Coach dismissal** | a coach of a team both rows are on | **that team only** | the pair stops appearing on that team's coach surface; **families still see it** | that team's coaches, or super admin |
| **Super-admin correction** | super admin / support | **global**, audited | overrides either tier in either direction | super admin |

```
player_match_dismissals
  player_a uuid, player_b uuid           CHECK (player_a < player_b)   -- normalized with least()/greatest()
  scope text  ('global' | 'team')
  team_id uuid  NULL                     -- required iff scope='team'
  dismissed_by_user_id uuid
  asserted_as text                       -- 'guardian' | 'coach' | 'super_admin' (authority at assert time)
  dismissed_at timestamptz
  revoked_at timestamptz, revoked_by_user_id uuid
  PRIMARY KEY (player_a, player_b, scope, coalesce(team_id, '00000000-…'::uuid))
```

Normalizing the pair with `least/greatest` is what stops A→B and B→A from being two different records — the bug
that would otherwise make "dismissed" come back the next time the pair is computed in the other order.

### 6.3 Re-surfacing a dismissal — D12 **DESIGN**

A dismissal is permanent **except** on genuinely new *recorded relationship* evidence, and then it re-surfaces
exactly once, labelled as new information. The allowed triggers are a closed list, enumerated in code so no future
matcher can widen it:

| trigger | allowed? | why |
|---|---|---|
| another authenticated guardian becomes linked to **both** rows | ✅ | a new fact in `parent_player_links` |
| a parent explicitly attempts to connect the two identities (a merge request, or picking the other row in the claim interstitial) | ✅ | an explicit human assertion |
| a comparably strong recorded relationship is created (e.g. a guardian code issued for one row is redeemed by a guardian of the other) | ✅ | a new fact, same class as the above |
| names became more similar · a nickname changed · jersey numbers now match · a new fuzzy/name algorithm thinks they look alike | ❌ **never** | D1 — names are not identity, and D2 removed name matching from the product |

Mechanics: `player_match_dismissals` gains `resurfaced_at timestamptz` and `resurfaced_reason text`. The
conflict query (§6.1) excludes a dismissed pair **unless** a qualifying trigger's timestamp is later than
`dismissed_at` **and** `resurfaced_at IS NULL`. Surfacing sets `resurfaced_at`, so a pair can be re-raised **once**
per dismissal and never loops. A second dismissal after a re-surface is final for that evidence class.

Two deliberate choices worth arguing about:
- **A guardian's "different children" is global.** A family is the best available authority on their own child, and
  a guess-free suggester only surfaces pairs a *family* is already attached to. If that feels too strong, the
  fallback is: global, but re-surfaced once to the *other* family if they later attach to the second row.
- **A coach dismissal never binds a family.** This is the direct answer to correction 11.
- **OPEN:** should a guardian dismissal be re-surfaced when *new* hard evidence appears (e.g. a second adult later
  holds both rows)? My recommendation: yes, exactly once, labelled "new information" — but it's your call, and it
  is the difference between "dismissed forever" and "dismissed until facts change".

Since Slice A removes all automatic suggestions, **this table isn't needed until §6.1 ships.** It moves out of the
critical path — noted in §12 as a Slice D/H item, not a Slice A item.

---

## 7. CORRECTION 6 — MERGE AUTHORITY

### 7.1 Today's gate is wrong **FACT**

```sql
if not ( is_super_admin()
      or (is_linked_parent(p_keep) and is_linked_parent(p_dup))
      or exists (select 1 from player_teams a join player_teams b on b.team_id = a.team_id
                 where a.player_id = p_keep and b.player_id = p_dup and is_team_coach(a.team_id)) )
```

The third branch lets **a coach merge two claimed children belonging to two different families** as long as both
are on his team. That's precisely what correction 6 forbids, and it's what the Jackson pair would have done.

### 7.2 The authority matrix **DESIGN**

| # | situation | who may act | mechanism |
|---|---|---|---|
| 1 | **Both rows unclaimed** (0 guardians), both on **one team the caller coaches** | that team's coach | ✅ direct consolidation. The narrow exception you allowed. No family's interest exists |
| 2 | **Both rows claimed by the SAME adult** (`is_linked_parent` true for both, same `auth.uid()`) | that guardian | ✅ direct reconciliation |
| 3 | **One row claimed by the caller, the other unclaimed — inside the claim flow**, caller holding a valid team join code for the unclaimed row's team | that guardian | ✅ direct (§11 — the code *is* the coach-side authorization) |
| 4 | **One row claimed by the caller, the other unclaimed — initiated anywhere else** (e.g. Roster tab) | guardian **requests**; a coach of the unclaimed row's team **confirms** | ⚠️ dual confirmation |
| 5 | **Both rows claimed, by DIFFERENT adults** | nobody unilaterally. Either guardian may **request**; the other guardian side must confirm. A **coach may only FLAG** | ⚠️ reconciliation request |
| — | any of the above | super admin / support | ✅ direct, explicitly audited |

**Why case 3 is safe and case 4 needs a second signature:** in the claim flow the parent has produced a secret the
coach issued (the team join code) and the roster slot has no owner — that is the same authorization
`claim_roster_spot` already relies on today, and the outcome is strictly better than today's (one identity instead
of two). Outside that flow there's no coach-issued token in play, so a guardian could otherwise absorb an
unrelated unclaimed placeholder — and its clips — on a team they have no standing on. Hence the coach confirmation.

**What this means for your live Conrad rows:** `045968e6` and `25411e20` are unclaimed but on **different** teams,
so case 1 does not cover them, and folding them into the claimed `1b95a1c4` is **case 4** — guardian request plus
a coach confirmation per team. You personally hold both roles on both teams, but the rule still has to be
expressed as two authorizations, not as "Adam is special". **FACT / DESIGN**

### 7.3 Reconciliation requests **DESIGN**

```
player_merge_requests
  id, source_player_id, target_player_id,
  requested_by_user_id, requested_as ('guardian'|'coach'),
  reason text,
  status ('pending'|'confirmed'|'declined'|'expired'|'applied'),
  confirmed_by_user_id, confirmed_at, applied_at,
  created_at, expires_at
```
A request notifies the confirming side via the existing `notifications` backbone. Declining a request writes a
**dismissal** (§6.2) at the declining party's authority tier, so a declined merge doesn't come back as a
suggestion. Nothing moves until `status='confirmed'` and the safe merge (§8) runs.

---

## 8. CORRECTION 7 — MERGE SAFETY

### 8.1 Tombstone, never delete **DESIGN**

```
players.merged_into_id      uuid NULL REFERENCES players(id)
players.merged_at           timestamptz NULL
players.merged_by_user_id   uuid NULL
CHECK (merged_into_id IS NULL OR merged_into_id <> id)
```

The losing row is **retired, not deleted**: a stale `player_id` held anywhere — a cached client, a deep link, a
support ticket, an export someone saved — still resolves. Retired rows are excluded from `players_read` for
everyone but super admin (§4.4), so they vanish from rosters and kid rails on their own, without a delete.

### 8.2 Repoint all 14 dependents explicitly; rely on no cascade **DESIGN**

The safe merge repoints **every** table, in this order, in one transaction:

| order | table | key | conflict rule | today |
|---|---|---|---|---|
| 1 | `parent_player_links` | `(parent_user_id, player_id)` | skip if keeper already linked by that adult, else repoint; **never** drop a guardian who isn't already on the keeper | ✅ handled |
| 2 | `player_teams` | `(player_id, team_id) WHERE left_on IS NULL` | repoint; if both have a spell on one team, keep the **earliest `joined_on`** and the **latest/NULL `left_on`** (union the spell, don't drop it) | ⚠️ current version drops the loser's spell |
| 3 | `tags` + `clip_tags` | `uq_tags_team_player` | **per (team, player)**, not once globally: fold the loser's chip's `clip_tags` onto the keeper's chip for *that* team, preserving `bundle_number` and `stat_side`; then retire the loser's chip | ⚠️ current version picks ONE keeper tag for all teams |
| 4 | `game_lineups` | PK `(game_id, player_id)` | repoint, skip existing | ✅ handled |
| 5 | `videos.player_id` | — | repoint | ✅ handled |
| 6 | `shares.target_player_id` | — | repoint | ✅ handled |
| 7 | `team_player_permissions` | `(team, player, permission)` | repoint, skip existing | ✅ handled |
| 8 | `game_stat_lines` | `(game_id, player_id, stat_side)` | repoint, skip existing | ❌ **cascade today** |
| 9 | `event_attendance` | UQ `(event_id, player_id)` | repoint, skip existing | ❌ **cascade today** |
| 10 | `event_snack_signups` | — | repoint | ❌ SET NULL today |
| 11 | `notifications.target_player_id` | — | repoint | ❌ **cascade today (10 live rows)** |
| 12 | `player_guardian_seats` | `(player_id, granted_to_user_id) WHERE revoked_at IS NULL` | repoint; skip if the keeper already has a live seat for that adult | ❌ **cascade today — destroys a paid seat** |
| 13 | `player_guardian_codes` | PK `player_id` | keeper's code wins; **revoke** the loser's, don't cascade it away | ❌ cascade today |
| 14 | `followers` | UQ `(follower_user_id, scope, team_id, player_id)` | **D15:** repoint; on unique conflict keep the row with the more advanced `status` (`approved` beats `pending`) and drop the other — never drop a follower who isn't already present on the keeper. Flip the FK to RESTRICT. **No follower feature work beyond this** | ❌ cascade today |
| 15 | `players` **identity fields** | — | **carry non-NULL values from the retired row onto the keeper where the keeper's are NULL**: `photo_path`, `grad_class`, `first_name`, `last_name`, `preferred_name`, and `name` (only if the keeper's is a `#N` jersey sentinel). Never overwrite a non-NULL keeper value | ❌ **not handled — see §8.6** |
| 16 | `players` | — | set `merged_into_id/at/by`. **No DELETE.** | ❌ deletes today |

### 8.6 The identity fields the tombstone would abandon **FACT → DESIGN**

Adam's 2026-09-23 dependency list ("…highlights, photos, jersey/position data…") surfaced a gap in §8.2 that
neither v1 nor the audit caught. Verified against the live schema:

- **A child's photo is `players.photo_path` — a column on the identity row itself**, not a separate table. There is
  no `player_photos` table. **FACT**
- So when the merge retires PLAYER_B, **PLAYER_B's photo, grad class, and (after Slice F) name fields are
  abandoned** — they aren't repointed, because they were never on a dependent row. If the coach's placeholder had
  a photo and the parent's canonical row doesn't, the family loses the photo to a reconciliation that was supposed
  to be additive. Step 15 above fixes it: carry non-NULL → NULL, never clobber.
- **Highlights need no repoint.** `highlight_reels` has **no `player_id`** — reels attach via
  `source_clip_ids uuid[]` (clip ids) and `team_id`, so a reel follows the identity automatically through
  `clips → clip_tags → tags.player_id`. Nothing to move. **FACT**
- **Jersey / position data is `player_teams`-resident** and is handled by step 2's spell union. The legacy
  `players.jersey_number` is retired in Slice G. **FACT**
- **There is no AI / player-recognition / detection table in the schema at all** (`information_schema.tables`
  sweep for `%ai%`, `%recogni%`, `%detect%` → zero hits). There is nothing to reconcile, and whenever that layer
  is built it must key on `player_id`, never on a name or a chip label. **FACT**

Add to the §9.3 verification gates: **gate 11 — after a merge where only the retired row had a photo and a grad
class, the keeper carries both; where both rows had a photo, the keeper's is unchanged.**

### 8.3 Make "no cascade reliance" structural, not conventional **DESIGN**

Convention rots. Flip the history-bearing FKs so the database refuses to lose history even if a future code path
deletes a player:

`game_stat_lines`, `event_attendance`, `notifications.target_player_id`, `player_guardian_seats`, `followers`:
**ON DELETE CASCADE → RESTRICT.**

One consequence to handle in the same slice: `remove_roster_placeholder`'s blank-placeholder hard-delete must then
explicitly delete the child's `player_guardian_codes`, `tags` and `player_teams` rows first. It already deletes the
tags and spells; the guardian code currently disappears by cascade. **FACT**

### 8.4 Audit **DESIGN**

`admin_audit_log.detail` gets per-table counts, not `{kept, merged}`:
```json
{"kept":"…","retired":"…","authority":"guardian_both","request_id":"…",
 "moved":{"parent_player_links":1,"player_teams":1,"clip_tags":21,"tags":1,"game_lineups":2,
          "videos":0,"shares":0,"game_stat_lines":0,"event_attendance":0,"notifications":3,
          "player_guardian_seats":0,"team_player_permissions":0,"event_snack_signups":0,"followers":0},
 "skipped_as_duplicate":{"game_lineups":1}}
```
Enough for support to reconstruct or partially unwind. Not enough to promise the user a clean undo — see §8.5.

### 8.5 User-facing language **DESIGN**

**No "30-day reversal."** v1 proposed it; correction 7 is right that it's a lie, because `clip_tags` folded onto
one chip cannot be re-separated by origin — the rows are identical after the fold. The UI says:

> **Combining is permanent.** {Loser}'s teams, film, tags, stats and guardians move onto {Keeper}, and {Loser}
> stops existing in IamSports. Only IamSports support can undo this, and tagged clips can't be separated again.

Internally the tombstone + per-table counts give support a real (if imperfect) recovery path. That asymmetry —
permanent in the UI, recoverable by support — is the honest framing.

---

## 9. CORRECTION 8 — TEST HARNESS BEFORE ANY LIVE MERGE

**No live row is touched until the new merge passes on throwaway records that exercise every one of the 15 steps
in §8.2.** Conrad, Lars, Tommy, Neo, Max: untouched. **DESIGN**

### 9.1 Where

Local Supabase first (`docs/DEV_DATABASE.md`, the Docker stack built from the committed baseline), then a second
run on production against a **scratch team with throwaway players**, because local can't prove the live RLS
policies and the live `authorize_*` functions behave.

### 9.2 Fixture: two synthetic players with rows in every dependent table

`TEST_KEEP` and `TEST_DUP` on a scratch team, plus deliberate **collision** cases (rows that exist on *both* sides)
so the conflict rules are exercised, not just the happy path:

| table | keep | dup | collision case being tested |
|---|---|---|---|
| `parent_player_links` | adult A | adult A + adult B | A collides (skip), B moves |
| `player_teams` | Team S spell | Team S spell (earlier `joined_on`) + Team T spell | spell union on S, move T |
| `tags` + `clip_tags` | chip on S, 3 tagged clips | chip on S (4 clips, 1 the same clip+bundle) + chip on T (2 clips) | per-team fold, duplicate clip+bundle skipped, T's chip moved |
| `game_lineups` | 2 games | 2 games, 1 shared | PK conflict skipped |
| `videos`, `shares` | 1 each | 1 each | plain repoint |
| `game_stat_lines` | 1 row | 1 row same game+side | unique conflict skipped |
| `event_attendance` | 1 | 1 same event | UQ conflict skipped |
| `event_snack_signups` | 0 | 1 | repoint |
| `notifications` | 1 | 2 | repoint |
| `player_guardian_seats` | live seat for A | live seat for A + live seat for B | A skipped, B moved |
| `player_guardian_codes` | code | code | loser's revoked, keeper's kept |
| `team_player_permissions` | 1 | 1 same permission | conflict skipped |
| `followers` | 0 | 1 | repoint (pending Q2) |

### 9.3 Verification gates — all must pass

1. **Counts:** for all 14 tables, `before(keep) + before(dup) = after(keep) + skipped_as_duplicate`. Zero
   unexplained losses. Run as one before/after snapshot query, output pasted into the post-code report.
2. **Zero rows anywhere still reference `TEST_DUP`** — sweep all 14 tables plus the 4 views.
3. **`TEST_DUP` still exists** with `merged_into_id = TEST_KEEP`, and is invisible to a guardian and to a coach
   (`players_read`), visible to super admin.
4. **Clips:** every clip that was tagged with either chip is still tagged, with `bundle_number` and `stat_side`
   intact. Verify with `clipMatchesGroup` semantics — a group that matched before still matches after
   (this is the tag-bundle invariant from CLAUDE.md; a botched fold would break export).
5. **Film authorization:** as adult A and as adult B, `authorize_video_playback` returns a path for every video
   either could see before. As an unrelated user, still denied. **This is the test that catches a merge that
   silently drops a guardian.**
6. **Stats:** `resolved_game_stats` and `game_box_score` for the affected games return the same totals, now
   attributed to `TEST_KEEP`.
7. **Lineups:** `game_lineups` has one row per game, no duplicates, no games lost.
8. **Idempotency:** re-run the same merge with the same `request_id` → no-op, no second audit row.
9. **Rollback:** the whole thing in one transaction; a forced failure at step 12 leaves the database bit-identical
   (verify with the same before-snapshot).
10. **Playback audit green** before and after (CLAUDE.md standing requirement).

Only when 1–10 pass on both local and a production scratch team does Slice E open — and then **you name one group
at a time**, and each group gets its own before/after evidence.

---

## 10. CORRECTION 9 — NAME MODEL

### 10.1 Columns **DESIGN**

`first_name`, `last_name`, `preferred_name` — all nullable, all additive. **`players.name` is untouched** and
remains the historical/full-name value and the final display fallback.

### 10.2 No backfill **DESIGN**

v1 proposed splitting `name` on the first space. Correction 9 is right to kill it. Live `players.name` values
include: `"Lars Masten"` (clean), `"Austin"` / `"Will"` / `"Max"` / `"Towns"` (first-name-only),
`"Alex D."` (initial-as-surname), and `create_roster_placeholder` writes **`"#12"`** for a number-only slot —
the name column doubles as a jersey sentinel. **FACT**

A blind split would produce `last_name = "D."`, `last_name = NULL` for half the roster, and `first_name = "#12"`.
So: **the new columns start NULL for all 49 rows and are populated only when a human types them** — a guardian in
the kid editor, or a coach on an unclaimed placeholder. No migration writes them. Ever.

### 10.3 Display fallback (display only, never identity) **DESIGN**

```
preferred_name
  → first_name
  → legacy parse of name:   name LIKE '#%'  → name as-is (the jersey sentinel)
                            else            → split_part(name, ' ', 1)
```
and for the disambiguating surname initial:
```
last_name
  → legacy parse: the LAST whitespace-separated token of name, when there are ≥2 tokens
    (not split_part(name,' ',2) — that returns the MIDDLE name for "William Jackson Smith")  ← fixes a live bug
  → NULL (fall through to jersey, then to numeric suffix)
```

This chain lives in **exactly one place** — `player_chip_label` — and every chip-writing path calls it (§12 F).

**None of `preferred_name`, `first_name`, `last_name`, or `name` is ever an identity key**, a join key, a
dedupe key, an idempotency key, or a stats grouping key. The one place that violates this today is
`season_player_stats`, which groups by the name string and joins games-played on `p.name`. It is **not consumed by
any app code** (**FACT**, grepped), so Slice F rewrites it to group on `player_id` before anything reads it.

---

## 11. CORRECTION 10 — CLAIM UX (approved)

### 11.A Parent joins a new team and already has children

```
Enter team code
   ↓  preview_roster_by_code
┌─────────────────────────────────────────────┐
│ Which of your players is joining Team B?    │
│                                             │
│ YOUR PLAYERS                    ← FIRST     │
│  [ Lars Masten      · on Team A ]           │
│  [ Conrad Masten    · on Legends ]          │
│  [ Penelope Masten                 ]        │
│                                             │
│ OPEN SPOTS ON THIS ROSTER                   │
│  [ Lars #12 ]  [ Jackson #7 ]  …            │
│                                             │
│ [ Add a new player ]            ← LAST      │
└─────────────────────────────────────────────┘
```
Existing players first, unconditionally, regardless of name similarity. Tapping one → `join_team_with_code`
(today's correct path). This inverts [join-team.tsx](../app/join-team.tsx)'s current hierarchy, where the reuse
list is hidden behind "My player isn't listed" and sits above "Or add a new player".

### 11.B Parent taps a coach-created roster entry

```
Lars #12 · Team B
┌──────────────────────────────────────────────┐
│ Is this one of your existing players?        │
│  [ Lars Masten    · Team A, 44 clips ]       │
│  [ Conrad Masten  · Legends           ]      │
│  ───────────────────────────────────────     │
│  [ No — this is a different child ]          │
└──────────────────────────────────────────────┘
```
- **Shown whenever the parent has ≥1 existing child.** Not gated on name similarity, not gated on a matcher.
- **"Lars Masten"** → reconcile the coach-created record **into** the durable Lars identity: its `player_teams`
  spell, chip, `clip_tags`, lineups and stats move onto `PLAYER_A`, and the placeholder is retired with a
  tombstone. Authority: **§7.2 case 3** — the parent holds a valid team code and the placeholder is unclaimed, so
  no separate coach confirmation is needed. Idempotent via a request id (§3.2).
- **"No — a different child"** → today's `claim_roster_spot`, plus a **guardian-tier dismissal** for that pair
  (§6.2) so they are never paired again.
- Cross-org rule (§5.3): this screen is a *guardian* surface, so naming "Team A" is fine here. The equivalent
  coach-facing screen may not name teams the coach isn't on.

### 11.C / 11.D

Second guardian (`/claim-kid` + per-player code) and genuinely-new-child are unchanged in shape; the new-child path
gets the request id (§3) and the two-RPC "Add & join" becomes one transactional RPC.

---

## 12. REVISED SLICE PLAN (correction 12 order: A–G)

Every slice runs CLAUDE.md invariant 7: **pre-code report → your paste-approval → code → post-code report → your
paste-approval → commit.** No slice starts without an explicit go. Slices are independently shippable and
independently revertible.

---

### SLICE A — stop the bleeding
**Satisfies:** corrections 1, 2 (partly) · **Risk:** none — strictly subtractive plus one bug fix

1. **DB:** `suggest_duplicate_players` → immediate empty return, signature unchanged (§2.1). Kills the banner on
   every installed build.
2. **DB:** fix `create_kid` — drop `user_id` from the INSERT. Unblocks "Add a kid", "Add & join", and onboarding.
3. **Client:** remove the duplicate banner + merge chooser from `roster.tsx`.

**Why first:** #1 removes a live destructive false positive; #2 un-breaks a dead primary flow. Neither depends on
anything else, and neither touches data.
**Baseline/verification:** replay the suggester predicate → confirm it returns 0 rows for every team; call
`create_kid` on a scratch account and confirm one teamless player + one guardian link + one guardian code;
confirm the banner is gone on web *and* on the installed TestFlight build (that's the one that proves #1 worked).
**Do NOT** touch `merge_players` in this slice.

---

### SLICE B — safe, tombstone-based reconciliation
**Satisfies:** corrections 6, 7, 8 · **Risk:** medium (rewrites a destructive function) — but no live row is merged

1. Schema: `merged_into_id` / `merged_at` / `merged_by_user_id` + CHECK; `creation_request_id` + scoped unique index.
2. FK hardening: 5 CASCADE → RESTRICT (§8.3), plus explicit cleanup in `remove_roster_placeholder`.
3. Rewrite `merge_players` → `reconcile_players(p_keep, p_retire, p_request_id)`: all 15 steps (§8.2), per-team
   tag fold, spell union, tombstone instead of DELETE, per-table audit counts (§8.4).
4. Authority matrix (§7.2) enforced in the function — **including tightening today's wrong coach branch**.
5. `player_merge_requests` + the request/confirm RPCs (§7.3).
6. **The §9 test harness.** Local, then a production scratch team. All 10 gates green, output pasted.

**Explicitly NOT in this slice:** merging any real row. The Jackson pair is already unreachable after Slice A.
**Verification:** §9.3 gates 1–10.

---

### SLICE C — global identity vs team relationship (RLS + field ownership)
**Satisfies:** corrections 3, 5 · **Risk:** medium (RLS) — mitigated by there being **zero** direct client writes (§4.5)

1. Helpers: `is_current_team_member_of_player`, `is_current_team_coach_of_player`, `player_has_guardian`.
2. Policy rewrites per §4.4 — `players_read/insert/update/delete`, `parent_player_links_read/insert/delete`
   (closes **F14**). `player_teams_read` unchanged.
3. Split `update_kid_profile` → `update_player_identity` (family) + `update_player_team_details` (coach of that
   team); keep the old name as a deprecated shim for installed builds.
4. **`kid_team_audience`: drop the coach branch** (§5.2 — the live cross-org leak).
5. Definer RPC for the guardian **counts** the Roster tab reads at [roster.tsx:100](../app/(tabs)/roster.tsx#L100),
   since `parent_player_links_read` loses its coach branch.

**Fixes as a side effect:** the "Unnamed" roster row and the box-score disappearance for multi-team children (F2).
**Verification:** re-run `test_rls_escalation.sql`; as a coach of Centex Attack Regents who is *not* on Centex2026,
confirm Lars `e34c2405` now reads correctly on the roster **and** appears in the box score; confirm a coach can
still name an *unclaimed* placeholder and can *no longer* rename a *claimed* child; confirm `kid_team_audience`
raises for a coach; cross-surface check (web + native, a flag team and a basketball team).

---

### SLICE D — existing-child-first claim + reconciliation
**Satisfies:** correction 10; consumes B and C · **Risk:** low (mostly client)

1. Reorder [join-team.tsx](../app/join-team.tsx): the parent's existing players first, roster spots second,
   "Add a new player" last (§11.A).
2. "Is this one of your existing players?" interstitial before any `claim_roster_spot` (§11.B), shown whenever the
   parent has ≥1 child.
3. "This is my Lars" → `reconcile_players` under §7.2 case 3, with a request id.
4. One transactional `create_kid_and_join(name, code, request_id)` replacing the two-RPC sequence.
5. `player_match_dismissals` (§6.2) — needed now, because "No, a different child" must record a determination.

**Verification:** with a parent account holding a kid, run all four branches (existing-kid attach; claim a
placeholder and reconcile; claim a placeholder as a genuinely different child; add a new child) and verify
`players`/`player_teams`/`parent_player_links`/`tags` counts after each; double-tap every button to prove
idempotency.

---

### SLICE E — reconcile the real live duplicates
**Satisfies:** correction 8 · **Risk:** high (real data) — hence last among the corrective slices

Opens only after B's 10 gates are green and C is shipped. **You** name each group; I never infer one.
Candidates, one group per approval, each with its own before/after evidence:

| group | rows | authority case (§7.2) |
|---|---|---|
| Lars Masten | `e34c2405` (keep, 80 clips) ← `f3924843` (empty) | case 2 — `smmasten@` holds both |
| Conrad Masten | `1b95a1c4` (keep) ← `4637e2d0` (empty) | case 2 — `smmasten@` holds both |
| Conrad Masten | `1b95a1c4` ← `045968e6` (21 clips) and `25411e20` (11 clips) | **case 4** — unclaimed, different teams: guardian request + coach confirm per team |
| Tommy Allen | `2844aaa8` (5 clips) / `0475cd77` (guardian, empty) | case 4 |
| Neo | `8be773b5` (16 clips) ← `2f7540e9` (empty) | case 2 — `aaronfcastillo@` holds both |
| **Max** | `1bbcbb28-6552-46c5-b828-2646aac2b26d` (Centex Attack Regents, 13 clips, 5 lineups, **1 guardian** `jcostello1972@`) / `0e92a2ee-3b24-43ba-be6f-a714c8b5c367` (Centex2026 6th Grade, 8 clips, 1 lineup, **0 guardians**) | **D16 — identity confirmed by Adam.** But **authority is unresolved: Adam is not a guardian of either row.** Structurally this is **case 4** (one claimed by another family, one unclaimed, different teams) → the Costello guardian requests + a coach of the unclaimed row's team confirms; or Adam executes it as **super admin / support** with explicit audit. **§13 Q1** |

---

### SLICE F — name model + one shared label function
**Satisfies:** correction 9 · **Risk:** low

1. Add `first_name`, `last_name`, `preferred_name` (nullable). **No backfill.**
2. `player_chip_label` becomes the single source of display naming, with the §10.3 fallback chain — including the
   **last-token** surname fix (today's `split_part(name,' ',2)` returns the *middle* name).
3. Route **every** chip-writing path through it: `ensure_player_tag` (already does), and
   `attach_kid_to_team` + the new `update_player_identity` / `update_player_team_details` (which today use the
   naive formula and re-create identical chips — **F9**).
4. Add `UNIQUE (team_id, lower(name)) WHERE category='players'` so two chips on one team can never be
   indistinguishable again.
5. Rewrite `season_player_stats` to group on `player_id` instead of the name string (§10.3). Safe — nothing reads
   it yet (**FACT**).
6. Kid editor + roster editor UI for the three new fields, under the Slice C ownership rules.

**Note the overlap with Slice C:** both touch `update_kid_profile`'s successors. Either do the RPC split in C and
the label routing in F (two passes over one function), or fold F.3 into C. My recommendation: keep them separate —
C is an authorization change and F is a display change, and mixing them makes the diff audit harder.
**Verification:** the existing chip labels for all 41 player tags before/after — only the intended ones change;
specifically confirm the Regents Bangels Jacksons stay distinguishable; export baseline unchanged.

---

### SLICE G — retire the legacy columns
**Satisfies:** the cleanup rule + invariant 4 · **Risk:** medium, gated on install confirmation

Drop `players.team_id`, `players.season_id`, `players.jersey_number` — **only** after:
1. No DB policy, function, view, or trigger references them (full `pg_get_functiondef` + `pg_policies` sweep, zero
   hits, output pasted).
2. No repo code references them (`grep`, zero hits — today [player-links.ts:25](../lib/core/player-links.ts#L25),
   [context.tsx:151](../context.tsx#L151), and `create_roster_placeholder` all do).
3. A build that reads none of them is **confirmed installed on your phone** — invariant 4, additive-first: ship
   the reading build, confirm, *then* migrate.
4. The 7 rows whose `players.team_id` has no matching spell are reconciled (they'd lose their only team pointer).

Also in G: decide `player_lineage_id`'s fate (§13 Q1) — wire it into `reconcile_players` as the pre-merge
"same human" marker, or retire it and `/link-players` with it. Leaving it half-populated and unread is the one
option I'd argue against, because it currently signals "identity handled" while doing nothing.

---

### Dependency graph

```
A ─┬─> B ─┬─> D ──> E
   │      └─> (test harness gates E)
   └─> C ─┴─> D
              F ──> G
```
A is independent. B and C are independent of each other and can run in parallel. D needs both. E needs B's gates
green and C shipped. F is independent of B–E but should follow C. G is last and needs an install confirmation.

---

## 13. OPEN QUESTIONS

Q2–Q5 of the previous round are resolved as D12–D16. **One genuinely new question remains, created by D16.**

### Q1 (NEW, blocks Slice E's Max group only) — who has authority to execute the Max reconciliation?

D16 confirms the identity. It does not supply the authority, and under D7/D13 **Adam is not eligible as a
guardian** — he is a guardian of neither row. **FACT:**

| row | team | guardians | content |
|---|---|---|---|
| `1bbcbb28-6552-46c5-b828-2646aac2b26d` | Centex Attack Regents (Basketball) | **1 — `jcostello1972@gmail.com`** | 13 tagged clips, 5 lineups |
| `0e92a2ee-3b24-43ba-be6f-a714c8b5c367` | Centex2026 6th Grade (Basketball) | **0** | 8 tagged clips, 1 lineup |

One row is claimed by **another family**; the other is unclaimed; they are on **different teams**. So:
- **Case 1** (coach consolidates two unclaimed placeholders on one team) — does not apply: one is claimed, and the
  teams differ.
- **Case 2** (same guardian on both) — does not apply: Adam holds neither link.
- **Case 4** applies structurally: the **Costello guardian requests**, and a coach of the unclaimed row's team
  (Centex2026 6th Grade — Adam) confirms.
- **Super-admin path** also applies: Adam executes it as support, explicitly audited.

**Recommendation:** route it through **case 4**, not super admin. The identity confirmation is Adam's, but the
claimed row belongs to the Costello family, and their child's film and stats are what moves. Asking them to
confirm costs one notification and makes the first real reconciliation in the product a demonstration of the rule
rather than an exception to it. Reserve the super-admin path for cases where no guardian is reachable.

**Needs Adam's decision:** case 4 (ask the Costello family) or super-admin/support execution.

### Resolved, and one upgrade it produced

**D16 retroactively validates `player_lineage_id`.** The only lineage link in the live database is exactly this
Max pair — and Adam has now confirmed it is correct. `link_players` is already explicit-confirmation-only and never
automatic (`migration_player_lineage_linking.sql`), which makes `player_lineage_id` a **record of a human identity
assertion** — precisely the evidence class D5 asks for. **FACT**

So the Slice G question flips: **do not retire lineage — promote it.** It becomes the place where "a human confirmed
these are the same child" is persisted *before* reconciliation runs, which is a real need (D16 is that state right
now, and it has nowhere else to live). Two fixes required if promoted:
- Backfill/maintain it — **22/49 rows are NULL** and nothing sets it on insert; it needs a default or a trigger.
- Fix `loadCoachPlayers` ([player-links.ts:25](../lib/core/player-links.ts#L25)), which filters on the legacy
  `players.team_id` and therefore cannot see teamless children — the very rows most in need of linking.

Folded into Slice G as a definite scope item rather than an open question, and §6.1's conflict list gains lineage
as a third qualifying signal (a recorded human assertion, not a guess).

---

**Nothing above is implemented.** No code written, no migration created, no data modified, nothing deployed.
Awaiting your go on Slice A.

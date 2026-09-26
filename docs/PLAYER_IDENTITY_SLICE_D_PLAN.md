# Slice D — Player/Child Identity Claim & Reconciliation

**Date:** 2026-09-26 · **Status:** AUDIT + DESIGN ONLY. No code, no migrations, nothing applied.
**Base:** `main` = `fa6f9cd` (C.5 shipped). Decision log: `docs/PLAYER_IDENTITY_PLAN_v2.md` (D1–D16).
**Tags:** **FACT** = verified against live production/code today · **DESIGN** = proposed · **OPEN** = needs Adam.

---

## 0. THE FINDING THAT CHANGES THIS SLICE'S PRIORITY

**`merge_players` is still live, still destructive, and still callable by non-super-admins.** **FACT**

```
grants        : PUBLIC, anon, authenticated, postgres, service_role
internal gate : is_super_admin()
                OR (is_linked_parent(keep) AND is_linked_parent(dup))
                OR EXISTS (coach of a team BOTH players are on)      <-- the hole
hard-deletes  : `delete from players where id = p_dup`               = true
repoints event_attendance : false      -> CASCADE-deleted
repoints game_stat_lines  : false      -> CASCADE-deleted
```

Slice A removed the *banner and chooser* from the Roster tab. It did **not** remove the RPC, and
PostgREST exposes every granted function. So today a coach of a team that two children share can
destroy one of them with a single REST call — no UI required. On current data that means a coach of
Regents Bangels can merge **Jackson Schneider** and **Jackson Tochman** (two different children,
7 and 5 tagged clips) and the losing child's row, guardian code, notifications and stat lines go
away.

None of plan v2 §8's safety infrastructure was ever built: **FACT**

| object | exists? |
|---|---|
| `reconcile_players` (the safe replacement) | **no** |
| `players.merged_into_id` / `merged_at` / `merged_by_user_id` (tombstone) | **no** |
| `player_match_dismissals` | **no** |
| `player_merge_requests` | **no** |

So Slice D is not only a UX improvement. Its first job is to close a live destructive RPC.
Recommended as **Slice D0**, ahead of any UX work (§6).

---

## 1. CURRENT-STATE ARCHITECTURE AND THE EXACT FAILURE MODE

### 1.1 What exists today **FACT**

```
players                       53 rows.  id, team_id(LEGACY), name, jersey_number(LEGACY),
                              created_at, season_id(LEGACY), player_lineage_id, grad_class, photo_path
player_teams                  50 rows.  player_id, team_id, jersey_number, season_id,
                              joined_on, left_on, left_at, added_by_user_id
parent_player_links           12 rows.  parent_user_id, player_id, relationship, receives_logistics_alerts
                              UQ (parent_user_id, player_id).  relationship: 'parent' x9, 'guardian' x3
tags (category='players')     51 rows with a player_id.  UQ (team_id, player_id)
player_lineage_id             26 of 53 NULL; only 2 rows actually grouped (the Max pair)
```

### 1.2 The population shape is the real story **FACT**

| | count |
|---|---|
| players with **no guardian at all** | **44 of 53** |
| of those, players that **already carry tagged clips** | **36** |
| players with more than one guardian | 2 |
| teamless players (parent-created) | 4 |

**Most of the tagged history in this system currently hangs off player rows that no family owns.**
That single fact drives the whole design: the common case is not "a family has a child and a coach
duplicates them", it is "a coach-created record accumulates real history for months, and a family
arrives later". Reconciliation must therefore be a first-class, safe, *frequent* operation — not an
admin edge case.

### 1.3 The exact failure mode — traced end to end

**Step 1.** Coach runs `create_roster_placeholder(team, name, jersey)`. **FACT**
Creates a `players` row with `team_id` stamped, a `player_teams` spell, a chip via
`ensure_player_tag`, **and immediately mints an 8-char guardian code**. The child now exists as a
global identity with no owner. Tagging accrues `clip_tags`; `sync_lineup_from_clip_tag` writes
`game_lineups`; `snapshot_game_lineup` adds more.

**Step 2.** A parent opens `/join-team`, enters the team code, and `preview_roster_by_code` returns
**every** roster entry as `{player_id, first_name, jersey, claimed}`. **FACT**

**Step 3.** The UI renders **the roster list first** (`app/join-team.tsx:119`). The
existing-children list is hidden behind a text link "My player isn't listed"
(`:138`–`:147`), and "Or add a new player" sits directly beneath it (`:155`). **FACT**
So the easiest action on screen is "claim this roster row", and the correct action
("this is my existing Lars") requires declining the obvious one first.

**Step 4.** Tapping a roster row calls `claim_roster_spot`, which: **FACT**
- blocks if **any** parent link already exists ("already claimed") — correct guardrail
- **hardcodes `relationship = 'parent'`** for the claimer
- makes **no attempt whatsoever** to consult the caller's existing children

**Step 5.** The claimer is now the `'parent'`. `remove_guardian` gates on the relationship *text* —
a `'parent'` may remove a `'guardian'`, never the reverse. **FACT** So:
- the wrong adult is permanently primary
- the real family, arriving later via the guardian code, is `'guardian'` and **cannot remove them**
- the wrong adult **can** remove the real family
- and because `regenerate_guardian_code`/`revoke_guardian_code` gate on `is_linked_parent`, the
  wrong adult can rotate the code the real family needs

**Step 6.** Nothing merges the duplicate. `suggest_duplicate_players` is retired (returns zero rows,
Slice A). `player_lineage_id` is written only by `/link-players` and **read by nothing that grants
access** — `link_players` performs no data movement at all. **FACT**

### 1.4 A latent bug C.5 introduced — two disagreeing definitions of "primary" **FACT**

| mechanism | definition of primary |
|---|---|
| `is_primary_guardian()` | the link with the **earliest `created_at`** |
| `remove_guardian()` | the link whose **`relationship = 'parent'`** |
| `admin_set_primary_guardian()` (C.5) | **rewrites `relationship`**, does not touch ordering |

`is_primary_guardian()` is referenced by the **`shares.shares_read` RLS policy**. Today 0 rows
disagree, because no transfer has run in production yet. **The first time
`admin_set_primary_guardian` is used, these two definitions diverge — and a live RLS policy depends
on the one that is not updated.** Slice D must unify this, which is a good reason to stop encoding
authority in a free-text column at all (§5.3).

---

## 2. D1–D16 RECONCILED AGAINST ACTUAL CODE

| # | decision | state in code today |
|---|---|---|
| D1 | `players.id` = one durable child; identity global; access relationship-scoped; names never identity | **partly.** Global identity works (Lars `e34c2405` = 1 id, 2 teams, 2 chips, 80 clips). But `players.team_id`/`season_id`/`jersey_number` still exist and `players.team_id` is still written by `create_roster_placeholder` and `join_team_with_code`. **Conflict: legacy columns not retired.** |
| D2 | disable the name-based suggester | ✅ done (Slice A) — returns zero rows |
| D3 | no name-based idempotency; explicit request UUID | ❌ **not built.** `create_kid` still has no key; double-tap still makes two children |
| D4 | family owns identity fields, team owns relationship fields | ❌ **not built.** `update_kid_profile` still writes `players.name` + `jersey_number` + `grad_class` in one call, gated on `is_linked_parent OR super OR is_team_coach(players.team_id)` |
| D5 | no DOB; resolution by explicit guardian confirmation | ✅ honoured (no DOB added) |
| D6 | cross-org: a coach must not learn a child's other clubs | ✅ mostly — `player_teams_read` is per-row team-scoped. ⚠️ `kid_team_audience` still returns every open team + each team's coach list, gated on coach of the **legacy** `players.team_id`. **Conflict: still open** (C.5 scoped it out) |
| D7 | merge authority matrix (5 cases); coach may only FLAG | ❌ **not built.** `merge_players` still has the coach-of-both gate |
| D8 | tombstone, never hard-delete; repoint all 14; no cascade reliance; full audit | ❌ **not built.** Still hard-deletes; 9 FKs still CASCADE |
| D9 | no live merge until safety + test gates pass | ✅ honoured — no live merge has been run |
| D10 | `first_name`/`last_name`/`preferred_name`, no blind split | ❌ **not built.** `players.name` is still the only name field |
| D11 | claim UX offers existing children first, unconditionally | ❌ **not built.** Roster list still first; existing children still behind a link |
| D12 | dismissal re-surfaces once, only on new hard relationship evidence | ❌ **not built** (no `player_match_dismissals`) |
| D13 | case 4 = guardian requests + coach of the unclaimed row confirms; in-claim-flow the team code is the coach-side authorisation | ❌ **not built** |
| D14 | former coach loses the current profile; former team keeps historical material | ❌ **not built.** `players_read` is still `is_team_member(players.team_id) OR is_linked_parent(id)`. The `resolved_game_stats` "TEAM" relabel trap identified in plan v2 §5.4 is **still latent** |
| D15 | followers: preserve, union/repoint, RESTRICT, no feature work | ❌ **not built** |
| D16 | Max is a confirmed identity match, Slice E candidate, case-4 authority | still pending; both rows intact, still `same_lineage = true` |

**Net:** of D1–D16, three are done (D2, D5, D9), two are partly honoured (D1, D6), and **eleven are
unbuilt**. C.5 deliberately took only the security subset. Slice D is where the identity model
itself gets built.

---

## 3. DATA-MODEL AUDIT (the explicit questions)

**What represents a global child identity today?** `players.id`. It is genuinely global and already
proven to span teams. But the row also carries three team-shaped legacy columns (`team_id`,
`season_id`, `jersey_number`) and `players.team_id` is still the **RLS key** for `players_read`,
`players_update`, `players_delete` and `parent_player_links_read`. **FACT**

**What represents team membership?** `player_teams`, as dated spells: `joined_on`, `left_on`,
`season_id`, plus `UQ (player_id, team_id) WHERE left_on IS NULL`. This is correct and already
supports multi-team, multi-season, multi-sport. **FACT**

**Can a roster player exist before family ownership?** **Yes — and that is the normal case.**
`create_roster_placeholder` creates a fully functional, taggable child with no guardian. 44 of 53
live players are in exactly this state, 36 of them with clips. **FACT**

**Where does team-specific data live?** Correctly on `player_teams` (`jersey_number`, `season_id`,
spell dates). Position / roster status / captain / depth chart **do not exist yet**. The legacy
`players.jersey_number` is still written by `update_kid_profile`. **FACT**

**How does team history attach to a player?** Four independent paths, all keyed on `players.id`:
`player_teams` spells (50 rows), `game_lineups` (137), the team-scoped chip `tags.player_id` (51),
and `videos.player_id` (6). Season history is derived from spell dates against `seasons`
(`roster_for_season`, `was_on_roster`, `is_roster_parent`). **FACT**

**How do clips/tags/highlights reference players?** Clips reference players **only through the chip**:
`clip_tags.tag_id → tags.player_id`. Highlight reels reference **clip ids**
(`highlight_reels.source_clip_ids uuid[]`) and carry **no `player_id` at all**, so reels follow the
identity automatically. Stats derive from `clip_tags`+`tags` via the `stat_events` view. **FACT**

**What breaks if two identities are reconciled?** The full dependency set, with live row counts:

| on delete | table | live rows |
|---|---|---|
| **CASCADE** | `player_teams` | 50 |
| **CASCADE** | `player_guardian_codes` | 47 |
| **CASCADE** | `notifications.target_player_id` | 10 |
| **CASCADE** | `shares.target_player_id` | 3 |
| **CASCADE** | `event_attendance`, `game_stat_lines`, `player_guardian_seats`, `followers`, `team_player_permissions` | 0 each |
| SET NULL | `game_lineups` | 137 |
| SET NULL | `tags` | 51 |
| SET NULL | `videos` | 6 |
| SET NULL | `event_snack_signups` | 0 |
| **RESTRICT** | `parent_player_links` | 12 |

`parent_player_links` being RESTRICT is the only reason a naive `delete from players` fails today
for a claimed child — and it is exactly why `merge_players` deletes the links first.

**Repoint-and-tombstone, or an alias/canonical-ID model?** **RECOMMENDATION: repoint + tombstone.**
An alias model (`players.canonical_id`, resolve at read time) would require every read path —
`tags`, `clip_tags`, `game_lineups`, `videos`, `shares`, `notifications`, the four stats views, and
every `authorize_*` function — to resolve through the pointer. That is a large, high-risk rewrite of
the exact code paths that gate child film. Repointing is a bounded, testable operation over 14
known FKs, and the tombstone (`merged_into_id`) gives the *one* property an alias model is really
wanted for: a stale `player_id` still resolves. Keep the tombstone, skip the alias table.

**How do guardian relationships determine authority today?** Entirely through `parent_player_links`.
`is_linked_parent(player_id)` is the single gate, used by `authorize_video_playback`,
`authorize_reel_playback`, `authorize_photo_view`, `clip_involves_my_kid`, `is_roster_parent`,
`game_lineups_read`, `player_guardian_codes_read`, `players_read` and more. **Nothing reads
`player_lineage_id` for access.** **FACT**

**What does `relationship='parent'` technically mean?** A free-text column with no constraint,
carrying three distinct meanings that are not separated: (a) "first adult to arrive"
(`claim_roster_spot` hardcodes it; `claim_or_link_guardian` assigns it when `n=0`), (b) "may remove
other guardians" (`remove_guardian`), (c) nothing at all in the access path — every
`is_linked_parent` check treats `'parent'` and `'guardian'` identically. **FACT**

**Do we need a singular primary long term?** **RECOMMENDATION: no — not as identity authority.**
Something must break ties for a small set of *actions* (removing another guardian, revoking a code,
approving a reconciliation). But "first to arrive" is the wrong basis, a free-text column is the
wrong storage, and two disagreeing definitions already exist (§1.4). Replace it with an explicit,
auditable **role** on the link plus a verification state (§5.3).

---

## 4. THREAT / ABUSE CASES — behaviour after Slice D **DESIGN**

| | case | after Slice D |
|---|---|---|
| **A** | Correct parent claims coach-created child first | Interstitial offers their existing children first. If it *is* a new child for them, they claim it; the roster record becomes `verified`, they become `guardian` with `can_manage_guardians`. History stays put — no merge needed. |
| **B** | **Wrong adult claims first** | Claim of an *unclaimed* roster record no longer confers primacy. The record enters `claimed_unverified`: the claimer sees film, but **cannot** remove other guardians, rotate the guardian code, or edit global identity fields. A second adult arriving with the coach-issued guardian code is admitted normally, and a **dispute** is raised to the coach + super admin. The wrong adult can be removed by `admin_remove_guardian` without first needing a replacement primary. |
| **C** | Divorced/separated parents both need access | Both link to the **same** `player_id` via the guardian code; both get full film access; neither can remove the other (removal requires `can_manage_guardians`, which is not granted by arrival order). Already structurally supported by `UQ (parent_user_id, player_id)`. |
| **D** | Grandparent joins before a parent | Same as C. The grandparent is a guardian, not an owner. `relationship` becomes descriptive metadata only. No blocking, no primacy. |
| **E** | Coach and parent independently create records | Two `players` rows exist. The claim interstitial surfaces the parent's existing child *before* the roster row, so the common path avoids the duplicate entirely. If it already happened, `reconcile_players` folds the coach record into the family's canonical child, preserving the team spell, chip, clips, lineups and stats. |
| **F** | Same-name children are actually different | Nothing auto-suggests them (no name matching exists post-Slice A). If a human flags them, "Different children" writes a `player_match_dismissals` row that is permanent, and re-surfaces only on new *recorded relationship* evidence (D12). Jackson Schneider / Jackson Tochman stay separate. |
| **G** | Existing child joins a new org where a duplicate exists | The interstitial offers the existing child. Choosing it triggers **in-flow reconciliation** authorised by the coach-issued team code (D13 case 3) — the coach record's spell and history move onto the canonical child. |
| **H** | Two duplicates have **different** guardian sets | **No unilateral merge.** A `player_merge_request` is created; the other guardian side must confirm, or a super admin adjudicates. A coach may only **flag**. This is the safety boundary and the one case where slowness is correct. |
| **I** | Malicious adult holds a leaked guardian code | They can still link (the code is a bearer token — unchanged, and C.5 throttles guessing). But they land as `claimed_unverified`/guardian with no management rights, existing guardians are **notified**, and `admin_remove_guardian` can remove them cleanly. The blast radius shrinks from "owns the child" to "saw film until removed". |
| **J** | Admin repairs a historical relationship | `admin_remove_guardian` and `admin_set_primary_guardian` already exist from C.5 and are audited + notified. Slice D must fix their interaction with the two-definitions bug (§1.4). |

---

## 5. PROPOSED MODEL **DESIGN**

### 5.1 Identity stays where it is
`players.id` remains the durable child. **No new identity layer, no alias table, no child accounts.**
Retire `players.team_id` / `season_id` / `jersey_number` (D1), which also removes the RLS dependence
on a legacy column (D14).

### 5.2 A roster record gets an explicit lifecycle
New column, replacing the implicit states the code infers today:

```
players.identity_state  text not null default 'provisional'
   'provisional'        coach-created, no guardian. Team can tag and function.
   'claimed_unverified' an adult has linked, but no verification event yet.
   'verified'           a guardian arrived via a coach-issued per-player code,
                        or a super admin verified, or a second guardian corroborated.
   'retired'            tombstoned into another identity (merged_into_id set).
```
This makes "44 of 53 are provisional" a visible, queryable fact rather than an inference, and it is
what lets claim stop conferring authority.

### 5.3 Authority moves off `relationship` onto explicit capability
```
parent_player_links.relationship          -> DESCRIPTIVE ONLY ('parent','guardian','grandparent',…)
parent_player_links.can_manage_guardians  boolean not null default false
parent_player_links.verified_at           timestamptz
```
- `can_manage_guardians` is granted by: arriving with a coach-issued per-player guardian code, an
  existing manager granting it, or a super admin. **Never by arrival order.**
- `is_primary_guardian()` is redefined to read `can_manage_guardians` — which also repairs the
  `shares.shares_read` divergence in §1.4.
- `remove_guardian()` gates on `can_manage_guardians` instead of `relationship = 'parent'`.
- Backfill: the 9 existing `'parent'` rows get `can_manage_guardians = true` (they are all
  legitimate today — 0 rows currently disagree), the 3 `'guardian'` rows get false.

### 5.4 Reconciliation: repoint + tombstone
Build `reconcile_players(p_keep, p_retire, p_request_id)` exactly as designed in plan v2 §8.2:
all 15 steps, per-(team,player) chip fold, spell union, identity-field carry-over (§8.6), full
per-table audit counts, **no hard delete**, and flip the five history-bearing FKs from CASCADE to
RESTRICT so convention becomes structure. Authority per the D7 matrix. Idempotent via request id.

### 5.5 Claim UX (D11)
Existing children first, unconditionally, never gated on name similarity. Roster spots second.
"Add a new player" last. Choosing an existing child performs in-flow reconciliation under D13
case 3.

### 5.6 Quiet duplicate suggestion (D12)
`list_identity_conflicts()` built only from **recorded relationships** — the same adult holding links
to both rows, an explicit human assertion (`player_lineage_id`, which D16 retroactively validated as
a human-confirmation record), or a coach flag. Never names. `player_match_dismissals` with
`least/greatest` normalisation and one-shot re-surface.

---

## 6. SLICE PLAN **DESIGN — for approval, nothing built**

| slice | content | risk |
|---|---|---|
| **D0** | **Close `merge_players`.** Revoke EXECUTE from PUBLIC/anon/authenticated (super admin only in the interim), or replace the body with a hard refusal. Zero client callers exist. **Do this first, independently.** | none — pure subtraction |
| **D1** | `reconcile_players` + tombstone columns + FK CASCADE→RESTRICT + the §9 full-coverage test harness from plan v2 | med — destructive function, but tested on throwaway fixtures |
| **D2** | `identity_state` + `can_manage_guardians` + `verified_at`; redefine `is_primary_guardian`/`remove_guardian`; backfill the 12 links; fix the `shares_read` divergence | med — touches a live RLS policy |
| **D3** | Claim-flow rework: existing-children-first interstitial, in-flow reconciliation, `create_kid` request-id idempotency (D3), one transactional create-and-join | low — mostly client |
| **D4** | `list_identity_conflicts` + `player_match_dismissals` + `player_merge_requests` + coach FLAG action | low |
| **D5** | Reconcile the real live duplicates, one group at a time, Adam naming each: Lars, Conrad ×3, Tommy Allen, Neo, **Max (D16, case 4)** | high — real data, gated on D1's harness |
| **D6** | `players_read` off legacy `team_id` (D14) + the `resolved_game_stats` "TEAM" relabel fix + `kid_team_audience` coach-branch removal (D6) | med — RLS |
| **D7** | Name model `first_name`/`last_name`/`preferred_name`, no blind backfill; route all chip generation through `player_chip_label` | low |
| **D8** | Retire `players.team_id`/`season_id`/`jersey_number` — only after D6 ships and an install is confirmed (invariant 4) | med |

C.5's security invariants are untouched by every slice above. No slice grants coaches guardian
management: D2 explicitly moves management authority to a capability that a coach role cannot set.

---

## 7. OPEN QUESTIONS FOR ADAM

1. **D0 now, separately?** `merge_players` is callable today by a coach of a team two children
   share, and it hard-deletes. My recommendation is to revoke it this week, independently of the
   rest of Slice D.
2. **What verifies a claim?** My §5.2 proposal treats "arrived with a coach-issued per-player
   guardian code" as verification, and a bare team-code claim as unverified. Is that the line you
   want, or should a coach explicitly approve every first claim?
3. **`can_manage_guardians` seeding for provisional records.** When the *first* adult claims a
   provisional child with a per-player code, do they get management rights immediately, or only
   after a second signal?
4. **Sequencing D5.** Reconciling Conrad means folding three content-bearing records into one. Do
   you want that before or after the claim-flow rework ships?
5. **`kid_team_audience`** cross-org leak (D6) — fold into D6 as proposed, or handle sooner?

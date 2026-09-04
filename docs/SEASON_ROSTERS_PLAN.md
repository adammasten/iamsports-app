# Season-scoped rosters — design brief (pre-build)

**Status:** **Phases 1 + 2 + 3 SHIPPED 2026-09-04** — tested on the local dev DB (27/27
assertions for 1+2, 18/18 for 3) then applied to production and re-verified there.
**Phases 4–5 remain** — see "Phase 4 — revised scope" at the end of this doc.
Migrations: `20260904034415_phase1_roster_spells.sql`,
`20260904034418_phase2_season_windows.sql`,
`20260904035442_phase3_roster_based_access.sql`, plus
`phase2_lock_season_fns_to_authenticated`.
Every fact below was verified against the live DB (Supabase MCP) on 2026-09-03.
**Decision:** Rosters become **spells** (dated membership intervals). Seasons become
**named windows** over those spells. Teams are **never recreated**. `grad_class`
becomes the team's durable identity.
**Depends on:** nothing. **Unblocks:** durable kid-scoped film access (see
"Why this exists"), per-season rosters, accurate historical box scores.

---

## Why this exists

Two product promises currently rest on nothing:

1. **"Film follows the kid, even after they leave the team."** Today a family's
   durable access rides `game_lineups` — a snapshot taken when the game row is
   inserted. If the roster is added *after* the game (the normal coach workflow:
   create team → upload Saturday's film → then enter the roster), the snapshot is
   empty and that family has **no durable claim to that film, forever**. Two live
   games on Centex Attack Regents (8/10, 8/11, 4 videos) are already in this state.
2. **"Show me my son's 3rd-grade-spring film."** There is no way to ask that
   question. Rosters have no time dimension at all.

Kids play three or four seasons a year and jump teams mid-season. Without a time
dimension on the roster, the system cannot say who was on a team when — which is
the fact that both promises depend on.

---

## Verified current state

| Fact | Value |
|---|---|
| `player_teams` unique constraint | **`UNIQUE (player_id, team_id)`** — one row per pair, forever |
| `player_teams` time columns | `created_at` (insert timestamp), `left_at` (soft-leave) |
| `player_teams.season_id` | **does not exist** |
| `seasons.starts_on` / `ends_on` | columns exist, **0 of 5 rows populated** |
| `games.season_id` | 6 of 18 |
| `videos.season_id` | 7 of 18 |
| `games.game_date` | **18 of 18** |
| `videos.event_date` | 17 of 18 |
| `teams.grad_class` | **0 of 6 populated** |
| `players.grad_class` | 1 of 43 |
| `player_lineage_id` | 27 of 43 players, 26 distinct — effectively merge bookkeeping only |
| Functions referencing `player_teams` | **22** |
| RLS policies referencing `player_teams` in their expression | **0** |

**Dates are the reliable signal; `season_id` is not.** Any design that gates access
on `season_id` is gating on a column populated a third of the time.

---

## A live bug this fixes

`leave_team` and `remove_roster_placeholder` soft-leave by setting `left_at = now()`.
But `join_team_with_code` rejoins with:

```sql
on conflict (player_id, team_id) do update set left_at = null
```

**Rejoining erases the departure.** A kid who plays 2025, leaves, and returns in 2026
ends up with a record claiming continuous membership. Silent history loss, present in
production today, independent of any season work.

---

## The model

Three concepts, each answering a different question:

| Concept | Question it answers | Where it lives |
|---|---|---|
| **Team** | "Which club/squad is this?" | `teams` — durable, never recreated |
| **Season** | "Who was on the Spring 2026 roster?" | `seasons` — a named date window |
| **Spell** | "Was Jackson on this team on 2026-08-10?" | `player_teams` — the fact |

**The spell is the truth. The season is a label over it.** "Who was on the 3rd-grade
spring roster" is a query (spells overlapping that window), not a separate entity.

### `grad_class` is the durable team identity

A team named "Centex Attack 3rd Grade" is wrong by August. Grad class doesn't rot —
a kid graduating in 2033 is a 2033 forever, and grade level is *derived* from grad
class plus a date. So:

- Team name carries durable identity → **"Centex Attack 2033"**
- Season carries the year and term → **"Spring 2026"**
- "3rd grade spring" is computed: grad_class 2033 + spring 2026

This is what `grad_class` was added for. It is populated on **0 teams**. Populating it
is what stops team names from going stale annually.

---

## Explicitly rejected

**Do NOT recreate teams per season.** It fragments film across disconnected team rows,
which destroys the core value proposition; it multiplies join codes, coach codes,
memberships, permissions, and tags; and coaches will not do it consistently, which
makes the resulting data unrecoverable. (Whether any competitor does this is not
verifiable from here and is not a reason.)

**Do NOT make `season_id` the roster key.** Three reasons:

1. It forces a season to exist before anyone can join a team — a coach starting a team
   on Saturday would have to define a season first. That violates data invariant 1
   (a nullable concept must never block creation).
2. It cannot express mid-season joins and leaves, which is the actual requirement.
   A season row says "was on the Spring 2026 roster"; it cannot say "joined in March,
   left in May." The Centex Regents failure would recur *inside* a season.
3. It breaks all four upserts anyway, so it is not the cheaper option.

`season_id` stays on the spell as an **optional pin** — when a coach explicitly says
"this spell was Spring 2026," that beats date inference. Resolution order:
explicit `season_id` → else date-window overlap.

---

## Schema changes

```sql
-- Spells: dated membership intervals
alter table player_teams
  add column joined_on date not null default current_date,
  add column left_on   date,
  add column season_id uuid references seasons(id);   -- optional pin, NOT the key

-- Allow history: at most one CURRENT spell, unlimited past ones
alter table player_teams drop constraint player_teams_player_id_team_id_key;
create unique index player_teams_current_key
  on player_teams (player_id, team_id) where left_on is null;

-- Season windows
alter table seasons
  add constraint seasons_dates_ck
  check (starts_on is null or ends_on is null or ends_on >= starts_on);
```

Backfill: `joined_on := created_at::date`, `left_on := left_at::date`.

**Retire `left_at`.** Carrying both a system timestamp and a domain date that mean
nearly the same thing is exactly the drift the cleanup rule forbids. `left_on` is the
coach-editable domain fact; that is the one that matters, because coaches enter
departures late and must be able to backdate. Migrate readers, then drop `left_at`.

### Name vs jersey — keep the current split

Already correct, and worth stating so nobody "fixes" it:

- **Name lives on `players`** — durable identity, follows the kid everywhere.
- **Jersey lives on the roster row** — temporal, per team and per season.

Historical box scores render the jersey from the **spell covering the game's date**
and the name from the player. That yields "#12 Jackson" in 2025 and "#4 Jackson" in
2026, both accurate, with no extra schema.

---

## Access model rewiring

Durable family access currently keys on `game_lineups` in four places. All move to one
new helper — `is_roster_parent(p_game_id)` — which tests whether the caller is a linked
guardian of a kid whose **spell covers the game's date**:

| # | Site | Currently |
|---|---|---|
| 1 | `videos_read` | via `is_family_film_parent` |
| 2 | `games_read` | via `is_lineup_parent` |
| 3 | `game_lineups_read` | direct |
| 4 | `authorize_video_playback` | the `game_lineups` join ("Door 2b") — gates the actual bytes |

Two things fall out for free:

- **`game_lineups` gets its real job back** — who dressed and played, for box scores
  and stats. Tagging still populates it via `sync_lineup_from_clip_tag`; it just stops
  deciding who may watch.
- **The loose-footage hole closes in the same pass.** `authorize_video_playback`
  already has a `v.player_id` branch for directly-attributed video; `videos_read` does
  not — which is why loose footage tagged to a kid is playable but not findable.
  Same edit site.

**Performance note:** `videos_read` is already the policy compounding the concurrency
problem (see the home-feed findings). Make `is_roster_parent` `STABLE SECURITY
DEFINER` like its siblings, and do the `(select auth.uid())` wrapping in the same pass.

**Scope note:** this GRANTS more than today — every kid rostered at game time gives
their family durable access to that game's film, not just kids who were tagged. That
is the intent. Be clear-eyed that a parent gets the whole game, permanently.

**SHIPPED AS ADDITIVE, NOT A SWAP — the measurement that forced it.** Before writing
Phase 3 I counted guardian↔game grants both ways on production:

| | pairs |
|---|---|
| granted by SPELLS | 24 |
| granted by LINEUPS | 31 |
| **newly granted by spells** (the win) | **11** |
| **kept ONLY by the lineup path** | **18** |

A pure lineup→spell swap would have **revoked 18 pairs** (mostly because `joined_on`
backfilled from `created_at`, which postdates the game). So both helpers are
`spell OR lineup`: the spell is inferred participation, the lineup is the coach's
explicit assertion of it, and either grants. Do not "clean this up" into spell-only
without re-running that measurement.

**One deliberate tightening:** `authorize_video_playback` now uses the film-visible
variant. Previously `videos_read` respected `teams.parent_film_visible` but playback
did not — a coach who turned the toggle off hid the video from the list while anyone
holding the id could still stream it. Zero live impact (all 6 teams have it true).

---

## Blast radius

**22 functions** reference `player_teams`; **0 RLS policies** do (they route through
`is_team_member` / `is_linked_parent`), so the security surface barely moves.

Most of the 22 only read. The four that **upsert** need real thought:

- `attach_kid_to_team`
- `join_team_with_code` ← also where the rejoin bug lives
- `create_roster_placeholder`
- `claim_roster_spot`

Each does `on conflict (player_id, team_id)`. With a partial unique index the conflict
target becomes `on conflict (player_id, team_id) where left_on is null`, and **rejoin
must INSERT A NEW SPELL** rather than blanking `left_on`.

**Already safe — do not "fix":** player tags are keyed
`uq_tags_team_player UNIQUE (team_id, player_id) WHERE category='players'`, so multiple
spells per kid will **not** create duplicate tags. `ensure_player_tag`'s
`on conflict do nothing` already handles it.

---

## Phases

| Phase | Work | Est. |
|---|---|---|
| **1 — Spells** ✅ **DONE 2026-09-04** | Date columns, swap the unique index, backfill, fix the four upserts (incl. the rejoin bug). Also made `snapshot_game_lineup` + `get_game_lineup_editor` date-aware, and added `was_on_roster()`. `left_at` is kept in sync by trigger so no app changes were needed. | ~1.5 d |
| **2 — Season windows** ✅ **DONE 2026-09-04** | Windows backfilled from each season's first/last game date (4 of 5 seasons now dated; "Legacy" has no games so stays NULL). `seasons_no_overlap` GiST exclusion constraint per team, `seasons_dates_ck`, plus `set_season_window` / `season_for_date` / `roster_for_season` / `team_seasons`. **Season editor UI was NOT built — it moves to Phase 4.** | ~0.5 d |
| **3 — Access rewiring** ✅ **DONE 2026-09-04** | `is_roster_parent` + `is_roster_film_parent` (film-toggle variant), rewired **4** policies — `videos_read`, `games_read`, `game_lineups_read`, **`clips_read`** (the doc said 3; `clips_read` was found by searching `pg_policies`) — plus `authorize_video_playback`. Loose-footage hole closed. Old `is_family_film_parent` / `is_lineup_parent` dropped, zero stale refs. `(select auth.uid())` was already done separately. | ~1 d |
| **4 — Departure, then season UI** (REVISED 2026-09-04, see below) | 4a time-scope membership · 4b reel/share family path · 4c leave-UX with a real date · 4d spell-date editor · 4e season switcher · 4f retrofit the 3 filters + box score. | ~2 d |
| **5 — Retire `left_at`** | Migrate readers, drop the column. | ~0.5 d |

Phases 1 and 3 are the ones that pay the product promise. 2 and 4 make it addressable
by name instead of by date.

---

## Open decisions

1. **A video with no date.** One loose video has no `event_date` and no game, so there
   is no interval to match. Deny, or fall back to `created_at`? *(Recommend: deny, and
   surface it — an undated video is a data-entry gap, not an access question.)*
2. **Overlapping seasons.** Two seasons are currently both named "Spring 2026" with
   NULL dates. Once windows exist, should same-team overlap be a hard constraint or a
   warning?
3. **Backfilling the two orphaned Regents games.** Their kids' `joined_on` will backfill
   to 8/13 from `created_at`, which still excludes the 8/10 and 8/11 games. Adam knows
   who played — set those `joined_on` dates by hand, or leave them to the lineup path.

---

## Verification plan

Build and test on the **local dev database** (`docs/DEV_DATABASE.md` — Docker +
`npx supabase db reset`), never straight to production. This design is exactly the kind
of change that workflow exists for: it rewrites a unique constraint on a table 22
functions depend on.

Must-pass checks before production:

- A kid who leaves and rejoins has **two** spells, and the departure survives.
- A guardian of a kid rostered on the game date can read + play the video **after**
  leaving the team.
- A guardian of a kid rostered *only after* the game date **cannot**.
- No duplicate player tags after multiple spells.
- The four upserts are idempotent under repeat calls.

---

## Phase 4 — revised scope (decided with Adam, 2026-09-04)

**The driving case, in his words:** Lars played for Centex Attack Brandon last year
and doesn't this year. We un-associate him today. His family must keep **all film
from while he played, forever** — and see **nothing the team films afterwards**.

Phases 1–3 already deliver that for **videos, clips, games, and lineups** (the spell
decides, per game, by date). It does **not** hold for two things:

| Table | Family path today | Result when they leave |
|---|---|---|
| `highlight_reels` | **none at all** — `super_admin OR creator OR team_coach OR a share exists` | every reel goes dark, including of their own kid |
| `shares` | only the `player` audience | every team-wall post from their era goes dark |

So **do NOT "fix" this by deleting the membership on leave** (an earlier suggestion in
this session, retracted). That would black out exactly the history we promised to keep.

### 4a — Time-scope membership instead of deleting it
`leave_team` currently does not touch `team_memberships` at all, so a departed family
keeps *full* team access forever — the opposite failure. Give the membership an end
date and make membership-derived read branches ask "was I a member when this was
created", rather than "am I a member now".

### 4b — Give reels a family path
A reel of a game your kid played should stand on its own merit, independent of
membership. **Decided:** scope by the reel's *content*, not its render date — a season
highlight reel rendered in October about last season's games IS visible to a family
who played that season ("all the film from when he played").

### 4c — The leave UX
The action already exists twice; it needs renaming and a date, NOT a second button.
- Guardian: `kid.tsx:156` — "Leave team", destructive red, hidden behind a long-press.
- Coach: `roster.tsx:215` — "Remove from roster" (copy is already honest).

Rename to **"No longer on this team"**, not destructive-styled — this is archiving.
Copy states the kept range and that it is reversible (a returning kid is just a new
spell). Promote from long-press to a real row action.

**The date must never be a blank picker**, defaulted to:
1. ● **After their last game — <date>** (default; computed from the last game on that
   team where they were rostered or in the lineup) ← needs a small RPC
2. ○ End of last season — <season · date> (only when the team has a dated season)
3. ○ Today
4. ○ Pick a date…

Why it matters: un-associating in September a kid who stopped playing in May would
otherwise grant the family June–September film they were never part of.

### 4d–4f
4d spell-date editor (migration `20260904040820_phase4_spell_editing.sql` is WRITTEN
but NOT APPLIED). 4e season switcher on the team header — populate it from what RLS
returns, so a 24/25-only parent simply sees one season and never learns the current
one exists; default to **most recent visible**, not "contains today" (nothing contains
today — all 6 teams are between seasons). 4f retrofit the season filters in
`select-team.tsx`, `my-work.tsx`, `export.tsx` + box score to default to newest and
**resolve by DATE, not `season_id`** (only 6 of 18 games carry a `season_id`; filtering
on it would hide two-thirds of the film).

# Stats in IamSports — State-of-Play Brief for External Review

*Paste this whole doc to another AI. It has no repo access, so everything it needs is here.*

**Compiled:** 2026-09-22, from the repo source, the SQL migration files, and git history at
commit `1872b2a`. Where a fact could only come from a live-database observation, it is marked
**[July snapshot]** — that came from `docs/iamsports-stats-session (2).md` (2026-07-30) and may
be stale. No live DB query was run this session.

**What we want from you:** a recommendation on (a) which of two stat models to finish, and
(b) **where stats should live in the product** — which screens own them, and what a coach and a
parent each see. Not a rewrite of the app.

---

## 1. What the app is

**IamSports** — Expo SDK 54 React Native + Supabase (Postgres) app for youth-sports coaches and
parents. Coaches upload full game video, **tag the film**, and **export highlight reels**.
Ships to iOS via TestFlight and to the web via Vercel. Multi-sport: basketball, flag football,
7-on-7, football, soccer, baseball, softball, volleyball, lacrosse.

**Stats were never the original product.** Film breakdown was. Stats were added in July 2026 as
a *derivation* on top of tagging data that already existed. That framing explains most of the
design and most of the gaps.

### The tagging model (this is the product — do not propose changing it)

Tagging is **tap tags → "+ Group" bundles them → "Save clip"**. Same on every sport and surface
(iPad, iPhone, web).

Storage: `clip_tags (clip_id, tag_id, bundle_number)`
- `bundle_number = 0` → clip-level tag, applies to the whole play
- `bundle_number = 1, 2, 3…` → a **bundle**: a group of tags that belong together

A bundle is the unit that makes stats possible. `{Conrad, MADE 3}` in bundle 1 and
`{Bailey, Assist}` in bundle 2 on the same clip are two distinct events on one play.

### The tag vocabulary table

```
tags (id, name, category, sport, scope, team_id, sort_order, player_id,
      stat_primitive, stat_side, ...)
  scope    = 'global' (shared by every team) | 'team' (one team's own)
  sport    = 'Basketball', 'Flag Football', … ; NULL = universal
  category = text key: 'offense' | 'defense' | 'plays' | 'players' |
             'special' | 'opponent' | (+ football/flag-specific keys)
```

`tags.category` keys are immutable — renaming one strands every clip already tagged with it.

---

## 2. The stats pipeline, end to end

```
 coach taps tags in the tagger
        │
        ▼
 clip_tags (clip_id, tag_id, bundle_number)
        │   join tags on tag_id; keep bundles ≥ 1 that contain a tag
        │   carrying a stat_primitive
        ▼
 VIEW stat_events        ← the atomic resolver: one row per (clip, bundle, primitive)
        │   join clips → videos → games
        ▼
 VIEW game_box_score     ← per game, per player, counts of each primitive
        │
        │◄── TABLE game_stat_lines   (hand-typed lines; per-row override)
        ▼
 VIEW resolved_game_stats  ← manual row wins if one exists for
        │                     (game, player, stat_side); else the tagged derivation
        ▼
 app/box-score.tsx       ← the ONLY screen in the app that reads stats
```

Two other views exist — `season_player_stats` and `season_team_stats` — and hang off
`stat_events` directly. **Nothing in the app reads them** (verified: zero references in any
`.ts`/`.tsx` file).

---

## 3. The derivation rules (locked, and they work)

- `bundle_number = 0` → clip-level, descriptive. **Never produces a stat.**
- `bundle_number ≥ 1`:
  - player tag present + action tag present → **attributed** stat
  - action tag present, no player tag → **team** stat (`is_team_stat = true`)
  - player tag present, no action tag → **no stat row.** This is legitimate, not a bug:
    `{Lars, POE}` is a coaching note. Never warn on these.
- **Dedup:** `SELECT DISTINCT` on `stat_primitive` per bundle, so two tags mapping to the same
  primitive in one bundle count once.
- Points are always **derived, never stored**: `2*(fgm - fg3m) + 3*fg3m + ftm`. A coach cannot
  hand-enter an internally inconsistent line.

**[July snapshot]** Verified against real data on one game (vs Apex): four bundles across two
clips produced exactly the expected three stat events, and both attribution paths (player and
team) were proven correct.

---

## 4. Schema, verbatim

### 4.1 Columns added to `tags`

| Column | Type | Purpose |
|---|---|---|
| `stat_primitive` | text, CHECK | maps a display tag to a canonical stat |
| `stat_side` | text `'own'`\|`'opponent'`, default `'own'` | your stats vs the opponent's |
| `player_id` | uuid → `players(id)` ON DELETE SET NULL | links a player chip to a roster row |

**The live constraint today — 14 values:**
```
made_2, missed_2, made_3, missed_3, made_ft, missed_ft,
off_reb, def_reb, assist, steal, block, turnover, foul, technical
```

`tags_category_check`: `offense, defense, plays, players, special, opponent`

### 4.2 Tag vocabulary carrying stat meaning — **[July snapshot]** 27 tags, 23 with a primitive

- **offense (10):** MADE 2, miss 2, MADE 3, miss 3, MADE FT, miss ft, Reb O, Assist,
  Turnover, Foul O
- **defense (5):** Reb D, Steal, Block, Foul D, Technical
- **opponent (8, all `stat_side='opponent'`):** OPP MADE 2/3/FT, OPP miss 2/3/ft,
  OPP Reb O, OPP Reb D
- **players:** one chip per rostered kid, `player_id` set
- **special (2):** ★ Highlight, POE — both `stat_primitive = null`

`Foul O` and `Foul D` both map to `foul`. Two display names, one primitive — intentional.

**Every one of these is basketball.** No flag football, football, soccer, baseball, softball,
volleyball or lacrosse tag anywhere in the repo carries a `stat_primitive`. Stats are a
basketball-only feature inside a nine-sport app.

### 4.3 The naming convention (locked, and it has a consequence)

- `tags.name` = the **chip label**. First name only. Must fit ~11px in a narrow tagger column.
- `players.name` = the **stat sheet name**. Full name. Box scores print full names.
- The two are joined by `tags.player_id`.

The player-tag auto-provision trigger enforces this: on every INSERT into `player_teams` it
creates a player tag named `split_part(players.name, ' ', 1)` with `player_id` linked. So the
two strings *deliberately differ* — `'Lars'` vs `'Lars Masten'`. Any view that joins on name
is broken by design. §7.1.

### 4.4 `stat_events` — the atomic resolver (current live definition)

```sql
CREATE OR REPLACE VIEW stat_events AS
WITH bundle_player AS (
  SELECT ct.clip_id, ct.bundle_number, t.name AS player_name, t.player_id
  FROM clip_tags ct JOIN tags t ON t.id = ct.tag_id
  WHERE ct.bundle_number >= 1 AND t.category = 'players'
),
bundle_stat AS (
  SELECT DISTINCT ct.clip_id, ct.bundle_number, t.stat_primitive, t.stat_side
  FROM clip_tags ct JOIN tags t ON t.id = ct.tag_id
  WHERE ct.bundle_number >= 1 AND t.stat_primitive IS NOT NULL
)
SELECT bs.clip_id, bs.bundle_number, bp.player_name,
       bs.stat_primitive, bs.stat_side,
       (bp.player_name IS NULL) AS is_team_stat,
       bp.player_id
FROM bundle_stat bs
LEFT JOIN bundle_player bp
  ON bp.clip_id = bs.clip_id AND bp.bundle_number = bs.bundle_number;
```

Every other aggregation is a regroup of this view.

### 4.5 `game_box_score` — per game, per player

Counts each primitive with `COUNT(*) FILTER (WHERE …)`, grouped by
`(game_id, player_id, player_name, stat_side)`, with `COALESCE(player_name, 'TEAM')`.
Joins `stat_events → clips → videos` and keeps only rows where `videos.game_id IS NOT NULL`.

**It stores 2FG and 3FG split** (`fgm_2/fga_2/fgm_3/fga_3`), which is *not* the NCAA/NBA
convention. `resolved_game_stats` sums them back into total FG. Cosmetic inconsistency, not a
correctness bug, but it means the two layers disagree on column shape.

### 4.6 `game_stat_lines` — hand-entered stats

```sql
CREATE TABLE game_stat_lines (
  id uuid PK, game_id uuid → games ON DELETE CASCADE,
  player_id uuid → players ON DELETE CASCADE,   -- NULL = TEAM row
  stat_side text CHECK IN ('own','opponent') DEFAULT 'own',
  fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb,
  ast, tov, stl, blk, pf, tf   -- all int NOT NULL DEFAULT 0, CHECK >= 0
  created_by_user_id, created_at, updated_at
);
```

Internal-consistency CHECKs: `fgm<=fga`, `fg3m<=fg3a`, `fg3m<=fgm`, `fg3a<=fga`, `ftm<=fta`.
Here `fgm/fga` are **total** field goals with `fg3m/fg3a` as the 3-point subset — NCAA shape.

Uniqueness is split across two partial indexes, because NULL isn't distinct in a plain UNIQUE:
one row per `(game, player, side)` for real players, one TEAM row per `(game, side)`.

**RLS:** read = any confirmed member of the game's team; insert/update/delete = coaches of the
game's team; super-admin bypass on all four. Parent-game-derived, matching the `game_lineups`
pattern.

### 4.7 `resolved_game_stats` — Model D, per-row override

```sql
manual   = every game_stat_lines row, source='manual'
derived  = every game_box_score row where NOT EXISTS a manual row with
           the same game_id, stat_side, and player_id IS NOT DISTINCT FROM
           (so the TEAM row, player_id NULL on both sides, matches correctly)
SELECT * FROM manual UNION ALL SELECT * FROM derived
```

`source` is `'manual' | 'tagged'` and is carried all the way to the UI as a per-row badge.

The override granularity moved once: the first cut (`migration_game_stat_lines.sql`) was
**per-game** — one manual row anywhere and the whole game's tagged stats were ignored. It was
replaced the same day by **Model D, per-player-row** (`migration_stats_per_row_override.sql`).
A coach can fix one kid's line and leave the other nine derived. Revert = delete that row;
revert-all = delete every row for the game.

### 4.8 Security

All five stats views were originally `SECURITY DEFINER` (invoker off) and selectable by any
authenticated user — which exposed **children's names and stats across every team in the
system**. Caught in the 2026-08-24 pre-launch audit and fixed by
`alter view … set (security_invoker = on)` on all five, so each view now respects the querying
user's RLS on the underlying tables. Applied live 2026-08-24.

⚠️ The migration file ends with the note *"re-test the stats screens after."* There is no
evidence in the repo that this re-test happened.

---

## 5. Where stats live **today** — the complete inventory

**Screens: one.**

| | |
|---|---|
| Route | `/box-score` (`app/box-score.tsx`, 401 lines) |
| Reads | `resolved_game_stats` filtered by `game_id`; `games` for title/date/score; `player_teams`+`players` for roster (edit mode only) |
| Writes | `game_stat_lines` via `app/components/StatEditorSheet.tsx` (264 lines) |
| Columns | PTS, FG, 3FG, FT, REB, AST, STL, BLK, TO, PF — fixed player column left, stat columns scroll horizontally |
| Sections | "Team" (own side, one row per player + a TEAM row) and "Opponent" (a single synthetic OPPONENT row — there is no per-opponent-player tracking) |
| Modes | **VIEW** — anyone with read access, resolved rows only. **EDIT** — coach-only toggle, merges the roster in so every player is tappable even with no stats yet |
| Badges | 📊 tagged · ✏️ manual, per row |
| Coach gate | `activeRole ∈ COACH_ROLES` **and** `activeTeam.id === game.team_id` — a coach of another team sees view mode only |

**Entry points: two, both in the schedule.**

1. `app/(tabs)/schedule.tsx:263` — tapping a game-family event on the Schedule tab
2. `app/edit-event.tsx:345` — a link inside the event editor

**That's the whole surface area.** Specifically, stats are reachable from *nowhere* in the film
half of the app:

- `app/game-detail.tsx` — the game's film page, which already loads `team_score` and
  `opponent_score` and renders a W/L string — has **no** box-score link
- `app/kid.tsx` — the player/kid page — has no stats
- `app/(tabs)/index.tsx` (home feed), `app/(tabs)/roster.tsx`, Coaches' Corner, My Work,
  the team wall, the Family Film Room — none of them show a stat

**Built but dark:**

- `season_player_stats` — a full NCAA-ordered season sheet (GP, FG, FG%, 3FG, 3FG%, FT, FT%,
  OREB, DREB, REB, REB avg, AST, TOV, STL, BLK, PF, TF, PTS, PPG). **Zero consumers.**
- `season_team_stats` — TOTAL vs OPPONENT team rows. **Zero consumers.**
- The 8 opponent tags — they exist in the DB, they feed the views, and **they never render**.
  The tagger's column list (`lib/core/tag-categories.ts`) declares only
  `offense / defense / plays` for basketball, plus a Players column each reader appends itself.
  `'opponent'` is not a declared category anywhere in TypeScript, so an opponent tag is
  invisible on every surface. This was deliberate — "the free off switch" — but it means the
  opponent half of `resolved_game_stats` can only ever be populated by hand-entry.

---

## 6. Which data preconditions are now met

The July session concluded that stats were *"blocked on data entry, not code"* and named four
blockers. Three have since been fixed by work that was done for other features:

| July blocker | Status 2026-09-22 |
|---|---|
| No coach-adds-roster-player path; `create_kid` wrote teamless kids only | **Fixed.** Roster tab + three roster RPCs, all funneling through `player_teams` |
| Player tags hand-authored, unlinked | **Fixed.** `migration_player_tag_autoprovision.sql` — AFTER INSERT trigger on `player_teams` creates a linked player tag. Noted as 100% populated |
| `game_lineups` = 0 rows → GP null, all averages null | **Fixed at the data level.** `migration_sync_game_lineups_from_player_tags.sql` (applied live 2026-08-29) upserts a lineup row from every player tag applied to a clip. Backfill took it 29 → 40 rows |
| `games.team_score` null on 19 games | **Path exists now** — score fields in `app/upload.tsx` and `app/edit-game.tsx`. Historical backfill unknown |
| No fully tagged game (3 stat events total) | **Unknown.** Not verifiable from the repo |

So the story changed. In July the data layer was finished and the data was missing. Today the
data plumbing is largely in place and **the product surface is what's missing** — one screen,
reachable only from the calendar.

---

## 7. Known defects and drift

### 7.1 `season_player_stats` GP is broken by construction
Its `gp` CTE joins `players.name` against the tag-derived `player_name`. Per §4.3 those strings
are *deliberately* different (`'Lars'` vs `'Lars Masten'`), so GP resolves NULL, so `reb_avg`
and `ppg` are NULL for every player, forever. The fix is a one-line change to join on
`player_id` — which `stat_events` has carried since 2026-08-01. **The season views were never
updated when `player_id` was added.** They are the only consumers still on the name join.

### 7.2 `game_box_score` and `resolved_game_stats` disagree on FG shape
The former splits 2FG/3FG; the latter sums to total-FG + 3PT subset. Any new consumer must know
which layer it is reading.

### 7.3 Two sources of truth for ★ and POE
`clips.is_starred` and `clips.is_point_of_emphasis` still exist as columns, while ★ and POE also
live in `tags` as `category='special'`. **[July snapshot]** the columns were believed dead —
worth confirming nothing still writes them.

### 7.4 ★ and POE land inside bundles, not just clip-level
More granular than expected. The views ignore them correctly (null primitive), but it means a
bundle is not always "one event + one player."

### 7.5 The security_invoker flip was never re-tested
See §4.8.

---

## 8. The fork in the road — a second stat model is staged but not applied

Commit `5c4b5a6` (2026-08-07), **"Tag-set v2 Piece 1 (SQL) … (NOT YET APPLIED)"**, adds
`migration_tagset_v2_part1_schema_and_defaults.sql`. It rebuilds the stat model:

```sql
-- new structured columns on tags
stat_made   boolean  -- shots/FT: true = make, false = miss
stat_value  int      -- 3 | 2 | 1 (FT) | null
stat_detail text     -- 'off'|'def' (rebound) · 'personal'|'technical'|'offensive' (foul)

-- side moves from the TAG to the EVENT
alter table clip_tags add column stat_side text not null default 'us'
  check (stat_side in ('us','them'));

-- stat_primitive collapses 14 values → 7
check (stat_primitive is null or stat_primitive in
  ('shot','rebound','assist','steal','block','turnover','foul'));

-- deletes every scope='global' tag (cascading their clip_tags) and
-- reinserts a locked 27-tag default set
```

**Why this is the more interesting model:** it makes *side* a per-event toggle rather than a
duplicate vocabulary. The 8 `OPP …` tags stop being 8 extra chips that double the board height
and become a toggle on the tag you were already pressing. It also decomposes a shot into
(primitive, made, value) instead of six separate primitives, which is the shape that generalizes
past basketball.

**Why it is dangerous where it sits:** its own header says *"Stats will read zero until the
views are rewritten in Piece 2."* **Piece 2 does not exist in the repo.** If Piece 1 is ever
applied without it, `stat_events` matches nothing (the old 14 primitive values are gone), and
every box score in the app silently reads empty. The migration is also intentionally destructive
— it deletes all global tags, cascading their `clip_tags` rows — on the stated basis that there
were no tagged games worth preserving *as of 2026-08-07*. **That premise must be re-verified
before it is ever run.**

Six weeks of work since (flag football tagger, sport tag contract, background upload) has gone
past it without touching it.

---

## 9. The context stats now sits inside

A separate rearchitecture was designed on 2026-09-21 (`docs/TAG_FLOW_BRIEF_FOR_AIS.md`) to fix
how tags flow between My Tags → tagger → export. Its conclusion: one shared resolver that every
surface reads, with three semantic roles — `board` / `dimension` / `marker`.

**That design does not mention stats anywhere.** But it touches the same `tags` table, the same
`category` keys, and the same board-column mechanism that currently hides the opponent
vocabulary. And the v2 stat model in §8 is *itself* an argument for the same idea: `stat_side`
as a per-event toggle is exactly a "dimension," not a board column.

The two efforts should be reconciled before either ships.

---

## 10. Constraints any recommendation must respect

1. **The tap → group → save tagging flow is the product.** Do not propose changing it.
2. **The tagger's on-screen layout is locked** across all sports. Only *which categories fill
   the columns* is ever in scope. Adding a fifth column is a layout change and needs explicit
   sign-off.
3. **Height, not width, is the tagger's constraint.** Chips sit on top of the video; the coach
   tags by watching. 10 offense + 8 opponent tags run five rows deep and cover the play. A
   proposal that adds chips must say what it removes.
4. **Horizontal scroll in the tag band is out** — it competes with the scrubber directly below.
5. **`tags.category` keys are immutable.** Renaming strands tagged clips.
6. **Native ships via TestFlight and the installed build lags web.** The house rule for
   tag-data changes is additive-first: ship the build that reads the new shape, confirm
   adoption, *then* migrate data.
7. **Children's data.** Stats are per-kid, and a stats screen is a per-kid data surface. Any
   "where should this live" answer has to say who can see it — there is a parked
   `team_settings` idea for three-level visibility (`coaches_only` / `team_totals` / `full`)
   that was never built.
8. **Volunteer coaches.** Every stat feature has a data-entry precondition. The question is
   never "can we compute this" — it's "will a coach reliably enter what it needs."

---

## 11. Parked ideas, recorded so you don't re-propose them as new

| Feature | Note from the July session |
|---|---|
| Period tracking | `games.period_count` + `period_label` exist; needs `clips.period` + a sticky selector |
| Plus/minus, minutes played | Needs on-court state via substitution tagging. Errors propagate — fragile for volunteers |
| Career stats | `GROUP BY player_lineage_id`. Needs the `player_id` view rewrite first |
| Year rollup across seasons | Zero schema work. Open question: how a winter season straddling two calendar years is labeled |
| Lookup tables for primitives + categories | Two CHECK constraints to edit per new sport. Do it before sport #2 |
| Stat-tag visual indicator | Thicker chip border where `stat_primitive is not null` |
| Shot charts | Needs x/y coordinates per shot |
| Assist networks | Nearly free from the bundle model — assist and make already share a clip |
| A verifier | `games.team_score` is free ground truth: `sum(box_score.pts) - team_score` should be 0 on a fully tagged game. Other free invariants: `pts = 2*(fgm-fg3m)+3*fg3m+ftm`; `ast <= fgm` at team level; `sum(player rows) + TEAM row = TOTAL row` |

---

## 12. The questions

1. **Finish v1 or apply v2?** v1 (14 primitives, side on the tag) works today and is read by one
   screen. v2 (7 primitives + made/value/detail, side per event) is a better model, is written,
   is unapplied, is destructive, and is missing its Piece 2. What would you do, and in what
   order — given that the app is pre-launch and the tagged-data corpus is small?

2. **Where should stats live?** Today: one screen, reachable only from the calendar. Candidate
   homes — a tab on the game's film page (`game-detail`), a season tab on the team, a stats
   block on the kid's page that a parent sees, a Coaches' Corner section, or the existing
   standalone screen with more doors into it. Which, for a youth-sports app where the *parent*
   is the emotional audience and the *coach* is the one doing the data entry?

3. **Does the opponent half earn its keep?** It doubles the tagging load for a volunteer and
   currently can't be tagged at all. Keep it hand-entry only, make it a per-event toggle (v2),
   or cut it?

4. **Does the season sheet ship at all?** Two full NCAA-shaped season views exist and are dark.
   Is a season sheet the thing a youth-sports parent wants, or is the per-game box score plus a
   few season *highlights* (PPG, a season high, a trend line) the actual product?

5. **Second sport.** Stats are basketball-only in a nine-sport app. Is the right move to
   generalize the primitive model now (lookup tables, sport-scoped vocabularies), or to prove
   the feature end-to-end on basketball for one full season first?

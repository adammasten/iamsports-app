# IamSports — Stats Data Layer

**Session:** July 29–30, 2026
**Status:** Data layer complete and verified. Blocked on a missing feature, not code.

---

## The headline finding

**There is no coach-adds-roster-player path in the app.**

`create_kid` is the only function that inserts into `players`, and it hardcodes
`team_id = null`. It then writes `parent_player_links` with `relationship='parent'`.
That's the *parent* lane — a parent adding their own child.

Consequences that explain a lot:
- `players` has 2 rows after months of building
- `game_lineups` has 0 rows
- Player tags have been hand-authored one at a time
- Conrad was teamless (normal case); Lars had a `team_id` only because he was
  written by a direct insert outside the app

The RLS policy already anticipated a coach flow:
`players_insert with_check = (is_team_coach(team_id) OR is_super_admin())`.
`is_team_coach(null)` fails — which is exactly why teamless kids need
`create_kid`'s SECURITY DEFINER bypass. The schema was designed for a coach
roster flow that never got built.

**This is now the real blocker on stats.** A box score needs a roster.

---

## Schema changes applied to `tags`

| Column | Type | Status |
|---|---|---|
| `stat_primitive` | text, check constraint | Applied, 14 values |
| `stat_side` | text, `'own'` / `'opponent'`, default `'own'` | Applied |
| `player_id` | uuid → `players(id)` on delete set null | **Applied** (earlier note said otherwise — it exists) |

### Constraint values

`tags_stat_primitive_check`:
```
made_2, missed_2, made_3, missed_3, made_ft, missed_ft,
off_reb, def_reb, assist, steal, block, turnover, foul, technical
```

`tags_category_check` (pre-existing, extended this session):
```
offense, defense, plays, players, special, opponent
```

Note `special` was already in the DB constraint but is NOT in the tagger's
hardcoded bucket list — precedent for "category exists in data, handled
differently in UI."

---

## Tag vocabulary — 27 tags, 23 with primitives

### offense (10)
MADE 2 → made_2 · miss 2 → missed_2 · MADE 3 → made_3 · miss 3 → missed_3
MADE FT → made_ft · miss ft → missed_ft · Reb O → off_reb · Assist → assist
Turnover → turnover · Foul O → foul

### defense (5)
Reb D → def_reb · Steal → steal · Block → block · Foul D → foul
Technical → technical

### opponent (8, all `stat_side='opponent'`)
OPP MADE 2 → made_2 · OPP miss 2 → missed_2 · OPP MADE 3 → made_3
OPP miss 3 → missed_3 · OPP MADE FT → made_ft · OPP miss ft → missed_ft
OPP Reb O → off_reb · OPP Reb D → def_reb

### players (2)
Lars → player_id → Lars Masten (#32) · Conrad → player_id → Conrad Masten

### special (2)
★ Highlight · POE — both `stat_primitive = null`

`Foul O` and `Foul D` both → `foul`. Two display names, one primitive.

---

## The opponent off switch (free, already working)

The tagger hardcodes four buckets at `tagging-overlay.tsx:307`
(offense / defense / plays / players). A tag in category `opponent`
**does not render at all.**

So opponent tags exist in the DB, feed the views, and are invisible in the UI
until a fifth column is deliberately added. No setting, no code. Defer the real
`team_settings` toggle until there's a second user who might disagree.

---

## Player naming convention (locked)

Two strings, two jobs, joined by `player_id`:

- **`tags.name`** = chip label. First name only. Must fit 11px in a narrow column.
- **`players.name`** = stat sheet name. Full name. NCAA sheets print full names.

Player tags are always `scope='team'` with a real `team_id` — a kid's name must
not appear in another team's picker.

**Consequence:** the views currently join on `t.name`, written before `player_id`
existed. Since names now deliberately differ, they must be rewritten to join on
`player_id` and display `players.name`. Required for career stats
(`player_lineage_id`) and for GP to ever resolve.

---

## The derivation model

- `bundle_number = 0` → clip-level descriptive tags. **Never produces a stat.**
- `bundle_number >= 1` → a stat event:
  - Player tag present → attributed
  - Player tag absent → team stat (`is_team_stat = true`)
  - Action tag absent → no stat. **Legitimate** — e.g. `{Lars, POE}` is a
    coaching note, not a broken bundle. Do NOT warn on these.

**Dedup:** `distinct` on `stat_primitive` per bundle, so two tags mapping to the
same primitive in one bundle count once.

**Roll-up path:** `clip_tags` → `tags` → `stat_events` → `clips` → `videos` → `games`

---

## The three views

### 1. `stat_events` — atomic resolver

```sql
create or replace view stat_events as
with bundle_player as (
  select ct.clip_id, ct.bundle_number, t.name as player_name
  from clip_tags ct
  join tags t on t.id = ct.tag_id
  where ct.bundle_number >= 1
    and t.category = 'players'
),
bundle_stat as (
  select distinct ct.clip_id, ct.bundle_number, t.stat_primitive, t.stat_side
  from clip_tags ct
  join tags t on t.id = ct.tag_id
  where ct.bundle_number >= 1
    and t.stat_primitive is not null
)
select
  bs.clip_id,
  bs.bundle_number,
  bp.player_name,
  bs.stat_primitive,
  bs.stat_side,
  (bp.player_name is null) as is_team_stat
from bundle_stat bs
left join bundle_player bp
  on bp.clip_id = bs.clip_id
 and bp.bundle_number = bs.bundle_number;
```

Every other aggregation is a regroup of this. **Needs rewrite** to carry
`player_id` instead of / alongside `player_name`.

### 2. `game_box_score` — per game, per player

Built and working. **Needs realignment** — currently splits `fgm_2` / `fgm_3`.
NCAA/NBA convention is total FG with 3PT as a subset. Copy the column set from
`season_player_stats`.

### 3. `season_player_stats`

NCAA column order: GP, FG, FG%, 3FG, 3FG%, FT, FT%, OREB, DREB, REB, REB avg,
AST, TOV, STL, BLK, PF, TF, PTS, PPG

```sql
create or replace view season_player_stats as
with gs as (
  select g.id as game_id, g.season_id
  from games g where g.season_id is not null
),
ev as (
  select gs.season_id, coalesce(se.player_name,'TEAM') as player, se.stat_primitive
  from stat_events se
  join clips c on c.id = se.clip_id
  join videos v on v.id = c.video_id
  join gs on gs.game_id = v.game_id
  where se.stat_side = 'own'
),
agg as (
  select season_id, player,
    count(*) filter (where stat_primitive in ('made_2','made_3'))                       as fgm,
    count(*) filter (where stat_primitive in ('made_2','made_3','missed_2','missed_3')) as fga,
    count(*) filter (where stat_primitive = 'made_3')                                   as fg3m,
    count(*) filter (where stat_primitive in ('made_3','missed_3'))                     as fg3a,
    count(*) filter (where stat_primitive = 'made_ft')                                  as ftm,
    count(*) filter (where stat_primitive in ('made_ft','missed_ft'))                   as fta,
    count(*) filter (where stat_primitive = 'off_reb')                                  as oreb,
    count(*) filter (where stat_primitive = 'def_reb')                                  as dreb,
    count(*) filter (where stat_primitive = 'assist')                                   as ast,
    count(*) filter (where stat_primitive = 'turnover')                                 as tov,
    count(*) filter (where stat_primitive = 'steal')                                    as stl,
    count(*) filter (where stat_primitive = 'block')                                    as blk,
    count(*) filter (where stat_primitive = 'foul')                                     as pf,
    count(*) filter (where stat_primitive = 'technical')                                as tf,
    count(*) filter (where stat_primitive = 'made_2') * 2
      + count(*) filter (where stat_primitive = 'made_3') * 3
      + count(*) filter (where stat_primitive = 'made_ft')                              as pts
  from ev group by season_id, player
),
gp as (
  select gs.season_id, p.name as player, count(distinct gl.game_id) as gp
  from game_lineups gl
  join gs on gs.game_id = gl.game_id
  join players p on p.id = gl.player_id
  group by gs.season_id, p.name
)
select
  a.season_id, a.player, gp.gp,
  a.fgm, a.fga,  round(100.0 * a.fgm  / nullif(a.fga,0), 1)  as fg_pct,
  a.fg3m, a.fg3a, round(100.0 * a.fg3m / nullif(a.fg3a,0), 1) as fg3_pct,
  a.ftm, a.fta,  round(100.0 * a.ftm  / nullif(a.fta,0), 1)  as ft_pct,
  a.oreb, a.dreb, a.oreb + a.dreb as reb,
  round(1.0 * (a.oreb + a.dreb) / nullif(gp.gp,0), 1) as reb_avg,
  a.ast, a.tov, a.stl, a.blk, a.pf, a.tf,
  a.pts, round(1.0 * a.pts / nullif(gp.gp,0), 1) as ppg
from agg a
left join gp on gp.season_id = a.season_id and gp.player = a.player;
```

**Known broken:** the `gp` CTE joins `players.name` against tag names. Since
`Lars` != `Lars Masten`, GP would stay null even with lineups populated. Fix by
joining on `player_id`.

### 4. `season_team_stats` — TOTAL vs OPPONENT

`TOTAL` = all players + unattributed. Distinct from the `TEAM` row in the player
sheet, which means unattributed only. Matches the NCAA sheet's three row types
(players, Team, Opponent).

```sql
create or replace view season_team_stats as
select
  season_id, team_id,
  case when stat_side = 'own' then 'TOTAL' else 'OPPONENT' end as side,
  gp, fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb, ast, tov, stl, blk, pf, pts
from (
  select
    g.season_id, g.team_id, se.stat_side,
    count(distinct g.id) as gp,
    count(*) filter (where se.stat_primitive in ('made_2','made_3'))                       as fgm,
    count(*) filter (where se.stat_primitive in ('made_2','made_3','missed_2','missed_3')) as fga,
    count(*) filter (where se.stat_primitive = 'made_3')                                   as fg3m,
    count(*) filter (where se.stat_primitive in ('made_3','missed_3'))                     as fg3a,
    count(*) filter (where se.stat_primitive = 'made_ft')                                  as ftm,
    count(*) filter (where se.stat_primitive in ('made_ft','missed_ft'))                   as fta,
    count(*) filter (where se.stat_primitive = 'off_reb')                                  as oreb,
    count(*) filter (where se.stat_primitive = 'def_reb')                                  as dreb,
    count(*) filter (where se.stat_primitive = 'assist')                                   as ast,
    count(*) filter (where se.stat_primitive = 'turnover')                                 as tov,
    count(*) filter (where se.stat_primitive = 'steal')                                    as stl,
    count(*) filter (where se.stat_primitive = 'block')                                    as blk,
    count(*) filter (where se.stat_primitive = 'foul')                                     as pf,
    count(*) filter (where se.stat_primitive = 'made_2') * 2
      + count(*) filter (where se.stat_primitive = 'made_3') * 3
      + count(*) filter (where se.stat_primitive = 'made_ft')                              as pts
  from stat_events se
  join clips c on c.id = se.clip_id
  join videos v on v.id = c.video_id
  join games g on g.id = v.game_id
  where g.season_id is not null
  group by g.season_id, g.team_id, se.stat_side
) x;
```

---

## Verified against real data

Three stat events exist (game: vs Apex, `2cc4eb82-c977-44e5-9a7b-c7e09f4291c0`):

| clip | bundle | contents | result |
|---|---|---|---|
| 035b806c | 1 | Lars + POE | no event (coaching note) |
| 035b806c | 2 | Steal + ★ | team steal |
| 035b806c | 3 | Reb D + Lars + POE | Lars def_reb |
| b079e3e6 | 1 | Reb D alone | team def_reb |

All three views produce correct output. Both attribution paths proven.
Box score: Lars 1 DREB; TEAM 1 DREB + 1 STL; team total 2 DREB + 1 STL.

---

## The verifier (loop tier 1)

`games.team_score` and `opponent_score` are free ground truth — no hand-scoring.

```sql
select
  g.title, g.team_score,
  sum(b.pts) as tagged_pts,
  sum(b.pts) - g.team_score as diff
from games g
join game_box_score b on b.game_id = g.id and b.stat_side = 'own'
where g.team_score is not null
group by g.id, g.title, g.team_score;
```

`diff = 0` means tagging was complete and derivation correct.

**Other free invariants:**
- `pts = 2 * (fgm - fg3m) + 3 * fg3m + ftm`
- `ast <= fgm` at team level
- `sum(individual rows) + TEAM row = TOTAL row`
- their missed shots ≈ your DREB + their OREB (approximate)

---

## Tagger UI findings (from screenshot)

Landscape, tags overlaid on video, ~half the frame is dead space on the right.

- **Four columns render today**, not three: OFFENSE, DEFENSE, PLAYS, PLAYERS.
  `PLAYS` is empty (0 tags in DB) and `PLAYERS` rendered empty despite Lars
  existing with correct `scope='team'` — worth a read-only look.
- **Fifth column for opponent fits.** Column header carries "OPPONENT," so chips
  can drop the `OPP` prefix once the column exists (don't rename before then —
  `clips.tsx:57` shows tag names with no category context).
- **Horizontal scroll: avoid.** The tag band sits on the video with the scrubber
  directly below. A horizontal swipe there competes with scrubbing.
- **Height is the real constraint, not width.** 10 offense tags + 8 opponent tags
  run five rows deep and eat the sightline. You tag by watching; chips cover the play.
- **Two free height wins:** filter by `videos.sport` (screenshot is a football clip
  showing basketball tags), and don't render empty categories.

---

## Open items — blocking

1. **No coach roster path.** `create_kid` writes teamless kids only. Cannot build
   a roster. This is the top blocker.
2. **`game_lineups` = 0 rows.** No GP source. All averages null. Also means the
   players-see-clips-where-in-lineup visibility feature has never fired.
3. **`games.team_score` null on 19 games.** Not just vs Apex — score entry has
   never been part of the workflow, so the verifier is unusable across
   essentially the entire dataset.
4. **No fully tagged game.** 3 events is not a test.

## Open items — non-blocking

- Views join on `t.name`; must move to `player_id`
- `game_box_score` splits 2FG/3FG — realign to NCAA total-FG convention
- TEAM row in `season_player_stats` always has null GP; should use team games played
- **Orphan `tagging.tsx`** — writes identical `clip_tags` rows at line 270, no route.
  Live path is `tagging-overlay.tsx:548`. Delete or quarantine before app stat work.
- `clips.is_starred` / `is_point_of_emphasis` likely dead — ★ and POE moved into
  `tags` as `category='special'`. Two sources of truth if anything still writes them.
- ★ and POE are landing *inside* bundles, not just clip-level. More granular
  annotation than expected. Views ignore them correctly (null primitive).
- Conrad's `team_id` was patched manually — workaround, not a fix
- `players.season_id` null on both players
- `plays` category empty — rendering an empty column

## Parked features

| Feature | Note |
|---|---|
| Coach roster flow + parent/coach claim step | Same shape as invite/tap-to-join for viewers |
| Player tag auto-provisioning from roster | Depends on roster flow existing |
| Lineup rows as a byproduct of tagging | Better than deriving GP from events, which undercounts |
| Period tracking | `games.period_count` + `period_label` already exist. Needs `clips.period smallint` + sticky selector |
| Plus/minus, minutes played | Needs on-court state (substitution tagging). Errors propagate — fragile for volunteers |
| `team_settings` table | Stats visibility (`coaches_only`/`team_totals`/`full`), opponent tracking, period scheme |
| Multi-sport tags | `tags.sport` column + data-driven category buckets (kills the 4-bucket hardcode) |
| Per-sport default tag sets on team creation | Volleyball coach currently gets an empty picker |
| Career stats | `group by player_lineage_id`. Needs the `player_id` view rewrite |
| Year rollup across seasons | `extract(year from seasons.starts_on)`. Zero schema work. Decide how winter straddling two calendar years is labeled |
| Lookup tables for primitives + categories | Two check constraints to edit per new sport. Do before sport #2 |
| Stat-tag visual indicator | Thicker border where `stat_primitive is not null` |
| Shot charts | Needs x/y coordinates per shot |
| Assist networks | Free from bundle model — assist and make share a clip |

---

## The recurring lesson

Four features hit the same wall this session: bundling is optional, `team_score`
is optional, lineups are optional, and `team_id` on players is nullable.

**Film breakdown tolerates missing data. Stats don't.** Every stat feature has a
data-entry precondition, and the schema is the easy half. The UI question isn't
"can we compute this" — it's "will a coach reliably enter what it needs."

---

## Next session

**Session A — unblock the roster:**
1. Build the coach-adds-player path (or seed via SQL to keep moving)
2. Provision player tags with `player_id` set
3. Rewrite views to join on `player_id`, display `players.name`
4. Enter `team_score` on games
5. Tag one full game, every possession
6. Run the verifier — diff should be 0

**Session B — UI:**
- Where the sheet lives: kid's wall, team wall, Film Room
- Game vs season vs career navigation
- Fifth opponent column + sport filtering + empty-category suppression
- Sticky period selector
- Three-level stats visibility

Do A before B. Building screens against 3 events means designing for data
you've never seen.

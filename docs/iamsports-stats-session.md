# IamSports — Stats Data Layer

**Session date:** July 29, 2026
**Status:** Data layer complete and verified. Blocked on data entry, not code.

---

## What got built

### Schema changes (all additive, `tags` table)

| Column | Type | Purpose |
|---|---|---|
| `stat_primitive` | text, check constraint | Maps a display tag to a canonical stat |
| `stat_side` | text, `'own'` \| `'opponent'`, default `'own'` | Separates your stats from opponent's |
| `player_id` | uuid → `players(id)` | **NOT APPLIED** — see Open Items |

Check constraint covers 14 primitives:
`made_2, missed_2, made_3, missed_3, made_ft, missed_ft, off_reb, def_reb, assist, steal, block, turnover, foul, technical`

### Tag vocabulary — 21 tags, 18 with primitives

| Category | Tag | Primitive | Side |
|---|---|---|---|
| offense | MADE 2 | made_2 | own |
| offense | miss 2 | missed_2 | own |
| offense | MADE 3 | made_3 | own |
| offense | miss 3 | missed_3 | own |
| offense | MADE FT | made_ft | own |
| offense | miss ft | missed_ft | own |
| offense | Reb O | off_reb | own |
| offense | Assist | assist | own |
| offense | Turnover | turnover | own |
| offense | Foul O | foul | own |
| defense | Reb D | def_reb | own |
| defense | Steal | steal | own |
| defense | Block | block | own |
| defense | Foul D | foul | own |
| defense | Technical | technical | own |
| defense | OPP MADE 2 | made_2 | opponent |
| defense | OPP MADE 3 | made_3 | opponent |
| defense | OPP MADE FT | made_ft | opponent |
| players | Lars | null | own |
| special | ★ Highlight | null | own |
| special | POE | null | own |

`Foul O` and `Foul D` both → `foul`. Two display names, one primitive.

---

## The derivation model

**Bundles are the attribution mechanism.**

- `bundle_number = 0` → clip-level descriptive tags. **Never produces a stat.**
- `bundle_number >= 1` → a stat event.
  - Player tag present → attributed to that player
  - Player tag absent → team stat (`is_team_stat = true`)
  - Action tag absent → no stat (legitimate: e.g. `{Lars, POE}` is a coaching note)

**Dedup rule:** `distinct` on `stat_primitive` per bundle, so two tags mapping to the same primitive in one bundle count once.

**Roll-up path:** `clip_tags` → `tags` → `stat_events` → `clips` → `videos` → `games`

---

## The three views

### 1. `stat_events` — the atomic resolver

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

Every other aggregation is a regroup of this. One row per tagged event.

### 2. `game_box_score` — per game, per player

Built and working. **Needs updating** — currently splits `fgm_2`/`fgm_3`. NCAA/NBA convention is total FG with 3PT as a subset. See `season_player_stats` for the correct column set.

### 3. `season_player_stats` — season to date

NCAA column order: GP, FG, FG%, 3FG, 3FG%, FT, FT%, OREB, DREB, REB, REB avg, AST, TOV, STL, BLK, PF, TF, PTS, PPG

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

### 4. `season_team_stats` — TOTAL vs OPPONENT

Label is `TOTAL` (all players + unattributed) to avoid colliding with the `TEAM` row in the player sheet, which means unattributed only. Matches the NCAA sheet's three row types.

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

Three stat events exist in the database (game: vs Apex):

| clip | bundle | player | primitive |
|---|---|---|---|
| 035b806c | 2 | — (team) | steal |
| 035b806c | 3 | Lars | def_reb |
| b079e3e6 | 1 | — (team) | def_reb |

All three views produce correct output. Attribution path and team-stat path both proven.

---

## The verifier (loop tier 1)

`games.team_score` is the free ground truth. No hand-scoring needed.

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

`diff = 0` means tagging was complete and derivation is correct.

**Other free invariants:**
- `pts = 2 * (fgm - fg3m) + 3 * fg3m + ftm`
- `ast <= fgm` at team level
- `sum(individual rows) + TEAM row = TOTAL row`

---

## Open items — blocking

1. **`players` has 2 rows, `tags` has 1 player tag (Lars).** Can't tag a full game without a roster.
2. **`game_lineups` appears empty** — GP is null, so all averages are null. Never ran `select count(*) from game_lineups;`
3. **`games.team_score` is null on vs Apex** — verifier can't run.
4. **No fully tagged game exists.** 3 events is not a test.

## Open items — non-blocking

- `tags.player_id` never applied. Views join on `t.name`, which works today but breaks across teams/seasons. Required before career stats (`player_lineage_id`).
- **Orphan `tagging.tsx`** — writes identical `clip_tags` rows at line 270, has no route. Live path is `tagging-overlay.tsx:548`. Delete or quarantine before any stat work lands in the app.
- `clips.is_starred` / `is_point_of_emphasis` are likely dead columns — ★ and POE moved into `tags` as `category='special'`. Two sources of truth if anything still writes to them.
- `game_box_score` still splits 2FG/3FG — realign to NCAA convention.
- TEAM row in `season_player_stats` always has null GP. Should use team games played as denominator.
- `plays` tag category is empty — UI showing an empty section.

## Parked features

| Feature | Blocker |
|---|---|
| Player tag auto-provisioning from roster | Next priority — unblocks everything |
| Period / quarter tracking | `games.period_count` + `period_label` already exist. Needs `clips.period smallint` + sticky selector UI |
| Plus/minus, minutes played | Needs on-court state (substitution tagging). Errors propagate — fragile for volunteers |
| Stats visibility (3 levels: `coaches_only` / `team_totals` / `full`) | Setting on `teams`. Apply at read time, never in the view |
| Multi-sport tags | `tags.sport` column + data-driven category buckets (tagger hardcodes 4 at `tagging-overlay.tsx:307`) |
| Per-sport default tag sets on team creation | Volleyball coach currently gets an empty picker |
| Career stats | `group by player_lineage_id`. Needs `tags.player_id` |
| Year rollup across seasons | `extract(year from seasons.starts_on)`. Zero schema work |
| Shot charts | Needs x/y coordinates per shot |
| Assist networks | Free from bundle model — assist and make share a clip |

---

## The recurring lesson

Three separate features hit the same wall this session: bundling is optional, `team_score` is optional, lineups are optional.

**Film breakdown tolerates missing data. Stats don't.** Every stat feature has a data-entry precondition, and the schema is the easy half. Design question for the UI session isn't "can we compute this" — it's "will a coach reliably enter what it needs."

---

## Next session

**Session A — data (do this first):**
1. Roster into `players`
2. Provision player tags with `player_id` set
3. Enter `team_score` on games
4. Tag one full game, every possession
5. Run the verifier — diff should be 0

**Session B — UI:**
- Where the sheet lives: kid's wall, team wall, Film Room
- Game vs season vs career navigation
- Three-level visibility setting
- Sticky period selector
- Stat-tag visual indicator (thicker border on tags where `stat_primitive is not null`)

Do A before B. Building screens against 3 events means designing for data you've never seen.

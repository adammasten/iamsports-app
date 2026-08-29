# Plan: cross-team player identity + tag polarity

Two features that feed the same goal — a new parent claims their kid and can
immediately make a highlight tape worth sharing. Investigation-only; **no code
written.** Draft 2026-08-27. SQL is reviewable (Adam runs it in the editor).

---

# FEATURE 1 — Claiming a player pulls their full cross-team history

## Findings (live DB + code trace)
- **No cross-team identity exists.** `players.player_lineage_id` is scaffolded
  (migration_seasons, comment "groups a player's rows across seasons"), but **0
  of 27 rows are populated** and **no app code references it**. There's even a
  `merge_players` function and an *intended* backfill (`SET player_lineage_id =
  id`) that was **never applied to live**. Max on two teams = two unrelated
  `players` rows.
- **A claim links exactly one `players` row.** `claim_or_link_guardian` /
  `claim_roster_spot` each write a single `parent_player_links` row. Cross-team
  breadth today is faked via `team_memberships` — `claim_or_link_guardian`
  auto-joins the caller to every team **that one player row** sits on
  (`player_teams` fan-out). The other Max row stays invisible.
- **RLS gates clips strictly by team membership.** `clips_read` = creator OR
  (`team`+`is_team_member`) OR (`coaches_only`+`is_team_coach`). **No "this is my
  kid's clip" branch.** `games_read`/`videos_read` DO have `is_lineup_parent`,
  but `clips_read` does not — the lineup bridge never reaches clips.
- `loadContentFeed` is already all-teams/all-kids scoped, but keyed off the flat
  one-row-per-`parent_player_links` model — no cross-row aggregation.

## Proposed approach — light up the lineage spine (don't merge)
1. **Apply the dormant backfill:** every existing player becomes its own lineage
   root (`player_lineage_id = id` where null). Cheap, reversible.
2. **Linking = shared lineage.** To say "these two roster entries are the same
   kid," point both rows at one `player_lineage_id`. Preserves each team's roster
   row + team-scoped player-name tags (merging would destroy those).
3. **Claim links the whole lineage.** On claim, write `parent_player_links` for
   every `players` row in that lineage (+ the existing per-team membership
   fan-out). Multiple links, one human.
4. **New RLS helper `is_my_kids_content`** → add a branch to `clips_read` /
   `videos_read` / `games_read`: grant read when the content's `player_id` (or
   its game's lineup player) is in a lineage the viewer is a linked parent of —
   **independent of team membership.** This is the make-or-break piece.
5. **Confirmation UX:** on claim, "We found Max on 2 other teams — link them?"
   with one-tap confirm. No silent auto-link (two kids named Max is real).

## Open decisions (block the SQL)
- **D1. Match key** for the duplicate-detector: name only, or name + jersey /
  grad-class? (false-positive rate)
- **D2. Who can assert a link** — parent-confirmed only, or can a coach also say
  "these two roster entries are the same kid"?
- **D3. Read breadth** — does a linked parent see the kid's clips on the other
  team **fully**, or only content already shared / on a wall? (I lean full read
  of the kid's OWN clips — the differentiator — but it crosses the team boundary.)

---

# FEATURE 2 — Tag polarity (positive / neutral / negative)

## Findings (live DB + code trace)
- **No polarity column** on `tags`; it's orthogonal to the stat model. `stat_made`
  already separates MADE vs MISSED shots (seed source).
- **One tag-create path:** `app/(tabs)/tags.tsx` `addTag()` — insert
  name/category/sort_order/scope/team_id?/sport?. Polarity picker goes here.
- **Tag display is duplicated across ~5 screens** (`clips.tsx`, the FilterBar
  maps in `index.tsx` / `my-work.tsx` / `coaches-corner.tsx`, `export.tsx`) — no
  single client chokepoint → **DB-layer enforcement is the right call.**
- **Two viewer playback screens read NO tags** (`game-player.tsx`,
  `shared-viewer.tsx`) — fewer leak surfaces than feared.
- **`homeFeed.ts` reads no tags** — the wall/feed is share/content-level.
- **Precedent for DB-layer gating exists:** `tags_read` already calls
  `can_read_team_tag(team_id, category)` — category-based read gating. Polarity
  gating is the same shape (add role×polarity).
- **Special tags:** `★ Highlight` (→ positive), `POE` (→ neutral).

## Proposed polarity for every tag — REVIEW THIS

**NEGATIVE (hidden from parents/players entirely) — exhaustive:**
`MISSED 2`, `MISSED 3`, `MISSED FT`, `Turnover`, `INT thrown`, `Fumble`, `Drop`,
`Incompletion`, `Offensive Foul`, `Foul`, `Shooting Foul`, `Technical`,
`Missed flag pull`

**POSITIVE (highlight-worthy):**
`MADE 2/3/FT`, `Assist`, `Off Rebound`, `Def Rebound`, `Steal`, `Block`,
`Deflection`, `Charge Taken`, `Interception`, `Sack`, `Safety`,
`Forced Turnover`, `Forced fumble`, `Fumble recovery`, `Pass breakup`,
`Pass breakup (PBU)`, `Contested Shot`, `Contested catch`, `Box Out`,
`Touchdown`, `Passing TD`, `Rushing TD`, `First down`, `Big gain (20+)`,
`Completion`, `Deep completion`, `2-pt conversion`, `Flag pull`, `TFL (behind LOS)`,
`Stop / turnover on downs`, `QB pressure`, `Pressure`, `Tipped ball`,
`Forced incompletion`, `★ Highlight`

**NEUTRAL (descriptive — always visible):** ALL `players` (names), ALL `plays`
(schemes/formations/coverages), all offensive routes (Slant, Post, Corner, Fade,
Go, Wheel, Seam, In/Dig, Out, Hitch/Curl, Crosser, Back shoulder, Bubble,
Comeback), play-types (Handoff, Play action, Rollout, QB scramble, Run/Rush,
Reverse, Screen, Post Up, Isolation, Backdoor Cut, Off-Ball Screen, Swing Ball,
Scramble drill, Extra Pass, Paint Touch), defensive schemes (Man/Zone/Press/Trap/
Rotation/Denial/Closeout/Transition D/Undercut/Ball Screen D/Blanket coverage),
`POE`, `Second Chance`.

**⚠️ Ambiguous — your call:** `Fouled on Shot` (drew a foul → positive? or hide?),
`Comeback` (a route; neutral).

## The "clip has BOTH a positive and a negative tag" answer
**Strip, don't hide the clip.** Parent reads of `clip_tags` filter OUT negatives,
so a made-shot-that-drew-a-foul clip shows as the made shot with the foul
invisible. A clip whose ONLY tags are negative → **hidden** from parents (nothing
left to justify it). Untagged clips carry no lowlight info → stay visible.

## Enforcement (DB-layer)
1. `polarity` enum column on `tags` (`positive|neutral|negative`, NOT NULL,
   default `neutral`).
2. **`clip_tags_read`** — non-coaches only see rows whose joined tag polarity ≠
   `negative`. Strips negatives from every parent/player read.
3. **`clips_read`** — non-coach team members see a clip only if it has ≥1
   non-negative tag OR is untagged. Hides pure-lowlight clips. Coaches unchanged.
4. **Client** — the ~5 tag-display sites drop negatives for non-coaches (belt &
   suspenders; RLS is the real gate). `export.tsx` filters parent-built reels to
   non-negative clips.
5. **Tag-create UI** (`tags.tsx`) — require polarity via an unmistakable 3-way
   picker.
6. **Optional carve-out (default OFF, per-team coach toggle):** a kid + their
   linked parents see that kid's OWN negatives — never another family's. Rides on
   Feature 1's `is_my_kids_content`.

## Migration (draft — pending polarity approval)
```sql
create type tag_polarity as enum ('positive','neutral','negative');
alter table public.tags add column polarity tag_polarity;
-- seed shot polarity from stat_made
update public.tags set polarity = case when stat_made then 'positive'
  when stat_made = false then 'negative' else polarity end where stat_primitive='shot';
-- negatives (exhaustive list above), positives (list above), rest neutral
update public.tags set polarity='negative' where polarity is null and name in (/* negative list */);
update public.tags set polarity='positive' where polarity is null and name in (/* positive list */);
update public.tags set polarity='neutral' where polarity is null;
alter table public.tags alter column polarity set default 'neutral',
  alter column polarity set not null;
-- then: rewrite clip_tags_read + clips_read policies (join tag polarity vs is_team_coach)
```

---

## Sequencing recommendation
Feature 2 (polarity) is **self-contained and higher safety-urgency** (the
lowlights-leak) — ship it first. Feature 1 (identity) is bigger (new RLS spine +
UX) and the optional per-kid negative carve-out depends on it. Do polarity, then
identity.

## Open decisions summary (all block SQL)
- D1 match key · D2 who asserts a link · D3 read breadth (Feature 1)
- D4 approve the polarity list (+ the 2 ambiguous calls) (Feature 2)
- D5 build order: polarity first (my rec), or identity first?

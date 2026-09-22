# Stats — Deep Dive Before Building

**Written:** 2026-09-22 · **Status:** analysis and recommendation. No code, no migration.
**Companion:** `docs/STATS_BRIEF_FOR_AIS.md` (what exists in the repo today).

This doc answers four questions Adam raised: how should stats actually function, how is
everyone else doing it, what does "official vs unofficial" really mean, and what does the
tournament angle open up. It ends with a recommendation and the open decisions.

---

## 1. The reframe

Today IamSports works like this:

```
film  →  tag the film  →  derive stats     (stats are a BYPRODUCT of tagging)
```

Adam's instinct — *"stats are done at the game in real time, tagging is done later"* — is not a
tweak to that. It inverts it:

```
live scoring  →  stats                     (stats are the PRIMARY record)
       ↓
    timestamps  →  seed the tagging pass    (clips become the byproduct)
```

**That inversion is what the entire rest of the market already does.** Not one meaningful
competitor derives a youth box score from film tagging. They all put a person with a tablet at
the scorer's table, and then treat the video as something the stat log *indexes*.

GameChanger is explicit about the direction of flow: clips of every field goal, rebound, assist,
block and steal are generated **from the scorekeeping data** — "once a play is logged, a clip is
generated from that data," and real-time scoring is stated as *essential* to accurate clip
creation. BallerCam does the same thing from a second device. The stat log is the clip index.

So the question isn't "should we add live stats." It's "should we keep deriving stats from
tagging at all, or does tagging become the enrichment layer on top of a live record."

---

## 2. What everyone else is doing

### 2.1 The four models in the market

| Model | Who | How stats are produced | What it costs the user |
|---|---|---|---|
| **Live human scoring** | GameChanger, ScoreUp, BallerCam, every tournament platform | A person taps plays on a tablet during the game | One volunteer's full attention for 32–40 minutes |
| **Post-game human film tagging** | Hudl Assist, Synergy | You upload film; *their* paid analysts tag it | Real money, per game; queue-based turnaround |
| **AI from video** | SportsVisio, Hooper, FullCourt.ai, Pixellot | Computer vision on consumer footage | Subscription; ~24h turnaround |
| **Coach self-report** | MaxPreps, AAU event sites | A coach types a box score in afterward | Nothing — and it's worth what it costs |

**IamSports is currently in a fifth category nobody else occupies:** post-game film tagging done
by *the coach himself*, with stats falling out as a side effect. That's Hudl Assist's model with
the labor pushed back onto the customer, which is precisely the thing Hudl charges money to take
away.

### 2.2 The benchmarks worth knowing

- **GameChanger** — free for coaches and staff, including everything. Monetizes *parents* at
  $9.99/mo or $39.99/yr. One-tap entry for scores, rebounds, assists, steals, turnovers, with
  automatic follow-up prompts (made shot → who assisted? missed shot → who rebounded?). Basic
  and advanced modes. A **12-minute** training course and a practice mode so a volunteer can
  rehearse before game day. 4.9 stars across 750K+ reviews.
- **ScoreUp** — the closest thing to Adam's tournament idea already shipping. Tap-based entry of
  14 stat actions, works offline and syncs later, scorekeepers join with **one-time game codes
  and no account**, tournament operators "digitize the scorer's table with court QR codes."
  Auto-computes **MVP, All-Tournament First & Second Teams, and a Sniper Award** the moment the
  last game goes final. Pricing: **$125/yr per school, $2,000/yr premium, $200 per tournament.**
- **SportsVisio** — claims 95%+ on event detection (made shots, rebounds, fouls) and **92%+ on
  attributing the event to the right player**, on consumer-recorded footage. Full box score and
  per-player highlights within 24 hours. Processed 200+ games for one Irish camp operator in a
  single summer.
- **MaxPreps** — the "official" one, and worth understanding honestly. Its data comes from head
  coaches and school staff with Team Admin access, combined with partner feeds; fan submissions
  get reviewed. It is the official stats partner of **31 state associations**. But its own
  support docs concede scores are *not* official records in the legal sense — that's the state
  association's role.

### 2.3 The gap in the market, stated plainly

From the recruiting side, the complaint is consistent and loud: outside the Nike EYBL / UA
Association circuits, **verified data for club basketball is essentially non-existent**, so
players post unverified weekend stat lines and college coaches have no way to tell real from
padded-by-a-proud-parent. What coaches say they trust is *results recorded in a sanctioned
event* — a claim versus evidence distinction.

**Nobody has solved verification for grassroots basketball.** That is the opening.

---

## 3. "Official vs unofficial" — the line is not where people think

Adam's instinct to split stats into tiers is right. But the conventional line is wrong, and
using the word "official" loosely would make a promise the product can't keep.

### 3.1 What the official book actually contains

Per the NFHS instructions to scorers, the official scorer records:

- field goals made
- free throws made **and missed**
- a running summary of points scored
- personal and technical fouls charged to each player (and notification at the fifth)
- coach/bench misconduct warnings
- the names and numbers of starters and every substitute who enters

…and compares records with the visiting scorer after each goal, each foul, each time-out and
each quarter, notifying the referee immediately of any discrepancy.

**Rebounds, assists, steals, blocks and turnovers are not in the official book at all.** They
are statistician work — a separate, unofficial job. There is no governing body anywhere that
certifies a youth assist.

### 3.2 And the unofficial half is genuinely unreliable — at every level

This isn't a youth-sports problem. Van Bommel & Bornn's study of NBA box scores (published in
*Data Mining and Knowledge Discovery*, presented at Sloan) modeled per-scorekeeper bias for the
two most subjective stats, assists and blocks, and found measurable, persistent differences:
the Utah scorekeeper the stingiest with assists, Atlanta the most generous, Dallas scoring home
and away teams differently. Rebound totals get nudged into double digits as a player approaches
10. **In the NBA. With paid professional scorekeepers and every camera angle available.**

If the NBA can't make assists consistent, IamSports should not claim a volunteer parent at a 12U
tournament has.

### 3.3 The honest model: two axes, not one binary

**Axis 1 — Is the number verifiable, or is it a judgment call?**

| | Stats | Property |
|---|---|---|
| **Tier A — verifiable** | points, FGM/FGA by value, FTM/FTA, fouls, who played | **Reconciles against the final score.** Provably right or provably wrong. |
| **Tier B — judgment** | assists, rebounds, steals, blocks, turnovers | No ground truth exists. Subject to scorer generosity at every level of the sport. |

**Axis 2 — Where did the number come from?** (provenance, highest trust first)

1. **Scorer's table** — entered at the official table, tournament-operated
2. **Live team entry** — a coach or parent on the bench, during the game
3. **Film-derived** — tagged from the video afterward (what exists today)
4. **Hand-entered after the fact** — typed in later from a paper book or memory

The product should **never use the word "official"** for anything it produces, because it isn't
the state association. What it can say — and what is far more useful — is the thing in §4.

---

## 4. The idea this whole deep dive is actually for: the reconciled box score

IamSports already has free ground truth sitting unused: `games.team_score` and
`games.opponent_score`.

```
sum(box score points for the team)  ==  games.team_score   ?
```

If that equation holds, **every Tier-A stat in that game is proven complete**. Not "we think we
got most of it" — arithmetically closed. You cannot have missed a bucket, because the buckets
add up to the final score. Other free invariants from the July session stack on top:
`pts = 2*(fgm-fg3m) + 3*fg3m + ftm`, `ast <= fgm` at team level, and
`sum(player rows) + TEAM row == TOTAL row`.

That produces a badge that means something specific and is automatically checkable:

> **✓ Reconciled** — this box score adds up to the final score of 48–41.

And because this is a film app, it goes one step further than anyone else can:

> **✓ Reconciled · 31 of 34 scoring plays on film**

**That is the differentiator.** MaxPreps has coach-typed numbers with human review. AAU sites
have numbers nobody can check. ScoreUp has live numbers but no film. IamSports would be the only
one that can say *these stats add up, and here is the video of them.* Against the recruiting
complaint in §2.3 — a claim versus evidence — that is evidence.

It also reframes the accuracy anxiety productively. Stats aren't "accurate" or "inaccurate" in
the abstract; a given game either reconciles or it doesn't, and the app can say which, per game,
automatically, forever. A game that doesn't reconcile isn't a failure — it's labeled, and the
gap is the exact number of points unaccounted for.

---

## 5. Why live entry solves Adam's actual problem

The stated problem: *"I'm having problems with getting full games recorded, so stats are
definitely going to be off."*

That is a complete and sufficient argument on its own, and it's worth stating starkly:

**Film-derived stats inherit every gap in the footage. Live-entered stats don't.** Battery dies
at halftime, the tripod gets bumped, nobody remembered the phone — the film is compromised and
today that means the stats are silently, unknowably wrong. There is no way to tell a box score
missing 14 points because the camera stopped from a box score where the team just scored less.

With live entry, the camera failing costs you the *film*. It does not cost you the *stats*, and
the reconciliation check in §4 still runs, because `team_score` comes off the scoreboard, not
off the video.

This also means the two inputs fail independently, which is the property you want:

| | film good | film bad |
|---|---|---|
| **scored live** | complete stats + full film | complete stats, partial film |
| **not scored** | stats derivable by tagging (today's model) | nothing |

---

## 6. How live entry and tagging reconcile — the architecture already anticipates this

This is the most encouraging finding in the whole review, and it's why this isn't a rewrite.

`resolved_game_stats` is **already a per-row precedence resolver**. Model D, shipped 2026-08-01:
a hand-typed row in `game_stat_lines` overrides the tagged derivation for *one player row*, not
the whole game, matched on `(game_id, player_id, stat_side)` with
`IS NOT DISTINCT FROM` so the TEAM row resolves correctly. Every row carries a `source` column
(`'manual' | 'tagged'`) that the box score renders as a per-row badge.

Adding live entry is **widening that precedence list from two sources to four**, in the order of
§3.3 — not redesigning anything:

```
source:  'table'  >  'live'  >  'tagged'  >  'manual'
```

The UI already renders a per-row provenance badge. It already has revert-one and revert-all. The
RLS pattern (read = any confirmed team member, write = coaches of that game's team) already
exists and would extend to a live-scorer grant the same way `tagger_jobs` granted tagging rights
to a non-coach.

**What genuinely is new:** a live scoring screen, a clock/period model, and offline-first
capture. Gyms have bad wifi — ScoreUp treats offline-with-later-sync as a headline feature, not
a nice-to-have, and that's the right instinct.

### 6.1 The hard part nobody advertises: the common time base

For a live-entered stat to seed a clip, the stat and the video need a shared clock. Three
candidates:

- **Game clock** — one source calls it "sacred," and it's what pro systems key on. But it
  requires the scorer to keep it in sync by hand, and youth game clocks stop and start
  erratically.
- **Wall clock** — the scoring device's timestamp. Free, always available. Requires knowing when
  the video *started* in wall-clock terms and that the recording device's clock agrees.
- **Video timecode** — exact, but only exists after upload, which is the thing that's unreliable.

Wall clock is the only one available without an integration, and the offset it needs
(`video start time`) is one field on `videos` that the upload path could capture. **A ±3 second
error is fine** — a clip boundary is ±5s around the event anyway, and a coach can nudge it. This
does not need to be precise to be useful, which is the thing that makes it tractable.

---

## 7. The tournament angle

Adam's read — *"stats at tournaments can give us the opportunity to do some fun things if stats
are accurate"* — is correct, and ScoreUp's existence proves both the demand and the price point
($200/event, QR codes at the scorer's table, auto-computed MVP / All-Tournament First & Second
Team / Sniper Award the moment the bracket finishes).

What a tournament unlocks that a single team can't:

- **A closed universe.** Every team in the event, same weekend, same rules, same operator. That
  is exactly the "sanctioned event" condition that recruiting sources say college coaches
  actually trust.
- **Cross-team leaderboards.** Tournament scoring leaders, rebounding leaders. This is the thing
  that gets screenshotted and shared, and it's free once the data exists.
- **Auto-computed awards with the film attached.** An All-Tournament team is a nice graphic.
  An All-Tournament team where each selection links to that player's clips from the weekend is a
  different product, and it's one only a film app can ship.
- **A distribution wedge.** A parent whose kid appears on a tournament leaderboard has a reason
  to open the app who has never heard of it. Tournament operators are a channel, not just a
  customer.
- **Better scorers.** There is an active argument in the youth space for replacing volunteer
  parents with trained/paid scorekeepers at tournaments precisely because of accuracy and
  dispute handling. If the operator staffs the table, provenance tier 1 in §3.3 becomes real.

**The honest constraint:** tournament stats are only worth anything if the *whole event* is on
the platform. One team live-scoring its own games produces a leaderboard of one team. This is a
sell-the-operator motion, not a sell-the-coach motion — a different customer, a different sales
cycle, and it should not be confused with the core product.

---

## 8. Recommendation

**Stats become a first-class live record. Tagging becomes enrichment, not the source.**

Concretely, in order:

1. **Do not apply the v2 tag-set migration yet** (`5c4b5a6`, Piece 1, destructive, Piece 2 never
   written — see the companion brief §8). But note that its model is *better suited* to live
   entry than what's live today: collapsing 14 primitives to 7 with `stat_made` / `stat_value` /
   `stat_detail`, and moving side onto the event rather than duplicating the vocabulary, is
   exactly the shape a live scoring button needs. **This deep dive strengthens the case for v2 —
   which means Piece 2 needs writing before anything ships, not after.**

2. **Define the tiers in the data model before building any screen.** `source` widens to four
   values; Tier A vs Tier B becomes a property of the primitive. This is small and it is the
   thing that makes every later decision easy.

3. **Build the reconciliation check first.** It's a view and a badge. It works on the data that
   exists today, it needs no new UI beyond a line on the box score, and it immediately tells
   Adam how bad the current tagged data actually is — which is information he doesn't have and
   is currently guessing at.

4. **Then build live entry, minimum viable = points and fouls only.** This is the key design
   move: **Tier A alone is a complete, reconcilable box score.** A volunteer who only taps
   made/missed shots and fouls produces a *verified* result. Rebounds, assists, steals and
   blocks are an optional advanced mode for whoever wants them — mirroring GameChanger's
   basic/advanced split, and honest about §3.2 (the Tier B stats are the unreliable ones
   anyway). Design it so that doing less still produces something trustworthy, rather than
   something half-broken.

5. **Offline-first from day one.** Not a v2 concern. Gym wifi is the normal case, not the edge
   case.

6. **Capture video start wall-clock time on upload** (§6.1) — one field, cheap now, and it's
   what makes "live stats seed the tagging pass" possible later without re-instrumenting
   anything.

7. **Fix the season views' `player_id` join** while in there. One line, already identified, and
   every season number is NULL until it's done.

8. **Park the tournament product.** It's real, ScoreUp has validated it, and it is a different
   customer. It becomes available almost for free once 1–6 exist. Building toward it now would
   be building the roof first.

**What this explicitly de-prioritizes:** making tag-derived stats better. That path is capped by
the footage problem and can't be fixed by better code.

---

## 9. Open questions

1. **Who holds the tablet?** GameChanger assumes a team staff member. ScoreUp issues one-time
   codes to anyone at the table. For IamSports — is the live scorer the coach (who is coaching),
   a parent (who is watching their kid), or a role granted like tagging rights already are? This
   single answer determines the entire UX.

2. **Does live scoring compete with filming for the same person?** If it's the same parent
   holding the phone that's recording, this doesn't work, and the recording problem gets worse
   rather than better. Two devices, or two people, is a real requirement to state up front.

3. **Is Tier B worth collecting at all at the youth level?** Given §3.2 — the NBA can't do it
   consistently — there's a defensible position that IamSports should collect points and fouls
   live, take rebounds/assists from *film tagging only* (where you can rewind and be careful),
   and never ask a live scorer for them. That would be a genuinely differentiated stance: the
   judgment stats are the ones that get the film treatment, the verifiable stats are the ones
   that get the live treatment. **Each input does what it's actually good at.**

4. **What is the parent-facing unit?** A box score is a coach's artifact. Is what a parent
   actually wants a box score, or a per-kid season line with a season high and a trend, or just
   "your kid scored 8 and here are the 4 clips"? This determines whether the dark season views
   ship or get deleted.

5. **Does "reconciled" get shown to parents or kept internal?** It's a trust signal, but it's
   also an admission that unreconciled games exist. There's a version where it's a quiet quality
   gate on what gets published, and a version where it's a visible badge that becomes the brand.

6. **Where does this sit against the tag-flow rearchitecture** decided 2026-09-21? That design
   introduces `board` / `dimension` / `marker` roles, and v2's per-event `stat_side` is
   precisely a "dimension." The two efforts are now clearly the same effort and should be
   sequenced together.

---

## Sources

- GameChanger — basketball product, scorekeeping, and automatic clip generation:
  https://gc.com/basketball · https://gc.com/post/automatic-video-clips-for-basketball ·
  https://gc.com/gamechanger-university/scorekeeping-basketball
- ScoreUp — live stats, tournament awards, pricing: https://scoreupstats.com/
- SportsVisio — AI stats accuracy claims: https://www.sportsvisio.com/stories/how-ai-basketball-analysis-works
- Hudl Assist — human film breakdown model: https://www.hudl.com/products/assist
- NFHS — instructions to and duties of scorers:
  https://assets.nfhs.org/umbraco/media/7212324/2023-24-nfhs-basketball-scorers-timers-sheets.pdf
- MaxPreps — data provenance and state association partnerships:
  https://support.maxpreps.com/hc/en-us/articles/53680606871451-How-accurate-are-scores-reported-on-MaxPreps
- van Bommel & Bornn, *Adjusting for Scorekeeper Bias in NBA Box Scores* (DMKD / Sloan):
  https://arxiv.org/pdf/1602.08754
- Recruiting-side verification gap: https://www.utahbasketball.net/p/aau-info-sucks-college-coaching-conundrums ·
  https://scorability.com/guides/how-do-coaches-find-last-minute-recruits-with-verified-measurables/
- Volunteer vs professional tournament scorekeepers:
  https://beyondthefastbreak.substack.com/p/from-volunteer-to-professional-rethinking

---

# 10. DECISION — 2026-09-22

Adam, on who holds the tablet: *"could be the scorekeeper. Or a fan. Or a parent. The hard part
is having those people keep track of details — assists, rebounds — that's super tough to do in
real time. You can just keep track of points, that's about it."*

That closes §9.1 and §9.3 together, and it sets the whole design.

## 10.1 The locked division of labor

| | **Live, at the game** | **Film, afterward** |
|---|---|---|
| Who | anyone — scorekeeper, parent, fan, grandparent | the coach (or a paid tagger) |
| Skill | none | knows the game |
| Stats | **points and fouls** — who scored, what it was worth, who fouled | assists, rebounds, steals, blocks, turnovers |
| Why there | it's the only thing a human reliably catches live | rewind exists; judgment calls need it |
| Survives | camera failure | the scorer not showing up |

**The live scorer's job is attribution, not counting.** The scoreboard already has the team
total. All we need is *which kid* got those two points. That is one or two taps per score, ~50–60
times a game, with no judgment required — the ball goes in or it doesn't. Fouls add ~15–20 more
taps, and the ref announces the number out loud, so attribution is *spoken to the scorer* rather
than judged by them.

**The line this draws is the one the sport already draws.** Points, fouls, and who played is
exactly — item for item — what the NFHS official scorer records (§3.1). Everything we moved to
the film pass is exactly what a statistician does, unofficially, in a separate seat.

> **The live pass is the scorebook. The film pass is the statistician.**

That is the "official vs unofficial" split Adam was reaching for, drawn where basketball has
drawn it for a century, and it now falls out of the design rather than being asserted by us.

**Opponent scoring is not attributed at all.** `games.opponent_score` comes off the scoreboard
in one field. This retires the 8 `OPP …` tags and the per-opponent-player question for good.

## 10.2 Why points are exactly the right live stat

It isn't just that points are the easy one. Points are the **only** stat that reconciles against
the final score (§4). So the stat a volunteer can actually capture is also the stat that proves
itself. The two facts line up, and that's what makes the split principled rather than a
compromise.

Corollary for the live screen: show the scorer's running total against the scoreboard **while
they score**. "You have 23, the board says 25." The reconciliation check runs live, and errors
get fixed in the gym instead of discovered in the app three days later.

## 10.2a Fouls pay for themselves during the game

Points are recorded *for later*. Fouls are useful **right now**, and that changes the adoption
math. NFHS already requires the official scorer to notify an official the moment a player's
fifth foul is charged — the app can surface it a foul earlier, to the bench:

> **#32 — 4 fouls**

This is the first thing in the entire stats feature that helps a coach **win the game he is
currently coaching**, rather than document one he already played. That matters more than it
looks: we are asking a volunteer to do a job for 32 minutes, and the job gets done far more
reliably when the coach is actively asking for the output.

## 10.3 The unlock: live entry does not touch the tag system at all

A live-scored point has no clip and no tag. It is a direct fact: *(game, player, value, made,
timestamp)*. It does not need `tags`, `clip_tags`, `stat_primitive`, or the tagger's category
model.

**Therefore live scoring is not blocked by the tag-set v2 fork** (`5c4b5a6`, §8). The v2
migration stops being a stats decision and becomes purely a tagging decision, to be made on its
own merits, later, at lower stakes.

New table — **`scorebook_entries`**. Not `game_events` (`events` already means calendar event,
and `import_game_events` is a schedule-import function) and not `*_plays` (`plays` in this repo
means a *designed* play — playbook, play vault, library plays). `scorebook_entries` collides with
nothing and names the real-world artifact it mirrors.

```
scorebook_entries (
  id, game_id → games,
  player_id → players,        -- NULL = unattributed
  primitive text,             -- 'shot' | 'foul'
  made      boolean,          -- shots: true/false. false = attempt, gives FG%/FT% later
  value     smallint,         -- shots: 3 | 2 | 1
  detail    text,             -- fouls: 'personal' | 'technical'
  occurred_at timestamptz,    -- device wall clock, for the §6.1 video link
  period smallint NULL,
  created_by_user_id, created_at
)
```

**The column shape is deliberately v2's** (`primitive` / `made` / `value` / `detail`, per §8).
Live entry still doesn't need the tag system — but sharing v2's vocabulary means the resolver
unions the live and tagged sources with no translation layer. It is also independent evidence
that v2's decomposition is the right one: it's the shape we'd have invented here anyway.

**Not captured live: substitutions and minutes.** That's back in the "too hard in real time"
bucket. "Who played" comes free enough — anyone with a scorebook entry obviously played, and
`game_lineups` already auto-populates from tagging.

RLS copies `game_stat_lines` exactly: read = confirmed member of the game's team, write =
coaches **plus** a granted live-scorer, following the `tagger_jobs` grant pattern that already
exists for non-coach taggers.

## 10.4 Precedence

`resolved_game_stats` already resolves per row on `(game_id, player_id, stat_side)`. Widen its
source list:

```
points, fouls:  scorebook_entries  >  tagged  >  manual
other stats:    tagged             >  manual
```

Live wins on points because it saw the whole game. Tagging wins on everything else because it
had rewind. Hand-entry stays the universal override. The per-row badge UI, revert-one and
revert-all all already exist and carry over unchanged.

## 10.5 Build order

1. **Reconciliation view + badge.** Works on today's data, no new UI beyond a line on the box
   score. Tells us how wrong the current tagged data actually is — currently a guess.
2. **`scorebook_entries` + the live scorebook screen.** Roster grid, 3/2/1 + foul, big targets,
   undo, offline queue, running total vs the scoreboard, foul-trouble banner. The bulk of the
   work.
3. **Widen the resolver** to rank `scorebook_entries` above tagged for points and fouls.
4. **Capture video start wall-clock on upload.** One field, cheap now, enables #5.
5. *(later)* **Live entries seed the tagging pass** — each scoring play becomes a pre-marked clip
   boundary, so the coach opens the film with the buckets already found.
6. *(later)* **Fix the season views' `player_id` join**; decide whether the season sheet ships.
7. *(separate track)* The v2 tag migration, as a tagging question.

**Explicitly dropped:** making film-derived stats complete. It is capped by the footage problem
and no amount of code fixes it.

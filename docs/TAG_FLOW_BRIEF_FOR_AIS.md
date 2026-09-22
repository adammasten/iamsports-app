# Tag Flow for IamSports — Design Brief for External Review

*Paste this whole doc to another AI. It has no repo access, so everything it needs is here.
Every fact below was verified against the live Postgres database or the current source this
session — nothing is from memory. We want a **design recommendation for how tags should flow
between three screens**, not a rewrite of the app.*

---

## 1. What the app is

**IamSports** — Expo (SDK 54) React Native + Supabase app for youth-sports coaches and parents.
Coaches upload full game video, **tag the film**, then **export** highlight reels. Multi-sport:
basketball, flag football, 7-on-7, football, soccer, baseball, softball, volleyball, lacrosse.

### The tagging model (this is the product — do not propose changing it)

Tagging is **tap tags → "+ Group" bundles them → "Save clip"**. The same on every sport and
every surface (iPad, iPhone, web). Grouping is the whole point: a coach needs
*"Conrad + Made 3"* to be one thing and *"Conrad defended + Bailey scored"* to be another.

Storage: `clip_tags (clip_id, tag_id, bundle_number)`.
- `bundle_number = 0` → clip-level tag (applies to the whole play)
- `bundle_number = 1, 2, 3…` → a group

Export matching: a filter group of N tags matches a clip iff all N are in the clip-level set,
**or** all N are in `clip-level ∪ one single bundle`. Tags from two different bundles never
combine. **This matcher is id-based and category-agnostic** — it never looks at a tag's
category. That matters for migration safety (§7).

### The tag vocabulary table

```
tags (id, name, category, sport, scope, team_id, sort_order)
  scope  = 'global' (universal, shared by every team) | 'team' (one team's own)
  sport  = plain text, e.g. 'Basketball', 'Flag Football'; NULL = applies to all sports
  category = text key, e.g. 'offense', 'off_formation', 'players', 'possession'
```

There is also a per-team **hide** mechanism (`team_hidden_tags`) so a coach can suppress a
universal tag they don't use. The taggers already respect it.

---

## 2. The three surfaces, and the workflow the owner wants

```
   MY TAGS  ──────►  TAGGING SCREEN  ──────►  EXPORT
 (per team:        (tag a game: the      (build filter groups,
  add / hide /      board's columns       render a highlight reel)
  reorder tags)     and chips)
```

**The requirement, in the owner's words:** *"whatever's in the tags for the team needs to
automatically populate into the tagging screen when you're tagging a game, which automatically
populates the export screen. That needs to be the workflow."*

Today those three screens **disagree with each other**, and each one had to be fixed by hand
whenever a sport was added. That is the problem we want solved structurally.

---

## 3. What the owner says is wrong (his observations, verbatim intent)

1. **"When I go to tags under the team for flag football, I'm not seeing the tags we've
   created."** The tagging board shows the flag tags; the team's tag-management screen shows a
   different, basketball-shaped list.
2. **"When I pop up a new football team, all the global tags should be there."** They aren't.
   Adding a sport currently means hand-editing several screens.
3. **"In basketball I've made more tags, I can see them, but when I go to export I can't choose
   whether it's offense or defense."** The tagger has an Offense/Defense toggle at the top; there
   is no matching control on either the team tags screen or export.
4. **"If a tag has not been pressed, I don't want that tag to show up"** in export. *(This one
   already works — it must be preserved, not rebuilt.)*
5. **"The Bangels are 5-on-5 flag, but the plays are 7-on-7 plays, which is not cool. We need to
   be able to select and edit what type of flag it is."** There is no concept of a format/variant
   within a sport.

---

## 4. Verified current state

### 4.1 A single definition exists, but only 3 of 8 consumers read it

A shared module (`lib/core/tag-categories.ts`) declares, per sport, the ordered list of tag
categories. It was introduced ~10 days ago and the migration is **half done**.

| Consumer | Reads the shared definition? |
|---|---|
| Team tag management ("My Tags") | ✅ |
| "Make a highlight" screen | ✅ |
| Export — clip-group picker | ✅ |
| Native tagger (iPad/iPhone) | ❌ three hardcoded lists |
| Web tagger | ❌ independently duplicated lists |
| Export — "describe the reel" picker | ❌ hardcoded 4 |
| Reel editor | ❌ hardcoded 4 |
| Film-room filter bar | ❌ hardcoded 4 |

The five ❌ rows hardcode `offense / defense / plays / players` — the basketball shape — which is
why every non-basketball sport looks wrong somewhere.

### 4.2 The declared categories do not match the seeded data

What the code declares per sport, vs. what actually exists in the `tags` table (global scope):

| Sport | Code declares | Live rows | Result |
|---|---|---|---|
| Basketball | offense, defense, plays | offense 18, defense 21, plays 17 | ✅ agrees |
| Soccer / Baseball / Softball / Volleyball / Lacrosse | offense, defense, plays | same three, 9–18 each | ✅ agrees |
| **Flag Football** | phase-scoped: OFF (off_formation, off_play, off_result) · DEF (def_scheme, def_opp_play, def_our_play, def_result) · SP (st_play, st_result) | all nine categories seeded, 101 rows | ✅ agrees |
| **Football** | formation, play, defense, result | **only `special_teams` (16 rows)** | ❌ **all four columns render empty**; 16 rows unreachable |
| **7-on-7** | formation, play, defense, result | offense 24, defense 9, plays 17, special_teams 16 | ❌ only `defense` fills; **57 of 66 rows unreachable** |

The category `special_teams` (32 rows) is rendered by **no screen in the app**. It exists in the
tagger's internal data bucket but in none of its column lists.

**Nothing enforces that a declared category has rows, or that a row's category is declared.**
The two drift silently and the screen just renders empty.

### 4.3 "Stamps" are a second, invisible class of tag

Three categories behave differently from board columns — they are stamped on a clip rather than
tapped from a column:

| Category | Values | Written by |
|---|---|---|
| `possession` | Offense · Defense · Special Teams | a toggle in the tagger's top bar; **defaults to Offense and is written at bundle 0 on every clip saved** |
| `period` | Q1–Q4, 1H–2H, innings 1–9, EX, sets S1–S5 | period selector in the top bar |
| `special` | ★ Highlight · POE · Good Play | dedicated buttons |

For the football family the possession toggle **also swaps which columns the board shows**. For
every other sport it **only stamps** — the board is unchanged.

**These stamps are absent from the shared definition entirely.** Consequence:

- The team tags screen explicitly filters them out, so there is no place to see or manage them.
- Export has ad-hoc buttons for `special` (Highlight / POE), **nothing for `possession`, nothing
  for `period`.**
- Export does have an "All offense / All defense / All special teams" quick button, but it is
  gated on the sport having a *phase selector* — so the football family gets it and **basketball
  does not**, even though basketball stamps possession identically.

**Live example.** One basketball team has **101 clips: 51 stamped Offense, 49 stamped Defense.**
The coach tagged both sides of the ball on essentially every clip and **cannot export either
side.** The data is already there; no screen exposes it.

Note the naming collision this creates, which confused the owner: basketball has an `offense`
**category** (*what happened*: Made 3, Assist, Turnover) **and** an `Offense` **possession stamp**
(*which side of the ball the clip was*). The team tags screen shows the first and hides the
second, so the tagger's toggle appears to have no counterpart.

### 4.4 Sport is a free-text string, matched two different ways

`teams.sport` and `videos.sport` are plain text from a fixed picker list (`'Basketball'`,
`'Flag Football'`, …). But:

- **Code predicates** (`isFootballSport`, `isFlagFootball`, the definition lookup) compare
  **case-insensitively**.
- **The database queries that load tags** filter with an **exact, case-sensitive** equality on
  `tags.sport`.

One live team has `sport = 'basketball'` (lowercase) while every basketball tag row is stamped
`'Basketball'`. That team loads **zero** offense/defense/plays tags on every surface. Nothing
warns; the screen is just empty.

There is also no uniqueness constraint on the tag vocabulary, and duplicates have already
appeared: a flag team has *"Catch"* filed under the generic `offense` category twice (once
global, once team-scoped) while the real completion result lives in `off_result` — created
because the tag-management screen only offered the four basketball categories.

### 4.5 No concept of a variant within a sport

`teams` has no format/level column — `sport` is the only classifier. So 5-on-5 flag and 7-on-7
flag are indistinguishable, and both get the same seeded vocabulary, which is 7-on-7 flavored:

- `st_play` = Kickoff · Punt · Field Goal · PAT · Kick Return · Punt Return · Onside · Fake —
  **most 5v5 leagues have no kicking game at all**, so the entire Special Teams phase is noise
- `def_scheme` includes Cover 2 · Cover 3 — marginal with four defenders
- `off_formation` = Trips · Bunch · Empty · Spread · Stack · Motion · Deuce · Trey — "Empty" is
  near-permanent in 5v5

This generalizes beyond flag: 3-on-3 basketball, 7-a-side soccer, and 6-on-6 volleyball are all
real variants with different vocabularies.

**Separately: `sport` is not editable after a team is created.** It's set once at team creation
and no screen can change it. So a team created with the wrong sport is stuck — and there is
nowhere to put a format selector either. (A working "update team" path does exist and is used for
other team settings, so the write side is not the obstacle.)

---

## 5. What already works and must NOT regress

1. **Export only offers tags actually applied to the selected games.** Export loads every clip's
   tag ids for the chosen games and renders a category section only if that category has at least
   one *used* tag. **This is the behavior the owner explicitly wants preserved.**
2. **The bundle matcher** (§1) — id-based, category-agnostic. No per-sport export path exists and
   none should be added.
3. **Player co-occurrence dimming** in the export picker (tags that never appear with the selected
   player are dimmed).
4. **Per-team tag hiding** (`team_hidden_tags`), respected by the taggers.
5. **The tagger's on-screen layout is locked** across all sports — column positions, chip style,
   the right rail, the transport bar, the scrubber. **Only which categories fill the columns is in
   scope.** Do not propose layout changes.
6. Players are always a column, always sourced from the roster, always rendered last (on native).

---

## 6. Deployment reality that constrains rollout

- Native iOS ships through TestFlight; **the installed build lags the web build.** The
  currently-installed build predates the shared-definition work, which is why the same team shows
  correct tags on web and stale tags on iPad.
- Therefore the house rule for any tag-data change is **additive-first**: ship the build that
  *reads* new categories, confirm it's installed, *then* migrate data. Never empty or rename a
  category an installed build still reads.
- Category keys are stored in `tags.category` and referenced by existing tagged clips, so
  **renaming a key strands data.** Labels may change; keys may not.

---

## 7. Why a refactor here is safe (our reasoning — check it)

`clip_tags` rows reference tag **ids**, and the group matcher compares **ids**, never categories.
So changing *which categories are displayed or selectable* cannot strand an existing clip or
change an export result, **provided** no category key is renamed and no in-use tag row is deleted.
We believe the blast radius is display-only. **Tell us if that reasoning is wrong.**

---

## 8. What we want from you

1. **Source of truth.** Should the **code definition** declare categories (table holds only
   values), should the **`tags` table** be authoritative (derive the board from whatever rows
   exist for that sport), or a hybrid with a validation step? Today it's an unvalidated hybrid and
   that is exactly where the drift comes from. Give us a recommendation and the failure mode of
   the one you reject.

2. **Making the chain automatic.** What's the right mechanism so that a tag added on the team tags
   screen appears in the tagger and then in export **with no per-screen code**? Is one shared
   read-model enough, or does this want a contract test / CI check / runtime assertion that the
   three surfaces agree for a given team? How would you make drift *fail loudly* instead of
   rendering an empty column?

3. **Stamps as first-class.** How should `possession` / `period` be modeled so they flow to export
   as filters (and to the team tags screen as manageable vocabulary) without being confused with
   board columns — given the `offense`-category vs `Offense`-stamp name collision? Is a separate
   "dimensions" concept right, or should stamps just be categories with a flag?

4. **Variants within a sport (5v5 vs 7v7 flag).** Three options we see:
   - **(A)** make it a new sport value (`'Flag Football 5v5'`) — zero schema, but every
     exact-string sport comparison in the codebase silently misroutes, and it migrates existing
     tagged content;
   - **(B)** add a `format` column on teams plus an optional `format` scope on tags — additive,
     sport string unchanged, definition can vary by format (5v5 → no Special Teams phase);
   - **(C)** seed everything and let each team hide what it doesn't use with the existing
     per-team hide — zero schema, but manual per team and can't hide a whole phase.

   Which, and why? Should `format` be sport-specific or a general concept? How should an
   unspecified/legacy format behave?

5. **Seeding a new sport or team.** What should "add a sport" cost? Right now it's a code entry
   *plus* a hand-written SQL seed, and the two have already diverged (§4.2). Should seeds be
   generated from the definition? Should a team get *copies* of the universal tags at creation, or
   keep reading the shared global set (current behavior)?

6. **Identity/keying.** Is free-text `sport` matched by exact string the right key at all, given
   §4.4? Recommend the normalization or enum strategy, and how to migrate to it without breaking
   the already-seeded vocabulary (545 tag rows: 485 global, 60 team-scoped) or the existing
   tagged clips.

7. **Sequencing.** Given §6 (installed builds lag, additive-first, keys are immutable), what order
   would you ship this in to keep every intermediate state shippable? What's the smallest first
   slice that makes the three screens agree?

8. **Anything we're not seeing.** Particularly: a failure mode in §7's safety argument, or a
   reason the "one definition, every consumer reads it" approach breaks down as sports and
   variants multiply.

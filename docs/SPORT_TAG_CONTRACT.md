# Sport tag contract — one definition, every surface

Stated by Adam 2026-09-11. This document is the rule for how a sport's tags are
defined and how they flow, automatically, to every place tags are shown or used.
Once a sport's tags exist, nothing else should have to be built or discussed for
that sport to tag, manage, review, and export correctly.

If a screen shows categories that differ from the tagger for the same team, that
is a bug against this contract, not a design question.

---

## 1. The principle

**One definition per sport.** A sport has exactly one category definition. Every
consumer reads that definition. No consumer keeps its own list.

```
SPORT DEFINITION  ──►  Tagger (iPad / iPhone / web / web full screen)
   (one place)    ──►  My Tags (team tag management)
                  ──►  Export (game / clip export + filters + presets)
                  ──►  Film Room / reels / any future filter
```

The tagger's *layout* never changes per sport (see CLAUDE.md "LOCKED: Tagging
overlay layout" and "iPad tagger: the flag football board is the reference
layout"). This contract governs only **which categories fill the columns and
where that list comes from.**

---

## 2. What a sport definition contains

For each sport:

| Field | Meaning | Example (flag football) |
|---|---|---|
| `sport` | slug | `flag` |
| `periods` | period names for the top bar | Q1–Q4, 1H, 2H |
| `phases` | optional phase selector; football family only | OFF, DEF, SP |
| `categories` | ordered list, each with `key`, `label`, `color`, and (if phases exist) `phase` | OFF: formation / play / result · DEF: scheme / their play / our play / result · SP: play / result (the live flag keys — see §8.1) |
| `players` | always present, always the last column | — |
| `situational` | non-tag one-value-per-play fields | down, distance, drive (football only) |

Rules:
- `key` is the stable identifier stored in `tags.category`. **Keys are never
  renamed.** A display label can change; a key cannot, because existing
  `clip_tags` rows point at it.
- A sport without phases has a flat category list (basketball: offense,
  defense, plays).
- A sport with phases has phase-scoped categories. The phase is stamped on the
  clip; the category keys carry the phase prefix so they can never collide.
- Players are not a category in the definition; they come from the roster and
  are always rendered last.

---

## 3. Where the definition lives

One code constant per sport (the actual name is whatever `lib/core/` already
uses after CC's audit — reconcile there, do not create a second one). The `tags`
table stores the tags themselves, scoped by `tags.sport` and `tags.category`
(the key), with `universal` vs `team` ownership.

The definition is the *schema*; the table holds the *values*. Adding a tag is a
row. Adding a category is a definition change plus rows. Adding a sport is a
definition entry plus seeded rows plus period names. Nothing else.

---

## 4. What each consumer must do

### Tagger (all surfaces)
- Read the sport's categories (filtered by active phase, if any) and render them
  in the fixed column layout. Column count, position, chip style: unchanged.
- Never hardcode a category list per sport in the tagger file.

### My Tags (team tag management, `/tags`)
- Group tags by the sport's categories, in the definition's order, using the
  definition's labels and colors.
- If the sport has phases, show phase sections (OFF / DEF / SP) with their
  categories under each — the same grouping the tagger uses.
- Filter by `tags.sport` first. A flag team must never show basketball
  categories.
- Universal vs Team tags shown with the existing markers; hide/show and reorder
  unchanged.

### Export
- The filter builder is generated from the definition, not typed by hand:
  `phase (if any) × category × tag × player × flags (Highlight / POE / Good
  Play) × period`.
- Every category and every tag the sport defines is selectable, including
  phase-scoped ones. If a coach can tag it, a coach can export by it.
- Group matching stays on the existing `clipMatchesGroup` logic. No per-sport
  export path.
- Quick presets and sport recipes: see section 6.

### Everything else
Film Room, reels, stats, search, and any future filter read the same definition.
A new consumer that keeps its own category list is a contract violation.

---

## 5. Adding a sport — the checklist

1. Add the sport's definition entry (periods, phases if any, ordered categories
   with stable keys, colors).
2. Seed its universal tags in the `tags` table with `sport` and `category` set
   to the definition's keys.
3. Open the tagger on a test game: columns show the definition's categories.
4. Open My Tags for a team of that sport: same categories, same order.
5. Open Export for a tagged game: every category and tag selectable; the sport's
   quick presets appear.
6. Run the playback audit (unchanged by this, but it is the pre-ship habit).

If step 3, 4, or 5 shows something different from the definition, stop — a
consumer is not reading the definition.

---

## 6. Export: quick presets and coach recipes

> **Sequencing note (Adam, 2026-09-11):** presets and recipes are a **later build
> on top of the definition**, not part of the "one definition" reconciliation.
> They come after Phase 2 (see the migration plan). Until then, the existing
> manual filter/group picker — now generated from the definition — is the export
> experience.

### Quick presets (one tap, every sport)
Generated from the definition, so they exist automatically:
- **All Highlights**, **All POE**, **All Good Plays**
- **Every clip for [player]** — one per rostered player
- **By period** — Q1, Q2, … or 1H / 2H
- For sports with phases: **All Offense**, **All Defense**, **All Special
  Teams** — every clip stamped with that phase, back to back, in game order.
  This is the "watch every defensive play in a row" view.

### Coach recipes (curated, sport by sport)
Suggested exports surfaced in the export screen under "Ideas for this sport."
They are just saved filter combinations against the definition; adding one is
data, not code.

**Flag football**
- Offense: all touchdowns · all completions · all incompletions · big gains
  (20+) · all runs · all passes · red-zone plays · every play from a formation
  (Trips / Bunch / Empty …)
- Defense: all pass breakups · all interceptions · all flag pulls / tackles for
  loss · every blitz · every play in zone · every play in man
- Special teams: all kickoffs · all returns · all punts / punt returns
- By player: every play a kid touched the ball · every play a kid was targeted
- Situational: every 3rd down · every 4th down · every drive-ending play

**Basketball**
- Offense: all made 3s · all made 2s · all assists · all turnovers · every ball
  screen · every DHO · transition offense · BLOB / SLOB / ATO sets
- Defense: all steals · all blocks · all charges taken · every possession in
  zone · every possession in press · every closeout · box-outs
- Situational: every possession in the last 2 minutes of a half · every free
  throw trip
- By player: every touch · every shot attempt · every defensive stop

**Football / 7-on-7** — same shape as flag; add the situational fields (down,
distance, drive) as filters once they are stamped on clips.

**Other sports** — add a recipe block when the sport's tags are seeded. Until
then, quick presets alone are the export experience and are sufficient.

---

## 7. What this contract must never do

- **Never rename a category key.** Existing `clip_tags` rows depend on it.
- **Never remove a category** that an installed build still reads (Invariant 4:
  ship the reader, confirm installed, then migrate).
- **Never change tagger layout.** Columns, chips, rails, transport, scrubber,
  and pill stay exactly as locked. Only the category list and its source move.
- **Never let a consumer keep a private category list.** If one is found, the
  fix is to make it read the definition, not to patch the list.
- **Never ship a change to this flow without** (a) the tagger, My Tags, and
  Export showing identical categories for a flag team and a basketball team,
  and (b) an export of an already-tagged flag game and an already-tagged
  basketball game producing the same clips as before the change.

---

## 8. Reconciliation with the code (audited by CC, 2026-09-11)

### 8.1 The category lists that exist in code today — SEVEN independent copies

There is **no single per-sport category definition today.** Seven files each keep
their own hardcoded list; the taggers know the phase categories, the other five
know only the flat four — which is the whole bug this contract fixes.

| Consumer | File · symbol (line) | What it hardcodes |
|---|---|---|
| Native tagger | `app/tagging-overlay.tsx` — `CATEGORIES` (28), `FB_CATEGORIES` (795), `FLAG_PHASE_COLS` (805) | basketball flat · football 5-col · flag phase cols |
| Web tagger | `app/tagging-overlay.web.tsx` — `FLAG_PHASE_COLS` (660), `boardCols` (673 & 776), `category()` (617), grouped init (236) | same set, **independently duplicated** |
| My Tags | `app/(tabs)/tags.tsx` — `CATEGORIES` (13) | offense / defense / plays / players |
| Export | `app/export.tsx` — `REEL_TAG_CATEGORIES` (20); action set (747, 754) | offense / defense / plays / players |
| Edit reel | `app/edit-reel.tsx` — `CATEGORIES` (21) | offense / defense / plays / players |
| FilterBar | `app/components/FilterBar.tsx` — `TAG_CATEGORIES` (24) | offense / defense / plays / players |
| Make highlight | `app/make-highlight.tsx` (126) | inline `offense/defense/plays` = "actions" |

The one existing per-sport helper is `periodsForSport(sport)`
(`lib/core/periods.ts:28`) — periods only, no categories.

### 8.2 Which becomes the single definition, which get deleted

- **Single definition = NEW file `lib/core/tag-categories.ts`** (it does not
  exist yet — §3's "whatever `lib/core` already uses" has no category constant to
  adopt). It exports `phasesForSport(sport)` and
  `categoriesForSport(sport, phase?) → { key, label, color, bg }[]`, mirroring
  `periodsForSport`. `periodsForSport` stays as the periods half (or folds into
  the same module).
- **Deleted / replaced by a read of it:** all seven lists in 8.1 — native
  `CATEGORIES`/`FB_CATEGORIES`/`FLAG_PHASE_COLS`, web `FLAG_PHASE_COLS`/`boardCols`,
  My Tags `CATEGORIES`, export `REEL_TAG_CATEGORIES`, edit-reel `CATEGORIES`,
  FilterBar `TAG_CATEGORIES`, make-highlight's inline action set.
- **Kept:** the taggers' `grouped` bucket init (a category-keyed data bucket, not
  a per-sport list); `CAT_COLOR` maps (already carry the phase keys) may be
  derived from the definition later but aren't a per-sport list.

### 8.3 How My Tags derives its headers, and why a flag team shows basketball categories

- Headers are **hardcoded** — `CATEGORIES` (`tags.tsx:13`) = offense/defense/
  plays/players, rendered at :181.
- Tag load **is** sport-filtered (`:40–46`: global where `sport IS NULL OR
  sport = activeTeam.sport`, plus team tags), **but** bucketed only into those
  four keys (`:51` — `if (grouped[t.category]) …`), so every `off_*`/`def_*`/`st_*`
  tag is fetched and **silently dropped**. That is why a flag team renders the
  basketball-shaped four and the phase tags vanish, and why "Add tag" (`:64–68`)
  files everything under one of the four.

### 8.4 What a flag export currently produces

- Export output is a **concatenated highlight-reel video** — no tag columns are
  burned into it. Categories only drive the **picker** (`REEL_TAG_CATEGORIES`,
  4 flat, rendered at `export.tsx:1018`).
- For a flag clip tagged **formation + play + result + player**: only the
  **Players** column (plus any stray `offense`-category tag) is selectable; the
  `off_formation`/`off_play`/`off_result` tags are loaded (`:457 select('*')`)
  but never shown → **not exportable-by**. So "all touchdowns" / "all slants"
  reels are impossible for flag today.
- Matching (`clipMatchesGroup`, `lib/core/clip-filtering.ts:12`) is **tag-id
  based and category-agnostic**, so already-tagged clips still export correctly
  for whatever the picker lets you choose. This is why the refactor is safe (§8.7).

### 8.5 The two "Catch" rows on Regents, and dedupe

| id | name | category | scope | team |
|---|---|---|---|---|
| `f54963e9…` | Catch | **offense** | global (Universal) | — |
| `686625f3…` | Catch | **offense** | team | Regents Bangels 3rd Grade 2026 |
| `b64c27f8…` | Catch (Receiver) | **off_result** | global | — (the intended one) |

Both plain "Catch" rows were created **via My Tags**, which only offers
offense/defense/plays/players — so a completion result was filed under `offense`,
once Universal and once as a Regents team tag, while the tagger's real completion
result lives in `off_result`. **Root cause = 8.3**, not user error. There is **no
unique constraint** on `(sport, category, name, scope, team_id)`, so inserts can
duplicate. Prevention = My Tags reading this definition (right category offered in
the first place) + optionally a partial unique index (a separate data-integrity
add, not part of the reader refactor).

### 8.6 Where this contract diverges from the current code (do not implement as written)

- **§2 flag example is idealized, not shipped.** Live flag phase columns are
  **OFF:** formation / play / result · **DEF:** scheme / their play / our play /
  result (FOUR) · **SP:** play / result (TWO). §2 lists DEF as "front, coverage,
  result" and SP as "unit, play, result" — that's the tackle-football front/
  coverage model, not the flag board. Reconcile §2 to the shipped keys before
  coding, or treat §2 as aspirational.
- **§3 "whatever `lib/core` already uses"** — nothing does; the definition is
  net-new.
- **§6 presets & recipes do not exist in `export.tsx` today** — that's a separate,
  larger build on top of the definition, not part of the "one definition"
  reconciliation.
- **"Players always last" is violated by the WEB tagger** — native renders
  Players last everywhere; web renders Players **first** for basketball/football
  (`boardCols` 677/776, board JSX 1074) and last only for flag. Aligning is a
  **LOCKED-layout change requiring separate approval**; the definition refactor
  preserves each surface's current order and changes nothing here.

### 8.7 Why the refactor can't regress existing clips or exports

`clip_tags` reference tag **ids**; `clipMatchesGroup` matches on **ids**, never on
`category`. So consolidating the seven lists into one definition — which only
changes *which categories are shown/selectable* — cannot strand a clip or change a
match, **provided no category key is renamed and no in-use tag is deleted** (§7).
The before/after export check (§7 + the migration plan) is the proof gate.

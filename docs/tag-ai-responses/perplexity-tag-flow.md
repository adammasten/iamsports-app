# Perplexity — response to TAG_FLOW_BRIEF_FOR_AIS.md

*Captured from chat, 2026-09-21. Verbatim.*

---

Your core instinct is right: make a single, versioned tag catalog drive every surface, keep clip_tags and the matcher untouched, and model stamps as a separate kind of selectable metadata rather than pretending they are board columns. The current failure is not primarily a UI problem—it is an ungoverned taxonomy contract problem.

Your §7 safety argument is correct with one important qualification: changing category placement, labels, ordering, visibility, and availability does not alter existing bundle matching because matching uses tag_id, not tags.category. But removing a tag from the catalog can make existing tagged clips impossible to discover or filter in the UI, even though their data remains intact. Treat category membership as a presentation and eligibility contract, not merely decoration.

## Recommended architecture

Use a database-backed canonical catalog, with code consuming a typed read model and CI validating it. Do not make a TypeScript object the sole authority, and do not derive layout directly from arbitrary tags rows.

The right split is:

| Concern | Canonical owner | Why |
|---|---|---|
| Sport identity | Database lookup table | Stable IDs, display labels, aliases, foreign keys |
| Team's sport and format | teams | Every team has one resolved sport; format may be null/unspecified initially |
| Category/dimension definitions | Database catalog tables | Declarative, queryable, seedable, variant-aware, shared by web/native/export |
| Tag values | Existing tags table, linked to catalog definition | Existing IDs and tagged history survive |
| Team hides and custom tags | Existing team-scoped mechanisms | Team-specific behavior stays team-specific |
| Board layout rendering | Shared client/server read model | Every screen receives the same resolved shape |
| Export's used-tag filtering | Existing export query/matcher | Preserve the owner-required "only show pressed tags" rule |
| Validation | CI + migration validation + runtime telemetry | Drift becomes an explicit error, not an empty column |

The principal design rule should be:

> A screen must never independently decide which categories a sport has. It receives a resolved tag schema for the team and renders its assigned role.

That makes the workflow automatic:

```
team sport + team format + catalog + team overrides
  → resolved tag schema
  → { My Tags, Tagger, Export, Film Room, Reel Editor }
```

The shared schema is not just an ordered category list. It needs enough semantics to tell each surface what a category is for.

A conceptual resolved payload could look like:

```ts
type ResolvedTagSchema = {
  sport: { id: "flag-football"; label: "Flag Football" };
  format: { id: "5v5"; label: "5-on-5" } | null;

  boardGroups: Array<{
    key: "off_formation";
    label: "Offensive Formation";
    phase: "offense" | "defense" | "special_teams" | null;
    boardSlot: number;
    allowTeamValues: true;
    allowGlobalValues: true;
  }>;

  dimensions: Array<{
    key: "possession";
    label: "Possession";
    input: "single_select" | "multi_select";
    requiredOnSave: boolean;
    defaultValueKey?: string;
    tagBehavior: "clip_level_stamp";
    exportBehavior: "filter";
    teamManageable: true;
  }>;

  specials: Array<{
    key: "special";
    label: "Markers";
    input: "multi_select";
    tagBehavior: "clip_level_stamp";
    exportBehavior: "filter";
  }>;

  players: { enabled: true; position: "last" };
};
```

This is deliberately a read model, not necessarily the exact normalized storage design. Clients should not reconstruct it by separately fetching sports, formats, categories, tag values, hides, and custom tags. Build it centrally through an RPC, server endpoint, SQL view, or a shared repository layer.

## 1. Source of truth

Choose a hybrid, database-authoritative taxonomy with validation:

- The catalog declares valid sports, formats, category keys, category roles, labels, phase behavior, ordering, and variant applicability.
- The tags table holds values—global and team-scoped—attached to an approved catalog category.
- Code holds types and rendering behavior, but it should not separately declare the same per-sport category lists.
- A resolver produces the exact schema every consumer uses.

Do not use "whatever rows happen to exist in tags" as the board definition.

### Why rows alone are insufficient

Deriving the board from `SELECT DISTINCT category FROM tags` sounds flexible, but it makes data accidents become product structure:

- A typo such as `offence`, `def_resultt`, or a stale `offense` row silently creates another section or causes strange grouping.
- An empty but intentional category cannot render—exactly the situation where you want an operator warning, not a missing feature.
- You cannot express ordering, board slot, phase, whether a category is a board column versus a stamp, or whether it should be exposed in export.
- You cannot represent a 5v5 flag format's deliberate absence of Special Teams without relying on the accidental absence of rows.
- Team-specific tags could introduce a new category that changes the team's board structure, which should be a catalog decision, not a tag-entry side effect.
- It allows the same failure mode you have today: special_teams exists in data but is unreachable because nothing declares how it should render.

Conversely, a code-only definition is better than the current state but remains fragile:

- A new sport requires a code release even if the vocabulary is data-driven.
- Existing database rows can drift or be mistyped without a database-level constraint.
- Different installed mobile versions can carry different definitions.
- A code constant cannot safely provide referential integrity between tags.category and declared categories.

### Suggested normalized catalog

The names are illustrative; preserve your existing immutable tags.category keys.

```sql
sports (
  id uuid primary key,
  key text unique not null,              -- "basketball", "flag_football"
  display_name text not null,
  active boolean not null default true
);

sport_formats (
  id uuid primary key,
  sport_id uuid not null references sports(id),
  key text not null,                     -- "5v5", "7v7", "11v11", "3v3"
  display_name text not null,
  active boolean not null default true,
  unique (sport_id, key)
);

tag_definitions (
  id uuid primary key,
  key text unique not null,              -- existing category key: off_result, possession
  display_name text not null,
  kind text not null check (kind in ('board_category', 'dimension', 'marker')),
  value_model text not null check (value_model in ('tag_rows', 'roster')),
  export_filterable boolean not null default true,
  team_manageable boolean not null default true
);

tag_schema_entries (
  id uuid primary key,
  sport_id uuid not null references sports(id),
  format_id uuid null references sport_formats(id),
  tag_definition_id uuid not null references tag_definitions(id),
  phase_key text null,                   -- offense / defense / special_teams
  board_slot integer null,               -- only for board_category
  visible_in_tagger boolean not null,
  visible_in_my_tags boolean not null,
  visible_in_export boolean not null,
  required_on_clip_save boolean not null default false,
  default_tag_id uuid null references tags(id),
  sort_order integer not null,
  unique (sport_id, format_id, tag_definition_id)
);
```

Then evolve tags additively:

```sql
alter table tags
  add column sport_id uuid null references sports(id),
  add column format_id uuid null references sport_formats(id),
  add column tag_definition_id uuid null references tag_definitions(id);
```

You need not immediately delete the legacy text sport and category columns. Backfill the new foreign keys, dual-read or expose a compatibility view, and only eventually constrain new writes to the IDs.

For a minimal first slice, you can avoid a large schema redesign: retain tags.category and build a catalog table keyed by the existing immutable string. The important thing is that tags.category references a formally declared definition instead of an unconstrained text field.

### Make category definitions immutable in identity

Use stable machine keys: offense, defense, plays, off_formation, off_play, off_result, def_scheme, def_opp_play, def_our_play, def_result, st_play, st_result, possession, period, special.

Allow display labels to change: off_result might be labeled "Offensive Result"; special might be labeled "Markers"; possession might be labeled "Side of Ball."

But do not rename stored category keys. This fits your deployment constraint and preserves the identity of every existing tag row.

## 2. Make the chain automatic

One shared read model is necessary, but by itself it is not sufficient. Use all three layers:

- One resolver: `getResolvedTagSchema(teamId)` or `getResolvedTagSchema({ sportId, formatId, teamId })`
- One tag query contract: `getAvailableTagsForTeam(teamId)` grouped by resolved definitions
- Contract tests and validation: ensure each consumer can render the exact same resolved schema

### Surface behavior

| Surface | Uses schema for | Uses tag data for |
|---|---|---|
| My Tags | Sections, labels, ordering, dimensions, team-manageable controls | Global values, custom team values, hidden state |
| Native tagger | Board slots, phase-dependent visibility, top-bar dimensions, markers | Chips available to tap |
| Web tagger | Exactly the same | Exactly the same |
| Export | Filter sections and semantic labels | Only tag IDs actually used in selected clips |
| Reel editor / film-room | Category and dimension filter controls | Values present in the current result set |

The export flow should remain two-stage:

1. Resolve the team's catalog so export knows the valid sections, labels, sort order, and semantics.
2. Intersect those definitions with tag IDs actually used in selected clips.

That preserves the existing behavior exactly:

```
Export options = tags allowed by resolved team schema ∩ tags used in selected clips
```

Do not instead show all tags in the team catalog. The owner explicitly does not want unused tags shown.

### A concrete export example

For basketball, the catalog says: board categories offense, defense, plays; dimensions possession, period; markers special.

Suppose a selected set of games contains:

- 18 clips tagged with category offense
- 7 clips tagged with category defense
- 0 clips with category plays
- 51 clips stamped possession = Offense
- 49 clips stamped possession = Defense
- 4 clips stamped special = Highlight

Export should show: Offense tag values that were actually used; Defense tag values that were actually used; Possession: Offense, Defense; Markers: Highlight. No Plays section. No unused period options, unless at least one selected clip has them.

This makes "Offense" unambiguous by placement and label:

- Offensive actions → a board-category/filter section, e.g. Made 3, Assist, Turnover.
- Possession / Side of ball → a dimension filter, e.g. Offense, Defense, Special Teams.

Do not use the bare label "Offense" for both controls in export.

### Fail loudly

Empty sections should be treated differently depending on context:

| Condition | Expected behavior |
|---|---|
| No tag values are used in selected clips | Hide the export section; normal behavior |
| A board category is declared but has no available tag values for the team | Show an admin/developer-visible configuration error; do not silently render an empty board column |
| Data has a tag category not in the schema | Report validation failure and telemetry; provide a temporary "legacy/unmapped" diagnostic section in admin tooling |
| Schema says a category applies, but format excludes it | Do not render it; expected |
| Team hides every global tag in a category | Empty state may be intentional; show a management affordance, not an app error |

A user-facing tagging board should not be cluttered by technical warnings during a game. But development/staging should hard-fail, and production should emit telemetry plus an admin-visible diagnostic banner or dashboard. An empty required board slot should be observable immediately.

### Tests to add

Make the tests data-driven, not screenshots of individual sports.

- **Catalog completeness test**: every active sport/format resolves to a schema with valid definitions, unique board slots, and expected player behavior.
- **Vocabulary integrity test**: every global/team tags row maps to a valid sport and valid declared tag definition for its sport/format scope.
- **Reachability test**: every active global vocabulary tag is reachable from at least one valid resolved schema, unless explicitly marked deprecated/legacy.
- **No-empty-required-board test**: every declared board category has at least one available global value, or is explicitly allowed to start empty.
- **Consumer contract test**: native resolver, web resolver, My Tags, exporter, reel editor, and film-room filter all consume the same fixture and return the same category keys/order/labels.
- **Export preservation test**: an export option appears only when its tag ID appears in selected clips; verify grouped matching remains category-agnostic.
- **Legacy-data test**: every clip_tags.tag_id still resolves to a valid tag record and can be included in historical export results.

Most importantly, test resolved schemas, not just individual source files. A test that asserts "Flag Football has these nine keys, in these slots, with these stamp dimensions" is far more protective than a test that asserts a component received an array.

## 3. Treat stamps as dimensions

Yes: introduce a separate dimensions concept. "Categories with a flag" can work internally, but the product and resolver should explicitly distinguish at least three kinds:

| Kind | Examples | User interaction | Storage behavior | Export behavior |
|---|---|---|---|---|
| Board category | offense, defense, off_formation, def_result | Tap chips in board columns | Can be clip-level or bundled according to existing tagging flow | Tag-value filters and grouped matching |
| Dimension | possession, period | Select from top bar | Normally clip-level stamps at bundle 0 | First-class filter controls |
| Marker | special | Dedicated buttons | Clip-level stamps at bundle 0 | First-class filter controls |

You can store all three as tag rows and preserve clip_tags exactly as it is. The distinction belongs in the catalog and UI contract, not necessarily in a new tagging storage system.

That gives you an elegant rule:

> A tag is a tag ID for storage and matching; its definition kind determines where it appears and how it is selected.

### Possession

Model possession as a single-select, clip-level dimension:

- Values: Offense, Defense, Special Teams.
- Default: Offense only if that is intentional and product-approved.
- Required-on-save: ideally yes for sports where it has meaning, but do not retroactively invalidate historic clips.
- Export: always available when used in selected clips, regardless of whether the sport has phase-dependent board columns.
- My Tags: visible under a "Clip details" or "Dimensions" grouping, rather than as a board column.

The present inconsistency—basketball stamping possession but not exposing it in export—is a direct consequence of tying export availability to the football-family phase selector. Decouple those concepts:

- Board phase selector: controls which board categories are visible for sports whose board changes by phase.
- Possession dimension: an independently exportable clip stamp for every sport that writes it.

They may share values, but they are not the same feature.

### Period

Model period as a dimension with sport-specific value sets: basketball Q1–Q4 + OT/EX; baseball/softball innings; volleyball sets; soccer halves and extra time; football/flag quarters/halves according to format or league convention.

Avoid treating values like Q1, 1H, S1, and inning 1 as interchangeable global values without scope. They can remain tag rows, but applicability belongs in schema entries or in a value-definition table.

### Markers

Model special as a multi-select marker dimension: Highlight, Point of Emphasis, Good Play. These are not mutually exclusive and should be presented as independent filterable markers. The current bespoke Highlight/POE export buttons should become catalog-driven while retaining any familiar placement or styling you want.

### My Tags organization

The team screen should not flatten all tag vocabulary into identical category sections. Keep the locked tagger layout unchanged, but organize administration semantically:

- Tag board: the categories that populate board columns.
- Clip details: Possession and Period.
- Markers: Highlight, POE, Good Play.
- Hidden tags: team overrides, as today.
- Custom tags: team-specific additions assigned to an allowed definition.

This makes it clear why Offense might appear in two places with different meanings: "Offensive actions" contains action tags; "Possession" contains the side-of-ball stamp.

## 4. Variants: choose B

Choose B: a general format concept on teams plus optional format applicability on the tag catalog. Do not make "Flag Football 5v5" a new sport string, and do not rely solely on per-team hiding.

| Option | Recommendation | Reason |
|---|---|---|
| A. New sport strings | Reject | It overloads sport identity with a variant, breaks existing exact-string routing, multiplies comparisons, and makes "all flag football" reporting/querying harder |
| B. format on teams + scoped catalog | Choose | Preserves sport identity, supports sport-specific variants, allows defaults and inheritance, works for future variants |
| C. Hide unused tags per team | Keep as override only | Useful for local preferences, but poor as the primary modeling mechanism for structural differences such as no Special Teams |

Format should be general as a schema concept and sport-specific in allowed values: basketball 3v3/5v5; flag football 4v4/5v5/7v7; soccer 7v7/9v9/11v11; volleyball 6v6, potentially 4v4. Baseball/softball formats may ultimately include rule-set or age-level variants, though you do not need to over-model that now.

Avoid a global unconstrained `format = '5v5'` string with no sport context: "5v5" has different meaning in basketball and flag football. The stable identity should be scoped:

```
format identity = (sport, format key)
```

### Inheritance rule

Resolve catalog entries in this order:

1. Base sport entries, applicable to all formats.
2. Format-specific entries, which can add, override, or suppress base entries.
3. Team-level hides.
4. Team-scoped tag values.

For example: Flag Football base has off/def categories and common dimensions; Flag Football 7v7 enables Special Teams categories and 7v7-specific formations/schemes; Flag Football 5v5 suppresses the Special Teams phase, uses a 5v5 vocabulary, and perhaps omits Cover 2/Cover 3. Team hides: a coach may still hide a tag such as "Motion," even if it is valid for 5v5.

### Legacy/unspecified formats

Add teams.format_id as nullable initially. For teams without a format:

- Resolve the base sport profile, not an arbitrary 7v7 profile.
- Do not silently apply a variant-specific vocabulary.
- In My Tags/team settings, show a non-blocking configuration prompt: "Choose game format to tailor your tag board."
- Allow the tagger to continue operating on the base profile.

For existing flag teams whose behavior must remain stable initially, you can temporarily map null format to a documented legacy profile that reproduces today's configuration. That is safer than changing their boards unexpectedly.

The safest approach is: NULL is semantically "unspecified" at the data level; resolver policy can map null to legacy-default during transition; new teams must select a format where the sport supports multiple formats, or explicitly choose "Not specified." Once existing teams are migrated through an admin/user prompt, remove the legacy fallback.

### Editing sport and format

Add editable sport_id and format_id to the existing update-team path, but treat changing them as a configuration migration, not a casual field update.

Changing a team's sport or format does not alter historic clip_tags, but it may change which vocabulary appears for future tagging and what filters are discoverable for historic video. Therefore:

- Warn before changing sport/format.
- Preserve the old profile association on videos if team sport can change over time.
- Prefer storing a resolved sport_id/format_id on videos at creation, or otherwise snapshot/tag the game's profile version, so an old 7v7 game remains discoverable as 7v7 after the team later becomes 5v5.
- Keep export filters capable of resolving historical tag IDs even when the team's current profile differs.

This is the biggest caveat to your §7 argument: categories do not affect matching, but changing a team's current sport/format can make historical tags no longer appear in the current team catalog. Historical video should carry enough context to remain interpretable.

## 5. New sports and team creation

Adding a sport should be a controlled catalog change, not "edit code in five places plus hand-write SQL."

The target cost should be:

1. Create sport and allowed formats.
2. Create or select tag definitions using stable category keys.
3. Create schema entries: role, ordering, board slot, phase, dimension/marker behavior, visibility.
4. Seed global tag values from a versioned catalog package/migration.
5. Run validation and contract tests.
6. Release the clients that can render the schema.
7. Activate the sport for team creation.

### Generate seeds from the catalog

Yes: seed vocabulary from the same declarative source that defines the schema. That source may be database migrations containing structured catalog data; versioned JSON/YAML/TypeScript fixture files compiled into migrations; or an internal catalog-management UI later, once governance is mature.

For your current scale, I would favor versioned migration-owned catalog fixtures: reviewable in pull requests; reproducible across local, staging, and production; easy to validate against live tags; not dependent on a production admin UI before the governance model is stable.

A single source file can declare a sport profile and generate both catalog records/schema entries and idempotent global vocabulary seed rows. The seed process must be idempotent and must never delete or rename existing rows automatically.

### Do not copy global tags per team

Keep the current shared global-tag model. Do not copy universal tags into each team at team creation.

Copying would create avoidable problems: duplicate IDs for the same semantic tag across teams; larger data volume and more migrations; a vocabulary correction requires updating every team copy; more opportunities for divergent labels/categories; harder analytics and cross-team querying; more complicated hide/restore behavior.

Instead:

```
available team tags = global tags for resolved profile ∪ team-scoped custom tags − team-hidden global tags
```

The team creation flow should simply create the team with its selected sport_id and optional format_id; no tag rows need to be copied. Its My Tags screen and tagger immediately resolve the correct global set. Team hiding remains a per-team override.

For the "new football team should have all global tags" requirement, this means the team appears to have all proper tags immediately because it is assigned a valid profile and reads the shared global vocabulary—without seeding copies into the team.

## 6. Identity and keying

Free-text sport strings should not remain the operational key. The current mismatch—teams.sport = 'basketball' versus tags.sport = 'Basketball'—is exactly the kind of silent data split foreign keys exist to prevent.

Use a stable ID plus canonical machine key:

```sql
sports:  id UUID, key "basketball", display_name "Basketball"
teams:   sport_id UUID references sports(id)
videos:  sport_id UUID references sports(id), format_id UUID nullable references sport_formats(id)
tags:    sport_id UUID nullable references sports(id), format_id UUID nullable references sport_formats(id)
```

Keep human-facing labels separate from keys.

### Migration approach

Do this additively:

1. Create sports and sport_formats.
2. Seed canonical sports from the fixed picker list.
3. Add nullable sport_id columns to teams, videos, and tags.
4. Backfill using normalized matching—e.g. lower(trim(old_sport)) mapped through a controlled alias table.
5. Produce a report for unmatched, ambiguous, or unexpected values; do not guess.
6. Change new writes to populate both old text and new IDs temporarily, or expose a compatibility view.
7. Change reads in the new resolver to use IDs.
8. Add NOT NULL and foreign keys only after backfill and old-client support permits it.
9. Eventually deprecate text fields or retain them only as display/cache fields generated from the lookup.

For immediate protection before the full migration, standardize every legacy query on the same normalized predicate:

```sql
lower(trim(tags.sport)) = lower(trim($1))
```

and add an index matching that expression if it is needed. PostgreSQL documents that ordinary unique/primary-key indexes are case-sensitive; citext or a functional index can support case-insensitive comparisons and uniqueness, but stable foreign-key IDs are still the stronger long-term design for a controlled domain such as sports.

### Vocabulary uniqueness

You also need a uniqueness rule for tags, but decide it carefully because labels can validly repeat across categories.

A likely semantic uniqueness constraint is:

```
(scope, team, sport, format, definition, normalized name)
```

For example: global "Catch" in off_result, Flag Football, 7v7 — one row. Team-specific "Catch" in the same definition — allowed only if you intentionally permit a team override, otherwise prevent it. "Catch" in off_result versus def_our_play — potentially allowed because the category makes meaning distinct.

Use a normalized name for uniqueness—trimmed, case-folded—to prevent Catch, catch, and Catch becoming separate vocabulary entries.

Do not use a generic category text field as the only integrity mechanism. It should become a foreign key to a stable tag_definitions record, even if you preserve the original text key during migration.

## 7. Safe rollout sequence

Your additive-first house rule is correct. Use an expand–migrate–contract rollout, where clients and data are compatible at every intermediate step; this is especially important when TestFlight builds lag the web client.

### Phase 0: Inventory and freeze

- Export a complete inventory of tags, clip_tags, sport strings, categories, global/team scope, duplicate candidates, and tag usage counts.
- Identify every distinct value in teams.sport, videos.sport, and tags.sport.
- Identify every category with tag rows but no schema entry, including special_teams.
- Identify every declared category with no rows, including Football's declared formation/play/defense/result categories.
- Freeze renames and destructive deletes of category keys and tag rows.
- Define explicit status for every legacy category/tag: active, deprecated-but-readable, unmapped, or migration target.

### Phase 1: Introduce catalog and resolver, no behavior change

- Add sports, optional sport_formats, tag-definition records, and schema entries.
- Add nullable foreign-key columns alongside legacy text fields.
- Backfill IDs from known strings.
- Build getResolvedTagSchema.
- Build a diagnostic/admin report that compares resolved schema with actual available tag rows.
- Keep current UI paths live; do not yet remove any hardcoded behavior.

At this phase, validate that the resolver can describe current Basketball, Soccer, Baseball, Softball, Volleyball, Lacrosse, Flag Football, Football, and 7-on-7 without changing what users see.

### Phase 2: Fix the shared web path first

The smallest first slice that makes the three primary screens agree is:

- Make My Tags, web tagger, and export all consume the same resolved schema.
- Include possession, period, and special as dimensions/markers in that schema.
- Preserve export's "used tag IDs only" intersection.
- Add the configuration diagnostics.

This is the first slice because it fixes the core workflow without requiring a native build to update instantaneously. It also proves the resolver against the three screens named in the owner's requirement.

However, if the installed iPad build remains a primary active tagging surface, do not migrate data categories or remove legacy fallback behavior after web ships. The web path should be compatible, but native must be updated before any data changes that alter old-client assumptions.

### Phase 3: Ship native reader support

- Replace all three native hardcoded lists with the resolver response.
- Replace web duplicated lists at the same time if they remain.
- Ensure old and new clients can both read all existing category keys.
- Add native TestFlight coverage for every sport and at least Flag 5v5/7v7 if formats are already enabled.
- Confirm adoption of the new build through your usual release telemetry or version checks.

### Phase 4: Move the remaining consumers

Update the export "describe the reel" picker, the reel editor, the film-room filter bar, and any hidden tagger bucket that still handles special_teams independently. No screen should retain an independent offense / defense / plays / players array.

### Phase 5: Repair data additively

Only after the new readers are installed:

- Add schema entries for existing reachable legacy categories.
- Make special_teams reachable where it should be.
- For Football and 7-on-7, decide whether the correct action is to add schema entries that surface existing data; add new tag values for declared categories; or mark stale categories deprecated and map only through non-destructive UI compatibility.
- Add correct 5v5 and 7v7 Flag Football format profiles.
- Add/repair global values with new tag IDs; do not rename or delete used tag rows.
- Deduplicate vocabulary using a merge process, not a delete: choose canonical tag ID; migrate clip_tags from duplicate ID to canonical ID only if semantic equivalence is confirmed; preserve an audit mapping; then hide/deprecate the duplicate instead of immediately deleting it.

Be cautious with duplicate "Catch": the generic offense Catch and off_result completion result might not be semantically identical. Do not merge based on label alone.

### Phase 6: Enforce writes and retire legacy paths

Only after all active clients read the catalog: make sport_id required for new rows; enforce category/definition foreign keys for new tags; enforce vocabulary uniqueness; require or prompt for format where appropriate; remove hardcoded consumer lists. Keep legacy category aliases/read compatibility for historic data as long as old clips exist. Only much later consider dropping old text sport fields.

Do not rename category keys. In a mobile ecosystem, category-key renames are equivalent to an API-breaking change because installed apps may still query the old key.

## 8. Important risks and missing cases

### Historical profile drift

The largest issue not fully addressed in the brief is that teams.sport is used as a proxy for a game's taxonomy. If a team changes sport or format, historic videos may become difficult to interpret through the team's current schema.

Mitigation: store sport_id, format_id, and ideally a schema/profile version on each video/game when it is created. Resolve tagging/export against the video's profile for game-specific workflows. When exporting across videos from incompatible profiles, either group by compatible schema; show only the intersection of compatible filters; or allow a richer union with clearly segmented labels.

A team can legitimately play 7v7 in one season and 5v5 later. The clips should retain the correct context.

### Global tag applicability

A tag row with sport = NULL is currently "all sports." That is convenient but dangerous for a growing taxonomy. Define whether a universal tag is truly universal across every sport, universal within a family, or merely currently unscoped because it was seeded before sport scoping existed.

Do not let null silently mean "valid in every format" unless that is genuinely intended. special markers may be universally applicable; a "Punt" tag is not.

### Hide semantics versus catalog semantics

Per-team hide is appropriate for optional vocabulary. It should not be the only control for structural categories: a 5v5 Flag Football profile should not merely hide every Special Teams tag; it should not declare the Special Teams board phase at all. A team may then hide particular valid 5v5 values as preference.

The catalog defines what belongs; hides define what this coach prefers not to see.

### Required dimension data quality

Because possession currently defaults to Offense and stamps every saved clip, historic data may include Offense values that mean "not explicitly chosen" rather than "coach confirmed Offense."

Do not silently reinterpret old data. Consider tracking whether a stamp was explicitly selected only for new clips if that distinction matters. At minimum, label the migration and analytics assumption clearly.

### Category is not semantic truth

Your matcher being category-agnostic is a strength for backward compatibility, but it also means bad grouping is possible: a coach can bundle a possession stamp with an action tag if the UI permits it; a custom team tag can be assigned to an inappropriate category; a category migration does not alter matching, but a UI change can change future bundling patterns.

You should use catalog metadata to constrain where a tag may be selected: dimensions/markers should always write at bundle 0; board tags can participate in bundles; players remain a board-column selection and preserve the current grouping behavior. Do not permit stamps to be added to arbitrary + Group bundles.

### Data validation versus runtime rendering

A runtime fallback such as "render any unknown category at the end" sounds resilient but will hide governance failures. Use it only in an internal diagnostic/admin view. Production gameplay UI should render known, validated schema; unknown data should trigger telemetry and an operator alert.

## Bottom line

Adopt a database-backed tag catalog + shared resolved schema + strict validation. Keep tags as the storage for values and clip_tags as the storage for applied tag IDs; do not change the bundle matcher. Add a general, sport-scoped format concept; use it to vary the catalog structurally, with team hiding retained as a local preference layer.

The immediate first product slice should be:

1. Build the resolver.
2. Move My Tags, web/native taggers, and export onto it.
3. Model possession, period, and special as explicit dimensions/markers.
4. Preserve export's used-tag-only logic.
5. Add diagnostics that flag declared-but-empty and data-but-unmapped categories.

Do not migrate/rename/delete tag categories until the new native reader has shipped and adoption is confirmed.

That turns the desired workflow into a property of the architecture rather than a convention developers must remember:

```
Team configuration → one resolved vocabulary → Tagger → applied tag IDs → Export filters
```

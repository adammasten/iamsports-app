# ChatGPT — response to TAG_FLOW_BRIEF_FOR_AIS.md

*Captured from chat, 2026-09-21. Verbatim.*

---

The architecture I'd recommend is a database-backed Tag Schema Registry + one shared resolver. The screens should stop knowing what "basketball tags" or "flag football tags" are. They should ask one thing:

"Resolve the tag schema for this team/game."

That resolver returns the board columns, dimensions, markers, roster column, vocabulary, ordering, hidden state, and phase rules. My Tags, the tagger, and export then become different views of the same resolved model.

That preserves the core product behavior, including bundles and ID-based matching, which is exactly the right foundation to keep.

## 1) Source of truth: use a validated database registry, not code-only and not tags-only

I would not make the current code definition authoritative. You already have proof of its failure mode: the shared definition exists, but only three of eight consumers use it, while the others still carry their own basketball-shaped logic.

I also would not derive the schema from whatever happens to exist in tags. Rows alone cannot tell you things like:

- whether a category is supposed to exist but happens to have zero values,
- column order,
- whether a field is a board column versus a possession selector,
- which phase it belongs to,
- whether it is single-select,
- whether it comes from the roster rather than tags,
- whether it applies only to 5v5.

That exact absence of validation is why Football can declare four columns while its actual rows live somewhere else, and why 7-on-7 currently strands most of its vocabulary.

Instead, put the runtime definition in relational metadata. Conceptually:

```
sports
  id
  key              // "basketball", "flag_football"
  label

sport_formats
  id
  sport_id
  key              // "5v5", "7v7"
  label
  is_default

tag_fields
  id
  sport_id
  format_id?       // null = all formats
  key              // "off_formation", "possession", etc.
  label
  role             // board | dimension | marker | roster
  phase?           // offense | defense | special_teams
  sort_order
  required?
  single_select?
  default_value_id?

tags
  id
  field/category key
  name
  scope
  team_id
  ...
```

You do not necessarily have to replace tags.category immediately. tag_fields can initially describe the existing immutable category keys.

So it is technically a hybrid, but a controlled hybrid:

- Database = runtime configuration and vocabulary.
- Shared code = schema validation and generic rendering.

No more independent sport definitions hidden in six different components.

## 2) Make My Tags → Tagger → Export automatic with one resolver

The requirement is very clear: whatever belongs to the team should flow into tagging, and whatever was actually tagged should flow into export.

I would create one operation along the lines of:

```
resolveTagSchema({
  teamId,
  videoId?,
  mode: 'manage' | 'tag' | 'export'
})
```

Or preferably a versioned server RPC/API:

```
GET /teams/{teamId}/tag-schema
```

Its canonical response might look roughly like:

```
{
  schemaVersion: 3,
  sport: { key: "flag_football", format: "5v5" },
  phases: [
    { key: "offense", fields: [...] },
    { key: "defense", fields: [...] }
  ],
  dimensions: [
    { key: "possession", values: [...] },
    { key: "period", values: [...] }
  ],
  markers: [
    { key: "special", values: [...] }
  ],
  rosterField: {...}
}
```

Then the three screens project it differently:

- My Tags gets the whole manageable schema, including hidden items.
- Tagger gets visible board fields + dimensions + markers + roster.
- Export gets the same semantic fields, then intersects their tag IDs against the IDs actually present in the selected games.

That last part is important because the current behavior that export only exposes tags actually used in those clips is explicitly something you want to preserve.

I would not let each screen query tags independently anymore.

And yes, add contract tests. One read-model greatly reduces drift, but tests make drift noisy instead of ghostly.

For example:

```
expect(resolve(teamId, "manage").fieldKeys)
  .toContainAll(resolve(teamId, "tag").fieldKeys)

expectEveryTagCategoryHasDefinition()
expectEveryDefinitionCategoryToBeKnown()
expectNoDuplicateGlobalVocabulary()
expectEveryFormatBelongsToSport()
expectEveryConfiguredDefaultValueToExist()
```

In development/CI, an undeclared category should fail.

In production, I would log/telemetry it and render something explicit such as `Tag configuration unavailable` rather than silently showing an empty column.

An empty board should never again be the application's way of saying, "our metadata is broken."

## 3) Make stamps first-class, but do not pretend they are board categories

This is probably the most important conceptual cleanup.

Right now possession, period, and special are stored as tags but behave very differently from ordinary board chips. possession, for example, is automatically stamped at bundle 0 and controls football-family board state, while export barely exposes it.

I would model three semantic roles: `board`, `dimension`, `marker`.

A board field participates in the "+ Group" workflow.

A dimension describes the clip itself and generally has one current value. Examples:

- possession = offense | defense | special_teams
- period = Q1 | Q2 | Q3 | Q4

A marker is zero-or-many clip metadata: highlight, POE, good_play.

All three may continue to physically use clip_tags. You do not need a storage rewrite just to obtain sane semantics.

That also solves the nasty basketball naming collision. Today you effectively have:

```
category offense
  Made 3
  Assist
  Turnover
```

versus:

```
dimension possession
  Offense
  Defense
```

Those become completely unambiguous internally:

```
board.offense
dimension.possession.offense
```

The UI can still say "Offense" wherever appropriate. Identity should never depend on the human-readable label.

Your live basketball example is particularly compelling because the required data already exists: 51 offensive and 49 defensive clips, yet the UI does not expose that dimension properly.

So this should require essentially no clip migration.

## 4) Variants: choose B, but make format a general concept

I would absolutely choose the equivalent of B.

Do not invent 'Flag Football 5v5' as another sport. That puts configuration information into an identity string, and you already know exact string matching is dangerous. One lowercase basketball team currently manages to miss its entire vocabulary because application comparisons and SQL comparisons behave differently.

Instead: `sport = flag_football` + `format = 5v5`, and `sport = flag_football` + `format = 7v7`.

Make format general rather than flag-specific because, as your brief points out, this problem will recur with basketball, soccer, volleyball, etc.

I would make the team setting something like `team.format_id`, but I would also snapshot it onto the video/game: `videos.format_id`.

That is one issue I think the current proposal is missing.

Imagine a team plays 5v5 this year and 7v7 next year. If you simply edit `team.format = 7v7` then open last year's 5v5 film, you do not want the old game suddenly resolving against a 7v7 board.

So the rule should be: `new video.format_id = current team.format_id`. Changing the team's format affects future games. Existing games retain their historical format.

I would probably apply the same principle to canonical sport identity too, since videos already carry their own sport.

For legacy teams with no format, `format_id = NULL` should resolve against the sport's explicit default_format, not some implicit application guess.

For Flag Football you might configure legacy/default = 7v7 initially if that matches today's vocabulary, then let teams explicitly change to 5v5.

## 5) Adding a sport should become a data/configuration task, not an app rewrite

Once the generic renderer exists, adding a sport should ideally cost:

1 sport record + optional format records + field definitions + vocabulary rows + validation.

No tagger code. No export switch statement. No reel-editor switch statement. No "remember to add this to the fourth hardcoded array."

I would not copy all global tags into every new team.

Keep the current shared-global architecture: global vocabulary + team-created vocabulary + team hide/order/preferences.

Copying the universal set into each team would produce hundreds of little forks of your vocabulary and eventually turn "rename this tag" into an archaeology project.

You already have the right primitive in team_hidden_tags. I would expand that concept into something like:

```
team_tag_preferences
  team_id
  tag_id
  hidden
  sort_order?
```

while preserving the existing hiding behavior.

## 6) Kill free-text sport identity

I would introduce a canonical sport table and move joins/lookups onto an ID:

```
sports
  id
  key UNIQUE
  label
```

Then add nullable sport_id to teams, videos, tags.

Backfill via normalized matching: `lower(trim(existing_sport))` against a controlled migration map.

This requires no change whatsoever to existing tag.id values or clip_tags.

Then temporarily dual-write sport + sport_id. Switch all readers to sport_id. Once every supported client is reading it successfully, make sport_id required where appropriate and stop depending on the text column.

I would keep label editable but make sports.key effectively immutable.

That removes the exact/case-sensitive bug class demonstrated by the lowercase basketball team.

I would also add vocabulary uniqueness constraints. Something roughly equivalent to:

- global: sport_id + field/category + normalized tag name + applicability
- team: team_id + field/category + normalized tag name

You may want exceptions, but accidentally creating two "Catch" tags in the same semantic bucket should no longer be possible.

## 7) Deployment sequencing: additive-first is exactly right

Your rollout rule is correct. The installed native build can lag the web build, and category keys are already referenced by live historical data.

I would ship in this order:

1. Build the resolver using today's schema and today's category keys. Change no tag data.
2. Convert all remaining consumers to the resolver, especially both taggers and all export/reel/filter surfaces.
3. Add validation and telemetry. Unknown category, unknown sport, malformed format, duplicate vocabulary, etc. must become visible failures.
4. Ship the new generic native build through TestFlight. Confirm adoption before changing category availability.
5. Add canonical sport_id alongside existing sport strings. Backfill and dual-write.
6. Introduce first-class field roles for board/dimension/marker while leaving all tag IDs and category keys alone.
7. Expose possession and period automatically in export through the resolved metadata model.
8. Add format_id to teams and videos and introduce 5v5/7v7 applicability.
9. Repair Football and 7-on-7 vocabulary drift additively. Do not rename keys underneath old clients.
10. Only much later, deprecate legacy text identity and dead configuration paths after you know no shipped client depends on them.

The smallest first slice that actually changes your life is therefore: one resolver + make My Tags, web tagger, native tagger, and export use it, without changing one row of existing vocabulary.

That alone fixes the architectural source of disagreement. The data cleanup should come afterward.

## 8) Your §7 safety reasoning is mostly correct, but there are a few important caveats

Your core reasoning is sound: clip_tags references tag IDs, and bundle matching compares IDs instead of categories. So changing how categories are presented should not change historical matching provided IDs remain and you do not delete relevant rows.

I would tighten the claim from "blast radius is display-only" to "historical matcher semantics are stable, but discoverability and future tagging semantics can still change."

There are four places I would protect carefully.

**Historical hidden/deprecated tags.** Suppose a coach tags 50 clips with a global tag, then later hides or deprecates it. Exporting those old games should probably still expose that tag because it exists in those selected clips. Do not let today's team_hidden_tags accidentally erase historical exportability. Hiding should generally affect tagging availability, not destroy access to tags that are already present on old clips.

**Format changes.** This is why I strongly recommend snapshotting format onto videos. Without that, changing a team from 5v5 to 7v7 changes the schema through which old footage is interpreted.

**Moving a tag between semantic fields.** Technically the matcher still works by ID, but export presentation could move it into a different section. Therefore changing tags.category is not harmless even if it does not break matching. I would treat category keys on existing tags as immutable just as you propose.

**Dimensions need cardinality rules.** If possession is supposed to be one value per clip, your database currently stores it in the same flexible structure that can hold many tags. Your resolver or write path should enforce at most one possession value at bundle 0, at most one period value at bundle 0. Otherwise you will eventually find a clip stamped both Offense and Defense and have to decide what that means.

## Final architecture

```
                    DATABASE
                       │
          Sport / Format / Field Registry
                       │
                  Tag Vocabulary
                       │
                 Shared Resolver
                       │
          ┌────────────┼────────────┐
          │            │            │
       MY TAGS       TAGGER       EXPORT
    manage/hide    use visible    used IDs only
      /reorder       schema       + dimensions
          │            │            │
          └────────────┴────────────┘
                  same identity
                  same metadata
                  same semantics
```

The key idea is that tags remain the vocabulary and IDs remain the historical identity, while a separate registry describes what those tags mean and how they should be presented.

That gives you something much more durable than "one shared array everybody imports." It becomes a little tag operating system: sports, formats, dimensions, board fields, and vocabulary can grow without each new sport waking up five separate screens and demanding tribute.

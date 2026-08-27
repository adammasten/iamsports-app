# Export tag scoping (highlight wizard)

How `app/export.tsx` scopes the step-2 tag picker. Built 2026-08-27.

## The problem it fixes
The tag picker used to render `tags.filter(t => t.category === cat)` — the ENTIRE
global tag vocabulary (every team, every sport). After the multi-sport buildout,
that meant a **basketball** export showed **football** tags that were never
applied to any basketball clip. The picker ignored what was actually tagged.

## Slice 1 — scope to tags actually used in the selected games
- The loader already builds `gameTagsById` (game → applied tag IDs). We added a
  parallel **`clipTagSets`** (`{ gameId, tags: Set }[]`, one per tagged clip) in
  the same pass — no extra query.
- `usedTagIds` = union of `clipTagSets` for the **selected** games.
- Picker renders `tags.filter(t => t.category === cat && usedTagIds.has(t.id))`.
- Result: only tags actually applied in the chosen games appear. Football (and
  any unused) tags disappear automatically — they're never on a basketball clip.
- Empty state: if the selected games have no applied tags, a hint shows instead
  of a blank picker.

## Slice 2 — player co-occurrence dimming
- When the group-in-progress (`currentGroup`) contains one or more **`players`**-
  category tags, `playerCoTagIds` = the set of tags that co-occur (on the same
  clip, in the selected games) with ALL of those players.
- Tags outside that set are **dimmed** (`tagBtnDimmed`, opacity 0.3). Pick "Lars"
  → tags that never appear on a Lars clip fade back; his tags stay bright.
- Dimmed tags remain **tappable** (you can still build a cross-player group); the
  dim is a visual hint, not a hard block. `null` when no player is picked (no dim).

## Known caveats / approximations
1. **Co-occurrence is clip-level; matching is bundle-level.** `clipMatchesGroup`
   is bundle-aware (a group matches only if the tags share a bundle or are all
   clip-level). The dimming uses simpler clip-level co-occurrence, so it's a
   HINT, not an exact predictor — it won't hide valid options, but a
   non-dimmed tag could still fail to match via bundles, or vice-versa. Good
   enough for guiding the eye; the actual clip selection still uses the exact
   bundle logic.
2. **Special tags unaffected.** "★ Highlight" / POE are category `special`,
   surfaced by their own buttons — not scoped by `usedTagIds`, so an
   all-highlights reel still works.
3. **Shared file (native + web).** Both platforms get this.

## Files
- `app/export.tsx` — `clipTagSets` state + loader, `usedTagIds` /
  `playerCoTagIds` memos, picker filter + dim, empty-state hint, `tagBtnDimmed` /
  `emptyTagsHint` styles.

## Future (not built)
- Make the dimming bundle-exact (use `clipMatchesGroup` as the co-occurrence
  test) if the clip-level approximation proves confusing in real use.

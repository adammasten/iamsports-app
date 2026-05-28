// Pure predicate logic for filtering clips against tag groups in the export
// flow. No React Native or expo imports — safe to reuse in the upcoming web
// client. The two sentinel IDs below are virtual "tag-like" flags that appear
// in tagGroups[] arrays alongside real tag UUIDs, but they gate on boolean
// columns of the clip (is_starred / is_point_of_emphasis) rather than matching
// tag_ids in clip_tags. Real tags in the same group still need to satisfy the
// bundle-aware clip-level / bundle-union matching rules.

export const HIGHLIGHT_FILTER_ID = '__highlight__';
export const POE_FILTER_ID = '__poe__';

export type ClipForFilter = {
  clipLevelTagIds?: string[];
  bundles?: string[][];
  is_starred?: boolean;
  is_point_of_emphasis?: boolean;
};

export function clipMatchesGroup(clip: ClipForFilter, group: string[]): boolean {
  if (group.length === 0) return false;

  const hasHighlightFilter = group.includes(HIGHLIGHT_FILTER_ID);
  if (hasHighlightFilter && !clip.is_starred) return false;

  const hasPOEFilter = group.includes(POE_FILTER_ID);
  if (hasPOEFilter && !clip.is_point_of_emphasis) return false;

  const realTags = group.filter(t => t !== HIGHLIGHT_FILTER_ID && t !== POE_FILTER_ID);
  // Group contained only sentinel(s); the early-return gates above already
  // filtered out clips that lack the required flags, so anything reaching here
  // passes (e.g. group=[★] matches every starred clip; group=[★, !POE] matches
  // every clip with both flags).
  if (realTags.length === 0) return true;

  const clipLevel = clip.clipLevelTagIds ?? [];
  const bundles = clip.bundles ?? [];

  // Match via clip-level alone
  if (realTags.every(tagId => clipLevel.includes(tagId))) return true;

  // Match via clip-level + some single bundle
  for (const bundle of bundles) {
    const combined = [...clipLevel, ...bundle];
    if (realTags.every(tagId => combined.includes(tagId))) return true;
  }
  return false;
}

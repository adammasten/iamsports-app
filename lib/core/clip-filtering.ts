// Pure predicate logic for filtering clips against tag groups in the export
// flow. No React Native or expo imports — safe to reuse in the upcoming web
// client. ★ Highlight and POE are now real tags (category='special',
// scope='global'), so a group is always a list of tag UUIDs and the
// bundle-aware AND match is the only logic needed.

export type ClipForFilter = {
  clipLevelTagIds?: string[];
  bundles?: string[][];
};

export function clipMatchesGroup(clip: ClipForFilter, group: string[]): boolean {
  if (group.length === 0) return false;

  const clipLevel = clip.clipLevelTagIds ?? [];
  const bundles = clip.bundles ?? [];

  // Match via clip-level alone
  if (group.every(tagId => clipLevel.includes(tagId))) return true;

  // Match via clip-level + some single bundle
  for (const bundle of bundles) {
    const combined = [...clipLevel, ...bundle];
    if (group.every(tagId => combined.includes(tagId))) return true;
  }
  return false;
}

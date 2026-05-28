// Pure reorder math for the tags screen. Caller provides the array in its new
// order (post-drag); we return only the rows whose sort_order differs from
// their array index. Persisting the diff (instead of always rewriting every
// tag's sort_order) means a drag that moves one tag two slots emits ~3 row
// updates, not N. No React Native or expo imports — safe for the future web
// client to reuse.

export type ReorderableTag = {
  id: string;
  sort_order: number;
};

export function computeSortOrderUpdates<T extends ReorderableTag>(
  reordered: T[]
): { id: string; sort_order: number }[] {
  const updates: { id: string; sort_order: number }[] = [];
  reordered.forEach((tag, newSortOrder) => {
    if (tag.sort_order !== newSortOrder) {
      updates.push({ id: tag.id, sort_order: newSortOrder });
    }
  });
  return updates;
}

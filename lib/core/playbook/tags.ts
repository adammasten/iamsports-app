// Canonical play-tag vocabulary. Grouped by the dimensions the spec names
// (formation → personnel → play family → direction → situation), adapted to
// basketball. The editor offers these when tagging a play; filters read them.
// Free-form tags are still allowed on a play — this is the suggested set, not a
// hard enum, so coaches aren't boxed in.

export type TagGroup = { key: string; label: string; tags: string[] };

export const PLAY_TAG_GROUPS: TagGroup[] = [
  { key: 'situation', label: 'Situation', tags: ['Half-court', 'BLOB', 'SLOB', 'Transition', 'ATO', 'Last shot', 'Need a 2'] },
  { key: 'defense', label: 'Vs defense', tags: ['vs Man', 'vs Zone', 'vs Press', 'vs Switch'] },
  { key: 'family', label: 'Set / family', tags: ['Horns', '5-out', '4-out-1-in', 'Box', 'Stack', 'Zipper', 'Flex', 'Motion', 'Pick & roll', 'Press break'] },
  { key: 'action', label: 'Primary action', tags: ['Ball screen', 'Off-ball screen', 'Give & go', 'Hand-off', 'Post-up', 'Iso'] },
];

// Flat list of every suggested tag, in group order.
export const ALL_PLAY_TAGS: string[] = PLAY_TAG_GROUPS.flatMap(g => g.tags);

// A stable colour per group so a tag chip reads its dimension at a glance.
export const TAG_GROUP_COLOR: Record<string, string> = {
  situation: '#e2574a', defense: '#4a90e2', family: '#3ec46d', action: '#f5c518', other: '#9db0bd',
};

const TAG_TO_GROUP: Record<string, string> = Object.fromEntries(
  PLAY_TAG_GROUPS.flatMap(g => g.tags.map(t => [t, g.key])),
);

export function tagColor(tag: string): string {
  return TAG_GROUP_COLOR[TAG_TO_GROUP[tag] ?? 'other'];
}

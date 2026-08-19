// Play-tag vocabulary. Grouped by the spec's dimensions (formation → personnel →
// play family → direction → situation), adapted to basketball. This is the
// SUGGESTED starter set to browse — tags are free-form text, so a coach can
// search it, add their own, and reuse what they've used before (the editor
// merges these with the coach's own tags into one searchable pool).

export type TagGroup = { key: string; label: string; tags: string[] };

export const PLAY_TAG_GROUPS: TagGroup[] = [
  { key: 'situation', label: 'Situation', tags: [
    'Half-court', 'BLOB', 'SLOB', 'Transition', 'Early offense', 'ATO', 'Last shot',
    'Need a 2', 'Need a 3', 'End of quarter', 'Quick hitter', 'Continuity', 'Special',
  ] },
  { key: 'defense', label: 'Vs defense', tags: [
    'vs Man', 'vs Zone', 'vs 2-3 Zone', 'vs 3-2 Zone', 'vs 1-3-1', 'vs 1-2-2',
    'vs Box-and-1', 'vs Triangle-and-2', 'vs Press', 'vs Switch', 'vs Trap', 'vs Hedge', 'vs Drop',
  ] },
  { key: 'family', label: 'Set / family', tags: [
    'Horns', '5-out', '4-out-1-in', '3-out-2-in', 'Box', 'Stack', 'Zipper', 'Flex',
    'Motion', 'Princeton', 'Read & react', 'Dribble drive', 'Pick & roll', 'Pick & pop',
    'Spain P&R', 'Chicago', 'Floppy', 'Elevator', 'Ram', 'Stagger', 'Pistol', 'UCLA',
    'Delay', 'Press break', 'Zone offense', 'Swing', 'Shuffle',
  ] },
  { key: 'action', label: 'Primary action', tags: [
    'Ball screen', 'Off-ball screen', 'Down screen', 'Back screen', 'Flare screen',
    'Cross screen', 'Pin-down', 'Give & go', 'Backdoor', 'Hand-off', 'Post-up', 'Iso',
    'Cut', 'Flash', 'Seal', 'Rescreen', 'Slip', 'Ghost',
  ] },
  { key: 'personnel', label: 'For (personnel)', tags: [
    'For our PG', 'For our wing', 'For our post', 'For our best shooter', 'For our best scorer',
    '3 guards', '2 bigs',
  ] },
];

// Flat list of every suggested tag, in group order.
export const ALL_PLAY_TAGS: string[] = PLAY_TAG_GROUPS.flatMap(g => g.tags);

// A stable colour per group so a tag chip reads its dimension at a glance.
export const TAG_GROUP_COLOR: Record<string, string> = {
  situation: '#e2574a', defense: '#4a90e2', family: '#3ec46d', action: '#f5c518', personnel: '#a78bfa', other: '#9db0bd',
};

const TAG_TO_GROUP: Record<string, string> = Object.fromEntries(
  PLAY_TAG_GROUPS.flatMap(g => g.tags.map(t => [t, g.key])),
);

export function tagColor(tag: string): string {
  return TAG_GROUP_COLOR[TAG_TO_GROUP[tag] ?? 'other'];
}

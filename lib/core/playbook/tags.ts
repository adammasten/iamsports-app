// Play-tag vocabulary, keyed by sport AND side (offense / defense / special
// teams). The editor shows the groups for the play's current context, so a
// football defense play offers fronts + coverages, not basketball sets. Tags are
// free-form text — this is the SUGGESTED starter set; a coach can search it, add
// their own, and reuse what they've used before.

import type { PlaySide } from './playDoc';

export type TagGroup = { key: string; label: string; tags: string[] };
type Sport = 'basketball' | 'football';

// ── Basketball ────────────────────────────────────────────────────────
const BB_OFFENSE: TagGroup[] = [
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
const BB_DEFENSE: TagGroup[] = [
  { key: 'scheme', label: 'Scheme', tags: [
    'Man', '2-3 Zone', '3-2 Zone', '1-3-1', '1-2-2', 'Match-up Zone', 'Box-and-1',
    'Triangle-and-2', 'Full-court Press', 'Half-court Trap', 'Run & Jump', 'Pack Line',
  ] },
  { key: 'situation', label: 'Situation', tags: [
    'vs P&R', 'vs Iso', 'Scramble', 'Late-clock', 'ATO defense', 'Deny', 'Switch everything',
  ] },
];

// ── Football ──────────────────────────────────────────────────────────
const FB_OFFENSE: TagGroup[] = [
  { key: 'formation', label: 'Formation', tags: [
    'Shotgun', 'Under Center', 'Pistol', 'Empty', 'I-Form', 'Trips', 'Bunch', 'Twins',
  ] },
  { key: 'personnel', label: 'Personnel', tags: ['10', '11', '12', '21', '22'] },
  { key: 'run', label: 'Run', tags: [
    'Inside Zone', 'Outside Zone', 'Power', 'Counter', 'Trap', 'Sweep', 'Draw', 'QB Run',
  ] },
  { key: 'pass', label: 'Pass', tags: [
    'Quick Game', 'Play Action', 'Screen', 'RPO', 'Verticals', 'Mesh', 'Flood', 'Boot',
  ] },
  { key: 'situation', label: 'Situation', tags: [
    'Red Zone', 'Goal Line', '3rd & Short', '3rd & Long', '2-Minute', 'Short Yardage',
  ] },
];
const FB_DEFENSE: TagGroup[] = [
  { key: 'front', label: 'Front', tags: ['4-3', '3-4', '4-2-5', '3-3 Stack', 'Bear', 'Nickel', 'Dime'] },
  { key: 'coverage', label: 'Coverage', tags: [
    'Cover 0', 'Cover 1', 'Cover 2', 'Cover 3', 'Cover 4', 'Man', 'Zone', 'Quarters',
  ] },
  { key: 'pressure', label: 'Pressure', tags: [
    'Blitz', 'Zone Blitz', 'Corner Blitz', 'Safety Blitz', 'Stunt', 'Contain',
  ] },
  { key: 'situation', label: 'Situation', tags: ['Red Zone D', 'Goal Line D', '3rd & Long', 'Prevent'] },
];
const FB_SPECIAL: TagGroup[] = [
  { key: 'unit', label: 'Unit', tags: [
    'Kickoff', 'Kick Return', 'Punt', 'Punt Return', 'Field Goal', 'PAT', 'Onside',
  ] },
  { key: 'situation', label: 'Situation', tags: ['Fake', 'Block', 'Return TD'] },
];

const GROUPS: Record<Sport, Record<PlaySide, TagGroup[]>> = {
  basketball: { offense: BB_OFFENSE, defense: BB_DEFENSE, special_teams: [] },
  football: { offense: FB_OFFENSE, defense: FB_DEFENSE, special_teams: FB_SPECIAL },
};

// Suggested tag groups for a play's context.
export function playTagGroups(sport: Sport, side: PlaySide = 'offense'): TagGroup[] {
  return GROUPS[sport]?.[side] ?? GROUPS.basketball.offense;
}
export function allPlayTags(sport: Sport, side: PlaySide = 'offense'): string[] {
  return playTagGroups(sport, side).flatMap(g => g.tags);
}

// Back-compat: default (basketball offense) exports.
export const PLAY_TAG_GROUPS = BB_OFFENSE;
export const ALL_PLAY_TAGS: string[] = BB_OFFENSE.flatMap(g => g.tags);

// A stable colour per group so a tag chip reads its dimension at a glance.
export const TAG_GROUP_COLOR: Record<string, string> = {
  situation: '#e2574a', defense: '#4a90e2', family: '#3ec46d', action: '#f5c518',
  personnel: '#a78bfa', scheme: '#4a90e2', formation: '#3ec46d', run: '#f5c518',
  pass: '#e08a3c', front: '#4a90e2', coverage: '#5ec8d8', pressure: '#e2574a',
  unit: '#a78bfa', other: '#9db0bd',
};

// Every group across all sports/sides → tag→group lookup for colouring.
const ALL_GROUPS: TagGroup[] = [
  ...BB_OFFENSE, ...BB_DEFENSE, ...FB_OFFENSE, ...FB_DEFENSE, ...FB_SPECIAL,
];
const TAG_TO_GROUP: Record<string, string> = Object.fromEntries(
  ALL_GROUPS.flatMap(g => g.tags.map(t => [t, g.key])),
);

export function tagColor(tag: string): string {
  return TAG_GROUP_COLOR[TAG_TO_GROUP[tag] ?? 'other'];
}

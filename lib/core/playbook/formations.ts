// Starting formations for the editor — the coach's own unit per (sport, side),
// plus the optional SCOUT (opposing) unit they can drop on to diagram what they
// face. Coords normalised 0..1; the coach drags everything into place.
//
// Convention: your OWN unit lines up at/below the line of scrimmage (bottom of
// the surface); the scout opponent lines up above it. Scout tokens carry
// scout:true (rendered faded) and 's_'-prefixed ids so they never collide.

import type { PlayFormat, PlaySide, Token } from './playDoc';

type Sport = 'basketball' | 'football';

const T = (id: string, kind: Token['kind'], pos: { x: number; y: number }, label?: string, scout?: boolean): Token =>
  ({ id, kind, pos, ...(label ? { label } : {}), ...(scout ? { scout: true } : {}) });

// ── Basketball ────────────────────────────────────────────────────────
const BB_OFFENSE = (): Token[] => [
  T('p1', 'offense', { x: 0.50, y: 0.80 }, '1'),
  T('p2', 'offense', { x: 0.15, y: 0.55 }, '2'),
  T('p3', 'offense', { x: 0.85, y: 0.55 }, '3'),
  T('p4', 'offense', { x: 0.30, y: 0.30 }, '4'),
  T('p5', 'offense', { x: 0.70, y: 0.30 }, '5'),
  T('ball', 'ball', { x: 0.53, y: 0.79 }),
];
const BB_DEFENSE = (): Token[] => [
  T('d1', 'defense', { x: 0.35, y: 0.40 }, 'X1'),
  T('d2', 'defense', { x: 0.65, y: 0.40 }, 'X2'),
  T('d3', 'defense', { x: 0.18, y: 0.18 }, 'X3'),
  T('d4', 'defense', { x: 0.50, y: 0.14 }, 'X4'),
  T('d5', 'defense', { x: 0.82, y: 0.18 }, 'X5'),
];

// ── Football ──────────────────────────────────────────────────────────
const FB_OFFENSE = (): Token[] => [
  T('lt', 'offense', { x: 0.36, y: 0.60 }),
  T('lg', 'offense', { x: 0.43, y: 0.60 }),
  T('c',  'offense', { x: 0.50, y: 0.60 }),
  T('rg', 'offense', { x: 0.57, y: 0.60 }),
  T('rt', 'offense', { x: 0.64, y: 0.60 }),
  T('qb', 'offense', { x: 0.50, y: 0.72 }, 'QB'),
  T('rb', 'offense', { x: 0.42, y: 0.78 }, 'RB'),
  T('te', 'offense', { x: 0.30, y: 0.595 }, 'TE'),
  T('x',  'offense', { x: 0.10, y: 0.595 }, 'X'),
  T('y',  'offense', { x: 0.74, y: 0.585 }, 'Y'),
  T('z',  'offense', { x: 0.90, y: 0.595 }, 'Z'),
  T('ball', 'ball', { x: 0.50, y: 0.63 }),
];
// Base 4-3 (your defense lines up at the LOS, deepens toward the bottom).
const FB_DEFENSE = (): Token[] => [
  T('le', 'defense', { x: 0.38, y: 0.60 }, 'E'),
  T('dt', 'defense', { x: 0.46, y: 0.60 }, 'T'),
  T('nt', 'defense', { x: 0.54, y: 0.60 }, 'T'),
  T('re', 'defense', { x: 0.62, y: 0.60 }, 'E'),
  T('wl', 'defense', { x: 0.40, y: 0.69 }, 'L'),
  T('ml', 'defense', { x: 0.50, y: 0.69 }, 'L'),
  T('sl', 'defense', { x: 0.60, y: 0.69 }, 'L'),
  T('lc', 'defense', { x: 0.14, y: 0.78 }, 'C'),
  T('fs', 'defense', { x: 0.40, y: 0.80 }, 'S'),
  T('ss', 'defense', { x: 0.60, y: 0.80 }, 'S'),
  T('rc', 'defense', { x: 0.86, y: 0.78 }, 'C'),
];
// Punt unit.
const FB_SPECIAL = (): Token[] => [
  T('l1', 'offense', { x: 0.26, y: 0.60 }),
  T('l2', 'offense', { x: 0.34, y: 0.60 }),
  T('l3', 'offense', { x: 0.42, y: 0.60 }),
  T('ls', 'offense', { x: 0.50, y: 0.60 }, 'LS'),
  T('l4', 'offense', { x: 0.58, y: 0.60 }),
  T('l5', 'offense', { x: 0.66, y: 0.60 }),
  T('l6', 'offense', { x: 0.74, y: 0.60 }),
  T('g1', 'offense', { x: 0.10, y: 0.58 }, 'G'),
  T('g2', 'offense', { x: 0.90, y: 0.58 }, 'G'),
  T('pp', 'offense', { x: 0.50, y: 0.72 }, 'PP'),
  T('p',  'offense', { x: 0.50, y: 0.84 }, 'P'),
  T('ball', 'ball', { x: 0.50, y: 0.62 }),
];

// ── Scout (opposing) units — placed ABOVE the LOS, faded ───────────────
const BB_SCOUT_OFFENSE = (): Token[] => [
  T('s_o1', 'offense', { x: 0.50, y: 0.78 }, '1', true),
  T('s_o2', 'offense', { x: 0.12, y: 0.55 }, '2', true),
  T('s_o3', 'offense', { x: 0.88, y: 0.55 }, '3', true),
  T('s_o4', 'offense', { x: 0.30, y: 0.30 }, '4', true),
  T('s_o5', 'offense', { x: 0.70, y: 0.30 }, '5', true),
  T('s_ball', 'ball', { x: 0.53, y: 0.77 }, undefined, true),
];
const BB_SCOUT_DEFENSE = (): Token[] => [
  T('s_d1', 'defense', { x: 0.35, y: 0.42 }, undefined, true),
  T('s_d2', 'defense', { x: 0.65, y: 0.42 }, undefined, true),
  T('s_d3', 'defense', { x: 0.20, y: 0.20 }, undefined, true),
  T('s_d4', 'defense', { x: 0.50, y: 0.16 }, undefined, true),
  T('s_d5', 'defense', { x: 0.80, y: 0.20 }, undefined, true),
];
const FB_SCOUT_OFFENSE = (): Token[] => [
  T('s_lt', 'offense', { x: 0.36, y: 0.53 }, undefined, true),
  T('s_lg', 'offense', { x: 0.43, y: 0.53 }, undefined, true),
  T('s_c',  'offense', { x: 0.50, y: 0.53 }, undefined, true),
  T('s_rg', 'offense', { x: 0.57, y: 0.53 }, undefined, true),
  T('s_rt', 'offense', { x: 0.64, y: 0.53 }, undefined, true),
  T('s_qb', 'offense', { x: 0.50, y: 0.44 }, 'QB', true),
  T('s_rb', 'offense', { x: 0.50, y: 0.38 }, 'RB', true),
  T('s_te', 'offense', { x: 0.30, y: 0.535 }, 'TE', true),
  T('s_x',  'offense', { x: 0.10, y: 0.535 }, 'X', true),
  T('s_y',  'offense', { x: 0.74, y: 0.535 }, 'Y', true),
  T('s_z',  'offense', { x: 0.90, y: 0.535 }, 'Z', true),
];
const FB_SCOUT_DEFENSE = (): Token[] => [
  T('s_le', 'defense', { x: 0.38, y: 0.52 }, undefined, true),
  T('s_dt', 'defense', { x: 0.46, y: 0.52 }, undefined, true),
  T('s_nt', 'defense', { x: 0.54, y: 0.52 }, undefined, true),
  T('s_re', 'defense', { x: 0.62, y: 0.52 }, undefined, true),
  T('s_wl', 'defense', { x: 0.40, y: 0.44 }, undefined, true),
  T('s_ml', 'defense', { x: 0.50, y: 0.44 }, undefined, true),
  T('s_sl', 'defense', { x: 0.60, y: 0.44 }, undefined, true),
  T('s_lc', 'defense', { x: 0.14, y: 0.34 }, undefined, true),
  T('s_fs', 'defense', { x: 0.40, y: 0.32 }, undefined, true),
  T('s_ss', 'defense', { x: 0.60, y: 0.32 }, undefined, true),
  T('s_rc', 'defense', { x: 0.86, y: 0.34 }, undefined, true),
];

// ── Football 7-on-7 (pass-only, 7 a side, no line) ─────────────────────
const FB7_OFFENSE = (): Token[] => [
  T('c',  'offense', { x: 0.50, y: 0.60 }, 'C'),
  T('qb', 'offense', { x: 0.50, y: 0.72 }, 'QB'),
  T('h',  'offense', { x: 0.28, y: 0.585 }, 'H'),
  T('x',  'offense', { x: 0.10, y: 0.595 }, 'X'),
  T('y',  'offense', { x: 0.72, y: 0.585 }, 'Y'),
  T('z',  'offense', { x: 0.90, y: 0.595 }, 'Z'),
  T('rb', 'offense', { x: 0.42, y: 0.76 }, 'RB'),
  T('ball', 'ball', { x: 0.50, y: 0.63 }),
];
const FB7_DEFENSE = (): Token[] => [
  T('wl', 'defense', { x: 0.35, y: 0.66 }, 'L'),
  T('ml', 'defense', { x: 0.50, y: 0.66 }, 'L'),
  T('sl', 'defense', { x: 0.65, y: 0.66 }, 'L'),
  T('lc', 'defense', { x: 0.12, y: 0.77 }, 'C'),
  T('fs', 'defense', { x: 0.38, y: 0.79 }, 'S'),
  T('ss', 'defense', { x: 0.62, y: 0.79 }, 'S'),
  T('rc', 'defense', { x: 0.88, y: 0.77 }, 'C'),
];
const FB7_SCOUT_OFFENSE = (): Token[] => [
  T('s_c',  'offense', { x: 0.50, y: 0.53 }, undefined, true),
  T('s_qb', 'offense', { x: 0.50, y: 0.45 }, 'QB', true),
  T('s_h',  'offense', { x: 0.28, y: 0.535 }, 'H', true),
  T('s_x',  'offense', { x: 0.10, y: 0.535 }, 'X', true),
  T('s_y',  'offense', { x: 0.72, y: 0.535 }, 'Y', true),
  T('s_z',  'offense', { x: 0.90, y: 0.535 }, 'Z', true),
  T('s_rb', 'offense', { x: 0.42, y: 0.46 }, 'RB', true),
];
const FB7_SCOUT_DEFENSE = (): Token[] => [
  T('s_wl', 'defense', { x: 0.35, y: 0.50 }, undefined, true),
  T('s_ml', 'defense', { x: 0.50, y: 0.50 }, undefined, true),
  T('s_sl', 'defense', { x: 0.65, y: 0.50 }, undefined, true),
  T('s_lc', 'defense', { x: 0.12, y: 0.38 }, undefined, true),
  T('s_fs', 'defense', { x: 0.38, y: 0.36 }, undefined, true),
  T('s_ss', 'defense', { x: 0.62, y: 0.36 }, undefined, true),
  T('s_rc', 'defense', { x: 0.88, y: 0.38 }, undefined, true),
];

// The coach's own starting unit for a (sport, side, format).
export function startFormation(sport: Sport, side: PlaySide, format: PlayFormat = 'tackle'): Token[] {
  if (sport === 'football') {
    if (format === '7on7') return side === 'defense' ? FB7_DEFENSE() : FB7_OFFENSE();
    if (side === 'defense') return FB_DEFENSE();
    if (side === 'special_teams') return FB_SPECIAL();
    return FB_OFFENSE();
  }
  return side === 'defense' ? BB_DEFENSE() : BB_OFFENSE();
}

// The opposing (scout) unit for a play of this side — the other team.
// Offense play → scout defense; defense/ST play → scout offense.
export function scoutUnit(sport: Sport, side: PlaySide, format: PlayFormat = 'tackle'): Token[] {
  if (sport === 'football') {
    if (format === '7on7') return side === 'offense' ? FB7_SCOUT_DEFENSE() : FB7_SCOUT_OFFENSE();
    return side === 'offense' ? FB_SCOUT_DEFENSE() : FB_SCOUT_OFFENSE();
  }
  return side === 'offense' ? BB_SCOUT_DEFENSE() : BB_SCOUT_OFFENSE();
}

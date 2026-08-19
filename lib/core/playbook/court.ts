// Basketball court geometry, drawn as an SVG element string.
//
// Pure + engine-agnostic (returns a string of SVG elements, no react-native-svg
// components) so it runs identically in the Railway render worker and anywhere
// else. The projection here is the single source of truth for turning a play
// document's normalised 0..1 coords into pixels — the renderer imports it so
// tokens land on the painted floor.
//
// Layout: basket(s) at the baseline(s); ~10px per foot; 50ft-wide court.

import type { Surface, Vec } from './playDoc';

export const COURT_W = 500;                 // 50 ft
export const HALF_H = 470;                  // 47 ft (half of 94)
export const FULL_H = 940;                  // 94 ft

export type Theme = {
  floor: string; line: string;
  offense: string; offenseText: string;
  defense: string; ball: string; cone: string; ink: string;
};

export const DEFAULT_THEME: Theme = {
  floor: '#f4ead4', line: '#8a6d3b',
  offense: '#12305c', offenseText: '#ffffff',
  defense: '#c0392b', ball: '#e8722c', cone: '#e0a52e', ink: '#14202e',
};

export function surfaceSize(surface: Surface) {
  return { w: COURT_W, h: surface === 'full' ? FULL_H : HALF_H };
}

// Normalised (0..1) → pixels for the given surface.
export function project(v: Vec, surface: Surface) {
  const { w, h } = surfaceSize(surface);
  return { x: v.x * w, y: v.y * h };
}

// One basket's markings. `by` = baseline y (px); `dir` = +1 interior grows
// downward, -1 upward. Draws paint, FT circle, restricted rim, backboard/rim
// and the 3-point line (corners + arc).
function keyAt(by: number, dir: 1 | -1, t: Theme): string {
  const s = `stroke="${t.line}" fill="none" stroke-width="2"`;
  const hoopCy = by + dir * 53;
  const bbY = by + dir * 40;
  const paintTop = by;
  const paintBot = by + dir * 190;
  const ftCy = by + dir * 190;
  const cornerY = by + dir * 142.5;            // where 3pt verticals meet the arc
  const sweep = dir === 1 ? 1 : 0;             // bulge away from the baseline
  return `
    <line x1="210" y1="${bbY}" x2="290" y2="${bbY}" stroke="${t.line}" stroke-width="3"/>
    <circle cx="250" cy="${hoopCy}" r="9" ${s}/>
    <rect x="170" y="${Math.min(paintTop, paintBot)}" width="160" height="190" ${s}/>
    <circle cx="250" cy="${ftCy}" r="60" ${s}/>
    <line x1="30" y1="${by}" x2="30" y2="${cornerY}" ${s}/>
    <line x1="470" y1="${by}" x2="470" y2="${cornerY}" ${s}/>
    <path d="M30 ${cornerY} A 237.5 237.5 0 0 ${sweep} 470 ${cornerY}" ${s}/>`;
}

export function courtSvg(surface: Surface, t: Theme = DEFAULT_THEME): string {
  const { w, h } = surfaceSize(surface);
  const border = `stroke="${t.line}" fill="none" stroke-width="3"`;
  const bg = `<rect x="0" y="0" width="${w}" height="${h}" rx="6" fill="${t.floor}"/>`;
  const bounds = `<rect x="3" y="3" width="${w - 6}" height="${h - 6}" rx="4" ${border}/>`;

  if (surface === 'full') {
    const midY = h / 2;
    return `${bg}${bounds}
      <line x1="3" y1="${midY}" x2="${w - 3}" y2="${midY}" stroke="${t.line}" stroke-width="2"/>
      <circle cx="250" cy="${midY}" r="60" stroke="${t.line}" fill="none" stroke-width="2"/>
      ${keyAt(3, 1, t)}
      ${keyAt(h - 3, -1, t)}`;
  }
  // half court: basket at top, half-court line at the bottom with a center arc
  return `${bg}${bounds}
    ${keyAt(3, 1, t)}
    <line x1="3" y1="${h - 3}" x2="${w - 3}" y2="${h - 3}" stroke="${t.line}" stroke-width="2"/>
    <path d="M190 ${h - 3} A 60 60 0 0 1 310 ${h - 3}" stroke="${t.line}" fill="none" stroke-width="2"/>`;
}

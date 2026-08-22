// American football field geometry, drawn as an SVG element string.
//
// The football counterpart to court.ts — pure + engine-agnostic (returns a
// string of SVG elements, no react-native-svg) so it renders identically in the
// Railway worker and on device. Same projection contract as the court: a play
// document's normalised 0..1 coords map into this surface's box.
//
// Layout: a landscape slice of field, ~53yd wide × ~24yd deep, with the line of
// scrimmage across the lower third so there's room for routes above it. Offense
// attacks UP (toward y=0), matching the court's "attack toward y=0" convention:
//   x: 0 = left sideline, 1 = right sideline
//   y: 1 = offensive backfield (bottom), 0 = downfield (top)

import type { Vec } from './playDoc';

const PX_PER_YARD = 10;
export const FIELD_W = 534;                 // ~53.3 yd wide
export const FIELD_H = 300;                 // ~30 yd deep — room for a scout unit
                                            // above the LOS + routes developing.
// Line of scrimmage as a fraction of depth (lower third → room for routes and,
// when a scout opponent is added, their side above the line).
export const LOS_Y = 0.6;

export type FieldTheme = { turf: string; line: string; hash: string; los: string };
export const DEFAULT_FIELD_THEME: FieldTheme = {
  turf: '#2f6b3a',   // grass green
  line: '#e9f1ea',   // yard lines (near-white)
  hash: '#cddccf',   // hash ticks (fainter)
  los: '#f4c542',    // line of scrimmage — amber, stands out from the yard lines
};

// The field background + markings. Tokens/actions are drawn over this by the
// renderer using the play document's own colors (same as the court).
export function fieldSvg(_v?: unknown, t: FieldTheme = DEFAULT_FIELD_THEME): string {
  const w = FIELD_W, h = FIELD_H;
  const bg = `<rect x="0" y="0" width="${w}" height="${h}" rx="6" fill="${t.turf}"/>`;
  const border = `<rect x="3" y="3" width="${w - 6}" height="${h - 6}" rx="4" stroke="${t.line}" fill="none" stroke-width="2"/>`;

  // Yard lines every 5 yards (horizontal), faint so tokens/routes read over them.
  const lines: string[] = [];
  for (let y = 5 * PX_PER_YARD; y < h - 4; y += 5 * PX_PER_YARD) {
    lines.push(`<line x1="3" y1="${y}" x2="${w - 3}" y2="${y}" stroke="${t.line}" stroke-width="1" opacity="0.45"/>`);
  }

  // Hash marks — two columns of short ticks (HS hashes ~1/3 in from each
  // sideline), one per yard, so the field reads as a field at a glance.
  const hashX = [Math.round(w * 0.36), Math.round(w * 0.64)];
  const hashes: string[] = [];
  for (let y = PX_PER_YARD; y < h - 4; y += PX_PER_YARD) {
    for (const hx of hashX) {
      hashes.push(`<line x1="${hx - 3}" y1="${y}" x2="${hx + 3}" y2="${y}" stroke="${t.hash}" stroke-width="1" opacity="0.5"/>`);
    }
  }

  // Line of scrimmage — bold amber line the offense lines up on.
  const losY = Math.round(h * LOS_Y);
  const los = `<line x1="3" y1="${losY}" x2="${w - 3}" y2="${losY}" stroke="${t.los}" stroke-width="2.5"/>`;

  return `${bg}${lines.join('')}${hashes.join('')}${los}${border}`;
}

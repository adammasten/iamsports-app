// renderPlaySvg — the PURE FUNCTION at the heart of the architecture
// (PLAYBOOK_V2_CONVERGED.md §2.2/§2.3). Play document in → SVG string out.
// No DB, no auth, no react-native-svg, no side effects. The Railway render
// worker will call this and cache the result; a preview can drop the string
// straight into an <img src="data:image/svg+xml,...">.
//
// Notation follows how coaches actually draw:
//   move    solid line + arrowhead      (a cut)
//   dribble wavy line + arrowhead       (ball handler)
//   pass    dashed line + open arrow    (a pass)
//   screen  solid line + a cross-bar    (setting the screen)
//   shot    solid line + arrowhead      (attempt at the rim)
//   handoff solid line + short cross-bar (dribble hand-off)

import { courtSvg, DEFAULT_THEME, project, surfaceSize, type Theme } from './court';
import { fieldSvg } from './field';
import type { Action, PlayDoc, Surface, Vec } from './playDoc';

// The playing surface behind the play — a football field or a basketball court.
function surfaceSvg(s: Surface, t: Theme): string {
  return s === 'field' ? fieldSvg() : courtSvg(s, t);
}

const px = (v: Vec, s: Surface) => project(v, s);

// Turn a normalised polyline into an absolute pixel polyline.
function toPixels(path: Vec[], s: Surface) { return path.map(p => px(p, s)); }

// Wavy path for a dribble: perpendicular sine wiggle sampled along the line.
function wavyPath(pts: { x: number; y: number }[]): string {
  const amp = 4.5, wavelen = 16;
  const out: string[] = [];
  let phase = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;       // unit normal
    const steps = Math.max(2, Math.round(len / (wavelen / 2)));
    for (let sIdx = 0; sIdx <= steps; sIdx++) {
      const tt = sIdx / steps;
      const bx = a.x + dx * tt, by = a.y + dy * tt;
      const off = Math.sin(phase + tt * (len / wavelen) * Math.PI * 2) * amp;
      const x = bx + nx * off, y = by + ny * off;
      out.push(`${i === 0 && sIdx === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    phase += (len / wavelen) * Math.PI * 2;
  }
  return out.join(' ');
}

function polyPath(pts: { x: number; y: number }[]): string {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

// A short bar perpendicular to the final segment — the screen / handoff mark.
function endBar(pts: { x: number; y: number }[], half = 9): string {
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len * half, ny = dx / len * half;
  return `<line x1="${(b.x - nx).toFixed(1)}" y1="${(b.y - ny).toFixed(1)}" x2="${(b.x + nx).toFixed(1)}" y2="${(b.y + ny).toFixed(1)}" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`;
}

function renderAction(a: Action, s: Surface, t: Theme): string {
  const pts = toPixels(a.path, s);
  const color = a.type === 'pass' ? t.ink : a.type === 'dribble' ? t.ball : t.ink;
  const g = (inner: string, extra = '') =>
    `<g color="${color}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" ${extra}>${inner}</g>`;

  switch (a.type) {
    case 'pass':
      return g(`<path d="${polyPath(pts)}" stroke-dasharray="2 7" marker-end="url(#arrowOpen)"/>`);
    case 'dribble':
      return g(`<path d="${wavyPath(pts)}" marker-end="url(#arrow)"/>`);
    case 'screen':
      return g(`<path d="${polyPath(pts)}"/>${endBar(pts)}`);
    case 'handoff':
      return g(`<path d="${polyPath(pts)}"/>${endBar(pts, 6)}`);
    case 'shot':
      return g(`<path d="${polyPath(pts)}" stroke-dasharray="9 4" marker-end="url(#arrow)"/>`);
    case 'move':
    default:
      return g(`<path d="${polyPath(pts)}" marker-end="url(#arrow)"/>`);
  }
}

function renderToken(id: string, kind: string, label: string, p: { x: number; y: number }, t: Theme, scout = false): string {
  // Scout (opposing) tokens render faded so the coach's own unit reads as primary.
  if (scout) return `<g opacity="0.4">${renderToken(id, kind, label, p, t, false)}</g>`;
  const r = 15;
  const txt = (fill: string) =>
    `<text x="${p.x}" y="${p.y}" text-anchor="middle" dominant-baseline="central" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="${fill}">${label}</text>`;
  switch (kind) {
    case 'defense':
      // Defender = red X (with optional label above)
      return `<g stroke="${t.defense}" stroke-width="3" stroke-linecap="round">
        <line x1="${p.x - 10}" y1="${p.y - 10}" x2="${p.x + 10}" y2="${p.y + 10}"/>
        <line x1="${p.x + 10}" y1="${p.y - 10}" x2="${p.x - 10}" y2="${p.y + 10}"/></g>${label ? `<text x="${p.x}" y="${p.y - 16}" text-anchor="middle" font-family="Arial" font-size="12" font-weight="700" fill="${t.defense}">${label}</text>` : ''}`;
    case 'ball':
      return `<circle cx="${p.x}" cy="${p.y}" r="7" fill="${t.ball}" stroke="#7a3d12" stroke-width="1.5"/>`;
    case 'cone':
      return `<polygon points="${p.x},${p.y - 12} ${p.x + 11},${p.y + 9} ${p.x - 11},${p.y + 9}" fill="${t.cone}" stroke="#8a6410" stroke-width="1"/>`;
    case 'coach':
      return `<rect x="${p.x - r}" y="${p.y - r}" width="${2 * r}" height="${2 * r}" rx="4" fill="#555" stroke="#222" stroke-width="2"/>${txt('#fff')}`;
    case 'offense':
    default:
      return `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${t.offense}" stroke="#0a1c38" stroke-width="2"/>${txt(t.offenseText)}`;
  }
}

const MARKERS = `
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="currentColor"/>
    </marker>
    <marker id="arrowOpen" viewBox="0 0 12 12" refX="9" refY="6" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M1 1 L10 6 L1 11" fill="none" stroke="currentColor" stroke-width="2"/>
    </marker>
  </defs>`;

// Play document → standalone SVG string.
export function renderPlaySvg(doc: PlayDoc, theme: Theme = DEFAULT_THEME): string {
  const s = doc.surface;
  const { w, h } = surfaceSize(s);
  const court = surfaceSvg(s, theme);
  const actions = doc.actions.map(a => renderAction(a, s, theme)).join('');
  const tokens = doc.tokens.map(tk => renderToken(tk.id, tk.kind, tk.label ?? '', px(tk.pos, s), theme, tk.scout)).join('');
  const notes = (doc.annotations ?? []).map(an => {
    const p = px(an.pos, s);
    return `<text x="${p.x}" y="${p.y}" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-style="italic" fill="${theme.ink}">${an.text}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${MARKERS}${court}${actions}${tokens}${notes}</svg>`;
}

// ── Interactive playback ──────────────────────────────────────────────
// Same pure-function idea, one extra input: t (0..1) = progress through the
// play. The frame shows the routes as faint "ghosts" plus every token AT its
// position for that instant, so pressing play animates the five moving along
// their routes in sequence. Web renders this by re-drawing on a rAF loop.

// Point at fraction u (0..1) along a normalised polyline, by arc length.
function pointAlong(path: Vec[], u: number): Vec {
  if (u <= 0 || path.length === 1) return path[0];
  if (u >= 1) return path[path.length - 1];
  const segs: number[] = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) { const d = Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y); segs.push(d); total += d; }
  let target = u * total;
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i] || i === segs.length - 1) {
      const f = segs[i] ? target / segs[i] : 0;
      return { x: path[i].x + (path[i + 1].x - path[i].x) * f, y: path[i].y + (path[i + 1].y - path[i].y) * f };
    }
    target -= segs[i];
  }
  return path[path.length - 1];
}

// Which token(s) an action moves. A pass/shot moves the ball; a dribble moves
// the handler AND the ball; everything else moves the acting player.
function moversFor(a: Action): string[] {
  if (a.type === 'pass' || a.type === 'shot') return ['ball'];
  const m = a.fromToken ? [a.fromToken] : [];
  if (a.type === 'dribble') m.push('ball');
  return m;
}

// Where a token sits at progress t. Actions are grouped into BEATS (Action.step):
// actions sharing a step animate simultaneously; beats play in sequence. Unset
// step → each action is its own beat (so a play with no beats stays sequential,
// exactly as before). The latest beat a token has entered wins.
export function tokenPosAt(doc: PlayDoc, tokenId: string, t: number): Vec {
  const base = doc.tokens.find(x => x.id === tokenId);
  let pos: Vec = base ? base.pos : { x: 0.5, y: 0.5 };
  // Effective beat per action (fallback: its position → fully sequential).
  const beats = doc.actions.map((a, i) => a.step ?? i + 1);
  const distinct = Array.from(new Set(beats)).sort((a, b) => a - b);
  const total = distinct.length || 1;
  const slotOf = new Map(distinct.map((b, idx) => [b, idx]));
  doc.actions.forEach((a, i) => {
    if (!moversFor(a).includes(tokenId)) return;
    const slot = slotOf.get(beats[i]) ?? 0;
    const start = slot / total, end = (slot + 1) / total;
    if (t <= start) return;
    pos = pointAlong(a.path, Math.min(1, (t - start) / (end - start)));
  });
  return pos;
}

// A single animation frame at progress t (responsive svg — fills its box).
export function renderPlayFrameSvg(doc: PlayDoc, t: number, theme: Theme = DEFAULT_THEME): string {
  const s = doc.surface;
  const { w, h } = surfaceSize(s);
  const court = surfaceSvg(s, theme);
  const routes = `<g opacity="0.3">${doc.actions.map(a => renderAction(a, s, theme)).join('')}</g>`;
  const tokens = doc.tokens.map(tk => renderToken(tk.id, tk.kind, tk.label ?? '', px(tokenPosAt(doc, tk.id, t), s), theme, tk.scout)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="width:100%;height:100%;display:block">${MARKERS}${court}${routes}${tokens}</svg>`;
}

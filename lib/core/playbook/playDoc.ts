// Play document — the canonical JSON contract for a diagrammed play.
//
// This is the load-bearing interface from PLAYBOOK_V2_CONVERGED.md §2.3:
// the renderer is a PURE FUNCTION of this document, and NO engine-specific
// concept (SVG, Skia, react-native-svg) may leak into it. Get this right or
// the future Skia swap becomes a rewrite. RN-agnostic on purpose — the same
// document is rendered server-side (Railway worker) and, later, edited on
// device.
//
// Coordinates are NORMALISED 0..1 within the surface's bounding box:
//   x: 0 = left sideline, 1 = right sideline
//   y: 0 = baseline (the attacking basket end), 1 = half-court line
// Keeping coords normalised (not pixels) means one document renders at any
// size and the origin never depends on the renderer.

export type Vec = { x: number; y: number };

// Drawing surface. Basketball: `half` (default) / `full` (press-break /
// transition). Football: `field` (a slice of field with the line of scrimmage).
export type Surface = 'half' | 'full' | 'field';

export type TokenKind = 'offense' | 'defense' | 'ball' | 'coach' | 'cone';

export type Token = {
  id: string;
  kind: TokenKind;
  label?: string;   // "1".."5", "PG", "X1" — short; rendered inside the token
  pos: Vec;
};

// Movement / relationship between spots on the floor. `path` is the drawn line
// (>=2 normalised points); `type` picks the line style + terminator so the
// diagram reads in standard coaching notation.
export type ActionType =
  | 'move'     // player cut — solid line, arrowhead
  | 'dribble'  // wavy line, arrowhead
  | 'pass'     // dashed line, open arrowhead
  | 'screen'   // solid line ending in a perpendicular bar (the screen)
  | 'shot'     // solid line to the rim, chevron head
  | 'handoff'; // solid line with a small cross-bar (dribble hand-off)

export type Action = {
  id: string;
  type: ActionType;
  path: Vec[];        // polyline the action follows; first point is the origin
  fromToken?: string; // optional: token id the action starts from (labelling)
  toToken?: string;   // optional: token id the action targets (pass/screen)
  step?: number;      // BEAT: actions sharing a step animate simultaneously;
                      // steps play in order. Unset → each action is its own beat.
  order?: number;     // (legacy alias, unused)
};

export type Annotation = {
  id: string;
  text: string;
  pos: Vec;
};

export type PlayDoc = {
  schema_version: 1;
  sport: 'basketball' | 'football';
  surface: Surface;
  name?: string;
  note?: string;   // coach's teaching note, shown under the diagram
  tokens: Token[];
  actions: Action[];
  annotations?: Annotation[];
};

export const CURRENT_SCHEMA_VERSION = 1 as const;

// ── Validation ────────────────────────────────────────────────────────
// Fail loud, never silently (invariant 5). Returns [] when valid, else a
// list of human-readable problems. Cheap structural checks only — enough to
// keep a bad seed/import out of the render pipeline.
export function validatePlayDoc(doc: unknown): string[] {
  const errs: string[] = [];
  const d = doc as Partial<PlayDoc> | null;
  if (!d || typeof d !== 'object') return ['document is not an object'];

  if (d.schema_version !== CURRENT_SCHEMA_VERSION)
    errs.push(`schema_version must be ${CURRENT_SCHEMA_VERSION} (got ${String(d.schema_version)})`);
  if (d.sport !== 'basketball' && d.sport !== 'football') errs.push(`sport must be "basketball" or "football" (got ${String(d.sport)})`);
  if (d.surface !== 'half' && d.surface !== 'full' && d.surface !== 'field') errs.push(`surface must be "half", "full" or "field" (got ${String(d.surface)})`);
  // Sport ↔ surface must agree: football draws on a field, basketball on a court.
  if (d.sport === 'football' && d.surface !== 'field') errs.push(`football plays must use surface "field" (got ${String(d.surface)})`);
  if (d.sport === 'basketball' && d.surface === 'field') errs.push('basketball plays cannot use surface "field"');

  const inUnit = (v: Vec | undefined, where: string) => {
    if (!v || typeof v.x !== 'number' || typeof v.y !== 'number') { errs.push(`${where}: missing/invalid position`); return; }
    if (v.x < 0 || v.x > 1 || v.y < 0 || v.y > 1) errs.push(`${where}: coords must be 0..1 (got ${v.x},${v.y})`);
  };

  const ids = new Set<string>();
  if (!Array.isArray(d.tokens)) errs.push('tokens must be an array');
  else d.tokens.forEach((t, i) => {
    if (!t.id) errs.push(`tokens[${i}]: missing id`);
    else if (ids.has(t.id)) errs.push(`tokens[${i}]: duplicate id "${t.id}"`);
    else ids.add(t.id);
    inUnit(t.pos, `tokens[${i}]`);
  });

  if (!Array.isArray(d.actions)) errs.push('actions must be an array');
  else d.actions.forEach((a, i) => {
    if (!Array.isArray(a.path) || a.path.length < 2) errs.push(`actions[${i}]: path needs >=2 points`);
    else a.path.forEach((p, j) => inUnit(p, `actions[${i}].path[${j}]`));
    (['fromToken', 'toToken'] as const).forEach(k => {
      const ref = a[k];
      if (ref && !ids.has(ref)) errs.push(`actions[${i}].${k}: unknown token "${ref}"`);
    });
  });

  return errs;
}

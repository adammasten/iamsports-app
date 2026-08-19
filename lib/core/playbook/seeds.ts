// Reference plays — real basketball sets used to prove the document schema +
// renderer end-to-end (and to eyeball the notation). These double as concierge
// seed content later. Coords normalised 0..1: y=0 is the baseline (basket), y=1
// is half-court; x=0 left sideline, x=1 right sideline.

import type { PlayDoc } from './playDoc';

// Horns: 1 up top, bigs at both elbows, shooters in the corners. 5 sets the
// ball screen, 1 attacks off it, 4 dives to the rim.
export const HORNS: PlayDoc = {
  schema_version: 1,
  sport: 'basketball',
  surface: 'half',
  name: 'Horns — 5 ball screen, 4 dive',
  note: 'Primary look. If they switch the ball screen, 4 dives hard and we throw over the top. Keep the corners spaced — don’t let their man help on the roll.',
  tokens: [
    { id: 'p1', kind: 'offense', label: '1', pos: { x: 0.50, y: 0.80 } },
    { id: 'p4', kind: 'offense', label: '4', pos: { x: 0.36, y: 0.40 } },
    { id: 'p5', kind: 'offense', label: '5', pos: { x: 0.64, y: 0.40 } },
    { id: 'p2', kind: 'offense', label: '2', pos: { x: 0.08, y: 0.16 } },
    { id: 'p3', kind: 'offense', label: '3', pos: { x: 0.92, y: 0.16 } },
    { id: 'ball', kind: 'ball', pos: { x: 0.545, y: 0.79 } },
  ],
  actions: [
    { id: 'a1', type: 'screen', fromToken: 'p5', path: [{ x: 0.64, y: 0.40 }, { x: 0.57, y: 0.70 }] },
    { id: 'a2', type: 'dribble', fromToken: 'p1', path: [{ x: 0.50, y: 0.80 }, { x: 0.66, y: 0.60 }] },
    { id: 'a3', type: 'move', fromToken: 'p4', path: [{ x: 0.36, y: 0.40 }, { x: 0.42, y: 0.12 }] },
  ],
};

// 5-out give-and-go: everyone on the perimeter. 1 passes to 2, cuts hard to the
// rim, 2 hits the return pass for a layup.
export const GIVE_AND_GO: PlayDoc = {
  schema_version: 1,
  sport: 'basketball',
  surface: 'half',
  name: 'Give & go — pass, cut, layup',
  note: 'Teaching the basic read: pass, then cut HARD to the rim. If your defender turns their head to watch the ball, you’re already gone.',
  tokens: [
    { id: 'p1', kind: 'offense', label: '1', pos: { x: 0.50, y: 0.80 } },
    { id: 'p2', kind: 'offense', label: '2', pos: { x: 0.15, y: 0.55 } },
    { id: 'p3', kind: 'offense', label: '3', pos: { x: 0.85, y: 0.55 } },
    { id: 'p4', kind: 'offense', label: '4', pos: { x: 0.08, y: 0.18 } },
    { id: 'p5', kind: 'offense', label: '5', pos: { x: 0.92, y: 0.18 } },
    { id: 'ball', kind: 'ball', pos: { x: 0.545, y: 0.79 } },
  ],
  actions: [
    { id: 'a1', type: 'pass', fromToken: 'p1', toToken: 'p2', path: [{ x: 0.52, y: 0.78 }, { x: 0.18, y: 0.56 }] },
    { id: 'a2', type: 'move', fromToken: 'p1', path: [{ x: 0.50, y: 0.80 }, { x: 0.46, y: 0.14 }] },
    { id: 'a3', type: 'pass', fromToken: 'p2', toToken: 'p1', path: [{ x: 0.16, y: 0.53 }, { x: 0.44, y: 0.17 }] },
  ],
};

// Baseline out of bounds, "Box": 1 inbounds; box of 2/3/4/5. 5 cuts to the rim,
// 3 down-screens for 2 who curls to the corner for the catch.
export const BLOB_BOX: PlayDoc = {
  schema_version: 1,
  sport: 'basketball',
  surface: 'half',
  name: "BLOB 'Box' — 5 rim, 2 curl to corner",
  note: 'Late-game baseline out-of-bounds. First option is 5 at the front of the rim; if that’s covered, 2 curls off the down screen to the corner for the catch.',
  tokens: [
    { id: 'p1', kind: 'offense', label: '1', pos: { x: 0.50, y: 0.02 } },
    { id: 'p5', kind: 'offense', label: '5', pos: { x: 0.38, y: 0.18 } },
    { id: 'p4', kind: 'offense', label: '4', pos: { x: 0.62, y: 0.18 } },
    { id: 'p3', kind: 'offense', label: '3', pos: { x: 0.38, y: 0.36 } },
    { id: 'p2', kind: 'offense', label: '2', pos: { x: 0.62, y: 0.36 } },
    { id: 'ball', kind: 'ball', pos: { x: 0.50, y: 0.055 } },
  ],
  actions: [
    { id: 'a1', type: 'move', fromToken: 'p5', path: [{ x: 0.38, y: 0.18 }, { x: 0.50, y: 0.10 }] },
    { id: 'a2', type: 'screen', fromToken: 'p3', toToken: 'p2', path: [{ x: 0.38, y: 0.36 }, { x: 0.60, y: 0.33 }] },
    { id: 'a3', type: 'move', fromToken: 'p2', path: [{ x: 0.62, y: 0.36 }, { x: 0.90, y: 0.22 }] },
    { id: 'a4', type: 'pass', fromToken: 'p1', toToken: 'p2', path: [{ x: 0.50, y: 0.03 }, { x: 0.88, y: 0.21 }] },
  ],
};

export const SEED_PLAYS: PlayDoc[] = [HORNS, GIVE_AND_GO, BLOB_BOX];

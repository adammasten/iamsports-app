// ============================================================
// Upload form metadata — the single app-side source of truth for the plain-text
// event types, sports, season terms, and results the upload form writes. Adding a
// new sport or event type here needs ZERO migration (columns are text). RN-agnostic.
// ============================================================

export type EventTypeKey = 'game' | 'practice' | 'tournament' | 'scrimmage' | 'skills';

export const EVENT_TYPES: { value: EventTypeKey; label: string }[] = [
  { value: 'game', label: 'Game' },
  { value: 'practice', label: 'Practice' },
  { value: 'tournament', label: 'Tournament' },
  { value: 'scrimmage', label: 'Scrimmage' },
  { value: 'skills', label: 'Skills' },
];

// Sport is plain text; extend this list to add sports (no migration, no retrofit).
export const SPORTS: { value: string; label: string }[] = [
  { value: 'Basketball', label: 'Basketball' },
  { value: 'Other', label: 'Other' },
];

export const SEASON_TERMS = ['Fall', 'Winter', 'Spring', 'Summer'] as const;

// W/L/T is DERIVED from the two integer scores — never stored. Returns null
// unless BOTH scores are entered, and never derives a result from 0-0.
export function deriveResult(team: number | null, opp: number | null): 'W' | 'L' | 'T' | null {
  if (team == null || Number.isNaN(team) || opp == null || Number.isNaN(opp)) return null;
  if (team === 0 && opp === 0) return null;
  if (team > opp) return 'W';
  if (team < opp) return 'L';
  return 'T';
}

// Sentinel used by the tournament dropdown to reveal the "new tournament" input.
export const NEW_TOURNAMENT = '__new__';

// Local YYYY-MM-DD (never toISOString — that shifts the date via UTC for users
// west of UTC). Used for event_date / game_date.
export function dateToYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// A sensible editable default title, e.g. "Jul 9, 2026".
export function defaultUploadTitle(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// The ONE place videos get named — shared by the multi-select batch (upload.tsx)
// and the add-to-game flow (game.tsx). A blank base falls back to today's date;
// `withIndex` appends the 1-based position (sortOrder + 1) to keep a game's
// videos distinct (e.g. game has 3 videos → next is "Jul 9, 2026 4").
export function makeVideoLabel(base: string, sortOrder: number, withIndex: boolean): string {
  const b = base.trim() || defaultUploadTitle(new Date());
  return withIndex ? `${b} ${sortOrder + 1}` : b;
}

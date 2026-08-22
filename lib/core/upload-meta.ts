// ============================================================
// Upload form metadata — the single app-side source of truth for the plain-text
// event types, sports, season terms, and results the upload form writes. Adding a
// new sport or event type here needs ZERO migration (columns are text). RN-agnostic.
// ============================================================

export type EventTypeKey = 'game' | 'practice' | 'scout' | 'scrimmage' | 'skills';

export const EVENT_TYPES: { value: EventTypeKey; label: string }[] = [
  { value: 'game', label: 'Game' },
  { value: 'practice', label: 'Practice' },
  { value: 'scout', label: 'Scout' },
  { value: 'scrimmage', label: 'Scrimmage' },
  { value: 'skills', label: 'Skills' },
];

// Sport is plain text; extend this list to add sports (no migration, no retrofit).
// The value is what's written to teams.sport / videos.sport and matched on when
// filtering by sport — keep values stable once content exists under them.
export const SPORTS: { value: string; label: string }[] = [
  { value: 'Basketball', label: 'Basketball' },
  { value: 'Football', label: 'Football' },
  { value: '7-on-7', label: '7-on-7' },
  { value: 'Flag Football', label: 'Flag Football' },
  { value: 'Soccer', label: 'Soccer' },
  { value: 'Baseball', label: 'Baseball' },
  { value: 'Softball', label: 'Softball' },
  { value: 'Volleyball', label: 'Volleyball' },
  { value: 'Lacrosse', label: 'Lacrosse' },
  { value: 'Other', label: 'Other' },
];

// The football family — Football, 7-on-7, and Flag all diagram on a field and tag
// with the ODK breakdown, so they route through the same football code paths.
// Compared case-insensitively (teams.sport is 'Football', a play doc's is 'football').
export const FOOTBALL_SPORTS = ['Football', '7-on-7', 'Flag Football'];
export function isFootballSport(sport: string | null | undefined): boolean {
  return !!sport && FOOTBALL_SPORTS.some(s => s.toLowerCase() === sport.toLowerCase());
}

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

// Title for a games (event) row. With an opponent it reads "vs Duke" / "at Duke".
// With NO opponent it falls back to the event type + short date — "Game · Jul 28",
// "Practice · Jul 28" — so team uploads without an opponent aren't all titled the
// same "Game". Shared by upload.tsx (create) and edit-game.tsx (save) so the
// format stays identical. A games row is an EVENT container; event_type lives on
// its videos, so this fallback reflects whatever kind of event it is.
export function gameTitle(opponent: string, vsAt: 'vs' | 'at', eventType: EventTypeKey, date: Date): string {
  const opp = opponent.trim();
  if (opp) return `${vsAt} ${opp}`;
  const label = EVENT_TYPES.find(e => e.value === eventType)?.label ?? 'Event';
  return `${label} · ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

// ONE category definition per sport — the single source of truth for which
// tag categories a sport's board has. Read by My Tags, make-highlight, and
// (Phase 1) the taggers. No consumer should keep its own category list.
// Full rules: docs/SPORT_TAG_CONTRACT.md.
//
// ⚠️  KEYS ARE STABLE FOREVER — never rename a `key`. Existing clip_tags rows
//     store it in tags.category; renaming strands tagged clips. Labels/colors
//     can change; keys cannot.
//
// This file is a faithful transcription of today's tagger columns
// (app/tagging-overlay.tsx: CATEGORIES, FB_CATEGORIES, FLAG_PHASE_COLS) — not a
// redesign. Colors/backgrounds are copied verbatim from those constants.
//
// Players are NOT in this file — they come from the roster and each reader
// appends the Players column itself, exactly where it does today.
// Possession / period / ★special are stamps, not board categories, so they are
// deliberately absent here too.

export type TagCategory = { key: string; label: string; color: string; bg: string };
// A phase = the football-family OFF/DEF/SP selector. `possessionTag` links a
// phase to its possession tag name (category='possession') for the taggers.
export type SportPhase = { code: string; label: string; possessionTag: string };

type SportDef =
  | { phases: null; categories: TagCategory[] }
  | { phases: SportPhase[]; categoriesByPhase: Record<string, TagCategory[]> };

// Shared column palette (verbatim from the native tagger constants).
const BLUE = (key: string, label: string): TagCategory => ({ key, label, color: '#1a6fd4', bg: '#e8f0fe' });
const RED = (key: string, label: string): TagCategory => ({ key, label, color: '#c0392b', bg: '#fde8e8' });
const GREEN = (key: string, label: string): TagCategory => ({ key, label, color: '#1e8449', bg: '#e8f8ed' });
const PURPLE = (key: string, label: string): TagCategory => ({ key, label, color: '#6c5ce7', bg: '#eeecfb' });

// Flat trio shared by every non-football sport (basketball is the canonical one).
const FLAT_OFF_DEF_PLAYS: TagCategory[] = [
  BLUE('offense', 'Offense'),
  RED('defense', 'Defense'),
  GREEN('plays', 'Plays'),
];

// Keyed by LOWERCASE sport string (DB sport values are inconsistently cased —
// "Basketball" vs "basketball"), resolved via the functions below, mirroring
// periodsForSport().
export const SPORT_TAGS: Record<string, SportDef> = {
  basketball: { phases: null, categories: FLAT_OFF_DEF_PLAYS },
  baseball: { phases: null, categories: FLAT_OFF_DEF_PLAYS },
  soccer: { phases: null, categories: FLAT_OFF_DEF_PLAYS },
  softball: { phases: null, categories: FLAT_OFF_DEF_PLAYS },
  lacrosse: { phases: null, categories: FLAT_OFF_DEF_PLAYS },
  volleyball: { phases: null, categories: FLAT_OFF_DEF_PLAYS },

  // Football & 7-on-7 currently render the flat FB board (no phase swap) — kept
  // as-is here for a faithful transcription. Phase 2 moves them onto OFF/DEF/SP
  // like flag (additive data migration first).
  football: {
    phases: null,
    categories: [BLUE('formation', 'Formation'), GREEN('play', 'Play'), RED('defense', 'Defense'), PURPLE('result', 'Result')],
  },
  '7-on-7': {
    phases: null,
    categories: [BLUE('formation', 'Formation'), GREEN('play', 'Play'), RED('defense', 'Defense'), PURPLE('result', 'Result')],
  },

  // Flag football — OFF/DEF/SP each swap in their own phase-scoped columns.
  'flag football': {
    phases: [
      { code: 'OFF', label: 'Offense', possessionTag: 'Offense' },
      { code: 'DEF', label: 'Defense', possessionTag: 'Defense' },
      { code: 'SP', label: 'Special Teams', possessionTag: 'Special Teams' },
    ],
    categoriesByPhase: {
      OFF: [BLUE('off_formation', 'Formation'), GREEN('off_play', 'Play'), PURPLE('off_result', 'Result')],
      DEF: [RED('def_scheme', 'Scheme'), BLUE('def_opp_play', 'Their Play'), GREEN('def_our_play', 'Our Play'), PURPLE('def_result', 'Result')],
      SP: [GREEN('st_play', 'Play'), PURPLE('st_result', 'Result')],
    },
  },
};

const DEFAULT_SPORT = 'basketball';
function resolve(sport?: string | null): SportDef {
  return SPORT_TAGS[(sport ?? DEFAULT_SPORT).trim().toLowerCase()] ?? SPORT_TAGS[DEFAULT_SPORT];
}

// The phase selector for a sport, or null for a flat (phase-less) sport.
export function phasesForSport(sport?: string | null): SportPhase[] | null {
  const d = resolve(sport);
  return d.phases ?? null;
}

// The categories for a sport. For a phased sport, pass a phase code to get just
// that phase's columns; omit it to get every phase's columns in order (deduped).
export function categoriesForSport(sport?: string | null, phaseCode?: string | null): TagCategory[] {
  const d = resolve(sport);
  if (d.phases) {
    if (phaseCode) return d.categoriesByPhase[phaseCode] ?? [];
    const seen = new Set<string>();
    const out: TagCategory[] = [];
    for (const p of d.phases) for (const c of d.categoriesByPhase[p.code] ?? []) if (!seen.has(c.key)) { seen.add(c.key); out.push(c); }
    return out;
  }
  return d.categories;
}

// Flat lookup of every category descriptor across all sports (by key).
const ALL_CATEGORIES: Record<string, TagCategory> = (() => {
  const m: Record<string, TagCategory> = {};
  for (const d of Object.values(SPORT_TAGS)) {
    const cats = d.phases ? Object.values(d.categoriesByPhase).flat() : d.categories;
    for (const c of cats) if (!m[c.key]) m[c.key] = c;
  }
  return m;
})();

// Descriptor for any category key — a known board category, or a neutral
// fallback (used to render legacy/mis-filed categories without hiding them).
export function categoryDescriptor(key: string): TagCategory {
  return ALL_CATEGORIES[key] ?? { key, label: key, color: '#666', bg: '#eeeeee' };
}

// The set of board/action category keys across every sport (excludes players and
// the stamp categories possession/period/special).
export const BOARD_CATEGORY_KEYS: ReadonlySet<string> = new Set(Object.keys(ALL_CATEGORIES));

// Is this an "action" (board) category — i.e. not a player, not a stamp? Used by
// make-highlight to classify a bundle's action tags across every sport.
export function isActionCategory(category: string | null | undefined): boolean {
  return !!category && BOARD_CATEGORY_KEYS.has(category);
}

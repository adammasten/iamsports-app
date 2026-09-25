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
  | {
      phases: SportPhase[];
      categoriesByPhase: Record<string, TagCategory[]>;
      /**
       * Phases a given FORMAT offers, when it is fewer than all of them. A format
       * that isn't listed (or a null format) gets every phase — formats always fail
       * open to the full board.
       */
      phasesByFormat?: Record<string, string[]>;
      /**
       * Opt in to placing the roster-derived Players column immediately BEFORE a
       * trailing player-action column instead of last. Football's launch taxonomy
       * requires Player to precede Player Action. Only sports that set this are
       * affected — every other board keeps Players last, exactly as today.
       */
      playersBeforeAction?: boolean;
    };

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

  // 7-on-7 is its OWN SPORT (not Football + a format, and not flag). It is pass-only:
  // no run game and no kicking game, so there is no Special Teams phase.
  //
  // Its 66 seeded rows were recategorised in place — ids preserved — by migration
  // 20260924_seven_on_seven_taxonomy_repair, which also retired the 16 special_teams
  // rows that had been seeded here by mistake.
  //
  // DEF deliberately renders only Scheme + Our Play. `def_opp_play` and `def_result`
  // are part of the intended taxonomy but have NO vocabulary yet, and an empty column
  // is worse than an absent one — they appear when their tags are deliberately added.
  '7-on-7': {
    phases: [
      { code: 'OFF', label: 'Offense', possessionTag: 'Offense' },
      { code: 'DEF', label: 'Defense', possessionTag: 'Defense' },
    ],
    categoriesByPhase: {
      OFF: [
        BLUE('off_formation', 'Formation'),
        RED('off_opp_look', 'Their Look'),   // the defensive look we are FACING
        GREEN('off_play', 'Play'),
        PURPLE('off_result', 'Result'),
      ],
      DEF: [
        RED('def_scheme', 'Scheme'),         // what WE play — distinct from Their Look
        GREEN('def_our_play', 'Our Play'),
      ],
    },
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
    // Most 5v5 flag leagues have no kicking game, so 5v5 is not offered the Special
    // Teams phase for NEW tagging. The SP tags themselves are untouched and remain
    // fully exportable wherever a historical clip used one (see export's used-category
    // union) -- format controls what is OFFERED, never what history means.
    phasesByFormat: { '5v5': ['OFF', 'DEF'] },
  },

  // 11v11 Football — the launch taxonomy. Phased OFF/DEF/SP.
  //
  // DECLARED LAST DELIBERATELY. ALL_CATEGORIES resolves a shared category key's
  // descriptor by FIRST declaration, and Football relabels several shared keys
  // ("Our Formation", "Our Play", "Our Result", and def_our_play as "Our Player
  // Action"). Declaring it earlier would override flag's and 7-on-7's labels in
  // Export's historical picker and My Tags' extras. Board headers are unaffected by
  // this ordering — the taggers read the per-sport list directly.
  //
  // OFF and DEF are SIX columns once Players is inserted, which the committed native
  // horizontal-scroll path handles. `playersBeforeAction` puts Players immediately
  // before the trailing Player Action column, as the launch order requires.
  football: {
    phases: [
      { code: 'OFF', label: 'Offense', possessionTag: 'Offense' },
      { code: 'DEF', label: 'Defense', possessionTag: 'Defense' },
      { code: 'SP', label: 'Special Teams', possessionTag: 'Special Teams' },
    ],
    playersBeforeAction: true,
    categoriesByPhase: {
      OFF: [
        BLUE('off_formation', 'Our Formation'),
        RED('off_opp_look', 'Their Look'),
        GREEN('off_play', 'Our Play'),
        PURPLE('off_result', 'Our Result'),
        GREEN('off_player_action', 'Our Player Action'),
      ],
      DEF: [
        BLUE('def_opp_formation', 'Their Formation'),
        RED('def_scheme', 'Our Scheme'),
        BLUE('def_opp_play', 'Their Play'),
        PURPLE('def_result', 'Their Result'),
        GREEN('def_our_play', 'Our Player Action'),   // key preserved, label only
      ],
      SP: [
        GREEN('st_play', 'Play'),
        PURPLE('st_result', 'Result'),
        GREEN('st_player_action', 'Our Player Action'),
      ],
    },
  },
};

// THE PHASED-BOARD FALLBACK COLUMNS — frozen literal, do not derive.
//
// A phased sport (football family) renders the active OFF/DEF/SP phase's columns; when
// NO phase is selected yet (the state every board opens in) or that phase has no tags,
// both taggers fall back to these four columns so the board is never blank. Until
// Football became phased that fallback was `categoriesForSport('football')` — the flat
// football entry. Deriving it is no longer possible (Football has phases, and the union
// of its phases is 13 columns), so the exact four columns the fallback has always
// rendered are frozen here. Changing this changes what every flag / 7-on-7 / Football
// board shows on open.
export const FALLBACK_FLAT_COLUMNS: TagCategory[] = [
  BLUE('formation', 'Formation'),
  GREEN('play', 'Play'),
  RED('defense', 'Defense'),
  PURPLE('result', 'Result'),
];

const DEFAULT_SPORT = 'basketball';
function resolve(sport?: string | null): SportDef {
  return SPORT_TAGS[(sport ?? DEFAULT_SPORT).trim().toLowerCase()] ?? SPORT_TAGS[DEFAULT_SPORT];
}

// The phase selector for a sport, or null for a flat (phase-less) sport. When a
// format is supplied AND that format restricts the phase list, the list is narrowed;
// any other format — and a null/unknown one — gets every phase (fails open).
export function phasesForSport(sport?: string | null, format?: string | null): SportPhase[] | null {
  const d = resolve(sport);
  if (!d.phases) return null;
  const allowed = format ? d.phasesByFormat?.[format] : undefined;
  return allowed ? d.phases.filter(p => allowed.includes(p.code)) : d.phases;
}

// The categories for a sport. For a phased sport, pass a phase code to get just
// that phase's columns; omit it to get every phase's columns in order (deduped).
export function categoriesForSport(sport?: string | null, phaseCode?: string | null, format?: string | null): TagCategory[] {
  const d = resolve(sport);
  if (d.phases) {
    if (phaseCode) return d.categoriesByPhase[phaseCode] ?? [];
    const seen = new Set<string>();
    const out: TagCategory[] = [];
    // Union only the phases this format actually offers (all of them when unrestricted).
    for (const p of phasesForSport(sport, format) ?? d.phases) {
      for (const c of d.categoriesByPhase[p.code] ?? []) if (!seen.has(c.key)) { seen.add(c.key); out.push(c); }
    }
    return out;
  }
  return d.categories;
}

// Category keys that represent WHAT A SPECIFIC PLAYER DID (as opposed to a fact about
// the play). Used only to decide Players-column placement — not by any matching logic.
const PLAYER_ACTION_KEYS: ReadonlySet<string> = new Set([
  'off_player_action', 'def_our_play', 'st_player_action',
]);

/**
 * Should the roster-derived Players column be inserted immediately BEFORE the final
 * category instead of appended last?
 *
 * True only when the sport opts in (`playersBeforeAction`) AND its last column really
 * is a player-action category. Both conditions must hold, so no existing board can be
 * reordered by accident: flag's def_our_play is third in its DEF phase, and 7-on-7
 * does not opt in at all. Placement only — nothing about selection or bundles.
 */
export function playersBeforeFinalColumn(
  sport?: string | null,
  cats?: { key: string }[],
): boolean {
  const d = resolve(sport);
  if (!('playersBeforeAction' in d) || !d.playersBeforeAction) return false;
  const last = cats?.[cats.length - 1];
  return !!last && PLAYER_ACTION_KEYS.has(last.key);
}

// Flat lookup of every category descriptor across all sports (by key).
// The fallback columns are folded in LAST so that the legacy flat keys stay known
// (they are no longer in any sport definition now that Football is phased) without ever
// overriding a sport's own descriptor for a key it shares.
const ALL_CATEGORIES: Record<string, TagCategory> = (() => {
  const m: Record<string, TagCategory> = {};
  for (const d of Object.values(SPORT_TAGS)) {
    const cats = d.phases ? Object.values(d.categoriesByPhase).flat() : d.categories;
    for (const c of cats) if (!m[c.key]) m[c.key] = c;
  }
  for (const c of FALLBACK_FLAT_COLUMNS) if (!m[c.key]) m[c.key] = c;
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

// Phase code for a category key, when the key belongs to a phased sport's board.
// Lets a consumer rebuild a PickerCategory for a category it met in DATA rather
// than in a sport definition (see pickerCategoryForKey).
const PHASE_BY_CATEGORY: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const d of Object.values(SPORT_TAGS)) {
    if (!d.phases) continue;
    for (const p of d.phases) for (const c of d.categoriesByPhase[p.code] ?? []) if (!m[c.key]) m[c.key] = p.code;
  }
  return m;
})();

// Resolve a category key met in DATA (e.g. a historical tag whose category is no
// longer offered by the team's current format) into a properly-labelled picker
// category. Returns `known: false` when the key is in no sport definition at all —
// the caller must still RENDER it (never hide a used historical tag) but should
// report it rather than silently inventing presentation.
export function pickerCategoryForKey(key: string): PickerCategory & { known: boolean } {
  const known = !!ALL_CATEGORIES[key];
  const base = categoryDescriptor(key);
  const phase = PHASE_BY_CATEGORY[key];
  return { ...base, ...(phase ? { phase } : {}), known };
}

// A category as surfaced in a CROSS-SPORT picker (Export, and FilterBar in 0b
// item 2): the category descriptor plus, for a phased sport, its phase code
// (OFF/DEF/SP) so the picker can label "OFF · Result" vs "DEF · Result".
export type PickerCategory = TagCategory & { phase?: string };

// Union of a set of sports' categories, deduped by key (first sport wins order).
// A phased sport tags each category with its phase code. Empty input → the
// default (basketball) flat categories, matching a sport-less picker's behavior.
export function categoriesForSports(sports: Iterable<string | null | undefined>): PickerCategory[] {
  const list = [...sports];
  const use = list.length ? list : [DEFAULT_SPORT];
  const seen = new Set<string>();
  const out: PickerCategory[] = [];
  for (const s of use) {
    const ph = phasesForSport(s);
    if (ph) {
      for (const p of ph) for (const c of categoriesForSport(s, p.code)) if (!seen.has(c.key)) { seen.add(c.key); out.push({ ...c, phase: p.code }); }
    } else {
      for (const c of categoriesForSport(s)) if (!seen.has(c.key)) { seen.add(c.key); out.push({ ...c }); }
    }
  }
  return out;
}

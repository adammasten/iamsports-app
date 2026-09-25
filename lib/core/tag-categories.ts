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
       * Where the roster-derived Players column goes: immediately BEFORE the first
       * column whose key is listed here. A sport that lists nothing (and every flat
       * sport) gets Players appended LAST, exactly as before.
       *
       * The football family lists its player-action keys, which are always the
       * trailing column, so "before the first listed key" is the same position they
       * have always rendered. Basketball lists `offense` / `defense`, which sit in the
       * MIDDLE of its board, which is why this is a key list and not a boolean.
       */
      playersBefore?: readonly string[];
      /**
       * Which phase's COLUMNS to display when the coach has not picked a phase yet.
       * DISPLAY ONLY: it never selects a possession, never stamps one on a clip, and
       * never backfills history. Without it a phased board with no phase selected
       * falls back to FALLBACK_FLAT_COLUMNS, which is still every other sport's
       * behavior — basketball is the only sport that sets this.
       */
      defaultVisiblePhase?: string;
    };

// Shared column palette (verbatim from the native tagger constants).
const BLUE = (key: string, label: string): TagCategory => ({ key, label, color: '#1a6fd4', bg: '#e8f0fe' });
const RED = (key: string, label: string): TagCategory => ({ key, label, color: '#c0392b', bg: '#fde8e8' });
const GREEN = (key: string, label: string): TagCategory => ({ key, label, color: '#1e8449', bg: '#e8f8ed' });
const PURPLE = (key: string, label: string): TagCategory => ({ key, label, color: '#6c5ce7', bg: '#eeecfb' });

// The football family's player-action keys — the column Players must precede on those
// sports' boards. Used only for Players placement, never by any matching logic.
const PLAYER_ACTION_KEYS: readonly string[] = [
  'off_player_action', 'def_our_play', 'st_player_action',
];

// Flat trio shared by the non-basketball flat sports.
const FLAT_OFF_DEF_PLAYS: TagCategory[] = [
  BLUE('offense', 'Offense'),
  RED('defense', 'Defense'),
  GREEN('plays', 'Plays'),
];

// Keyed by LOWERCASE sport string (DB sport values are inconsistently cased —
// "Basketball" vs "basketball"), resolved via the functions below, mirroring
// periodsForSport().
export const SPORT_TAGS: Record<string, SportDef> = {
  // 11v11 Football — the launch taxonomy. Phased OFF/DEF/SP.
  //
  // DECLARED FIRST DELIBERATELY — Football is the NAMING AUTHORITY for the shared
  // master labels (Adam, 2026-09-25). ALL_CATEGORIES resolves a shared category key's
  // descriptor by FIRST declaration, and that descriptor is used ONLY where no sport
  // supplies one: the heading Export puts on a historical/orphaned category, and My
  // Tags' extras sections. Every sport's own board reads its own per-sport list, so
  // this ordering changes no board, no color and no tag. Football owns the wording so
  // a new sport inherits it by design instead of by typing order.
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
    playersBefore: PLAYER_ACTION_KEYS,
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

  baseball: { phases: null, categories: FLAT_OFF_DEF_PLAYS },
  softball: { phases: null, categories: FLAT_OFF_DEF_PLAYS },
  volleyball: { phases: null, categories: FLAT_OFF_DEF_PLAYS },

  // The board for content with NO sport (teamless personal footage) and for any sport
  // string we do not recognise — see DEFAULT_SPORT. Byte-identical to what an unknown
  // sport rendered before basketball became phased; it must stay flat for that reason.
  _default: { phases: null, categories: FLAT_OFF_DEF_PLAYS },

  // SOCCER — the launch board (Adam, 2026-09-25, Slice I). Phased OFF/DEF, no SP.
  //
  // Greenfield when this shipped (0 teams / videos / clips / tag uses), so it uses the
  // football-family keys rather than the generic offense/defense/plays it was seeded into,
  // and all 51 legacy rows were recategorised or retired by migration
  // 20260925_soccer_launch_taxonomy. Football owns every one of these keys' shared master
  // labels, so soccer's own wording ("Shape", "Pattern") is board-only.
  //
  // Both phases are SIX columns once Players is inserted, which the committed native
  // horizontal strip handles. Players placement needs nothing new: soccer's trailing action
  // keys are off_player_action / def_our_play, already members of PLAYER_ACTION_KEYS.
  // `defaultVisiblePhase` shows the OFF columns before a phase is picked — DISPLAY ONLY.
  soccer: {
    phases: [
      { code: 'OFF', label: 'Offense', possessionTag: 'Offense' },
      { code: 'DEF', label: 'Defense', possessionTag: 'Defense' },
    ],
    playersBefore: PLAYER_ACTION_KEYS,
    defaultVisiblePhase: 'OFF',
    categoriesByPhase: {
      OFF: [
        BLUE('off_formation', 'Our Shape / Situation'),
        GREEN('off_play', 'Our Play / Pattern'),
        PURPLE('off_result', 'Our Result'),
        GREEN('off_player_action', 'Our Player Action'),
        RED('off_opp_look', 'Their Shape'),
      ],
      DEF: [
        BLUE('def_opp_formation', 'Their Shape'),
        RED('def_scheme', 'Our Defensive Shape'),
        BLUE('def_opp_play', 'Their Play / Pattern'),
        PURPLE('def_result', 'Their Result'),
        GREEN('def_our_play', 'Our Player Action'),
      ],
    },
  },

  // LACROSSE — the launch board (Adam, 2026-09-25, Slice J). Phased OFF/DEF, no SP.
  //
  // Greenfield when this shipped (0 teams / videos / clips / tag uses), so it uses the
  // football-family keys rather than the generic offense/defense/plays it was seeded into;
  // migration 20260925_lacrosse_launch_taxonomy recategorised 38 rows and retired 5.
  // Football owns every one of these keys' shared master labels, so lacrosse's wording
  // ("Our Set", "Their Defense", "Our Scheme") is board-only.
  //
  // Both phases are SIX columns once Players is inserted, which the committed native
  // horizontal strip handles. The player-action column is the TRAILING one on both phases,
  // so `playersBefore: PLAYER_ACTION_KEYS` places Players 5th exactly as it does for the
  // football family. `defaultVisiblePhase` shows the OFF columns before a phase is picked —
  // DISPLAY ONLY, like Basketball and Soccer.
  lacrosse: {
    phases: [
      { code: 'OFF', label: 'Offense', possessionTag: 'Offense' },
      { code: 'DEF', label: 'Defense', possessionTag: 'Defense' },
    ],
    playersBefore: PLAYER_ACTION_KEYS,
    defaultVisiblePhase: 'OFF',
    categoriesByPhase: {
      OFF: [
        BLUE('off_formation', 'Our Set'),
        RED('off_opp_look', 'Their Defense'),
        GREEN('off_play', 'Our Play'),
        PURPLE('off_result', 'Our Result'),
        GREEN('off_player_action', 'Our Player Action'),
      ],
      DEF: [
        BLUE('def_opp_formation', 'Their Set'),
        RED('def_scheme', 'Our Scheme'),
        BLUE('def_opp_play', 'Their Play'),
        PURPLE('def_result', 'Their Result'),
        GREEN('def_our_play', 'Our Player Action'),
      ],
    },
  },

  // BASKETBALL — the launch board (Adam, 2026-09-25, Slice H). Phased OFF/DEF, no SP.
  //
  // DECLARED AFTER THE FLAT SPORTS ON PURPOSE. It reuses the generic keys `offense`,
  // `defense` and `plays` (which is what keeps 884 historical uses in place and gives
  // Export zero orphaned sections), but it relabels them. Descriptors resolve by FIRST
  // declaration, so declaring basketball here leaves baseball as the owner of the shared
  // master labels 'Offense' / 'Defense' / 'Plays' — the headings Export uses for a
  // historical/orphaned category. Basketball's own wording is board-only.
  //
  // `playersBefore` puts Players in the MIDDLE of both phases (3rd on OFF, 5th on DEF).
  // `defaultVisiblePhase` shows the OFF columns before a phase is picked — display only.
  basketball: {
    phases: [
      { code: 'OFF', label: 'Offense', possessionTag: 'Offense' },
      { code: 'DEF', label: 'Defense', possessionTag: 'Defense' },
    ],
    playersBefore: ['offense', 'defense'],
    defaultVisiblePhase: 'OFF',
    categoriesByPhase: {
      OFF: [
        BLUE('off_formation', 'Our Set / Situation'),
        GREEN('plays', 'Our Play'),
        PURPLE('offense', 'Our Player Action'),
        RED('off_opp_look', 'Their Defense'),
      ],
      DEF: [
        BLUE('def_opp_formation', 'Their Set / Formation'),
        RED('def_scheme', 'Our Defense'),
        BLUE('def_opp_play', 'Their Play'),
        PURPLE('def_result', 'Their Result'),
        GREEN('defense', 'Our Player Action'),
      ],
    },
  },

  // 7-on-7 is its OWN SPORT (not Football + a format, and not flag). It is pass-only:
  // no run game and no kicking game, so there is NO Special Teams phase — the 16
  // special_teams rows retired in the 7-on-7 repair migration stay retired, and no
  // column here could render them.
  //
  // SLICE G (Adam, 2026-09-25): the launch board. Six columns on OFF and DEF, Players
  // immediately BEFORE the trailing player-action column, exactly like flag and Football.
  // This sport says "Coverage" where the others say "Look" / "Scheme" — that is its own
  // board wording and affects nothing else, because Football is the naming authority for
  // the shared master labels (see the football entry).
  '7-on-7': {
    phases: [
      { code: 'OFF', label: 'Offense', possessionTag: 'Offense' },
      { code: 'DEF', label: 'Defense', possessionTag: 'Defense' },
    ],
    playersBefore: PLAYER_ACTION_KEYS,
    categoriesByPhase: {
      OFF: [
        BLUE('off_formation', 'Our Formation'),
        RED('off_opp_look', 'Their Coverage'),   // the coverage we are FACING
        GREEN('off_play', 'Our Play'),
        PURPLE('off_result', 'Our Result'),
        GREEN('off_player_action', 'Our Player Action'),
      ],
      DEF: [
        BLUE('def_opp_formation', 'Their Formation'),
        RED('def_scheme', 'Our Coverage'),       // what WE play — distinct from theirs
        BLUE('def_opp_play', 'Their Play'),
        PURPLE('def_result', 'Their Result'),
        GREEN('def_our_play', 'Our Player Action'),   // key preserved, label only
      ],
    },
  },

  // Flag football — OFF/DEF/SP each swap in their own phase-scoped columns.
  //
  // SLICE F (Adam, 2026-09-25): the launch board. Six columns on OFF and DEF, with the
  // roster Players column immediately BEFORE the trailing player-action column, matching
  // Football. The native tag board already scrolls horizontally at six columns
  // (tagging-overlay.tsx) and the web board already min-width scrolls, so this is a
  // definition change only — no tagger, geometry or style change.
  //
  // Flag's labels are deliberately IDENTICAL to Football's for every key the two share,
  // so which of them is declared first cannot change a shared master label. Since Slice G
  // Football is declared first and owns those descriptors outright.
  'flag football': {
    phases: [
      { code: 'OFF', label: 'Offense', possessionTag: 'Offense' },
      { code: 'DEF', label: 'Defense', possessionTag: 'Defense' },
      { code: 'SP', label: 'Special Teams', possessionTag: 'Special Teams' },
    ],
    playersBefore: PLAYER_ACTION_KEYS,
    categoriesByPhase: {
      OFF: [
        BLUE('off_formation', 'Our Formation'),
        RED('off_opp_look', 'Their Look'),      // the defensive look we are FACING
        GREEN('off_play', 'Our Play'),
        PURPLE('off_result', 'Our Result'),
        GREEN('off_player_action', 'Our Player Action'),
      ],
      DEF: [
        BLUE('def_opp_formation', 'Their Formation'),
        RED('def_scheme', 'Our Scheme'),        // what WE play — distinct from Their Look
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
    // Most 5v5 flag leagues have no kicking game, so 5v5 is not offered the Special
    // Teams phase for NEW tagging. The SP tags themselves are untouched and remain
    // fully exportable wherever a historical clip used one (see export's used-category
    // union) -- format controls what is OFFERED, never what history means.
    phasesByFormat: { '5v5': ['OFF', 'DEF'] },
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

// Unknown or missing sport → the flat `_default` board. This used to be 'basketball';
// it had to change when basketball became phased, or teamless/sport-less footage (and a
// sport-less Export picker) would have inherited a phased basketball board.
const DEFAULT_SPORT = '_default';
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

/**
 * THE ONE PLACE the roster-derived Players column is positioned. Both taggers call this
 * instead of splicing the column themselves, so native and web cannot drift.
 *
 * Players is inserted immediately before the first column whose key the sport lists in
 * `playersBefore`, and appended LAST when the sport lists nothing or lists nothing that
 * this phase renders. Placement only — nothing about selection, bundles or saving.
 *
 * Football / Flag / 7-on-7 list their player-action keys, which are always the trailing
 * column, so their rendered order is unchanged. Basketball lists `offense` / `defense`,
 * which sit mid-board, so Players lands 3rd on OFF and 5th on DEF.
 */
export function withPlayersColumn<T extends { key: string }>(
  sport: string | null | undefined,
  cats: readonly T[],
  playersCol: T,
): T[] {
  const d = resolve(sport);
  const before = 'playersBefore' in d ? d.playersBefore : undefined;
  const at = before?.length ? cats.findIndex(c => before.includes(c.key)) : -1;
  return at < 0 ? [...cats, playersCol] : [...cats.slice(0, at), playersCol, ...cats.slice(at)];
}

/**
 * Which phase's COLUMNS a board should show. Returns the coach's selected phase when
 * there is one, otherwise the sport's `defaultVisiblePhase` (basketball only), otherwise
 * null — which is every other phased sport's existing no-phase behavior.
 *
 * DISPLAY ONLY. Callers must keep passing their real selection to everything that WRITES
 * (the possession stamp at save time), so an unselected board still saves no possession.
 */
export function displayPhaseForSport(
  sport: string | null | undefined,
  activePhaseCode: string | null,
): string | null {
  if (activePhaseCode) return activePhaseCode;
  const d = resolve(sport);
  return ('defaultVisiblePhase' in d ? d.defaultVisiblePhase : undefined) ?? null;
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

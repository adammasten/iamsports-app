// Game-period options per sport for the tagging screen's period selector
// (the small Q1/Q2/… cluster used for stats). Shared by the mobile
// (tagging-overlay.tsx) and web (tagging-overlay.web.tsx) taggers so the two
// never drift on the sport list.
//
// Keyed by LOWERCASE sport — DB sport values are inconsistently cased
// ("Basketball" vs "basketball"), so always resolve via periodsForSport().
// Each name maps to a GLOBAL category='period' tag; a period button only
// renders if its tag exists. Seeded so far: Q1, Q2, Q3, Q4, 1H, 2H
// (migration_tags_add_period_category_and_seed_basketball_periods.sql).
// Add a sport here only once its period tag names are seeded.
export const PERIODS_BY_SPORT: Record<string, string[]> = {
  basketball: ['Q1', 'Q2', 'Q3', 'Q4', '1H', '2H'],
  football: ['Q1', 'Q2', 'Q3', 'Q4', '1H', '2H'],
  'flag football': ['Q1', 'Q2', 'Q3', 'Q4', '1H', '2H'],
  soccer: ['1H', '2H'],
  lacrosse: ['Q1', 'Q2', 'Q3', 'Q4'],
};

// Resolve a (possibly mis-cased / null) sport to its ordered period names.
// Defaults to basketball when no sport is set, since most content is basketball.
export function periodsForSport(sport: string | null | undefined): string[] {
  return PERIODS_BY_SPORT[(sport ?? 'basketball').trim().toLowerCase()] ?? [];
}

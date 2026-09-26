// test_basketball_sticky_contract.ts
//
// Asserts the REAL shared sport contract (lib/core/tag-categories.ts) — not a re-implementation:
//   * basketball boards are UNCHANGED: OFF = 5 columns, DEF = 6, in the exact expected order
//   * the sticky lookup resolves to the right category per phase
//   * the category -> phase-slot reverse lookup is correct
//   * NO OTHER SPORT opts into sticky behaviour
//
// Run: npx tsx test_basketball_sticky_contract.ts
import {
  categoriesForSport, withPlayersColumn, phasesForSport,
  stickyContextCategory, stickyPhaseForCategory,
} from './lib/core/tag-categories';

let pass = 0, fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n          got:  ${g}\n          want: ${w}`); }
}

const PLAYERS = { key: 'players', label: 'Players' } as any;
const cols = (sport: string, phase: string) =>
  withPlayersColumn(sport, categoriesForSport(sport, phase), PLAYERS).map((c: any) => c.key);

console.log('=== BASKETBALL BOARDS UNCHANGED ===');
check('basketball OFF columns', cols('basketball', 'OFF'),
  ['off_formation', 'plays', 'players', 'offense', 'off_opp_look']);
check('basketball OFF column count is 5', cols('basketball', 'OFF').length, 5);
check('basketball DEF columns', cols('basketball', 'DEF'),
  ['def_opp_formation', 'def_scheme', 'def_opp_play', 'def_result', 'players', 'defense']);
check('basketball DEF column count is 6', cols('basketball', 'DEF').length, 6);
check('basketball phases', (phasesForSport('basketball') ?? []).map(p => p.code), ['OFF', 'DEF']);

console.log('=== STICKY LOOKUP ===');
check('OFF sticky category  = off_opp_look (Their Defense)', stickyContextCategory('basketball', 'OFF'), 'off_opp_look');
check('DEF sticky category  = def_scheme   (Our Defense)',   stickyContextCategory('basketball', 'DEF'), 'def_scheme');
check('sticky lookup is case/space tolerant', stickyContextCategory(' Basketball ', 'OFF'), 'off_opp_look');
check('no phase -> null', stickyContextCategory('basketball', null), null);
check('unknown phase -> null', stickyContextCategory('basketball', 'SP'), null);

console.log('=== CATEGORY -> PHASE SLOT (what the tap handler uses) ===');
check('off_opp_look -> OFF', stickyPhaseForCategory('basketball', 'off_opp_look'), 'OFF');
check('def_scheme   -> DEF', stickyPhaseForCategory('basketball', 'def_scheme'), 'DEF');
check('a NON-sticky basketball category is not sticky', stickyPhaseForCategory('basketball', 'plays'), null);
check('players column is not sticky', stickyPhaseForCategory('basketball', 'players'), null);
check('offense (Our Player Action) is not sticky', stickyPhaseForCategory('basketball', 'offense'), null);
check('def_result is not sticky', stickyPhaseForCategory('basketball', 'def_result'), null);

console.log('=== NO OTHER SPORT OPTS IN (scope guard) ===');
for (const sport of ['soccer', 'lacrosse', 'football', 'flag', '7on7', 'baseball', 'softball', 'volleyball']) {
  check(`${sport}: OFF has no sticky`, stickyContextCategory(sport, 'OFF'), null);
  check(`${sport}: DEF has no sticky`, stickyContextCategory(sport, 'DEF'), null);
  // the football family shares off_opp_look / def_scheme keys — they must NOT become sticky there
  check(`${sport}: off_opp_look not sticky`, stickyPhaseForCategory(sport, 'off_opp_look'), null);
  check(`${sport}: def_scheme not sticky`, stickyPhaseForCategory(sport, 'def_scheme'), null);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);

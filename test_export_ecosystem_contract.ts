// test_export_ecosystem_contract.ts
//
// THE TAGGER <-> EXPORT ECOSYSTEM CONTRACT.
//
// THE INVARIANT (Adam, 2026-09-26):
//   "Tag availability and exportability are two views of the same tag ecosystem."
//
//   The TAGGER decides what can be NEWLY APPLIED:
//       active global tags scoped by sport + format
//     + active team-scoped custom tags (never sport- or format-narrowed)
//     + roster-derived player tags
//     - this team's team_hidden_tags
//
//   EXPORT must understand a STRICTLY LARGER set:
//       everything currently taggable
//     + everything HISTORICALLY USED — retired, hidden, out-of-format, or from an
//       older taxonomy. A tag id present in clip_tags must always resolve.
//
//   Those are two DIFFERENT filters over ONE vocabulary. Collapsing them (i.e.
//   letting Export reuse the tagger's retired/hidden/format filter) silently makes
//   old clips undiscoverable, which is the failure this file exists to prevent.
//
// This file asserts the REAL shared modules — lib/core/tag-categories.ts and
// lib/core/tag-scope.ts — never a re-implementation of their rules. It is pure:
// no network, no Supabase, no DB. Run: npx tsx test_export_ecosystem_contract.ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SPORT_TAGS, categoriesForSport, categoriesForSports, phasesForSport,
  withPlayersColumn, categoryDescriptor, pickerCategoryForKey,
  isActionCategory, BOARD_CATEGORY_KEYS, FALLBACK_FLAT_COLUMNS,
} from './lib/core/tag-categories';
import { buildTagScopeFilter, applyTagScope } from './lib/core/tag-scope';
import { clipMatchesGroup } from './lib/core/clip-filtering';

// Export's picker wiring lives in app/export.tsx, which imports React Native and so
// cannot be imported here. The G/H sections below therefore assert its SOURCE for the
// two specific wiring facts this contract depends on. That is deliberate: replicating
// the rule in the test instead would be the exact anti-pattern that let the desktop
// Players column and the web colour map drift — a test must assert the real thing.
const EXPORT_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'app/export.tsx'), 'utf8');

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; failures.push(`  FAIL  ${name}\n          got:  ${g}\n          want: ${w}`); console.log(`  FAIL  ${name}\n          got:  ${g}\n          want: ${w}`); }
}
function ok(name: string, cond: boolean) { check(name, !!cond, true); }
function section(s: string) { console.log(`\n=== ${s} ===`); }

// Every sport the product ships, so a NEW sport added to SPORT_TAGS without an
// Export representation fails here instead of in front of a coach.
const SPORTS = Object.keys(SPORT_TAGS);
// The stamp categories: written at bundle 0 by the taggers, surfaced in Export
// through their own dedicated controls rather than as board columns.
const STAMP_CATEGORIES = ['possession', 'period', 'special'];

// ─────────────────────────────────────────────────────────────────────────────
// A. EVERY TAGGER CATEGORY IS EXPORT-RECOGNISED
//    Catches: a taxonomy slice adds a column to a board and Export has no
//    section to render its tags in, so the tags become unexportable.
// ─────────────────────────────────────────────────────────────────────────────
section('A. every tagger category is export-recognised');
for (const sport of SPORTS) {
  const phases = phasesForSport(sport);
  const phaseCodes = phases ? phases.map(p => p.code) : [null];
  // The Export step-2 picker's "current" half is categoriesForSports([...sports]).
  const exportKeys = new Set(categoriesForSports([sport]).map(c => c.key));
  for (const ph of phaseCodes) {
    for (const cat of categoriesForSport(sport, ph)) {
      const label = `${sport}/${ph ?? 'flat'} ${cat.key}`;
      // 1. Export's category universe contains it.
      ok(`${label}: in Export picker universe`, exportKeys.has(cat.key));
      // 2. It resolves to a real (not invented) descriptor, so the section gets a
      //    human heading rather than a raw key.
      ok(`${label}: pickerCategoryForKey known`, pickerCategoryForKey(cat.key).known);
      ok(`${label}: has a non-empty label`, categoryDescriptor(cat.key).label.trim().length > 0);
      // 3. It counts as an ACTION category, which is what Export's group advisory
      //    and make-highlight's bundle classifier both key off.
      ok(`${label}: isActionCategory`, isActionCategory(cat.key));
    }
  }
}
// Export unions the sports of the selected games; a multi-sport selection must not
// drop either sport's categories.
{
  const multi = new Set(categoriesForSports(['basketball', 'flag football']).map(c => c.key));
  for (const k of categoriesForSport('basketball', 'OFF').map(c => c.key)) ok(`multi-sport union keeps basketball ${k}`, multi.has(k));
  for (const k of categoriesForSport('flag football', 'SP').map(c => c.key)) ok(`multi-sport union keeps flag ${k}`, multi.has(k));
}
// A sport-less / unknown selection must still produce a usable picker, not an
// empty one (Export falls back to the _default board).
ok('sport-less picker is non-empty', categoriesForSports([]).length > 0);
ok('unknown-sport picker is non-empty', categoriesForSports(['kabaddi']).length > 0);

// The stamp categories are deliberately NOT board columns — they must never leak
// into a board or be counted as actions, or the over-stacked advisory and the
// highlight bundle classifier both start miscounting.
for (const s of STAMP_CATEGORIES) {
  ok(`stamp '${s}' is not an action category`, !isActionCategory(s));
  ok(`stamp '${s}' is in no sport's board`, !SPORTS.some(sp => {
    const ph = phasesForSport(sp);
    const codes = ph ? ph.map(p => p.code) : [null];
    return codes.some(c => categoriesForSport(sp, c).some(cat => cat.key === s));
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// B. AN ARBITRARY NEW TEAM CUSTOM TAG NEEDS NO CODE CHANGE
//    Catches: Export growing a hardcoded tag list, so a coach's brand-new
//    "Great Screen" needs a deploy before it can be exported.
//    The synthetic tag's NAME is never hardcoded anywhere in Export — the test
//    generates it, and only the CATEGORY has to be understood.
// ─────────────────────────────────────────────────────────────────────────────
section('B. arbitrary team custom tag needs no code change');
{
  const synthetic = `SYNTHETIC-${Math.random().toString(36).slice(2, 10)}`;
  // My Tags only ever offers a category that already exists in the definition (or
  // a used historical one), so a custom tag's category is always resolvable.
  for (const sport of SPORTS) {
    const phases = phasesForSport(sport);
    const codes = phases ? phases.map(p => p.code) : [null];
    for (const ph of codes) {
      for (const cat of categoriesForSport(sport, ph)) {
        // A team tag in this category is discoverable purely from its category —
        // nothing about the tag's name, id or team is baked into Export.
        const resolved = pickerCategoryForKey(cat.key);
        ok(`custom '${synthetic}' in ${sport}/${ph ?? 'flat'}/${cat.key} resolves`, resolved.known && resolved.label.length > 0);
      }
    }
  }
  // The tag-scope filter must offer team tags WITHOUT narrowing them by sport or
  // format: a coach's own vocabulary must not vanish when the team changes format.
  const teamId = '11111111-1111-1111-1111-111111111111';
  const f = buildTagScopeFilter({ sport: 'Basketball', teamId, format: '5v5' });
  ok('team branch present', f.includes(`and(scope.eq.team,team_id.eq.${teamId})`));
  ok('team branch is NOT sport-narrowed', !/scope\.eq\.team[^)]*sport/.test(f));
  ok('team branch is NOT format-narrowed', !/scope\.eq\.team[^)]*format/.test(f));
}

// ─────────────────────────────────────────────────────────────────────────────
// C. TEAM ISOLATION
//    Catches: a filter change that lets Team B see Team A's custom tags.
//    (RLS tags_read is the real enforcement — this guards the CLIENT filter that
//    must not widen past it.)
// ─────────────────────────────────────────────────────────────────────────────
section('C. team isolation');
{
  const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const fa = buildTagScopeFilter({ sport: 'Basketball', teamId: A });
  ok('Team A filter names only Team A', fa.includes(A) && !fa.includes(B));
  const fb = buildTagScopeFilter({ sport: 'Basketball', teamId: B });
  ok('Team B filter names only Team B', fb.includes(B) && !fb.includes(A));
  // Exactly ONE team branch — never a list, never an OR of teams.
  check('one team branch only', (fa.match(/scope\.eq\.team/g) ?? []).length, 1);
  // Teamless content gets NO team branch at all, so loose footage can never pull
  // in some other team's private vocabulary.
  const none = buildTagScopeFilter({ sport: 'Basketball', teamId: null });
  ok('teamless filter has no team branch', !none.includes('scope.eq.team'));
}

// ─────────────────────────────────────────────────────────────────────────────
// D. HISTORICAL RESOLUTION — the retired / hidden / out-of-scope rule
//    Catches: the single most damaging possible regression — Export reusing the
//    tagger's filter, which would make every clip tagged with a retired or hidden
//    tag silently undiscoverable.
// ─────────────────────────────────────────────────────────────────────────────
section('D. historical resolution');
{
  // The TAGGER filter must exclude retired tags.
  const calls: string[] = [];
  const spy: any = {
    or(f: string) { calls.push(`or:${f}`); return spy; },
    is(col: string, val: null) { calls.push(`is:${col}=${String(val)}`); return spy; },
  };
  applyTagScope(spy, { sport: 'Basketball', teamId: 'team-1' });
  ok('tagger filter excludes retired tags', calls.includes('is:retired_at=null'));
  // With a sport set the global branch is wrapped: and(scope.eq.global,or(sport...)).
  ok('tagger filter applies the scope rule', calls.some(c => c.startsWith('or:') && c.includes('scope.eq.global')));

  // EXPORT must resolve a category that NO sport defines any more. `special_teams`
  // is the real historical case: fully retired by migration_tag_retirement, in no
  // sport definition — yet any clip still carrying one must render.
  const st = pickerCategoryForKey('special_teams');
  ok('retired-era category still renders', st.label.trim().length > 0 && !!st.color);
  // The legacy flat keys survive for the same reason: Football is phased now, so
  // formation/play/result are in no sport definition, but old clips used them.
  for (const c of FALLBACK_FLAT_COLUMNS) {
    const r = pickerCategoryForKey(c.key);
    ok(`legacy fallback key '${c.key}' still resolves`, r.known && r.label.trim().length > 0);
  }
  // A phase a team's FORMAT no longer offers must still resolve for history: a flag
  // team on 5v5 is not offered SP, but its old SP clips must stay exportable.
  const fmt5v5 = phasesForSport('flag football', '5v5')!.map(p => p.code);
  ok('5v5 flag is not offered SP for new tagging', !fmt5v5.includes('SP'));
  for (const cat of categoriesForSport('flag football', 'SP')) {
    ok(`out-of-format SP category '${cat.key}' still resolves`, pickerCategoryForKey(cat.key).known);
  }
  // categoriesForSports must NOT narrow by format — Export's universe has to stay
  // format-blind so history is never erased.
  ok('Export universe keeps SP for a flag team', categoriesForSports(['flag football']).some(c => c.key === 'st_play'));
}

// ─────────────────────────────────────────────────────────────────────────────
// E. PLAYER (ROSTER) RESOLUTION
//    Catches: the Players column losing its Export section, or players being
//    misclassified as an action (which would break the over-stacked advisory and
//    the highlight bundle classifier).
// ─────────────────────────────────────────────────────────────────────────────
section('E. player resolution');
{
  ok("'players' is not an action category", !isActionCategory('players'));
  ok("'players' is in no sport definition", !BOARD_CATEGORY_KEYS.has('players'));
  const PLAYERS = { key: 'players', label: 'Players' };
  // Every board must place exactly one Players column — Export appends its own
  // Players section from the same premise.
  for (const sport of SPORTS) {
    const phases = phasesForSport(sport);
    const codes = phases ? phases.map(p => p.code) : [null];
    for (const ph of codes) {
      const cols = withPlayersColumn(sport, categoriesForSport(sport, ph), PLAYERS);
      check(`${sport}/${ph ?? 'flat'} has exactly one Players column`, cols.filter(c => c.key === 'players').length, 1);
    }
  }
  // A player tag's readable name comes from tags.name, never a uuid: guard that
  // the descriptor path never yields a uuid-looking label for 'players'.
  ok("'players' descriptor label is readable", !/^[0-9a-f]{8}-/.test(categoryDescriptor('players').label));
}

// ─────────────────────────────────────────────────────────────────────────────
// F. UNKNOWN / FUTURE CATEGORY SAFETY
//    Catches: a category key Export has never heard of being silently dropped
//    instead of rendered with a safe fallback label.
// ─────────────────────────────────────────────────────────────────────────────
section('F. unknown / future category safety');
{
  const future = `future_cat_${Math.random().toString(36).slice(2, 8)}`;
  const r = pickerCategoryForKey(future);
  check(`unknown '${future}' is reported as unknown`, r.known, false);
  ok(`unknown '${future}' still gets a non-empty label`, r.label.trim().length > 0);
  ok(`unknown '${future}' still gets a colour`, !!r.color && r.color !== 'undefined');
  ok(`unknown '${future}' never throws`, typeof categoryDescriptor(future).bg === 'string');
  // The fallback must be the KEY, not undefined/null/"[object Object]" — so a coach
  // sees something identifiable rather than a blank heading.
  check(`unknown label falls back to the key`, r.label, future);
}

// ─────────────────────────────────────────────────────────────────────────────
// G. PERIOD IS REPRESENTED IN EXPORT  (Adam, 2026-09-26 — design (a))
//    Catches: period being pushed back behind a stamp exclusion, which is how
//    120 of 408 live clips ended up carrying a period nobody could export by.
// ─────────────────────────────────────────────────────────────────────────────
section('G. period is represented in Export');
{
  // 1. Period is NOT a board category — it must stay a bundle-0 stamp, never a column.
  ok("'period' is in no sport's board", !BOARD_CATEGORY_KEYS.has('period'));
  ok("'period' is not an action category", !isActionCategory('period'));

  // 2. Export must NOT exclude it from the normal data-driven category sections.
  //    STAMP_WITH_OWN_CONTROL is the set that is excluded; period must not be in it.
  const ownControl = EXPORT_SRC.match(/const STAMP_WITH_OWN_CONTROL = new Set\(\[([^\]]*)\]\)/);
  ok('STAMP_WITH_OWN_CONTROL exists', !!ownControl);
  const ownControlKeys = (ownControl?.[1] ?? '').match(/'([^']+)'/g)?.map(s => s.replace(/'/g, '')) ?? [];
  check('possession keeps its own control (QUICK EXPORT)', ownControlKeys.includes('possession'), true);
  check('special keeps its own control (★/POE/Good Play)', ownControlKeys.includes('special'), true);
  check("PERIOD is NOT excluded from Export's category sections", ownControlKeys.includes('period'), false);
  // And the picker filter must use that set, not the full stamp set.
  ok('historicalDefs filter uses STAMP_WITH_OWN_CONTROL',
    /\.filter\(k => !definedKeys\.has\(k\) && !STAMP_WITH_OWN_CONTROL\.has\(k\)/.test(EXPORT_SRC));

  // 3. Because period is in no sport definition, it reaches the picker through the
  //    USED-categories half — which is what makes it automatic per sport.
  ok("'period' is in no sport definition", !categoriesForSports(Object.keys(SPORT_TAGS)).some(c => c.key === 'period'));

  // 4. It resolves to a readable, non-empty heading (rendered .toUpperCase() -> 'PERIOD').
  const per = pickerCategoryForKey('period');
  ok('period resolves to a non-empty label', per.label.trim().length > 0);
  check('period heading renders as PERIOD', per.label.toUpperCase(), 'PERIOD');
  ok('period resolves to a colour', !!per.color);

  // 5. FUTURE period values need no code change. Every period name the taggers can
  //    stamp (from the real periods module) is just a tag row in category 'period' —
  //    nothing about its NAME is referenced by Export.
  for (const name of ['Q1', 'Q2', 'Q3', 'Q4', '1H', '2H', '7', '9', 'EX', 'S1', 'S5']) {
    ok(`period value '${name}' needs no Export code (name never referenced)`, !EXPORT_SRC.includes(`'${name}'`));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// H. PERIOD COMBINES WITH ACTIONS — bundle-0 semantics, real matcher
//    Catches: a clipMatchesGroup change that breaks "2H + Made 3", or that lets
//    two separate bundles combine (the cross-bundle contamination rule).
// ─────────────────────────────────────────────────────────────────────────────
section('H. period + action matching (real clipMatchesGroup)');
{
  const H2 = 'tag-2H', H1 = 'tag-1H', MADE3 = 'tag-made3', ASSIST = 'tag-assist';
  const CONRAD = 'tag-conrad', MOSES = 'tag-moses';
  // A realistic saved clip: period stamped at bundle 0, two separate groups.
  const clip = { clipLevelTagIds: [H2], bundles: [[CONRAD, MADE3], [MOSES, ASSIST]] };

  ok('2H + Made 3 matches (period clip-level unions into the bundle)', clipMatchesGroup(clip, [H2, MADE3]));
  ok('2H + Assist matches (other bundle)', clipMatchesGroup(clip, [H2, ASSIST]));
  ok('2H + Conrad + Made 3 matches', clipMatchesGroup(clip, [H2, CONRAD, MADE3]));
  ok('2H alone matches (clip-level only)', clipMatchesGroup(clip, [H2]));
  ok('1H + Made 3 does NOT match (wrong period)', !clipMatchesGroup(clip, [H1, MADE3]));
  // THE CROSS-BUNDLE RULE: adding a period must never let two bundles combine.
  ok('Made 3 + Assist does NOT match (separate bundles)', !clipMatchesGroup(clip, [MADE3, ASSIST]));
  ok('2H + Made 3 + Assist does NOT match (period must not bridge bundles)', !clipMatchesGroup(clip, [H2, MADE3, ASSIST]));
  ok('Conrad + Assist does NOT match (cross-bundle)', !clipMatchesGroup(clip, [CONRAD, ASSIST]));
  // A clip with NO period must not match a period group.
  const noPeriod = { clipLevelTagIds: [], bundles: [[CONRAD, MADE3]] };
  ok('unstamped clip does not match 2H + Made 3', !clipMatchesGroup(noPeriod, [H2, MADE3]));
  ok('unstamped clip still matches Made 3', clipMatchesGroup(noPeriod, [MADE3]));
  // Period behaves exactly like the other bundle-0 stamps it now sits beside.
  const withStamps = { clipLevelTagIds: [H2, 'tag-offense', 'tag-goodplay'], bundles: [[CONRAD, MADE3]] };
  ok('Good Play + 2H + Made 3 matches', clipMatchesGroup(withStamps, ['tag-goodplay', H2, MADE3]));
  ok('possession + period + action matches', clipMatchesGroup(withStamps, ['tag-offense', H2, MADE3]));
}

// ─────────────────────────────────────────────────────────────────────────────
// I. ALL THREE `special` TAGS HAVE EXPORT REPRESENTATION
//    Catches: a fourth special toggle being added to the taggers without an
//    Export control — the exact way Good Play was missed.
// ─────────────────────────────────────────────────────────────────────────────
section('I. special tags have Export representation');
{
  // The three clip-level markers both taggers write at bundle 0.
  const SPECIAL_TAGS = ['★ Highlight', 'POE', 'Good Play'];
  for (const name of SPECIAL_TAGS) {
    // Export resolves each by its literal name, so each name must appear...
    ok(`Export resolves the '${name}' tag`, EXPORT_SRC.includes(`t.name === '${name}'`));
  }
  // ...and each must be wired to a control that puts its id in the group.
  for (const v of ['highlightTagId', 'poeTagId', 'goodPlayTagId']) {
    ok(`${v} is derived from a special tag`, new RegExp(`const ${v} = tags\\.find\\(t => t\\.category === 'special'`).test(EXPORT_SRC));
    ok(`${v} is wired to toggleTagInGroup`, EXPORT_SRC.includes(`${v} && toggleTagInGroup(${v})`));
  }
  // `special` keeps its dedicated controls, so it must NOT also render as a section
  // (which would duplicate the buttons).
  ok("'special' stays out of the category sections", /STAMP_WITH_OWN_CONTROL = new Set\(\[[^\]]*'special'/.test(EXPORT_SRC));
  ok("'special' is not an action category", !isActionCategory('special'));
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail) { console.log('\nFAILURES:\n' + failures.join('\n')); process.exit(1); }

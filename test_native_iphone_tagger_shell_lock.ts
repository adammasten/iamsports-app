// test_native_iphone_tagger_shell_lock.ts
//
// THE NATIVE IPHONE TAGGER UI LOCK, as executable assertions.
// Contract: docs/NATIVE_IPHONE_TAGGER_UI_LOCK.md
// Approved: TestFlight build 76, commit 56da2f2, Adam, 2026-09-29.
//
// WHY THIS FILE EXISTS. Three TestFlight builds shipped a tagger whose source
// read correctly and whose screen did not:
//   * 7714b66 added a speed chip to a bottom row with ~18pt of headroom, so
//     Start/End painted over the tag-nav buttons.
//   * the + Group button sat in an absolute box with BOTH top and bottom, shorter
//     than its children, so flex-end packed them up into the top bar over Save clip.
//   * 17360cf asked PostgREST for `clip_tags.id`, a column that does not exist, so
//     the whole request 42703'd, `if (error || !data) return;` swallowed it, and
//     existingClips was [] on every video -- which silently removed the tag-nav
//     buttons, the scrub-bar clip markers and the clip pill at once.
//
// app/tagging-overlay.tsx imports React Native and expo-video, so it cannot be
// imported into node; its wiring is asserted against its SOURCE, the same approach
// test_export_ecosystem_contract.ts and test_background_upload_durability.ts use.
// The sport matrix is asserted against the REAL contract in lib/core, never against
// a re-implementation of it.
//
// These guards do not replace the device checklist in the lock document.
// RUNTIME SCREENSHOTS > SOURCE-CODE ASSUMPTIONS.
//
// Run: npx tsx test_native_iphone_tagger_shell_lock.ts
import { readFileSync } from 'node:fs';
import {
  SPORT_TAGS, categoriesForSport, withPlayersColumn, phasesForSport, stickyContextCategory,
} from './lib/core/tag-categories';
import { periodsForSport } from './lib/core/periods';

const SRC = readFileSync('app/tagging-overlay.tsx', 'utf8');

let pass = 0, fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n          got:  ${g}\n          want: ${w}`); }
}
function ok(name: string, cond: boolean, why = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${why ? `\n          ${why}` : ''}`); }
}

// The bottom control rail: from the phone-only `{!isTablet && (` guard that opens
// controlsRow through to the end of that block. Everything zone-related lives here.
function controlsRowBlock(): string {
  const i = SRC.indexOf('styles.controlsRow');
  if (i < 0) throw new Error('controlsRow not found in app/tagging-overlay.tsx');
  const start = SRC.lastIndexOf('{!isTablet && (', i);
  const end = SRC.indexOf('iPad ONLY: bottom-corner edge rails', i);
  return SRC.slice(start, end > 0 ? end : i + 6000);
}

console.log('=== A. existingClips QUERY CONTRACT (the 42703 regression) ===');
// clip_tags is a composite-key join table. These are ALL of its columns; a clip_tags
// embed may never request anything else, and `id` in particular kills the request.
const CLIP_TAGS_COLUMNS = ['clip_id', 'tag_id', 'bundle_number', 'stat_side'];
// The embed nests -- clip_tags ( ..., tags ( ... ) ) -- so walk the parens rather
// than regexing, or the inner tags(...) leaks into the field list.
function clipTagsEmbedFields(src: string): string[] | null {
  const open = src.indexOf('clip_tags (');
  if (open < 0) return null;
  let depth = 0, i = src.indexOf('(', open), end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) { end = i; break; }
  }
  if (end < 0) return null;
  return src.slice(src.indexOf('(', open) + 1, end)
    .replace(/tags\s*\([^)]*\)/g, '')          // drop the nested tags(...) embed
    .split(',').map(f => f.trim()).filter(Boolean);
}
const embedded = clipTagsEmbedFields(SRC);
ok('the clips .select( ... clip_tags ( ... ) ) query is present', embedded !== null,
  'loadExistingClips no longer matches its expected shape -- re-read the lock doc before editing it.');
if (embedded) {
  check('clip_tags embed requests only real clip_tags columns',
    embedded.filter(c => !CLIP_TAGS_COLUMNS.includes(c)), []);
  ok('clip_tags embed is non-empty', embedded.length > 0);
  ok('clip_tags embed does NOT request `id` (no such column -> PostgREST 42703)',
    !embedded.includes('id'),
    'clip_tags has no id column. Adding it makes the WHOLE query fail and empties existingClips.');
}
// Belt and braces: catch the bad embed anywhere in the file, in any spacing.
ok('no `clip_tags ( id` embed anywhere in the native tagger',
  !/clip_tags\s*\(\s*id\b/.test(SRC));

console.log('\n=== B. loadExistingClips FAILURES ARE SURFACED, NOT SWALLOWED ===');
ok('the silent `if (error || !data) return;` swallow is gone',
  !/if \(error \|\| !data\) return;/.test(SRC),
  'An empty tagger on a tagged video is indistinguishable from an untagged video.');
const loader = SRC.slice(SRC.indexOf('const loadExistingClips'), SRC.indexOf('useEffect(() => { loadExistingClips'));
ok('a load failure is logged', /console\.warn\('\[loadExistingClips\]'/.test(loader));
ok('a load failure is surfaced to the user', /Alert\.alert\(/.test(loader));

console.log('\n=== C. PREVIOUS / NEXT IS FIXED AND VISIBLE ===');
const rail = controlsRowBlock();
ok('tag-nav renders on existingClips.length > 0', /existingClips\.length > 0 && \(/.test(rail));
ok('tag-nav calls the existing jumpToTag in both directions',
  /jumpToTag\(-1\)/.test(rail) && /jumpToTag\(1\)/.test(rail));
ok('tag-nav lives in its own zone, not inside the transport group',
  /styles\.tagNavZone/.test(rail));
ok('NO scroller in the bottom control rail (Prev/Next must not need discovering)',
  !/<ScrollView/.test(rail),
  'The rail is sized to fit one row on the narrowest phone; a scroller hides primary controls.');
ok('tagNavZone cannot shrink', /tagNavZone: \{[^}]*flexShrink: 0/s.test(SRC));
ok('markGroup (Start/End) cannot shrink', /markGroup: \{[^}]*flexShrink: 0/s.test(SRC));
ok('the timecode is the ONLY elastic element', /timeText: \{[^}]*flexShrink: 1/s.test(SRC));
// Every transport control stays present -- shrinking the rail must never mean deleting one.
for (const label of ['-5s', '-1s', '+1s', '+5s']) {
  ok(`transport keeps ${label}`, rail.includes(`>${label}<`));
}
ok('transport keeps play/pause', /isPlaying \? '❚❚' : '▶'/.test(rail));
ok('transport keeps the speed control', /speedLabel\(speed\)/.test(rail));
ok('transport keeps Start and End', /'Start'/.test(rail) && /'End'/.test(rail));

// The rail must still FIT. Fixed cost measured from the locked style values against
// the narrowest supported landscape phone (4.7", 667pt wide, no side insets).
const num = (style: string, key: string) => {
  const m = SRC.match(new RegExp(`${style}: \\{[^}]*\\b${key}: (\\d+)`, 's'));
  return m ? parseInt(m[1], 10) : NaN;
};
const skipW = num('skipBtn', 'width'), playW = num('playBtn', 'width');
const navW = num('tagNavBtn', 'width'), markW = num('markBtn', 'width');
const fixed = skipW * 5 + playW + 8 * 6 + (navW * 2 + 6) + (markW * 2 + 6) + 8 * 2;
ok(`bottom rail fixed cost ${fixed}pt fits a 4.7" landscape phone (643pt usable)`, fixed <= 643 - 80,
  `Leaves ${643 - fixed}pt for the timecode, which needs ~86pt. Shrink something or move a control.`);

console.log('\n=== D. PLATFORM GUARDS (phone changes must not reach iPad/web) ===');
ok('legacy floating period cluster is iPad-only',
  /isTablet && !isFlag && !iPadNonFootball && sportPeriods\.length > 0/.test(SRC),
  'Basketball on phone must never return to the stacked periodCluster.');
ok('legacy floating phase cluster is iPad-only',
  /isTablet && !isFlag && !iPadNonFootball && possOptions\.length > 0/.test(SRC));
ok('topReadout is iPad-only', /isTablet && !isFlag && activeTagNames\.length > 0/.test(SRC));
ok('the top rail reaches EVERY phone sport', /!isWatch && \(isFlag \|\| !isTablet\) && \(/.test(SRC));
ok('phone board left inset is a constant (no sport term)',
  /left: insets\.left \+ \(isTablet \? 104 : 12\)/.test(SRC));
ok('phone board right inset is a constant (no sport term)',
  /right: insets\.right \+ \(isTablet \? 120 : SIDE_STRIP_W \+ 24\)/.test(SRC));
ok('+ Group and Save clip share ONE upper-right container', /styles\.topActions/.test(SRC));
ok('sideStrip has no `top` (it must grow up from bottom, never into the top bar)',
  !/styles\.sideStrip,\s*\n?\s*\{ top:/.test(SRC) && /\{ bottom: insets\.bottom \+ 76, right: insets\.right \+ 8 \}/.test(SRC));
ok('the zoom surface is phone-only and hidden-chrome-only',
  /\{!isTablet && !controlsVisible && \(/.test(SRC));
ok('zoom is bounded at 4x', /const ZOOM_MAX = 4;/.test(SRC));
ok('restoring the chrome resets zoom to 1x', /zoomScale\.value = withTiming\(1,/.test(SRC));

console.log('\n=== E. ONE SHELL, EVERY SPORT (no isFlag-style geometry forks) ===');
// A sport may pick CONTENT. It may never pick phone shell GEOMETRY. The only sport
// conditional allowed inside the phone shell is the reserved sport-control slot.
const sportTerms = /isFlag|isFootball|tagSport/;
const insetsStart = SRC.indexOf('bottom: insets.bottom + (isTablet');
const insetsEnd = SRC.indexOf('right: insets.right + (isTablet', insetsStart);
const insetsBlock = insetsStart >= 0 && insetsEnd > insetsStart
  ? SRC.slice(insetsStart, SRC.indexOf('\n', insetsEnd)) : '';
ok('the phone board insets carry no sport term', !!insetsBlock && !sportTerms.test(insetsBlock),
  'A sport term in the board geometry is exactly the isFlag fork this lock forbids.');
ok('the bottom control rail carries no sport term', !sportTerms.test(rail),
  'The transport, tag-nav and Start/End must be identical for every sport.');
ok('DN/DIST/DR is the reserved sport slot, gated on isFlag only',
  /\{isFlag && \(\s*<>/.test(SRC),
  'saveClip writes clip_football only for flag; widening the slot needs the save path widened first.');

console.log('\n=== F. SPORT MATRIX MATCHES THE LIVE CONTRACT ===');
// If a sport's shape changes, the matrix in the lock document is stale. Update both.
const PLAYERS = { key: 'players', label: 'Players' } as any;
const shape = (sport: string) => {
  const phases = phasesForSport(sport);
  const codes = phases ? phases.map((p: any) => p.code) : [null];
  return {
    periods: periodsForSport(sport).length,
    phases: codes.map(c => c ?? 'flat'),
    cols: codes.map(c => withPlayersColumn(sport, categoriesForSport(sport, c as any), PLAYERS).length),
    sticky: codes.filter(c => c && stickyContextCategory(sport, c)).length > 0,
  };
};
check('flag football', shape('flag football'), { periods: 6, phases: ['OFF', 'DEF', 'SP'], cols: [6, 6, 4], sticky: false });
check('football',      shape('football'),      { periods: 6, phases: ['OFF', 'DEF', 'SP'], cols: [6, 6, 4], sticky: false });
check('7-on-7',        shape('7-on-7'),        { periods: 6, phases: ['OFF', 'DEF'], cols: [6, 6], sticky: false });
check('basketball',    shape('basketball'),    { periods: 6, phases: ['OFF', 'DEF'], cols: [5, 6], sticky: true });
check('soccer',        shape('soccer'),        { periods: 2, phases: ['OFF', 'DEF'], cols: [6, 6], sticky: false });
check('lacrosse',      shape('lacrosse'),      { periods: 4, phases: ['OFF', 'DEF'], cols: [6, 6], sticky: false });
check('baseball',      shape('baseball'),      { periods: 10, phases: ['OFF', 'DEF'], cols: [3, 4], sticky: false });
check('softball',      shape('softball'),      { periods: 10, phases: ['OFF', 'DEF'], cols: [3, 4], sticky: false });
check('volleyball',    shape('volleyball'),    { periods: 5, phases: ['flat'], cols: [5], sticky: false });

// Basketball is the only sport with sticky context, and the two phases stay independent.
check('sticky is basketball-only',
  Object.keys(SPORT_TAGS).filter(s => ['OFF', 'DEF', 'SP'].some(p => stickyContextCategory(s, p))),
  ['basketball']);
check('basketball OFF sticky category', stickyContextCategory('basketball', 'OFF'), 'off_opp_look');
check('basketball DEF sticky category', stickyContextCategory('basketball', 'DEF'), 'def_scheme');

// Every sport must resolve to a board. A sport that renders zero columns would be a
// blank tagger, which is the one outcome the shell may never produce.
for (const sport of Object.keys(SPORT_TAGS)) {
  if (sport === '_default') continue;
  const s = shape(sport);
  ok(`${sport}: every phase renders >= 1 column`, s.cols.every(c => c >= 1));
}
// The 5-vs-6 split is the locked board-mode rule (needsColumnScroll = cols > 5).
ok('needsColumnScroll still splits at 5 columns',
  /const needsColumnScroll = visibleCategories\.length > 5/.test(SRC));

console.log(`\n=== ${fail === 0 ? 'ALL GUARDS PASS' : 'LOCK VIOLATED'} — ${pass} passed, ${fail} failed ===`);
if (fail > 0) {
  console.log('Read docs/NATIVE_IPHONE_TAGGER_UI_LOCK.md. If Adam authorized this change,');
  console.log('update the lock document and this file together, then re-approve on device.');
}
process.exit(fail === 0 ? 0 : 1);

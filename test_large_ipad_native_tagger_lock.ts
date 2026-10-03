// test_large_ipad_native_tagger_lock.ts
//
// LARGE-IPAD NATIVE TAGGER — LOCK GUARD.
// Contract: docs/LARGE_IPAD_NATIVE_TAGGER_UI_LOCK.md  (approved 2026-10-02)
//
// SCOPE: the tablet path of app/tagging-overlay.tsx — the `isTablet` branch.
//
// ⚠️ READ THIS BEFORE TRUSTING THE SCOPE. Native `isTablet` is
// `Math.min(winW, winH) >= 700`, and an iPad Mini is 744 x 1133 — so on NATIVE the
// tablet branch ALSO renders on an iPad Mini. Adam approved this presentation on a
// LARGE iPad only. These guards therefore protect the SHELL CONTRACT of that branch
// (regions, control sets, ordering, wiring); they do NOT declare the branch suitable
// for a Mini. Small-tablet fit stays open, and narrowing the native gate later is
// permitted precisely because the Mini is not locked.
// The WEB lock has no such ambiguity: its gate structurally excludes the Mini.
//
// This guard does NOT weaken the native iPhone lock. The phone shell is governed by
// docs/NATIVE_IPHONE_TAGGER_UI_LOCK.md + test_native_iphone_tagger_shell_lock.ts; the
// assertions here are confined to the tablet branch, plus explicit checks that the two
// do not leak into each other.
//
// RUNTIME IS STILL THE SOURCE OF TRUTH. Verify on a real large iPad.
//
// Run: npx tsx test_large_ipad_native_tagger_lock.ts
import { readFileSync } from 'node:fs';

const NAT = readFileSync('app/tagging-overlay.tsx', 'utf8');

let pass = 0, fail = 0;
const failures: string[] = [];
function ok(name: string, cond: boolean, why = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else {
    fail++;
    const m = `  FAIL  ${name}${why ? `\n          ${why}` : ''}`;
    failures.push(m); console.log(m);
  }
}

const stylesStart = NAT.indexOf('const styles = StyleSheet.create({');
if (stylesStart < 0) throw new Error('cannot locate the stylesheet');
const BODY = NAT.slice(0, stylesStart);
const STYLES = NAT.slice(stylesStart);

// The two iPad-only bottom rails, isolated so "which control is in which rail" cannot be
// confused by the phone's horizontal controls row.
const leftRailAt = BODY.indexOf('styles.iLeftRail');
const rightRailAt = BODY.indexOf('styles.iRightRail');
const LEFT_RAIL = leftRailAt >= 0 ? BODY.slice(leftRailAt, rightRailAt > leftRailAt ? rightRailAt : leftRailAt + 2600) : '';
const RIGHT_RAIL = rightRailAt >= 0 ? BODY.slice(rightRailAt, rightRailAt + 4200) : '';

console.log('=== A. THE TABLET GATE ===');
ok('isTablet is the single tablet gate, min-side >= 700',
  /const isTablet = Math\.min\(winW, winH\) >= 700;/.test(NAT),
  'One gate, one place. Changing this number changes which devices get this shell.');
ok('the gate reads the min side (so orientation does not flip the shell)',
  /Math\.min\(winW, winH\)/.test(NAT));

console.log('\n=== B. iPAD BOTTOM-CORNER RAILS EXIST AS TWO SEPARATE STACKS ===');
ok('the LEFT rail (playback) is iPad-only', leftRailAt >= 0 && /\{isTablet && \(/.test(BODY) && /iLeftRail:/.test(STYLES));
ok('the RIGHT rail (clip actions) is iPad-only',
  rightRailAt >= 0 && /\{isTablet && !isWatch && \(/.test(BODY) && /iRightRail:/.test(STYLES));
ok('both rails are measured for the clip pill',
  /measurePill\('leftRail'/.test(BODY) && /measurePill\('rightRail'/.test(BODY));
ok('both rails are pointerEvents box-none so the video stays reachable between them',
  (LEFT_RAIL.match(/pointerEvents="box-none"/) || []).length >= 1 &&
  (RIGHT_RAIL.match(/pointerEvents="box-none"/) || []).length >= 1);

console.log('\n=== C. RIGHT RAIL — CONTROL SET AND ORDER ===');
// Approved order, top to bottom: TAG ↓/↑, POE, Highlight(★), Good Play, + Group, Save, End, Start.
// This matches the iPad cross-sport standard recorded in CLAUDE.md.
const rightOrder: [string, string][] = [
  ['TAG size toggle', 'styles.iTagSizeBtn'],
  ['POE', 'styles.iPoeBtn'],
  ['Highlight (star)', 'styles.iStarBtn'],
  ['Good Play', 'styles.iGoodPlayBtn'],
  ['+ Group', 'styles.iGroupBtn'],
  ['Save clip', 'styles.iSaveBtn2'],
  ['End', 'styles.iEndBtn'],
  ['Start', 'styles.iStartBtn'],
];
for (const [label, token] of rightOrder) {
  ok(`right rail contains ${label}`, RIGHT_RAIL.includes(token),
    'A control disappearing from the rail is the regression this lock exists to catch.');
}
let last = -1, ordered = true, brokeAt = '';
for (const [label, token] of rightOrder) {
  const at = RIGHT_RAIL.indexOf(token);
  if (at < 0 || at < last) { ordered = false; brokeAt = label; break; }
  last = at;
}
ok('right rail ORDER is TAG → POE → ★ → Good Play → + Group → Save → End → Start', ordered,
  brokeAt ? `order breaks at: ${brokeAt}` : 'Order is approved muscle memory across every sport.');
ok('+ Group uses the shared addGroup', /onPress=\{addGroup\}/.test(RIGHT_RAIL));
ok('Save uses the shared saveClip and respects canSave',
  /onPress=\{saveClip\}/.test(RIGHT_RAIL) && /!canSave && styles\.saveBtnDisabled/.test(RIGHT_RAIL),
  'This is the one shared save path, with its disabled treatment intact.');
ok('End sets the clip end from the live playhead',
  /onPress=\{\(\) => setEndTime\(player\.currentTime\)\}/.test(RIGHT_RAIL));
ok('Start sets the clip start from the live playhead',
  /onPress=\{\(\) => setStartTime\(player\.currentTime\)\}/.test(RIGHT_RAIL));
ok('POE and Highlight keep their disabled treatment while the video is not ready',
  /!videoReady && styles\.disabledBtn/.test(RIGHT_RAIL),
  'Tapping these before the video is ready produced broken clips.');

console.log('\n=== D. LEFT RAIL — PLAYBACK, PLAY/PAUSE AT THE BOTTOM ===');
const leftOrder: [string, string][] = [
  ['prev/next tagged play', 'styles.iTagNavBtn'],
  ['timecode', 'styles.iTimeText'],
  ['speed', 'styles.iSpeedBtn'],
  ['skip buttons', 'styles.iSkipBtn'],
  ['play/pause', 'styles.iPlayBtn'],
];
for (const [label, token] of leftOrder) {
  ok(`left rail contains ${label}`, LEFT_RAIL.includes(token));
}
let lastL = -1, orderedL = true;
for (const [, token] of leftOrder) {
  const at = LEFT_RAIL.indexOf(token);
  if (at < 0 || at < lastL) { orderedL = false; break; }
  lastL = at;
}
ok('play/pause is the LAST control in the left stack (bottom of the screen)', orderedL,
  'The approved layout puts play/pause at the very bottom, under the thumb.');
ok('−5s / +5s and −1s / +1s are both present',
  /-5s/.test(LEFT_RAIL) && /\+5s/.test(LEFT_RAIL) && /-1s/.test(LEFT_RAIL) && /\+1s/.test(LEFT_RAIL));
ok('prev/next tagged play is wired to jumpToTag and only shows with saved clips',
  /jumpToTag\(-1\)/.test(LEFT_RAIL) && /jumpToTag\(1\)/.test(LEFT_RAIL) &&
  /existingClips\.length > 0/.test(LEFT_RAIL));

console.log('\n=== E. TOP BAR ROUTING (as approved — see the doc for the known open gap) ===');
// Flag and the non-football sports put periods/phase in the top bar. Football and 7-on-7
// still use the floating clusters; that gap is DOCUMENTED AS OPEN and deliberately NOT
// asserted here, so closing it later does not trip this guard.
ok('iPadNonFootball routing exists', /const iPadNonFootball = isTablet && !isFootball;/.test(NAT));
ok('the flag top bar renders on tablet and phone alike',
  /\(isFlag \|\| !isTablet\)/.test(BODY),
  'Flag is the reference layout; its top bar is not tablet-conditional.');
ok('non-football iPad sports render their clusters IN the top bar',
  /\{!isWatch && iPadNonFootball && \(/.test(BODY),
  'This is the 14b0918 cross-sport move: basketball/soccer/etc. use the top bar, not floating clusters.');
// Football and 7-on-7 still use the FLOATING clusters on iPad. That deviation from the
// CLAUDE.md iPad standard is KNOWN AND OPEN (see the lock doc) and is deliberately NOT
// asserted, so closing it later does not trip this guard.
ok('the top bar uses the shared tbChip treatment', /tbChip:/.test(STYLES) && /tbClusters:/.test(STYLES));

console.log('\n=== F. TAG BOARD ON TABLET ===');
ok('column headers take the tablet size',
  /isTablet && styles\.colHeaderBig/.test(BODY) && /colHeaderBig:/.test(STYLES));
ok('chips take the tablet size',
  /isTablet && styles\.tagChipBig/.test(BODY) && /tagChipBig:/.test(STYLES));
ok('chip text takes the tablet size',
  /isTablet && styles\.tagChipTextBig/.test(BODY) && /tagChipTextBig:/.test(STYLES));
ok('the 6+ column horizontal strip still works (count-based, >5)',
  /const needsColumnScroll = visibleCategories\.length > 5 && tagBoardW > 0;/.test(NAT),
  'Six-column sports (football/flag/soccer/lacrosse/basketball DEF) need this to reach every column.');
ok('columns are pinned to the 5-column width when scrolling, never squeezed',
  /const pinnedColW = needsColumnScroll \? \(tagBoardW - TAG_COL_GAP \* 4\) \/ 5 : null;/.test(NAT),
  'Flex children would shrink to ~16.7% instead of overflowing — the thing this prevents.');
ok('<=5 columns keep the untouched flex path',
  /pinnedColW == null \? styles\.tagColumn :/.test(NAT));
ok('per-column vertical scrolling is intact', /<ScrollView showsVerticalScrollIndicator=\{false\}>/.test(BODY));
ok('the column strip is built once and reused by both branches',
  /\) : tagColumnEls\}/.test(BODY) && /const tagColumnEls = visibleCategories\.map/.test(NAT),
  'Duplicating the tree remounts every column and loses its scroll position.');

console.log('\n=== G. iPAD GEOMETRY / SAFE AREA ===');
ok('the board inset uses tablet-specific left/right/bottom values',
  /insets\.left \+ \(isTablet \? 104 : 12\)/.test(BODY) &&
  /insets\.right \+ \(isTablet \? 120 : SIDE_STRIP_W \+ 24\)/.test(BODY) &&
  /insets\.bottom \+ \(isTablet \? 40 :/.test(BODY),
  'These clear the two corner rails; losing them puts the board under the controls.');
ok('the scrubber clears both rails on tablet',
  /insets\.left \+ \(isTablet \? 112 : 12\)/.test(BODY) &&
  /insets\.right \+ \(isTablet \? 124 : 12\)/.test(BODY));

console.log('\n=== H. SHARED SEMANTICS — NO SECOND IMPLEMENTATION ===');
ok('columns come from the shared sport contract',
  /categoriesForSport/.test(NAT) && /withPlayersColumn/.test(NAT) &&
  /from '@\/lib\/core\/tag-categories'/.test(NAT));
ok('sticky context is the shared basketball contract',
  /stickyContextCategory/.test(NAT) && /stickyPhaseForCategory/.test(NAT),
  'Guarded independently by test_basketball_sticky_contract.ts.');
ok('phase display stays display-only (no possession written by a board opening)',
  /displayPhaseForSport\(tagSport, activePhaseCode\) \?\? sportPhases\?\.\[0\]\?\.code \?\? null/.test(NAT));
ok('the clip pill is shared, not tablet-specific', /ClipPill/.test(NAT));

console.log('\n=== I. ISOLATION — THE NATIVE iPHONE LOCK MUST NOT MOVE ===');
ok('the phone-only controls row is still gated !isTablet',
  /\{!isTablet && !controlsVisible && \(/.test(BODY),
  'The locked phone shell renders from the !isTablet path. See docs/NATIVE_IPHONE_TAGGER_UI_LOCK.md.');
ok('phone-only clusters remain !isTablet', /\{!isWatch && !isTablet && \(/.test(BODY));
ok('the iPad rails never render on the phone',
  !/!isTablet && \([\s\S]{0,400}iLeftRail/.test(BODY) && !/!isTablet && \([\s\S]{0,400}iRightRail/.test(BODY));
ok('iPad styles are their own i* / *Big keys, not edits to the phone keys',
  /iLeftRail:/.test(STYLES) && /iRightRail:/.test(STYLES) && /tagChip:/.test(STYLES) && /tagChipBig:/.test(STYLES),
  'Both the phone key and the tablet override must exist; editing the shared key moves the locked phone shell.');
ok('the phone tag-region style still exists untouched alongside the tablet geometry',
  /tagRegion:/.test(STYLES) && /fullscreenTagRegion:/.test(STYLES));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail) { console.log('\nFAILURES:\n' + failures.join('\n')); process.exit(1); }

// test_large_ipad_web_tagger_lock.ts
//
// LARGE-IPAD WEB TAGGER — LOCK GUARD.
// Contract: docs/LARGE_IPAD_WEB_TAGGER_UI_LOCK.md  (approved 2026-10-02)
//
// SCOPE: the large-tablet browser path of app/tagging-overlay.web.tsx — `isTabletWeb`.
// NOT desktop web. NOT the locked phone frame (isPhoneFrame — see
// test_mobile_web_tagger_parity.ts). NOT iPad Mini / small tablets, which are
// deliberately OUTSIDE this lock and still open for review.
//
// WHAT THIS PROTECTS: the structural/UX contracts Adam approved on a real large iPad.
// It does NOT freeze incidental implementation detail — a refactor that keeps the gate,
// the regions, the scrolling, the clips architecture and the control set is free to land.
//
// WHY SOURCE ASSERTIONS: one file serves desktop, tablet and phone browsers, so the thing
// that actually breaks is a change leaking across those branches. Same approach as
// test_mobile_web_tagger_parity.ts and test_native_iphone_tagger_shell_lock.ts.
//
// RUNTIME IS STILL THE SOURCE OF TRUTH. These guards passing is not evidence the iPad
// works. Verify on a real large iPad on a video that has saved clips.
//
// Run: npx tsx test_large_ipad_web_tagger_lock.ts
import { readFileSync } from 'node:fs';

const WEB = readFileSync('app/tagging-overlay.web.tsx', 'utf8');

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

// The immersive branch (shared by desktop true-fullscreen and the large tablet) runs from
// the FS board-columns comment to the stylesheet. The phone branch sits before it.
const phoneStart = WEB.indexOf('if (isPhone) {');
const immersiveStart = WEB.indexOf('// FS immersive board columns');
const stylesStart = WEB.indexOf('const styles = StyleSheet.create({');
if (phoneStart < 0 || immersiveStart < 0 || stylesStart < 0) {
  throw new Error('cannot locate the branch boundaries — update this guard with the file');
}
const PHONE = WEB.slice(phoneStart, immersiveStart);
const IMMERSIVE = WEB.slice(immersiveStart, stylesStart);
const STYLES = WEB.slice(stylesStart);

console.log('=== A. THE LARGE-TABLET GATE (most likely to be broken by accident) ===');
ok('breakpoint is encoded in exactly one place — three named consts',
  /const LARGE_TABLET_MIN_W = 1000;/.test(WEB) &&
  /const LARGE_TABLET_MIN_H = 700;/.test(WEB) &&
  /const LARGE_TABLET_MAX_SIDE = 1500;/.test(WEB),
  'These three numbers ARE the contract. MIN_H 700 is what separates a full-size iPad from an iPad Mini.');
ok('MIN_H stays 700 — lowering it silently admits iPad Mini, which is NOT locked',
  /LARGE_TABLET_MIN_H = 700;/.test(WEB),
  'iPad Mini landscape usable height is ~654 in iPad Chrome. Admitting it needs Adam, not a constant edit.');
ok('the gate is touch AND not-phone AND viewport-fits',
  /const isTabletWeb = touchDevice && !isPhone && viewportFitsLargeTablet;/.test(WEB));
ok('touchDevice uses maxTouchPoints, not pointer:coarse alone',
  /navigator\.maxTouchPoints \?\? 0\) > 0 \|\| coarsePointer/.test(WEB),
  'A Magic Keyboard/trackpad makes iPadOS report a FINE pointer; coarse-only detection fails on exactly Adam\'s rig.');
ok('the viewport test measures the USABLE window (winW/winH), not screen size',
  /winW >= LARGE_TABLET_MIN_W && winH >= LARGE_TABLET_MIN_H/.test(WEB),
  'iPad browsers spend ~90px of height on chrome; a screen-size threshold is wrong.');
ok('MAX_SIDE still keeps large desktop touch displays out',
  /Math\.max\(winW, winH\) <= LARGE_TABLET_MAX_SIDE/.test(WEB));

console.log('\n=== B. LAYOUT IS NOT DRIVEN BY THE FULLSCREEN API ===');
// This is the load-bearing consequence of the accepted WebKit limitation: iPadOS can
// drop true fullscreen on a downward drag, and the workspace must not go with it.
ok('fsLayout = isFS || isTabletWeb — a tablet gets the immersive layout unconditionally',
  /const fsLayout = isFS \|\| isTabletWeb;/.test(WEB),
  'If the tablet layout ever depends on isFS, a WebKit fullscreen dismiss takes the whole workspace away.');
ok('the immersive branch never gates the tablet layout on isFS alone',
  !/isFS && isTabletWeb/.test(IMMERSIVE),
  'An `isFS && isTabletWeb` condition would reintroduce the dependency fsLayout exists to remove.');

console.log('\n=== C. NO FORBIDDEN FULLSCREEN WORKAROUNDS (explicitly rejected by Adam) ===');
// The WebKit drag-dismiss is an accepted platform limitation, not a defect to hack around.
ok('no touchmove interception anywhere in the web tagger',
  !/touchmove/i.test(WEB),
  'Rejected: breaks momentum scrolling and cannot veto the exit anyway (no cancellable Fullscreen event exists).');
ok('no scrollTop pinning/reset hack',
  !/scrollTop\s*=/.test(WEB),
  'Rejected: pinning scrollTop fights the user instead of the platform.');
ok('no touch-action hack on the tablet scrollers',
  !/isTabletWeb && \{ touchAction/.test(WEB) && !/touchAction: 'none'[^}]*isTabletWeb/.test(WEB),
  'touch-action:none on a tag column would kill the vertical scrolling this lock exists to protect.');
ok('the only touchAction in the file stays scoped to the phone inspect layer',
  (WEB.match(/touchAction/g) || []).length <= 2 && PHONE.includes('touchAction'),
  'touch-action belongs to the locked phone hide/inspect surface only.');

console.log('\n=== D. VIDEO-AS-CANVAS: COLUMNS OVER VIDEO, VIDEO NOT DARKENED ===');
ok('tabBoardClear makes the board container transparent on tablet',
  /tabBoardClear: \{ backgroundColor: 'transparent'/.test(STYLES),
  'The approved look backs the COLUMNS, not the whole video.');
ok('tabCol carries its own translucent backing',
  /tabCol: \{[^}]*backgroundColor: 'rgba\(0,0,0,0\.38\)'/.test(STYLES),
  'Per-column backing is what keeps chips legible without dimming the film.');
ok('the board is applied with tabBoardClear on tablet',
  /isTabletWeb && styles\.tabBoardClear/.test(IMMERSIVE));

console.log('\n=== E. SCROLLING AVAILABILITY — EVERY TAG MUST STAY REACHABLE ===');
ok('tag columns get a definite-height scroll chain on tablet (not a content-sized box)',
  /style=\{isTabletWeb \? styles\.mColScroll : \{ maxHeight:/.test(IMMERSIVE),
  'A content-sized column cannot scroll, which is how tags became unreachable before.');
ok('mColScroll is flex:1 with overscrollBehavior contain',
  /mColScroll: \{ flex: 1, overscrollBehavior: 'contain' \}/.test(STYLES),
  'contain stops a column hitting its end from chaining into the clips rail.');
ok('the horizontal board scroller stretches its columns on tablet',
  /isTabletWeb && styles\.mBoardRowStretch/.test(IMMERSIVE) && /mBoardRowStretch:/.test(STYLES));
ok('tabBoardScroll is flex:1 so the chain has a definite height to divide',
  /tabBoardScroll: \{ flex: 1 \}/.test(STYLES));
ok('the clips rail scrolls independently (overscrollBehavior contain)',
  /tabClipsScroll: \{ overscrollBehavior: 'contain' \}/.test(STYLES),
  'Independent scrolling is part of the approved experience.');
ok('the clips rail applies that style on tablet',
  /isTabletWeb && styles\.tabClipsScroll/.test(WEB));

console.log('\n=== F. SINGLE SHARED CLIPS-PANEL ARCHITECTURE ===');
ok('the duplicate fullscreen clips panel is GONE (one panel, not two)',
  !WEB.includes('fsClips'),
  'A second clips panel is the regression cdc4257 removed: two panels drift apart.');
ok('one real clips panel exists',
  /styles\.clipsPanel/.test(WEB) && /clipsPanel: \{ width: 300/.test(STYLES),
  'The approved tablet layout uses the real 300px panel as a layout column.');
ok('collapsed state renders the thin strip',
  /styles\.clipsStrip/.test(WEB) && /clipsStrip:/.test(STYLES));
ok('the tablet keeps its OWN collapse memory',
  /clipsCollapsedKey = isTabletWeb \? 'iamsports\.tagger\.clipsCollapsed\.tablet'/.test(WEB),
  'Desktop and tablet have different width budgets; sharing one key made the iPad open collapsed.');
ok('absent key means OPEN (starts open, as approved)',
  /getItem\(clipsCollapsedKey\) === '1'/.test(WEB),
  "Comparing to '1' means anything absent is false = open. An inverted default starts it collapsed.");
ok('clips can collapse AND reopen (one toggle, both directions)',
  /toggleClipsCollapsed = \(\) => setClipsCollapsed\(c => \{ const n = !c;/.test(WEB));

console.log('\n=== G. CLIPS EDIT / DELETE STAY AVAILABLE ===');
ok('Edit is present and wired to startEditClip', /onPress=\{\(\) => startEditClip\(c\)\}/.test(WEB));
ok('Delete is present and wired to deleteClipRow', /onPress=\{\(\) => deleteClipRow\(c\.id\)\}/.test(WEB));
ok('tablet shows a full "Delete" word, not the cramped ✕',
  /isTabletWeb \? 'Delete' : '✕'/.test(WEB),
  'Large touch targets with real labels are part of what Adam approved.');
ok('tablet clip controls get the larger hit areas',
  /tabClipBtn: \{[^}]*height: 34/.test(STYLES) && /tabClipJump: \{[^}]*height: 34/.test(STYLES));

console.log('\n=== H. UTILITY RAIL — PRESENCE AND ORDER ===');
// Order is top-to-bottom in the rail: TAG, Save (tablet only), +Grp, ★, !, ✓
const railStart = IMMERSIVE.indexOf('styles.fsRail');
const RAIL = railStart >= 0 ? IMMERSIVE.slice(railStart, railStart + 3200) : '';
ok('the rail exists as its own region', railStart >= 0 && /fsRail:/.test(STYLES));
const order = ['TAG{mBoardFS', 'commitClip', 'addGroup', 'setIsStar', 'setIsPoe', 'setIsGoodPlay'];
let lastAt = -1, ordered = true;
for (const token of order) {
  const at = RAIL.indexOf(token);
  if (at < 0 || at < lastAt) { ordered = false; break; }
  lastAt = at;
}
ok('rail order is TAG → Save → +Grp → ★ → ! → ✓', ordered,
  'Control ORDER is part of the approved muscle memory.');
ok('Save is in the rail on tablet and uses the shared commitClip',
  /isTabletWeb \? \([\s\S]{0,200}onPress=\{commitClip\}/.test(RAIL),
  'This is the existing Save relocated, never a second implementation.');
ok('Save carries the tablet purple, enabled and disabled',
  /canSave \? styles\.tabRailSave : styles\.tabRailSaveOff/.test(RAIL) &&
  /tabRailSave: \{ backgroundColor: '#534AB7'/.test(STYLES) &&
  /tabRailSaveOff: \{ backgroundColor: '#2E2A5C'/.test(STYLES),
  'Opaque disabled fill: a translucent fill over bright video took the label with it.');
ok('+Grp is visible with solid green enabled / dimmer-but-legible disabled',
  /canAddGroup \? styles\.tabRailGroup : styles\.tabRailGroupOff/.test(RAIL) &&
  /tabRailGroup: \{ backgroundColor: '#1D9E75'/.test(STYLES) &&
  /tabRailGroupOff: \{ backgroundColor: '#14543F'/.test(STYLES),
  'At opacity 0.4 over video it read as ABSENT next to TAG/★/!/✓ — that is the regression this prevents.');
ok('+Grp keeps the shared addGroup / canAddGroup / groupCount',
  /onPress=\{addGroup\}/.test(RAIL) && /disabled=\{!canAddGroup\}/.test(RAIL) && /groupCount > 0/.test(RAIL),
  'No second grouping implementation on this surface.');
ok('the phone rail style (mRail) is NOT repurposed for the tablet rail',
  /fsRail:/.test(STYLES) && /mRail:/.test(STYLES),
  'The locked phone frame renders from mRail; the tablet uses its own fsRail.');

console.log('\n=== I. GAME-STATE CONTROLS ARE THE LARGE TREATMENT ===');
ok('period / possession chips take the tablet size',
  /isTabletWeb && styles\.tabChip/.test(IMMERSIVE) && /tabChip: \{ minWidth: 38, height: 34/.test(STYLES));
ok('their labels take the tablet type scale',
  /isTabletWeb && styles\.tabChipTxt/.test(IMMERSIVE) && /tabChipTxt: \{ fontSize: 14 \}/.test(STYLES));
ok('the top strip gets the taller tablet treatment',
  /isTabletWeb && styles\.tabTop/.test(IMMERSIVE) && /tabTop: \{ height: 'auto', minHeight: 60/.test(STYLES));
ok('column headers take the tablet type scale',
  /isTabletWeb && styles\.tabColHead/.test(IMMERSIVE) && /tabColHead: \{ fontSize: 12/.test(STYLES));

console.log('\n=== J. BACK / FULLSCREEN / START / END STAY AVAILABLE ===');
ok('‹ Back is present on tablet (no solid top bar renders there)',
  /isTabletWeb \? <Pressable onPress=\{goBackOrHome\}/.test(IMMERSIVE),
  'Without this the tablet has no way out of the tagger.');
ok('Back uses the shared goBackOrHome', /onPress=\{goBackOrHome\}/.test(IMMERSIVE));
ok('the fullscreen control is present and uses the shared toggleFS',
  /onPress=\{toggleFS\} hitSlop=\{8\} style=\{styles\.mExitFS\}/.test(IMMERSIVE) &&
  /\{isFS \? '⤡' : '⛶'\}/.test(IMMERSIVE),
  'Offered on tablet again (Adam 2026-10-02): a dismiss costs browser chrome, never the workspace.');
ok('toggleFS still uses the standard Fullscreen API',
  /document\.documentElement\.requestFullscreen\?\.\(\)/.test(WEB) && /document\.exitFullscreen\?\.\(\)/.test(WEB));
ok('Start / End mark controls are present in the transport row',
  /onPress=\{markInNow\}/.test(IMMERSIVE) && /onPress=\{markOutNow\}/.test(IMMERSIVE) &&
  /styles\.markStart/.test(IMMERSIVE) && /styles\.markEnd/.test(IMMERSIVE));
ok('scrubber shows saved-clip markers on tablet (no split scrubber exists there)',
  /duration > 0 \? clips\.map/.test(IMMERSIVE),
  'Without these a tablet has nothing showing where the tagged plays are.');

console.log('\n=== K. SHARED SEMANTICS — NO SECOND IMPLEMENTATION ===');
ok('sticky context helpers are still the shared ones',
  /stickyContextCategory/.test(WEB) && /stickyPhaseForCategory/.test(WEB) &&
  /from '@\/lib\/core\/tag-categories'/.test(WEB));
ok('columns still come from the shared sport contract',
  /categoriesForSport/.test(WEB) && /withPlayersColumn/.test(WEB));
ok('tap/group/save handlers are shared, not forked per surface',
  /const tapTag = useCallback/.test(WEB) && /const addGroup = useCallback/.test(WEB) &&
  /const commitClip = useCallback/.test(WEB));

console.log('\n=== L. ISOLATION — PHONE LOCK AND DESKTOP MUST NOT MOVE ===');
ok('the locked phone frame gate is unchanged (<= 500)',
  /const isPhoneFrame = isPhone && Math\.min\(winW, winH\) <= 500;/.test(WEB),
  'Changing this changes the LOCKED mobile-web surface. See docs/MOBILE_WEB_TAGGER_UI_LOCK.md.');
ok('the coarse-pointer touch branch still admits tablets at <= 820',
  /const isPhone = coarsePointer && Math\.min\(winW, winH\) <= 820;/.test(WEB));
ok('the phone branch never reads isTabletWeb', !PHONE.includes('isTabletWeb'),
  'Tablet logic inside the phone branch means this lock is leaking into the locked phone frame.');
ok('tablet overrides are ADDITIVE tab* keys, not edits to shared keys',
  /LARGE-TABLET \(isTabletWeb\) OVERRIDES\. Additive keys only/.test(STYLES),
  'Editing a shared style key changes desktop and phone too.');
ok('the desktop split layout is still reachable (clipsPanel + a non-immersive tree)',
  /\{fsLayout \? \(/.test(WEB) || /!fsLayout/.test(WEB) || /styles\.main/.test(WEB));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail) { console.log('\nFAILURES:\n' + failures.join('\n')); process.exit(1); }

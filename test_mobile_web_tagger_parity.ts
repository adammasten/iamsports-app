// test_mobile_web_tagger_parity.ts
//
// MOBILE WEB (phone browser) tagger parity with the LOCKED native iPhone frame.
// Native contract: docs/NATIVE_IPHONE_TAGGER_UI_LOCK.md (build 76, commit 56da2f2).
//
// NOT a lock. Mobile web is not approved yet -- Adam tests the deployed phone browser
// himself, and only then does it get its own document. These guards exist so the parity
// work cannot silently rot, and so the two things most likely to go wrong stay caught:
//   1. phone-only changes leaking into the tablet or desktop web layouts, and
//   2. the native clip_tags `id` regression being copied into the web query.
//
// app/tagging-overlay.web.tsx serves desktop, tablet browser and phone browser from one
// file, so these are SOURCE assertions in the style of test_export_ecosystem_contract.ts
// and test_native_iphone_tagger_shell_lock.ts.
//
// Run: npx tsx test_mobile_web_tagger_parity.ts
import { readFileSync } from 'node:fs';

const WEB = readFileSync('app/tagging-overlay.web.tsx', 'utf8');
const HTML = readFileSync('app/+html.tsx', 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, why = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${why ? `\n          ${why}` : ''}`); }
}

// The touch-immersive branch runs from `if (isPhone) {` to the comment that opens the
// desktop/tablet return. Everything after it is the desktop tree.
const phoneStart = WEB.indexOf('if (isPhone) {');
const phoneEnd = WEB.indexOf('// FS immersive board columns');
if (phoneStart < 0 || phoneEnd < 0) throw new Error('cannot locate the isPhone branch');
const PHONE = WEB.slice(phoneStart, phoneEnd);
// Desktop tree = after the phone branch, up to the stylesheet. The stylesheet is
// excluded deliberately: it is shared by all three layouts and its comments name the
// phone guard, which is documentation, not a desktop code path.
const stylesStart = WEB.indexOf('const styles = StyleSheet.create({');
if (stylesStart < 0) throw new Error('cannot locate the stylesheet');
const DESKTOP = WEB.slice(phoneEnd, stylesStart);
// The phone bottom rail, isolated, so "is it a scroller?" cannot be confused by the
// tag board's scrollers earlier in the branch.
const bottomStart = PHONE.indexOf('styles.mBottom');
const BOTTOM = bottomStart >= 0 ? PHONE.slice(bottomStart) : '';

console.log('=== A. PHONE GUARD IS EXPLICIT AND NARROW ===');
ok('isPhoneFrame exists as the phone-only parity guard',
  /const isPhoneFrame = isPhone && Math\.min\(winW, winH\) <= 500;/.test(WEB),
  'Parity must be gated to a phone viewport; isPhone alone also matches tablet browsers.');
ok('the touch branch still admits tablet browsers unchanged (<= 820)',
  /const isPhone = coarsePointer && Math\.min\(winW, winH\) <= 820;/.test(WEB),
  'Narrowing isPhone itself would push tablet browsers into the desktop layout.');
ok('immersive layout stays coarse-pointer only (desktop never enters it)',
  /coarsePointer && Math\.min/.test(WEB));

console.log('\n=== B. DESKTOP AND TABLET ISOLATION ===');
ok('the desktop/tablet tree never reads isPhoneFrame', !DESKTOP.includes('isPhoneFrame'),
  'A phone guard in the desktop tree means phone parity is leaking into desktop web.');
ok('the desktop/tablet tree never reads mChromeHidden', !DESKTOP.includes('mChromeHidden'));
ok('the desktop/tablet tree never reads the inspect gesture', !DESKTOP.includes('inspectGesture'));
// Styles shared between the phone branch and the desktop FS path must not be redefined
// for phone use -- phone variants are separate `*Tight` keys.
for (const shared of ['mTBtn', 'mTTxt', 'mMark', 'mMarkTxt', 'mTime', 'mTransport', 'mSave']) {
  ok(`shared style ${shared} has exactly one definition (phone uses a *Tight variant)`,
    (WEB.match(new RegExp(`^  ${shared}: `, 'gm')) || []).length === 1);
}

console.log('\n=== C. PREVIOUS / NEXT ON PHONE BROWSER ===');
ok('tag-nav renders when the video has clips', /clips\.length > 0 \? \(/.test(PHONE));
ok('tag-nav calls jumpToTag both ways',
  /jumpToTag\(-1\)/.test(PHONE) && /jumpToTag\(1\)/.test(PHONE));
ok('tag-nav is labelled like the locked native frame', /'◄ Tag'/.test(PHONE) && /'Tag ►'/.test(PHONE));
ok('tag-nav cannot shrink', /mTagNavTight: \{[^}]*flexShrink: 0/s.test(WEB));
ok('Start/End cannot shrink', /mMarkTight: \{[^}]*flexShrink: 0/s.test(WEB));
ok('the timecode is the elastic element', /mTimeTight: \{[^}]*flexShrink: 1/s.test(WEB));
ok('the phone transport keeps -1s / +1s', /seekBy\(-1\)/.test(PHONE) && /seekBy\(1\)/.test(PHONE));
ok('the phone transport keeps -5s / +5s', /seekBy\(-5\)/.test(PHONE) && /seekBy\(5\)/.test(PHONE));
ok('the phone transport keeps play/pause and speed',
  /togglePlay/.test(PHONE) && /cycleSpeed/.test(PHONE));
ok('the bottom rail is NOT a scroller (Prev/Next must not need discovering)',
  BOTTOM.length > 0 && !BOTTOM.includes('<ScrollView'),
  'The rail is sized to fit one phone row; a scroller would hide primary controls.');

console.log('\n=== D. SAVE CLIP / + GROUP IN ONE ACTION REGION ===');
ok('a single upper-right action region exists', /styles\.mActions/.test(PHONE));
ok('+ Group sits in that region on phone', /isPhoneFrame && !editingId \?/.test(PHONE));
ok('+ Group is withheld from the right rail on phone',
  /!isPhoneFrame && !editingId \?/.test(PHONE),
  'Leaving it in both places is the overlap the native lock exists to prevent.');
ok('the action region cannot shrink', /mActions: \{[^}]*flexShrink: 0/s.test(WEB));

console.log('\n=== E. BOARD MODE RULE (<=5 fixed, 6+ scrolls) ===');
ok('board mode is decided by column count, not by sport',
  /const boardFixed = isPhoneFrame && boardCols\.length <= 5;/.test(PHONE));
ok('the fixed board shares width instead of scrolling', /mColFixed: \{ flex: 1/.test(WEB));
ok('6+ columns still scroll horizontally',
  /horizontal: true,[\s\S]{0,200}contentContainerStyle: \[styles\.mBoardRow/.test(PHONE));

console.log('\n=== F. ONE SHELL, EVERY SPORT ===');
// A sport may pick CONTENT (the reserved DN/DIST/DR slot). It may never pick geometry.
const sportLayoutFork = /(isBasketball|isSoccer|isLacrosse|isBaseball|isVolleyball)/.test(PHONE);
ok('no per-sport mobile-web layout branch', !sportLayoutFork,
  'Every sport must inherit the one canonical phone-browser shell.');
const phoneSportTerms = (PHONE.match(/isFlag|isFootball/g) || []).length;
ok(`sport terms in the phone branch are limited to the reserved slot (${phoneSportTerms} uses)`,
  phoneSportTerms > 0 && phoneSportTerms <= 3,
  'Sport checks beyond the DN/DIST/DR content slot suggest a geometry fork.');
ok('board columns come from the shared sport contract, not a local list',
  /useFlagPhaseBoard[\s\S]{0,120}flatColsWithPlayers/.test(WEB));

console.log('\n=== G. INSPECT ZOOM IS SCOPED AND VIEW-ONLY ===');
ok('the inspect surface mounts only while the chrome is hidden',
  /isPhoneFrame && mChromeHidden \?[\s\S]{0,200}GestureDetector/.test(PHONE));
ok('zoom is bounded at 4x', /const ZOOM_MAX = 4;/.test(WEB));
ok('restoring the chrome resets to 1x', /zScale\.value = withTiming\(1,/.test(WEB));
ok('pan is clamped so the video cannot be dragged away',
  /Math\.min\(mx, Math\.max\(-mx,/.test(WEB));
// touch-action must be scoped to the gesture surface, never applied site-wide.
ok("touchAction:'none' appears exactly once, on the inspect surface",
  (WEB.match(/touchAction: 'none'/g) || []).length === 1);
ok('browser accessibility zoom is NOT disabled site-wide',
  !/user-scalable\s*=\s*no/.test(HTML) && !/maximum-scale/.test(HTML),
  'The viewport meta must keep pinch-zoom available on the rest of the site.');

console.log('\n=== H. THE NATIVE clip_tags LESSON CARRIES FORWARD ===');
ok('the web clips query does NOT request clip_tags.id', !/clip_tags\s*\(\s*id\b/.test(WEB),
  'clip_tags has no id column; requesting it 42703s the whole query and empties the clip list.');
ok('the phone scrubber draws saved-clip markers', /styles\.mMarker/.test(PHONE),
  'Markers are how you see that clips loaded at all -- their absence was the native tell.');

console.log('\n=== I. CONTROL INTERACTION != VIDEO-SURFACE INTERACTION ===');
// Runtime bug 2026-09-29: pressing Play appeared to hide the whole tagger. It was NOT
// propagation -- mobile Safari hands a <video> without the playsinline attribute to its
// own fullscreen player on play(), covering the page. Both halves are guarded here: the
// attribute, and the structural rule that made propagation impossible in the first place.
ok('the phone video sets playsInline (mobile Safari cannot take the screen on play)',
  /<VideoView player=\{player\} playsInline=\{isPhoneFrame\}/.test(PHONE),
  'Without it, play() opens the native fullscreen player and the tagger vanishes behind it.');

// The chrome-toggle surface must own its interaction STRUCTURALLY: no children (so no
// interactive descendant can ever be the event target) and rendered BEFORE every chrome
// container (so controls paint above it and their events bubble to their own ancestors,
// never to a preceding sibling).
// Self-closing check: read from the opening tag to the first `/>`, and require that the
// span contains no nested element. (A simple [^>]* regex trips over the `=>` in onPress.)
const tapOpen = PHONE.indexOf('<Pressable style={styles.mTapLayer}');
const tapClose = tapOpen >= 0 ? PHONE.indexOf('/>', tapOpen) : -1;
const tapDecl = tapOpen >= 0 && tapClose > tapOpen ? PHONE.slice(tapOpen + 1, tapClose) : '';
ok('the chrome-toggle surface is self-closing (it can have no interactive descendant)',
  tapDecl.length > 0 && !tapDecl.includes('<') && !PHONE.slice(tapOpen, tapClose).includes('</Pressable>'),
  'Giving this element children would let a control tap become a surface tap.');
const iTap = PHONE.indexOf('styles.mTapLayer');
for (const container of ['styles.mTop', 'styles.mBoard', 'styles.mRail', 'styles.mBottom']) {
  const i = PHONE.indexOf(container);
  ok(`${container} renders AFTER the chrome-toggle surface (paints above it)`,
    i > 0 && iTap > 0 && i > iTap);
}
// No control may call the chrome toggle. Everything from the top bar onward is chrome.
const CHROME = PHONE.slice(PHONE.indexOf('styles.mTop'));
ok('no tagger control calls the chrome-toggle path', !CHROME.includes('setMChromeHidden'),
  'Play, the transport, chips, the rail, Save and + Group must never hide the tagger.');
ok('chrome is hidden from exactly one place, and restored from exactly one place',
  (PHONE.match(/setMChromeHidden\(true\)/g) || []).length === 1
  && (WEB.match(/runOnJS\(setMChromeHidden\)\(false\)/g) || []).length === 1);
ok('togglePlay only touches the player', /const togglePlay = useCallback\(\(\) => \{ try \{ isPlaying \? player\.pause\(\) : player\.play\(\); \} catch \{\} \}/.test(WEB));

console.log('\n=== J. REAL VISIBLE VIEWPORT ===');
// window.innerHeight is the LAYOUT viewport on mobile browsers and does not shrink for
// the address bar or landscape toolbar, so sizing to it puts the board floor (and the
// last tag in every column) under browser chrome.
ok('the phone frame measures visualViewport', /\(window as any\)\.visualViewport/.test(WEB));
ok('it re-measures on toolbar/zoom change',
  /vv\.addEventListener\('resize', sync\)/.test(WEB) && /vv\.addEventListener\('scroll', sync\)/.test(WEB));
ok('the phone app and video are sized from the visible viewport, not innerHeight',
  /width: phoneW, height: phoneH/.test(PHONE));
ok('phoneW/phoneH fall back to window dimensions when visualViewport is absent',
  /const phoneW = isPhoneFrame && vvSize \? vvSize\.w : winW;/.test(WEB));
ok('pinch clamps use the visible viewport too', !/\(winW \* \(next - 1\)\)/.test(WEB));

console.log('\n=== K. TAG COLUMNS CAN REACH THEIR LAST TAG ===');
ok('the board floor is derived from the MEASURED bottom bar, not a magic number',
  /isPhoneFrame && \{ bottom: mBottomH \+ 4 \}/.test(PHONE) && /onLayout=\{e => \{ const h = Math\.round\(e\.nativeEvent\.layout\.height\)/.test(PHONE));
ok('each column scroller gets a real constrained height (flex, not a guessed maxHeight)',
  /mColScroll: \{ flex: 1/.test(WEB));
ok('the column keeps its own overscroll (the page must not rubber-band instead)',
  /overscrollBehavior: 'contain'/.test(WEB));
ok('the last chip clears the board floor', /mColScrollContent: \{ paddingBottom: \d+ \}/.test(WEB));
ok('columns stretch to the bounded board height',
  /mColFixedPhone: \{[^}]*alignSelf: 'stretch'/.test(WEB) && /mColScrollPhone: \{[^}]*alignSelf: 'stretch'/.test(WEB));
ok('the phone app clips instead of letting the document scroll',
  /isPhoneFrame && \{ width: phoneW, height: phoneH, overflow: 'hidden' \}/.test(PHONE));

console.log('\n=== L. PLAYBACK STATE IS OBSERVED, NEVER ASSUMED ===');
// expo-video's web player discards the video.play() promise and sets playing = true
// regardless, so the transport can claim playback that WebKit refused or stalled.
ok('no non-gesture autoplay on a phone', /!didAutoPlay\.current && !isPhoneFrame/.test(WEB),
  'iOS refuses a play() no user gesture initiated, and the refusal is unobservable.');
ok('the phone transport drives the real <video> element',
  /const togglePlayPhone = useCallback/.test(WEB) && /isPhoneFrame \? togglePlayPhone : togglePlay/.test(PHONE));
ok('the play() promise rejection is caught, logged and surfaced',
  /\.catch\(\(err: any\) => \{[\s\S]{0,200}console\.warn\('\[tagger\] play\(\) rejected:'/.test(WEB)
  && /setPlayBlocked\(/.test(WEB));
ok('the phone icon reflects the element, not the optimistic flag',
  /\(isPhoneFrame \? !domPaused : isPlaying\) \? '❚❚' : '▶'/.test(PHONE));
ok('a blocked play is shown to the user, not swallowed', /styles\.mPlayBlocked/.test(PHONE));

console.log('\n=== M. RIGHT RAIL MATCHES THE LOCKED NATIVE SEMANTICS ===');
const NATIVE = readFileSync('app/tagging-overlay.tsx', 'utf8');
for (const [what, colour] of [['Highlight', '#f5c518'], ['POE', '#DC3545'], ['Good Play border', '#1e8449'], ['Good Play glyph', '#2ecc71']] as [string, string][]) {
  ok(`${what} ${colour} is the colour native uses`, NATIVE.includes(colour),
    'Rail colours are copied from the locked native rail, never invented.');
}
ok('the phone rail applies them (outlined off, filled on)',
  /mRailStar: \{ borderColor: '#f5c518' \}/.test(WEB)
  && /mRailPoeTxt: \{ color: '#DC3545' \}/.test(WEB)
  && /mRailGoodTxt: \{ color: '#2ecc71' \}/.test(WEB));
ok('TAG hide/show stays neutral', !/mRailBtn: \{[^}]*#f5c518/s.test(WEB));

console.log('\n=== N. HIDDEN-INSPECTION RESTORE ===');
// The restore tap used maxDuration(250) against RNGH's own 500ms default. The handler
// arms its fail timer at touch start, so a deliberate 300-400ms press died silently --
// and unlike native there is no Pressable beneath the gesture surface to catch it.
const tapDur = WEB.match(/Gesture\.Tap\(\)\.maxDuration\((\d+)\)/);
ok('tapBack allows at least RNGH\'s default 500ms press',
  !!tapDur && Number(tapDur[1]) >= 500,
  'Below the library default the tap fails on its own timer with nothing to fall back on.');
ok('composition is unchanged: Exclusive(Simultaneous(pinch, drag), tapBack)',
  /return Gesture\.Exclusive\(Gesture\.Simultaneous\(pinch, drag\), tapBack\);/.test(WEB),
  'tapBack must stay LAST so a finger lifted after a pan or pinch can never restore.');
// Only the tap gesture and the chip may restore; nothing else, and neither pan nor pinch.
// Slice each handler exactly, so the window cannot bleed into tapBack's declaration.
const iPinch = WEB.indexOf('const pinch = Gesture.Pinch()');
const iDrag = WEB.indexOf('const drag = Gesture.Pan()');
const iTapBack = WEB.indexOf('const tapBack = Gesture.Tap()');
const PINCH_BODY = iPinch >= 0 && iDrag > iPinch ? WEB.slice(iPinch, iDrag) : '';
const DRAG_BODY = iDrag >= 0 && iTapBack > iDrag ? WEB.slice(iDrag, iTapBack) : '';
ok('pan completion cannot restore the chrome',
  DRAG_BODY.length > 0 && !DRAG_BODY.includes('setMChromeHidden'),
  'Lifting a finger after panning must never bring the tagger back.');
ok('pinch completion cannot restore the chrome',
  PINCH_BODY.length > 0 && !PINCH_BODY.includes('setMChromeHidden'));
ok('no auto-restore when zoom returns to 1x', !/zScale\.value === 1[\s\S]{0,120}setMChromeHidden/.test(WEB));
ok('exactly two restore paths exist (the tap gesture and the chip)',
  (WEB.match(/setMChromeHidden\)\(false\)/g) || []).length
  + (WEB.match(/setMChromeHidden\(false\)/g) || []).length === 2);

// The chip: present only while hidden, above the gesture surface, outside the transform.
const iGesture = PHONE.indexOf('<GestureDetector gesture={inspectGesture}>');
const iRestore = PHONE.indexOf('styles.mRestore');
ok('a restore chip exists while the chrome is hidden',
  /isPhoneFrame && mChromeHidden \? \([\s\S]{0,260}styles\.mRestore/.test(PHONE));
ok('the restore chip renders AFTER the GestureDetector (so it takes the touch)',
  iGesture > 0 && iRestore > 0 && iRestore > iGesture,
  'Rendered before it, the inspection surface would swallow the chip.');
ok('the restore chip is absent while the chrome is visible',
  !/!mChromeHidden \? \([\s\S]{0,200}styles\.mRestore/.test(PHONE));
ok('the restore chip only sets the chrome back',
  /<Pressable onPress=\{\(\) => setMChromeHidden\(false\)\} hitSlop=\{12\} style=\{styles\.mRestore\}>/.test(PHONE));
ok('the restore chip is chrome, not part of the transformed video layer',
  iRestore > PHONE.indexOf('zoomStyle'),
  'Inside the zoom transform it could be panned off screen.');
ok('the chip reaches ~44pt of touch target', /hitSlop=\{12\}/.test(PHONE) && /mRestore: \{[\s\S]{0,200}height: 30/.test(WEB));

console.log('\n=== O. INSPECTION CLAMPS USE ONE VIEWPORT ===');
ok('the pan clamp uses the measured visual viewport, like the pinch clamp',
  /const mx = \(phoneW \* \(zScale\.value - 1\)\) \/ 2, my = \(phoneH \* \(zScale\.value - 1\)\) \/ 2;/.test(WEB),
  'A layout-viewport clamp lets the pan travel further than the pinch clamp intends.');
ok('no inspection clamp still reads the layout viewport',
  !/\(winW \* \(z(Scale|oomScale)\.value - 1\)\)/.test(WEB) && !/\(winW \* \(next - 1\)\)/.test(WEB));

console.log(`\n=== ${fail === 0 ? 'ALL PARITY GUARDS PASS' : 'PARITY BROKEN'} — ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);

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
ok('6+ columns still scroll horizontally', /horizontal: true, contentContainerStyle: styles\.mBoardRow/.test(PHONE));

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

console.log(`\n=== ${fail === 0 ? 'ALL PARITY GUARDS PASS' : 'PARITY BROKEN'} — ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);

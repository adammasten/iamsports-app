// MOBILE WEB TAGGER UI LOCK (Adam, 2026-09-30 — commit 0a5a517). The PHONE-BROWSER path
// (isPhoneFrame) is locked: contract + regression checklist in
// docs/MOBILE_WEB_TAGGER_UI_LOCK.md, guarded by test_mobile_web_tagger_parity.ts.
// Tablet browser and desktop share this file and are NOT locked — keep phone changes
// behind isPhoneFrame and add new style keys rather than editing shared ones.
// Do not change locked phone geometry or interactions without explicit product-owner
// approval for the specific element.
//
// WEB tagging studio (Metro serves this on web; native keeps tagging-overlay.tsx).
// A desktop "button-matrix" tagger: centered player + scrubber on the left, the
// FULL tag board across the bottom (all tags always visible), a build-then-commit
// tray, and a live clip list on the right. Keyboard-first. Reuses the exact
// clips/clip_tags insert contract as native (bundle_number 0 = clip-level; star/POE
// are the "★ Highlight" / "POE" special tags), so exports/filters stay valid.
// See docs/WEB_TAGGING_STUDIO_PLAN.md + docs/tagging-studio-prototype.html.
import { useTeamContext } from '@/context';
import { loadHiddenTagIds } from '@/lib/core/hiddenTags';
import { periodsForSport } from '@/lib/core/periods';
import { isFootballSport } from '@/lib/core/upload-meta';
import { categoriesForSport, phasesForSport, withPlayersColumn, displayPhaseForSport,
  stickyContextCategory,
  stickyPhaseForCategory, usesSharedPlayersPlacement, FALLBACK_FLAT_COLUMNS } from '@/lib/core/tag-categories';
import { applyTagScope } from '@/lib/core/tag-scope';
import {
  type Odk, type FbCtx, type FbSel, ODK_SHORT, isFlagFootball,
  FB_FORMATIONS, FB_PLAY_TYPES, FB_RESULT_OFF, FB_FRONTS, FB_COVERAGES, FB_RESULT_DEF, FB_ST_UNITS, FB_RESULT_ST,
  FLAG_FORMATIONS, FLAG_DEFENSES, FLAG_RESULT_OFF, FLAG_RESULT_DEF,
} from '@/lib/core/football';
import { getCachedPathSync } from '@/lib/native/video-cache';
import { getSignedVideoUrl } from '@/lib/native/video-url';
import { supabase } from '@/supabase';
import { goBackOrHome } from '@/lib/nav';
import { useEvent } from 'expo';
import { useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

const C = {
  bg: '#0b0c10', panel: '#14161c', panel2: '#1b1e26', line: '#262a34',
  text: '#f2f3f6', dim: '#9096a3', faint: '#5b616e', accent: '#6c5ce7',
  players: '#a78bfa', offense: '#4a90e2', defense: '#e2574a', plays: '#3ec46d',
  made: '#3ec46d', star: '#f5c518', poe: '#ff9f43',
};
const CAT_COLOR: Record<string, string> = {
  players: C.players, offense: C.offense, defense: C.defense, plays: C.plays,
  formation: '#1a6fd4', play: '#1e8449', result: '#6c5ce7',
  // Flag per-phase columns
  off_formation: '#1a6fd4', off_play: '#1e8449', off_result: '#6c5ce7',
  def_scheme: '#c0392b', def_opp_play: '#1a6fd4', def_our_play: '#1e8449', def_result: '#6c5ce7',
  st_play: '#1e8449', st_result: '#6c5ce7',
  // Taxonomy launch columns. Colors are the canonical values from
  // lib/core/tag-categories.ts. off_player_action is green for every sport except
  // baseball/softball, which declare it purple as a merged Result column; this map
  // holds ONE color per key, so it takes the authority green — same as def_scheme,
  // which is red here though baseball/softball declare it blue.
  off_opp_look: '#c0392b', def_opp_formation: '#1a6fd4',
  off_player_action: '#1e8449', st_player_action: '#1e8449',
};
// Event-tag hotkey pool (players use the number row). Reserved keys — space,
// arrows, enter, backspace, and I/O (mark In/Out) — are never in here.
const EVENT_KEYS = 'QWERTYUPASDFGHJKLZXCVBNM'.split('');
// Playback-speed cycle: normal → 1.2× → 1.5× → 2× → back. One tap-to-cycle chip
// tucked into the transport row (matches the mobile tagger).
const PLAYBACK_SPEEDS = [1, 1.2, 1.5, 2];

// ── LARGE-TABLET TAGGER BREAKPOINT — the only place this is encoded ──────────
// Two INDEPENDENT questions (Adam 2026-10-01), deliberately not collapsed into one:
//   A. is this a touch device?  (see `touchDevice`)
//   B. is the CURRENT USABLE viewport big enough for stage + overlay + 300px clips?
// Both must hold. Numbers are measured against the viewport the BROWSER gives us
// (innerWidth/innerHeight), not screen size — iPad Chrome/Safari spend ~90px of
// height on the address bar, so a screen-size threshold would be wrong.
//
// Landscape usable heights, iPad Chrome (screen height minus ~90px of chrome):
//   iPad Pro 13"  1366 x ~934   -> in
//   iPad 11"      1194 x ~744   -> in
//   iPad 10.9"    1180 x ~730   -> in
//   iPad 9th gen  1080 x ~720   -> in
//   iPad mini     1133 x ~654   -> OUT (height) — tested separately, do not widen
//                                   this to admit it without Adam's say-so.
// MIN_H 700 is what separates the Mini from every full-size iPad. MIN_W 1000 keeps
// portrait iPads out (they have the height but not the width for a 300px panel).
// MAX_SIDE keeps a large desktop touch display out of the tablet layout.
const LARGE_TABLET_MIN_W = 1000;
const LARGE_TABLET_MIN_H = 700;
const LARGE_TABLET_MAX_SIDE = 1500;

type Tag = { id: string; name: string; category: string };
type Built = { id: string; name: string; category: string };
type ClipRow = { id: string; start: number; end: number; groups: { name: string; category: string }[][]; starred: boolean; poe: boolean; goodPlay: boolean; editTags: { id: string; name: string; category: string }[]; fb?: FbSummary | null };
type FbSummary = { odk: Odk; down: number | null; distance: number | null; formation: string | null; play: string | null; defense: string | null; result: string | null; drive: number | null };

function fmt(s: number) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}

// Display order WITHIN a bundle: action first, player last. Adam's rule — a bundle
// should always read "Made 2 · Lars" no matter whether he tapped the player or the
// event first. Actions are offense/defense/plays; players sort to the end. Stable,
// so multiple actions keep their tap order among themselves.
function orderTags<T extends { category: string }>(tags: T[]): T[] {
  return [...tags].sort((a, b) => (a.category === 'players' ? 1 : 0) - (b.category === 'players' ? 1 : 0));
}

// ── Football tagger vocab ──────────────────────────────────────────────
// Football tagging vocabulary + types now live in @/lib/core/football (shared with
// the native tagger so the two never drift). FB_FORMATIONS, FB_PLAY_TYPES,
// FB_RESULT_*, FB_FRONTS, FB_COVERAGES, FB_ST_UNITS, Odk, FbCtx, FbSel, ODK_SHORT.

export default function TaggingStudioWeb() {
  const { userId, activeTeam } = useTeamContext();
  const params = useLocalSearchParams();
  const videoId = (Array.isArray(params.videoId) ? params.videoId[0] : params.videoId) as string;
  const remoteUrl = (Array.isArray(params.url) ? params.url[0] : params.url) as string;
  const label = ((Array.isArray(params.label) ? params.label[0] : params.label) as string) ?? 'Tagging';

  const [teamId, setTeamId] = useState<string | null>(null);
  const [sport, setSport] = useState<string | null>(null);
  const [tags, setTags] = useState<Record<string, Tag[]>>({});
  const [special, setSpecial] = useState<{ highlight: string | null; poe: string | null; goodPlay: string | null }>({ highlight: null, poe: null, goodPlay: null });
  const [periodTags, setPeriodTags] = useState<Tag[]>([]);
  const [activePeriod, setActivePeriod] = useState<string | null>(null);
  // Possession (OFF/DEF/SP) — sticky clip-level stamp, mirrors the period pattern, so
  // export can tell offense from defense/special-teams. Football shows all three.
  const [possessionTags, setPossessionTags] = useState<Tag[]>([]);
  const [activePossession, setActivePossession] = useState<string | null>(null);
  const [clips, setClips] = useState<ClipRow[]>([]);
  const [building, setBuilding] = useState<Built[]>([]);
  const [isStar, setIsStar] = useState(false);
  const [isPoe, setIsPoe] = useState(false);
  // Good Play — third clip-level toggle beside ★/POE. id (special.goodPlay) is null until
  // the phase-boards migration seeds it, so the button hides gracefully pre-migration.
  const [isGoodPlay, setIsGoodPlay] = useState(false);
  // Resizable video/board split. boardHeight = px height of the tag board; the video area
  // (flex:1) absorbs the rest. Drag the handle up → smaller board / bigger video. Persisted.
  const savedBoard = (() => { try { const v = localStorage.getItem('iamsports.tagger.boardHeight'); const n = v ? parseInt(v, 10) : NaN; return Number.isNaN(n) ? null : Math.max(120, n); } catch { return null; } })();
  const [boardHeight, setBoardHeight] = useState<number>(savedBoard ?? 220);
  const [stageH, setStageH] = useState(0);
  const boardLatestRef = useRef(boardHeight);
  const boardDragStartRef = useRef(boardHeight);
  // Measured height of the board's own content (from the ScrollView) — the board is never
  // clamped taller than this, so there's no empty space under the last chip row.
  const [boardContentH, setBoardContentH] = useState(0);
  const boardContentHRef = useRef(0);
  // Once the user has chosen a size (saved value, drag, or nudge) we stop auto-defaulting.
  const boardUserSetRef = useRef(savedBoard != null);
  // Browser fullscreen: on enter, collapse the board to min so the video fills; the drag
  // handle still works; on exit, restore the previous split.
  const [isFS, setIsFS] = useState(false);
  // Phone-sized browser → immersive full-bleed layout that mirrors the native app
  // (desktop web layout unchanged). mBoardFS = tag panel compact vs fullscreen.
  const { width: winW, height: winH } = useWindowDimensions();
  // Immersive layout only on ACTUAL touch devices (coarse pointer) that are phone-sized —
  // never on a desktop with a mouse, even if the window is small. So desktop always gets
  // the resizable split layout.
  const coarsePointer = (() => { try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; } })();
  const isPhone = coarsePointer && Math.min(winW, winH) <= 820;
  // PHONE-BROWSER PARITY GUARD. `isPhone` above is the touch-immersive branch, and its
  // 820 threshold also catches tablet browsers (iPad mini portrait 744, iPad 10.9" 820).
  // Tablet web is reviewed and locked separately, so the native-parity frame is gated to
  // an actual phone viewport and tablet browsers keep the pre-parity rendering untouched.
  // When tablet web gets its own review these two should collapse into one.
  const isPhoneFrame = isPhone && Math.min(winW, winH) <= 500;
  // (A) TOUCH CAPABILITY. `pointer: coarse` / `hover: none` are NOT reliable on an iPad:
  // attach a Magic Keyboard or trackpad and iPadOS reports a FINE, hover-capable pointer,
  // so a media-query-only test silently fails on exactly the setup Adam tags with.
  // maxTouchPoints stays > 0 whatever is plugged in. A desktop Mac reports 0.
  const touchDevice = (() => {
    try { return (navigator.maxTouchPoints ?? 0) > 0 || coarsePointer; } catch { return coarsePointer; }
  })();
  // (B) USABLE VIEWPORT. Re-evaluated on every resize/rotation, so this follows the real
  // window rather than the device — see the breakpoint note at the top of this file.
  const viewportFitsLargeTablet =
    winW >= LARGE_TABLET_MIN_W && winH >= LARGE_TABLET_MIN_H &&
    Math.max(winW, winH) <= LARGE_TABLET_MAX_SIDE;
  // (C) LARGE-TABLET TAGGER LAYOUT = both, and never a phone/small-tablet viewport.
  // Small tablets keep whatever they render today; they are a separate decision.
  const isTabletWeb = touchDevice && !isPhone && viewportFitsLargeTablet;
  // The immersive presentation is used for TRUE browser fullscreen and, unconditionally,
  // on a large tablet. Exiting browser fullscreen on a tablet therefore drops the
  // fullscreen flag but leaves the layout alone — an iPad never falls back into the split.
  const fsLayout = isFS || isTabletWeb;
  // Right clip list can collapse to a thin strip so the video reclaims that 300px.
  // The large-tablet layout keeps its OWN memory of this (Adam 2026-10-01): it must start
  // OPEN there regardless of whether the panel was last collapsed on desktop, and the two
  // layouts have very different width budgets. Absent key -> open.
  const clipsCollapsedKey = isTabletWeb ? 'iamsports.tagger.clipsCollapsed.tablet' : 'iamsports.tagger.clipsCollapsed';
  const [clipsCollapsed, setClipsCollapsed] = useState<boolean>(() => { try { return localStorage.getItem(clipsCollapsedKey) === '1'; } catch { return false; } });
  const toggleClipsCollapsed = () => setClipsCollapsed(c => { const n = !c; try { localStorage.setItem(clipsCollapsedKey, n ? '1' : '0'); } catch {} return n; });
  const [handleHover, setHandleHover] = useState(false);
  const preFSBoardRef = useRef(boardHeight);
  const [markIn, setMarkIn] = useState<number | null>(null);
  const [markOut, setMarkOut] = useState<number | null>(null);
  // While a Start/End window is open, successive Adds append tag GROUPS (bundles)
  // to the SAME clip — matching the phone tagger + export's bundle model — instead
  // of making a new clip each time. Cleared when the window changes.
  // Build-then-commit staging (matches the mobile tagger): "Add group" pushes the
  // current group onto stagedBundles (no DB write); "Save clip" commits the clip +
  // all bundles at once, then resets.
  const [stagedBundles, setStagedBundles] = useState<Built[][]>([]);
  // When set, the board is EDITING an already-committed clip (loaded back in)
  // rather than building a new one. Save writes changes; Cancel exits.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [barWidth, setBarWidth] = useState(0);
  const [speed, setSpeed] = useState(1);
  // Measured pixel size of the video box. On web, expo-video's <video> uses a
  // percentage height that won't resolve against a flex-computed box, so
  // contentFit can't letterbox and the frame stretches. Feeding explicit px
  // dimensions gives it a real box → contentFit="contain" works.
  const [vbox, setVbox] = useState({ w: 0, h: 0 });
  // Chrome hidden -> the video is the inspection surface (native lock section 10).
  const [mChromeHidden, setMChromeHidden] = useState(false);
  // TRUE VISIBLE VIEWPORT. window.innerHeight is the LAYOUT viewport: on mobile Safari
  // and Chrome-iOS it does not shrink for the address bar or the landscape toolbar, so
  // sizing to it pushes the bottom of the tagger (and the bottom of every tag column)
  // underneath browser chrome. visualViewport reports what is actually on screen and
  // fires on every toolbar/keyboard/zoom change. Phone frame only; everything else keeps
  // useWindowDimensions. (iPhone WebKit -- which Chrome for iOS also uses -- has no
  // element Fullscreen API, so this is the only way to reclaim that space; see the
  // fullscreen note in the mobile-web report.)
  const [vvSize, setVvSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const vv: any = typeof window !== 'undefined' ? (window as any).visualViewport : null;
    if (!vv) return;
    const sync = () => setVvSize({ w: Math.round(vv.width), h: Math.round(vv.height) });
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => { vv.removeEventListener('resize', sync); vv.removeEventListener('scroll', sync); };
  }, []);
  const phoneW = isPhoneFrame && vvSize ? vvSize.w : winW;
  const phoneH = isPhoneFrame && vvSize ? vvSize.h : winH;
  // Measured height of the bottom bar, so the tag board's floor is derived from the real
  // chrome rather than a hard-coded guess.
  const [mBottomH, setMBottomH] = useState(78);
  // Measured height of the floating top strip. The large-tablet chips are bigger and can
  // wrap, so the board ceiling is derived from the real strip rather than mBoard's fixed 56.
  const [mTopH, setMTopH] = useState(52);
  // Arms the restore chip. react-native-web's PressResponder fires onPress from a bare
  // DOM `click` with NO preceding pointerdown -- its own source says so -- and iOS
  // dispatches a compatibility click after touchend, hit-tested against whatever occupies
  // those coordinates by then. Without this, a ghost click landing on a freshly mounted
  // chip could restore the chrome on its own. A real press sets this in onPressIn first.
  const restoreArmed = useRef(false);
  const [mBoardFS, setMBoardFS] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false); // brief "Saved ✓" after each clip commits
  // Football situation — sticky, carries forward across clips. fbSel = this clip's
  // single-select descriptors (formation/play/result). Only used when isFootball.
  const [fbCtx, setFbCtx] = useState<FbCtx>({ odk: 'offense', down: 1, distance: 10, drive: 1 });
  const [fbSel, setFbSel] = useState<FbSel>({ formation: null, play: null, defense: null, result: null });

  // ── player ──
  const cachedPath = videoId ? getCachedPathSync(videoId) : null;
  const player = useVideoPlayer(cachedPath, p => { p.pause(); p.timeUpdateEventInterval = 0.5; });
  const { currentTime } = useEvent(player, 'timeUpdate', { currentTime: 0, currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition: 0 });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: false });
  const { duration: srcDuration } = useEvent(player, 'sourceLoad', { duration: 0, videoSource: null, availableVideoTracks: [], availableSubtitleTracks: [], availableAudioTracks: [] });
  const pd = (player as { duration?: number }).duration;
  const duration = srcDuration || (typeof pd === 'number' && Number.isFinite(pd) ? pd : 0);
  const status = useEvent(player, 'statusChange', { status: 'idle', oldStatus: undefined, error: undefined });

  const [videoReady, setVideoReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const retryRef = useRef(0);
  const didAutoPlay = useRef(false);

  const loadSignedSource = useCallback(async () => {
    if (!remoteUrl) { setLoadError(true); return; }
    const signed = await getSignedVideoUrl(remoteUrl, { forceRefresh: true });
    if (signed) { try { player.replace(signed); } catch {} } else { setLoadError(true); }
  }, [remoteUrl, player]);
  useEffect(() => { if (!cachedPath) loadSignedSource(); /* eslint-disable-next-line */ }, []);

  // Mirror game-player: spinner until readyToPlay, bounded auto-retry (re-mint the
  // signed URL) on error, then a tap-to-retry surface — so a cold-load or bad URL
  // is visible instead of a silent black frame.
  useEffect(() => {
    if (status?.status === 'readyToPlay') {
      retryRef.current = 0; setVideoReady(true); setLoadError(false);
      // WEB: start playback on first ready (a manual play right after replace()
      // races the load and aborts — same fix game-player uses). Coach pauses with Space.
      // NOT on a phone: iOS/WebKit refuses a play() that no user gesture initiated, and
      // expo-video's web player ignores the rejected promise while setting playing = true,
      // so the transport ends up showing "playing" over a video parked at 0:00. On a phone
      // the first play must come from the user's own tap (see togglePlayPhone).
      if (!didAutoPlay.current && !isPhoneFrame) { didAutoPlay.current = true; try { player.play(); } catch {} }
      return;
    }
    if (status?.status === 'error') {
      if (retryRef.current < 3) { retryRef.current += 1; const id = setTimeout(() => loadSignedSource(), 2000); return () => clearTimeout(id); }
      setLoadError(true);
    }
  }, [status, loadSignedSource, isPhoneFrame, player]);
  const retryNow = useCallback(() => { retryRef.current = 0; setLoadError(false); setVideoReady(false); loadSignedSource(); }, [loadSignedSource]);

  // ── team + tags + clips ──
  useEffect(() => {
    supabase.from('videos').select('team_id, sport').eq('id', videoId).maybeSingle().then(({ data }) => {
      setTeamId((data?.team_id as string) ?? null);
      setSport((data?.sport as string) ?? null);
    });
  }, [videoId]);

  const tagSport = sport ?? activeTeam?.sport ?? null;
  // Basketball sticky defensive context (Adam, 2026-09-26) — same idea as the football
  // situation strip above, but for ordinary tags. One sticky per PHASE, remembered
  // independently: OFF keeps "Their Defense", DEF keeps "Our Defense". Phase code -> tag id.
  // The sticky id simply survives in `building` across a save, so it lands in the same
  // numbered bundle a hand-tapped chip would. No bundle-0 move, no schema, no export change.
  const [stickyByPhase, setStickyByPhase] = useState<Record<string, string>>({});
  // commitClip is defined ABOVE where displayPhaseCode is computed, so the phase currently on
  // screen is mirrored here for it to read.
  const displayPhaseRef = useRef<string | null>(null);
  // The sticky entries to KEEP selected after a save: this phase's only. Any other phase's
  // sticky is dropped, so a DEF clip can never inherit the OFF look.
  const stickyKeepAfterSave = useCallback((): Built[] => {
    const phase = displayPhaseRef.current;
    if (!phase) return [];
    const cat = stickyContextCategory(tagSport, phase);
    const id = cat ? stickyByPhase[phase] : null;
    if (!cat || !id) return [];
    const t = (tags[cat] ?? []).find(x => x.id === id);
    return t ? [{ id: t.id, name: t.name, category: t.category }] : [];
  }, [tagSport, stickyByPhase, tags]);
  // Format belongs to the team that OWNS this video, which may not be the active
  // team — a coach can sit on Team A while tagging Team B's film, and Team A's
  // format must not bleed across. FAILS OPEN: any failure resolves to null, i.e.
  // the full sport vocabulary. Vocabulary is never hidden by a failed lookup.
  const [teamFormat, setTeamFormat] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!teamId) { setTeamFormat(null); return; }
      if (activeTeam?.id === teamId) { setTeamFormat(activeTeam.format ?? null); return; }
      try {
        const { data, error } = await supabase.from('teams').select('format').eq('id', teamId).maybeSingle();
        if (!cancelled) setTeamFormat(error ? null : ((data as any)?.format ?? null));
      } catch { if (!cancelled) setTeamFormat(null); }
    })();
    return () => { cancelled = true; };
  }, [teamId, activeTeam?.id, activeTeam?.format]);
  const isFootball = isFootballSport(tagSport);   // football uses the 5-column groupable board
  const isFlag = isFlagFootball(tagSport);   // (kept for the retired football board's dead code)
  // RETIRED: the single-select football/flag board. Every sport now uses the groupable
  // tag board (offense/defense/plays/players) so "Add Group / Save Clip" works everywhere
  // — grouping is the whole gig. See CLAUDE.md invariant. false keeps the old board unreachable.
  const useFbBoard = false;

  // Flip the ODK unit → new drive (possession changed); clear this clip's picks.
  const setOdk = useCallback((odk: Odk) => {
    setFbCtx(c => (c.odk === odk ? c : { ...c, odk, drive: c.drive + 1 }));
    setFbSel({ formation: null, play: null, defense: null, result: null });
  }, []);
  const fbPick = useCallback((field: keyof FbSel, val: string) => {
    setFbSel(s => ({ ...s, [field]: s[field] === val ? null : val }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Scoping lives in ONE place — lib/core/tag-scope.ts — shared with the native
      // tagger and My Tags. Team tags are never sport- or format-filtered there.
      const { data } = await applyTagScope(
        supabase.from('tags').select('*').order('sort_order'),
        { sport: tagSport, teamId, format: teamFormat },
      );
      if (cancelled) return;
      // Exclude tags this team has hidden (special tags never appear in the hide UI).
      const hidden = teamId ? await loadHiddenTagIds(teamId).catch(() => new Set<string>()) : new Set<string>();
      if (cancelled) return;
      // Bucket EVERY category returned. The fixed key literal that used to live here
      // silently DROPPED unlisted categories, which is why adding a category meant
      // editing this file. Which columns render is decided by the sport definition.
      const grouped: Record<string, Tag[]> = {};
      let highlight: string | null = null, poe: string | null = null, goodPlay: string | null = null;
      const periods: Tag[] = [];
      const possessions: Tag[] = [];
      (data || []).forEach((t: any) => {
        if (t.category === 'special') {
          if (t.name === '★ Highlight') highlight = t.id;
          else if (t.name === 'POE') poe = t.id;
          else if (t.name === 'Good Play') goodPlay = t.id;
        }
        else if (t.category === 'period') periods.push({ id: t.id, name: t.name, category: t.category });
        else if (t.category === 'possession') possessions.push({ id: t.id, name: t.name, category: t.category });
        else if (!hidden.has(t.id)) (grouped[t.category] ??= []).push({ id: t.id, name: t.name, category: t.category });
      });
      const possOrder = ['Offense', 'Defense', 'Special Teams'];
      possessions.sort((a, b) => possOrder.indexOf(a.name) - possOrder.indexOf(b.name));
      // Names-hidden tagger (a non-member hired to tag): the raw query returns NO
      // player tags — RLS hides the kids' names. Swap in the sanitized jersey-only
      // vocabulary: same REAL tag_ids, only the display label changes, so the owner
      // still gets true player attribution and the tagger never sees a name. For
      // members/owners the RPC raises 'not authorized' → data is null → keep names.
      if (teamId) {
        const { data: hp } = await supabase.rpc('tagger_player_tags', { p_team: teamId });
        if (!cancelled && Array.isArray(hp) && hp.length) {
          grouped.players = (hp as any[]).map(r => ({ id: r.tag_id, name: r.label, category: 'players' }));
        }
      }
      if (cancelled) return;
      setTags(grouped);
      setSpecial({ highlight, poe, goodPlay });
      setPeriodTags(periods);
      setPossessionTags(possessions);
      // DELIBERATELY NO automatic possession selection (Adam, 2026-09-25). This used to do
      // `setActivePossession(prev => prev ?? Offense)`, which meant a clip saved without the
      // coach ever tapping OFF still got an Offense stamp — web wrote possession the coach
      // never chose, unlike native. The OFF board still DISPLAYS by default; that is handled
      // purely by displayPhaseForSport + the first-phase fallback below, which touch no state.
      // activePossession now stays null until the coach taps a phase, and both save paths
      // gate the possession row on it (`if (activePossession) rows.push(...)`).
    })();
    return () => { cancelled = true; };
  }, [teamId, tagSport, teamFormat]);

  const loadClips = useCallback(async () => {
    const { data } = await supabase
      .from('clips')
      .select('id, start_time, end_time, clip_tags ( bundle_number, tags ( id, name, category ) ), clip_football ( odk, down, distance, off_formation, def_front, play_type, result, drive_id )')
      .eq('video_id', videoId)
      .order('start_time', { ascending: false });
    setClips((data || []).map((c: any) => {
      const allTags = (c.clip_tags || []).map((ct: any) => ct.tags).filter(Boolean);
      // Star/POE come from the special tags actually on the clip (the old
      // is_starred columns are dead), so the ★/POE badge finally reflects reality.
      const starred = special.highlight ? allTags.some((t: any) => t.id === special.highlight) : false;
      const poe = special.poe ? allTags.some((t: any) => t.id === special.poe) : false;
      const goodPlay = special.goodPlay ? allTags.some((t: any) => t.id === special.goodPlay) : false;
      // Display groups by bundle — excluding the special star/POE tags (shown as a foot).
      const byBundle = new Map<number, { name: string; category: string }[]>();
      for (const ct of (c.clip_tags || [])) {
        if (!ct.tags || ct.tags.category === 'special') continue;
        const bn = ct.bundle_number ?? 0;
        if (!byBundle.has(bn)) byBundle.set(bn, []);
        byBundle.get(bn)!.push({ name: ct.tags.name, category: ct.tags.category });
      }
      const groups = [...byBundle.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t);
      // Non-special tags, to reload into the board when editing this clip.
      const editTags = allTags.filter((t: any) => t.category !== 'special').map((t: any) => ({ id: t.id, name: t.name, category: t.category }));
      const cfRaw = Array.isArray(c.clip_football) ? c.clip_football[0] : c.clip_football;
      const fb: FbSummary | null = cfRaw ? {
        odk: cfRaw.odk, down: cfRaw.down, distance: cfRaw.distance,
        // Flag: formation = the OFFENSE's formation (off_formation), defense = the DEFENSE's
        // call (def_front) — both stored unconditionally. Tackle: formation = whichever of
        // off_formation / def_front is set (its old single-formation-per-side model).
        formation: isFlag ? (cfRaw.off_formation ?? null) : (cfRaw.off_formation ?? cfRaw.def_front ?? null),
        play: cfRaw.play_type ?? null,
        defense: isFlag ? (cfRaw.def_front ?? null) : null,
        result: cfRaw.result ?? null,
        drive: cfRaw.drive_id ?? null,
      } : null;
      return { id: c.id, start: c.start_time, end: c.end_time, starred, poe, goodPlay, groups, editTags, fb };
    }));
  }, [videoId, special, isFlag]);
  useEffect(() => { loadClips(); }, [loadClips]);

  // ── hotkey assignment (players → number row; events → letter pool) ──
  const hotkeys = useMemo(() => {
    const map: Record<string, string> = {};   // tagId → key
    (tags.players ?? []).forEach((t, i) => { if (i < 10) map[t.id] = String((i + 1) % 10); });
    let ki = 0;
    (['offense', 'defense', 'plays'] as const).forEach(cat => {
      (tags[cat] ?? []).forEach(t => { if (ki < EVENT_KEYS.length) map[t.id] = EVENT_KEYS[ki++]; });
    });
    return map;
  }, [tags]);

  // ── player controls ──
  const togglePlay = useCallback(() => { try { isPlaying ? player.pause() : player.play(); } catch {} }, [player, isPlaying]);
  // ── PHONE: drive the real <video> element, and believe only what it reports. ──
  // expo-video's web player calls video.play() and DISCARDS the promise, then sets
  // playing = true unconditionally (VideoPlayer.web.js play() and replace()). So when
  // WebKit refuses or stalls the play, nothing in the JS layer knows and the transport
  // shows a pause icon over a video that never moved. Talking to the element gives us the
  // promise, so a refusal is surfaced instead of faked, and el.paused becomes the single
  // source of truth for the icon. expo-video listens to the element's own play/pause
  // events, so driving it directly keeps the player's state in sync rather than bypassing it.
  const videoHostRef = useRef<any>(null);
  const [domPaused, setDomPaused] = useState(true);
  const [playBlocked, setPlayBlocked] = useState<string | null>(null);
  const videoEl = useCallback((): any => {
    try { return videoHostRef.current?.querySelector?.('video') ?? null; } catch { return null; }
  }, []);
  // Resample on every tick and on every reported playback change, so the icon tracks
  // reality even when the stall or the resume happened outside our control.
  useEffect(() => {
    const el = videoEl();
    if (el) setDomPaused(!!el.paused);
  }, [currentTime, isPlaying, videoReady, videoEl]);
  const togglePlayPhone = useCallback(() => {
    const el = videoEl();
    if (!el) { togglePlay(); return; }
    if (el.paused) {
      setPlayBlocked(null);
      let p: any;
      try { p = el.play(); } catch (e: any) { p = Promise.reject(e); }
      if (p && typeof p.then === 'function') {
        p.then(() => setDomPaused(false)).catch((err: any) => {
          console.warn('[tagger] play() rejected:', err?.name, err?.message);
          setDomPaused(true);
          setPlayBlocked(err?.name === 'NotAllowedError' ? 'Tap play again to start playback' : (err?.message || 'Playback failed'));
        });
      } else setDomPaused(false);
    } else {
      el.pause();
      setDomPaused(true);
    }
  }, [videoEl, togglePlay]);
  const cycleSpeed = useCallback(() => {
    setSpeed(s => PLAYBACK_SPEEDS[(PLAYBACK_SPEEDS.indexOf(s) + 1) % PLAYBACK_SPEEDS.length]);
  }, []);
  const seekBy = useCallback((d: number) => { try { player.currentTime = Math.max(0, Math.min(duration || 0, (player.currentTime || 0) + d)); } catch {} }, [player, duration]);
  // Jump the playhead to the previous/next saved clip's start (parity with native ◄Tag/Tag►).
  const jumpToTag = useCallback((dir: 1 | -1) => {
    if (!clips.length) return;
    const starts = clips.map(c => c.start).sort((a, b) => a - b);
    const t = player.currentTime || 0;
    let target: number | undefined;
    if (dir > 0) target = starts.find(s => s > t + 0.05);
    else for (let i = starts.length - 1; i >= 0; i--) { if (starts[i] < t - 0.05) { target = starts[i]; break; } }
    if (target != null) { try { player.currentTime = target; } catch {} }
  }, [clips, player]);
  const seekToX = useCallback((x: number) => { if (barWidth <= 0 || duration <= 0) return; try { player.currentTime = Math.max(0, Math.min(duration, (x / barWidth) * duration)); } catch {} }, [player, barWidth, duration]);

  // ── build-then-commit ──
  const tapTag = useCallback((t: Tag) => {
    // Sticky categories (basketball Their Defense / Our Defense) REPLACE rather than
    // accumulate, so a clip can never carry two defenses. Tapping the lit chip again still
    // deselects it, exactly like any other chip.
    const stickySlot = stickyPhaseForCategory(tagSport, t.category);
    if (stickySlot) {
      // ONE predicate drives both updates. Deselecting requires the chip to be BOTH the
      // remembered sticky AND currently lit: after "+ Group" the sticky is remembered while
      // the group is empty, and tapping it then must RE-SELECT it, not silently wipe the
      // memory (which would drop the context from the following clip).
      const deselecting = stickyByPhase[stickySlot] === t.id && building.some(b => b.id === t.id);
      setBuilding(prev => {
        const without = prev.filter(b => b.category !== t.category);
        return deselecting ? without : [...without, { id: t.id, name: t.name, category: t.category }];
      });
      setStickyByPhase(prev => {
        const next = { ...prev };
        if (deselecting) delete next[stickySlot]; else next[stickySlot] = t.id;
        return next;
      });
      return;
    }
    setBuilding(prev => prev.some(b => b.id === t.id) ? prev.filter(b => b.id !== t.id) : [...prev, { id: t.id, name: t.name, category: t.category }]);
  }, [tagSport, stickyByPhase, building]);
  // Explicit Clear (button / Backspace) means CLEAR: the sticky defensive context goes too,
  // otherwise the next save would silently resurrect a chip the coach just switched off.
  const clearBuilding = useCallback(() => { setBuilding([]); setStagedBundles([]); setIsStar(false); setIsPoe(false); setIsGoodPlay(false); setMarkIn(null); setMarkOut(null); setStickyByPhase({}); }, []);
  // After committing a group, clear only the tags/flags — KEEP the Start/End
  // window and the open clip so the next Add stacks another GROUP on the SAME
  // clip (e.g. Neo steal, then Neo fouled). A new window / Clear / Backspace
  // starts a fresh clip.
  // Setting a new Start or End begins a new window → a new clip.
  const markInNow = useCallback(() => { setMarkIn(player.currentTime || 0); }, [player]);
  const markOutNow = useCallback(() => { setMarkOut(player.currentTime || 0); }, [player]);
  // Tap a saved clip on the right → jump the video to its start and play.
  const jumpToClip = useCallback((startSec: number) => {
    try { player.currentTime = Math.max(0, startSec); player.play(); } catch {}
  }, [player]);

  // Edit a committed clip: reload it into the board (tags lit, window set,
  // ★/POE reflected). Note: this flattens a multi-group clip into one group.
  const startEditClip = useCallback((c: ClipRow) => {
    setEditingId(c.id);
    setBuilding(c.editTags.map(t => ({ id: t.id, name: t.name, category: t.category })));
    setMarkIn(c.start); setMarkOut(c.end);
    setIsStar(c.starred); setIsPoe(c.poe); setIsGoodPlay(c.goodPlay);
    setStagedBundles([]);
    // Reload the football breakdown onto the situation strip + board so editing
    // reflects (and can change) what was tagged.
    if (c.fb) {
      setFbCtx(cur => ({ odk: c.fb!.odk, down: c.fb!.down, distance: c.fb!.distance, drive: c.fb!.drive ?? cur.drive }));
      setFbSel({ formation: c.fb.formation, play: c.fb.play, defense: c.fb.defense, result: c.fb.result });
    }
    try { player.currentTime = Math.max(0, c.start); } catch {}
  }, [player]);
  const cancelEdit = useCallback(() => {
    setEditingId(null); setBuilding([]); setIsStar(false); setIsPoe(false); setIsGoodPlay(false); setMarkIn(null); setMarkOut(null);
  }, []);
  const deleteClipRow = useCallback(async (id: string) => {
    if (typeof window !== 'undefined' && !window.confirm('Delete this clip? This can’t be undone.')) return;
    await supabase.from('clip_tags').delete().eq('clip_id', id);
    await supabase.from('clips').delete().eq('id', id);
    if (editingId === id) cancelEdit();
    loadClips();
  }, [editingId, cancelEdit, loadClips]);

  // Stage the current group as a bundle; start a fresh group. LOCAL only (no DB).
  // ★/POE are per-CLIP (applied at Save), so they are NOT cleared here.
  const addGroup = useCallback(() => {
    if (building.length === 0 || editingId) return;
    setStagedBundles(b => [...b, building]);
    setBuilding([]);
  }, [building, editingId]);

  const removeStagedBundle = useCallback((idx: number) => {
    setStagedBundles(b => b.filter((_, i) => i !== idx));
  }, []);

  const commitClip = useCallback(async () => {
    if (saving || !userId) return;
    const useMarks = markIn != null && markOut != null && markOut > markIn;
    // Flag situation stamp: odk derived from the OFF/DEF/SP phase pick.
    const possName = possessionTags.find(p => p.id === activePossession)?.name;
    const fbOdk = possName === 'Defense' ? 'defense' : possName === 'Special Teams' ? 'kicking' : 'offense';

    // EDIT MODE: overwrite the existing clip's window + tags (flattened to one group
    // + clip-level ★/POE). Replaces all clip_tags for the clip.
    if (editingId) {
      // A football clip may have no player tags, so don't require a build group there.
      if (building.length === 0 || !useMarks) return;
      setSaving(true);
      await supabase.from('clips').update({ start_time: markIn as number, end_time: markOut as number }).eq('id', editingId);
      await supabase.from('clip_tags').delete().eq('clip_id', editingId);
      const rows: { clip_id: string; tag_id: string; bundle_number: number }[] = building.map(b => ({ clip_id: editingId, tag_id: b.id, bundle_number: 1 }));
      if (isStar && special.highlight) rows.push({ clip_id: editingId, tag_id: special.highlight, bundle_number: 0 });
      if (isPoe && special.poe) rows.push({ clip_id: editingId, tag_id: special.poe, bundle_number: 0 });
      if (isGoodPlay && special.goodPlay) rows.push({ clip_id: editingId, tag_id: special.goodPlay, bundle_number: 0 });
      if (activePeriod) rows.push({ clip_id: editingId, tag_id: activePeriod, bundle_number: 0 });
      if (activePossession) rows.push({ clip_id: editingId, tag_id: activePossession, bundle_number: 0 });
      if (rows.length) await supabase.from('clip_tags').insert(rows);
      if (isFlag) {
        const { error: cfErr } = await supabase.from('clip_football').upsert(
          { clip_id: editingId, odk: fbOdk, down: fbCtx.down, distance: fbCtx.distance, drive_id: fbCtx.drive },
          { onConflict: 'clip_id' });
        if (cfErr) console.warn('[clip_football] situation save skipped:', cfErr.message);
      }
      setSaving(false);
      setEditingId(null);
      setBuilding(stickyKeepAfterSave()); setStagedBundles([]); setIsStar(false); setIsPoe(false); setIsGoodPlay(false); setMarkIn(null); setMarkOut(null);
      loadClips();
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1600);
      return;
    }

    // NEW CLIP: commit every bundle (staged + the current un-added group) at once.
    // Requires an explicit Start+End window. bundle_number: clip-level=0, groups=1,2,3…
    if (!useMarks) return;
    const bundles = [...stagedBundles, ...(building.length > 0 ? [building] : [])];
    // Basketball needs at least one tag group; a football clip can be just the
    // ODK breakdown (no player tags), so it may save with no bundles.
    if (bundles.length === 0) return;
    setSaving(true);
    const { data: clip, error } = await supabase
      .from('clips')
      .insert({ video_id: videoId, team_id: teamId, created_by_user_id: userId, start_time: markIn as number, end_time: markOut as number, note: '' })
      .select().single();
    if (error || !clip) { setSaving(false); return; }
    const rows: { clip_id: string; tag_id: string; bundle_number: number }[] = [];
    bundles.forEach((grp, i) => grp.forEach(b => rows.push({ clip_id: clip.id, tag_id: b.id, bundle_number: i + 1 })));
    if (isStar && special.highlight) rows.push({ clip_id: clip.id, tag_id: special.highlight, bundle_number: 0 });
    if (isPoe && special.poe) rows.push({ clip_id: clip.id, tag_id: special.poe, bundle_number: 0 });
    if (isGoodPlay && special.goodPlay) rows.push({ clip_id: clip.id, tag_id: special.goodPlay, bundle_number: 0 });
    if (activePeriod) rows.push({ clip_id: clip.id, tag_id: activePeriod, bundle_number: 0 });
    if (activePossession) rows.push({ clip_id: clip.id, tag_id: activePossession, bundle_number: 0 });
    if (rows.length) await supabase.from('clip_tags').insert(rows);
    if (isFlag) {
      const { error: cfErr } = await supabase.from('clip_football')
        .insert({ clip_id: clip.id, odk: fbOdk, down: fbCtx.down, distance: fbCtx.distance, drive_id: fbCtx.drive });
      if (cfErr) console.warn('[clip_football] situation save skipped:', cfErr.message);
    }
    setSaving(false);
    // Ordinary tags clear; the sticky defensive context for the phase on screen stays lit, so
    // the next clip needs zero extra taps for it.
    setMarkIn(null); setMarkOut(null); setBuilding(stickyKeepAfterSave()); setStagedBundles([]); setIsStar(false); setIsPoe(false); setIsGoodPlay(false);
    if (isFlag) {
      // Carry the situation forward: a first down / TD / turnover resets to 1st & 10,
      // else the down bumps (distance held). The coach can always tap to correct it.
      const scoredNames = ['First down', 'Touchdown', 'Passing TD', 'Rushing TD', '2-pt conversion',
        'First down allowed', 'TD allowed', 'Turnover', 'Interception'];
      const scored = bundles.some(g => g.some(b => scoredNames.includes(b.name)));
      setFbCtx(c => ({ ...c, down: scored ? 1 : Math.min(4, (c.down ?? 1) + 1), distance: scored ? 10 : c.distance }));
    }
    loadClips();
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1600);
  }, [building, stagedBundles, saving, userId, videoId, teamId, isStar, isPoe, isGoodPlay, special, markIn, markOut, editingId, loadClips, fbCtx, isFlag, activePeriod, activePossession, possessionTags, stickyKeepAfterSave]);

  // Latest-commit ref, assigned DURING RENDER (not in an effect). Space/arrows
  // worked because they only touch the stable `player`; Enter called a stale
  // commitClip frozen at the empty-startup state, so it saw building.length===0
  // and bailed. A ref written during render is immune to that + to React
  // Compiler memoization, so Enter always runs the CURRENT commitClip.
  const commitRef = useRef(commitClip);
  commitRef.current = commitClip;

  // ── keyboard (web only — this file is .web.tsx) ──
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    onKeyRef.current = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (e.key === ' ') { e.preventDefault(); togglePlay(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); seekBy(-1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); seekBy(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); seekBy(5); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); seekBy(-5); return; }
      if (e.key === 'Enter') { e.preventDefault(); commitRef.current(); return; }
      if (e.key === 'Backspace') { e.preventDefault(); clearBuilding(); return; }
      if (e.key === '[') { e.preventDefault(); jumpToTag(-1); return; }
      if (e.key === ']') { e.preventDefault(); jumpToTag(1); return; }
      const k = e.key.toUpperCase();
      if (k === 'I') { e.preventDefault(); markInNow(); return; }
      if (k === 'O') { e.preventDefault(); markOutNow(); return; }
      for (const cat of ['players', 'offense', 'defense', 'plays'] as const) {
        const hit = (tags[cat] ?? []).find(t => hotkeys[t.id] === k);
        if (hit) { e.preventDefault(); tapTag(hit); return; }
      }
    };
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyRef.current(e);
    // CAPTURE phase: run before any focused element (a Pressable/button) can
    // handle Enter first and swallow it — that's why Enter wasn't committing.
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, []);

  const toggleFS = useCallback(() => {
    try {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
    } catch {}
  }, []);
  // Sync layout to browser fullscreen: entering collapses the board to its min (the
  // floating overlay takes over); exiting restores the split you had before. The clips
  // panel is NOT hidden either way — it is one real layout column in both presentations.
  useEffect(() => {
    const onFsChange = () => {
      const fs = !!document.fullscreenElement;
      setIsFS(fs);
      if (fs) {
        preFSBoardRef.current = boardLatestRef.current;
        boardLatestRef.current = 120;
        setBoardHeight(120);
      } else {
        const p = preFSBoardRef.current;
        boardLatestRef.current = p;
        setBoardHeight(p);
        try { localStorage.setItem('iamsports.tagger.boardHeight', String(Math.round(p))); } catch {}
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Apply playback rate; re-assert once the video is ready (rate can reset on load).
  useEffect(() => {
    if (!videoReady) return;
    try { player.playbackRate = speed; } catch {}
  }, [speed, videoReady, player]);

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const builtSet = new Set(building.map(b => b.id));
  const scrub = Gesture.Pan().minDistance(0)
    .onBegin(e => runOnJS(seekToX)(e.x))
    .onUpdate(e => runOnJS(seekToX)(e.x));

  // ── Inspect zoom (phone browser, chrome hidden) — mirrors the locked native
  //    behaviour. VIEW ONLY: a CSS transform on the video layer. No source video,
  //    crop, clip, timestamp, tag, export, highlight, upload or metadata is touched,
  //    and nothing is persisted. Bounded 1x..4x, pan clamped so the frame can never
  //    be dragged away, and restoring the chrome animates back to 1x centred.
  const ZOOM_MAX = 4;
  const zScale = useSharedValue(1);
  const zSavedScale = useSharedValue(1);
  const zX = useSharedValue(0);
  const zY = useSharedValue(0);
  const zSavedX = useSharedValue(0);
  const zSavedY = useSharedValue(0);
  const zoomStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: zX.value }, { translateY: zY.value }, { scale: zScale.value }],
  }));
  useEffect(() => {
    if (mChromeHidden) return;
    zScale.value = withTiming(1, { duration: 180 });
    zX.value = withTiming(0, { duration: 180 });
    zY.value = withTiming(0, { duration: 180 });
    zSavedScale.value = 1; zSavedX.value = 0; zSavedY.value = 0;
  }, [mChromeHidden, zScale, zX, zY, zSavedScale, zSavedX, zSavedY]);
  const inspectGesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .onUpdate(e => {
        'worklet';
        const next = Math.min(ZOOM_MAX, Math.max(1, zSavedScale.value * e.scale));
        zScale.value = next;
        const mx = (phoneW * (next - 1)) / 2, my = (phoneH * (next - 1)) / 2;
        zX.value = Math.min(mx, Math.max(-mx, zX.value));
        zY.value = Math.min(my, Math.max(-my, zY.value));
      })
      .onEnd(() => { 'worklet'; zSavedScale.value = zScale.value; zSavedX.value = zX.value; zSavedY.value = zY.value; });
    const drag = Gesture.Pan()
      .averageTouches(true)
      .onUpdate(e => {
        'worklet';
        const mx = (phoneW * (zScale.value - 1)) / 2, my = (phoneH * (zScale.value - 1)) / 2;
        zX.value = Math.min(mx, Math.max(-mx, zSavedX.value + e.translationX));
        zY.value = Math.min(my, Math.max(-my, zSavedY.value + e.translationY));
      })
      .onEnd(() => { 'worklet'; zSavedX.value = zX.value; zSavedY.value = zY.value; });
    const tapBack = Gesture.Tap().maxDuration(500)
      .onEnd((_e, success) => { 'worklet'; if (success) runOnJS(setMChromeHidden)(false); });
    return Gesture.Exclusive(Gesture.Simultaneous(pinch, drag), tapBack);
  }, [phoneW, phoneH, zScale, zX, zY, zSavedScale, zSavedX, zSavedY]);

  // Resizable split: drag the handle to size the board. Up = smaller board / bigger video.
  // Clamp so the video area stays ≥200px and the board ≥120px (reserve ≈340 for video+controls).
  const beginBoardDrag = () => { boardUserSetRef.current = true; boardDragStartRef.current = boardLatestRef.current; };
  // Board can grow until the video area would drop below ~200px; if the stage isn't
  // measured yet, allow a generous max so it never feels stuck.
  const maxBoardH = () => (stageH > 0 ? Math.max(140, stageH - 260) : 600);
  // ONE clamp used everywhere: never past the video reserve (maxBoardH), never taller than the
  // board's own content, never below the 120 min.
  const clampBoard = (h: number) => Math.min(maxBoardH(), boardContentH || Infinity, Math.max(120, h));
  const applyBoardDrag = (translationY: number) => {
    // Handle sits ABOVE the board: drag DOWN (translationY > 0) → shrink board / grow video.
    const next = clampBoard(boardDragStartRef.current - translationY);
    boardLatestRef.current = next;
    setBoardHeight(next);
  };
  const saveBoardHeight = () => { try { localStorage.setItem('iamsports.tagger.boardHeight', String(Math.round(boardLatestRef.current))); } catch {} };
  // Tap-to-nudge the split (in case the drag isn't discovered). − = smaller board / bigger
  // video; + = bigger board. Same clamp as the drag; persists.
  const nudgeBoard = (delta: number) => {
    boardUserSetRef.current = true;
    const next = clampBoard(boardLatestRef.current + delta);
    boardLatestRef.current = next;
    setBoardHeight(next);
    saveBoardHeight();
  };
  // When the content height first measures or changes (e.g. phase switch / resize), re-clamp
  // the current board height so a stale persisted value can't leave it taller than its content.
  useEffect(() => {
    setBoardHeight(prev => { const c = clampBoard(prev); boardLatestRef.current = c; return c; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardContentH, stageH]);
  const boardResize = Gesture.Pan()
    .onBegin(() => runOnJS(beginBoardDrag)())
    .onUpdate(e => runOnJS(applyBoardDrag)(e.translationY))
    .onEnd(() => runOnJS(saveBoardHeight)());
  const inPct = markIn != null && duration > 0 ? (markIn / duration) * 100 : null;
  const outPct = markOut != null && duration > 0 ? (markOut / duration) * 100 : null;
  const hasWindow = markIn != null && markOut != null && markOut > markIn;
  const groupCount = stagedBundles.length + (building.length > 0 ? 1 : 0);
  const canAddGroup = building.length > 0 && !saving && !editingId;
  const canSave = !saving && (editingId ? (building.length > 0 && hasWindow) : (hasWindow && groupCount > 0));
  const windowLabel = (markIn != null || markOut != null)
    ? `${markIn != null ? fmt(markIn) : '—'} → ${markOut != null ? fmt(markOut) : '—'}`
    : 'Mark Start + End';

  const tagButton = (t: Tag, cat: string) => {
    const on = builtSet.has(t.id);
    const col = CAT_COLOR[cat] ?? C.dim;
    return (
      <Pressable key={t.id} focusable={false} onPress={() => tapTag(t)} style={[styles.chip, { borderColor: on ? col : col + 'aa', backgroundColor: on ? col : col + '1c' }]}>
        {cat === 'players' && hotkeys[t.id] ? <Text style={[styles.chipKey, on && { color: '#1a1030' }]}>{hotkeys[t.id]}</Text> : null}
        <Text style={[styles.chipTxt, { color: on ? '#0a1210' : C.text }]} numberOfLines={1}>{t.name}</Text>
        {cat !== 'players' && hotkeys[t.id] ? <Text style={[styles.chipKey, on && { color: '#1a1030' }]}>{hotkeys[t.id]}</Text> : null}
      </Pressable>
    );
  };

  const category = (key: string, title: string, grow?: boolean) => (
    <View style={[styles.catCol, grow && { flex: 1 }]}>
      <View style={styles.catHead}><View style={[styles.cdot, { backgroundColor: CAT_COLOR[key] ?? C.dim }]} /><Text style={[styles.catTitle, { color: CAT_COLOR[key] ?? C.dim }]}>{title}</Text></View>
      <View style={styles.chipWrap}>{(tags[key] ?? []).map(t => tagButton(t, key))}</View>
    </View>
  );

  // Football board column — single-select chips filling one clip_football field.
  // Same chip styling as the basketball board (styles.chip), so it feels identical.
  const FB_COL_COLOR: Record<keyof FbSel, string> = { formation: C.offense, play: C.plays, defense: C.defense, result: C.accent };
  const fbCategory = (field: keyof FbSel, title: string, options: string[]) => {
    const col = FB_COL_COLOR[field];
    return (
      <View style={[styles.catCol, { flex: 1 }]}>
        <View style={styles.catHead}><View style={[styles.cdot, { backgroundColor: col }]} /><Text style={[styles.catTitle, { color: col }]}>{title}</Text></View>
        <View style={styles.chipWrap}>
          {options.map(opt => {
            const on = fbSel[field] === opt;
            return (
              <Pressable key={opt} focusable={false} onPress={() => fbPick(field, opt)} style={[styles.chip, { borderColor: on ? col : col + 'aa', backgroundColor: on ? col : col + '1c' }]}>
                <Text style={[styles.chipTxt, { color: on ? '#0a1210' : C.text }]} numberOfLines={1}>{opt}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  };

  // Period selector: the sport's periods (basketball → Q1..Q4, 1H, 2H), mapped to
  // the loaded global period tags. Only periods whose tag exists render, so a
  // visible button always has a real tag_id. Sticky + mutually exclusive; the
  // active period auto-stamps every saved clip (clip-level, bundle 0).
  const sportPeriods = periodsForSport(tagSport)
    .map(name => periodTags.find(p => p.name === name))
    .filter(Boolean) as Tag[];

  // Possession options: football gets OFF/DEF/SP; other sports get OFF/DEF only.
  // Narrowed by the OWNING team's format (5v5 flag has no Special Teams phase).
  const sportPhases = phasesForSport(tagSport, teamFormat);
  // Phase chips must match the phases this sport+format actually offers, or a 5v5
  // flag team would still see an SP button that opens an empty/fallback board. For a
  // PHASED sport the phase list is authoritative; a flat sport keeps the previous
  // rule exactly (so basketball, football and 7-on-7 are untouched).
  const allowedPossessionNames = new Set((sportPhases ?? []).map(p => p.possessionTag));
  const possOptions = possessionTags.filter(p => sportPhases
    ? allowedPossessionNames.has(p.name)
    : (isFootball || p.name !== 'Special Teams'));
  const possShort = (name: string) => (name === 'Offense' ? 'OFF' : name === 'Defense' ? 'DEF' : 'SP');

  // Board columns come from the ONE shared sport definition (tag-categories.ts).
  // A PHASED sport (football family) swaps in the active OFF/DEF/SP phase's columns;
  // if that phase has no tags yet we fall back to the flat football board exactly as
  // before, so it never renders blank.
  // PLAYERS PLACEMENT IS UNCHANGED and deliberately differs from native: last on the
  // phase board, FIRST on the flat board. That divergence is a separately-locked item.
  const PLAYERS_COL = { key: 'players', label: 'Players' };
  const activePossName = possessionTags.find(p => p.id === activePossession)?.name;
  const activePhaseCode = sportPhases && activePossName
    ? (sportPhases.find(p => p.possessionTag === activePossName)?.code ?? null)
    : null;
  // Which phase's COLUMNS to draw. `displayPhaseForSport` supplies a sport's declared
  // default (basketball / soccer / lacrosse / baseball / softball); the football family
  // declares none, so web falls back to the sport's FIRST phase to keep showing exactly the
  // board it showed before the automatic possession selection was removed. DISPLAY ONLY —
  // neither branch writes activePossession, so nothing is stamped until the coach taps.
  const displayPhaseCode = displayPhaseForSport(tagSport, activePhaseCode) ?? sportPhases?.[0]?.code ?? null;
  displayPhaseRef.current = displayPhaseCode;

  // Sticky context follows the phase on screen: switching OFF<->DEF swaps which sticky chip is
  // lit, never merges them. The other phase's sticky leaves the group (its column is not even
  // rendered); this phase's re-lights.
  useEffect(() => {
    if (!displayPhaseCode || !stickyContextCategory(tagSport, displayPhaseCode)) return;
    const keepId = stickyByPhase[displayPhaseCode] ?? null;
    const otherIds = new Set(
      Object.entries(stickyByPhase).filter(([ph]) => ph !== displayPhaseCode).map(([, id]) => id));
    setBuilding(prev => {
      const without = otherIds.size ? prev.filter(b => !otherIds.has(b.id)) : prev;
      if (keepId && !without.some(b => b.id === keepId)) {
        const cat = stickyContextCategory(tagSport, displayPhaseCode)!;
        const t = (tags[cat] ?? []).find(x => x.id === keepId);
        if (t) return [...without, { id: t.id, name: t.name, category: t.category }];
      }
      return without.length === prev.length ? prev : without;
    });
    // Syncs on PHASE CHANGE only — tapTag already maintains `building` for a pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayPhaseCode, tagSport]);

  // Sticky context is per VIDEO / tagging session — a different video starts clean, so nothing
  // leaks between games and no storage layer is needed.
  useEffect(() => { setStickyByPhase({}); }, [videoId]);
  const flagPhaseCols = displayPhaseCode
    ? categoriesForSport(tagSport, displayPhaseCode).map(c => ({ key: c.key, label: c.label }))
    : null;
  const flagPhaseHasTags = !!flagPhaseCols && flagPhaseCols.some(c => (tags[c.key]?.length ?? 0) > 0);
  // Phase columns WITH Players placed by the shared definition — the same call the native
  // tagger makes, so the two surfaces cannot drift. ORDERING ONLY; computed once and
  // reused by both the phone and desktop board branches below.
  const phaseColsWithPlayers = flagPhaseCols
    ? withPlayersColumn(tagSport, flagPhaseCols, PLAYERS_COL)
    : null;
  const useFlagPhaseBoard = !!sportPhases && flagPhaseHasTags;
  // Flat board (non-phased sport, or a phase with no tags yet).
  const flatCols = (sportPhases ? FALLBACK_FLAT_COLUMNS : categoriesForSport(tagSport))
    .map(c => ({ key: c.key, label: c.label }));
  // Players placement on the FLAT board. A flat sport that OPTS IN via `playersBefore`
  // (volleyball) uses the shared rule, so native and web agree on its column order. Anything
  // that does not opt in — `_default`, unknown sports, and a phased sport falling back to the
  // legacy columns — keeps the historical Players-FIRST arrangement byte-identical.
  // ORDERING ONLY: no style, width, geometry or scrolling change.
  const flatColsWithPlayers = usesSharedPlayersPlacement(tagSport)
    ? withPlayersColumn(tagSport, flatCols, PLAYERS_COL)
    : [PLAYERS_COL, ...flatCols];

  // ── MOBILE BROWSER: immersive full-bleed layout mirroring the native app. Reuses
  //    every handler + the same top-bar arrangement; desktop layout (below) unchanged. ──
  if (isPhone) {
    const boardCols = useFlagPhaseBoard
      ? phaseColsWithPlayers!
      : flatColsWithPlayers;
    return (
      <GestureHandlerRootView style={[styles.mApp, isPhoneFrame && { width: phoneW, height: phoneH, overflow: 'hidden' }]}>
        <Animated.View ref={videoHostRef} style={[{ position: 'absolute', top: 0, left: 0, width: phoneW, height: phoneH }, isPhoneFrame && zoomStyle]} pointerEvents="none">
          {/* playsInline is what stops mobile Safari from yanking the video into its own
              fullscreen player on play() — which looked exactly like the tagger hiding
              itself. expo-video forwards this straight to the <video> element and has no
              default. Phone-frame only; tablet browsers keep their current behaviour. */}
          <VideoView player={player} playsInline={isPhoneFrame} style={{ width: phoneW, height: phoneH }} nativeControls={false} contentFit="contain" />
        </Animated.View>
        {!videoReady ? <View style={styles.mLoad}><ActivityIndicator color="#fff" size="large" /></View> : null}

        {/* CONTROL INTERACTION != VIDEO-SURFACE INTERACTION. This is the ONLY thing that
            hides the chrome, and the rule is structural, not a runtime target check: the
            element has no children, and every control (top bar, board, rail, bottom rail)
            renders AFTER it and therefore paints above it. A tap on Play, a chip or the
            scrubber lands on that control and bubbles to its own ancestors — it can never
            reach a preceding sibling. Do not give this element children, and do not move
            it after the chrome. Phone-browser only. */}
        {isPhoneFrame && !mChromeHidden ? (
          <Pressable style={styles.mTapLayer} onPress={() => setMChromeHidden(true)} />
        ) : null}
        {/* Inspection surface — mounted ONLY while the chrome is hidden, so pinch and pan
            can never reach a tag chip, the rail, the scrubber or the transport. touchAction
            'none' is scoped to THIS element so browser/page accessibility zoom is untouched
            everywhere else on the site. */}
        {isPhoneFrame && mChromeHidden ? (
          <GestureDetector gesture={inspectGesture}>
            <Animated.View style={[styles.mTapLayer, { touchAction: 'none' } as any]} />
          </GestureDetector>
        ) : null}
        {/* Guaranteed way back. A clean tap anywhere also restores, but that tap can be
            lost to gesture arbitration or to a press the tap handler judges too long, and
            on web there is no Pressable beneath to catch it (native keeps one). This chip
            is chrome, not video: it renders AFTER the gesture surface so it takes the
            touch directly, and it lives outside the transformed layer so no amount of
            zoom or pan can carry it off screen. It only sets the chrome back. */}
        {isPhoneFrame && mChromeHidden ? (
          <Pressable
            onPressIn={() => { restoreArmed.current = true; }}
            onPress={() => {
              // A bare ghost click arrives with no onPressIn, so it finds this unarmed
              // and is ignored. Consume the arm either way so it can never carry over.
              const armed = restoreArmed.current;
              restoreArmed.current = false;
              if (armed) setMChromeHidden(false);
            }}
            hitSlop={12}
            style={styles.mRestore}
          >
            <Text style={styles.mRestoreTxt}>TAG ↑</Text>
          </Pressable>
        ) : null}

        {/* top bar: back + quarters/OFF-DEF-SP/DN-DIST-DR + the upper-right action region */}
        {isPhoneFrame && mChromeHidden ? null : (
        <View style={styles.mTop}>
          <Pressable onPress={goBackOrHome} hitSlop={10}><Text style={styles.mBack}>‹</Text></Pressable>
          <View style={styles.mClusters}>
            {sportPeriods.map(p => { const on = activePeriod === p.id; return (
              <Pressable key={p.id} onPress={() => setActivePeriod(on ? null : p.id)} style={[styles.mChip, on && styles.mChipOn]}><Text style={[styles.mChipTxt, on && styles.mChipTxtOn]}>{p.name}</Text></Pressable>
            ); })}
            {possOptions.length > 0 ? <View style={styles.mSep} /> : null}
            {possOptions.map(p => { const on = activePossession === p.id; return (
              <Pressable key={p.id} onPress={() => setActivePossession(on ? null : p.id)} style={[styles.mChip, on && styles.mChipOn]}><Text style={[styles.mChipTxt, on && styles.mChipTxtOn]}>{possShort(p.name)}</Text></Pressable>
            ); })}
            {isFlag ? (
              <Fragment>
                <View style={styles.mSep} />
                <Text style={styles.mLbl}>DN</Text>
                {[1, 2, 3, 4].map(d => (
                  <Pressable key={d} onPress={() => setFbCtx(c => ({ ...c, down: d }))} style={[styles.mChip, fbCtx.down === d && styles.mChipOn]}><Text style={[styles.mChipTxt, fbCtx.down === d && styles.mChipTxtOn]}>{d}</Text></Pressable>
                ))}
                <Text style={styles.mLbl}>DIST</Text>
                <Pressable onPress={() => setFbCtx(c => ({ ...c, distance: Math.max(0, (c.distance ?? 0) - 1) }))} style={styles.mChip}><Text style={styles.mChipTxt}>–</Text></Pressable>
                <Text style={styles.mNum}>{fbCtx.distance ?? '—'}</Text>
                <Pressable onPress={() => setFbCtx(c => ({ ...c, distance: (c.distance ?? 0) + 1 }))} style={styles.mChip}><Text style={styles.mChipTxt}>+</Text></Pressable>
                <Text style={styles.mLbl}>DR</Text>
                <Pressable onPress={() => setFbCtx(c => ({ ...c, drive: Math.max(1, c.drive - 1) }))} style={styles.mChip}><Text style={styles.mChipTxt}>–</Text></Pressable>
                <Text style={styles.mNum}>{fbCtx.drive}</Text>
                <Pressable onPress={() => setFbCtx(c => ({ ...c, drive: c.drive + 1 }))} style={styles.mChip}><Text style={styles.mChipTxt}>+</Text></Pressable>
              </Fragment>
            ) : null}
          </View>
          {/* ONE upper-right action region: + Group then Save clip, Save far-right — the
              same arrangement the locked native frame uses, so they cannot overlap. On a
              tablet browser + Group stays in the right rail (pre-parity behaviour). */}
          <View style={styles.mActions}>
            {isPhoneFrame && !editingId ? (
              <Pressable onPress={addGroup} disabled={!canAddGroup} style={[styles.mGroup, !canAddGroup && { opacity: 0.4 }]}>
                <Text style={styles.mGroupTxt}>+ Group{groupCount > 0 ? ` ${groupCount}` : ''}</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={commitClip} disabled={!canSave} style={[styles.mSave, !canSave && { opacity: 0.4 }]}><Text style={styles.mSaveTxt}>{saving ? '…' : editingId ? 'Save' : groupCount > 0 ? `${isPhoneFrame ? 'Save clip' : 'Save'} (${groupCount})` : isPhoneFrame ? 'Save clip' : 'Save'}</Text></Pressable>
            {isFS ? <Pressable onPress={toggleFS} hitSlop={8} style={styles.mExitFS}><Text style={styles.mExitFSTxt}>⤡</Text></Pressable> : null}
          </View>
        </View>
        )}

        {/* Tag board. Locked board-mode rule: <=5 columns render fixed (no horizontal
            scroll), 6+ scroll horizontally rather than being crushed. TAG toggle grows it. */}
        {isPhoneFrame && mChromeHidden ? null : (() => {
        const boardFixed = isPhoneFrame && boardCols.length <= 5;
        const Wrap: any = boardFixed ? View : ScrollView;
        const wrapProps = boardFixed
          ? { style: [styles.mBoardRowFixed, isPhoneFrame && styles.mBoardRowPhone] }
          : {
              horizontal: true,
              style: isPhoneFrame ? styles.mBoardScrollPhone : undefined,
              contentContainerStyle: [styles.mBoardRow, isPhoneFrame && styles.mBoardRowStretch],
            };
        return (
        <View style={[styles.mBoard, mBoardFS && styles.mBoardFS, isPhoneFrame && { bottom: mBottomH + 4 }]}>
          <Wrap {...wrapProps}>
            {boardCols.map(c => (
              <View key={c.key} style={[boardFixed ? styles.mColFixed : styles.mCol, isPhoneFrame && (boardFixed ? styles.mColFixedPhone : styles.mColScrollPhone)]}>
                <Text style={[styles.mColHead, { color: CAT_COLOR[c.key] ?? C.dim }]}>{c.label.toUpperCase()}</Text>
                <ScrollView
                  style={isPhoneFrame ? styles.mColScroll : { maxHeight: mBoardFS ? Math.round(winH * 0.62) : 118 }}
                  contentContainerStyle={isPhoneFrame ? styles.mColScrollContent : undefined}
                  showsVerticalScrollIndicator={false}
                >
                  <View style={styles.mChipsWrap}>{(tags[c.key] ?? []).map(t => tagButton(t, c.key))}</View>
                </ScrollView>
              </View>
            ))}
          </Wrap>
        </View>
        ); })()}

        {/* right rail: TAG size toggle + star/POE/GoodPlay. On a phone + Group has moved
            to the top-bar action region (locked native frame); tablet browsers keep it here. */}
        {isPhoneFrame && mChromeHidden ? null : (
        <View style={styles.mRail}>
          {/* PHONE: mChromeHidden is the one authoritative visible/hidden state, so TAG
              enters the SAME inspection mode the free-space tap does. mBoardFS is bypassed
              here -- the board floor is derived from the measured bottom bar now, so its
              compact/fullscreen distinction no longer changes anything on a phone. The
              label is a fixed ↓ because this rail only exists while the chrome is visible.
              TABLET/DESKTOP: untouched, still the mBoardFS board-size toggle. */}
          <Pressable
            onPress={() => (isPhoneFrame ? setMChromeHidden(true) : setMBoardFS(f => !f))}
            style={styles.mRailBtn}
          >
            <Text style={styles.mRailTxt}>TAG{isPhoneFrame ? '↓' : (mBoardFS ? '↓' : '↑')}</Text>
          </Pressable>
          {!isPhoneFrame && !editingId ? <Pressable onPress={addGroup} disabled={!canAddGroup} style={[styles.mRailBtn, !canAddGroup && { opacity: 0.4 }]}><Text style={styles.mRailTxt}>+Grp{groupCount > 0 ? ` ${groupCount}` : ''}</Text></Pressable> : null}
          {/* Semantic colours copied from the locked native rail: Highlight #f5c518,
              POE #DC3545, Good Play border #1e8449 / glyph #2ecc71. Inactive is the
              outlined form, active fills. TAG stays neutral. Phone frame only. */}
          <Pressable onPress={() => setIsStar(s => !s)} style={[styles.mRailBtn, isPhoneFrame && styles.mRailStar, isStar && { backgroundColor: C.star, borderColor: C.star }]}><Text style={[styles.mRailTxt, isPhoneFrame && styles.mRailStarTxt, isStar && { color: '#1a1030' }]}>★</Text></Pressable>
          <Pressable onPress={() => setIsPoe(p => !p)} style={[styles.mRailBtn, isPhoneFrame && styles.mRailPoe, isPoe && { backgroundColor: '#DC3545', borderColor: '#DC3545' }]}><Text style={[styles.mRailTxt, isPhoneFrame && styles.mRailPoeTxt, isPoe && { color: '#fff' }]}>!</Text></Pressable>
          {special.goodPlay ? <Pressable onPress={() => setIsGoodPlay(g => !g)} style={[styles.mRailBtn, isPhoneFrame && styles.mRailGood, isGoodPlay && { backgroundColor: '#1e8449', borderColor: '#1e8449' }]}><Text style={[styles.mRailTxt, isPhoneFrame && styles.mRailGoodTxt, isGoodPlay && { color: '#fff' }]}>✓</Text></Pressable> : null}
        </View>
        )}

        {/* bottom: scrubber + transport + mark */}
        {isPhoneFrame && mChromeHidden ? null : (
        <View style={styles.mBottom} onLayout={e => { const h = Math.round(e.nativeEvent.layout.height); if (h > 0 && h !== mBottomH) setMBottomH(h); }}>
          {isPhoneFrame && playBlocked ? (
            <Text style={styles.mPlayBlocked} numberOfLines={1}>{playBlocked}</Text>
          ) : null}
          <GestureDetector gesture={scrub}>
            <View style={styles.scrubTouch} onLayout={e => setBarWidth(e.nativeEvent.layout.width)}>
              <View style={styles.scrubTrack}>
                {inPct != null && outPct != null ? <View style={[styles.inOutBand, { left: `${inPct}%`, width: `${Math.max(0, outPct - inPct)}%` }]} /> : null}
                <View style={[styles.scrubFill, { width: `${Math.round(progress * 100)}%` }]} />
                {/* Saved-clip markers, as on the locked native scrubber: you can see where
                    the tagged plays are, and their absence is the first sign clips failed
                    to load at all. Visual only — the pan gesture still owns the bar. */}
                {isPhoneFrame && duration > 0 ? clips.map(c => {
                  const l = (c.start / duration) * 100;
                  const w = Math.max(0.4, ((c.end - c.start) / duration) * 100);
                  const active = currentTime >= c.start && currentTime <= c.end;
                  return (
                    <View
                      key={c.id}
                      pointerEvents="none"
                      style={[styles.mMarker, { left: `${Math.min(l, 100 - w)}%`, width: `${w}%` },
                        (c.starred || c.poe) && { backgroundColor: C.star },
                        active && { opacity: 1 }]}
                    />
                  );
                }) : null}
              </View>
            </View>
          </GestureDetector>
          {/* Locked native arrangement, three zones:
              TIME -5s -1s play +1s +5s speed | [space] | ◄ Tag  Tag ► | Start  End
              Only the timecode may give up width, so Prev/Next and Start/End can never be
              pushed off-row and never need a scroller to discover. Tablet browsers keep
              the pre-parity row unchanged. */}
          <View style={[styles.mTransport, isPhoneFrame && styles.mTransportTight]}>
            <Text style={[styles.mTime, isPhoneFrame && styles.mTimeTight]} numberOfLines={isPhoneFrame ? 1 : undefined}>{fmt(currentTime)} / {fmt(duration)}</Text>
            <Pressable onPress={() => seekBy(-5)} style={[styles.mTBtn, isPhoneFrame && styles.mTBtnTight]}><Text style={styles.mTTxt}>−5s</Text></Pressable>
            {isPhoneFrame ? <Pressable onPress={() => seekBy(-1)} style={[styles.mTBtn, styles.mTBtnTight]}><Text style={styles.mTTxt}>−1s</Text></Pressable> : null}
            <Pressable onPress={isPhoneFrame ? togglePlayPhone : togglePlay} style={[styles.mTBtn, isPhoneFrame && styles.mTBtnTight, styles.mPlay]}><Text style={styles.mTTxt}>{(isPhoneFrame ? !domPaused : isPlaying) ? '❚❚' : '▶'}</Text></Pressable>
            {isPhoneFrame ? <Pressable onPress={() => seekBy(1)} style={[styles.mTBtn, styles.mTBtnTight]}><Text style={styles.mTTxt}>+1s</Text></Pressable> : null}
            <Pressable onPress={() => seekBy(5)} style={[styles.mTBtn, isPhoneFrame && styles.mTBtnTight]}><Text style={styles.mTTxt}>+5s</Text></Pressable>
            <Pressable onPress={cycleSpeed} style={[styles.mTBtn, isPhoneFrame && styles.mTBtnTight, speed !== 1 && styles.tSpeedOn]}><Text style={[styles.mTTxt, speed !== 1 && styles.tSpeedOnTxt]}>{speed}×</Text></Pressable>
            {isPhoneFrame ? <View style={{ flex: 1 }} /> : null}
            {clips.length > 0 ? (
              <Fragment>
                <Pressable onPress={() => jumpToTag(-1)} style={[styles.mTBtn, isPhoneFrame && styles.mTagNavTight]}><Text style={styles.mTTxt}>{isPhoneFrame ? '◄ Tag' : '◄'}</Text></Pressable>
                <Pressable onPress={() => jumpToTag(1)} style={[styles.mTBtn, isPhoneFrame && styles.mTagNavTight]}><Text style={styles.mTTxt}>{isPhoneFrame ? 'Tag ►' : '►'}</Text></Pressable>
              </Fragment>
            ) : null}
            {isPhoneFrame ? null : <View style={{ flex: 1 }} />}
            <Pressable onPress={markInNow} style={[styles.mMark, isPhoneFrame && styles.mMarkTight, { borderColor: C.made }, markIn != null && { backgroundColor: C.made }]}><Text style={[styles.mMarkTxt, isPhoneFrame && styles.mMarkTxtTight]} numberOfLines={isPhoneFrame ? 1 : undefined}>{markIn != null ? `${isPhoneFrame ? 'Start' : 'In'} ${fmt(markIn)}` : isPhoneFrame ? 'Start' : 'In'}</Text></Pressable>
            <Pressable onPress={markOutNow} style={[styles.mMark, isPhoneFrame && styles.mMarkTight, { borderColor: C.poe }, markOut != null && { backgroundColor: C.poe }]}><Text style={[styles.mMarkTxt, isPhoneFrame && styles.mMarkTxtTight]} numberOfLines={isPhoneFrame ? 1 : undefined}>{markOut != null ? `${isPhoneFrame ? 'End' : 'Out'} ${fmt(markOut)}` : isPhoneFrame ? 'End' : 'Out'}</Text></Pressable>
          </View>
        </View>
        )}
      </GestureHandlerRootView>
    );
  }

  // FS immersive board columns — the SAME set the non-FS desktop board shows below,
  // just floated over the video. Computed unconditionally (used only inside {fsLayout}).
  const boardCols = useFlagPhaseBoard
    ? phaseColsWithPlayers!
    : flatColsWithPlayers;

  return (
    <GestureHandlerRootView style={styles.app}>
      {/* top bar — hidden in the full-screen / large-tablet layout; the translucent
          floating strip inside the overlay replaces it */}
      {!fsLayout && (
      <View style={styles.topbar}>
        <Pressable onPress={goBackOrHome} hitSlop={10}><Text style={styles.back}>‹ Back</Text></Pressable>
        <Text style={styles.gameLabel} numberOfLines={1}>{label}</Text>
        {sportPeriods.length > 0 && (
          <View style={styles.periodRow}>
            {sportPeriods.map(p => {
              const on = activePeriod === p.id;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setActivePeriod(on ? null : p.id)}
                  style={[styles.periodBtn, on && styles.periodBtnOn]}
                >
                  <Text style={[styles.periodTxt, on && styles.periodTxtOn]}>{p.name}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
        {possOptions.length > 0 && (
          <View style={[styles.periodRow, { marginLeft: 12 }]}>
            {possOptions.map(p => {
              const on = activePossession === p.id;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setActivePossession(on ? null : p.id)}
                  style={[styles.periodBtn, on && styles.periodBtnOn]}
                >
                  <Text style={[styles.periodTxt, on && styles.periodTxtOn]}>{possShort(p.name)}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
        {isFlag && (
          <View style={[styles.periodRow, { marginLeft: 12, gap: 4 }]}>
            <Text style={styles.fbStripLbl}>DN</Text>
            {[1, 2, 3, 4].map(d => (
              <Pressable key={d} onPress={() => setFbCtx(c => ({ ...c, down: d }))} style={[styles.periodBtn, fbCtx.down === d && styles.periodBtnOn]}>
                <Text style={[styles.periodTxt, fbCtx.down === d && styles.periodTxtOn]}>{d}</Text>
              </Pressable>
            ))}
            <Text style={[styles.fbStripLbl, { marginLeft: 6 }]}>DIST</Text>
            <Pressable onPress={() => setFbCtx(c => ({ ...c, distance: Math.max(0, (c.distance ?? 0) - 1) }))} style={styles.periodBtn}><Text style={styles.periodTxt}>–</Text></Pressable>
            <Text style={styles.fbStripNum}>{fbCtx.distance ?? '—'}</Text>
            <Pressable onPress={() => setFbCtx(c => ({ ...c, distance: (c.distance ?? 0) + 1 }))} style={styles.periodBtn}><Text style={styles.periodTxt}>+</Text></Pressable>
            <Text style={[styles.fbStripLbl, { marginLeft: 6 }]}>DR</Text>
            <Pressable onPress={() => setFbCtx(c => ({ ...c, drive: Math.max(1, c.drive - 1) }))} style={styles.periodBtn}><Text style={styles.periodTxt}>–</Text></Pressable>
            <Text style={styles.fbStripNum}>{fbCtx.drive}</Text>
            <Pressable onPress={() => setFbCtx(c => ({ ...c, drive: c.drive + 1 }))} style={styles.periodBtn}><Text style={styles.periodTxt}>+</Text></Pressable>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <Pressable onPress={toggleFS} style={styles.modeBtn}><Text style={styles.modeTxt}>{isFS ? '⤡ Exit full screen' : '⛶ Full screen'}</Text></Pressable>
        <View style={styles.autosave}><View style={styles.saveDot} /><Text style={styles.autosaveTxt}>{saving ? 'Saving…' : savedFlash ? 'Saved ✓' : 'Auto-saves each clip'}</Text></View>
      </View>
      )}

      <View style={styles.main}>
        {/* left stage */}
        <View style={styles.stage} onLayout={e => {
          const h = e.nativeEvent.layout.height; setStageH(h);
          // Default split until the user picks a size: board ~30% of the stage so the
          // video keeps at least half the height. The board scrolls for the rest.
          if (!boardUserSetRef.current && h > 0) {
            const def = Math.min(Math.max(120, Math.round(h * 0.3)), Math.max(140, h - 260));
            boardLatestRef.current = def; setBoardHeight(def);
          }
        }}>
          <View
            style={styles.videoWrap}
            onLayout={e => setVbox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
          >
            {/* Explicit measured px size (not absoluteFill) so the <video> gets a
                real box on web and contentFit="contain" letterboxes instead of
                stretching to this wide/short area. */}
            <VideoView player={player} style={{ width: vbox.w, height: vbox.h }} nativeControls={false} contentFit="contain" />
            {!videoReady ? (
              <Pressable style={styles.videoOverlay} onPress={loadError ? retryNow : undefined}>
                {loadError
                  ? <Text style={styles.overlayTxt}>Couldn&apos;t load this video — tap to retry</Text>
                  : <ActivityIndicator color="#fff" size="large" />}
              </Pressable>
            ) : null}
          </View>

          {/* FS IMMERSIVE (desktop full screen): floating chrome layered over the SAME
              VideoView above — it is never remounted, so playback survives the toggle.
              Mirrors the mobile branch's arrangement + reuses its styles. Authorized by
              Adam 2026-09-10 (LOCKED-layout override, fullscreen state only). */}
          {fsLayout && (
            <View style={styles.fsOverlay} pointerEvents="box-none">
              {/* translucent floating top strip (replaces the solid 52px band) */}
              <View
                style={[styles.mTop, isTabletWeb && styles.tabTop]}
                onLayout={e => { const h = Math.round(e.nativeEvent.layout.height); if (h > 0 && h !== mTopH) setMTopH(h); }}
              >
                {/* A tablet lives in this layout permanently, so the way OUT of the tagger
                    has to be here — the solid top bar that normally carries ‹ Back is not
                    rendered. Desktop full screen still exits to that bar, so it keeps only
                    the ⤡ control and is unchanged. */}
                {isTabletWeb ? <Pressable onPress={goBackOrHome} hitSlop={10}><Text style={styles.mBack}>‹</Text></Pressable> : null}
                <Pressable onPress={toggleFS} hitSlop={8} style={styles.mExitFS}><Text style={styles.mExitFSTxt}>{isFS ? '⤡' : '⛶'}</Text></Pressable>
                <View style={styles.mClusters}>
                  {sportPeriods.map(p => { const on = activePeriod === p.id; return (
                    <Pressable key={p.id} onPress={() => setActivePeriod(on ? null : p.id)} style={[styles.mChip, isTabletWeb && styles.tabChip, on && styles.mChipOn]}><Text style={[styles.mChipTxt, isTabletWeb && styles.tabChipTxt, on && styles.mChipTxtOn]}>{p.name}</Text></Pressable>
                  ); })}
                  {possOptions.length > 0 ? <View style={styles.mSep} /> : null}
                  {possOptions.map(p => { const on = activePossession === p.id; return (
                    <Pressable key={p.id} onPress={() => setActivePossession(on ? null : p.id)} style={[styles.mChip, isTabletWeb && styles.tabChip, on && styles.mChipOn]}><Text style={[styles.mChipTxt, isTabletWeb && styles.tabChipTxt, on && styles.mChipTxtOn]}>{possShort(p.name)}</Text></Pressable>
                  ); })}
                  {isFlag ? (
                    <Fragment>
                      <View style={styles.mSep} />
                      <Text style={[styles.mLbl, isTabletWeb && styles.tabLbl]}>DN</Text>
                      {[1, 2, 3, 4].map(d => (
                        <Pressable key={d} onPress={() => setFbCtx(c => ({ ...c, down: d }))} style={[styles.mChip, isTabletWeb && styles.tabChip, fbCtx.down === d && styles.mChipOn]}><Text style={[styles.mChipTxt, isTabletWeb && styles.tabChipTxt, fbCtx.down === d && styles.mChipTxtOn]}>{d}</Text></Pressable>
                      ))}
                      <Text style={[styles.mLbl, isTabletWeb && styles.tabLbl]}>DIST</Text>
                      <Pressable onPress={() => setFbCtx(c => ({ ...c, distance: Math.max(0, (c.distance ?? 0) - 1) }))} style={[styles.mChip, isTabletWeb && styles.tabChip]}><Text style={[styles.mChipTxt, isTabletWeb && styles.tabChipTxt]}>–</Text></Pressable>
                      <Text style={[styles.mNum, isTabletWeb && styles.tabNum]}>{fbCtx.distance ?? '—'}</Text>
                      <Pressable onPress={() => setFbCtx(c => ({ ...c, distance: (c.distance ?? 0) + 1 }))} style={[styles.mChip, isTabletWeb && styles.tabChip]}><Text style={[styles.mChipTxt, isTabletWeb && styles.tabChipTxt]}>+</Text></Pressable>
                      <Text style={[styles.mLbl, isTabletWeb && styles.tabLbl]}>DR</Text>
                      <Pressable onPress={() => setFbCtx(c => ({ ...c, drive: Math.max(1, c.drive - 1) }))} style={[styles.mChip, isTabletWeb && styles.tabChip]}><Text style={[styles.mChipTxt, isTabletWeb && styles.tabChipTxt]}>–</Text></Pressable>
                      <Text style={[styles.mNum, isTabletWeb && styles.tabNum]}>{fbCtx.drive}</Text>
                      <Pressable onPress={() => setFbCtx(c => ({ ...c, drive: c.drive + 1 }))} style={[styles.mChip, isTabletWeb && styles.tabChip]}><Text style={[styles.mChipTxt, isTabletWeb && styles.tabChipTxt]}>+</Text></Pressable>
                    </Fragment>
                  ) : null}
                </View>
                {/* Editing is reachable from the clips rail below, so it needs a way back
                    out that is not "save it anyway". Same handler the desktop board uses. */}
                {editingId ? <Pressable onPress={cancelEdit} style={styles.fsCancel}><Text style={styles.fsCancelTxt}>Cancel</Text></Pressable> : null}
                <Pressable onPress={commitClip} disabled={!canSave} style={[styles.mSave, !canSave && { opacity: 0.4 }]}><Text style={styles.mSaveTxt}>{saving ? '…' : editingId ? 'Save' : groupCount > 0 ? `Save (${groupCount})` : 'Save'}</Text></Pressable>
              </View>

              {/* floating tag columns (TAG↑ grows them). mBoard's own right: 52 clears the
                  utility rail; the clips panel is a real layout column outside this overlay
                  now, so no extra inset is needed. */}
              {/* LARGE TABLET: the SAME definite-height scroll chain the phone board uses,
                  because a content-sized board cannot scroll. Definite board height ->
                  flex:1 horizontal scroller -> stretched column -> flex:1 column scroller.
                  `mColScroll` carries overscrollBehavior:'contain', which is what stops a
                  vertical swipe that hits the end of a column from chaining out into the
                  clips rail. Desktop full screen keeps its maxHeight boxes untouched. */}
              <View style={[
                styles.mBoard,
                mBoardFS && styles.mBoardFS,
                isTabletWeb && styles.tabBoardClear,
                isTabletWeb && { top: mTopH + 4 },
                isTabletWeb && (mBoardFS
                  ? { bottom: mBottomH + 4 }
                  : { height: Math.max(170, Math.round((stageH || winH) * 0.34)) }),
              ]}>
                <ScrollView
                  horizontal
                  style={isTabletWeb ? styles.tabBoardScroll : undefined}
                  contentContainerStyle={[styles.mBoardRow, isTabletWeb && styles.mBoardRowStretch]}
                >
                  {boardCols.map(c => (
                    <View key={c.key} style={[styles.mCol, isTabletWeb && styles.tabCol]}>
                      <Text style={[styles.mColHead, isTabletWeb && styles.tabColHead, { color: CAT_COLOR[c.key] ?? C.dim }]}>{c.label.toUpperCase()}</Text>
                      <ScrollView
                        style={isTabletWeb ? styles.mColScroll : { maxHeight: mBoardFS ? Math.round(winH * 0.62) : 118 }}
                        contentContainerStyle={isTabletWeb ? styles.mColScrollContent : undefined}
                        showsVerticalScrollIndicator={false}
                      >
                        <View style={styles.mChipsWrap}>{(tags[c.key] ?? []).map(t => tagButton(t, c.key))}</View>
                      </ScrollView>
                    </View>
                  ))}
                </ScrollView>
              </View>

              {/* Utility cluster: TAG size toggle + group + star/POE/GoodPlay. LOWER right
                  (Adam 2026-09-30) — it sits in the same 44px column it always did, just
                  anchored to the bottom, so it clears the clips rail (which stops at
                  right: 52) and stays above the transport row. `mRail` itself is untouched
                  because the locked phone frame renders from it. */}
              <View style={styles.fsRail}>
                <Pressable onPress={() => setMBoardFS(f => !f)} style={styles.mRailBtn}><Text style={styles.mRailTxt}>TAG{mBoardFS ? '↓' : '↑'}</Text></Pressable>
                {!editingId ? <Pressable onPress={addGroup} disabled={!canAddGroup} style={[styles.mRailBtn, !canAddGroup && { opacity: 0.4 }]}><Text style={styles.mRailTxt}>+Grp{groupCount > 0 ? ` ${groupCount}` : ''}</Text></Pressable> : null}
                <Pressable onPress={() => setIsStar(s => !s)} style={[styles.mRailBtn, isStar && { backgroundColor: C.star }]}><Text style={[styles.mRailTxt, isStar && { color: '#1a1030' }]}>★</Text></Pressable>
                <Pressable onPress={() => setIsPoe(p => !p)} style={[styles.mRailBtn, isPoe && { backgroundColor: '#dc3545' }]}><Text style={[styles.mRailTxt, isPoe && { color: '#fff' }]}>!</Text></Pressable>
                {special.goodPlay ? <Pressable onPress={() => setIsGoodPlay(g => !g)} style={[styles.mRailBtn, isGoodPlay && { backgroundColor: '#1e8449' }]}><Text style={[styles.mRailTxt, isGoodPlay && { color: '#fff' }]}>✓</Text></Pressable> : null}
              </View>

              {/* bottom: scrubber + transport + mark */}
              <View style={styles.mBottom}>
                <GestureDetector gesture={scrub}>
                  <View style={styles.scrubTouch} onLayout={e => setBarWidth(e.nativeEvent.layout.width)}>
                    <View style={styles.scrubTrack}>
                      {inPct != null && outPct != null ? <View style={[styles.inOutBand, { left: `${inPct}%`, width: `${Math.max(0, outPct - inPct)}%` }]} /> : null}
                      <View style={[styles.scrubFill, { width: `${Math.round(progress * 100)}%` }]} />
                      {/* Saved-clip markers + playhead, as on the split layout's scrubber and
                          the phone's. A tablet never sees the split scrubber, so without these
                          there is nothing showing where the tagged plays are. Visual only —
                          pointerEvents none, the pan gesture still owns the bar. */}
                      {duration > 0 ? clips.map(c => {
                        const left = (c.start / duration) * 100;
                        const w = Math.max(0.4, ((c.end - c.start) / duration) * 100);
                        const active = currentTime >= c.start && currentTime <= c.end;
                        return <View key={c.id} pointerEvents="none" style={[styles.clipMarker, { left: `${left}%`, width: `${w}%`, backgroundColor: (c.starred || c.poe) ? C.star : C.accent, opacity: active ? 1 : 0.5 }]} />;
                      }) : null}
                      <View pointerEvents="none" style={[styles.scrubHead, { left: `${Math.round(progress * 100)}%` }]} />
                    </View>
                  </View>
                </GestureDetector>
                <View style={styles.mTransport}>
                  <Text style={styles.mTime}>{fmt(currentTime)} / {fmt(duration)}</Text>
                  <Pressable onPress={() => seekBy(-5)} style={styles.mTBtn}><Text style={styles.mTTxt}>−5s</Text></Pressable>
                  <Pressable onPress={togglePlay} style={[styles.mTBtn, styles.mPlay]}><Text style={styles.mTTxt}>{isPlaying ? '❚❚' : '▶'}</Text></Pressable>
                  <Pressable onPress={() => seekBy(5)} style={styles.mTBtn}><Text style={styles.mTTxt}>+5s</Text></Pressable>
                  <Pressable onPress={cycleSpeed} style={[styles.mTBtn, speed !== 1 && styles.tSpeedOn]}><Text style={[styles.mTTxt, speed !== 1 && styles.tSpeedOnTxt]}>{speed}×</Text></Pressable>
                  {clips.length > 0 ? (
                    <Fragment>
                      <Pressable onPress={() => jumpToTag(-1)} style={styles.mTBtn}><Text style={styles.mTTxt}>◄ Tag</Text></Pressable>
                      <Pressable onPress={() => jumpToTag(1)} style={styles.mTBtn}><Text style={styles.mTTxt}>Tag ►</Text></Pressable>
                    </Fragment>
                  ) : null}
                  <View style={{ flex: 1 }} />
                  <Pressable onPress={markInNow} style={[styles.mMark, { borderColor: C.made }, markIn != null && { backgroundColor: C.made }]}><Text style={styles.mMarkTxt}>{markIn != null ? `Start ${fmt(markIn)}` : 'Start'}</Text></Pressable>
                  <Pressable onPress={markOutNow} style={[styles.mMark, { borderColor: C.poe }, markOut != null && { backgroundColor: C.poe }]}><Text style={styles.mMarkTxt}>{markOut != null ? `End ${fmt(markOut)}` : 'End'}</Text></Pressable>
                </View>
              </View>
            </View>
          )}

          {!fsLayout && (<>
          {/* scrubber + transport */}
          <View style={styles.scrubZone}>
            <GestureDetector gesture={scrub}>
              <View style={styles.scrubTouch} onLayout={e => setBarWidth(e.nativeEvent.layout.width)}>
                <View style={styles.scrubTrack}>
                  {inPct != null && outPct != null ? <View style={[styles.inOutBand, { left: `${inPct}%`, width: `${Math.max(0, outPct - inPct)}%` }]} /> : null}
                  <View style={[styles.scrubFill, { width: `${Math.round(progress * 100)}%` }]} />
                  {inPct != null ? <View style={[styles.markTick, { left: `${inPct}%`, backgroundColor: C.made }]} /> : null}
                  {outPct != null ? <View style={[styles.markTick, { left: `${outPct}%`, backgroundColor: C.poe }]} /> : null}
                </View>
                {/* Clip timeline — every saved clip as a segment under the track, so you
                    can see WHERE the clips already are while scrubbing (parity with the
                    mobile tagger). Highlight/POE clips glow gold; the clip you're currently
                    inside brightens. Non-interactive so it never steals the scrub gesture. */}
                {duration > 0 ? clips.map(c => {
                  const left = (c.start / duration) * 100;
                  const w = Math.max(0.4, ((c.end - c.start) / duration) * 100);
                  const active = currentTime >= c.start && currentTime <= c.end;
                  return <View key={c.id} pointerEvents="none" style={[styles.clipMarker, { left: `${left}%`, width: `${w}%`, backgroundColor: (c.starred || c.poe) ? C.star : C.accent, opacity: active ? 1 : 0.5 }]} />;
                }) : null}
                <View style={[styles.scrubHead, { left: `${Math.round(progress * 100)}%` }]} />
              </View>
            </GestureDetector>
            <View style={styles.transport}>
              <Pressable focusable={false} style={styles.tBtn} onPress={() => seekBy(-5)}><Text style={styles.tBtnTxt}>−5s</Text></Pressable>
              <Pressable focusable={false} style={[styles.tBtn, styles.tPlay]} onPress={togglePlay}><Text style={styles.tPlayTxt}>{isPlaying ? '❚❚' : '▶'}</Text></Pressable>
              <Pressable focusable={false} style={styles.tBtn} onPress={() => seekBy(5)}><Text style={styles.tBtnTxt}>+5s</Text></Pressable>
              <Pressable focusable={false} style={[styles.tBtn, speed !== 1 && styles.tSpeedOn]} onPress={cycleSpeed}>
                <Text style={[styles.tBtnTxt, speed !== 1 && styles.tSpeedOnTxt]}>{speed}×</Text>
              </Pressable>
              {clips.length > 0 ? (
                <>
                  <Pressable focusable={false} style={styles.tBtn} onPress={() => jumpToTag(-1)}><Text style={styles.tBtnTxt}>◄ Tag</Text></Pressable>
                  <Pressable focusable={false} style={styles.tBtn} onPress={() => jumpToTag(1)}><Text style={styles.tBtnTxt}>Tag ►</Text></Pressable>
                </>
              ) : null}
              <View style={styles.tDivider} />
              {/* Clip trim points — the most-used action. Big, plain-language,
                  color-matched to the green/orange scrubber ticks so it's clear
                  these two set where the clip begins and ends. */}
              <Pressable focusable={false} style={[styles.markBtn, styles.markStart, markIn != null && styles.markStartOn]} onPress={markInNow}>
                <Text style={[styles.markTxt, { color: C.made }]}>⇤ {markIn != null ? `Start ${fmt(markIn)}` : 'Start'}</Text>
              </Pressable>
              <Pressable focusable={false} style={[styles.markBtn, styles.markEnd, markOut != null && styles.markEndOn]} onPress={markOutNow}>
                <Text style={[styles.markTxt, { color: C.poe }]}>{markOut != null ? `End ${fmt(markOut)}` : 'End'} ⇥</Text>
              </Pressable>
              <Text style={styles.tTime}>{fmt(currentTime)} <Text style={styles.tTotal}>/ {fmt(duration)}</Text></Text>
              <View style={{ flex: 1 }} />
              <Text style={styles.windowLbl}>Clip: {windowLabel}</Text>
              {(markIn != null || markOut != null) ? (
                <Pressable focusable={false} onPress={() => { setMarkIn(null); setMarkOut(null); }} hitSlop={6}>
                  <Text style={styles.clearWindow}>✕ clear</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          {/* build tray */}
          <View style={[styles.tray, building.length > 0 && { borderTopColor: C.accent }]}>
            <Text style={styles.trayLabel}>{editingId ? 'EDITING CLIP' : groupCount > 0 ? `BUILDING CLIP · ${groupCount} GROUP${groupCount === 1 ? '' : 'S'}` : 'BUILDING CLIP'}</Text>
            {/* Running tally of already-staged groups, so you never forget what's in
                the clip after "+ Add group" clears the build row. Each is removable. */}
            {stagedBundles.length > 0 ? (
              <View style={styles.stagedList}>
                {stagedBundles.map((grp, gi) => (
                  <View key={gi} style={styles.stagedRow}>
                    <Text style={styles.stagedNum}>{gi + 1}</Text>
                    <View style={styles.stagedTags}>
                      {orderTags(grp).map((b, i) => (
                        <View key={i} style={[styles.miniTag, { backgroundColor: CAT_COLOR[b.category] ?? C.dim }]}>
                          <Text style={styles.miniTxt}>{b.name}</Text>
                        </View>
                      ))}
                    </View>
                    <Pressable focusable={false} onPress={() => removeStagedBundle(gi)} hitSlop={6}>
                      <Text style={styles.stagedRemove}>✕</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}
            <View style={styles.trayChips}>
              {building.length === 0
                ? <Text style={styles.trayHint}>Tap an event, then a player — stack as many as you want</Text>
                : orderTags(building).map((b, i) => (
                  <View key={b.id} style={styles.trayRow}>
                    {i > 0 ? <Text style={styles.plus}>+</Text> : null}
                    <View style={styles.builtChip}>
                      <View style={[styles.roleDot, { backgroundColor: CAT_COLOR[b.category] }]} />
                      <Text style={styles.builtTxt}>{b.name}</Text>
                    </View>
                  </View>
                ))}
            </View>
            <Pressable focusable={false} onPress={() => setIsStar(s => !s)} style={[styles.flag, { borderColor: C.star, backgroundColor: isStar ? C.star : C.star + '22' }]}><Text style={{ color: isStar ? '#1a1030' : C.star, fontWeight: '800' }}>★ Highlight</Text></Pressable>
            <Pressable focusable={false} onPress={() => setIsPoe(p => !p)} style={[styles.flag, { borderColor: '#dc3545', backgroundColor: isPoe ? '#dc3545' : '#dc354522' }]}><Text style={{ color: isPoe ? '#fff' : '#dc3545', fontWeight: '800' }}>◎ POE</Text></Pressable>
            {special.goodPlay ? <Pressable focusable={false} onPress={() => setIsGoodPlay(g => !g)} style={[styles.flag, { borderColor: '#1e8449', backgroundColor: isGoodPlay ? '#1e8449' : '#1e844922' }]}><Text style={{ color: isGoodPlay ? '#fff' : '#2ecc71', fontWeight: '800' }}>✓ Good Play</Text></Pressable> : null}
            {editingId ? <Pressable focusable={false} onPress={cancelEdit} style={styles.clearBtn}><Text style={styles.clearTxt}>Cancel</Text></Pressable>
              : (building.length > 0 || stagedBundles.length > 0) ? <Pressable focusable={false} onPress={clearBuilding} style={styles.clearBtn}><Text style={styles.clearTxt}>Clear</Text></Pressable> : null}
            {!editingId && (
              <Pressable focusable={false} onPress={addGroup} disabled={!canAddGroup} style={[styles.addGroupBtn, !canAddGroup && { opacity: 0.35 }]}>
                <Text style={styles.addGroupTxt}>+ Add group</Text>
              </Pressable>
            )}
            <Pressable focusable={false} onPress={commitClip} disabled={!canSave} style={[styles.doneBtn, !canSave && { opacity: 0.35 }]}>
              <Text style={styles.doneTxt}>{saving ? 'Saving…' : editingId ? 'Save changes ↵' : groupCount > 0 ? `Save clip (${groupCount}) ↵` : 'Save clip ↵'}</Text>
            </Pressable>
          </View>

          {/* Resize handle — drag to size the tag board vs the video (up = bigger video). */}
          {/* Full-width resize bar between video and board — drag anywhere on it, or tap ▲/▼. */}
          <GestureDetector gesture={boardResize}>
            <View
              style={[styles.boardHandle, handleHover && styles.boardHandleHover, { cursor: 'row-resize' } as any]}
              {...({ onMouseEnter: () => setHandleHover(true), onMouseLeave: () => setHandleHover(false) } as any)}
            >
              <View style={styles.boardGripLines}>
                <View style={styles.boardGripLine} />
                <View style={styles.boardGripLine} />
                <View style={styles.boardGripLine} />
              </View>
              <Text style={styles.boardHandleLbl}>⇅ drag to resize</Text>
              <View style={styles.boardHandleBtns}>
                <Pressable focusable={false} onPress={() => nudgeBoard(-48)} style={styles.boardNudge} hitSlop={4}><Text style={styles.boardNudgeTxt}>▲ video</Text></Pressable>
                <Pressable focusable={false} onPress={() => nudgeBoard(48)} style={styles.boardNudge} hitSlop={4}><Text style={styles.boardNudgeTxt}>▼ tags</Text></Pressable>
              </View>
            </View>
          </GestureDetector>
          {/* tag board — every sport uses the groupable board (football board retired) */}
          <ScrollView style={{ height: boardHeight }} contentContainerStyle={styles.boardScrollContent} onContentSizeChange={(_w, h) => { boardContentHRef.current = h; setBoardContentH(h); }}>
          {useFbBoard ? (
            <>
              <View style={styles.fbStrip}>
                <View style={styles.fbGroup}>
                  <Text style={styles.fbLbl}>BALL</Text>
                  {(['offense', 'defense', 'kicking'] as Odk[]).map(o => (
                    <Pressable key={o} focusable={false} onPress={() => setOdk(o)} style={[styles.fbCtl, fbCtx.odk === o && styles.fbCtlOn]}>
                      <Text style={[styles.fbCtlTxt, fbCtx.odk === o && styles.fbCtlTxtOn]}>{ODK_SHORT[o]}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.fbGroup}>
                  <Text style={styles.fbLbl}>DOWN</Text>
                  {[1, 2, 3, 4].map(d => (
                    <Pressable key={d} focusable={false} onPress={() => setFbCtx(c => ({ ...c, down: d }))} style={[styles.fbCtl, fbCtx.down === d && styles.fbCtlOn]}>
                      <Text style={[styles.fbCtlTxt, fbCtx.down === d && styles.fbCtlTxtOn]}>{d}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.fbGroup}>
                  <Text style={styles.fbLbl}>DIST</Text>
                  <Pressable focusable={false} onPress={() => setFbCtx(c => ({ ...c, distance: Math.max(0, (c.distance ?? 0) - 1) }))} style={styles.fbStep}><Text style={styles.fbStepTxt}>–</Text></Pressable>
                  <Text style={styles.fbNum}>{fbCtx.distance ?? '—'}</Text>
                  <Pressable focusable={false} onPress={() => setFbCtx(c => ({ ...c, distance: (c.distance ?? 0) + 1 }))} style={styles.fbStep}><Text style={styles.fbStepTxt}>+</Text></Pressable>
                </View>
                <View style={styles.fbGroup}>
                  <Text style={styles.fbLbl}>DRIVE</Text>
                  <Text style={styles.fbNum}>{fbCtx.drive}</Text>
                  <Pressable focusable={false} onPress={() => setFbCtx(c => ({ ...c, drive: c.drive + 1 }))} style={styles.fbStep}><Text style={styles.fbStepTxt}>+ new</Text></Pressable>
                </View>
              </View>
              <View style={styles.board}>
                {isFlag && fbCtx.odk !== 'kicking' ? (
                  // FLAG possession model — columns relabel by the toggle so ownership is
                  // unmistakable. formation = the OFFENSE's formation, play = what the OFFENSE
                  // ran, defense = the DEFENSE's call; `odk` records which side was us. So on
                  // DEF, "Their Formation" = the opponent's (e.g. Shotgun) and "Our Defense"
                  // = our man/zone/blitz call.
                  <>
                    {fbCategory('formation', fbCtx.odk === 'defense' ? 'Their Formation' : 'Our Formation', FLAG_FORMATIONS)}
                    <View style={styles.vdiv} />
                    {fbCategory('play', fbCtx.odk === 'defense' ? 'Their Play' : 'Our Play', FB_PLAY_TYPES)}
                    <View style={styles.vdiv} />
                    {fbCategory('defense', fbCtx.odk === 'defense' ? 'Our Defense' : 'Their Defense', FLAG_DEFENSES)}
                    <View style={styles.vdiv} />
                    {fbCategory('result', 'Result', fbCtx.odk === 'offense' ? FLAG_RESULT_OFF : FLAG_RESULT_DEF)}
                  </>
                ) : (
                  // Tackle football (+ flag kicking): the original front/coverage board.
                  <>
                    {fbCategory('formation', fbCtx.odk === 'defense' ? 'Front' : fbCtx.odk === 'kicking' ? 'Unit' : 'Formation', fbCtx.odk === 'defense' ? FB_FRONTS : fbCtx.odk === 'kicking' ? FB_ST_UNITS : FB_FORMATIONS)}
                    {fbCtx.odk !== 'kicking' ? <><View style={styles.vdiv} />{fbCategory('play', fbCtx.odk === 'defense' ? 'Coverage' : 'Play', fbCtx.odk === 'defense' ? FB_COVERAGES : FB_PLAY_TYPES)}</> : null}
                    <View style={styles.vdiv} />
                    {fbCategory('result', 'Result', fbCtx.odk === 'offense' ? FB_RESULT_OFF : fbCtx.odk === 'defense' ? FB_RESULT_DEF : FB_RESULT_ST)}
                  </>
                )}
                <View style={styles.vdiv} />
                {category('players', 'Players', true)}
              </View>
            </>
          ) : useFlagPhaseBoard ? (
            // The picked phase's OWN columns (OFF/DEF/SP each different). All groupable.
            // Uses phaseColsWithPlayers — the SAME shared placement the phone and fullscreen
            // boards use — so desktop no longer drops the roster Players column (Adam,
            // 2026-09-25). Ordering only: same column component, dividers and styles.
            <View style={styles.board}>
              {phaseColsWithPlayers!.map((c, i) => (
                <Fragment key={c.key}>
                  {i > 0 ? <View style={styles.vdiv} /> : null}
                  {category(c.key, c.label, true)}
                </Fragment>
              ))}
            </View>
          ) : isFootball ? (
            // Non-flag football (+ flag pre-migration fallback): 5 groupable columns.
            <View style={styles.board}>
              {category('players', 'Players', true)}
              <View style={styles.vdiv} />
              {category('formation', 'Formation', true)}
              <View style={styles.vdiv} />
              {category('play', 'Play', true)}
              <View style={styles.vdiv} />
              {category('defense', 'Defense', true)}
              <View style={styles.vdiv} />
              {category('result', 'Result', true)}
            </View>
          ) : usesSharedPlayersPlacement(tagSport) ? (
            // A FLAT sport that opts into the shared Players placement (volleyball): draw its
            // OWN columns in the shared order, the same array the phone and fullscreen boards
            // already use, so desktop stops showing the legacy generic columns (Adam,
            // 2026-09-25). Anything that does not opt in falls through to the block below,
            // which is untouched — `_default`, unknown sports, and a phased sport whose phase
            // has no tags all keep their existing board exactly. Ordering only: same column
            // component, same dividers, same styles.
            <View style={styles.board}>
              {flatColsWithPlayers.map((c, i) => (
                <Fragment key={c.key}>
                  {i > 0 ? <View style={styles.vdiv} /> : null}
                  {category(c.key, c.label, true)}
                </Fragment>
              ))}
            </View>
          ) : (
            <View style={styles.board}>
              {category('players', 'Players', true)}
              <View style={styles.vdiv} />
              {category('offense', 'Offense', true)}
              <View style={styles.vdiv} />
              {category('defense', 'Defense', true)}
              <View style={styles.vdiv} />
              {category('plays', 'Plays', true)}
            </View>
          )}
          </ScrollView>

          <View style={styles.shortcuts}>
            <Text style={styles.scTxt}>Space play/pause · ←→ ±1s · ↑↓ ±5s · [ ] prev/next clip · I / O = clip start / end · number = player · letter = event · ↵ done · ⌫ clear</Text>
          </View>
          </>)}
        </View>

        {/* right clip list — ONE implementation, used by the split layout AND the
            large-tablet / full-screen layout. Collapsible to a thin strip either way. */}
        {clipsCollapsed && (
          <Pressable style={styles.clipsStrip} onPress={toggleClipsCollapsed}>
            <Text style={styles.clipsStripChev}>‹</Text>
            <Text style={styles.clipsStripLbl}>CLIPS</Text>
            <Text style={styles.clipsStripCount}>{clips.length}</Text>
          </Pressable>
        )}
        {!clipsCollapsed && (
        <View style={styles.clipsPanel}>
          <View style={styles.clipsHead}>
            <Text style={styles.clipsTitle}>CLIPS</Text>
            <Text style={styles.clipsCount}>{clips.length} saved</Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={toggleClipsCollapsed} hitSlop={8}><Text style={styles.clipsCollapseBtn}>›</Text></Pressable>
          </View>
          {/* overscrollBehavior:'contain' both here and on the board columns, so a swipe that
              bottoms out in one scroll region cannot chain into the other. */}
          <ScrollView style={[{ flex: 1 }, isTabletWeb && styles.tabClipsScroll]} contentContainerStyle={{ padding: 10 }}>
            {clips.map(c => (
              <View key={c.id} style={[styles.clipCard, editingId === c.id && styles.clipCardEditing]}>
                {/* ONE implementation. On a large tablet these are bare 12px text labels with
                    a ~28x14 hit area, which reads as card text and is well under a usable
                    touch target — so the tablet gets real button chrome and a spelled-out
                    "Delete", same handlers, same row. Desktop/phone sizing untouched. */}
                <View style={[styles.clipCardTop, isTabletWeb && styles.tabClipCardTop]}>
                  <Pressable focusable={false} onPress={() => jumpToClip(c.start)} hitSlop={8} style={isTabletWeb ? styles.tabClipJump : undefined}>
                    <Text style={[styles.clipTime, isTabletWeb && styles.tabClipTime]}>▶ {fmt(c.start)}</Text>
                  </Pressable>
                  <View style={[styles.clipActions, isTabletWeb && styles.tabClipActions]}>
                    <Pressable focusable={false} onPress={() => startEditClip(c)} hitSlop={8} style={isTabletWeb ? styles.tabClipBtn : undefined}>
                      <Text style={[styles.clipEdit, isTabletWeb && styles.tabClipBtnTxt]}>{editingId === c.id ? 'Editing…' : 'Edit'}</Text>
                    </Pressable>
                    <Pressable focusable={false} onPress={() => deleteClipRow(c.id)} hitSlop={8} style={isTabletWeb ? styles.tabClipBtn : undefined}>
                      <Text style={[styles.clipDelete, isTabletWeb && styles.tabClipBtnTxt]}>{isTabletWeb ? 'Delete' : '✕'}</Text>
                    </Pressable>
                  </View>
                </View>
                {c.groups.map((g, gi) => (
                  <View key={gi} style={styles.clipGroup}>
                    {c.groups.length > 1 ? <Text style={styles.clipGroupNum}>{gi + 1}</Text> : null}
                    <View style={styles.clipTags}>
                      {orderTags(g).map((t, i) => (
                        <View key={i} style={[styles.miniTag, { backgroundColor: CAT_COLOR[t.category] ?? C.dim }]}>
                          <Text style={styles.miniTxt}>{t.name}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ))}
                {c.fb ? (
                  <Text style={styles.clipFb} numberOfLines={2}>
                    {ODK_SHORT[c.fb.odk]}
                    {c.fb.down ? ` · ${c.fb.down}${['', 'st', 'nd', 'rd', 'th'][c.fb.down] ?? 'th'}${c.fb.distance != null ? ` & ${c.fb.distance}` : ''}` : ''}
                    {c.fb.formation ? ` · ${c.fb.formation}` : ''}{c.fb.play ? ` · ${c.fb.play}` : ''}{c.fb.defense ? ` · ${c.fb.defense}` : ''}{c.fb.result ? ` · ${c.fb.result}` : ''}
                  </Text>
                ) : null}
                {c.starred || c.poe ? <Text style={styles.clipFoot}>{c.starred ? '★ Highlight  ' : ''}{c.poe ? '◎ POE' : ''}</Text> : null}
              </View>
            ))}
            {clips.length === 0 ? <Text style={styles.clipsEmpty}>No clips yet — tag something.</Text> : null}
          </ScrollView>
        </View>
        )}
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: C.bg },
  topbar: { height: 52, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, backgroundColor: C.panel, borderBottomWidth: 1, borderBottomColor: C.line },
  back: { color: C.accent, fontSize: 14, fontWeight: '700' },
  gameLabel: { color: C.text, fontSize: 14, fontWeight: '700' },
  // Game-period selector in the top bar (Q1/Q2/… — sport-dependent, for stats).
  periodRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 8, flexWrap: 'wrap', maxWidth: 460 },
  periodBtn: { minWidth: 34, paddingHorizontal: 8, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.28)', backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  periodBtnOn: { backgroundColor: '#EF9F27', borderColor: '#EF9F27' },
  periodTxt: { color: C.dim, fontSize: 12, fontWeight: '800' },
  periodTxtOn: { color: '#1a1a1a' },
  fbStripLbl: { color: C.dim, fontSize: 10, fontWeight: '800' },
  fbStripNum: { color: C.text, fontSize: 13, fontWeight: '800', minWidth: 18, textAlign: 'center' },
  modeBtn: { borderWidth: 1, borderColor: C.line, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 5 },
  modeTxt: { color: C.dim, fontSize: 11, fontWeight: '700' },
  autosave: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  saveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.made },
  autosaveTxt: { color: C.dim, fontSize: 12, fontWeight: '600' },

  main: { flex: 1, flexDirection: 'row', minHeight: 0 },
  stage: { flex: 1, minWidth: 0 },
  videoWrap: { flex: 1, backgroundColor: '#000', minHeight: 0, overflow: 'hidden' },
  videoOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 10 },
  overlayTxt: { color: '#fff', fontSize: 14, fontWeight: '600' },

  scrubZone: { backgroundColor: C.panel, borderTopWidth: 1, borderTopColor: C.line, paddingHorizontal: 18, paddingTop: 9, paddingBottom: 7 },
  scrubTouch: { height: 18, justifyContent: 'center' },
  scrubTrack: { height: 6, backgroundColor: C.line, borderRadius: 3 },
  scrubFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: C.accent, borderRadius: 3 },
  scrubHead: { position: 'absolute', width: 15, height: 15, borderRadius: 8, backgroundColor: '#fff', marginLeft: -7, top: '50%', marginTop: -7.5 },
  inOutBand: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(108,92,231,0.35)', borderRadius: 3 },
  markTick: { position: 'absolute', width: 3, top: -3, bottom: -3, marginLeft: -1.5, borderRadius: 2 },
  clipMarker: { position: 'absolute', bottom: 0, height: 4, borderRadius: 2 },
  stagedList: { gap: 5, marginBottom: 8 },
  stagedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stagedNum: { width: 16, textAlign: 'center', color: C.faint, fontWeight: '800', fontSize: 12 },
  stagedTags: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  stagedRemove: { color: C.dim, fontSize: 13, fontWeight: '800', paddingHorizontal: 4 },
  transport: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  tBtn: { backgroundColor: C.panel2, borderWidth: 1, borderColor: C.line, borderRadius: 8, height: 32, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  tBtnTxt: { color: C.text, fontSize: 13, fontWeight: '700' },
  tSpeedOn: { backgroundColor: C.star, borderColor: C.star },
  tSpeedOnTxt: { color: '#1a1030' },
  tPlay: { backgroundColor: '#fff', minWidth: 46 },
  tPlayTxt: { color: '#000', fontSize: 14, fontWeight: '800' },
  tTime: { color: C.text, fontSize: 13, fontWeight: '700', marginLeft: 4 },
  tTotal: { color: C.faint, fontWeight: '600' },
  tDivider: { width: 1, height: 22, backgroundColor: C.line, marginHorizontal: 4 },
  tBtnOn: { borderColor: C.accent, backgroundColor: 'rgba(108,92,231,0.18)' },
  markBtn: { height: 36, paddingHorizontal: 14, borderRadius: 9, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', minWidth: 66 },
  markTxt: { fontSize: 13.5, fontWeight: '800', fontVariant: ['tabular-nums'] },
  markStart: { borderColor: C.made, backgroundColor: 'rgba(62,196,109,0.10)' },
  markStartOn: { backgroundColor: 'rgba(62,196,109,0.30)' },
  markEnd: { borderColor: C.poe, backgroundColor: 'rgba(255,159,67,0.10)' },
  markEndOn: { backgroundColor: 'rgba(255,159,67,0.30)' },
  windowLbl: { color: C.dim, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  clearWindow: { color: C.poe, fontSize: 12, fontWeight: '800', marginLeft: 8 },

  tray: { backgroundColor: C.panel2, borderTopWidth: 1, borderTopColor: C.line, borderBottomWidth: 1, borderBottomColor: C.line, minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 8 },
  trayLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: C.faint },
  trayChips: { flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  trayHint: { color: C.faint, fontSize: 13, fontStyle: 'italic' },
  trayRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  plus: { color: C.faint, fontWeight: '800', fontSize: 13 },
  builtChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  roleDot: { width: 8, height: 8, borderRadius: 4 },
  builtTxt: { color: C.text, fontSize: 12, fontWeight: '700' },
  flag: { backgroundColor: C.panel2, borderWidth: 1, borderColor: C.line, borderRadius: 9, height: 36, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  clearBtn: { backgroundColor: C.panel2, borderWidth: 1, borderColor: C.line, borderRadius: 9, height: 36, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  clearTxt: { color: C.dim, fontSize: 12, fontWeight: '600' },
  doneBtn: { backgroundColor: C.accent, borderRadius: 9, height: 36, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  doneTxt: { color: '#fff', fontSize: 13, fontWeight: '800' },
  addGroupBtn: { backgroundColor: '#1D9E75', borderRadius: 9, height: 36, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  addGroupTxt: { color: '#fff', fontSize: 13, fontWeight: '800' },

  // Football situation strip (BALL / DOWN / DIST / DRIVE) — sits above the board.
  fbStrip: { backgroundColor: C.panel2, borderTopWidth: 1, borderTopColor: C.line, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 18, paddingHorizontal: 18, paddingVertical: 8 },
  fbGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fbLbl: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: C.faint, marginRight: 2 },
  fbCtl: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 8, minWidth: 34, height: 30, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  fbCtlOn: { backgroundColor: C.accent, borderColor: C.accent },
  fbCtlTxt: { color: C.text, fontSize: 13, fontWeight: '800' },
  fbCtlTxtOn: { color: '#fff' },
  fbStep: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 8, height: 30, minWidth: 30, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  fbStepTxt: { color: C.dim, fontSize: 13, fontWeight: '800' },
  fbNum: { color: C.text, fontSize: 15, fontWeight: '800', minWidth: 20, textAlign: 'center', fontVariant: ['tabular-nums'] },
  clipFb: { marginTop: 7, fontSize: 11, fontWeight: '700', color: C.offense },

  board: { backgroundColor: C.bg, flexDirection: 'row', gap: 14, paddingHorizontal: 18, paddingTop: 11, paddingBottom: 13 },
  boardHandle: { height: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: C.panel2, borderTopWidth: 1, borderTopColor: C.line, borderBottomWidth: 1, borderBottomColor: C.line },
  boardHandleHover: { backgroundColor: 'rgba(83,74,183,0.28)', borderTopColor: C.accent, borderBottomColor: C.accent },
  boardGripLines: { gap: 3, alignItems: 'center' },
  boardGripLine: { width: 26, height: 2, borderRadius: 1, backgroundColor: C.dim },
  boardHandleLbl: { color: C.faint, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  boardHandleBtns: { position: 'absolute', right: 12, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  boardNudge: { paddingHorizontal: 9, height: 20, borderRadius: 5, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel, alignItems: 'center', justifyContent: 'center' },
  boardNudgeTxt: { color: C.accent, fontSize: 10, fontWeight: '800' },
  boardScrollContent: { paddingBottom: 4 },
  catCol: { minWidth: 0 },
  catHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  cdot: { width: 8, height: 8, borderRadius: 4 },
  catTitle: { fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, backgroundColor: C.panel, borderRadius: 18, paddingHorizontal: 10, paddingVertical: 7, minHeight: 33, flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 88, justifyContent: 'center' },
  chipTxt: { fontSize: 12, fontWeight: '700' },
  chipKey: { fontSize: 11, color: C.dim, fontWeight: '800', borderWidth: 1, borderColor: C.line, borderRadius: 4, paddingHorizontal: 4, overflow: 'hidden' },
  vdiv: { width: 1, backgroundColor: C.line, alignSelf: 'stretch' },

  shortcuts: { backgroundColor: C.panel, borderTopWidth: 1, borderTopColor: C.line, paddingHorizontal: 18, paddingVertical: 8 },
  scTxt: { color: C.faint, fontSize: 11 },
  // ── Mobile browser immersive layout ──
  mApp: { flex: 1, backgroundColor: '#000' },
  fsOverlay: { ...StyleSheet.absoluteFillObject },
  // FS immersive clips panel — translucent, right side, inboard of the 44px rail.
  // Keep the tag columns clear of the clips panel (rail 44 + gaps + panel 200).
  mLoad: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  mTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 52, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, backgroundColor: 'rgba(0,0,0,0.42)' },
  mBack: { color: '#fff', fontSize: 30, fontWeight: '700', paddingHorizontal: 4 },
  mClusters: { flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 3 },
  mChip: { minWidth: 24, height: 26, paddingHorizontal: 5, borderRadius: 13, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.28)', backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center' },
  mChipOn: { backgroundColor: 'rgba(239,159,39,0.9)', borderColor: 'rgba(239,159,39,0.95)' },
  mChipTxt: { color: 'rgba(255,255,255,0.95)', fontSize: 11, fontWeight: '700' },
  mChipTxtOn: { color: '#1a1a1a' },
  mSep: { width: 1, height: 20, backgroundColor: 'rgba(255,255,255,0.25)', marginHorizontal: 3 },
  mLbl: { color: 'rgba(255,255,255,0.6)', fontSize: 8, fontWeight: '800', marginLeft: 3 },
  mNum: { color: '#fff', fontSize: 12, fontWeight: '800', minWidth: 16, textAlign: 'center' },
  mSave: { backgroundColor: '#534AB7', borderRadius: 16, paddingHorizontal: 12, height: 32, alignItems: 'center', justifyContent: 'center' },
  mSaveTxt: { color: '#fff', fontSize: 13, fontWeight: '700' },
  mExitFS: { width: 34, height: 32, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  mExitFSTxt: { color: '#fff', fontSize: 18, fontWeight: '800' },
  mBoard: { position: 'absolute', top: 56, left: 4, right: 52, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 8, paddingVertical: 4 },
  mBoardFS: { bottom: 78, top: 56 },
  mBoardRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 6, alignItems: 'flex-start' },
  mCol: { minWidth: 96 },
  mColHead: { fontSize: 10, fontWeight: '800', marginBottom: 3, paddingLeft: 2 },
  mChipsWrap: { gap: 4 },
  mRail: { position: 'absolute', top: 56, right: 4, width: 44, gap: 6, alignItems: 'stretch' },
  // FS/tablet utility cluster. Same column and same button styles as mRail, anchored to
  // the bottom instead of the top. 86 clears mBottom (the transport, ~78 tall) so it can
  // never sit over Start/End, play or the scrubber.
  fsRail: { position: 'absolute', bottom: 86, right: 4, width: 44, gap: 6, alignItems: 'stretch' },

  // ── LARGE-TABLET (isTabletWeb) OVERRIDES. Additive keys only: every style they sit on
  //    top of is shared with the locked phone frame and must not be edited. ─────────────
  // (B) The floating strip reuses the PHONE chip sizing (26px tall, 11px text). Before the
  // large-tablet layout existed an iPad defaulted to the solid top bar's bigger periodBtn
  // and only met these chips if the user pressed the fullscreen control. Restored to the
  // larger scale here. `height: 'auto'` + minHeight lets the strip grow if the chips wrap;
  // mTopH is measured so the board ceiling follows.
  tabTop: { height: 'auto', minHeight: 60, paddingVertical: 6, paddingHorizontal: 10, gap: 8 },
  tabChip: { minWidth: 38, height: 34, paddingHorizontal: 11, borderRadius: 17 },
  tabChipTxt: { fontSize: 14 },
  tabLbl: { fontSize: 11 },
  tabNum: { fontSize: 15, minWidth: 22 },
  // (C) definite-height chain for the board; (D) the board itself no longer paints a dark
  // rectangle over the whole video — each column carries its own subtle backing instead, so
  // the darkening ends with the actual controls.
  tabBoardClear: { backgroundColor: 'transparent', paddingVertical: 0 },
  tabBoardScroll: { flex: 1 },
  tabCol: { width: 136, alignSelf: 'stretch', backgroundColor: 'rgba(0,0,0,0.38)', borderRadius: 8, paddingHorizontal: 5, paddingTop: 5, paddingBottom: 2 },
  tabColHead: { fontSize: 12, marginBottom: 5 },
  // (A) real touch targets for the clip actions in the shared panel.
  tabClipCardTop: { paddingBottom: 8, gap: 8 },
  tabClipJump: { borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingHorizontal: 10, height: 34, minWidth: 64, alignItems: 'center', justifyContent: 'center', backgroundColor: '#23262f' },
  tabClipTime: { fontSize: 13 },
  tabClipActions: { gap: 8 },
  tabClipBtn: { borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingHorizontal: 11, height: 34, minWidth: 56, alignItems: 'center', justifyContent: 'center', backgroundColor: '#23262f' },
  tabClipBtnTxt: { fontSize: 13 },
  tabClipsScroll: { overscrollBehavior: 'contain' } as any,
  fsCancel: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', borderRadius: 16, paddingHorizontal: 12, height: 32, alignItems: 'center', justifyContent: 'center' },
  fsCancelTxt: { color: '#fff', fontSize: 12, fontWeight: '800' },
  mRailBtn: { height: 34, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', backgroundColor: 'rgba(0,0,0,0.42)', alignItems: 'center', justifyContent: 'center' },
  mRailTxt: { color: '#fff', fontSize: 11, fontWeight: '800' },
  mBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 10, paddingBottom: 6, paddingTop: 4, backgroundColor: 'rgba(0,0,0,0.42)' },
  mTransport: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  mTime: { color: '#fff', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  mTBtn: { minWidth: 40, height: 34, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)', backgroundColor: 'rgba(0,0,0,0.34)', alignItems: 'center', justifyContent: 'center' },
  mPlay: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
  mTTxt: { color: '#fff', fontSize: 13, fontWeight: '700' },
  mMark: { height: 34, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  mMarkTxt: { color: '#fff', fontSize: 12, fontWeight: '800' },

  // ── PHONE-BROWSER PARITY with the locked native frame (isPhoneFrame only; tablet
  //    browsers keep every style above unchanged). ──
  // Full-bleed gesture/tap surface over the video.
  mTapLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  // Upper-right action region: + Group then Save clip, in ONE row so they cannot overlap.
  mActions: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  mGroup: { backgroundColor: '#1D9E75', borderRadius: 16, paddingHorizontal: 10, height: 32, alignItems: 'center', justifyContent: 'center' },
  mGroupTxt: { color: '#fff', fontSize: 12, fontWeight: '800' },
  // <=5 columns: fixed board, columns share the width instead of scrolling.
  mBoardRowFixed: { flexDirection: 'row', gap: 8, paddingHorizontal: 6, alignItems: 'flex-start' },
  mColFixed: { flex: 1, minWidth: 0 },
  // Saved-clip markers on the scrubber.
  mMarker: { position: 'absolute', top: -2, height: 5, borderRadius: 2.5, backgroundColor: '#8B7CF6', opacity: 0.6 },
  // Compact bottom rail so TIME..speed, ◄Tag/Tag► and Start/End all fit one row on a
  // phone-width landscape viewport without a scroller. Nothing is removed to fit.
  mTransportTight: { gap: 4 },
  mTimeTight: { fontSize: 11, flexShrink: 1 },
  mTBtnTight: { minWidth: 32, paddingHorizontal: 4 },
  mTagNavTight: { minWidth: 48, paddingHorizontal: 4, flexShrink: 0, borderColor: 'rgba(139,124,246,0.7)', backgroundColor: 'rgba(139,124,246,0.28)' },
  mMarkTight: { paddingHorizontal: 6, minWidth: 74, flexShrink: 0 },
  mMarkTxtTight: { fontSize: 11 },
  // Board owns a bounded region between the top shell and the bottom bar, and each
  // column scrolls INSIDE it. `flex: 1` all the way down gives the inner scroller a real
  // constrained height (a maxHeight guessed from window.innerHeight was both wrong on a
  // browser with chrome and unrelated to the box it lives in), and overscrollBehavior
  // keeps the rubber-band in the column instead of handing it to the page.
  mBoardRowPhone: { flex: 1, alignItems: 'stretch' },
  mBoardScrollPhone: { flex: 1 },
  mBoardRowStretch: { alignItems: 'stretch' },
  mColFixedPhone: { flex: 1, minWidth: 0, alignSelf: 'stretch' },
  mColScrollPhone: { width: 108, alignSelf: 'stretch' },
  mColScroll: { flex: 1, overscrollBehavior: 'contain' } as any,
  // Bottom padding so the final chip clears the board floor and stays put after the
  // gesture ends, instead of springing back under the scrubber.
  mColScrollContent: { paddingBottom: 16 },
  // Right rail, locked native semantics (outlined when off, filled when on).
  mRailStar: { borderColor: '#f5c518' },
  mRailStarTxt: { color: '#f5c518' },
  mRailPoe: { borderColor: '#DC3545' },
  mRailPoeTxt: { color: '#DC3545' },
  mRailGood: { borderColor: '#1e8449' },
  mRailGoodTxt: { color: '#2ecc71' },
  // Inspection-mode restore chip: ~44pt effective target with hitSlop 12, subtle enough
  // not to compete with the frame being inspected.
  mRestore: {
    position: 'absolute', top: 8, right: 8,
    paddingHorizontal: 10, height: 30, borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  mRestoreTxt: { color: 'rgba(255,255,255,0.92)', fontSize: 12, fontWeight: '800' },
  // Surfaced play failure — never a silent false "playing" state.
  mPlayBlocked: { position: 'absolute', top: -16, left: 10, color: '#ffb4b4', fontSize: 11, fontWeight: '700' },

  clipsPanel: { width: 300, backgroundColor: C.panel, borderLeftWidth: 1, borderLeftColor: C.line },
  clipsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  clipsTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: C.faint },
  clipsCount: { fontSize: 11, color: C.dim },
  clipsCollapseBtn: { color: C.dim, fontSize: 20, fontWeight: '800', paddingHorizontal: 4 },
  clipsStrip: { width: 30, backgroundColor: C.panel, borderLeftWidth: 1, borderLeftColor: C.line, alignItems: 'center', paddingTop: 12, gap: 8 },
  clipsStripChev: { color: C.accent, fontSize: 18, fontWeight: '800' },
  clipsStripLbl: { color: C.dim, fontSize: 11, fontWeight: '800', letterSpacing: 1, transform: [{ rotate: '90deg' }], marginTop: 22 },
  clipsStripCount: { color: C.faint, fontSize: 12, fontWeight: '800', marginTop: 34 },
  clipCard: { backgroundColor: C.panel2, borderWidth: 1, borderColor: C.line, borderRadius: 11, padding: 11, marginBottom: 9 },
  clipCardEditing: { borderColor: C.accent, backgroundColor: '#211f34' },
  clipCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  clipActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  clipEdit: { color: C.players, fontSize: 12, fontWeight: '800' },
  clipDelete: { color: C.defense, fontSize: 14, fontWeight: '800' },
  clipTime: { fontSize: 11, fontWeight: '700', color: C.dim },
  clipGroup: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  clipGroupNum: { color: C.faint, fontSize: 11, fontWeight: '800', marginTop: 9, minWidth: 10 },
  clipTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 7, alignItems: 'center', flex: 1 },
  miniTag: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 12 },
  miniTxt: { fontSize: 11, fontWeight: '700', color: '#12100a' },
  clipFoot: { marginTop: 7, fontSize: 10, fontWeight: '700', color: C.star },
  clipsEmpty: { color: C.faint, fontSize: 13, textAlign: 'center', marginTop: 30 },
});

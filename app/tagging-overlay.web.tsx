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
import { runOnJS } from 'react-native-reanimated';

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
};
// Event-tag hotkey pool (players use the number row). Reserved keys — space,
// arrows, enter, backspace, and I/O (mark In/Out) — are never in here.
const EVENT_KEYS = 'QWERTYUPASDFGHJKLZXCVBNM'.split('');
// Playback-speed cycle: normal → 1.2× → 1.5× → 2× → back. One tap-to-cycle chip
// tucked into the transport row (matches the mobile tagger).
const PLAYBACK_SPEEDS = [1, 1.2, 1.5, 2];

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
  const [tags, setTags] = useState<Record<string, Tag[]>>({ players: [], offense: [], defense: [], plays: [] });
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
  // Once the user has chosen a size (saved value, drag, or nudge) we stop auto-defaulting.
  const boardUserSetRef = useRef(savedBoard != null);
  // Right clip list can collapse to a thin strip so the video reclaims that 300px.
  const [clipsCollapsed, setClipsCollapsed] = useState<boolean>(() => { try { return localStorage.getItem('iamsports.tagger.clipsCollapsed') === '1'; } catch { return false; } });
  const toggleClipsCollapsed = () => setClipsCollapsed(c => { const n = !c; try { localStorage.setItem('iamsports.tagger.clipsCollapsed', n ? '1' : '0'); } catch {} return n; });
  const [handleHover, setHandleHover] = useState(false);
  // Browser fullscreen: on enter, collapse the board to min + hide the clip list so the
  // video fills; the drag handle still works; on exit, restore the previous split.
  const [isFS, setIsFS] = useState(false);
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
  // Phone-sized browser → immersive full-bleed layout that mirrors the native app
  // (desktop web layout unchanged). mBoardFS = tag panel compact vs fullscreen.
  const { width: winW, height: winH } = useWindowDimensions();
  // Immersive layout only on ACTUAL touch devices (coarse pointer) that are phone-sized —
  // never on a desktop with a mouse, even if the window is small. So desktop always gets
  // the resizable split layout.
  const coarsePointer = (() => { try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; } })();
  const isPhone = coarsePointer && Math.min(winW, winH) <= 820;
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
      if (!didAutoPlay.current) { didAutoPlay.current = true; try { player.play(); } catch {} }
      return;
    }
    if (status?.status === 'error') {
      if (retryRef.current < 3) { retryRef.current += 1; const id = setTimeout(() => loadSignedSource(), 2000); return () => clearTimeout(id); }
      setLoadError(true);
    }
  }, [status, loadSignedSource]);
  const retryNow = useCallback(() => { retryRef.current = 0; setLoadError(false); setVideoReady(false); loadSignedSource(); }, [loadSignedSource]);

  // ── team + tags + clips ──
  useEffect(() => {
    supabase.from('videos').select('team_id, sport').eq('id', videoId).maybeSingle().then(({ data }) => {
      setTeamId((data?.team_id as string) ?? null);
      setSport((data?.sport as string) ?? null);
    });
  }, [videoId]);

  const tagSport = sport ?? activeTeam?.sport ?? null;
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
      let q = supabase.from('tags').select('*').order('sort_order');
      // Global tags are sport-scoped (sport=null is universal, e.g. ★/POE);
      // team tags belong to the team regardless of sport. Mirrors the mobile tagger.
      const globalBranch = tagSport
        ? `and(scope.eq.global,or(sport.is.null,sport.eq.${tagSport}))`
        : `scope.eq.global`;
      q = teamId
        ? q.or(`${globalBranch},and(scope.eq.team,team_id.eq.${teamId})`)
        : q.or(globalBranch);
      const { data } = await q;
      if (cancelled) return;
      // Exclude tags this team has hidden (special tags never appear in the hide UI).
      const hidden = teamId ? await loadHiddenTagIds(teamId).catch(() => new Set<string>()) : new Set<string>();
      if (cancelled) return;
      const grouped: Record<string, Tag[]> = { players: [], offense: [], defense: [], plays: [], formation: [], play: [], result: [], off_formation: [], off_play: [], off_result: [], def_scheme: [], def_opp_play: [], def_our_play: [], def_result: [], st_play: [], st_result: [] };
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
        else if (grouped[t.category] && !hidden.has(t.id)) grouped[t.category].push({ id: t.id, name: t.name, category: t.category });
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
      // Flag football: default to the Offense phase so a per-phase board shows immediately
      // (pre-migration those categories are empty → the board falls back to the 5-col view).
      if (isFlagFootball(tagSport)) {
        setActivePossession(prev => prev ?? possessions.find(p => p.name === 'Offense')?.id ?? null);
      }
    })();
    return () => { cancelled = true; };
  }, [teamId, tagSport]);

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
    tags.players.forEach((t, i) => { if (i < 10) map[t.id] = String((i + 1) % 10); });
    let ki = 0;
    (['offense', 'defense', 'plays'] as const).forEach(cat => {
      tags[cat].forEach(t => { if (ki < EVENT_KEYS.length) map[t.id] = EVENT_KEYS[ki++]; });
    });
    return map;
  }, [tags]);

  // ── player controls ──
  const togglePlay = useCallback(() => { try { isPlaying ? player.pause() : player.play(); } catch {} }, [player, isPlaying]);
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
    setBuilding(prev => prev.some(b => b.id === t.id) ? prev.filter(b => b.id !== t.id) : [...prev, { id: t.id, name: t.name, category: t.category }]);
  }, []);
  const clearBuilding = useCallback(() => { setBuilding([]); setStagedBundles([]); setIsStar(false); setIsPoe(false); setIsGoodPlay(false); setMarkIn(null); setMarkOut(null); }, []);
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
      setBuilding([]); setStagedBundles([]); setIsStar(false); setIsPoe(false); setIsGoodPlay(false); setMarkIn(null); setMarkOut(null);
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
    setMarkIn(null); setMarkOut(null); setBuilding([]); setStagedBundles([]); setIsStar(false); setIsPoe(false); setIsGoodPlay(false);
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
  }, [building, stagedBundles, saving, userId, videoId, teamId, isStar, isPoe, isGoodPlay, special, markIn, markOut, editingId, loadClips, fbCtx, isFlag, activePeriod, activePossession, possessionTags]);

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
        const hit = tags[cat].find(t => hotkeys[t.id] === k);
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
  // Sync layout to browser fullscreen: entering collapses the board to its min (video
  // fills) and hides the clip list; exiting restores the split you had before.
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

  // Resizable split: drag the handle to size the board. Up = smaller board / bigger video.
  // Clamp so the video area stays ≥200px and the board ≥120px (reserve ≈340 for video+controls).
  const beginBoardDrag = () => { boardUserSetRef.current = true; boardDragStartRef.current = boardLatestRef.current; };
  // Board can grow until the video area would drop below ~200px; if the stage isn't
  // measured yet, allow a generous max so it never feels stuck.
  const maxBoardH = () => (stageH > 0 ? Math.max(140, stageH - 260) : 600);
  const applyBoardDrag = (translationY: number) => {
    const next = Math.min(maxBoardH(), Math.max(120, boardDragStartRef.current + translationY));
    boardLatestRef.current = next;
    setBoardHeight(next);
  };
  const saveBoardHeight = () => { try { localStorage.setItem('iamsports.tagger.boardHeight', String(Math.round(boardLatestRef.current))); } catch {} };
  // Tap-to-nudge the split (in case the drag isn't discovered). − = smaller board / bigger
  // video; + = bigger board. Same clamps as the drag; persists.
  const nudgeBoard = (delta: number) => {
    boardUserSetRef.current = true;
    const next = Math.min(maxBoardH(), Math.max(120, boardLatestRef.current + delta));
    boardLatestRef.current = next;
    setBoardHeight(next);
    saveBoardHeight();
  };
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
    const col = CAT_COLOR[cat];
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
      <View style={styles.catHead}><View style={[styles.cdot, { backgroundColor: CAT_COLOR[key] }]} /><Text style={[styles.catTitle, { color: CAT_COLOR[key] }]}>{title}</Text></View>
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
  const possOptions = possessionTags.filter(p => isFootball || p.name !== 'Special Teams');
  const possShort = (name: string) => (name === 'Offense' ? 'OFF' : name === 'Defense' ? 'DEF' : 'SP');

  // FLAG FOOTBALL: OFF/DEF/SP each swap in their OWN groupable columns. Falls back to the
  // 5-col board if the picked phase has no tags yet (pre-migration window).
  const FLAG_PHASE_COLS: Record<string, { key: string; label: string }[]> = {
    Offense: [{ key: 'off_formation', label: 'Formation' }, { key: 'off_play', label: 'Play' }, { key: 'off_result', label: 'Result' }, { key: 'players', label: 'Players' }],
    Defense: [{ key: 'def_scheme', label: 'Scheme' }, { key: 'def_opp_play', label: 'Their Play' }, { key: 'def_our_play', label: 'Our Play' }, { key: 'def_result', label: 'Result' }, { key: 'players', label: 'Players' }],
    'Special Teams': [{ key: 'st_play', label: 'Play' }, { key: 'st_result', label: 'Result' }, { key: 'players', label: 'Players' }],
  };
  const activePossName = possessionTags.find(p => p.id === activePossession)?.name;
  const flagPhaseCols = (isFlag && activePossName && FLAG_PHASE_COLS[activePossName]) || null;
  const flagPhaseHasTags = !!flagPhaseCols && flagPhaseCols.some(c => c.key !== 'players' && (tags[c.key]?.length ?? 0) > 0);
  const useFlagPhaseBoard = isFlag && flagPhaseHasTags;

  // ── MOBILE BROWSER: immersive full-bleed layout mirroring the native app. Reuses
  //    every handler + the same top-bar arrangement; desktop layout (below) unchanged. ──
  if (isPhone || isFS) {
    const boardCols = useFlagPhaseBoard
      ? flagPhaseCols!.map(c => ({ key: c.key, label: c.label }))
      : isFootball
        ? [{ key: 'players', label: 'Players' }, { key: 'formation', label: 'Formation' }, { key: 'play', label: 'Play' }, { key: 'defense', label: 'Defense' }, { key: 'result', label: 'Result' }]
        : [{ key: 'players', label: 'Players' }, { key: 'offense', label: 'Offense' }, { key: 'defense', label: 'Defense' }, { key: 'plays', label: 'Plays' }];
    return (
      <GestureHandlerRootView style={styles.mApp}>
        <VideoView player={player} style={{ position: 'absolute', top: 0, left: 0, width: winW, height: winH }} nativeControls={false} contentFit="contain" />
        {!videoReady ? <View style={styles.mLoad}><ActivityIndicator color="#fff" size="large" /></View> : null}

        {/* top bar: back + quarters/OFF-DEF-SP/DN-DIST-DR + save (the standard arrangement) */}
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
          <Pressable onPress={commitClip} disabled={!canSave} style={[styles.mSave, !canSave && { opacity: 0.4 }]}><Text style={styles.mSaveTxt}>{saving ? '…' : editingId ? 'Save' : groupCount > 0 ? `Save (${groupCount})` : 'Save'}</Text></Pressable>
          {isFS ? <Pressable onPress={toggleFS} hitSlop={8} style={styles.mExitFS}><Text style={styles.mExitFSTxt}>⤡</Text></Pressable> : null}
        </View>

        {/* tag board overlay (horizontal scroll of columns; TAG toggle grows it) */}
        <View style={[styles.mBoard, mBoardFS && styles.mBoardFS]}>
          <ScrollView horizontal contentContainerStyle={styles.mBoardRow}>
            {boardCols.map(c => (
              <View key={c.key} style={styles.mCol}>
                <Text style={[styles.mColHead, { color: CAT_COLOR[c.key] }]}>{c.label.toUpperCase()}</Text>
                <ScrollView style={{ maxHeight: mBoardFS ? Math.round(winH * 0.62) : 118 }} showsVerticalScrollIndicator={false}>
                  <View style={styles.mChipsWrap}>{(tags[c.key] ?? []).map(t => tagButton(t, c.key))}</View>
                </ScrollView>
              </View>
            ))}
          </ScrollView>
        </View>

        {/* right rail: TAG size toggle + group + star/POE/GoodPlay */}
        <View style={styles.mRail}>
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
                <Pressable onPress={() => jumpToTag(-1)} style={styles.mTBtn}><Text style={styles.mTTxt}>◄</Text></Pressable>
                <Pressable onPress={() => jumpToTag(1)} style={styles.mTBtn}><Text style={styles.mTTxt}>►</Text></Pressable>
              </Fragment>
            ) : null}
            <View style={{ flex: 1 }} />
            <Pressable onPress={markInNow} style={[styles.mMark, { borderColor: C.made }, markIn != null && { backgroundColor: C.made }]}><Text style={styles.mMarkTxt}>{markIn != null ? `In ${fmt(markIn)}` : 'In'}</Text></Pressable>
            <Pressable onPress={markOutNow} style={[styles.mMark, { borderColor: C.poe }, markOut != null && { backgroundColor: C.poe }]}><Text style={styles.mMarkTxt}>{markOut != null ? `Out ${fmt(markOut)}` : 'Out'}</Text></Pressable>
          </View>
        </View>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.app}>
      {/* top bar */}
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
          <ScrollView style={{ height: boardHeight }} contentContainerStyle={styles.boardScrollContent}>
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
            // FLAG: the picked phase's OWN columns (OFF/DEF/SP each different). All groupable.
            <View style={styles.board}>
              {flagPhaseCols!.map((c, i) => (
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
        </View>

        {/* right clip list — hidden in fullscreen; collapsible to a thin strip otherwise */}
        {!isFS && clipsCollapsed && (
          <Pressable style={styles.clipsStrip} onPress={toggleClipsCollapsed}>
            <Text style={styles.clipsStripChev}>‹</Text>
            <Text style={styles.clipsStripLbl}>CLIPS</Text>
            <Text style={styles.clipsStripCount}>{clips.length}</Text>
          </Pressable>
        )}
        {!isFS && !clipsCollapsed && (
        <View style={styles.clipsPanel}>
          <View style={styles.clipsHead}>
            <Text style={styles.clipsTitle}>CLIPS</Text>
            <Text style={styles.clipsCount}>{clips.length} saved</Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={toggleClipsCollapsed} hitSlop={8}><Text style={styles.clipsCollapseBtn}>›</Text></Pressable>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 10 }}>
            {clips.map(c => (
              <View key={c.id} style={[styles.clipCard, editingId === c.id && styles.clipCardEditing]}>
                <View style={styles.clipCardTop}>
                  <Pressable focusable={false} onPress={() => jumpToClip(c.start)}>
                    <Text style={styles.clipTime}>▶ {fmt(c.start)}</Text>
                  </Pressable>
                  <View style={styles.clipActions}>
                    <Pressable focusable={false} onPress={() => startEditClip(c)}>
                      <Text style={styles.clipEdit}>{editingId === c.id ? 'Editing…' : 'Edit'}</Text>
                    </Pressable>
                    <Pressable focusable={false} onPress={() => deleteClipRow(c.id)}>
                      <Text style={styles.clipDelete}>✕</Text>
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

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
import { getCachedPathSync } from '@/lib/native/video-cache';
import { getSignedVideoUrl } from '@/lib/native/video-url';
import { supabase } from '@/supabase';
import { goBackOrHome } from '@/lib/nav';
import { useEvent } from 'expo';
import { useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
};
// Event-tag hotkey pool (players use the number row). Reserved keys — space,
// arrows, enter, backspace, and I/O (mark In/Out) — are never in here.
const EVENT_KEYS = 'QWERTYUPASDFGHJKLZXCVBNM'.split('');
// Playback-speed cycle: normal → 1.2× → 1.5× → 2× → back. One tap-to-cycle chip
// tucked into the transport row (matches the mobile tagger).
const PLAYBACK_SPEEDS = [1, 1.2, 1.5, 2];

type Tag = { id: string; name: string; category: string };
type Built = { id: string; name: string; category: string };
type ClipRow = { id: string; start: number; end: number; groups: { name: string; category: string }[][]; starred: boolean; poe: boolean; editTags: { id: string; name: string; category: string }[]; fb?: FbSummary | null };
type FbSummary = { odk: Odk; down: number | null; distance: number | null; formation: string | null; play: string | null; result: string | null; drive: number | null };

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
// Single-select chips that fill the structured clip_football fields. Same look
// as the basketball tag board; different content + one-per-column behaviour.
const FB_FORMATIONS = ['Shotgun', 'Under Center', 'Pistol', 'Empty', 'I-Form', 'Trips', 'Bunch'];
const FB_PLAY_TYPES = ['Run Inside', 'Run Outside', 'Pass', 'Play Action', 'Screen', 'RPO', 'QB Run'];
const FB_RESULT_OFF = ['1st Down', 'TD', 'Complete', 'Incomplete', 'Rush', 'Sack', 'Fumble', 'INT', 'Penalty', 'No Gain'];
const FB_FRONTS = ['4-3', '3-4', '4-2-5', 'Nickel', 'Bear', '3-3 Stack'];
const FB_COVERAGES = ['Cover 0', 'Cover 1', 'Cover 2', 'Cover 3', 'Cover 4', 'Man', 'Zone'];
const FB_RESULT_DEF = ['Stop', 'TFL', 'Sack', 'INT', 'PBU', 'Forced Fumble', '1st Down Allowed', 'TD Allowed', 'Penalty'];
const FB_ST_UNITS = ['Kickoff', 'Punt', 'FG', 'PAT', 'Return', 'Onside'];
const FB_RESULT_ST = ['Good', 'Miss', 'Return TD', 'Block', 'Muff', 'Downed'];

type Odk = 'offense' | 'defense' | 'kicking';
type FbCtx = { odk: Odk; down: number | null; distance: number | null; drive: number };
type FbSel = { formation: string | null; play: string | null; result: string | null };
const ODK_SHORT: Record<Odk, string> = { offense: 'OFF', defense: 'DEF', kicking: 'K' };

export default function TaggingStudioWeb() {
  const { userId, activeTeam } = useTeamContext();
  const params = useLocalSearchParams();
  const videoId = (Array.isArray(params.videoId) ? params.videoId[0] : params.videoId) as string;
  const remoteUrl = (Array.isArray(params.url) ? params.url[0] : params.url) as string;
  const label = ((Array.isArray(params.label) ? params.label[0] : params.label) as string) ?? 'Tagging';

  const [teamId, setTeamId] = useState<string | null>(null);
  const [sport, setSport] = useState<string | null>(null);
  const [tags, setTags] = useState<Record<string, Tag[]>>({ players: [], offense: [], defense: [], plays: [] });
  const [special, setSpecial] = useState<{ highlight: string | null; poe: string | null }>({ highlight: null, poe: null });
  const [periodTags, setPeriodTags] = useState<Tag[]>([]);
  const [activePeriod, setActivePeriod] = useState<string | null>(null);
  const [clips, setClips] = useState<ClipRow[]>([]);
  const [building, setBuilding] = useState<Built[]>([]);
  const [isStar, setIsStar] = useState(false);
  const [isPoe, setIsPoe] = useState(false);
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
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false); // brief "Saved ✓" after each clip commits
  // Football situation — sticky, carries forward across clips. fbSel = this clip's
  // single-select descriptors (formation/play/result). Only used when isFootball.
  const [fbCtx, setFbCtx] = useState<FbCtx>({ odk: 'offense', down: 1, distance: 10, drive: 1 });
  const [fbSel, setFbSel] = useState<FbSel>({ formation: null, play: null, result: null });

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
  const isFootball = isFootballSport(tagSport);

  // Flip the ODK unit → new drive (possession changed); clear this clip's picks.
  const setOdk = useCallback((odk: Odk) => {
    setFbCtx(c => (c.odk === odk ? c : { ...c, odk, drive: c.drive + 1 }));
    setFbSel({ formation: null, play: null, result: null });
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
      const grouped: Record<string, Tag[]> = { players: [], offense: [], defense: [], plays: [] };
      let highlight: string | null = null, poe: string | null = null;
      const periods: Tag[] = [];
      (data || []).forEach((t: any) => {
        if (t.category === 'special') { if (t.name === '★ Highlight') highlight = t.id; else if (t.name === 'POE') poe = t.id; }
        else if (t.category === 'period') periods.push({ id: t.id, name: t.name, category: t.category });
        else if (grouped[t.category] && !hidden.has(t.id)) grouped[t.category].push({ id: t.id, name: t.name, category: t.category });
      });
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
      setSpecial({ highlight, poe });
      setPeriodTags(periods);
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
        formation: cfRaw.off_formation ?? cfRaw.def_front ?? null, play: cfRaw.play_type ?? null, result: cfRaw.result ?? null,
        drive: cfRaw.drive_id ?? null,
      } : null;
      return { id: c.id, start: c.start_time, end: c.end_time, starred, poe, groups, editTags, fb };
    }));
  }, [videoId, special]);
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
  const seekToX = useCallback((x: number) => { if (barWidth <= 0 || duration <= 0) return; try { player.currentTime = Math.max(0, Math.min(duration, (x / barWidth) * duration)); } catch {} }, [player, barWidth, duration]);

  // ── build-then-commit ──
  const tapTag = useCallback((t: Tag) => {
    setBuilding(prev => prev.some(b => b.id === t.id) ? prev.filter(b => b.id !== t.id) : [...prev, { id: t.id, name: t.name, category: t.category }]);
  }, []);
  const clearBuilding = useCallback(() => { setBuilding([]); setStagedBundles([]); setIsStar(false); setIsPoe(false); setMarkIn(null); setMarkOut(null); }, []);
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
    setIsStar(c.starred); setIsPoe(c.poe);
    setStagedBundles([]);
    // Reload the football breakdown onto the situation strip + board so editing
    // reflects (and can change) what was tagged.
    if (c.fb) {
      setFbCtx(cur => ({ odk: c.fb!.odk, down: c.fb!.down, distance: c.fb!.distance, drive: c.fb!.drive ?? cur.drive }));
      setFbSel({ formation: c.fb.formation, play: c.fb.play, result: c.fb.result });
    }
    try { player.currentTime = Math.max(0, c.start); } catch {}
  }, [player]);
  const cancelEdit = useCallback(() => {
    setEditingId(null); setBuilding([]); setIsStar(false); setIsPoe(false); setMarkIn(null); setMarkOut(null);
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

    // EDIT MODE: overwrite the existing clip's window + tags (flattened to one group
    // + clip-level ★/POE). Replaces all clip_tags for the clip.
    if (editingId) {
      // A football clip may have no player tags, so don't require a build group there.
      if ((building.length === 0 && !isFootball) || !useMarks) return;
      setSaving(true);
      await supabase.from('clips').update({ start_time: markIn as number, end_time: markOut as number }).eq('id', editingId);
      await supabase.from('clip_tags').delete().eq('clip_id', editingId);
      const rows: { clip_id: string; tag_id: string; bundle_number: number }[] = building.map(b => ({ clip_id: editingId, tag_id: b.id, bundle_number: 1 }));
      if (isStar && special.highlight) rows.push({ clip_id: editingId, tag_id: special.highlight, bundle_number: 0 });
      if (isPoe && special.poe) rows.push({ clip_id: editingId, tag_id: special.poe, bundle_number: 0 });
      if (activePeriod) rows.push({ clip_id: editingId, tag_id: activePeriod, bundle_number: 0 });
      if (rows.length) await supabase.from('clip_tags').insert(rows);
      if (isFootball) {
        const { error: cfErr } = await supabase.from('clip_football').upsert({
          clip_id: editingId,
          odk: fbCtx.odk, down: fbCtx.down, distance: fbCtx.distance,
          play_type: fbSel.play,
          off_formation: fbCtx.odk === 'offense' ? fbSel.formation : null,
          def_front: fbCtx.odk === 'defense' ? fbSel.formation : null,
          result: fbSel.result, drive_id: fbCtx.drive,
        }, { onConflict: 'clip_id' });
        if (cfErr) console.error('[football] clip_football upsert failed', cfErr.message);
      }
      setSaving(false);
      setEditingId(null);
      setBuilding([]); setStagedBundles([]); setIsStar(false); setIsPoe(false); setMarkIn(null); setMarkOut(null);
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
    if (bundles.length === 0 && !isFootball) return;
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
    if (activePeriod) rows.push({ clip_id: clip.id, tag_id: activePeriod, bundle_number: 0 });
    if (rows.length) await supabase.from('clip_tags').insert(rows);
    if (isFootball) {
      const { error: cfErr } = await supabase.from('clip_football').insert({
        clip_id: clip.id,
        odk: fbCtx.odk,
        down: fbCtx.down,
        distance: fbCtx.distance,
        play_type: fbSel.play,
        off_formation: fbCtx.odk === 'offense' ? fbSel.formation : null,
        def_front: fbCtx.odk === 'defense' ? fbSel.formation : null,
        result: fbSel.result,
        drive_id: fbCtx.drive,
      });
      if (cfErr) console.error('[football] clip_football insert failed', cfErr.message);
    }
    setSaving(false);
    setMarkIn(null); setMarkOut(null); setBuilding([]); setStagedBundles([]); setIsStar(false); setIsPoe(false);
    if (isFootball) {
      // Carry the situation forward: a 1st down / TD resets to 1st & 10, else the
      // down bumps. The coach can always tap to correct it.
      const scored = fbSel.result === '1st Down' || fbSel.result === 'TD';
      setFbSel({ formation: null, play: null, result: null });
      setFbCtx(c => ({ ...c, down: scored ? 1 : Math.min(4, (c.down ?? 1) + 1), distance: scored ? 10 : c.distance }));
    }
    loadClips();
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1600);
  }, [building, stagedBundles, saving, userId, videoId, teamId, isStar, isPoe, special, markIn, markOut, editingId, loadClips, isFootball, fbCtx, fbSel]);

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
  const inPct = markIn != null && duration > 0 ? (markIn / duration) * 100 : null;
  const outPct = markOut != null && duration > 0 ? (markOut / duration) * 100 : null;
  const hasWindow = markIn != null && markOut != null && markOut > markIn;
  const groupCount = stagedBundles.length + (building.length > 0 ? 1 : 0);
  const canAddGroup = building.length > 0 && !saving && !editingId;
  const canSave = !saving && (editingId ? ((building.length > 0 || isFootball) && hasWindow) : (hasWindow && (isFootball || groupCount > 0)));
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

  const category = (key: 'players' | 'offense' | 'defense' | 'plays', title: string, grow?: boolean) => (
    <View style={[styles.catCol, grow && { flex: 1 }]}>
      <View style={styles.catHead}><View style={[styles.cdot, { backgroundColor: CAT_COLOR[key] }]} /><Text style={[styles.catTitle, { color: CAT_COLOR[key] }]}>{title}</Text></View>
      <View style={styles.chipWrap}>{tags[key].map(t => tagButton(t, key))}</View>
    </View>
  );

  // Football board column — single-select chips filling one clip_football field.
  // Same chip styling as the basketball board (styles.chip), so it feels identical.
  const FB_COL_COLOR: Record<keyof FbSel, string> = { formation: C.offense, play: C.plays, result: C.defense };
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
        <View style={{ flex: 1 }} />
        <Pressable onPress={toggleFS} style={styles.modeBtn}><Text style={styles.modeTxt}>⛶ Full screen</Text></Pressable>
        <View style={styles.autosave}><View style={styles.saveDot} /><Text style={styles.autosaveTxt}>{saving ? 'Saving…' : savedFlash ? 'Saved ✓' : 'Auto-saves each clip'}</Text></View>
      </View>

      <View style={styles.main}>
        {/* left stage */}
        <View style={styles.stage}>
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

          {/* tag board — football adds a sticky situation strip + football columns */}
          {isFootball ? (
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
                {fbCategory('formation', fbCtx.odk === 'defense' ? 'Front' : fbCtx.odk === 'kicking' ? 'Unit' : 'Formation', fbCtx.odk === 'defense' ? FB_FRONTS : fbCtx.odk === 'kicking' ? FB_ST_UNITS : FB_FORMATIONS)}
                {fbCtx.odk !== 'kicking' ? <><View style={styles.vdiv} />{fbCategory('play', fbCtx.odk === 'defense' ? 'Coverage' : 'Play', fbCtx.odk === 'defense' ? FB_COVERAGES : FB_PLAY_TYPES)}</> : null}
                <View style={styles.vdiv} />
                {fbCategory('result', 'Result', fbCtx.odk === 'offense' ? FB_RESULT_OFF : fbCtx.odk === 'defense' ? FB_RESULT_DEF : FB_RESULT_ST)}
                <View style={styles.vdiv} />
                {category('players', 'Players', true)}
              </View>
            </>
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

          <View style={styles.shortcuts}>
            <Text style={styles.scTxt}>Space play/pause · ←→ ±1s · ↑↓ ±5s · I / O = clip start / end · number = player · letter = event · ↵ done · ⌫ clear</Text>
          </View>
        </View>

        {/* right clip list */}
        <View style={styles.clipsPanel}>
          <View style={styles.clipsHead}><Text style={styles.clipsTitle}>CLIPS</Text><Text style={styles.clipsCount}>{clips.length} saved</Text></View>
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
                    {c.fb.formation ? ` · ${c.fb.formation}` : ''}{c.fb.play ? ` · ${c.fb.play}` : ''}{c.fb.result ? ` · ${c.fb.result}` : ''}
                  </Text>
                ) : null}
                {c.starred || c.poe ? <Text style={styles.clipFoot}>{c.starred ? '★ Highlight  ' : ''}{c.poe ? '◎ POE' : ''}</Text> : null}
              </View>
            ))}
            {clips.length === 0 ? <Text style={styles.clipsEmpty}>No clips yet — tag something.</Text> : null}
          </ScrollView>
        </View>
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

  clipsPanel: { width: 300, backgroundColor: C.panel, borderLeftWidth: 1, borderLeftColor: C.line },
  clipsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  clipsTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: C.faint },
  clipsCount: { fontSize: 11, color: C.dim },
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

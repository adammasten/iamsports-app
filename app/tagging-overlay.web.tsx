// WEB tagging studio (Metro serves this on web; native keeps tagging-overlay.tsx).
// A desktop "button-matrix" tagger: centered player + scrubber on the left, the
// FULL tag board across the bottom (all tags always visible), a build-then-commit
// tray, and a live clip list on the right. Keyboard-first. Reuses the exact
// clips/clip_tags insert contract as native (bundle_number 0 = clip-level; star/POE
// are the "★ Highlight" / "POE" special tags), so exports/filters stay valid.
// See docs/WEB_TAGGING_STUDIO_PLAN.md + docs/tagging-studio-prototype.html.
import { useTeamContext } from '@/context';
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

type Tag = { id: string; name: string; category: string };
type Built = { id: string; name: string; category: string };
type ClipRow = { id: string; start: number; end: number; groups: { name: string; category: string }[][]; starred: boolean; poe: boolean; editTags: { id: string; name: string; category: string }[] };

function fmt(s: number) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}

export default function TaggingStudioWeb() {
  const { userId } = useTeamContext();
  const params = useLocalSearchParams();
  const videoId = (Array.isArray(params.videoId) ? params.videoId[0] : params.videoId) as string;
  const remoteUrl = (Array.isArray(params.url) ? params.url[0] : params.url) as string;
  const label = ((Array.isArray(params.label) ? params.label[0] : params.label) as string) ?? 'Tagging';

  const [teamId, setTeamId] = useState<string | null>(null);
  const [tags, setTags] = useState<Record<string, Tag[]>>({ players: [], offense: [], defense: [], plays: [] });
  const [special, setSpecial] = useState<{ highlight: string | null; poe: string | null }>({ highlight: null, poe: null });
  const [clips, setClips] = useState<ClipRow[]>([]);
  const [building, setBuilding] = useState<Built[]>([]);
  const [isStar, setIsStar] = useState(false);
  const [isPoe, setIsPoe] = useState(false);
  const [markIn, setMarkIn] = useState<number | null>(null);
  const [markOut, setMarkOut] = useState<number | null>(null);
  // While a Start/End window is open, successive Adds append tag GROUPS (bundles)
  // to the SAME clip — matching the phone tagger + export's bundle model — instead
  // of making a new clip each time. Cleared when the window changes.
  const [openClipId, setOpenClipId] = useState<string | null>(null);
  const [bundleCount, setBundleCount] = useState(0);
  // When set, the board is EDITING an already-committed clip (loaded back in)
  // rather than building a new one. Save writes changes; Cancel exits.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [barWidth, setBarWidth] = useState(0);
  // Measured pixel size of the video box. On web, expo-video's <video> uses a
  // percentage height that won't resolve against a flex-computed box, so
  // contentFit can't letterbox and the frame stretches. Feeding explicit px
  // dimensions gives it a real box → contentFit="contain" works.
  const [vbox, setVbox] = useState({ w: 0, h: 0 });
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false); // brief "Saved ✓" after each clip commits

  // ── player ──
  const cachedPath = videoId ? getCachedPathSync(videoId) : null;
  const player = useVideoPlayer(cachedPath, p => { p.pause(); p.timeUpdateEventInterval = 0.5; });
  const { currentTime } = useEvent(player, 'timeUpdate', { currentTime: 0, currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition: 0 });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: false });
  const { duration: srcDuration } = useEvent(player, 'sourceLoad', { duration: 0, videoSource: null, availableVideoTracks: [], availableSubtitleTracks: [], availableAudioTracks: [] });
  const pd = (player as { duration?: number }).duration;
  const duration = srcDuration || (typeof pd === 'number' && Number.isFinite(pd) ? pd : 0);
  const status = useEvent(player, 'statusChange', { status: 'idle' as string, oldStatus: undefined, error: undefined });

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
    if (status.status === 'readyToPlay') {
      retryRef.current = 0; setVideoReady(true); setLoadError(false);
      // WEB: start playback on first ready (a manual play right after replace()
      // races the load and aborts — same fix game-player uses). Coach pauses with Space.
      if (!didAutoPlay.current) { didAutoPlay.current = true; try { player.play(); } catch {} }
      return;
    }
    if (status.status === 'error') {
      if (retryRef.current < 3) { retryRef.current += 1; const id = setTimeout(() => loadSignedSource(), 2000); return () => clearTimeout(id); }
      setLoadError(true);
    }
  }, [status, loadSignedSource]);
  const retryNow = useCallback(() => { retryRef.current = 0; setLoadError(false); setVideoReady(false); loadSignedSource(); }, [loadSignedSource]);

  // ── team + tags + clips ──
  useEffect(() => {
    supabase.from('videos').select('team_id').eq('id', videoId).maybeSingle().then(({ data }) => setTeamId((data?.team_id as string) ?? null));
  }, [videoId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let q = supabase.from('tags').select('*').order('sort_order');
      q = teamId
        ? q.or(`scope.eq.global,and(scope.eq.team,team_id.eq.${teamId})`)
        : q.eq('scope', 'global');
      const { data } = await q;
      if (cancelled) return;
      const grouped: Record<string, Tag[]> = { players: [], offense: [], defense: [], plays: [] };
      let highlight: string | null = null, poe: string | null = null;
      (data || []).forEach((t: any) => {
        if (t.category === 'special') { if (t.name === '★ Highlight') highlight = t.id; else if (t.name === 'POE') poe = t.id; }
        else if (grouped[t.category]) grouped[t.category].push({ id: t.id, name: t.name, category: t.category });
      });
      setTags(grouped);
      setSpecial({ highlight, poe });
    })();
    return () => { cancelled = true; };
  }, [teamId]);

  const loadClips = useCallback(async () => {
    const { data } = await supabase
      .from('clips')
      .select('id, start_time, end_time, clip_tags ( bundle_number, tags ( id, name, category ) )')
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
      return { id: c.id, start: c.start_time, end: c.end_time, starred, poe, groups, editTags };
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
  const seekBy = useCallback((d: number) => { try { player.currentTime = Math.max(0, Math.min(duration || 0, (player.currentTime || 0) + d)); } catch {} }, [player, duration]);
  const seekToX = useCallback((x: number) => { if (barWidth <= 0 || duration <= 0) return; try { player.currentTime = Math.max(0, Math.min(duration, (x / barWidth) * duration)); } catch {} }, [player, barWidth, duration]);

  // ── build-then-commit ──
  const tapTag = useCallback((t: Tag) => {
    setBuilding(prev => prev.some(b => b.id === t.id) ? prev.filter(b => b.id !== t.id) : [...prev, { id: t.id, name: t.name, category: t.category }]);
  }, []);
  const clearBuilding = useCallback(() => { setBuilding([]); setIsStar(false); setIsPoe(false); setMarkIn(null); setMarkOut(null); setOpenClipId(null); setBundleCount(0); }, []);
  // After committing a group, clear only the tags/flags — KEEP the Start/End
  // window and the open clip so the next Add stacks another GROUP on the SAME
  // clip (e.g. Neo steal, then Neo fouled). A new window / Clear / Backspace
  // starts a fresh clip.
  const clearTagsOnly = useCallback(() => { setBuilding([]); setIsStar(false); setIsPoe(false); }, []);
  // Setting a new Start or End begins a new window → a new clip.
  const markInNow = useCallback(() => { setMarkIn(player.currentTime || 0); setOpenClipId(null); setBundleCount(0); }, [player]);
  const markOutNow = useCallback(() => { setMarkOut(player.currentTime || 0); setOpenClipId(null); setBundleCount(0); }, [player]);
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
    setOpenClipId(null); setBundleCount(0);
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

  const commitClip = useCallback(async () => {
    if (building.length === 0 || saving || !userId) return;
    const useMarks = markIn != null && markOut != null && markOut > markIn;

    // EDIT MODE: overwrite the existing clip's window + tags (star/POE/period at
    // bundle 0, the rest as one group). Replaces all clip_tags for the clip.
    if (editingId) {
      if (!useMarks) return;
      setSaving(true);
      await supabase.from('clips').update({ start_time: markIn as number, end_time: markOut as number }).eq('id', editingId);
      await supabase.from('clip_tags').delete().eq('clip_id', editingId);
      const rows: { clip_id: string; tag_id: string; bundle_number: number }[] = building.map(b => ({ clip_id: editingId, tag_id: b.id, bundle_number: 1 }));
      if (isStar && special.highlight) rows.push({ clip_id: editingId, tag_id: special.highlight, bundle_number: 0 });
      if (isPoe && special.poe) rows.push({ clip_id: editingId, tag_id: special.poe, bundle_number: 0 });
      if (rows.length) await supabase.from('clip_tags').insert(rows);
      setSaving(false);
      setEditingId(null);
      setBuilding([]); setIsStar(false); setIsPoe(false); setMarkIn(null); setMarkOut(null);
      loadClips();
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1600);
      return;
    }

    // A clip REQUIRES an explicit Start + End window — no auto-window, no clips
    // without an end time. (Adding another group reuses the open clip's window.)
    if (openClipId == null && !useMarks) return;
    const groupTagIds = building.map(b => b.id);
    setSaving(true);

    // With an open windowed clip, this Add is another GROUP (bundle) on it.
    // Otherwise create a fresh clip (bundle 1 = the first group).
    let targetId = openClipId;
    let bundleNum: number;
    if (targetId == null) {
      const { data: clip, error } = await supabase
        .from('clips')
        .insert({ video_id: videoId, team_id: teamId, created_by_user_id: userId, start_time: markIn as number, end_time: markOut as number, note: '' })
        .select().single();
      if (error || !clip) { setSaving(false); return; }
      targetId = clip.id;
      setOpenClipId(clip.id); // keep the clip open for more groups
      bundleNum = 1;
      setBundleCount(1);
    } else {
      bundleNum = bundleCount + 1;
      setBundleCount(bundleNum);
    }

    // The built tags become one group at bundle N (1,2,3…). Star/POE apply to the
    // whole clip → bundle 0, added once (with the first group).
    const rows = groupTagIds.map(tag_id => ({ clip_id: targetId as string, tag_id, bundle_number: bundleNum }));
    if (bundleNum === 1) {
      if (isStar && special.highlight) rows.push({ clip_id: targetId as string, tag_id: special.highlight, bundle_number: 0 });
      if (isPoe && special.poe) rows.push({ clip_id: targetId as string, tag_id: special.poe, bundle_number: 0 });
    }
    if (rows.length) await supabase.from('clip_tags').insert(rows);
    setSaving(false);
    clearTagsOnly();
    loadClips();
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1600);
  }, [building, saving, userId, videoId, teamId, isStar, isPoe, special, markIn, markOut, openClipId, bundleCount, editingId, clearTagsOnly, loadClips]);

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

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const builtSet = new Set(building.map(b => b.id));
  const scrub = Gesture.Pan().minDistance(0)
    .onBegin(e => runOnJS(seekToX)(e.x))
    .onUpdate(e => runOnJS(seekToX)(e.x));
  const inPct = markIn != null && duration > 0 ? (markIn / duration) * 100 : null;
  const outPct = markOut != null && duration > 0 ? (markOut / duration) * 100 : null;
  const hasWindow = markIn != null && markOut != null && markOut > markIn;
  const canAdd = building.length > 0 && !saving && (openClipId != null || hasWindow);
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

  return (
    <GestureHandlerRootView style={styles.app}>
      {/* top bar */}
      <View style={styles.topbar}>
        <Pressable onPress={goBackOrHome} hitSlop={10}><Text style={styles.back}>‹ Back</Text></Pressable>
        <Text style={styles.gameLabel} numberOfLines={1}>{label}</Text>
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
                <View style={[styles.scrubHead, { left: `${Math.round(progress * 100)}%` }]} />
              </View>
            </GestureDetector>
            <View style={styles.transport}>
              <Pressable focusable={false} style={styles.tBtn} onPress={() => seekBy(-5)}><Text style={styles.tBtnTxt}>−5s</Text></Pressable>
              <Pressable focusable={false} style={[styles.tBtn, styles.tPlay]} onPress={togglePlay}><Text style={styles.tPlayTxt}>{isPlaying ? '❚❚' : '▶'}</Text></Pressable>
              <Pressable focusable={false} style={styles.tBtn} onPress={() => seekBy(5)}><Text style={styles.tBtnTxt}>+5s</Text></Pressable>
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
                <Pressable focusable={false} onPress={() => { setMarkIn(null); setMarkOut(null); setOpenClipId(null); setBundleCount(0); }} hitSlop={6}>
                  <Text style={styles.clearWindow}>✕ clear</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          {/* build tray */}
          <View style={[styles.tray, building.length > 0 && { borderTopColor: C.accent }]}>
            <Text style={styles.trayLabel}>{editingId ? 'EDITING CLIP' : openClipId ? `ADDING GROUP ${bundleCount + 1} · SAME CLIP` : 'BUILDING CLIP'}</Text>
            <View style={styles.trayChips}>
              {building.length === 0
                ? <Text style={styles.trayHint}>Tap an event, then a player — stack as many as you want</Text>
                : building.map((b, i) => (
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
              : building.length > 0 ? <Pressable focusable={false} onPress={clearBuilding} style={styles.clearBtn}><Text style={styles.clearTxt}>Clear</Text></Pressable> : null}
            <Pressable focusable={false} onPress={commitClip} disabled={!canAdd} style={[styles.doneBtn, !canAdd && { opacity: 0.35 }]}>
              <Text style={styles.doneTxt}>{saving ? 'Saving…' : editingId ? 'Save changes ↵' : openClipId ? 'Add group ↵' : 'Add clip ↵'}</Text>
            </Pressable>
          </View>

          {/* tag board */}
          <View style={styles.board}>
            {category('players', 'Players', true)}
            <View style={styles.vdiv} />
            {category('offense', 'Offense', true)}
            <View style={styles.vdiv} />
            {category('defense', 'Defense', true)}
            <View style={styles.vdiv} />
            {category('plays', 'Plays', true)}
          </View>

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
                      {g.map((t, i) => (
                        <View key={i} style={[styles.miniTag, { backgroundColor: CAT_COLOR[t.category] ?? C.dim }]}>
                          <Text style={styles.miniTxt}>{t.name}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ))}
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
  transport: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  tBtn: { backgroundColor: C.panel2, borderWidth: 1, borderColor: C.line, borderRadius: 8, height: 32, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  tBtnTxt: { color: C.text, fontSize: 13, fontWeight: '700' },
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

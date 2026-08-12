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

// pre/post-roll auto-window (basketball: the event happens at the END of a
// possession, so reach back further than forward).
const PRE_ROLL = 8;
const POST_ROLL = 3;

const C = {
  bg: '#0b0c10', panel: '#14161c', panel2: '#1b1e26', line: '#262a34',
  text: '#f2f3f6', dim: '#9096a3', faint: '#5b616e', accent: '#6c5ce7',
  players: '#a78bfa', offense: '#4a90e2', defense: '#e2574a', plays: '#3ec46d',
  made: '#3ec46d', star: '#f5c518', poe: '#ff9f43',
};
const CAT_COLOR: Record<string, string> = {
  players: C.players, offense: C.offense, defense: C.defense, plays: C.plays,
};
// Event-tag hotkey pool (players use the number row). Reserved keys (space,
// arrows, enter, backspace) are never in here.
const EVENT_KEYS = 'QWERTYUIOPASDFGHJKLZXCVBNM'.split('');

type Tag = { id: string; name: string; category: string };
type Built = { id: string; name: string; category: string };
type ClipRow = { id: string; start: number; end: number; tags: { name: string; category: string }[]; starred: boolean; poe: boolean };

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
  const [barWidth, setBarWidth] = useState(0);
  const [saving, setSaving] = useState(false);

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
      .select('id, start_time, end_time, is_starred, is_point_of_emphasis, clip_tags ( tags ( name, category ) )')
      .eq('video_id', videoId)
      .order('start_time', { ascending: false });
    setClips((data || []).map((c: any) => ({
      id: c.id, start: c.start_time, end: c.end_time,
      starred: c.is_starred === true, poe: c.is_point_of_emphasis === true,
      tags: (c.clip_tags || []).map((ct: any) => ct.tags).filter(Boolean).map((t: any) => ({ name: t.name, category: t.category })),
    })));
  }, [videoId]);
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
  const clearBuilding = useCallback(() => { setBuilding([]); setIsStar(false); setIsPoe(false); }, []);

  const commitClip = useCallback(async () => {
    if (building.length === 0 || saving || !userId) return;
    const at = player.currentTime || 0;
    const start = Math.max(0, at - PRE_ROLL);
    const end = Math.min(duration || at + POST_ROLL, at + POST_ROLL);
    setSaving(true);
    const { data: clip, error } = await supabase
      .from('clips')
      .insert({ video_id: videoId, team_id: teamId, created_by_user_id: userId, start_time: start, end_time: end, note: '' })
      .select().single();
    if (error || !clip) { setSaving(false); return; }
    const tagIds = [...building.map(b => b.id)];
    if (isStar && special.highlight) tagIds.push(special.highlight);
    if (isPoe && special.poe) tagIds.push(special.poe);
    const rows = tagIds.map(tag_id => ({ clip_id: clip.id, tag_id, bundle_number: 0 }));
    if (rows.length) await supabase.from('clip_tags').insert(rows);
    setSaving(false);
    clearBuilding();
    loadClips();
  }, [building, saving, userId, player, duration, videoId, teamId, isStar, isPoe, special, clearBuilding, loadClips]);

  // ── keyboard (web only — this file is .web.tsx) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (e.key === ' ') { e.preventDefault(); togglePlay(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); seekBy(-1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); seekBy(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); seekBy(5); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); seekBy(-5); return; }
      if (e.key === 'Enter') { e.preventDefault(); commitClip(); return; }
      if (e.key === 'Backspace') { e.preventDefault(); clearBuilding(); return; }
      const k = e.key.toUpperCase();
      for (const cat of ['players', 'offense', 'defense', 'plays'] as const) {
        const hit = tags[cat].find(t => hotkeys[t.id] === k);
        if (hit) { e.preventDefault(); tapTag(hit); return; }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, seekBy, commitClip, clearBuilding, tags, hotkeys, tapTag]);

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

  const tagButton = (t: Tag, cat: string) => {
    const on = builtSet.has(t.id);
    const col = CAT_COLOR[cat];
    return (
      <Pressable key={t.id} onPress={() => tapTag(t)} style={[styles.chip, { borderColor: on ? col : col + 'aa', backgroundColor: on ? col : col + '1c' }]}>
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
        <View style={styles.autosave}><View style={styles.saveDot} /><Text style={styles.autosaveTxt}>Autosaved</Text></View>
      </View>

      <View style={styles.main}>
        {/* left stage */}
        <View style={styles.stage}>
          <View style={styles.videoWrap}>
            <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls={false} contentFit="contain" />
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
                  <View style={[styles.scrubFill, { width: `${Math.round(progress * 100)}%` }]} />
                </View>
                <View style={[styles.scrubHead, { left: `${Math.round(progress * 100)}%` }]} />
              </View>
            </GestureDetector>
            <View style={styles.transport}>
              <Pressable style={styles.tBtn} onPress={() => seekBy(-5)}><Text style={styles.tBtnTxt}>−5s</Text></Pressable>
              <Pressable style={[styles.tBtn, styles.tPlay]} onPress={togglePlay}><Text style={styles.tPlayTxt}>{isPlaying ? '❚❚' : '▶'}</Text></Pressable>
              <Pressable style={styles.tBtn} onPress={() => seekBy(5)}><Text style={styles.tBtnTxt}>+5s</Text></Pressable>
              <Text style={styles.tTime}>{fmt(currentTime)} <Text style={styles.tTotal}>/ {fmt(duration)}</Text></Text>
            </View>
          </View>

          {/* build tray */}
          <View style={[styles.tray, building.length > 0 && { borderTopColor: C.accent }]}>
            <Text style={styles.trayLabel}>BUILDING CLIP</Text>
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
            <Pressable onPress={() => setIsStar(s => !s)} style={[styles.flag, isStar && { borderColor: C.star }]}><Text style={{ color: isStar ? C.star : C.faint, fontWeight: '800' }}>★</Text></Pressable>
            <Pressable onPress={() => setIsPoe(p => !p)} style={[styles.flag, isPoe && { borderColor: C.poe }]}><Text style={{ color: isPoe ? C.poe : C.faint, fontWeight: '800' }}>◎ POE</Text></Pressable>
            {building.length > 0 ? <Pressable onPress={clearBuilding} style={styles.clearBtn}><Text style={styles.clearTxt}>Clear</Text></Pressable> : null}
            <Pressable onPress={commitClip} disabled={building.length === 0 || saving} style={[styles.doneBtn, (building.length === 0 || saving) && { opacity: 0.35 }]}>
              <Text style={styles.doneTxt}>Done ↵</Text>
            </Pressable>
          </View>

          {/* tag board */}
          <View style={styles.board}>
            {category('players', 'Players')}
            <View style={styles.vdiv} />
            {category('offense', 'Offense', true)}
            <View style={styles.vdiv} />
            {category('defense', 'Defense', true)}
            <View style={styles.vdiv} />
            {category('plays', 'Plays', true)}
          </View>

          <View style={styles.shortcuts}>
            <Text style={styles.scTxt}>Space play/pause · ←→ ±1s · ↑↓ ±5s · number = player · letter = event · ↵ done · ⌫ clear</Text>
          </View>
        </View>

        {/* right clip list */}
        <View style={styles.clipsPanel}>
          <View style={styles.clipsHead}><Text style={styles.clipsTitle}>CLIPS</Text><Text style={styles.clipsCount}>{clips.length} saved</Text></View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 10 }}>
            {clips.map(c => (
              <View key={c.id} style={styles.clipCard}>
                <Text style={styles.clipTime}>{fmt(c.start)}</Text>
                <View style={styles.clipTags}>
                  {c.tags.map((t, i) => (
                    <View key={i} style={[styles.miniTag, { backgroundColor: CAT_COLOR[t.category] ?? C.dim }]}>
                      <Text style={styles.miniTxt}>{t.name}</Text>
                    </View>
                  ))}
                </View>
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
  videoWrap: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', minHeight: 0, overflow: 'hidden' },
  videoOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 10 },
  overlayTxt: { color: '#fff', fontSize: 14, fontWeight: '600' },

  scrubZone: { backgroundColor: C.panel, borderTopWidth: 1, borderTopColor: C.line, paddingHorizontal: 18, paddingTop: 9, paddingBottom: 7 },
  scrubTouch: { height: 18, justifyContent: 'center' },
  scrubTrack: { height: 6, backgroundColor: C.line, borderRadius: 3 },
  scrubFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: C.accent, borderRadius: 3 },
  scrubHead: { position: 'absolute', width: 15, height: 15, borderRadius: 8, backgroundColor: '#fff', marginLeft: -7, top: '50%', marginTop: -7.5 },
  transport: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  tBtn: { backgroundColor: C.panel2, borderWidth: 1, borderColor: C.line, borderRadius: 8, height: 32, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  tBtnTxt: { color: C.text, fontSize: 13, fontWeight: '700' },
  tPlay: { backgroundColor: '#fff', minWidth: 46 },
  tPlayTxt: { color: '#000', fontSize: 14, fontWeight: '800' },
  tTime: { color: C.text, fontSize: 13, fontWeight: '700', marginLeft: 4 },
  tTotal: { color: C.faint, fontWeight: '600' },

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
  catCol: {},
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
  clipTime: { fontSize: 11, fontWeight: '700', color: C.dim },
  clipTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 7, alignItems: 'center' },
  miniTag: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 12 },
  miniTxt: { fontSize: 11, fontWeight: '700', color: '#12100a' },
  clipFoot: { marginTop: 7, fontSize: 10, fontWeight: '700', color: C.star },
  clipsEmpty: { color: C.faint, fontSize: 13, textAlign: 'center', marginTop: 30 },
});

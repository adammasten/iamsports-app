// Fullscreen plays-through game player (card-system). Plays a game's videos in order
// with AUTO-ADVANCE, a DUAL progress bar (segmented game timeline + within-video bar),
// and transport controls. WIDESCREEN via a ⛶ button that force-rotates to landscape
// using MY controls (NOT expo-video native fullscreen, which hid the controls). Robust
// loading: mirrors the Tagger — re-mint the signed URL and retry up to 3× on a cold
// 'error', then a tap-to-retry overlay (fixes the "crossed-out, then plays" cold-load).
import { Ionicons } from '@expo/vector-icons';
import { goBackOrHome } from '@/lib/nav';
import { supabase } from '@/supabase';
import { getSignedVideoUrl } from '@/lib/native/video-url';
import { getCachedPathSync } from '@/lib/native/video-cache';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

const C = { accent: '#6c5ce7' };
type Vid = { id: string; label: string; url: string };

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}

export default function GamePlayerScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const params = useLocalSearchParams();
  const gameId = (Array.isArray(params.id) ? params.id[0] : params.id) as string | undefined;
  // Recipient path (walls): resolve the game's videos RLS-safely by shareId instead
  // of a direct games/videos query (which a non-member can't read).
  const shareId = (Array.isArray(params.shareId) ? params.shareId[0] : params.shareId) as string | undefined;
  const title = ((Array.isArray(params.title) ? params.title[0] : params.title) as string) ?? 'Game';
  const startIndex = parseInt((Array.isArray(params.index) ? params.index[0] : params.index) as string, 10) || 0;

  const [videos, setVideos] = useState<Vid[]>([]);
  // WEB: measured player size so the <video> gets explicit px dims — expo-video's
  // absoluteFill doesn't resolve reliably on web, leaving the frame small/top-left
  // instead of filling + centering. Also track browser-fullscreen state.
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [webFs, setWebFs] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [videoReady, setVideoReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [controls, setControls] = useState(true);
  const [barWidth, setBarWidth] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const wasPlayingRef = useRef(false);

  const videosRef = useRef<Vid[]>([]);
  videosRef.current = videos;
  const retryRef = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const player = useVideoPlayer(null, p => { p.timeUpdateEventInterval = 0.25; });
  const { currentTime } = useEvent(player, 'timeUpdate', { currentTime: 0, currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition: 0 });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: false });
  const { duration: srcDuration } = useEvent(player, 'sourceLoad', { duration: 0, videoSource: null, availableVideoTracks: [], availableSubtitleTracks: [], availableAudioTracks: [] });
  // expo-video on WEB often reports duration 0 in sourceLoad, which zeroes the
  // scrubber + ±5s (all seek math clamps to duration → every seek collapses to 0).
  // Fall back to the player's own duration property (the <video> element knows it;
  // re-read on each timeUpdate render). Native reports it in sourceLoad, so this
  // fallback never engages there — mobile behavior is unchanged.
  const pd = (player as { duration?: number }).duration;
  const duration = srcDuration || (typeof pd === 'number' && Number.isFinite(pd) ? pd : 0);
  const status = useEvent(player, 'statusChange', { status: 'idle', oldStatus: undefined, error: undefined });

  // Load the game's READY videos in order. Recipient (shareId) → resolve_shared_game
  // (RLS-safe for non-members); owner/member (gameId) → direct videos query.
  useEffect(() => {
    (async () => {
      if (shareId) {
        const { data } = await supabase.rpc('resolve_shared_game', { p_share_id: shareId });
        const rows = ((data ?? []) as any[]).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        setVideos(rows.filter(r => r.storage_path).map(r => ({ id: r.video_id, label: r.title, url: r.storage_path })));
      } else if (gameId) {
        const { data } = await supabase.from('videos').select('id, label, url, upload_status').eq('game_id', gameId).eq('upload_status', 'ready').order('sort_order');
        setVideos((data ?? []).map((v: any) => ({ id: v.id, label: v.label, url: v.url })));
      }
    })();
  }, [gameId, shareId]);

  // Leaving the player: STOP playback before the native video surface is torn down —
  // tearing it down mid-play is what caused the "distorted freeze" on back. Then
  // restore portrait, but ONLY if the ⛶ button actually rotated us to landscape.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      try { player.pause(); } catch { /* already released */ }
      // No orientation restore needed: this screen defaults to portrait via the
      // navigator, and popping back returns to a portrait screen. The navigator
      // is the single orientation authority now.
    };
  }, [player]);

  // Load the current video: cached file if present, else a freshly-minted signed URL.
  const loadCurrent = useCallback(async (preferCache: boolean) => {
    const v = videosRef.current[currentIndex];
    if (!v) return;
    const cached = preferCache ? getCachedPathSync(v.id) : null;
    const src = cached ?? await getSignedVideoUrl(v.url, { forceRefresh: true });
    if (!mounted.current) return;
    if (!src) { setLoadError(true); return; }
    // NATIVE: replace + play immediately (works, unchanged). WEB: calling play()
    // before the new source has loaded aborts it ("play() interrupted by a new
    // load request"), looping forever — so on web we defer play() to the
    // readyToPlay handler below.
    try { player.replace(src); if (Platform.OS !== 'web') player.play(); } catch { /* released */ }
  }, [currentIndex, player]);

  // On index change (incl. auto-advance): reset load state + load.
  useEffect(() => {
    if (!videos.length) return;
    retryRef.current = 0;
    setVideoReady(false);
    setLoadError(false);
    loadCurrent(true);
  }, [currentIndex, videos, loadCurrent]);

  // Status → ready / bounded auto-retry (re-mint signed URL) → tap-to-retry.
  useEffect(() => {
    if (status?.status === 'readyToPlay') { retryRef.current = 0; setVideoReady(true); setLoadError(false); if (Platform.OS === 'web') { try { player.play(); } catch {} } return; }
    if (status?.status === 'error') {
      if (retryRef.current < 3) {
        retryRef.current += 1;
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => { retryTimer.current = null; loadCurrent(false); }, 2000);
      } else {
        setLoadError(true);
      }
    }
  }, [status, loadCurrent]);

  // Auto-advance to the next video when one ends.
  useEffect(() => {
    const sub = player.addListener('playToEnd', () => {
      setCurrentIndex(i => (i < videosRef.current.length - 1 ? i + 1 : i));
    });
    return () => sub.remove();
  }, [player]);

  const seekBy = useCallback((d: number) => {
    try { player.currentTime = Math.max(0, Math.min((duration || 0), (player.currentTime || 0) + d)); } catch {}
  }, [player, duration]);
  // Drag-to-scrub: map the touch x within the bar to an absolute time. Pause while
  // dragging (so playback doesn't fight the finger) and resume on release only if
  // we were playing. Frame-accurate currentTime= is fine here — these are optimized
  // 720p faststart streams, so precise seeks are cheap.
  const seekToX = useCallback((x: number) => {
    if (barWidth <= 0 || duration <= 0) return;
    const pct = Math.max(0, Math.min(1, x / barWidth));
    try { player.currentTime = pct * duration; } catch {}
  }, [barWidth, duration, player]);
  const onScrubStart = useCallback(() => {
    wasPlayingRef.current = isPlaying;
    try { player.pause(); } catch {}
    setScrubbing(true);
  }, [isPlaying, player]);
  const onScrubEnd = useCallback(() => {
    setScrubbing(false);
    if (wasPlayingRef.current) { try { player.play(); } catch {} }
  }, [player]);
  const togglePlay = useCallback(() => { try { if (isPlaying) player.pause(); else player.play(); } catch {} }, [player, isPlaying]);
  const toggleFullscreen = useCallback(() => {
    if (Platform.OS === 'web') {
      // Real browser fullscreen (the page IS the player), not orientation lock.
      try {
        const doc: any = typeof document !== 'undefined' ? document : null;
        if (!doc) return;
        if (!doc.fullscreenElement) doc.documentElement?.requestFullscreen?.();
        else doc.exitFullscreen?.();
      } catch { /* fullscreen denied */ }
      return;
    }
    // Native: flip THIS screen's orientation through the navigator. react-native-
    // screens updates the view controller's supported orientations and rotates —
    // no imperative ScreenOrientation.lockAsync (that was the two-authority race).
    navigation.setOptions({ orientation: isLandscape ? 'portrait' : 'landscape' } as any);
  }, [isLandscape, navigation]);
  // Keep the ⛶/⤡ icon in sync with the browser's actual fullscreen state.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onFs = () => setWebFs(!!(document as any).fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const retryNow = useCallback(() => { retryRef.current = 0; setLoadError(false); setVideoReady(false); loadCurrent(false); }, [loadCurrent]);
  // Pause before navigating away so playback stops cleanly (see unmount cleanup).
  const leave = useCallback(() => { try { player.pause(); } catch {} goBackOrHome(); }, [player]);

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const cur = videos[currentIndex];
  const next = videos[currentIndex + 1];

  // Pan captures a plain tap too (minDistance 0), so tapping the bar seeks there.
  // onFinalize covers both a clean end and a cancel, so we always resume playback.
  const scrub = Gesture.Pan()
    .minDistance(0)
    .onBegin(e => { runOnJS(onScrubStart)(); runOnJS(seekToX)(e.x); })
    .onUpdate(e => { runOnJS(seekToX)(e.x); })
    .onFinalize(() => { runOnJS(onScrubEnd)(); });
  const thumbSize = scrubbing ? 18 : 12;
  const thumbX = barWidth > 0 ? Math.max(0, Math.min(barWidth, progress * barWidth)) : 0;

  return (
    <GestureHandlerRootView style={styles.c} onLayout={e => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <Pressable style={[StyleSheet.absoluteFill, styles.videoCenter]} onPress={() => setControls(v => !v)}>
        <VideoView player={player} style={Platform.OS === 'web' ? { width: box.w, height: box.h } : StyleSheet.absoluteFill} nativeControls={false} contentFit="contain" />
      </Pressable>

      {/* Loading / error overlay */}
      {!videoReady && (
        <Pressable style={styles.loading} onPress={loadError ? retryNow : undefined}>
          {loadError ? (
            <>
              <Ionicons name="alert-circle-outline" size={40} color="#fff" />
              <Text style={styles.loadingText}>Couldn&apos;t load this video. Tap to retry.</Text>
            </>
          ) : (
            <ActivityIndicator size="large" color="#fff" />
          )}
        </Pressable>
      )}

      {controls && (
        <>
          <View style={[styles.top, { paddingTop: insets.top + 8, paddingLeft: insets.left + 18, paddingRight: insets.right + 18 }]} pointerEvents="box-none">
            <Pressable onPress={leave} hitSlop={12}><Text style={styles.back}>‹</Text></Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.topTitle} numberOfLines={1}>{title}</Text>
              <Text style={styles.topSub} numberOfLines={1}>{cur ? `${cur.label} · video ${currentIndex + 1} of ${videos.length}` : ''}</Text>
            </View>
            <Pressable onPress={toggleFullscreen} hitSlop={12}>
              <Ionicons name={(Platform.OS === 'web' ? webFs : isLandscape) ? 'contract' : 'expand'} size={22} color="#fff" />
            </Pressable>
          </View>

          <View style={[styles.bottom, { paddingBottom: insets.bottom + 20, paddingLeft: insets.left + 18, paddingRight: insets.right + 18 }]}>
            <View style={styles.timeline}>
              {videos.map((_, j) => (
                <View key={j} style={styles.seg}>
                  <View style={[styles.segFill, {
                    width: j < currentIndex ? '100%' : j === currentIndex ? `${Math.round(progress * 100)}%` : '0%',
                    backgroundColor: j < currentIndex ? 'rgba(255,255,255,0.7)' : C.accent,
                  }]} />
                </View>
              ))}
            </View>
            <GestureDetector gesture={scrub}>
              <View style={styles.scrubZone} onLayout={e => setBarWidth(e.nativeEvent.layout.width)}>
                <View style={styles.clipBar}>
                  <View style={[styles.clipFill, { width: `${Math.round(progress * 100)}%` }]} />
                </View>
                <View style={[styles.thumb, { left: thumbX - thumbSize / 2, width: thumbSize, height: thumbSize, borderRadius: thumbSize / 2, marginTop: -thumbSize / 2 }]} />
              </View>
            </GestureDetector>

            <View style={styles.meta}>
              <Text style={styles.metaText}>{fmt(currentTime)}</Text>
              <Text style={styles.metaText} numberOfLines={1}>{next ? `auto-advances to ${next.label} →` : 'last video'}</Text>
              <Text style={styles.metaText}>{fmt(duration)}</Text>
            </View>

            <View style={styles.transport}>
              <Pressable hitSlop={10} onPress={() => setCurrentIndex(i => Math.max(0, i - 1))} disabled={currentIndex === 0}>
                <Ionicons name="play-skip-back" size={24} color={currentIndex === 0 ? '#555' : '#fff'} />
              </Pressable>
              <Pressable hitSlop={10} onPress={() => seekBy(-5)}><Text style={styles.skip}>-5s</Text></Pressable>
              <Pressable hitSlop={12} onPress={togglePlay} style={styles.playBtn}>
                <Ionicons name={isPlaying ? 'pause' : 'play'} size={26} color="#000" />
              </Pressable>
              <Pressable hitSlop={10} onPress={() => seekBy(5)}><Text style={styles.skip}>+5s</Text></Pressable>
              <Pressable hitSlop={10} onPress={() => setCurrentIndex(i => Math.min(videos.length - 1, i + 1))} disabled={currentIndex >= videos.length - 1}>
                <Ionicons name="play-skip-forward" size={24} color={currentIndex >= videos.length - 1 ? '#555' : '#fff'} />
              </Pressable>
            </View>
          </View>
        </>
      )}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: '#000' },
  videoCenter: { alignItems: 'center', justifyContent: 'center' },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 14 },
  back: { color: '#fff', fontSize: 32, fontWeight: '400', width: 22 },
  topTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  topSub: { color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 2 },

  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingTop: 24 },
  timeline: { flexDirection: 'row', gap: 4, marginBottom: 8 },
  seg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  segFill: { height: '100%', borderRadius: 2 },
  scrubZone: { paddingVertical: 11, marginBottom: 3, justifyContent: 'center' },
  clipBar: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  clipFill: { height: '100%', backgroundColor: '#fff', borderRadius: 2 },
  thumb: { position: 'absolute', top: '50%', backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 8 },
  metaText: { color: 'rgba(255,255,255,0.7)', fontSize: 12, flexShrink: 1 },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22 },
  skip: { color: '#fff', fontSize: 15, fontWeight: '600', opacity: 0.9 },
  playBtn: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
});

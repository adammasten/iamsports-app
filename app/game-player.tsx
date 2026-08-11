// Fullscreen "plays-through" game player — matches the player in
// docs/game-card-prototype.html. Plays the game's videos in order with AUTO-ADVANCE
// (1→2→3), a DUAL progress bar (segmented game timeline on top + within-video bar
// below), and transport controls. Portrait, so it's Expo-Go-testable and avoids the
// landscape orientation issues. Launched from game-detail (watch mode).
import { Ionicons } from '@expo/vector-icons';
import { goBackOrHome } from '@/lib/nav';
import { supabase } from '@/supabase';
import { getSignedVideoUrl } from '@/lib/native/video-url';
import { getCachedPathSync } from '@/lib/native/video-cache';
import { useLocalSearchParams } from 'expo-router';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const C = { accent: '#6c5ce7', text: '#f4f4f6' };
type Vid = { id: string; label: string; url: string };

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}

export default function GamePlayerScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const gameId = (Array.isArray(params.id) ? params.id[0] : params.id) as string;
  const title = ((Array.isArray(params.title) ? params.title[0] : params.title) as string) ?? 'Game';
  const startIndex = parseInt((Array.isArray(params.index) ? params.index[0] : params.index) as string, 10) || 0;

  const [videos, setVideos] = useState<Vid[]>([]);
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [srcLoading, setSrcLoading] = useState(true);
  const [controls, setControls] = useState(true);
  const videosRef = useRef<Vid[]>([]);
  videosRef.current = videos;

  const player = useVideoPlayer(null, p => { p.timeUpdateEventInterval = 0.25; });
  const { currentTime } = useEvent(player, 'timeUpdate', { currentTime: 0, currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition: 0 });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: false });
  const { duration } = useEvent(player, 'sourceLoad', { duration: 0, videoSource: null, availableVideoTracks: [], availableSubtitleTracks: [], availableAudioTracks: [] });

  // Load only the game's READY videos, in order (the "game" queue).
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('videos').select('id, label, url, upload_status').eq('game_id', gameId).eq('upload_status', 'ready').order('sort_order');
      setVideos((data ?? []).map((v: any) => ({ id: v.id, label: v.label, url: v.url })));
    })();
  }, [gameId]);

  // Load + play the current video whenever the index changes (incl. auto-advance).
  useEffect(() => {
    const v = videos[currentIndex];
    if (!v) return;
    let cancelled = false;
    setSrcLoading(true);
    (async () => {
      const cached = getCachedPathSync(v.id);
      const src = cached ?? await getSignedVideoUrl(v.url, { forceRefresh: true });
      if (cancelled) return;
      setSrcLoading(false);
      if (!src) return;
      try { player.replace(src); player.play(); } catch { /* released */ }
    })();
    return () => { cancelled = true; };
  }, [currentIndex, videos, player]);

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
  const togglePlay = useCallback(() => { try { if (isPlaying) player.pause(); else player.play(); } catch {} }, [player, isPlaying]);

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const cur = videos[currentIndex];
  const next = videos[currentIndex + 1];

  return (
    <View style={styles.c}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => setControls(v => !v)}>
        <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls={false} contentFit="contain" />
      </Pressable>
      {srcLoading ? <View style={styles.loading} pointerEvents="none"><ActivityIndicator size="large" color="#fff" /></View> : null}

      {controls && (
        <>
          {/* Top */}
          <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
            <Pressable onPress={goBackOrHome} hitSlop={12}><Text style={styles.back}>‹</Text></Pressable>
            <View>
              <Text style={styles.topTitle} numberOfLines={1}>{title}</Text>
              <Text style={styles.topSub} numberOfLines={1}>{cur ? `${cur.label} · video ${currentIndex + 1} of ${videos.length}` : ''}</Text>
            </View>
          </View>

          {/* Bottom: dual bar + meta + transport */}
          <View style={[styles.bottom, { paddingBottom: insets.bottom + 20 }]}>
            {/* Segmented game timeline — one segment per video */}
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
            {/* Within-video bar */}
            <View style={styles.clipBar}><View style={[styles.clipFill, { width: `${Math.round(progress * 100)}%` }]} /></View>

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
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: '#000' },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingBottom: 14 },
  back: { color: '#fff', fontSize: 32, fontWeight: '400', width: 22 },
  topTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  topSub: { color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 2 },

  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 18, paddingTop: 24 },
  timeline: { flexDirection: 'row', gap: 4, marginBottom: 8 },
  seg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  segFill: { height: '100%', borderRadius: 2 },
  clipBar: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden', marginBottom: 14 },
  clipFill: { height: '100%', backgroundColor: '#fff', borderRadius: 2 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 8 },
  metaText: { color: 'rgba(255,255,255,0.7)', fontSize: 12, flexShrink: 1 },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22 },
  skip: { color: '#fff', fontSize: 15, fontWeight: '600', opacity: 0.9 },
  playBtn: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
});

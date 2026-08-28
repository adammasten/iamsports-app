// Single-video / reel / shared-content viewer. Uses the SAME player UI as
// app/game-player.tsx (fill+center video, custom scrubber/transport, ⛶ fullscreen,
// tap-to-toggle controls) so every video looks identical — per
// docs/VIDEO_PLAYBACK_STANDARD.md. Share-specific actions (Save to My Film /
// Download / Report) live as icons in the top bar. The tagger is the ONE
// exception to this standard and is untouched.
import { useTeamContext } from '@/context';
import { goBackOrHome } from '@/lib/nav';
import { downloadMedia } from '@/lib/native/download-media';
import { getSignedVideoUrl } from '@/lib/native/video-url';
import { supabase } from '@/supabase';
import { Ionicons } from '@expo/vector-icons';
import { useEvent } from 'expo';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showContentActions } from './moderationActions';

const C = { accent: '#6c5ce7' };
function fmt(s: number) { if (!isFinite(s) || s < 0) s = 0; const m = Math.floor(s / 60), sec = Math.floor(s % 60); return `${m}:${sec < 10 ? '0' : ''}${sec}`; }
function param(v: string | string[] | undefined): string { return (Array.isArray(v) ? v[0] : v) ?? ''; }

export default function SharedViewerScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const { userId } = useTeamContext();
  const params = useLocalSearchParams();
  const title = param(params.title);
  const storagePath = param(params.storagePath);
  const startTime = param(params.startTime) ? parseFloat(param(params.startTime)) : null;
  const endTime = param(params.endTime) ? parseFloat(param(params.endTime)) : null;
  // Moderation: threaded from the wall card that opened this. Report shows only
  // for another user's content.
  const contentType = param(params.contentType);
  const contentId = param(params.contentId);
  const shareId = param(params.shareId);
  const sharedBy = param(params.sharedBy);
  const canReport = !!contentId && !!sharedBy && sharedBy !== userId;

  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // Player UI state — mirrors game-player.
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [webFs, setWebFs] = useState(false);
  const [controls, setControls] = useState(true);
  const [barWidth, setBarWidth] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const wasPlayingRef = useRef(false);
  const isMountedRef = useRef(true);
  const didSeekRef = useRef(false);
  const didAutoPlayRef = useRef(false);

  // Save to My Film — a live bookmark to this share (auto-removed if un-shared).
  async function saveToMyFilm() {
    if (!shareId || !userId) return;
    setSaving(true);
    const { error } = await supabase.from('saved_items').insert({ user_id: userId, share_id: shareId });
    setSaving(false);
    if (error) {
      if (error.code === '23505') { setSaved(true); return; } // already saved
      Alert.alert('Couldn’t save', error.message);
      return;
    }
    setSaved(true);
    Alert.alert('Saved to My Film', 'You’ll find it in your Film Room while it’s shared with you.');
  }

  // Download this video to the device (off-platform keep-it-forever copy).
  async function download() {
    if (!storagePath) return;
    setDownloading(true);
    try {
      const { failed: f } = await downloadMedia([{ key: storagePath, filename: title || 'video' }]);
      Alert.alert('Download', f ? 'Couldn’t save this video.' : 'Saved to your device.');
    } catch (e: any) {
      Alert.alert('Download', e?.message ?? 'Download failed.');
    } finally {
      setDownloading(false);
    }
  }

  const player = useVideoPlayer(null, p => { p.pause(); p.timeUpdateEventInterval = 0.25; });
  const { currentTime } = useEvent(player, 'timeUpdate', { currentTime: 0, currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition: 0 });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: false });
  const { duration: srcDuration } = useEvent(player, 'sourceLoad', { duration: 0, videoSource: null, availableVideoTracks: [], availableSubtitleTracks: [], availableAudioTracks: [] });
  // WEB reports duration 0 in sourceLoad → fall back to the player's own property
  // (same fix game-player uses), else the scrubber + ±5s collapse to 0.
  const pd = (player as { duration?: number }).duration;
  const duration = srcDuration || (typeof pd === 'number' && Number.isFinite(pd) ? pd : 0);
  const status = useEvent(player, 'statusChange', { status: 'idle', oldStatus: undefined, error: undefined });
  const ready = status?.status === 'readyToPlay';

  // See game-player: stop playback before the native video surface is torn down
  // (prevents the "distorted freeze" on back), and only restore portrait if we
  // actually rotated to landscape via the ⛶ button.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      try { player.pause(); } catch { /* released */ }
      // Navigator owns orientation; popping returns to a portrait screen.
    };
  }, [player]);

  // Mint a signed URL from the storage path and load it (also the tap-to-retry path).
  const loadSource = useCallback(async () => {
    if (!storagePath) { setFailed(true); return; }
    const url = await getSignedVideoUrl(storagePath, { forceRefresh: true });
    if (!isMountedRef.current) return;
    if (!url) { setFailed(true); return; }
    setFailed(false);
    // NATIVE plays immediately; WEB defers play() to readyToPlay (a play before the
    // new source loads aborts on web).
    try { player.replace(url); if (Platform.OS !== 'web') player.play(); } catch (e) { console.warn('[shared-viewer] replace skipped:', e); }
  }, [storagePath, player]);
  useEffect(() => { loadSource(); }, [loadSource]);

  // Seek to the clip start once ready (single-shot).
  useEffect(() => {
    if (ready && startTime != null && !didSeekRef.current) {
      didSeekRef.current = true;
      try { player.currentTime = startTime; } catch { /* released */ }
    }
  }, [ready, startTime, player]);

  // WEB: auto-start on first ready (manual play right after replace() aborts on web).
  useEffect(() => {
    if (ready && Platform.OS === 'web' && !didAutoPlayRef.current) {
      didAutoPlayRef.current = true;
      try { player.play(); } catch { /* released */ }
    }
  }, [ready, player]);

  // Clip: stop at end_time.
  useEffect(() => {
    if (endTime != null && currentTime >= endTime) {
      try { player.pause(); } catch { /* released */ }
    }
  }, [currentTime, endTime, player]);

  const seekBy = useCallback((d: number) => {
    try { player.currentTime = Math.max(0, Math.min((duration || 0), (player.currentTime || 0) + d)); } catch {}
  }, [player, duration]);
  const seekToX = useCallback((x: number) => {
    if (barWidth <= 0 || duration <= 0) return;
    const pct = Math.max(0, Math.min(1, x / barWidth));
    try { player.currentTime = pct * duration; } catch {}
  }, [barWidth, duration, player]);
  const onScrubStart = useCallback(() => { wasPlayingRef.current = isPlaying; try { player.pause(); } catch {} setScrubbing(true); }, [isPlaying, player]);
  const onScrubEnd = useCallback(() => { setScrubbing(false); if (wasPlayingRef.current) { try { player.play(); } catch {} } }, [player]);
  const togglePlay = useCallback(() => { try { if (isPlaying) player.pause(); else player.play(); } catch {} }, [player, isPlaying]);
  // Pause before navigating away so playback stops cleanly (see unmount cleanup).
  const leave = useCallback(() => { try { player.pause(); } catch {} goBackOrHome(); }, [player]);
  const toggleFullscreen = useCallback(() => {
    if (Platform.OS === 'web') {
      try {
        const doc: any = typeof document !== 'undefined' ? document : null;
        if (!doc) return;
        if (!doc.fullscreenElement) doc.documentElement?.requestFullscreen?.();
        else doc.exitFullscreen?.();
      } catch { /* fullscreen denied */ }
      return;
    }
    // Native: flip THIS screen's orientation via the navigator (no lockAsync).
    navigation.setOptions({ orientation: isLandscape ? 'portrait' : 'landscape' } as any);
  }, [isLandscape, navigation]);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onFs = () => setWebFs(!!(document as any).fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const scrub = Gesture.Pan()
    .minDistance(0)
    .onBegin(e => { runOnJS(onScrubStart)(); runOnJS(seekToX)(e.x); })
    .onUpdate(e => { runOnJS(seekToX)(e.x); })
    .onFinalize(() => { runOnJS(onScrubEnd)(); });

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const thumbSize = scrubbing ? 18 : 12;
  const thumbX = barWidth > 0 ? Math.max(0, Math.min(barWidth, progress * barWidth)) : 0;

  return (
    <GestureHandlerRootView style={styles.c} onLayout={e => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <Pressable style={[StyleSheet.absoluteFill, styles.videoCenter]} onPress={() => setControls(v => !v)}>
        <VideoView player={player} style={Platform.OS === 'web' ? { width: box.w, height: box.h } : StyleSheet.absoluteFill} nativeControls={false} contentFit="contain" />
      </Pressable>

      {!ready && (
        <Pressable style={styles.loading} onPress={failed ? loadSource : undefined}>
          {failed ? (
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
            <View style={{ flex: 1 }}><Text style={styles.topTitle} numberOfLines={1}>{title || 'Video'}</Text></View>
            {!!shareId && (
              <Pressable onPress={saveToMyFilm} disabled={saving || saved} hitSlop={10}>
                <Ionicons name={saved ? 'checkmark-circle' : 'bookmark-outline'} size={22} color={saved ? C.accent : '#fff'} />
              </Pressable>
            )}
            {!!storagePath && (
              <Pressable onPress={download} disabled={downloading} hitSlop={10}>
                {downloading ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="download-outline" size={22} color="#fff" />}
              </Pressable>
            )}
            {canReport && (
              <Pressable onPress={() => showContentActions({ contentType, contentId, shareId, sharedByUserId: sharedBy })} hitSlop={10}>
                <Ionicons name="flag-outline" size={20} color="#fff" />
              </Pressable>
            )}
            <Pressable onPress={toggleFullscreen} hitSlop={12}>
              <Ionicons name={(Platform.OS === 'web' ? webFs : isLandscape) ? 'contract' : 'expand'} size={22} color="#fff" />
            </Pressable>
          </View>

          <View style={[styles.bottom, { paddingBottom: insets.bottom + 20, paddingLeft: insets.left + 18, paddingRight: insets.right + 18 }]}>
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
              <Text style={styles.metaText}>{fmt(duration)}</Text>
            </View>
            <View style={styles.transport}>
              <Pressable hitSlop={10} onPress={() => seekBy(-5)}><Text style={styles.skip}>-5s</Text></Pressable>
              <Pressable hitSlop={12} onPress={togglePlay} style={styles.playBtn}>
                <Ionicons name={isPlaying ? 'pause' : 'play'} size={26} color="#000" />
              </Pressable>
              <Pressable hitSlop={10} onPress={() => seekBy(5)}><Text style={styles.skip}>+5s</Text></Pressable>
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
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 16, paddingBottom: 14 },
  back: { color: '#fff', fontSize: 32, fontWeight: '400', width: 22 },
  topTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingTop: 24 },
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

import { useTeamContext } from '@/context';
import { getSignedVideoUrl } from '@/lib/native/video-url';
import { useEvent } from 'expo';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showContentActions } from './moderationActions';

function param(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

export default function SharedViewerScreen() {
  const insets = useSafeAreaInsets();
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
  const isMountedRef = useRef(true);
  const didSeekRef = useRef(false);

  const player = useVideoPlayer(null, p => {
    p.pause();
    p.timeUpdateEventInterval = 0.5;
  });

  useEffect(() => {
    return () => { isMountedRef.current = false; };
  }, []);

  // Mint a signed URL from the storage path and load it.
  useEffect(() => {
    (async () => {
      if (!storagePath) { setFailed(true); return; }
      const url = await getSignedVideoUrl(storagePath);
      if (!isMountedRef.current) return;
      if (!url) { setFailed(true); return; }
      try { player.replace(url); } catch (e) { console.warn('[shared-viewer] replace skipped:', e); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storagePath]);

  const { status } = useEvent(player, 'statusChange', {
    status: 'idle' as const, oldStatus: undefined, error: undefined,
  });

  // Clip: seek to start once ready (once).
  useEffect(() => {
    if (status === 'readyToPlay' && startTime != null && !didSeekRef.current) {
      didSeekRef.current = true;
      try { player.currentTime = startTime; } catch (e) { console.warn('[shared-viewer] seek skipped:', e); }
    }
  }, [status, startTime, player]);

  // Clip: stop at end_time.
  const { currentTime } = useEvent(player, 'timeUpdate', {
    currentTime: 0, currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition: 0,
  });
  useEffect(() => {
    if (endTime != null && currentTime >= endTime) {
      try { player.pause(); } catch { /* released */ }
    }
  }, [currentTime, endTime, player]);

  const ready = status === 'readyToPlay';

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.topRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        {canReport && (
          <TouchableOpacity onPress={() => showContentActions({ contentType, contentId, shareId, sharedByUserId: sharedBy })} style={styles.back}>
            <Text style={styles.reportText}>Report</Text>
          </TouchableOpacity>
        )}
      </View>
      <Text style={styles.title} numberOfLines={1}>{title || 'Shared video'}</Text>
      <View style={styles.videoWrap}>
        <VideoView player={player} style={styles.video} contentFit="contain" />
        {!ready && !failed ? (
          <View style={styles.overlay}><ActivityIndicator size="large" color="#534AB7" /></View>
        ) : null}
        {failed ? (
          <View style={styles.overlay}><Text style={styles.err}>Couldn&apos;t load this video.</Text></View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingHorizontal: 20 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { paddingVertical: 8 },
  backText: { color: '#534AB7', fontSize: 16 },
  reportText: { color: '#534AB7', fontSize: 15 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', marginVertical: 12 },
  videoWrap: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, overflow: 'hidden', backgroundColor: '#111' },
  video: { width: '100%', height: '100%' },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  err: { color: '#aaa', fontSize: 14 },
});

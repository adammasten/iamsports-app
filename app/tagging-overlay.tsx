// V2 overlay tagging screen — Phase A skeleton.
// Scope: landscape lock + full-bleed video with expo-video chrome suppressed.
// All UI chrome (top bar, bundle strip, controls row, tag region, tap-to-hide)
// is built up in Phases B–E. Routed to from app/game.tsx via a TEMP Alert
// option until Phase G flips /tagging → /tagging-overlay.
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback } from 'react';
import { AppState, InteractionManager, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function TaggingOverlayScreen() {
  const params = useLocalSearchParams();
  const videoUrl = Array.isArray(params.url) ? params.url[0] : params.url;
  const startAt = params.startAt
    ? parseFloat(Array.isArray(params.startAt) ? params.startAt[0] : (params.startAt as string))
    : null;

  const player = useVideoPlayer(videoUrl, p => {
    // Phase A: auto-play so motion confirms render works. Phase C swaps this for
    // pause-on-entry once the play/pause button exists in the bottom controls row.
    p.play();
    if (startAt !== null) {
      setTimeout(() => { p.currentTime = startAt; }, 800);
    }
  });

  // Lock landscape on focus, restore portrait on blur. useFocusEffect (not
  // useEffect) so the restore fires before the previous screen re-renders,
  // avoiding a portrait-flash on back navigation. AppState listener nested
  // inside so it only fires while this screen is focused.
  useFocusEffect(
    useCallback(() => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);

      const sub = AppState.addEventListener('change', state => {
        if (state === 'active') {
          ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
        }
      });

      return () => {
        sub.remove();
        // iOS's OS rotation animation can preempt the in-flight navigation
        // transition if we lock synchronously on blur, intermittently leaving
        // the user stuck on this screen in portrait. Defer until after the
        // current transition settles.
        InteractionManager.runAfterInteractions(() => {
          ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        });
      };
    }, [])
  );

  return (
    <View style={styles.container}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFillObject}
        nativeControls={false}
        allowsFullscreen={false}
        allowsPictureInPicture={false}
        contentFit="contain"
      />
      {/* TEMP Phase A — escape hatch until Phase B's styled top bar lands. */}
      <TouchableOpacity style={styles.tempBack} onPress={() => router.back()}>
        <Text style={styles.tempBackText}>← Back</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  tempBack: {
    position: 'absolute',
    top: 20,
    left: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  tempBackText: { color: '#fff', fontSize: 14 },
});

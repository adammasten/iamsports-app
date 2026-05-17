// V2 overlay tagging screen — Phase A skeleton + Phase B visual chrome + Phase C controls.
// Scope so far: landscape lock, full-bleed video with native chrome suppressed,
// styled top bar (Back + disabled Save Clip placeholder + gradient backdrop),
// right-edge bundle strip with hardcoded placeholder pills, and a bottom
// controls row (timestamp, play/pause, Mark Start, Mark End, Highlight). Clip
// marking state is local-only — save wiring lands in Phase F. Routed to from
// app/game.tsx via a TEMP Alert option until Phase G flips /tagging.
import { useEvent } from 'expo';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useState } from 'react';
import { AppState, InteractionManager, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function TaggingOverlayScreen() {
  const params = useLocalSearchParams();
  const videoUrl = Array.isArray(params.url) ? params.url[0] : params.url;
  const startAt = params.startAt
    ? parseFloat(Array.isArray(params.startAt) ? params.startAt[0] : (params.startAt as string))
    : null;
  const insets = useSafeAreaInsets();

  const [startTime, setStartTime] = useState<number | null>(null);
  const [endTime, setEndTime] = useState<number | null>(null);
  const [isHighlight, setIsHighlight] = useState(false);

  const player = useVideoPlayer(videoUrl, p => {
    // Phase C: pause on entry. User starts playback via the bottom-row button.
    p.pause();
    if (startAt !== null) {
      setTimeout(() => { p.currentTime = startAt; }, 800);
    }
  });

  // Reactive player state. expo-video fires timeUpdate at the interval defined
  // by player.timeUpdateEventInterval (default 0.5s) — fine for a M:SS display.
  // Bump it lower later if the tick feels laggy when scrubbing manually.
  const { currentTime } = useEvent(player, 'timeUpdate', {
    currentTime: 0,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    bufferedPosition: 0,
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: false });

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

      {/* Top bar — gradient backdrop + Back (left) + Save Clip (right, disabled placeholder) */}
      <LinearGradient
        colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0)']}
        style={[styles.topGradient, { paddingTop: insets.top }]}
        pointerEvents="box-none"
      >
        <View
          style={[styles.topBar, { paddingLeft: insets.left + 12, paddingRight: insets.right + 12 }]}
          pointerEvents="box-none"
        >
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
            <Text style={styles.backBtnText}>←</Text>
          </TouchableOpacity>
          {/* Save Clip wires up in Phase F — disabled placeholder. */}
          <TouchableOpacity style={styles.saveBtn} disabled>
            <Text style={styles.saveBtnText}>Save Clip</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>

      {/* Right-edge bundle strip — visual only. Pills become tappable in Phase D. */}
      <View
        style={[
          styles.bundleStripContainer,
          { top: insets.top + 60, bottom: insets.bottom + 80, right: insets.right + 8 },
        ]}
        pointerEvents="box-none"
      >
        <ScrollView
          contentContainerStyle={styles.bundleStripContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.pill, styles.pillActive]}>
            <Text style={styles.pillTextActive}>Clip</Text>
          </View>
          {[1, 2, 3].map(n => (
            <View key={n} style={[styles.pill, styles.pillInactive]}>
              <Text style={styles.pillTextInactive}>{n}</Text>
            </View>
          ))}
          <View style={[styles.pill, styles.pillAdd]}>
            <Text style={styles.pillTextAdd}>+</Text>
          </View>
        </ScrollView>
      </View>

      {/* Bottom controls — timestamp, play/pause, Mark Start/End, Highlight.
          State is local-only here; Save wiring in Phase F batches into supabase. */}
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.6)']}
        style={[styles.bottomGradient, { paddingBottom: insets.bottom }]}
        pointerEvents="box-none"
      >
        <View
          style={[styles.controlsRow, { paddingLeft: insets.left + 12, paddingRight: insets.right + 12 }]}
          pointerEvents="box-none"
        >
          <View style={styles.leftGroup}>
            <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
            <TouchableOpacity
              style={styles.playBtn}
              onPress={() => (isPlaying ? player.pause() : player.play())}
              hitSlop={8}
            >
              <Text style={styles.playBtnText}>{isPlaying ? '❚❚' : '▶'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.markGroup}>
            <TouchableOpacity
              style={[styles.markBtn, styles.markStartBtn]}
              onPress={() => setStartTime(player.currentTime)}
            >
              <Text style={styles.markBtnText}>
                {startTime !== null ? `Start ${formatTime(startTime)}` : 'Mark Start'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.markBtn, styles.markEndBtn]}
              onPress={() => setEndTime(player.currentTime)}
            >
              <Text style={styles.markBtnText}>
                {endTime !== null ? `End ${formatTime(endTime)}` : 'Mark End'}
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.highlightBtn, isHighlight && styles.highlightBtnActive]}
            onPress={() => setIsHighlight(v => !v)}
            hitSlop={8}
          >
            <Text style={[styles.highlightStar, isHighlight && styles.highlightStarActive]}>★</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </View>
  );
}

const PILL_SIZE = 44;
const PILL_SPACING = 4;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 100,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: 60,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  backBtnText: { color: '#534AB7', fontSize: 28, fontWeight: '600' },

  saveBtn: {
    width: 120,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#534AB7',
    opacity: 0.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  bundleStripContainer: {
    position: 'absolute',
    width: PILL_SIZE,
  },
  bundleStripContent: {
    gap: PILL_SPACING,
    alignItems: 'center',
    paddingVertical: 4,
  },
  pill: {
    width: PILL_SIZE,
    height: PILL_SIZE,
    borderRadius: PILL_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pillActive: {
    backgroundColor: '#534AB7',
  },
  pillInactive: {
    backgroundColor: 'rgba(83, 74, 183, 0.4)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  pillAdd: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.5)',
    borderStyle: 'dashed',
  },
  pillTextActive: { color: '#fff', fontSize: 11, fontWeight: '700' },
  pillTextInactive: { color: '#fff', fontSize: 14, fontWeight: '600' },
  pillTextAdd: { color: 'rgba(255, 255, 255, 0.7)', fontSize: 22, fontWeight: '300' },

  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 96,
    justifyContent: 'flex-end',
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: 56,
  },
  leftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  timeText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    minWidth: 44,
  },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  markGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  markBtn: {
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 110,
  },
  markStartBtn: { backgroundColor: '#1D9E75' },
  markEndBtn: { backgroundColor: '#D85A30' },
  markBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  highlightBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#EF9F27',
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  highlightBtnActive: {
    backgroundColor: '#EF9F27',
  },
  highlightStar: { color: '#EF9F27', fontSize: 18, fontWeight: '600' },
  highlightStarActive: { color: '#fff' },
});

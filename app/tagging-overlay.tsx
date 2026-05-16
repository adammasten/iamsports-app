// V2 overlay tagging screen — Phase A skeleton + Phase B visual chrome.
// Scope so far: landscape lock, full-bleed video with native chrome
// suppressed, styled top bar (Back + disabled Save Clip placeholder + gradient
// backdrop), and a right-edge bundle strip with hardcoded placeholder pills.
// No state wiring yet — Phases C–F build that on top. Routed to from
// app/game.tsx via a TEMP Alert option until Phase G flips /tagging.
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback } from 'react';
import { AppState, InteractionManager, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TaggingOverlayScreen() {
  const params = useLocalSearchParams();
  const videoUrl = Array.isArray(params.url) ? params.url[0] : params.url;
  const startAt = params.startAt
    ? parseFloat(Array.isArray(params.startAt) ? params.startAt[0] : (params.startAt as string))
    : null;
  const insets = useSafeAreaInsets();

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
          { top: insets.top + 68, bottom: insets.bottom + 60, right: insets.right + 8 },
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
});

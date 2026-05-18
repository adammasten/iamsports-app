// V2 overlay tagging screen — Phases A-G + F.2 scrub + F.3 translucency + F.4 tall tag region.
// Two tag modes: compact (default — tag region above the bottom controls row)
// and fullscreen (tag region grows up under the top bar). Everything else
// stays the same in both modes: top bar, right-edge bundle strip, scrub bar,
// bottom controls row. Toggle is in the bottom controls row (rightmost).
import { useTeamContext } from '@/context';
import { supabase } from '@/supabase';
import { useEvent } from 'expo';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, InteractionManager, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Mirrors app/tagging.tsx, app/(tabs)/tags.tsx, app/export.tsx — per CLAUDE.md,
// the category list is a hardcoded literal across multiple files. Keep in sync.
const CATEGORIES = [
  { key: 'offense', label: 'Offense', color: '#1a6fd4', bg: '#e8f0fe' },
  { key: 'defense', label: 'Defense', color: '#c0392b', bg: '#fde8e8' },
  { key: 'plays',   label: 'Plays',   color: '#1e8449', bg: '#e8f8ed' },
  { key: 'players', label: 'Players', color: '#7d3c98', bg: '#f5eef8' },
];

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Converts a #RRGGBB hex string to rgba(...) with the given alpha. Used in F.3
// for translucent chip backgrounds/borders without polluting the CATEGORIES
// literal (which mirrors the portrait UI's shape — see CLAUDE.md).
function colorWithAlpha(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function TaggingOverlayScreen() {
  const params = useLocalSearchParams();
  const videoUrl = Array.isArray(params.url) ? params.url[0] : params.url;
  const videoId = Array.isArray(params.videoId) ? params.videoId[0] : params.videoId;
  const startAt = params.startAt
    ? parseFloat(Array.isArray(params.startAt) ? params.startAt[0] : (params.startAt as string))
    : null;
  const insets = useSafeAreaInsets();
  const { profileId, teamId } = useTeamContext();

  const [startTime, setStartTime] = useState<number | null>(null);
  const [endTime, setEndTime] = useState<number | null>(null);
  const [isHighlight, setIsHighlight] = useState(false);
  const [saving, setSaving] = useState(false);

  const [clipLevelTags, setClipLevelTags] = useState<string[]>([]);
  const [bundles, setBundles] = useState<string[][]>([]);
  const [activeSection, setActiveSection] = useState<'clip' | number>('clip');
  const [tags, setTags] = useState<Record<string, any[]>>({ offense: [], defense: [], plays: [], players: [] });

  // Chrome visibility — pointerEvents flips synchronously via React state; the
  // opacity transition is driven by Reanimated over 200ms. Both must move
  // together (state synchronously, animation following) so the user never
  // sees the chrome visually faded but still intercepting taps.
  const [controlsVisible, setControlsVisible] = useState(true);
  const chromeOpacity = useSharedValue(1);
  const animatedChromeStyle = useAnimatedStyle(() => ({ opacity: chromeOpacity.value }));

  useEffect(() => {
    chromeOpacity.value = withTiming(controlsVisible ? 1 : 0, { duration: 200 });
  }, [controlsVisible, chromeOpacity]);

  const player = useVideoPlayer(videoUrl, p => {
    // Phase C: pause on entry. User starts playback via the bottom-row button.
    p.pause();
    // expo-video defaults timeUpdateEventInterval to 0 (event never fires) —
    // set explicitly so the bottom-row timestamp ticks during playback.
    p.timeUpdateEventInterval = 0.5;
    if (startAt !== null) {
      setTimeout(() => { p.currentTime = startAt; }, 800);
    }
  });

  // Reactive player state. timeUpdate fires every
  // player.timeUpdateEventInterval seconds (set explicitly in the useVideoPlayer
  // setup above — the package's own default is 0, which disables the event).
  const { currentTime } = useEvent(player, 'timeUpdate', {
    currentTime: 0,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    bufferedPosition: 0,
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: false });

  // sourceLoad fires once when metadata loads — gives us the real duration
  // immediately. Without it, player.duration reads 0 until the first
  // timeUpdate after play() (bad UX: display shows "0:42 / 0:00" initially).
  const { duration } = useEvent(player, 'sourceLoad', {
    videoSource: null,
    duration: 0,
    availableVideoTracks: [],
    availableSubtitleTracks: [],
    availableAudioTracks: [],
  });

  // Scrub bar state — dragging drives thumb size + tooltip visibility;
  // barWidth captured via onLayout for pixel→time conversion.
  const [dragging, setDragging] = useState(false);
  const [barWidth, setBarWidth] = useState(0);

  // F.4 tag mode. 'compact' (default) = tag region above bottom controls.
  // 'fullscreen' = tag region also covers the video area between top bar and
  // bottom controls (more rows of chips visible without scrolling). All other
  // chrome (top bar, right-edge strip, scrub, bottom controls) stays in both
  // modes — only the tag region's top offset changes. No state resets on mode
  // switch; coach can scrub for the next play without leaving fullscreen.
  const [tagMode, setTagMode] = useState<'compact' | 'fullscreen'>('compact');

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

  // Fetch tags scoped to the current profile/team. The .or(...) syntax must
  // match app/tagging.tsx exactly — per CLAUDE.md, getting it wrong silently
  // leaks tags across players.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let query = supabase.from('tags').select('*').order('sort_order');
      if (profileId && teamId && teamId !== 'all') {
        query = query.or(`scope.eq.global,and(scope.eq.player,profile_id.eq.${profileId}),and(scope.eq.team,team_id.eq.${teamId})`);
      } else if (profileId) {
        query = query.or(`scope.eq.global,and(scope.eq.player,profile_id.eq.${profileId})`);
      } else {
        query = query.eq('scope', 'global');
      }
      const { data, error } = await query;
      if (cancelled) return;
      if (error) {
        Alert.alert('Error', error.message);
        return;
      }
      const grouped: Record<string, any[]> = { offense: [], defense: [], plays: [], players: [] };
      (data || []).forEach((t: any) => {
        if (grouped[t.category]) grouped[t.category].push(t);
      });
      setTags(grouped);
    })();
    return () => { cancelled = true; };
  }, [profileId, teamId]);

  function toggleTag(tagId: string) {
    if (activeSection === 'clip') {
      setClipLevelTags(prev =>
        prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
      );
    } else {
      const idx = activeSection;
      setBundles(prev => prev.map((bundle, i) => {
        if (i !== idx) return bundle;
        return bundle.includes(tagId) ? bundle.filter(id => id !== tagId) : [...bundle, tagId];
      }));
    }
  }

  function addBundle() {
    const newIdx = bundles.length;
    setBundles(prev => [...prev, []]);
    setActiveSection(newIdx);
  }

  function removeBundle(idx: number) {
    const bundle = bundles[idx];
    const doRemove = () => {
      setBundles(prev => prev.filter((_, i) => i !== idx));
      if (activeSection === idx) {
        setActiveSection('clip');
      } else if (typeof activeSection === 'number' && activeSection > idx) {
        setActiveSection(activeSection - 1);
      }
    };
    if (bundle && bundle.length > 0) {
      Alert.alert(
        'Remove bundle?',
        `Bundle ${idx + 1} has ${bundle.length} tag(s). This can't be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: doRemove },
        ]
      );
    } else {
      doRemove();
    }
  }

  const activeTags = activeSection === 'clip'
    ? clipLevelTags
    : (bundles[activeSection] ?? []);

  const hasClipMarked = startTime !== null && endTime !== null;
  const canSave = hasClipMarked && !saving;

  // Using seekBy (keyframe-tolerant, ~10x faster than currentTime= which is
  // frame-accurate). Clips land at keyframe boundaries (0.5-2s granularity);
  // coaches fine-tune with -1s/+1s after rough seek. Per expo-video docs,
  // this is the recommended path for non-precise seeks.
  function seekToX(x: number) {
    if (barWidth <= 0 || duration <= 0) return;
    const pct = Math.max(0, Math.min(1, x / barWidth));
    const targetTime = pct * duration;
    const delta = targetTime - player.currentTime;
    player.seekBy(delta);
  }

  function skip(deltaSeconds: number) {
    if (duration <= 0) return;
    const currentTime = player.currentTime;
    const clampedTarget = Math.max(0, Math.min(duration, currentTime + deltaSeconds));
    const clampedDelta = clampedTarget - currentTime;
    player.seekBy(clampedDelta);
  }

  function handleDragStart(x: number) {
    player.pause();
    seekToX(x);
  }

  // Pan gesture handles both single tap (onBegin only, no movement) and drag
  // (onBegin + onUpdate sequence). On release, video stays paused per spec —
  // user hits play when ready to verify the seek. runOnJS bridges from the
  // worklet (UI thread) to the JS-side setters and player methods.
  const pan = Gesture.Pan()
    .onBegin(e => {
      runOnJS(setDragging)(true);
      runOnJS(handleDragStart)(e.x);
    })
    .onUpdate(e => {
      runOnJS(seekToX)(e.x);
    })
    .onEnd(() => {
      runOnJS(setDragging)(false);
    });

  const thumbX = duration > 0 ? Math.max(0, Math.min(barWidth, (currentTime / duration) * barWidth)) : 0;
  const TOOLTIP_WIDTH = 50;
  const tooltipLeft = Math.max(0, Math.min(barWidth - TOOLTIP_WIDTH, thumbX - TOOLTIP_WIDTH / 2));

  // Mirrors app/tagging.tsx:123-190 verbatim. The bundle_number contract
  // (clip-level = 0, bundles[idx] = idx + 1) is what app/export.tsx's
  // clipMatchesGroup relies on — off-by-one here silently breaks bundle
  // attribution in exports. Reset only on the success path (Alert OK).
  async function saveClip() {
    if (startTime === null || endTime === null) {
      Alert.alert('Missing times', 'Please mark a start and end time first.');
      return;
    }
    if (endTime <= startTime) {
      Alert.alert('Invalid clip', 'End time must be after start time.');
      return;
    }
    setSaving(true);

    const { data: clip, error: clipError } = await supabase
      .from('clips')
      .insert({
        video_id: videoId,
        start_time: startTime,
        end_time: endTime,
        is_starred: isHighlight,
        note: '',
      })
      .select()
      .single();

    if (clipError) {
      Alert.alert('Error saving clip', clipError.message);
      setSaving(false);
      return;
    }

    const rows: any[] = [];
    for (const tagId of clipLevelTags) {
      rows.push({ clip_id: clip.id, tag_id: tagId, bundle_number: 0 });
    }
    bundles.forEach((bundle, idx) => {
      const bundleNum = idx + 1;
      for (const tagId of bundle) {
        rows.push({ clip_id: clip.id, tag_id: tagId, bundle_number: bundleNum });
      }
    });

    if (rows.length > 0) {
      const { error: tagError } = await supabase.from('clip_tags').insert(rows);
      if (tagError) {
        Alert.alert('Error saving tags', tagError.message);
        setSaving(false);
        return;
      }
    }

    const nonEmptyBundles = bundles.filter(b => b.length > 0).length;
    Alert.alert(
      'Saved!',
      `Clip saved with ${rows.length} tag(s)${nonEmptyBundles > 0 ? ` across ${nonEmptyBundles} bundle(s)` : ''}.`,
      [{
        text: 'OK',
        onPress: () => {
          setStartTime(null);
          setEndTime(null);
          setIsHighlight(false);
          setClipLevelTags([]);
          setBundles([]);
          setActiveSection('clip');
        },
      }]
    );
    setSaving(false);
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFillObject}
        nativeControls={false}
        allowsFullscreen={false}
        allowsPictureInPicture={false}
        contentFit="contain"
      />

      {/* Tap-to-hide layer. Single tap toggles chrome visibility. onLongPress
          is a no-op but its mere presence claims the long-press gesture,
          preventing iOS Live Text's "Copy All" popup from firing on the video.
          Sits above VideoView, below the chrome wrapper. */}
      <Pressable
        style={StyleSheet.absoluteFillObject}
        onPress={() => setControlsVisible(v => !v)}
        onLongPress={() => {}}
      />

      <Animated.View
        style={[StyleSheet.absoluteFillObject, animatedChromeStyle]}
        pointerEvents={controlsVisible ? 'box-none' : 'none'}
      >
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
            <TouchableOpacity
              style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
              disabled={!canSave}
              onPress={saveClip}
            >
              <Text style={styles.saveBtnText}>{saving ? 'Saving...' : 'Save Clip'}</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>

        {/* Right-edge bundle strip — Clip pill + dynamic numbered pills + add pill.
            Same in both tag modes. */}
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
            <TouchableOpacity
              style={[styles.pill, activeSection === 'clip' ? styles.pillActive : styles.pillInactive]}
              onPress={() => setActiveSection('clip')}
            >
              <Text style={styles.pillTextActive}>Clip</Text>
            </TouchableOpacity>
            {bundles.map((_, idx) => (
              <TouchableOpacity
                key={idx}
                style={[styles.pill, activeSection === idx ? styles.pillActive : styles.pillInactive]}
                onPress={() => setActiveSection(idx)}
                onLongPress={() => removeBundle(idx)}
              >
                <Text style={styles.pillTextInactive}>{idx + 1}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[styles.pill, styles.pillAdd]} onPress={addBundle}>
              <Text style={styles.pillTextAdd}>+</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>

        {/* Tag region — 4 category columns. Compact: short strip above the
            controls row. Fullscreen: same left/right/bottom; top extends up
            under the top bar so the columns get much more vertical space.
            Chip dimensions identical in both modes (per F.4 correction). */}
        <View
          style={[
            tagMode === 'compact' ? styles.tagRegion : styles.fullscreenTagRegion,
            {
              // Same bottom in both modes — keeps the scrub bar + controls row visible.
              bottom: insets.bottom + 56 + 8 + 24 + 8,
              left: insets.left + 12,
              right: insets.right + PILL_SIZE + 8 + 12,
            },
            tagMode === 'fullscreen' && { top: insets.top + 60 },
          ]}
          pointerEvents="box-none"
        >
          {CATEGORIES.map(cat => (
            <View key={cat.key} style={styles.tagColumn}>
              <Text style={[styles.colHeader, { color: cat.color }]}>{cat.label.toUpperCase()}</Text>
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.chipsWrap}>
                  {tags[cat.key].map(tag => {
                    const selected = activeTags.includes(tag.id);
                    return (
                      <TouchableOpacity
                        key={tag.id}
                        onPress={() => toggleTag(tag.id)}
                        style={[
                          styles.tagChip,
                          selected
                            ? { backgroundColor: cat.color, borderColor: 'rgba(255,255,255,0.4)' }
                            : { backgroundColor: colorWithAlpha(cat.color, 0.25), borderColor: colorWithAlpha(cat.color, 0.6) },
                        ]}
                      >
                        <Text
                          style={[
                            styles.tagChipText,
                            selected ? { color: '#fff', fontWeight: '700' } : { color: cat.color },
                          ]}
                        >
                          {tag.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          ))}
        </View>

        {/* Bottom gradient + scrub bar + controls row — same in both tag modes.
            Toggle ("Tags" / "Video") sits rightmost in the controls row. */}
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.45)']}
          style={[styles.bottomGradient, { paddingBottom: insets.bottom }]}
          pointerEvents="box-none"
        >
          {/* Scrub bar — drag thumb or tap anywhere to seek; tooltip above
              thumb while dragging. Pan auto-pauses on drag start; stays paused
              on release per spec. */}
          <View
            style={[styles.scrubBarWrapper, { paddingLeft: insets.left + 12, paddingRight: insets.right + 12 }]}
            pointerEvents="box-none"
          >
            <GestureDetector gesture={pan}>
              <View
                onLayout={e => setBarWidth(e.nativeEvent.layout.width)}
                style={styles.scrubBarHitTarget}
              >
                <View style={[styles.scrubBarTrack, dragging && styles.scrubBarTrackDragging]}>
                  <View style={[styles.scrubBarFill, { width: thumbX }]} />
                </View>
                <View
                  style={[
                    styles.scrubBarThumb,
                    dragging && styles.scrubBarThumbDragging,
                    { left: thumbX - (dragging ? 8 : 6) },
                  ]}
                  pointerEvents="none"
                />
              </View>
            </GestureDetector>
            {dragging && (
              <View
                style={[styles.tooltip, { left: tooltipLeft }]}
                pointerEvents="none"
              >
                <Text style={styles.tooltipText}>{formatTime(currentTime)}</Text>
              </View>
            )}
          </View>

          <View
            style={[styles.controlsRow, { paddingLeft: insets.left + 12, paddingRight: insets.right + 12 }]}
            pointerEvents="box-none"
          >
            <View style={styles.leftGroup}>
              <Text style={styles.timeText}>
                {formatTime(currentTime)} / {formatTime(duration)}
              </Text>
              <TouchableOpacity style={styles.skipBtn} onPress={() => skip(-5)}>
                <Text style={styles.skipBtnText}>-5s</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.skipBtn} onPress={() => skip(-1)}>
                <Text style={styles.skipBtnText}>-1s</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.playBtn}
                onPress={() => (isPlaying ? player.pause() : player.play())}
                hitSlop={8}
              >
                <Text style={styles.playBtnText}>{isPlaying ? '❚❚' : '▶'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.skipBtn} onPress={() => skip(1)}>
                <Text style={styles.skipBtnText}>+1s</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.skipBtn} onPress={() => skip(5)}>
                <Text style={styles.skipBtnText}>+5s</Text>
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

            <TouchableOpacity
              style={styles.toggleBtn}
              onPress={() => setTagMode(m => (m === 'compact' ? 'fullscreen' : 'compact'))}
            >
              <Text style={styles.toggleBtnText}>{tagMode === 'compact' ? 'Tags' : 'Video'}</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </Animated.View>
    </GestureHandlerRootView>
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
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.5 },
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

  tagRegion: {
    position: 'absolute',
    flexDirection: 'row',
    gap: 8,
    // Shrunk from 100pt in F.2 to make room for the scrub bar between the tag
    // region and the controls row. Bump back if Players column feels cramped.
    height: 80,
  },
  tagColumn: {
    flex: 1,
  },
  colHeader: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 4,
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  tagChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  tagChipText: {
    fontSize: 10,
    fontWeight: '500',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },

  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 200,
    justifyContent: 'flex-end',
    // 8pt vertical breathing room between the F.2 scrub bar and the controls row.
    gap: 8,
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

  skipBtn: {
    width: 40,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  skipBtnText: { color: '#fff', fontSize: 11, fontWeight: '600' },

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

  scrubBarWrapper: {
    // Sits inside the bottom LinearGradient as the first child; gradient's gap:8
    // puts 8pt below it before the controls row.
  },
  scrubBarHitTarget: {
    // Pan gesture is on the GestureDetector wrapping this view — entire 24pt
    // height is the tap target, not just the visible 4pt bar. Thumb is centered
    // vertically via absolute positioning below.
    height: 24,
    justifyContent: 'center',
  },
  scrubBarTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  scrubBarTrackDragging: {
    height: 6,
    borderRadius: 3,
  },
  scrubBarFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#534AB7',
    borderRadius: 2,
  },
  scrubBarThumb: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#fff',
    // Centered vertically in the 24pt hit target: (24 - 12) / 2 = 6.
    top: 6,
  },
  scrubBarThumbDragging: {
    width: 16,
    height: 16,
    borderRadius: 8,
    // (24 - 16) / 2 = 4.
    top: 4,
  },
  tooltip: {
    position: 'absolute',
    top: -28,
    width: 50,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
  },
  tooltipText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },

  // F.4 fullscreen tag region — same shape as tagRegion but no fixed height
  // (top set inline = insets.top + 60 so it grows under the top bar; bottom
  // matches compact so the scrub + controls row stay visible).
  fullscreenTagRegion: {
    position: 'absolute',
    flexDirection: 'row',
    gap: 8,
  },

  // F.4 toggle button — label flips "Tags" (compact) / "Video" (fullscreen).
  // Rightmost slot in the bottom controls row in both modes.
  toggleBtn: {
    width: 40,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleBtnText: { color: '#fff', fontSize: 11, fontWeight: '600' },
});

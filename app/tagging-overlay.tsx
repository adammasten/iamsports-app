// V2 overlay tagging screen — Phase A skeleton + Phase B chrome + Phase C controls + Phase D tags.
// Scope so far: landscape lock, full-bleed video with native chrome suppressed,
// styled top bar (Back + disabled Save Clip placeholder + gradient backdrop),
// right-edge bundle strip wired to bundle state, bottom controls row (timestamp,
// play/pause, Mark Start, Mark End, Highlight), and a 4-column tag region
// scoped to the current profile/team. Save wiring lands in Phase F. Routed to
// from app/game.tsx via a TEMP Alert option until Phase G flips /tagging.
import { useTeamContext } from '@/context';
import { supabase } from '@/supabase';
import { useEvent } from 'expo';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, InteractionManager, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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

export default function TaggingOverlayScreen() {
  const params = useLocalSearchParams();
  const videoUrl = Array.isArray(params.url) ? params.url[0] : params.url;
  const startAt = params.startAt
    ? parseFloat(Array.isArray(params.startAt) ? params.startAt[0] : (params.startAt as string))
    : null;
  const insets = useSafeAreaInsets();
  const { profileId, teamId } = useTeamContext();

  const [startTime, setStartTime] = useState<number | null>(null);
  const [endTime, setEndTime] = useState<number | null>(null);
  const [isHighlight, setIsHighlight] = useState(false);

  const [clipLevelTags, setClipLevelTags] = useState<string[]>([]);
  const [bundles, setBundles] = useState<string[][]>([]);
  const [activeSection, setActiveSection] = useState<'clip' | number>('clip');
  const [tags, setTags] = useState<Record<string, any[]>>({ offense: [], defense: [], plays: [], players: [] });

  const player = useVideoPlayer(videoUrl, p => {
    // Phase C: pause on entry. User starts playback via the bottom-row button.
    p.pause();
    if (startAt !== null) {
      setTimeout(() => { p.currentTime = startAt; }, 800);
    }
  });

  // Reactive player state. expo-video fires timeUpdate at the interval defined
  // by player.timeUpdateEventInterval (default 0.5s) — fine for a M:SS display.
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

      {/* Right-edge bundle strip — Clip pill + dynamic numbered pills + add pill. */}
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

      {/* Tag region — 4 category columns. Sits above the controls row, to the
          left of the strip's lower portion. Each column scrolls vertically. */}
      <View
        style={[
          styles.tagRegion,
          {
            bottom: insets.bottom + 56 + 8,
            left: insets.left + 12,
            right: insets.right + PILL_SIZE + 8 + 12,
          },
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
                      style={[styles.tagChip, { backgroundColor: selected ? cat.color : cat.bg }]}
                    >
                      <Text style={[styles.tagChipText, { color: selected ? '#fff' : cat.color }]}>
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

      {/* Bottom controls — timestamp, play/pause, Mark Start/End, Highlight.
          State is local-only here; Save wiring in Phase F batches into supabase.
          Gradient extends up far enough to backdrop the tag region for readability. */}
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

  tagRegion: {
    position: 'absolute',
    flexDirection: 'row',
    gap: 8,
    height: 100,
  },
  tagColumn: {
    flex: 1,
  },
  colHeader: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 4,
    textShadowColor: 'rgba(0,0,0,0.8)',
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
  },
  tagChipText: {
    fontSize: 10,
    fontWeight: '500',
  },

  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 200,
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

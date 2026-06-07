// V2 overlay tagging screen — Phases A-G + F.2 scrub + F.3 translucency + F.4 tall tag region.
// Two tag modes: compact (default — tag region above the bottom controls row)
// and fullscreen (tag region grows up under the top bar). Everything else
// stays the same in both modes: top bar, right-edge bundle strip, scrub bar,
// bottom controls row. Toggle is in the bottom controls row (rightmost).
import { useTeamContext } from '@/context';
import { getCachedPathSync, touch as touchVideoCache } from '@/lib/native/video-cache';
import { getSignedVideoUrl } from '@/lib/native/video-url';
import { supabase } from '@/supabase';
import { useEvent } from 'expo';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, InteractionManager, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
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
  // Render '–:–' for NaN / Infinity / negative — happens briefly during video
  // load when player.currentTime / player.duration are indefinite (CMTime).
  if (!Number.isFinite(seconds) || seconds < 0) return '–:–';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Converts a #RRGGBB hex string to rgba(...) with the given alpha. Used for
// translucent chip backgrounds/borders without polluting the CATEGORIES literal
// (which mirrors the portrait UI's shape — see CLAUDE.md).
function colorWithAlpha(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function TaggingOverlayScreen() {
  const params = useLocalSearchParams();
  const remoteUrl = Array.isArray(params.url) ? params.url[0] : params.url;
  const videoId = Array.isArray(params.videoId) ? params.videoId[0] : params.videoId;
  const startAt = params.startAt
    ? parseFloat(Array.isArray(params.startAt) ? params.startAt[0] : (params.startAt as string))
    : null;
  const insets = useSafeAreaInsets();
  const { activeTeam, userId } = useTeamContext();

  const [startTime, setStartTime] = useState<number | null>(null);
  const [endTime, setEndTime] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  // True when getSignedVideoUrl returned null (couldn't mint a signed URL for
  // network playback). Routed into the existing error/retry overlay below.
  const [signFailed, setSignFailed] = useState(false);

  const [clipLevelTags, setClipLevelTags] = useState<string[]>([]);
  const [bundles, setBundles] = useState<string[][]>([]);
  const [activeSection, setActiveSection] = useState<'clip' | number>('clip');
  const [tags, setTags] = useState<Record<string, any[]>>({ offense: [], defense: [], plays: [], players: [] });
  // Special-category tags ('★ Highlight', 'POE') are looked up by name and
  // surfaced only via dedicated buttons in markGroup — never rendered in the
  // category columns. The ★ and POE buttons are just tag toggles in disguise.
  const [specialTagIds, setSpecialTagIds] = useState<{ highlight: string | null; poe: string | null }>({ highlight: null, poe: null });

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

  // Prefer the on-device cached file at player init. If there's no cached file,
  // the player starts empty (null) and we mint a signed URL from the storage
  // path (remoteUrl is now a bare object key, not a playable URL) in an effect
  // below — see loadSignedSource. A cached file plays directly with no signed
  // URL needed (offline playback). All network (re)loads go through
  // loadSignedSource, so a corrupted/evicted cache file mid-session recovers by
  // re-minting a signed URL on the next retry.
  const cachedPath = videoId ? getCachedPathSync(videoId) : null;
  const initialSource = cachedPath;

  // Initial seek-to-startAt now fires once on the first 'readyToPlay' (in the
  // statusChange effect below) instead of a fixed 800ms timer. With signed-URL
  // minting, the source can load well after player creation, so a fixed timer
  // could fire before the media is ready and lose the seek; gating on
  // readyToPlay is both correct and avoids the post-unmount timer crash the old
  // approach guarded against.
  const didInitialSeekRef = useRef(false);

  const player = useVideoPlayer(initialSource, p => {
    // Phase C: pause on entry. User starts playback via the bottom-row button.
    p.pause();
    // expo-video defaults timeUpdateEventInterval to 0 (event never fires) —
    // set explicitly so the bottom-row timestamp ticks during playback.
    p.timeUpdateEventInterval = 0.5;
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

  // Video load observation + bounded auto-retry. On "first session of the day"
  // Supabase's CDN edge can be cold and expo-video transitions silently into
  // 'error'. We log every status transition for diagnosis, and on 'error' we
  // re-mint a signed URL and replace the source up to 3 times (2s apart) before
  // surfacing a manual tap-to-retry overlay. Counter only resets on
  // 'readyToPlay' — 'error' → 'idle' happens DURING our retry sequence (via
  // replace) so resetting there would loop forever.
  const statusEvent = useEvent(player, 'statusChange', {
    status: 'idle' as const,
    oldStatus: undefined,
    error: undefined,
  });
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks whether the component is still mounted, so async callbacks
  // (loadSignedSource after its mint await) don't call into a released player.
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (videoId) touchVideoCache(videoId).catch(() => {});
  }, [videoId]);

  // Mint a signed URL from the storage path and hand it to the player. Used for
  // the initial network load (no cached file) and for every retry/reload —
  // re-minting each time, since an expired/stale signed URL is a likely reason
  // the load failed. On failure, flag signFailed so the error overlay surfaces.
  const loadSignedSource = useCallback(async () => {
    if (!remoteUrl) return;
    setSignFailed(false);
    const signed = await getSignedVideoUrl(remoteUrl);
    // Bail if the component unmounted during the mint round-trip — calling into
    // a released player throws NativeSharedObjectNotFoundException.
    if (!isMountedRef.current) return;
    if (signed) {
      try {
        player.replace(signed);
      } catch (e) {
        // Player released between the mount check and this call (rare race) —
        // swallow rather than crash; nothing left to play into.
        console.warn('[video-url] player.replace skipped (released):', e);
      }
    } else {
      setSignFailed(true);
    }
  }, [remoteUrl, player]);

  // Initial network load: only when there's no cached file to play directly.
  useEffect(() => {
    if (!cachedPath) loadSignedSource();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const { status, oldStatus, error } = statusEvent;
    const urlTail = remoteUrl ? `...${remoteUrl.slice(-30)}` : 'none';
    console.log(
      `[video-load] t=${Date.now()} ${oldStatus ?? 'init'}→${status} url=${urlTail}${error ? ` err=${error.message}` : ''}`
    );

    if (status === 'readyToPlay') {
      retryCountRef.current = 0;
      // Fire the initial seek-to-startAt exactly once, now that the media is
      // actually loaded (works regardless of how long the signed-URL mint took).
      if (startAt !== null && !didInitialSeekRef.current) {
        didInitialSeekRef.current = true;
        try {
          player.currentTime = startAt;
        } catch (e) {
          // Player released — ignore the seek rather than crash.
          console.warn('[video-load] initial seek skipped (released):', e);
        }
      }
      return;
    }

    if (status === 'error' && remoteUrl) {
      if (retryCountRef.current < 3) {
        retryCountRef.current += 1;
        const attempt = retryCountRef.current;
        console.log(`[video-load] scheduling retry ${attempt}/3 in 2s`);
        if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = setTimeout(() => {
          retryTimeoutRef.current = null;
          console.log(`[video-load] retry ${attempt}/3: re-minting signed URL`);
          loadSignedSource();
        }, 2000);
      } else {
        // Retries exhausted — the loading overlay's tap-to-retry surfaces this
        // to the user. No Alert.alert here (we used to show one but it
        // double-stacked with the overlay).
        console.log(`[video-load] retries exhausted (3/3) — overlay surfaces tap-to-retry`);
      }
    }
  }, [statusEvent, remoteUrl, player, loadSignedSource, startAt]);

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

  // V3 tag scope is global | team only. Global tags are visible to every team;
  // team tags are visible only to memberships of activeTeam. The .or(...)
  // expression must match app/tagging.tsx exactly — per CLAUDE.md, getting it
  // wrong silently leaks tags across teams.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let query = supabase.from('tags').select('*').order('sort_order');
      if (activeTeam) {
        query = query.or(`scope.eq.global,and(scope.eq.team,team_id.eq.${activeTeam.id})`);
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
      let highlightId: string | null = null;
      let poeId: string | null = null;
      (data || []).forEach((t: any) => {
        if (t.category === 'special') {
          if (t.name === '★ Highlight') highlightId = t.id;
          else if (t.name === 'POE') poeId = t.id;
        } else if (grouped[t.category]) {
          grouped[t.category].push(t);
        }
      });
      setTags(grouped);
      setSpecialTagIds({ highlight: highlightId, poe: poeId });
    })();
    return () => { cancelled = true; };
  }, [activeTeam]);

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

  // Derived button states: lit iff the special tag is present in the active
  // section (clip-level or current bundle), matching how any normal tag chip
  // shows selected. Falls back to false if specialTagIds haven't loaded.
  const highlightLit = !!specialTagIds.highlight && activeTags.includes(specialTagIds.highlight);
  const poeLit = !!specialTagIds.poe && activeTags.includes(specialTagIds.poe);

  const hasClipMarked = startTime !== null && endTime !== null;
  const videoReady = statusEvent.status === 'readyToPlay';
  const retriesExhausted = (statusEvent.status === 'error' && retryCountRef.current >= 3) || signFailed;
  const canSave = hasClipMarked && !saving && videoReady;

  // Highlight ★ button scale-pulse — fires only on enable (un-lit → lit).
  // Coaches frequently miss this button, so the pulse + larger size + label
  // are the visual reinforcement for the highlight → export feedback loop.
  const highlightScale = useSharedValue(1);
  const highlightAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: highlightScale.value }],
  }));
  function toggleHighlight() {
    const id = specialTagIds.highlight;
    if (!id) return;
    if (!highlightLit) {
      highlightScale.value = withSequence(
        withTiming(1.15, { duration: 100 }),
        withTiming(1, { duration: 100 })
      );
    }
    toggleTag(id);
  }

  // POE button — red counterpart to ★. Same toggle behavior, same scale-pulse
  // on enable, same disable-during-load.
  const poeScale = useSharedValue(1);
  const poeAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: poeScale.value }],
  }));
  function togglePOE() {
    const id = specialTagIds.poe;
    if (!id) return;
    if (!poeLit) {
      poeScale.value = withSequence(
        withTiming(1.15, { duration: 100 }),
        withTiming(1, { duration: 100 })
      );
    }
    toggleTag(id);
  }

  // Scrubber drag uses seekBy (keyframe-tolerant, ~10x faster than
  // currentTime=). Coaches accept the keyframe rounding here because they're
  // dragging to a rough position and the speed matters more than precision.
  function seekToX(x: number) {
    if (barWidth <= 0 || duration <= 0) return;
    const pct = Math.max(0, Math.min(1, x / barWidth));
    const targetTime = pct * duration;
    const delta = targetTime - player.currentTime;
    player.seekBy(delta);
  }

  // Skip buttons use frame-accurate currentTime= so ±1s actually moves 1.0s
  // and ±5s moves 5.0s. seekBy here was rounding to the nearest keyframe,
  // which made ±5s overshoot (~8s) and ±1s often no-op when already near a
  // keyframe — breaking the fine-tune workflow after a scrubber drag.
  function skip(deltaSeconds: number) {
    if (duration <= 0) return;
    const clampedTarget = Math.max(0, Math.min(duration, player.currentTime + deltaSeconds));
    player.currentTime = clampedTarget;
  }

  // Skip buttons: tap fires once via onPressIn; press-and-hold past 400ms
  // starts a 150ms repeat interval. Single quick taps clear the pending timeout
  // before the interval starts, so they keep their 1-shot behavior. The ref
  // holds either a setTimeout or setInterval handle — clearTimeout/clearInterval
  // are interchangeable on RN, so the cleanup handles both.
  const skipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function startSkipRepeat(deltaSeconds: number) {
    skip(deltaSeconds);
    skipTimerRef.current = setTimeout(() => {
      skipTimerRef.current = setInterval(() => skip(deltaSeconds), 150);
    }, 400);
  }
  function stopSkipRepeat() {
    if (skipTimerRef.current) {
      clearTimeout(skipTimerRef.current);
      clearInterval(skipTimerRef.current);
      skipTimerRef.current = null;
    }
  }
  useEffect(() => {
    return () => {
      if (skipTimerRef.current) {
        clearTimeout(skipTimerRef.current);
        clearInterval(skipTimerRef.current);
        skipTimerRef.current = null;
      }
    };
  }, []);

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
    // V3 requirement: clips.team_id is nullable; omitting it silently misfiles
    // the clip as a personal upload. Both team_id and created_by_user_id must
    // be wired on every team-context save.
    if (!activeTeam || !userId) {
      Alert.alert('No team selected', 'Pick a team before saving clips.');
      return;
    }
    setSaving(true);

    const { data: clip, error: clipError } = await supabase
      .from('clips')
      .insert({
        video_id: videoId,
        team_id: activeTeam.id,
        created_by_user_id: userId,
        start_time: startTime,
        end_time: endTime,
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

    const clipLevelCount = clipLevelTags.length;
    const bundledCount = rows.length - clipLevelCount;
    const nonEmptyBundles = bundles.filter(b => b.length > 0).length;
    const bundlesWord = nonEmptyBundles === 1 ? 'bundle' : 'bundles';
    let message: string;
    if (clipLevelCount > 0 && bundledCount > 0) {
      message = `${clipLevelCount} clip-wide + ${bundledCount} ${bundledCount === 1 ? 'tag' : 'tags'} across ${nonEmptyBundles} ${bundlesWord} (${rows.length} total).`;
    } else if (clipLevelCount > 0) {
      message = `${clipLevelCount} clip-wide ${clipLevelCount === 1 ? 'tag' : 'tags'}.`;
    } else if (bundledCount > 0) {
      message = `${bundledCount} ${bundledCount === 1 ? 'tag' : 'tags'} across ${nonEmptyBundles} ${bundlesWord}.`;
    } else {
      message = 'Clip saved with no tags.';
    }

    // Reset state synchronously on save success — tag chips (incl. ★ / POE
    // via clipLevelTags + bundles) visually clear immediately, not on Alert
    // dismissal.
    setStartTime(null);
    setEndTime(null);
    setClipLevelTags([]);
    setBundles([]);
    setActiveSection('clip');

    Alert.alert('Saved!', message);
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

      {/* Loading overlay — hides the crossed-out icon + NaN time while the
          source is loading or mid-retry. Rendered above the tap-to-hide layer
          (intercepts taps for retry) and below the chrome wrapper (chrome
          buttons still render on top but are disabled via videoReady). */}
      {!videoReady && (
        <Pressable
          style={[StyleSheet.absoluteFillObject, styles.loadingOverlay]}
          onPress={() => {
            if (retriesExhausted && remoteUrl) {
              retryCountRef.current = 0;
              loadSignedSource();
            }
          }}
        >
          {retriesExhausted ? (
            <>
              <Text style={styles.loadingTextLarge}>Couldn&apos;t load video.</Text>
              <Text style={styles.loadingText}>Tap to retry.</Text>
            </>
          ) : (
            <>
              <ActivityIndicator size="large" color="#EF9F27" />
              <Text style={styles.loadingText}>
                Loading video...{retryCountRef.current > 0 ? ' (retrying)' : ''}
              </Text>
            </>
          )}
        </Pressable>
      )}

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
                            : { backgroundColor: 'rgba(255, 255, 255, 0.25)', borderColor: colorWithAlpha(cat.color, 0.6) },
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
              <TouchableOpacity
                style={styles.skipBtn}
                onPressIn={() => startSkipRepeat(-5)}
                onPressOut={stopSkipRepeat}
              >
                <Text style={styles.skipBtnText}>-5s</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.skipBtn}
                onPressIn={() => startSkipRepeat(-1)}
                onPressOut={stopSkipRepeat}
              >
                <Text style={styles.skipBtnText}>-1s</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.playBtn}
                onPress={() => (isPlaying ? player.pause() : player.play())}
                hitSlop={8}
              >
                <Text style={styles.playBtnText}>{isPlaying ? '❚❚' : '▶'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.skipBtn}
                onPressIn={() => startSkipRepeat(1)}
                onPressOut={stopSkipRepeat}
              >
                <Text style={styles.skipBtnText}>+1s</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.skipBtn}
                onPressIn={() => startSkipRepeat(5)}
                onPressOut={stopSkipRepeat}
              >
                <Text style={styles.skipBtnText}>+5s</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.markGroup}>
              <TouchableOpacity
                style={[styles.markBtn, styles.markStartBtn, !videoReady && styles.disabledBtn]}
                onPress={() => setStartTime(player.currentTime)}
                disabled={!videoReady}
              >
                <Text style={styles.markBtnText}>
                  {startTime !== null ? `Start ${formatTime(startTime)}` : 'Mark Start'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.markBtn, styles.markEndBtn, !videoReady && styles.disabledBtn]}
                onPress={() => setEndTime(player.currentTime)}
                disabled={!videoReady}
              >
                <Text style={styles.markBtnText}>
                  {endTime !== null ? `End ${formatTime(endTime)}` : 'Mark End'}
                </Text>
              </TouchableOpacity>
              {/* Highlight ★ — relocated into markGroup adjacent to Mark End so
                  the natural flow is "just marked the end → star this clip?". */}
              <Animated.View style={[!videoReady && styles.disabledBtn, highlightAnimatedStyle]}>
                <TouchableOpacity
                  style={[styles.highlightBtn, highlightLit && styles.highlightBtnActive]}
                  onPress={toggleHighlight}
                  hitSlop={8}
                  disabled={!videoReady}
                >
                  <Text style={styles.highlightStar}>{highlightLit ? '★' : '☆'}</Text>
                </TouchableOpacity>
              </Animated.View>
              {/* POE ! — red counterpart to ★, sits next to Highlight. */}
              <Animated.View style={[!videoReady && styles.disabledBtn, poeAnimatedStyle]}>
                <TouchableOpacity
                  style={[styles.poeBtn, poeLit && styles.poeBtnActive]}
                  onPress={togglePOE}
                  hitSlop={8}
                  disabled={!videoReady}
                >
                  <Text style={[styles.poeText, poeLit && styles.poeTextActive]}>!</Text>
                </TouchableOpacity>
              </Animated.View>
            </View>

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

  loadingOverlay: {
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    marginTop: 12,
  },
  loadingTextLarge: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  disabledBtn: { opacity: 0.4 },

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
  // Soft text shadow — alpha 0.5, offset 0.5, radius 1.5 reads as edge
  // "definition" over busy video, not as a hard stamped shadow. Single black
  // shadow is enough because text color comes inline (cat.color or #fff).
  tagChipText: {
    fontSize: 10,
    fontWeight: '500',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 0.5 },
    textShadowRadius: 1.5,
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
  // Star is always gold (#EF9F27); the ☆ → ★ glyph swap + subtle gold-tinted
  // backdrop convey the active state. Avoids gray, keeps gold as the constant
  // visual identity of the highlight concept.
  highlightBtnActive: {
    backgroundColor: 'rgba(239, 159, 39, 0.25)',
  },
  highlightStar: { color: '#EF9F27', fontSize: 22, fontWeight: '700' },

  // POE button — red counterpart to the gold Highlight star. Same dimensions
  // and toggle pattern; only the color changes. Inactive = outlined red on
  // dark transparent; active = solid red filled with white "!".
  poeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#DC3545',
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  poeBtnActive: {
    backgroundColor: '#DC3545',
  },
  poeText: { color: '#DC3545', fontSize: 22, fontWeight: '700' },
  poeTextActive: { color: '#fff' },

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

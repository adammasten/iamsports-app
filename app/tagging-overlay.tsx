// V2 overlay tagging screen — Phases A-G + F.2 scrub + F.3 translucency + F.4 tall tag region.
// Two tag modes: compact (default — tag region above the bottom controls row)
// and fullscreen (tag region grows up under the top bar). Everything else
// stays the same in both modes: top bar, right-edge bundle strip, scrub bar,
// bottom controls row. Toggle is in the bottom controls row (rightmost).
import { useTeamContext } from '@/context';
import { loadHiddenTagIds } from '@/lib/core/hiddenTags';
import { periodsForSport } from '@/lib/core/periods';
import { getCachedPathSync, touch as touchVideoCache } from '@/lib/native/video-cache';
import { getSignedVideoUrl } from '@/lib/native/video-url';
import { supabase } from '@/supabase';
import { useEvent } from 'expo';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { goBackOrHome } from '@/lib/nav';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Mirrors app/(tabs)/tags.tsx, app/export.tsx, app/edit-reel.tsx — per CLAUDE.md,
// the category list is a hardcoded literal across multiple files. Keep in sync.
const CATEGORIES = [
  { key: 'offense', label: 'Offense', color: '#1a6fd4', bg: '#e8f0fe' },
  { key: 'defense', label: 'Defense', color: '#c0392b', bg: '#fde8e8' },
  { key: 'plays',   label: 'Plays',   color: '#1e8449', bg: '#e8f8ed' },
  { key: 'players', label: 'Players', color: '#7d3c98', bg: '#f5eef8' },
];

// Right-edge control strip (Tags/Video toggle + ★/POE) width; the tag region
// reserves this so fullscreen tags never cover it.
const SIDE_STRIP_W = 64;

// Game-period options per sport live in @/lib/core/periods (shared with web).

function formatTime(seconds: number) {
  // Render '–:–' for NaN / Infinity / negative — happens briefly during video
  // load when player.currentTime / player.duration are indefinite (CMTime).
  if (!Number.isFinite(seconds) || seconds < 0) return '–:–';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Playback-speed cycle: normal → 1.2× → 1.5× → 2× → back to normal. A single
// tap-to-cycle chip (not a 4-button control) so it slides into the tight
// bottom-row without stealing space. Same set on web + mobile.
const PLAYBACK_SPEEDS = [1, 1.2, 1.5, 2];
const speedLabel = (r: number) => `${r}×`;

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
  // Personal (no-team) tagging session — forces clip team_id null regardless of
  // whether the user happens to have an activeTeam selected.
  const isPersonal = (Array.isArray(params.personal) ? params.personal[0] : params.personal) === '1';
  // Watch mode: reuse this player for pure viewing. Suppresses every tag control
  // (Save Clip, bundle strip, tag columns, Mark Start/End, ★/POE, Tags/Video
  // toggle) while keeping video, scrub bar, playback controls, and Back.
  const isWatch = (Array.isArray(params.watch) ? params.watch[0] : params.watch) === '1';
  const startAt = params.startAt
    ? parseFloat(Array.isArray(params.startAt) ? params.startAt[0] : (params.startAt as string))
    : null;
  const insets = useSafeAreaInsets();
  // Size the root to a LANDSCAPE shape regardless of the phone's current
  // orientation: long edge = width, short edge = height. app.json is
  // orientation:"portrait" and this screen force-locks LANDSCAPE at runtime, so
  // the window can momentarily report portrait dimensions — on entry (before the
  // rotate settles) and on exit (when you turn the phone upright mid-back). Using
  // the raw window size made the landscape overlay collapse into a portrait
  // column stack in those windows. Pinning to max/min keeps the frame landscape
  // through every transition; reading useWindowDimensions still re-renders when
  // the physical size is known, so the root always fills the real screen. NOT
  // keyed → no player remount.
  const { width: winW, height: winH } = useWindowDimensions();
  // iPad / tablet: the shorter screen side is big. Drives a roomier touch layout
  // (bigger chips, playback bottom-left, groupings + Save above Start/End on the
  // bottom-right). Phones keep the compact layout untouched.
  const isTablet = Math.min(winW, winH) >= 700;
  const landW = Math.max(winW, winH);
  const landH = Math.min(winW, winH);
  const { activeTeam, userId } = useTeamContext();

  const [startTime, setStartTime] = useState<number | null>(null);
  const [endTime, setEndTime] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  // True when getSignedVideoUrl returned null (couldn't mint a signed URL for
  // network playback). Routed into the existing error/retry overlay below.
  const [signFailed, setSignFailed] = useState(false);

  // Add-as-you-go (identical to the web tagger): `building` is the current GROUP
  // of selected tags. Each Add attaches it as a bundle to the open clip; a new
  // window (Mark Start/End) starts a fresh clip. Star/POE are clip-level flags.
  const [building, setBuilding] = useState<string[]>([]);
  // Build-then-commit: `building` is the current group of tags. "Add group" pushes
  // it onto stagedBundles (a LOCAL staging tray — nothing hits the DB yet). "Save
  // clip" commits the whole clip (window + all bundles + clip-level ★/POE/period)
  // in one batch, then resets. Replaces the old commit-on-every-Add model.
  const [stagedBundles, setStagedBundles] = useState<string[][]>([]);
  const [isStar, setIsStar] = useState(false);
  const [isPoe, setIsPoe] = useState(false);
  const [tags, setTags] = useState<Record<string, any[]>>({ offense: [], defense: [], plays: [], players: [] });
  // Special-category tags ('★ Highlight', 'POE') are looked up by name and
  // surfaced only via dedicated buttons in markGroup — never rendered in the
  // category columns. The ★ and POE buttons are just tag toggles in disguise.
  const [specialTagIds, setSpecialTagIds] = useState<{ highlight: string | null; poe: string | null }>({ highlight: null, poe: null });
  // Game periods (category='period') — a sticky, mutually-exclusive selector in
  // the top bar. Whichever period is active auto-stamps every saved clip until
  // the coach switches (halftime → tap 2nd). Stays lit across saves (NOT reset
  // in saveClip); null = no period selected. Rendered only via the period strip,
  // never in the tag columns.
  const [periodTags, setPeriodTags] = useState<any[]>([]);
  const [activePeriod, setActivePeriod] = useState<string | null>(null);

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
  const { duration: srcDuration } = useEvent(player, 'sourceLoad', {
    videoSource: null,
    duration: 0,
    availableVideoTracks: [],
    availableSubtitleTracks: [],
    availableAudioTracks: [],
  });
  // WEB: sourceLoad reports duration 0, which zeroes the scrubber + seek math
  // (all clamp to duration). Fall back to the player's own duration property.
  // Native reports it in sourceLoad, so this never engages there.
  const pd = (player as { duration?: number }).duration;
  const duration = srcDuration || (typeof pd === 'number' && Number.isFinite(pd) ? pd : 0);

  // Scrub bar state — dragging drives thumb size + tooltip visibility;
  // barWidth captured via onLayout for pixel→time conversion.
  const [dragging, setDragging] = useState(false);
  const [barWidth, setBarWidth] = useState(0);
  // Playback speed (1× default). Re-asserted whenever it changes or the video
  // (re)loads — some players reset rate to 1 on a fresh source.
  const [speed, setSpeed] = useState(1);

  // Existing clips already tagged on this video — drives the scrub-bar marker
  // strip + the "now tagged" readout in WATCH mode, so a reviewer can SEE what's
  // tagged at the current playhead (the core review primitive). Read-only here;
  // editing lands in a later slice.
  const [existingClips, setExistingClips] = useState<
    { id: string; start: number; end: number; starred: boolean; poe: boolean; tags: { name: string; category: string }[] }[]
  >([]);

  const loadExistingClips = useCallback(async () => {
    if (!videoId) return;
    const { data, error } = await supabase
      .from('clips')
      .select('id, start_time, end_time, is_starred, is_point_of_emphasis, clip_tags ( tags ( name, category ) )')
      .eq('video_id', videoId)
      .order('start_time');
    if (error || !data) return;
    setExistingClips(
      data.map((c: any) => ({
        id: c.id,
        start: c.start_time,
        end: c.end_time,
        starred: !!c.is_starred,
        poe: !!c.is_point_of_emphasis,
        tags: (c.clip_tags || [])
          .map((ct: any) => ct.tags)
          .filter(Boolean)
          .map((t: any) => ({ name: t.name, category: t.category })),
      })),
    );
  }, [videoId]);

  useEffect(() => { loadExistingClips(); }, [loadExistingClips]);

  // The team whose players/tags apply is the VIDEO's team — NOT the ambient
  // activeTeam (which may be a different team, or null). Using activeTeam meant a
  // video on team B showed team A's (or no) players, so a rostered kid wouldn't
  // appear to tag, and clips were misfiled. Resolve it from the video.
  const [videoTeamId, setVideoTeamId] = useState<string | null>(null);
  const [videoSport, setVideoSport] = useState<string | null>(null);
  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;
    supabase.from('videos').select('team_id, sport').eq('id', videoId).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setVideoTeamId((data?.team_id as string) ?? null);
        setVideoSport((data?.sport as string) ?? null);
      });
    return () => { cancelled = true; };
  }, [videoId]);
  // Team to scope tags + save clips against. Personal mode forces null (global only).
  const tagTeamId = isPersonal ? null : (videoTeamId ?? (activeTeam ? activeTeam.id : null));
  // Sport that scopes the tag palette: this video's sport, else the video team's
  // (or active team's) sport. null = unknown → show all global tags (safe default).
  const tagSport = videoSport ?? activeTeam?.sport ?? null;

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
    const signed = await getSignedVideoUrl(remoteUrl, { forceRefresh: true });
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

  // Initial load. Cached → the player already has the local file (initialSource,
  // instant + offline). Not cached → just STREAM: mint a signed URL and play.
  // (Big games stream fine now that they're faststarted server-side, so no
  // download-first — that stopgap made Watch download the whole game before
  // playing, which is the opposite of what we want.)
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

  // Orientation is owned by the navigator now: this route is declared
  // `orientation: 'landscape'` in app/_layout.tsx, so iOS presents it in landscape
  // and restores portrait automatically on pop. No imperative ScreenOrientation
  // locks, no AppState re-lock, no deferred restore — those were the two-authority
  // race that caused the half-rotate / snap-back.

  // Back: just navigate. The navigator restores portrait on pop, correctly
  // sequenced with the transition (no manual rotate-then-navigate needed).
  function handleBack() {
    goBackOrHome();
  }

  // V3 tag scope is global | team only. Global tags are visible to every team;
  // team tags are visible only to memberships of activeTeam. The .or(...)
  // expression must stay exactly this — per CLAUDE.md, getting it
  // wrong silently leaks tags across teams.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let query = supabase.from('tags').select('*').order('sort_order');
      // Global tags are sport-scoped: sport=null is universal (★ Highlight / POE),
      // otherwise it must match this content's sport, so a football team never
      // sees basketball tags. Team tags belong to the team regardless of sport —
      // keep that branch EXACTLY as-is (getting it wrong leaks tags across teams).
      const globalBranch = tagSport
        ? `and(scope.eq.global,or(sport.is.null,sport.eq.${tagSport}))`
        : `scope.eq.global`;
      if (tagTeamId) {
        query = query.or(`${globalBranch},and(scope.eq.team,team_id.eq.${tagTeamId})`);
      } else {
        query = query.or(globalBranch);
      }
      const { data, error } = await query;
      if (cancelled) return;
      if (error) {
        Alert.alert('Error', error.message);
        return;
      }
      // Tags this team hid stay out of the tagging screen (special/period are
      // functional and never appear in the hide UI, so they're unaffected).
      const hidden = tagTeamId ? await loadHiddenTagIds(tagTeamId).catch(() => new Set<string>()) : new Set<string>();
      if (cancelled) return;
      const grouped: Record<string, any[]> = { offense: [], defense: [], plays: [], players: [] };
      let highlightId: string | null = null;
      let poeId: string | null = null;
      const periods: any[] = [];
      (data || []).forEach((t: any) => {
        if (t.category === 'special') {
          if (t.name === '★ Highlight') highlightId = t.id;
          else if (t.name === 'POE') poeId = t.id;
        } else if (t.category === 'period') {
          periods.push(t);
        } else if (grouped[t.category] && !hidden.has(t.id)) {
          grouped[t.category].push(t);
        }
      });
      // Names-hidden tagger (a non-member hired to tag): RLS hides the kids' NAMES,
      // so the raw query returns no player tags. Swap in the sanitized jersey-only
      // vocabulary — real tag_ids, jersey labels — so the owner still gets true
      // player attribution and the tagger never sees a name. Members/owners get
      // 'not authorized' (data null) → names kept unchanged.
      if (tagTeamId) {
        const { data: hp } = await supabase.rpc('tagger_player_tags', { p_team: tagTeamId });
        if (!cancelled && Array.isArray(hp) && hp.length) {
          grouped.players = (hp as any[]).map(r => ({ id: r.tag_id, name: r.label, category: 'players' }));
        }
      }
      if (cancelled) return;
      setTags(grouped);
      setSpecialTagIds({ highlight: highlightId, poe: poeId });
      setPeriodTags(periods);
    })();
    return () => { cancelled = true; };
  }, [tagTeamId, tagSport]);

  function toggleTag(tagId: string) {
    setBuilding(prev => prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]);
  }

  // Star/POE are clip-level flags on the current clip (added at bundle 0).
  const highlightLit = isStar;
  const poeLit = isPoe;

  const videoReady = statusEvent.status === 'readyToPlay';
  const retriesExhausted = (statusEvent.status === 'error' && retryCountRef.current >= 3) || signFailed;

  // Apply the chosen playback rate to the player. Keyed on videoReady too so the
  // rate re-asserts after the source loads (native can reset it to 1 on load).
  useEffect(() => {
    if (!videoReady) return;
    try { player.playbackRate = speed; } catch {}
  }, [speed, videoReady, player]);
  const cycleSpeed = useCallback(() => {
    setSpeed(s => PLAYBACK_SPEEDS[(PLAYBACK_SPEEDS.indexOf(s) + 1) % PLAYBACK_SPEEDS.length]);
  }, []);
  // Build-then-commit: build tags anytime. "Add group" needs tags in the current
  // group; "Save clip" needs a valid Start+End window AND at least one group
  // (staged, or the current un-added one).
  const hasWindow = startTime !== null && endTime !== null && endTime > startTime;
  const groupCount = stagedBundles.length + (building.length > 0 ? 1 : 0);
  const canAddGroup = building.length > 0 && !saving && videoReady;
  const canSave = hasWindow && groupCount > 0 && !saving && videoReady;

  // Highlight ★ button scale-pulse — fires only on enable (un-lit → lit).
  // Coaches frequently miss this button, so the pulse + larger size + label
  // are the visual reinforcement for the highlight → export feedback loop.
  const highlightScale = useSharedValue(1);
  const highlightAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: highlightScale.value }],
  }));
  function toggleHighlight() {
    if (!specialTagIds.highlight) return;
    if (!isStar) {
      highlightScale.value = withSequence(
        withTiming(1.15, { duration: 100 }),
        withTiming(1, { duration: 100 })
      );
    }
    setIsStar(s => !s);
  }

  // POE button — red counterpart to ★. Same toggle behavior, same scale-pulse
  // on enable, same disable-during-load.
  const poeScale = useSharedValue(1);
  const poeAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: poeScale.value }],
  }));
  function togglePOE() {
    if (!specialTagIds.poe) return;
    if (!isPoe) {
      poeScale.value = withSequence(
        withTiming(1.15, { duration: 100 }),
        withTiming(1, { duration: 100 })
      );
    }
    setIsPoe(p => !p);
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

  // Frame-accurate jump to a specific time — used by tap-a-marker-to-jump. Uses
  // currentTime= (not seekBy) so tapping a marker lands on the clip's real start.
  function seekToTime(t: number) {
    if (duration <= 0) return;
    try {
      player.currentTime = Math.max(0, Math.min(duration, t));
    } catch (e) {
      console.warn('[seek] seekToTime skipped (released):', e);
    }
  }

  // Step to the previous/next tagged clip's start so a reviewer can walk through
  // every tag and check it. existingClips is ordered by start_time. EPS avoids
  // re-landing on the clip you're already sitting at the start of.
  function jumpToTag(dir: 1 | -1) {
    if (!existingClips.length || duration <= 0) return;
    const t = player.currentTime;
    const EPS = 0.35;
    const target =
      dir === 1
        ? existingClips.find(c => c.start > t + EPS)?.start
        : [...existingClips].reverse().find(c => c.start < t - EPS)?.start;
    if (target !== undefined) seekToTime(target);
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

  // Which tagged clips contain the current playhead → the "now tagged" readout.
  const activeClips = existingClips.filter(c => currentTime >= c.start && currentTime <= c.end);
  const activeTagNames = Array.from(new Set(activeClips.flatMap(c => c.tags.map(t => t.name))));

  // Stage the current group as a bundle and start a fresh group. LOCAL only — no
  // DB write. ★/POE are per-CLIP (applied at Save), so they are NOT cleared here.
  function addGroup() {
    if (building.length === 0) return;
    setStagedBundles(b => [...b, building]);
    setBuilding([]);
  }

  // Commit the whole clip at once: the Start+End window, every bundle (staged +
  // the current un-added group), and the clip-level ★/POE/period. Then reset for
  // the next clip. The bundle_number contract (clip-level = 0, groups = 1,2,3…) is
  // what app/export.tsx's clipMatchesGroup relies on — preserved here.
  async function saveClip() {
    if (saving) return;
    if (!userId) { Alert.alert('Not signed in'); return; }
    if (!hasWindow) { Alert.alert('Mark the clip', 'Tap Mark Start and Mark End to set the clip window first.'); return; }
    // Every group for this clip: what's staged, plus the current group if it has tags.
    const bundles = [...stagedBundles, ...(building.length > 0 ? [building] : [])];
    if (bundles.length === 0) { Alert.alert('Add a tag', 'Pick at least one tag before saving.'); return; }
    setSaving(true);

    const { data: clip, error: clipError } = await supabase
      .from('clips')
      .insert({ video_id: videoId, team_id: tagTeamId, created_by_user_id: userId, start_time: startTime as number, end_time: endTime as number, note: '' })
      .select().single();
    if (clipError || !clip) { Alert.alert('Error saving clip', clipError?.message ?? 'Could not save clip'); setSaving(false); return; }

    const rows: any[] = [];
    bundles.forEach((grp, i) => grp.forEach(tag_id => rows.push({ clip_id: clip.id, tag_id, bundle_number: i + 1 })));
    // Clip-level (bundle 0): sticky game period + ★ + POE.
    if (activePeriod) rows.push({ clip_id: clip.id, tag_id: activePeriod, bundle_number: 0 });
    if (isStar && specialTagIds.highlight) rows.push({ clip_id: clip.id, tag_id: specialTagIds.highlight, bundle_number: 0 });
    if (isPoe && specialTagIds.poe) rows.push({ clip_id: clip.id, tag_id: specialTagIds.poe, bundle_number: 0 });
    if (rows.length > 0) {
      const { error: tagError } = await supabase.from('clip_tags').insert(rows);
      if (tagError) { Alert.alert('Error saving tags', tagError.message); setSaving(false); return; }
    }

    // Committed → reset the whole clip (window + groups + ★/POE) for the next one.
    // The sticky period stays (it carries across clips within a quarter).
    setStartTime(null);
    setEndTime(null);
    setBuilding([]);
    setStagedBundles([]);
    setIsStar(false);
    setIsPoe(false);
    loadExistingClips(); // refresh the marker strip with the just-saved clip
    setSaving(false);
  }

  // Period selector (top-left): the sport's period names, in fixed order, mapped
  // to the loaded global period tags. Only periods whose tag exists render — so a
  // visible button always has a real tag_id to stamp on save.
  const sportPeriods = periodsForSport(tagSport)
    .map(name => periodTags.find((p: any) => p.name === name))
    .filter(Boolean) as any[];

  return (
    <GestureHandlerRootView style={[styles.container, { width: landW, height: landH }]}>
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
            <TouchableOpacity style={styles.backBtn} onPress={handleBack} hitSlop={8}>
              <Text style={styles.backBtnText}>←</Text>
            </TouchableOpacity>
            {/* Phone: Save clip lives top-right. On iPad it moves into the
                bottom-right cluster (below), same shape as + Group. */}
            {!isWatch && !isTablet && (
              <TouchableOpacity
                style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
                disabled={!canSave}
                onPress={saveClip}
              >
                <Text style={styles.saveBtnText}>{saving ? 'Saving…' : groupCount > 0 ? `Save clip (${groupCount})` : 'Save clip'}</Text>
              </TouchableOpacity>
            )}
            {/* "Now tagged" readout — what's tagged at the current playhead, so a
                tagger reviewing an already-tagged game sees the tags in context.
                Centered, between Back and Save; tagging mode only. */}
            {!isWatch && activeTagNames.length > 0 && (
              <View style={styles.topReadout} pointerEvents="none">
                <View style={styles.topReadoutDot} />
                <Text style={styles.topReadoutText} numberOfLines={1}>{activeTagNames.join('  ·  ')}</Text>
              </View>
            )}

            {/* Game-period selector moved to the top-left cluster (below). */}
          </View>
        </LinearGradient>

        {/* Right-edge control strip — the fullscreen Tags/Video toggle + ★/POE.
            Lives here (not the crowded bottom row) so all three stay visible,
            and it stays tappable in fullscreen because the tag region reserves
            this width — same slot the old bundle strip used. */}
        {!isWatch && (
        <View
          style={[
            styles.sideStrip,
            isTablet
              // iPad: a horizontal cluster in the bottom-right, just above the
              // controls row (Start/End). Left→right: Save · + Group · Tag · ★ · !.
              ? { flexDirection: 'row', alignItems: 'center', right: insets.right + 12, bottom: insets.bottom + 64, width: undefined }
              : { top: insets.top + 60, bottom: insets.bottom + 76, right: insets.right + 8 },
          ]}
          pointerEvents="box-none"
        >
          {isTablet && (
            <TouchableOpacity
              style={[styles.iSaveBtn, !canSave && styles.saveBtnDisabled]}
              disabled={!canSave}
              onPress={saveClip}
            >
              <Text style={styles.iSaveText}>{saving ? 'Saving…' : groupCount > 0 ? `Save (${groupCount})` : 'Save clip'}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.addGroupBtn, !canAddGroup && styles.disabledBtn]}
            onPress={addGroup}
            disabled={!canAddGroup}
            hitSlop={6}
          >
            <Text style={styles.addGroupBtnText}>+ Group</Text>
            {/* Group count lives on the button now (bottom-right), replacing the
                old standalone "N staged" badge. Bumps up on every addGroup. */}
            {groupCount > 0 && (
              <View style={styles.groupCountBadge}>
                <Text style={styles.groupCountText}>{groupCount}</Text>
              </View>
            )}
          </TouchableOpacity>
          {/* Single Tag +/− toggle (same size as ★ / !): shows "Tag +" while
              compact (tap → enlarge tags) and "Tag −" while fullscreen (tap →
              shrink). One button, two states. */}
          <TouchableOpacity
            style={styles.tagSizeBtn}
            onPress={() => setTagMode(m => (m === 'compact' ? 'fullscreen' : 'compact'))}
            hitSlop={6}
          >
            <Text style={styles.tagSizeCap}>TAG</Text>
            <Text style={styles.tagSizeSym}>{tagMode === 'compact' ? '+' : '−'}</Text>
          </TouchableOpacity>
          <Animated.View style={[!videoReady && styles.disabledBtn, highlightAnimatedStyle]}>
            <TouchableOpacity
              style={[styles.highlightBtn, highlightLit && styles.highlightBtnActive]}
              onPress={toggleHighlight}
              hitSlop={8}
              disabled={!videoReady}
            >
              <Text style={[styles.highlightStar, highlightLit && styles.highlightStarActive]}>{highlightLit ? '★' : '☆'}</Text>
            </TouchableOpacity>
          </Animated.View>
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
        )}

        {/* Game-period selector (top-left) — small circles, one per period for
            the current sport (basketball → Q1..Q4, 1H, 2H). Sticky + mutually
            exclusive; the active period auto-stamps every saved clip. Renders
            only when the sport's period tags exist. */}
        {!isWatch && sportPeriods.length > 0 && (
          <View
            style={[styles.periodCluster, { top: insets.top + 60, left: insets.left + 6 }]}
            pointerEvents="box-none"
          >
            {sportPeriods.map((p) => {
              const on = activePeriod === p.id;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.periodDot, on ? styles.periodDotOn : styles.periodDotOff]}
                  onPress={() => setActivePeriod(on ? null : p.id)}
                  hitSlop={4}
                >
                  <Text style={[styles.periodDotText, on && styles.periodDotTextOn]}>{p.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Tag region — 4 category columns. Compact: short strip above the
            controls row. Fullscreen: same left/right/bottom; top extends up
            under the top bar so the columns get much more vertical space.
            Chip dimensions identical in both modes (per F.4 correction).
            Hidden in watch mode. */}
        {!isWatch && (
        <View
          style={[
            tagMode === 'compact' ? styles.tagRegion : styles.fullscreenTagRegion,
            {
              // Same bottom in both modes — keeps the scrub bar + controls row visible.
              // iPad: lift higher to clear the bottom-right group cluster.
              bottom: insets.bottom + 56 + 8 + 24 + 8 + (isTablet ? 46 : 0),
              // In fullscreen (and always on iPad) the columns sit up near the top,
              // where the top-left period cluster lives — inset the left so Offense clears it.
              left: insets.left + 12 + ((tagMode === 'fullscreen' || isTablet) && sportPeriods.length > 0 ? 84 : 0),
              // iPad frees the right edge (the strip moved to the bottom) → tags use more width.
              right: insets.right + (isTablet ? 12 : SIDE_STRIP_W + 16),
            },
            tagMode === 'fullscreen' && { top: insets.top + 60 },
          ]}
          pointerEvents="box-none"
        >
          {CATEGORIES.map(cat => (
            <View key={cat.key} style={styles.tagColumn}>
              <Text style={[styles.colHeader, isTablet && styles.colHeaderBig, { color: cat.color }]}>{cat.label.toUpperCase()}</Text>
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.chipsWrap}>
                  {tags[cat.key].map(tag => {
                    const selected = building.includes(tag.id);
                    return (
                      <TouchableOpacity
                        key={tag.id}
                        onPress={() => toggleTag(tag.id)}
                        style={[
                          styles.tagChip,
                          isTablet && styles.tagChipBig,
                          selected
                            ? { backgroundColor: cat.color, borderColor: 'rgba(255,255,255,0.4)' }
                            : { backgroundColor: 'rgba(255, 255, 255, 0.25)', borderColor: colorWithAlpha(cat.color, 0.6) },
                        ]}
                      >
                        <Text
                          style={[
                            styles.tagChipText,
                            isTablet && styles.tagChipTextBig,
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
        )}

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
                {/* Tag markers overlaid ON the scrub bar (tagging mode only) — one
                    segment per existing clip, aligned to the track's barWidth
                    coordinate space, so you SEE where tags already are while
                    tagging. Visual only (pointerEvents none) so the pan gesture
                    still owns the bar; navigation is via the ◄Tag/Tag► buttons. */}
                {!isWatch && barWidth > 0 && duration > 0 && existingClips.map(c => {
                  const left = (c.start / duration) * barWidth;
                  const w = Math.max(3, ((c.end - c.start) / duration) * barWidth);
                  const active = currentTime >= c.start && currentTime <= c.end;
                  const color = c.starred || c.poe ? '#EF9F27' : '#8B7CF6';
                  return (
                    <View
                      key={c.id}
                      pointerEvents="none"
                      style={[styles.marker, { left: Math.min(left, barWidth - w), width: w, backgroundColor: color, opacity: active ? 1 : 0.6 }]}
                    />
                  );
                })}
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
              <TouchableOpacity
                style={[styles.skipBtn, speed !== 1 && styles.speedBtnOn]}
                onPress={cycleSpeed}
                hitSlop={6}
              >
                <Text style={[styles.skipBtnText, speed !== 1 && styles.speedBtnOnText]}>{speedLabel(speed)}</Text>
              </TouchableOpacity>
              {!isWatch && existingClips.length > 0 && (
                <>
                  <TouchableOpacity style={styles.tagNavBtn} onPress={() => jumpToTag(-1)} hitSlop={6}>
                    <Text style={styles.tagNavBtnText}>◄ Tag</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.tagNavBtn} onPress={() => jumpToTag(1)} hitSlop={6}>
                    <Text style={styles.tagNavBtnText}>Tag ►</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            {!isWatch && (
            <View style={styles.markGroup}>
              <TouchableOpacity
                style={[styles.markBtn, styles.markStartBtn, !videoReady && styles.disabledBtn]}
                onPress={() => setStartTime(player.currentTime)}
                disabled={!videoReady}
              >
                <Text style={styles.markBtnText} numberOfLines={1}>
                  {startTime !== null ? `Start ${formatTime(startTime)}` : 'Start'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.markBtn, styles.markEndBtn, !videoReady && styles.disabledBtn]}
                onPress={() => setEndTime(player.currentTime)}
                disabled={!videoReady}
              >
                <Text style={styles.markBtnText} numberOfLines={1}>
                  {endTime !== null ? `End ${formatTime(endTime)}` : 'End'}
                </Text>
              </TouchableOpacity>
            </View>
            )}
          </View>
        </LinearGradient>
      </Animated.View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  loadingOverlay: {
    backgroundColor: '#000',
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
  speedBtnOn: { backgroundColor: '#f5c518' },
  speedBtnOnText: { color: '#1a1030', fontWeight: '800' },

  markGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  sideStrip: {
    position: 'absolute',
    width: SIDE_STRIP_W,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
  },
  markBtn: {
    paddingHorizontal: 10,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    // Fixed width so the button never resizes when the time appears/changes.
    width: 96,
  },
  markStartBtn: { backgroundColor: '#1D9E75' },
  markEndBtn: { backgroundColor: '#D85A30' },
  markBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  highlightBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#f5c518',
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Yellow Highlight = counterpart to the red POE. Inactive = outlined yellow on
  // dark; active = solid bright-yellow fill with a dark ★ (mirrors POE's red fill).
  highlightBtnActive: {
    backgroundColor: '#f5c518',
  },
  highlightStar: { color: '#f5c518', fontSize: 22, fontWeight: '700' },
  highlightStarActive: { color: '#1a1030' },

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
  // Marker overlaid ON the scrub bar — one segment per existing clip, aligned to
  // the track. top:3 sits just above the 4pt track centered in the 24pt target.
  marker: { position: 'absolute', top: 3, height: 5, borderRadius: 2.5, minWidth: 3 },
  // "Now tagged" readout in the top bar — centered between Back (left 40) and
  // Save (right 120), so it never collides with either.
  topReadout: {
    position: 'absolute', left: 280, right: 132, top: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  // Game-period selector — a small cluster of circles in the top-left (below the
  // Back arrow). Wraps to 2 per row. Orange active dot = game context, distinct
  // from the purple tag/save chrome. Same 36pt circle size as ★ / ! / Tag.
  periodCluster: {
    position: 'absolute', width: 78,
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
  },
  periodDot: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1.5,
    justifyContent: 'center', alignItems: 'center',
  },
  periodDotOff: { backgroundColor: 'rgba(0,0,0,0.35)', borderColor: 'rgba(255,255,255,0.35)' },
  periodDotOn: { backgroundColor: '#EF9F27', borderColor: '#EF9F27' },
  periodDotText: { color: 'rgba(255,255,255,0.95)', fontSize: 13, fontWeight: '700' },
  periodDotTextOn: { color: '#1a1a1a' },
  topReadoutDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#EF9F27' },
  topReadoutText: {
    color: '#fff', fontSize: 13, fontWeight: '700', flexShrink: 1,
    textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },
  // ◄Tag / Tag► step-through buttons in the controls row (tagging mode).
  tagNavBtn: {
    paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6,
    backgroundColor: 'rgba(139,124,246,0.28)', borderWidth: 1, borderColor: 'rgba(139,124,246,0.7)',
  },
  tagNavBtnText: { color: '#fff', fontSize: 11, fontWeight: '700' },
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

  // Tag + / Tag − — two small circles that grow / shrink the tag columns
  // (replaces the old single "Tags/Video" toggle). Styled like the ★ / ! circles;
  // both drive the same two tagMode states (fullscreen = bigger, compact = smaller).
  tagSizeBtn: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1.5,
    borderColor: 'rgba(139,124,246,0.85)', backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center', alignItems: 'center',
  },
  tagSizeCap: { color: '#cfc7ff', fontSize: 8, fontWeight: '700', letterSpacing: 0.5, lineHeight: 9 },
  tagSizeSym: { color: '#cfc7ff', fontSize: 17, fontWeight: '700', lineHeight: 18, marginTop: -1 },
  // "+ Group" (stage a bundle) with the group-count badge on its bottom-right
  // corner (replaces the old standalone "N staged" pill).
  addGroupBtn: { width: 58, paddingVertical: 8, borderRadius: 9, backgroundColor: '#1D9E75', justifyContent: 'center', alignItems: 'center' },
  addGroupBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  groupCountBadge: {
    position: 'absolute', bottom: -6, right: -6, minWidth: 20, height: 20, borderRadius: 10,
    backgroundColor: '#12151b', borderWidth: 1.5, borderColor: '#1D9E75',
    paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center',
  },
  groupCountText: { color: '#7ee0bd', fontSize: 11, fontWeight: '800' },
  // iPad-only overrides: roomier touch chips + the Save clip button that joins the
  // bottom-right group cluster (same rounded shape as + Group, purple to distinguish).
  colHeaderBig: { fontSize: 13 },
  tagChipBig: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  tagChipTextBig: { fontSize: 14 },
  iSaveBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 9, backgroundColor: '#534AB7', justifyContent: 'center', alignItems: 'center' },
  iSaveText: { color: '#fff', fontSize: 12, fontWeight: '800' },
});

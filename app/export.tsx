import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTeamContext } from '@/context';
import { supabase } from '@/supabase';
import { clipMatchesGroup } from '@/lib/core/clip-filtering';
import { categoriesForSports, pickerCategoryForKey, isActionCategory } from '@/lib/core/tag-categories';
import { mayReelClip, toEligibilityTags } from '@/lib/core/highlight-eligibility';
import { reserveReel, finalizeReel, discardReel, ReelNotAllowedError } from '@/lib/core/render-reel';
import { generateReelThumbnailInBackground } from '@/lib/native/optimize';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { router } from 'expo-router';
import { goBackOrHome } from '@/lib/nav';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, FlatList, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { webAlert } from '@/lib/webAlert';
import Dropdown, { type DropdownOption } from './components/Dropdown';
import FilterBar, { type FilterableItem } from './components/FilterBar';
import { EVENT_TYPES } from '@/lib/core/upload-meta';
import { colors } from '@/constants/theme';

// Step-1 game-picker filter options. Single-entry Type hides that dropdown
// (games only); Sort drops "Longest" (games have no duration).
const GAME_TYPE_OPTIONS: DropdownOption[] = [{ value: 'all', label: 'Games' }];
const GAME_SORT_OPTIONS: DropdownOption[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'az', label: 'A–Z' },
];

// Stamp categories are surfaced by dedicated controls (★/POE buttons, the quick
// exports, period), never as board sections — so they stay out of the picker.
const STAMP_CATEGORY_KEYS = new Set(['possession', 'period', 'special']);

const SERVER_URL = 'https://web-production-1bf7f.up.railway.app';
const ACTIVE_JOB_KEY = 'iamsports.active_export_job';
const ACTIVE_JOB_TTL_MS = 2 * 60 * 60 * 1000;

// Tier 1 export resume: persist the in-flight jobId so backgrounding the app
// (or unmounting the export screen) doesn't lose it. On mount or foreground,
// we read this back and either resume polling or pick up a finished job.
async function clearActiveJob() {
  try { await AsyncStorage.removeItem(ACTIVE_JOB_KEY); } catch {}
}

async function saveActiveJob(jobId: string) {
  try {
    await AsyncStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({ jobId, startedAt: Date.now() }));
  } catch {}
}

// Derive the bare storage object key from a finished-job URL. videos.url stores
// the object key (path within the private 'Videos' bucket), NOT a full URL —
// see app/game.tsx. Railway writes exports to the exports/ subfolder, so the key
// is e.g. "exports/<file>.mp4". Strips everything up to and including "/Videos/"
// plus any query string (signed-URL token). Falls back to the query-stripped
// input if no bucket marker is present.
function deriveStoragePath(url: string): string {
  const marker = '/Videos/';
  const idx = url.indexOf(marker);
  const afterBucket = idx >= 0 ? url.slice(idx + marker.length) : url;
  return afterBucket.split('?')[0];
}

async function readActiveJob(): Promise<{ jobId: string; startedAt: number } | null> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_JOB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.jobId || typeof parsed.startedAt !== 'number') return null;
    if (Date.now() - parsed.startedAt > ACTIVE_JOB_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Default reel name from the included clips — distinct game titles joined, or a
// date fallback. Shared by the review-step prefill and saveReelRecord's fallback
// so an auto-named reel is identical whether or not the user edited the field.
function defaultReelName(clipObjects: any[]): string {
  const gameTitles = [...new Set(clipObjects.map((c: any) => c.gameTitle).filter(Boolean))];
  return gameTitles.length > 0
    ? `${gameTitles.join(' · ')} Highlights`
    : `Highlights · ${new Date().toLocaleDateString()}`;
}

export default function ExportScreen() {
  const [games, setGames] = useState<any[]>([]);
  const [tags, setTags] = useState<any[]>([]);
  const [selectedGames, setSelectedGames] = useState<string[]>([]);
  const [tagGroups, setTagGroups] = useState<string[][]>([]);
  const [currentGroup, setCurrentGroup] = useState<string[]>([]);
  const [clips, setClips] = useState<any[]>([]);
  const [excludedClips, setExcludedClips] = useState<string[]>([]);
  const [step, setStep] = useState<'games' | 'tags' | 'review'>('games');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const [exportProgress, setExportProgress] = useState(0);
  // Tier 1: when resuming a persisted job we skip the clip-selector view and
  // show only the progress card.
  const [resuming, setResuming] = useState(false);
  // Review-step footer: user-editable reel name (pre-filled with the auto-name)
  // and whether to ALSO save to the camera roll. The reel always saves to My Work.
  const [reelName, setReelName] = useState('');
  const [saveToCameraRoll, setSaveToCameraRoll] = useState(true);
  // Download quality: 'standard' renders from the 720p copy (fast, small); 'maximum'
  // renders each clip from the 4K master (videos.original_url) where it exists — for
  // showcase reels + zooming in. Falls back to 720p per-clip when no master is kept.
  const [quality, setQuality] = useState<'standard' | 'maximum'>('standard');
  // Reel team + descriptive tags chosen at creation. Team defaults from the
  // source games (below); tags are on top of the auto-copied clip tags.
  const [reelTeamId, setReelTeamId] = useState('');
  const [reelDescTags, setReelDescTags] = useState<Set<string>>(new Set());

  const { userTeams, userId, userKids } = useTeamContext();
  // Reel eligibility context (see lib/core/highlight-eligibility.ts). A coach on a
  // clip's team is unrestricted; everyone else gets their own personal clips plus
  // coach clips where their linked player made the play. The DB enforces the same
  // rule on the highlight_reels insert — this only keeps the UI honest.
  const eligibilityCtx = useMemo(() => ({
    userId: userId ?? null,
    coachTeamIds: new Set<string>(
      (userTeams || []).filter((t: any) => ['admin', 'head_coach', 'coach'].includes(t.role)).map((t: any) => t.team_id),
    ),
    linkedPlayerIds: new Set<string>((userKids || []).map((k: any) => k.player_id)),
  }), [userId, userTeams, userKids]);
  const reelTeamOptions = useMemo<DropdownOption[]>(() => {
    const seen = new Map<string, string>();
    userTeams.forEach(t => { if (!seen.has(t.team_id)) seen.set(t.team_id, t.name); });
    return [{ value: '', label: 'None' }, ...[...seen].map(([value, label]) => ({ value, label }))];
  }, [userTeams]);
  function toggleReelDescTag(id: string) {
    setReelDescTags(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  // Prefill the reel's team from the source games when the review step opens, if
  // they all share one team. Best-effort: does nothing if games lack team_id.
  useEffect(() => {
    if (step !== 'review' || reelTeamId !== '') return;
    const teamIds = [...new Set(selectedGames.map(id => games.find((g: any) => g.id === id)?.team_id).filter(Boolean))];
    if (teamIds.length === 1) setReelTeamId(teamIds[0] as string);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Pre-fill the reel name with the auto-name when the review step opens. Only
  // fills when empty so it never clobbers a name the user has already typed.
  useEffect(() => {
    if (step !== 'review' || reelName.trim() !== '') return;
    const included = clips.filter(c => !excludedClips.includes(`${c.id}-${c.groupIndex}`));
    if (included.length > 0) setReelName(defaultReelName(included));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, clips, excludedClips]);

  // Polling refs — mountedRef gates setState calls after unmount, intervalRef
  // lets the cleanup effect clear the active poll if the user navigates away
  // mid-export. The server keeps processing regardless; we just stop listening.
  const mountedRef = useRef(true);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Guards the foreground AppState handler from racing with an active export.
  const exportingRef = useRef(false);
  useEffect(() => { exportingRef.current = exporting; }, [exporting]);

  useEffect(() => {
    fetchGames();
    fetchTags();
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  async function saveExportToLibrary(videoUrl: string) {
    setExportStatus('Saving to camera roll...');
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status === 'granted') {
      const localPath = FileSystem.documentDirectory + 'highlight.mp4';
      await FileSystem.downloadAsync(videoUrl, localPath);
      await MediaLibrary.saveToLibraryAsync(localPath);
      webAlert('Saved! 🎉', 'Your highlight reel has been saved to your camera roll!');
    } else {
      webAlert('Export Ready! 🎉', 'Video exported successfully!');
    }
  }

  // The reel ROW is created up-front by reserveReel() (that insert is the
  // authorization gate) and completed by finalizeReel(). All that is left here is
  // the decoration: the poster thumbnail and the source clips' tags. Both are
  // best-effort — neither may throw or undo an already-finished reel.
  async function attachReelExtras(reelId: string, includedClipObjects: any[], descTagIds?: string[]) {
    try {
      generateReelThumbnailInBackground(reelId);
      const tagIds = [...new Set([...includedClipObjects.flatMap((c: any) => c.tagIds || []), ...(descTagIds || [])])];
      if (tagIds.length > 0) {
        const rows = tagIds.map(tag_id => ({ reel_id: reelId, tag_id }));
        const { error: tagErr } = await supabase.from('reel_tags').insert(rows);
        if (tagErr) console.warn('[reel] reel_tags insert failed:', tagErr.message);
      }
    } catch (e: any) {
      console.warn('[reel] attachReelExtras threw:', e?.message || e);
    }
  }

  // Tier 1 resume: on mount and on foreground, check AsyncStorage for an
  // in-flight job and either pick up its result or resume polling.
  async function checkForActiveExport() {
    if (exportingRef.current) return;
    const active = await readActiveJob();
    if (!active) return;

    let job: any;
    try {
      const response = await fetch(`${SERVER_URL}/job/${active.jobId}`);
      if (response.status === 404) {
        await clearActiveJob();
        return;
      }
      job = await response.json();
    } catch {
      // Network unreachable — leave the stored job alone; retry next foreground.
      return;
    }

    if (!mountedRef.current) return;
    setResuming(true);
    setExporting(true);
    setStep('review');
    setExportProgress(job.progress || 0);
    setExportStatus(job.label || `Processing... ${job.progress || 0}%`);

    const finishResume = () => {
      if (!mountedRef.current) return;
      setExporting(false);
      setResuming(false);
      setExportProgress(0);
      setExportStatus('');
      setStep('games');
    };

    if (job.status === 'done') {
      await clearActiveJob();
      try { await saveExportToLibrary(job.url); }
      catch (e: any) { webAlert('Save error', e?.message || 'Failed to save to camera roll'); }
      finishResume();
      return;
    }
    if (job.status === 'failed') {
      await clearActiveJob();
      webAlert('Export failed', job.error || 'Unknown error');
      finishResume();
      return;
    }

    // Still processing — resume polling. pollJob clears AsyncStorage on done/failed.
    try {
      const url = await pollJob(active.jobId);
      if (!mountedRef.current) return;
      await saveExportToLibrary(url);
    } catch (e: any) {
      webAlert('Export error', e?.message || 'Polling failed');
    } finally {
      finishResume();
    }
  }

  useEffect(() => {
    checkForActiveExport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') checkForActiveExport();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchGames() {
    // Embed season/tournament names + videos' event types so the step-1 filter
    // bar can offer Event/Season/Tournament without extra round-trips.
    const { data, error } = await supabase
      .from('games')
      .select('*, seasons (name), tournaments (name), videos (id, event_type, sport)')
      .is('deleted_at', null) // don't surface soft-deleted games — every other screen filters this; export was the lone gap
      .order('created_at', { ascending: false });
    if (error) { webAlert('Couldn’t load games', error.message); return; }
    setGames(data || []);
  }

  // ---- Step 1 game picker: the Film Room's filter/sort stack ----
  const [gameTagsById, setGameTagsById] = useState<Map<string, Set<string>>>(new Map());
  // Per-clip tag sets (one entry per tagged clip, with its game) — powers the
  // used-tags scoping (slice 1) and player co-occurrence dimming (slice 2).
  const [clipTagSets, setClipTagSets] = useState<{ gameId: string; tags: Set<string> }[]>([]);
  const [visibleGameItems, setVisibleGameItems] = useState<FilterableItem[]>([]);

  const teamNameById = useMemo(() => {
    const m = new Map<string, string>();
    userTeams.forEach(t => { if (!m.has(t.team_id)) m.set(t.team_id, t.name); });
    return m;
  }, [userTeams]);
  // A team's sport, for videos whose own `sport` is null. The taggers resolve
  // `videos.sport ?? activeTeam.sport`; Export read videos.sport ALONE, so a
  // null-sport video contributed no sport at all and a selection of only such
  // videos fell through to the `_default` legacy columns — the team's real
  // taxonomy never appeared. Same source of truth as teamNameById.
  const teamSportById = useMemo(() => {
    const m = new Map<string, string>();
    userTeams.forEach(t => { if (t.sport && !m.has(t.team_id)) m.set(t.team_id, t.sport); });
    return m;
  }, [userTeams]);
  // Video sport, falling back to its team's — the taggers' rule, one place.
  const sportOfVideo = (videoSport: any, teamId: any): string | null => {
    const s = (videoSport ?? (teamId ? teamSportById.get(String(teamId)) : null) ?? null) as string | null;
    const trimmed = s ? String(s).trim() : '';
    return trimmed ? trimmed.toLowerCase() : null;
  };
  const gamesById = useMemo(() => new Map(games.map((g: any) => [g.id, g])), [games]);
  // A game's event type = its first video that carries one.
  const eventTypeOf = (g: any): string => (g.videos || []).map((v: any) => v.event_type).find((e: any) => e) ?? '';

  const gameItems = useMemo<FilterableItem[]>(
    () => games.map((g: any) => ({
      id: g.id,
      teamId: g.team_id ?? '',
      teamName: teamNameById.get(g.team_id) ?? '',
      contentType: 'game',
      title: g.title,
      createdAt: g.created_at,
      extra: { eventType: eventTypeOf(g), seasonId: g.season_id ?? '', tournamentId: g.tournament_id ?? '' },
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [games, teamNameById],
  );

  const gameTeamOptions = useMemo<DropdownOption[]>(() => {
    const seen = new Map<string, string>();
    games.forEach((g: any) => { if (g.team_id) seen.set(g.team_id, teamNameById.get(g.team_id) ?? 'Team'); });
    return [{ value: 'all', label: 'All teams' }, ...[...seen].map(([value, label]) => ({ value, label }))];
  }, [games, teamNameById]);

  const gameExtraFilters = useMemo(() => {
    const out: { key: string; label: string; options: DropdownOption[] }[] = [];
    const events = new Set(games.map((g: any) => eventTypeOf(g)).filter(Boolean) as string[]);
    if (events.size >= 2) {
      const labelFor = (v: string) => EVENT_TYPES.find(e => e.value === v)?.label ?? v;
      out.push({ key: 'eventType', label: 'Event', options: [{ value: 'all', label: 'All events' }, ...[...events].map(v => ({ value: v, label: labelFor(v) }))] });
    }
    const seasons = new Map<string, string>();
    games.forEach((g: any) => { if (g.season_id) seasons.set(g.season_id, g.seasons?.name ?? 'Season'); });
    if (seasons.size >= 2) out.push({ key: 'seasonId', label: 'Season', options: [{ value: 'all', label: 'All seasons' }, ...[...seasons].map(([value, label]) => ({ value, label }))] });
    const tours = new Map<string, string>();
    games.forEach((g: any) => { if (g.tournament_id) tours.set(g.tournament_id, g.tournaments?.name ?? 'Tournament'); });
    if (tours.size >= 1) out.push({ key: 'tournamentId', label: 'Tournament', options: [{ value: 'all', label: 'All' }, ...[...tours].map(([value, label]) => ({ value, label }))] });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games]);

  const gameTagMeta = useMemo(() => {
    const m = new Map<string, { name: string; category: string }>();
    (tags || []).forEach((t: any) => m.set(t.id, { name: t.name, category: t.category }));
    return m;
  }, [tags]);

  // SLICE 1 — tags actually applied to clips in the SELECTED games. The picker
  // scopes to this, so a basketball export never shows football (or unused) tags.
  const usedTagIds = useMemo(() => {
    const sel = new Set(selectedGames);
    const s = new Set<string>();
    clipTagSets.forEach(c => { if (sel.has(c.gameId)) c.tags.forEach(t => s.add(t)); });
    return s;
  }, [clipTagSets, selectedGames]);

  // SLICE 2 — when the group-in-progress includes player tag(s), the set of tags
  // that co-occur (on the same clip, in the selected games) with ALL those
  // players. Picker dims tags outside this set. null = no player picked → no dim.
  const playerCoTagIds = useMemo(() => {
    const playerIds = currentGroup.filter(id => gameTagMeta.get(id)?.category === 'players');
    if (playerIds.length === 0) return null;
    const sel = new Set(selectedGames);
    const s = new Set<string>();
    clipTagSets.forEach(c => {
      if (!sel.has(c.gameId)) return;
      if (playerIds.every(pid => c.tags.has(pid))) c.tags.forEach(t => s.add(t));
    });
    return s;
  }, [clipTagSets, selectedGames, currentGroup, gameTagMeta]);

  // Which tag IDs are actually applied to each game's clips, keyed by game id.
  // Reads clips with their clip_tags NESTED in one query — the exact pattern the
  // working "Make a highlight" screen (make-highlight.tsx) uses. The prior version
  // did a separate `from('clip_tags').in('clip_id', [...])` walk that came back
  // empty at runtime and silently showed "no tags"; nesting + surfacing the error
  // fixes that. Powers used-tags scoping (slice 1) and co-occurrence dimming (2).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const videoToGame = new Map<string, string>();
      games.forEach((g: any) => (g.videos || []).forEach((v: any) => videoToGame.set(v.id, g.id)));
      const videoIds = [...videoToGame.keys()];
      const byId = new Map<string, Set<string>>();
      const perClipMap = new Map<string, { gameId: string; tags: Set<string> }>();
      if (videoIds.length > 0) {
        const { data: clipRows, error } = await supabase
          .from('clips')
          .select('id, video_id, clip_tags ( tag_id )')
          .in('video_id', videoIds);
        // Never fail silently: if the read errors, say so instead of showing "no tags".
        if (error && !cancelled) webAlert('Couldn’t load tags for these games', error.message);
        (clipRows || []).forEach((c: any) => {
          const gid = videoToGame.get(c.video_id);
          if (!gid) return;
          const s = byId.get(gid) ?? new Set<string>();
          const pc = perClipMap.get(c.id) ?? { gameId: gid, tags: new Set<string>() };
          (c.clip_tags || []).forEach((ct: any) => {
            if (!ct?.tag_id) return;
            s.add(ct.tag_id);       // game → used tag ids
            pc.tags.add(ct.tag_id); // per-clip set
          });
          byId.set(gid, s);
          perClipMap.set(c.id, pc);
        });
      }
      if (!cancelled) { setGameTagsById(byId); setClipTagSets([...perClipMap.values()]); }
    })();
    return () => { cancelled = true; };
  }, [games]);

  async function fetchTags() {
    const { data, error } = await supabase.from('tags').select('*').order('category', { ascending: true });
    if (error) { webAlert('Couldn’t load tags', error.message); return; }
    setTags(data || []);
  }

  // Special-category tags ('★ Highlight', 'POE') are surfaced only via the
  // dedicated HIGHLIGHTS / EMPHASIS buttons below. Derived from `tags` on
  // every render — cheap O(n) and avoids a separate state. Undefined until
  // the fetch completes; button onPress no-ops in that window.
  const highlightTagId = tags.find(t => t.category === 'special' && t.name === '★ Highlight')?.id;
  const poeTagId = tags.find(t => t.category === 'special' && t.name === 'POE')?.id;

  function toggleGame(id: string) {
    setSelectedGames(prev => prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]);
  }

  function toggleTagInGroup(id: string) {
    setCurrentGroup(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
  }

  function addGroup() {
    if (currentGroup.length === 0) { webAlert('Select at least one tag first', 'Select at least one tag first'); return; }
    setTagGroups(prev => [...prev, currentGroup]);
    setCurrentGroup([]);
  }

  function removeGroup(index: number) {
    setTagGroups(prev => prev.filter((_, i) => i !== index));
  }

  function getTagName(id: string) {
    return tags.find(t => t.id === id)?.name || id;
  }

  function toggleExclude(id: string) {
    setExcludedClips(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
  }

  async function loadClips(groupsArg?: string[][], chronological = false) {
    const allGroups = groupsArg ?? (currentGroup.length > 0 ? [...tagGroups, currentGroup] : tagGroups);
    if (selectedGames.length === 0) { webAlert('Select at least one game', 'Select at least one game'); return; }
    if (allGroups.length === 0) { webAlert('Add at least one tag group', 'Add at least one tag group'); return; }
    setLoading(true);

    const { data: videos, error: videosErr } = await supabase
      .from('videos')
      .select('id, url, original_url, label, game_id, upload_status, sport, team_id, sort_order')
      .in('game_id', selectedGames)
      .is('deleted_at', null); // skip soft-deleted videos too
    if (videosErr) { webAlert('Couldn’t load videos', videosErr.message); setLoading(false); return; }
    const videoMap: Record<string, any> = {};
    // Only finalized videos can be exported — skip 'uploading'/'failed' (no complete
    // object to cut from). Their clips are excluded downstream via videoIds.
    (videos || []).forEach((v: any) => { if (v.upload_status === 'ready') videoMap[v.id] = v; });
    const videoIds = Object.keys(videoMap);

    if (videoIds.length === 0) {
      webAlert('No videos found for selected games', 'No videos found for selected games');
      setLoading(false);
      return;
    }

    // Load clips WITH their tags nested in one query — the pattern that works
    // for this account (a per-clip direct clip_tags read came back empty at
    // runtime, so every clip looked tagless and nothing matched). Also turns
    // ~80 round-trips into one.
    const { data: clipData, error: clipErr } = await supabase
      .from('clips')
      .select('*, clip_tags ( tag_id, bundle_number, tags ( category, player_id, tag_polarity ) )')
      .in('video_id', videoIds);
    if (clipErr) { webAlert('Couldn’t load clips', clipErr.message); setLoading(false); return; }

    const clipsWithTags = (clipData || []).map((clip: any) => {
      // Organize this clip's tags by bundle (0 = clip-level, 1+ = bundle groups).
      const clipLevelTagIds: string[] = [];
      const bundleMap: Record<number, string[]> = {};
      (clip.clip_tags || []).forEach((t: any) => {
        const bn = t.bundle_number ?? 0;
        if (bn === 0) {
          clipLevelTagIds.push(t.tag_id);
        } else {
          if (!bundleMap[bn]) bundleMap[bn] = [];
          bundleMap[bn].push(t.tag_id);
        }
      });
      const bundles = Object.values(bundleMap);
      const tagIds = (clip.clip_tags || []).map((t: any) => t.tag_id);

      const video = videoMap[clip.video_id];
      const game = games.find(g => g.id === video?.game_id);
      return {
        ...clip,
        tagIds,
        clipLevelTagIds,
        bundles,
        videoUrl: video?.url,
        videoOriginalUrl: video?.original_url ?? null,
        videoSport: (video?.sport ?? null) as string | null,
        videoTeamId: (video?.team_id ?? null) as string | null,
        videoLabel: video?.label,
        gameTitle: game?.title,
        gameDate: game?.game_date ?? null,
        videoSortOrder: (video?.sort_order ?? 0) as number,
      };
    });

    // Reel-eligibility gate: drop clips this user may not put in a reel before any
    // matching happens. Coaches are unaffected (the rule short-circuits for them).
    const eligibleClips = clipsWithTags.filter((clip: any) => mayReelClip(
      { teamId: clip.team_id ?? null, origin: clip.origin ?? null,
        createdByUserId: clip.created_by_user_id ?? null, tags: toEligibilityTags(clip.clip_tags) },
      eligibilityCtx,
    ));

    // Match clips to groups using bundle-aware AND logic
    const matchedClips: any[] = [];
    allGroups.forEach((group, groupIndex) => {
      const groupClips = eligibleClips.filter(clip => clipMatchesGroup(clip, group));
      groupClips.forEach(clip => {
        matchedClips.push({ ...clip, groupIndex, groupTags: group });
      });
    });

    // Quick export requests chronological game order (game date → video sort_order →
    // clip start). Normal selections are left in their existing order (unchanged).
    if (chronological) {
      matchedClips.sort((a, b) =>
        String(a.gameDate ?? '').localeCompare(String(b.gameDate ?? '')) ||
        (a.videoSortOrder - b.videoSortOrder) ||
        ((a.start_time ?? 0) - (b.start_time ?? 0)));
    }
    setClips(matchedClips);
    setExcludedClips([]);
    if (currentGroup.length > 0) setTagGroups(allGroups);
    setCurrentGroup([]);
    setStep('review');
    setLoading(false);
  }

  // Quick export: one tap selects every clip stamped with a phase (OFF/DEF/SP) via a
  // normal single-tag group, so clipMatchesGroup does the matching unchanged; output
  // is chronological (game order). Rendered only for phased sports (see tags step).
  function runQuickExport(phaseTagId: string) {
    setTagGroups([[phaseTagId]]);
    loadClips([[phaseTagId]], true);
  }

  async function pollJob(jobId: string) {
    return new Promise<string>((resolve, reject) => {
      const stopPolling = () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      };
      pollIntervalRef.current = setInterval(async () => {
        if (!mountedRef.current) { stopPolling(); return; }
        try {
          const response = await fetch(`${SERVER_URL}/job/${jobId}`);
          const job = await response.json();
          if (!mountedRef.current) { stopPolling(); return; }
          setExportProgress(job.progress || 0);
          setExportStatus(job.label || `Processing... ${job.progress || 0}%`);
          if (job.status === 'done') {
            stopPolling();
            clearActiveJob().catch(() => {});
            resolve(job.url);
          } else if (job.status === 'failed') {
            stopPolling();
            clearActiveJob().catch(() => {});
            reject(new Error(job.error || 'Export failed'));
          }
        } catch (e) {
          // Transient fetch error — stop the interval but keep the stored job so
          // a future mount/foreground can resume polling.
          stopPolling();
          reject(e);
        }
      }, 3000);
    });
  }

  async function handleExport() {
    console.log('[export] handleExport called');
    setExporting(true);
    setExportStatus('Starting export...');
    setExportProgress(0);

    const includedClipObjects = clips
      .filter(c => !excludedClips.includes(`${c.id}-${c.groupIndex}`));
    // Maximum → the 4K master (original_url) when it exists, else the 720p copy for
    // that clip (graceful per-clip). Standard → always the 720p copy.
    const includedClips = includedClipObjects
      .map(c => ({
        url: quality === 'maximum' && c.videoOriginalUrl ? c.videoOriginalUrl : c.videoUrl,
        start_time: c.start_time,
        end_time: c.end_time,
      }));
    console.log('[export] includedClips count:', includedClips.length, 'first clip:', includedClips[0]);

    let reelId: string | null = null;
    try {
      // AUTHORIZE FIRST. highlight_reels' WITH CHECK runs may_reel_clip() over these
      // ids; an ineligible clip stops the export before Railway is ever called. The
      // row is reserved at status='rendering' with a null storage_path, so it can
      // never be mistaken for a finished reel.
      const durationSeconds = includedClipObjects.reduce(
        (sum: number, c: any) => sum + Math.max(0, (c.end_time ?? 0) - (c.start_time ?? 0)), 0);
      reelId = await reserveReel({
        clipIds: includedClipObjects.map((c: any) => c.id),
        name: (reelName && reelName.trim()) ? reelName.trim() : defaultReelName(includedClipObjects),
        teamId: reelTeamId ?? null,
        durationSeconds,
      });

      console.log('[export] POSTing to Railway', `${SERVER_URL}/export`, 'clips:', includedClips.length);
      const response = await fetch(`${SERVER_URL}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clips: includedClips, outputFileName: 'iamsports-highlight.mp4' }),
      });

      const data = await response.json();
      if (!response.ok) {
        console.log('[export] server rejected:', response.status, data);
        webAlert('Export failed', data.error || 'Something went wrong');
        if (reelId) { await discardReel(reelId); reelId = null; }
        setExporting(false); return;
      }

      // Persist before polling so a backgrounded app can resume this job.
      await saveActiveJob(data.jobId);

      setExportStatus('Processing clips...');
      const videoUrl = await pollJob(data.jobId);

      // Finish the reservation made above — guarded on status='rendering', so a retry
      // can never produce a second completed record for the same reel.
      await finalizeReel(reelId, { storagePath: deriveStoragePath(videoUrl), durationSeconds });
      await attachReelExtras(reelId, includedClipObjects, [...reelDescTags]);
      reelId = null; // finalized — must not be discarded below

      if (saveToCameraRoll) {
        await saveExportToLibrary(videoUrl);
      } else {
        webAlert('Saved!', 'Your reel is in Film Room.');
      }
    } catch (e: any) {
      console.log('[export] FAILED:', e);
      if (e instanceof ReelNotAllowedError) {
        webAlert('Not available', 'Some of those clips aren’t available for a reel. Pick clips where your player made the play.');
      } else {
        webAlert('Export error', e.message);
      }
    } finally {
      // A reservation whose render never produced a file must not linger.
      if (reelId) { await discardReel(reelId); }
    }
    setExporting(false);
    setExportStatus('');
    setExportProgress(0);
  }

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function getDuration(start: number, end: number) {
    return `${Math.round(end - start)}s`;
  }

  // Tier 1 resume mode: skip the wizard, show only progress until the
  // restored job finishes (success or failure clears resuming back to false).
  if (resuming) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Export Highlights</Text>
        <Text style={styles.subtitle}>Resuming previous export...</Text>
        {exporting && (
          <View style={styles.exportingContainer}>
            <Text style={styles.exportingText}>{exportStatus}</Text>
            <View style={styles.progressOuter}>
              <View style={[styles.progressInner, { width: `${exportProgress}%` as any }]} />
            </View>
            <Text style={styles.progressLabel}>{exportProgress}%</Text>
          </View>
        )}
      </View>
    );
  }

  if (step === 'games') {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={goBackOrHome} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Export Highlights</Text>
        <Text style={styles.subtitle}>Step 1 of 3 — Pick games to include</Text>
        <FilterBar
          items={gameItems}
          tagsById={gameTagsById}
          tagMeta={gameTagMeta}
          teamOptions={gameTeamOptions}
          typeOptions={GAME_TYPE_OPTIONS}
          sortOptions={GAME_SORT_OPTIONS}
          extraFilters={gameExtraFilters}
          searchPlaceholder="Search games"
          onVisibleChange={setVisibleGameItems}
        />
        <FlatList
          style={{ flex: 1 }}
          data={visibleGameItems}
          keyExtractor={item => item.id}
          renderItem={({ item }) => {
            const g = gamesById.get(item.id);
            if (!g) return null;
            return (
              <TouchableOpacity
                style={[styles.selectCard, selectedGames.includes(g.id) && styles.selectedCard]}
                onPress={() => toggleGame(g.id)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, selectedGames.includes(g.id) && styles.selectedText]}>{g.title}</Text>
                  <Text style={[styles.cardSub, selectedGames.includes(g.id) && { color: '#ddd' }]}>{g.game_date}</Text>
                </View>
                {selectedGames.includes(g.id) && <Text style={styles.check}>✓</Text>}
              </TouchableOpacity>
            );
          }}
        />
        <TouchableOpacity
          style={[styles.nextBtn, selectedGames.length === 0 && styles.disabledBtn]}
          onPress={() => selectedGames.length > 0 && setStep('tags')}
        >
          <Text style={styles.nextBtnText}>Next: Build Tag Groups →</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (step === 'tags') {
    // Picker categories come from the sport definition (SPORT_TAG_CONTRACT), unioned
    // over the sports of the selected games, so a flag game shows its OFF/DEF/SP
    // phase categories and a basketball game is unchanged. Players stays last.
    const pickerSports = new Set<string>();
    selectedGames.forEach(gid => {
      const g = gamesById.get(gid);
      (g?.videos || []).forEach((v: any) => {
        const s = sportOfVideo(v.sport, g?.team_id);
        if (s) pickerSports.add(s);
      });
    });
    // HISTORICAL SAFETY. The picker is the UNION of (a) the categories the selected
    // games' sports define today and (b) the categories of tags ACTUALLY USED in
    // those games. Without (b), a tag the team's current format no longer offers —
    // Special Teams on a team that has moved to 5v5, say — would have no section to
    // render in, and an old clip tagged with it would become undiscoverable even
    // though the tag is still on the clip. Format controls what is offered for NEW
    // tagging; it must never erase history.
    //
    // Historical categories are resolved through the shared registry, so they keep
    // their real label and phase ('SP · PLAY', not a raw `st_play` heading). A key
    // in no sport definition is still RENDERED (never hide a used tag) but reported.
    const currentDefs = categoriesForSports(pickerSports);
    const definedKeys = new Set(currentDefs.map(c => c.key));
    const usedCategoryKeys = new Set<string>();
    tags.forEach((t: any) => { if (usedTagIds.has(t.id)) usedCategoryKeys.add(t.category); });
    const historicalDefs = [...usedCategoryKeys]
      .filter(k => !definedKeys.has(k) && !STAMP_CATEGORY_KEYS.has(k) && k !== 'players')
      .map(k => pickerCategoryForKey(k))
      .filter(c => {
        if (!c.known) console.warn('[export] used historical category has no shared definition:', c.key);
        return true;   // render it regardless — a used tag must stay discoverable
      });
    const categoryDefs: { key: string; label: string; phase?: string }[] = [
      ...currentDefs,
      ...historicalDefs,
      { key: 'players', label: 'Players' },
    ];
    // Quick-export buttons come from the possession stamps ACTUALLY USED in the
    // selected games. Possession is written on every sport's clips, so this is no
    // longer gated on the sport having an OFF/DEF/SP phase selector — basketball now
    // gets All offense / All defense from data it already stamps. Flag is unchanged:
    // the same three tags, ordered the same way. Honours the used-tags-only rule.
    const POSSESSION_ORDER = ['Offense', 'Defense', 'Special Teams'];
    const quickPhases = tags
      .filter((t: any) => t.category === 'possession' && usedTagIds.has(t.id))
      .sort((a: any, b: any) => POSSESSION_ORDER.indexOf(a.name) - POSSESSION_ORDER.indexOf(b.name))
      .map((t: any) => ({ label: t.name as string, tagId: t.id as string }));
    const highlightSelected = !!highlightTagId && currentGroup.includes(highlightTagId);
    const poeSelected = !!poeTagId && currentGroup.includes(poeTagId);
    // Over-stacked = a group that can't realistically land on one play: 3+ action
    // tags, or 2+ actions with no player (e.g. Made 2 + Made 3). A normal group is
    // one action + a player, or a scoring play + assist (2 actions WITH players).
    const groupCats = currentGroup.map(id => gameTagMeta.get(id)?.category);
    // "Action" comes from the shared sport definition, not a hardcoded list: the old
    // `offense|defense|plays` test only knew the legacy basketball keys, so the warning
    // was dead on the eight launch sports that use per-phase keys. isActionCategory()
    // covers every sport's board categories and excludes players + the stamps.
    // ADVISORY ONLY — matching and bundle semantics are untouched.
    const groupActionCount = groupCats.filter(c => isActionCategory(c)).length;
    const groupPlayerCount = groupCats.filter(c => c === 'players').length;
    const groupOverStacked = groupActionCount >= 3 || (groupActionCount >= 2 && groupPlayerCount === 0);
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
        <TouchableOpacity onPress={() => setStep('games')} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Export Highlights</Text>
        <Text style={styles.subtitle}>Step 2 of 3 — Build tag groups</Text>
        <Text style={styles.hint}>Each group = one play. Pick an action + a player — like Made 3 + Conrad — then tap + Add Group. Repeat for each play; groups combine, so you get clips matching any of them.</Text>

        {tagGroups.length > 0 && (
          <View style={styles.groupsContainer}>
            <Text style={styles.groupsLabel}>Your groups:</Text>
            {tagGroups.map((group, index) => (
              <View key={index} style={styles.groupPill}>
                <Text style={styles.groupPillText}>
                  {group.map(id => getTagName(id)).join(' + ')}
                </Text>
                <TouchableOpacity onPress={() => removeGroup(index)}>
                  <Text style={styles.groupPillRemove}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {currentGroup.length > 0 && (
          <View style={[styles.currentGroup, groupOverStacked && styles.currentGroupWarn]}>
            <Text style={styles.currentGroupLabel}>Current group:</Text>
            <Text style={styles.currentGroupTags}>
              {currentGroup.map(id => getTagName(id)).join(' + ')}
            </Text>
            {groupOverStacked ? (
              <Text style={styles.groupWarn}>⚠️ These all have to happen on ONE play to match — that&apos;s rare. If they&apos;re separate highlights, tap + Add Group between each.</Text>
            ) : (
              <Text style={styles.groupMeaning}>
                {currentGroup.length === 1
                  ? 'Matches clips with this tag.'
                  : 'Matches clips where all of these happened together on the same play.'}
              </Text>
            )}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>HIGHLIGHTS</Text>
          <View style={styles.tagGrid}>
            <TouchableOpacity
              style={[styles.tagBtnHighlight, highlightSelected && styles.tagBtnHighlightSelected]}
              onPress={() => highlightTagId && toggleTagInGroup(highlightTagId)}
            >
              <Text style={[styles.tagBtnHighlightText, highlightSelected && styles.tagBtnHighlightTextSelected]}>
                ★ Highlight
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>EMPHASIS</Text>
          <View style={styles.tagGrid}>
            <TouchableOpacity
              style={[styles.tagBtnPOE, poeSelected && styles.tagBtnPOESelected]}
              onPress={() => poeTagId && toggleTagInGroup(poeTagId)}
            >
              <Text style={[styles.tagBtnPOEText, poeSelected && styles.tagBtnPOETextSelected]}>
                ! POE
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* QUICK EXPORT: one tap = every clip stamped with a phase, in game order.
            Only rendered for phased sports, only phases present in the selected games. */}
        {quickPhases.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>QUICK EXPORT</Text>
            <View style={styles.tagGrid}>
              {quickPhases.map(q => (
                <TouchableOpacity key={q.tagId} style={styles.quickExportBtn} onPress={() => runQuickExport(q.tagId)}>
                  <Text style={styles.quickExportBtnText}>All {q.label.toLowerCase()}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
        {/* SLICE 1: only tags actually applied in the selected games. */}
        {categoryDefs.map(cat => {
          const catTags = tags.filter(t => t.category === cat.key && usedTagIds.has(t.id));
          if (catTags.length === 0) return null;
          return (
            <View key={cat.key} style={styles.section}>
              <Text style={styles.sectionTitle}>{cat.phase ? `${cat.phase} · ${cat.label.toUpperCase()}` : cat.label.toUpperCase()}</Text>
              <View style={styles.tagGrid}>
                {catTags.map(tag => {
                  const selected = currentGroup.includes(tag.id);
                  // SLICE 2: dim tags that don't co-occur with the picked player(s).
                  const dimmed = !!playerCoTagIds && !playerCoTagIds.has(tag.id) && !selected;
                  return (
                    <TouchableOpacity
                      key={tag.id}
                      style={[styles.tagBtn, selected && styles.tagBtnSelected, dimmed && styles.tagBtnDimmed]}
                      onPress={() => toggleTagInGroup(tag.id)}
                    >
                      <Text style={[styles.tagBtnText, selected && styles.tagBtnTextSelected]}>
                        {tag.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        })}
        {/* Empty-state hint when the selected games have no applied tags yet. */}
        {!categoryDefs.some(cat => tags.some(t => t.category === cat.key && usedTagIds.has(t.id))) ? (
          <Text style={styles.emptyTagsHint}>No tags found in the selected game{selectedGames.length === 1 ? '' : 's'} yet. Tag some plays first, or pick a different game.</Text>
        ) : null}

        <View style={styles.groupActions}>
          <TouchableOpacity
            style={[styles.addGroupBtn, currentGroup.length === 0 && styles.disabledBtn]}
            onPress={addGroup}
          >
            <Text style={styles.addGroupBtnText}>+ Add Group</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.nextBtn, (tagGroups.length === 0 && currentGroup.length === 0) && styles.disabledBtn]}
          onPress={() => loadClips()}
        >
          <Text style={styles.nextBtnText}>{loading ? 'Loading...' : 'Next: Review Clips →'}</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  const groupedClips: Record<number, any[]> = {};
  clips.forEach(clip => {
    if (!groupedClips[clip.groupIndex]) groupedClips[clip.groupIndex] = [];
    groupedClips[clip.groupIndex].push(clip);
  });
  const totalIncluded = clips.filter(c => !excludedClips.includes(`${c.id}-${c.groupIndex}`)).length;
  // Whether any included clip has a 4K master to render Maximum from.
  const includedForScope = clips.filter(c => !excludedClips.includes(`${c.id}-${c.groupIndex}`));
  const anyMaster = includedForScope.some(c => c.videoOriginalUrl);
  // Scope the "describe the reel" tags to the exported clips' team(s) + sport(s) — so a
  // football reel never shows basketball tags, and you never see another team's kids.
  const exportTeamIds = new Set(includedForScope.map(c => c.videoTeamId).filter(Boolean));
  const exportSports = new Set(
    includedForScope.map(c => sportOfVideo(c.videoSport, c.videoTeamId)).filter(Boolean) as string[],
  );
  // Reel-description categories from the shared sport definition, unioned over the
  // sports actually being exported (so a flag reel offers OFF/DEF/SP categories, not
  // the basketball four). Players appended last — roster-sourced, not in the definition.
  const reelTagCategories = [
    ...categoriesForSports(exportSports),
    { key: 'players', label: 'Players', color: '#7d3c98' } as { key: string; label: string; color: string; phase?: string },
  ];
  const reelTagRelevant = (t: any) => {
    if (t.category === 'players') return !!t.team_id && exportTeamIds.has(t.team_id);
    if (t.team_id) return exportTeamIds.has(t.team_id);          // team-specific play
    if (t.sport) return exportSports.has(String(t.sport).trim().toLowerCase()); // sport-scoped global
    return true;                                                 // universal global (no sport)
  };

  const showFinalize = totalIncluded > 0 && !exporting;
  return (
    <View style={styles.reviewWrap}>
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: showFinalize ? 96 : 40 }}>
        <TouchableOpacity onPress={() => setStep('tags')} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Export Highlights</Text>
        <View style={styles.stepRow}>
          <View style={styles.stepDots}>
            <View style={[styles.stepDot, styles.stepDotOn]} />
            <View style={[styles.stepDot, styles.stepDotOn]} />
            <View style={[styles.stepDot, styles.stepDotOn]} />
          </View>
          <Text style={styles.stepText}>Step 3 of 3 · Review</Text>
        </View>

        {showFinalize ? (
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Reel name</Text>
            <TextInput
              style={styles.nameInput}
              value={reelName}
              onChangeText={setReelName}
              placeholder="Reel name"
              placeholderTextColor={colors.textFaint}
            />
            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Team</Text>
            <Dropdown value={reelTeamId} options={reelTeamOptions} onSelect={setReelTeamId} placeholder="None" />
          </View>
        ) : null}

        {exporting && (
          <View style={styles.exportingContainer}>
            <Text style={styles.exportingText}>{exportStatus}</Text>
            <View style={styles.progressOuter}>
              <View style={[styles.progressInner, { width: `${exportProgress}%` as any }]} />
            </View>
            <Text style={styles.progressLabel}>{exportProgress}%</Text>
          </View>
        )}

        {clips.length === 0 && !exporting && (
          <View style={styles.reviewEmpty}>
            <Text style={styles.reviewEmptyTitle}>No clips matched your groups</Text>
            <Text style={styles.reviewEmptyBody}>
              Each group only matches a clip where every tag in it happened on the SAME play. If you stacked several plays into one group (like Made 2 + Made 3 + Block), nothing can match. Go back and split them — one play per group.
            </Text>
            <TouchableOpacity style={styles.reviewEmptyBtn} onPress={() => setStep('tags')}>
              <Text style={styles.reviewEmptyBtnText}>← Back to fix groups</Text>
            </TouchableOpacity>
          </View>
        )}

        {showFinalize && (
          <View style={styles.clipsHeadRow}>
            <Text style={styles.clipsHeadN}>{totalIncluded} CLIP{totalIncluded === 1 ? '' : 'S'}</Text>
            <Text style={styles.clipsHeadSub}>✕ to drop · ▶ to preview</Text>
          </View>
        )}

        {Object.keys(groupedClips).map(groupIndexStr => {
          const groupIndex = parseInt(groupIndexStr);
          const groupClips = groupedClips[groupIndex];
          const groupTags = tagGroups[groupIndex] || [];
          const groupLabel = groupTags.map(id => getTagName(id)).join(' + ');
          const kept = groupClips.filter(c => !excludedClips.includes(`${c.id}-${c.groupIndex}`)).length;

          return (
            <View key={groupIndex} style={styles.group}>
              <View style={styles.groupHeader}>
                <Text style={styles.groupTitle} numberOfLines={1}>{groupLabel}</Text>
                <View style={styles.groupBadge}>
                  <Text style={styles.groupBadgeText}>{kept}/{groupClips.length}</Text>
                </View>
              </View>
              {groupClips.map((clip: any) => {
                const clipKey = `${clip.id}-${clip.groupIndex}`;
                const excluded = excludedClips.includes(clipKey);
                const starred = !!highlightTagId && clip.tagIds?.includes(highlightTagId);
                return (
                  <View key={clipKey} style={[styles.clipCard, excluded && styles.excludedCard]}>
                    <View style={styles.clipThumb}><Text style={styles.clipThumbIcon}>▶</Text></View>
                    <View style={styles.clipInfo}>
                      <Text style={[styles.clipTime, excluded && styles.excludedText]} numberOfLines={1}>
                        {formatTime(clip.start_time)} → {formatTime(clip.end_time)}{starred ? '  ★' : ''}
                      </Text>
                      <Text style={[styles.clipMeta, excluded && styles.excludedText]} numberOfLines={1}>
                        {clip.gameTitle} · {clip.videoLabel} · {getDuration(clip.start_time, clip.end_time)}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.rowBtn}
                      onPress={() => router.push({
                        pathname: '/tagging-overlay',
                        params: { videoId: clip.video_id, url: clip.videoUrl, label: clip.videoLabel, startAt: clip.start_time },
                      })}
                    >
                      <Text style={styles.rowBtnText}>▶</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.rowBtn, styles.rowBtnX, excluded && styles.rowBtnXon]}
                      onPress={() => toggleExclude(clipKey)}
                    >
                      <Text style={[styles.rowBtnXText, excluded && styles.rowBtnXonText]}>{excluded ? '↩' : '✕'}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          );
        })}

        {showFinalize && (
          <>
            <View style={styles.card}>
              <Text style={styles.fieldLabel}>Tag this reel</Text>
              <Text style={styles.reelTagHint}>For sorting later — e.g. Defense, Press break. On top of the clips’ own tags.</Text>
              {reelTagCategories.map(cat => {
                const catTags = tags.filter((t: any) => t.category === cat.key && reelTagRelevant(t));
                if (catTags.length === 0) return null;
                return (
                  <View key={cat.key} style={styles.reelCatBlock}>
                    <Text style={[styles.reelCatHeader, { color: cat.color }]}>{cat.phase ? `${cat.phase} · ${cat.label.toUpperCase()}` : cat.label.toUpperCase()}</Text>
                    <View style={styles.reelChipsWrap}>
                      {catTags.map((t: any) => {
                        const on = reelDescTags.has(t.id);
                        return (
                          <TouchableOpacity
                            key={t.id}
                            onPress={() => toggleReelDescTag(t.id)}
                            style={[styles.reelChip, on ? { backgroundColor: cat.color, borderColor: cat.color } : { backgroundColor: 'transparent', borderColor: cat.color }]}
                          >
                            <Text style={[styles.reelChipText, { color: on ? '#fff' : cat.color }]}>{t.name}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
              <Text style={styles.scopeNote}>Only this team’s players + this sport — no other teams or sports.</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.fieldLabel}>Download quality</Text>
              <View style={styles.qualityRow}>
                <TouchableOpacity
                  style={[styles.qualityCard, quality === 'standard' && styles.qualityCardOn]}
                  onPress={() => setQuality('standard')}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.qualityTitle, quality === 'standard' && styles.qualityTitleOn]}>Standard</Text>
                  <Text style={styles.qualitySub}>720p · faster, smaller.{'\n'}Great for quick shares.</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.qualityCard, quality === 'maximum' && styles.qualityCardOn]}
                  onPress={() => setQuality('maximum')}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.qualityTitle, quality === 'maximum' && styles.qualityTitleOn]}>Maximum</Text>
                  <Text style={styles.qualitySub}>Full 4K master · slower, bigger.{'\n'}Best for big screens + zoom.</Text>
                </TouchableOpacity>
              </View>
              {quality === 'maximum' && !anyMaster ? (
                <Text style={styles.qualityWarn}>These videos don’t have a 4K master saved — this reel will render at 720p.</Text>
              ) : null}
              <View style={[styles.toggleRow, { marginTop: 16 }]}>
                <Text style={styles.toggleLabel}>Also save to camera roll</Text>
                <Switch value={saveToCameraRoll} onValueChange={setSaveToCameraRoll} />
              </View>
              <Text style={styles.footerHelper}>Always saved to Film Room</Text>
            </View>
          </>
        )}
      </ScrollView>

      {showFinalize && (
        <View style={styles.stickyCta}>
          <TouchableOpacity style={styles.exportBtn} onPress={handleExport}>
            <Text style={styles.exportBtnText}>🎬 Export {totalIncluded} clip{totalIncluded === 1 ? '' : 's'} · {quality === 'maximum' ? '4K' : '720p'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 20, paddingTop: 60 },
  back: { marginBottom: 16 },
  backText: { color: colors.brand, fontSize: 16 },
  title: { fontSize: 24, fontWeight: '700', color: colors.text, marginBottom: 4 },
  subtitle: { fontSize: 14, color: colors.textMuted, marginBottom: 8 },
  hint: { fontSize: 12, color: colors.textFaint, marginBottom: 16 },
  exportingContainer: { backgroundColor: colors.surface, borderRadius: 12, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: colors.border },
  exportingText: { fontSize: 14, fontWeight: '600', color: colors.brandLight, marginBottom: 10, textAlign: 'center' },
  progressOuter: { backgroundColor: colors.border, borderRadius: 8, height: 12, overflow: 'hidden', marginBottom: 6 },
  progressInner: { backgroundColor: colors.brand, height: 12, borderRadius: 8 },
  progressLabel: { textAlign: 'center', fontSize: 12, color: colors.textMuted },
  selectCard: { backgroundColor: colors.surface, borderRadius: 12, padding: 16, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  selectedCard: { backgroundColor: colors.brand, borderColor: colors.brand },
  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  cardSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  selectedText: { color: '#fff' },
  check: { color: '#fff', fontSize: 18, fontWeight: '700' },
  nextBtn: { backgroundColor: colors.brand, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 16 },
  disabledBtn: { backgroundColor: colors.borderSubtle },
  nextBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  groupsContainer: { backgroundColor: colors.brandTint, borderRadius: 12, padding: 12, marginBottom: 16 },
  groupsLabel: { fontSize: 12, fontWeight: '700', color: colors.brandLight, marginBottom: 8 },
  groupPill: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.brand, borderRadius: 8, padding: 8, marginBottom: 6 },
  groupPillText: { color: '#fff', fontSize: 13, fontWeight: '500', flex: 1 },
  groupPillRemove: { color: '#fff', fontSize: 16, marginLeft: 8 },
  currentGroup: { backgroundColor: colors.surface, borderRadius: 12, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: colors.amber },
  currentGroupLabel: { fontSize: 12, fontWeight: '700', color: colors.amber, marginBottom: 4 },
  currentGroupTags: { fontSize: 14, color: colors.amber, fontWeight: '600' },
  currentGroupWarn: { borderColor: colors.danger },
  groupWarn: { fontSize: 12, color: colors.danger, fontWeight: '600', marginTop: 8, lineHeight: 16 },
  groupMeaning: { fontSize: 12, color: colors.textMuted, marginTop: 8, lineHeight: 16 },
  reviewEmpty: { backgroundColor: colors.surface, borderRadius: 12, padding: 18, marginTop: 8, marginBottom: 8, borderWidth: 1, borderColor: colors.danger },
  reviewEmptyTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: 8 },
  reviewEmptyBody: { fontSize: 14, color: colors.textMuted, lineHeight: 20, marginBottom: 14 },
  reviewEmptyBtn: { backgroundColor: colors.brand, borderRadius: 10, padding: 12, alignItems: 'center' },
  reviewEmptyBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 8, letterSpacing: 0.5 },
  tagGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagBtn: { backgroundColor: colors.surface, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border },
  quickExportBtn: { backgroundColor: colors.amber, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, borderWidth: 1, borderColor: colors.amber },
  quickExportBtnText: { fontSize: 14, color: '#1a1a1a', fontWeight: '800' },
  tagBtnSelected: { backgroundColor: colors.brand, borderColor: colors.brand },
  tagBtnDimmed: { opacity: 0.3 },
  emptyTagsHint: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: 4, marginBottom: 8 },
  tagBtnText: { fontSize: 13, color: colors.text, fontWeight: '500' },
  tagBtnTextSelected: { color: '#fff' },
  tagBtnHighlight: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderColor: colors.amber,
  },
  tagBtnHighlightSelected: { backgroundColor: colors.amber, borderColor: colors.amber },
  tagBtnHighlightText: { fontSize: 13, color: colors.amber, fontWeight: '700' },
  tagBtnHighlightTextSelected: { color: '#fff' },
  tagBtnPOE: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderColor: colors.danger,
  },
  tagBtnPOESelected: { backgroundColor: colors.danger, borderColor: colors.danger },
  tagBtnPOEText: { fontSize: 13, color: colors.danger, fontWeight: '700' },
  tagBtnPOETextSelected: { color: '#fff' },
  groupActions: { marginBottom: 8 },
  addGroupBtn: { backgroundColor: colors.success, borderRadius: 12, padding: 14, alignItems: 'center' },
  addGroupBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  group: { marginBottom: 20 },
  groupHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  groupTitle: { fontSize: 14, fontWeight: '700', color: colors.brandLight, flex: 1 },
  groupCount: { fontSize: 12, color: colors.textMuted },
  clipCard: { backgroundColor: colors.surface, borderRadius: 8, padding: 8, marginBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.border },
  excludedCard: { backgroundColor: colors.surfaceAlt, opacity: 0.5 },
  checkBtn: { backgroundColor: colors.success, borderRadius: 6, width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  checkBtnExcluded: { backgroundColor: colors.danger },
  checkBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  clipInfo: { flex: 1 },
  clipTop: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  clipTime: { fontSize: 12, fontWeight: '600', color: colors.text },
  clipDuration: { fontSize: 10, color: colors.textSecondary, backgroundColor: colors.borderSubtle, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3 },
  star: { fontSize: 12, color: colors.amber },
  excludedText: { color: colors.textFaint },
  clipMeta: { fontSize: 11, color: colors.textMuted },
  previewBtn: { backgroundColor: colors.brand, borderRadius: 6, width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  previewBtnText: { color: '#fff', fontSize: 12 },
  exportBtn: { backgroundColor: colors.success, borderRadius: 12, padding: 18, alignItems: 'center', marginTop: 8 },
  exportBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  footer: { marginTop: 8 },
  reviewWrap: { flex: 1, backgroundColor: colors.bg },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, marginBottom: 2 },
  stepDots: { flexDirection: 'row', gap: 4 },
  stepDot: { width: 16, height: 4, borderRadius: 2, backgroundColor: colors.border },
  stepDotOn: { backgroundColor: colors.brand },
  stepText: { color: colors.textMuted, fontSize: 12.5, fontWeight: '600' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14, marginTop: 16 },
  clipsHeadRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 20, marginBottom: 10 },
  clipsHeadN: { color: colors.text, fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
  clipsHeadSub: { color: colors.textMuted, fontSize: 12 },
  groupBadge: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  groupBadgeText: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  clipThumb: { width: 52, height: 36, borderRadius: 7, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  clipThumbIcon: { color: '#fff', opacity: 0.85, fontSize: 13 },
  rowBtn: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  rowBtnText: { color: '#cfe0f5', fontSize: 13 },
  rowBtnX: {},
  rowBtnXText: { color: '#ff8b8b', fontSize: 13, fontWeight: '700' },
  rowBtnXon: { backgroundColor: colors.brandTint, borderColor: colors.brand },
  rowBtnXonText: { color: colors.brandLight },
  scopeNote: { color: colors.textFaint, fontSize: 11, marginTop: 8, lineHeight: 15 },
  stickyCta: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border },
  fieldLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  qualityRow: { flexDirection: 'row', gap: 10 },
  qualityCard: { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, padding: 12, backgroundColor: colors.surface },
  qualityCardOn: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  qualityTitle: { color: colors.text, fontSize: 15, fontWeight: '800', marginBottom: 3 },
  qualityTitleOn: { color: colors.brand },
  qualitySub: { color: colors.textMuted, fontSize: 11.5, lineHeight: 15 },
  qualityWarn: { color: colors.amber, fontSize: 12, marginTop: 8, lineHeight: 16 },
  reviewHead: { marginBottom: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  nameInput: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 15, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 14 },
  reelTagHint: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 4, marginBottom: 4 },
  reelCatBlock: { marginTop: 12 },
  reelCatHeader: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, marginBottom: 8 },
  reelChipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reelChip: { borderWidth: 1.5, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  reelChipText: { fontSize: 13, fontWeight: '700' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  toggleLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  footerHelper: { color: colors.textMuted, fontSize: 12, marginBottom: 14 },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 40, fontSize: 16 },
});

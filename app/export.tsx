import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTeamContext } from '@/context';
import { supabase } from '@/supabase';
import { clipMatchesGroup } from '@/lib/core/clip-filtering';
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

// Tag categories for the review-step reel tag picker. Matches the tagging
// screens; colors read on export's light review background.
const REEL_TAG_CATEGORIES = [
  { key: 'offense', label: 'Offense', color: '#1a6fd4' },
  { key: 'defense', label: 'Defense', color: '#c0392b' },
  { key: 'plays', label: 'Plays', color: '#1e8449' },
  { key: 'players', label: 'Players', color: '#7d3c98' },
];

// Step-1 game-picker filter options. Single-entry Type hides that dropdown
// (games only); Sort drops "Longest" (games have no duration).
const GAME_TYPE_OPTIONS: DropdownOption[] = [{ value: 'all', label: 'Games' }];
const GAME_SORT_OPTIONS: DropdownOption[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'az', label: 'A–Z' },
];

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
  // Reel team + descriptive tags chosen at creation. Team defaults from the
  // source games (below); tags are on top of the auto-copied clip tags.
  const [reelTeamId, setReelTeamId] = useState('');
  const [reelDescTags, setReelDescTags] = useState<Set<string>>(new Set());

  const { userTeams } = useTeamContext();
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

  // After a render finishes, persist the export as a highlight_reels row so it
  // becomes a findable reel. Best-effort: never throws, never blocks the
  // camera-roll save or success UI. team_id is null for now (reels are
  // creator-owned; team association is derived later from source clips).
  async function saveReelRecord(videoUrl: string, includedClipObjects: any[], name?: string, teamId?: string | null, descTagIds?: string[]) {
    try {
      if (includedClipObjects.length === 0) return;

      // created_by_user_id is REQUIRED — the RLS creator branch depends on it.
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.warn('[reel] No session user — skipping highlight_reels insert');
        return;
      }

      // Use the name passed from the review-step field; fall back to the
      // auto-name when empty/undefined (e.g. callers without a name field).
      const finalName = (name && name.trim()) ? name.trim() : defaultReelName(includedClipObjects);
      const durationSeconds = includedClipObjects.reduce(
        (sum, c) => sum + Math.max(0, (c.end_time ?? 0) - (c.start_time ?? 0)),
        0,
      );

      const { data: inserted, error } = await supabase.from('highlight_reels').insert({
        created_by_user_id: user.id,
        team_id: teamId || null,
        name: finalName,
        storage_path: deriveStoragePath(videoUrl),
        source_clip_ids: includedClipObjects.map(c => c.id),
        duration_seconds: durationSeconds,
        overlay_mode: 'clean',
        status: 'ready',
      }).select('id').single();
      if (error || !inserted?.id) {
        console.warn('[reel] highlight_reels insert failed:', error?.message || 'no id returned');
        return;
      }

      // Kick off the reel's poster thumbnail (fire-and-forget, best-effort).
      generateReelThumbnailInBackground(inserted.id);

      // Auto-attach: copy the distinct tags from the source clips onto the reel.
      // Tags are already in memory (c.tagIds) — no extra query. Best-effort: a
      // tag-copy failure must never throw or break the (already-saved) reel.
      try {
        const tagIds = [...new Set([...includedClipObjects.flatMap((c: any) => c.tagIds || []), ...(descTagIds || [])])];
        if (tagIds.length > 0) {
          const rows = tagIds.map(tag_id => ({ reel_id: inserted.id, tag_id }));
          const { error: tagErr } = await supabase.from('reel_tags').insert(rows);
          if (tagErr) console.warn('[reel] reel_tags insert failed:', tagErr.message);
        }
      } catch (e: any) {
        console.warn('[reel] reel_tags insert threw:', e?.message || e);
      }
    } catch (e: any) {
      console.warn('[reel] highlight_reels insert threw:', e?.message || e);
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
      .select('*, seasons (name), tournaments (name), videos (id, event_type)')
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

  // Clip-tags per game (game → videos → clips → clip_tags), keyed by game id —
  // same batched pattern as the Film Room, so Player/Offense/Defense/Plays work.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const videoToGame = new Map<string, string>();
      games.forEach((g: any) => (g.videos || []).forEach((v: any) => videoToGame.set(v.id, g.id)));
      const videoIds = [...videoToGame.keys()];
      const byId = new Map<string, Set<string>>();
      const perClipMap = new Map<string, { gameId: string; tags: Set<string> }>();
      if (videoIds.length > 0) {
        const { data: clipRows } = await supabase.from('clips').select('id, video_id').in('video_id', videoIds);
        const clipToGame = new Map<string, string>();
        (clipRows || []).forEach((c: any) => { const gid = videoToGame.get(c.video_id); if (gid) clipToGame.set(c.id, gid); });
        const clipIds = [...clipToGame.keys()];
        if (clipIds.length > 0) {
          const { data: ctRows } = await supabase.from('clip_tags').select('clip_id, tag_id').in('clip_id', clipIds);
          (ctRows || []).forEach((ct: any) => {
            const gid = clipToGame.get(ct.clip_id);
            if (!gid) return;
            const s = byId.get(gid) ?? new Set<string>();
            s.add(ct.tag_id);
            byId.set(gid, s);
            // per-clip set (powers player co-occurrence dimming)
            const pc = perClipMap.get(ct.clip_id) ?? { gameId: gid, tags: new Set<string>() };
            pc.tags.add(ct.tag_id);
            perClipMap.set(ct.clip_id, pc);
          });
        }
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

  async function loadClips() {
    const allGroups = currentGroup.length > 0 ? [...tagGroups, currentGroup] : tagGroups;
    if (selectedGames.length === 0) { webAlert('Select at least one game', 'Select at least one game'); return; }
    if (allGroups.length === 0) { webAlert('Add at least one tag group', 'Add at least one tag group'); return; }
    setLoading(true);

    const { data: videos, error: videosErr } = await supabase
      .from('videos')
      .select('id, url, label, game_id, upload_status')
      .in('game_id', selectedGames);
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

    const { data: clipData, error: clipErr } = await supabase
      .from('clips')
      .select('*')
      .in('video_id', videoIds);
    if (clipErr) { webAlert('Couldn’t load clips', clipErr.message); setLoading(false); return; }

    const clipsWithTags = await Promise.all((clipData || []).map(async (clip: any) => {
      const { data: tagData } = await supabase
        .from('clip_tags')
        .select('tag_id, bundle_number')
        .eq('clip_id', clip.id);

      // Organize tags by bundle
      const clipLevelTagIds: string[] = [];
      const bundleMap: Record<number, string[]> = {};
      (tagData || []).forEach((t: any) => {
        const bn = t.bundle_number ?? 0;
        if (bn === 0) {
          clipLevelTagIds.push(t.tag_id);
        } else {
          if (!bundleMap[bn]) bundleMap[bn] = [];
          bundleMap[bn].push(t.tag_id);
        }
      });
      const bundles = Object.values(bundleMap);
      const tagIds = (tagData || []).map((t: any) => t.tag_id);

      const video = videoMap[clip.video_id];
      const game = games.find(g => g.id === video?.game_id);
      return {
        ...clip,
        tagIds,
        clipLevelTagIds,
        bundles,
        videoUrl: video?.url,
        videoLabel: video?.label,
        gameTitle: game?.title,
      };
    }));

    // Match clips to groups using bundle-aware AND logic
    const matchedClips: any[] = [];
    allGroups.forEach((group, groupIndex) => {
      const groupClips = clipsWithTags.filter(clip => clipMatchesGroup(clip, group));
      groupClips.forEach(clip => {
        matchedClips.push({ ...clip, groupIndex, groupTags: group });
      });
    });

    setClips(matchedClips);
    setExcludedClips([]);
    if (currentGroup.length > 0) setTagGroups(allGroups);
    setCurrentGroup([]);
    setStep('review');
    setLoading(false);
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
    const includedClips = includedClipObjects
      .map(c => ({ url: c.videoUrl, start_time: c.start_time, end_time: c.end_time }));
    console.log('[export] includedClips count:', includedClips.length, 'first clip:', includedClips[0]);

    try {
      console.log('[export] POSTing to Railway', `${SERVER_URL}/export`, 'clips:', includedClips.length);
      const response = await fetch(`${SERVER_URL}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clips: includedClips, outputFileName: 'iamsports-highlight.mp4' }),
      });

      const data = await response.json();
      if (!response.ok) { console.log('[export] server rejected:', response.status, data); webAlert('Export failed', data.error || 'Something went wrong'); setExporting(false); return; }

      // Persist before polling so a backgrounded app can resume this job.
      await saveActiveJob(data.jobId);

      setExportStatus('Processing clips...');
      const videoUrl = await pollJob(data.jobId);

      // Persist the export as a reel (best-effort — must not block the save).
      // Always saves to My Work; the camera-roll save is user-gated below.
      await saveReelRecord(videoUrl, includedClipObjects, reelName, reelTeamId, [...reelDescTags]);

      if (saveToCameraRoll) {
        await saveExportToLibrary(videoUrl);
      } else {
        webAlert('Saved!', 'Your reel is in Film Room.');
      }
    } catch (e: any) {
      console.log('[export] FAILED:', e);
      webAlert('Export error', e.message);
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
    const categories = ['offense', 'defense', 'plays', 'players'];
    const highlightSelected = !!highlightTagId && currentGroup.includes(highlightTagId);
    const poeSelected = !!poeTagId && currentGroup.includes(poeTagId);
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
        <TouchableOpacity onPress={() => setStep('games')} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Export Highlights</Text>
        <Text style={styles.subtitle}>Step 2 of 3 — Build tag groups</Text>
        <Text style={styles.hint}>Tap tags to build a group. Tap "Add Group" to save it and start another.</Text>

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
          <View style={styles.currentGroup}>
            <Text style={styles.currentGroupLabel}>Current group:</Text>
            <Text style={styles.currentGroupTags}>
              {currentGroup.map(id => getTagName(id)).join(' + ')}
            </Text>
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

        {/* SLICE 1: only tags actually applied in the selected games. */}
        {categories.map(cat => {
          const catTags = tags.filter(t => t.category === cat && usedTagIds.has(t.id));
          if (catTags.length === 0) return null;
          return (
            <View key={cat} style={styles.section}>
              <Text style={styles.sectionTitle}>{cat.toUpperCase()}</Text>
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
        {!categories.some(cat => tags.some(t => t.category === cat && usedTagIds.has(t.id))) ? (
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
          onPress={loadClips}
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <TouchableOpacity onPress={() => setStep('tags')} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Export Highlights</Text>
      <Text style={styles.subtitle}>Step 3 of 3 — Review ({totalIncluded} clips selected)</Text>
      <Text style={styles.hint}>✕ to exclude • ▶ to preview</Text>

      {exporting && (
        <View style={styles.exportingContainer}>
          <Text style={styles.exportingText}>{exportStatus}</Text>
          <View style={styles.progressOuter}>
            <View style={[styles.progressInner, { width: `${exportProgress}%` as any }]} />
          </View>
          <Text style={styles.progressLabel}>{exportProgress}%</Text>
        </View>
      )}

      {Object.keys(groupedClips).map(groupIndexStr => {
        const groupIndex = parseInt(groupIndexStr);
        const groupClips = groupedClips[groupIndex];
        const groupTags = tagGroups[groupIndex] || [];
        const groupLabel = groupTags.map(id => getTagName(id)).join(' + ');

        return (
          <View key={groupIndex} style={styles.group}>
            <View style={styles.groupHeader}>
              <Text style={styles.groupTitle}>{groupLabel}</Text>
              <Text style={styles.groupCount}>
                {groupClips.filter(c => !excludedClips.includes(`${c.id}-${c.groupIndex}`)).length}/{groupClips.length}
              </Text>
            </View>
            {groupClips.map((clip: any) => {
              const clipKey = `${clip.id}-${clip.groupIndex}`;
              const excluded = excludedClips.includes(clipKey);
              return (
                <View key={clipKey} style={[styles.clipCard, excluded && styles.excludedCard]}>
                  <TouchableOpacity
                    style={[styles.checkBtn, excluded && styles.checkBtnExcluded]}
                    onPress={() => toggleExclude(clipKey)}
                  >
                    <Text style={styles.checkBtnText}>{excluded ? '✕' : '✓'}</Text>
                  </TouchableOpacity>
                  <View style={styles.clipInfo}>
                    <View style={styles.clipTop}>
                      <Text style={[styles.clipTime, excluded && styles.excludedText]}>
                        {formatTime(clip.start_time)} → {formatTime(clip.end_time)}
                      </Text>
                      <Text style={styles.clipDuration}>{getDuration(clip.start_time, clip.end_time)}</Text>
                      {!!highlightTagId && clip.tagIds?.includes(highlightTagId) && <Text style={styles.star}>★</Text>}
                    </View>
                    <Text style={[styles.clipMeta, excluded && styles.excludedText]}>
                      {clip.gameTitle} • {clip.videoLabel}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.previewBtn}
                    onPress={() => router.push({
                      pathname: '/tagging-overlay',
                      params: { videoId: clip.video_id, url: clip.videoUrl, label: clip.videoLabel, startAt: clip.start_time }
                    })}
                  >
                    <Text style={styles.previewBtnText}>▶</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        );
      })}

      {totalIncluded > 0 && !exporting && (
        <View style={styles.footer}>
          <Text style={styles.fieldLabel}>Reel name</Text>
          <TextInput
            style={styles.nameInput}
            value={reelName}
            onChangeText={setReelName}
            placeholder="Reel name"
            placeholderTextColor="#666"
          />

          <Text style={styles.fieldLabel}>Team</Text>
          <Dropdown value={reelTeamId} options={reelTeamOptions} onSelect={setReelTeamId} placeholder="None" />

          <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Tags</Text>
          <Text style={styles.reelTagHint}>Describe the reel so you can sort it later — e.g. Defense, Press break. On top of the clips’ own tags.</Text>
          {REEL_TAG_CATEGORIES.map(cat => {
            const catTags = tags.filter((t: any) => t.category === cat.key);
            if (catTags.length === 0) return null;
            return (
              <View key={cat.key} style={styles.reelCatBlock}>
                <Text style={[styles.reelCatHeader, { color: cat.color }]}>{cat.label.toUpperCase()}</Text>
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

          <View style={[styles.toggleRow, { marginTop: 16 }]}>
            <Text style={styles.toggleLabel}>Also save to camera roll</Text>
            <Switch value={saveToCameraRoll} onValueChange={setSaveToCameraRoll} />
          </View>
          <Text style={styles.footerHelper}>Always saved to Film Room</Text>
          <TouchableOpacity style={styles.exportBtn} onPress={handleExport}>
            <Text style={styles.exportBtnText}>🎬 Export {totalIncluded} Clips</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
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
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 8, letterSpacing: 0.5 },
  tagGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagBtn: { backgroundColor: colors.surface, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border },
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
  fieldLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
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

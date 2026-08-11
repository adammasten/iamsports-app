import { COACH_ROLES, useTeamContext } from '@/context';
import { supabase } from '@/supabase';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { goBackOrHome } from '@/lib/nav';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EVENT_TYPES } from '@/lib/core/upload-meta';
import { downloadMedia } from '@/lib/native/download-media';
import {
  type CacheProgress,
  type CacheStatus,
  getManifest as getVideoCacheManifest,
  prefetch as prefetchVideo,
  remove as removeVideoFromCache,
  subscribe as subscribeVideoCache,
  subscribeProgress as subscribeVideoProgress,
} from '@/lib/native/video-cache';
import { LoadError } from '@/components/load-error';
import { ShareNoteSheet, type NoteAudience } from '@/components/share-note-sheet';
import { SkeletonCards } from '@/components/skeleton-cards';
import { withTimeout } from '@/lib/withTimeout';
import { requirePermission } from './permissionGuard';
import { type DropdownOption } from './components/Dropdown';
import FilterBar, { type FilterableItem } from './components/FilterBar';
import ContentCard, { type CardAction } from '@/components/content-card/ContentCard';
import { deriveShareStatus } from '@/lib/core/shareStatus';

// "My Work" — lists the current user's highlight reels (highlight_reels rows
// they created). Each card shows WHERE the reel lives (public / team / private)
// derived from the shares table, plus play / rename / delete. Reels are read
// directly under the highlight_reels creator-read RLS branch; the where-it-lives
// badges come from one batched shares query.
//
// This is slice 1 of several. Reel *publishing* (the action that creates the
// 'reel' shares these badges read) ships in the next slice — until then most
// reels correctly show the "Only you" lock. Built to extend cleanly.

// Carries the team/player id so a destination can be precisely un-posted from
// the Film Room (delete the exact shares row).
// shareId + note ride along so "Manage sharing" can edit the per-destination
// note after posting. shareId is the shares.id of the row backing this
// destination (undefined for optimistic adds until the next load reconciles it).
type Destination =
  | { kind: 'public'; shareId?: string; note?: string | null }
  | { kind: 'team'; teamName: string; teamId: string; shareId?: string; note?: string | null }
  | { kind: 'coaches'; teamName: string; teamId: string; shareId?: string; note?: string | null }
  | { kind: 'player'; kidName: string; playerId: string; shareId?: string; note?: string | null };

// Stable identity for a destination — dedup + optimistic add/remove.
const destKey = (d: Destination): string =>
  d.kind === 'team' ? `team:${d.teamId}` : d.kind === 'coaches' ? `coaches:${d.teamId}` : d.kind === 'player' ? `player:${d.playerId}` : 'public';

type Reel = {
  id: string;
  name: string;
  storagePath: string | null;
  durationSeconds: number | null;
  createdAt: string;
  destinations: Destination[];
};

// A generic postable content unit for the wall-post flow — enough to call
// post_to_wall (content type + id) plus a title for user-facing messages. Keeps
// the destination picker content-type-agnostic (reels today, clips later).
type Postable = { contentType: 'reel' | 'clip' | 'video' | 'game'; contentId: string; title: string };

// A "game" in Film Room is derived from videos the user uploaded — there's no
// owner column on games. Each Game carries its videos pre-grouped so the inline
// expand can render without a second query.
type UploadStatus = 'uploading' | 'ready' | 'failed';
type GameVideo = { id: string; label: string; url: string; sortOrder: number; taggingComplete: boolean; uploadStatus: UploadStatus };

// A "Saved to My Film" bookmark, resolved for display via resolve_shared_content.
type SavedEntry = {
  savedId: string;
  shareId: string;
  contentType: string;
  contentId: string;
  title: string;
  storagePath: string | null;
  startTime: number | null;
  endTime: number | null;
};
type Game = {
  id: string;
  title: string;
  opponent: string | null;
  gameDate: string | null;
  teamId: string;
  createdAt: string;
  videos: GameVideo[];
  // Total clips across all this game's videos. Drives the tagging-status
  // outline on the GAME badge: 0 → not started (red), >0 → in progress (yellow).
  clipCount: number;
  // Event type (game/practice/…) for the Film Room event filter. Taken from the
  // game's videos (first non-null); null when none of its videos carry one.
  eventType: string | null;
  // Season / tournament (id + display name) for their FilterBar dropdowns.
  seasonId: string | null;
  seasonName: string | null;
  tournamentId: string | null;
  tournamentName: string | null;
  // Where this game is posted (team wall / kid wall / coaches / public), so the
  // card can show its visibility — same shape reels use.
  destinations: Destination[];
};

// Aggregate the video-cache state across a game's ready videos into ONE
// button-shaped descriptor. Returns null when the game has no cacheable
// videos (nothing uploaded/finalized yet — button should hide entirely).
//
// action:
//   'download' — no manual entry yet, tap to prefetch all missing
//   'inflight' — anything queued/downloading, tap is a no-op (spinner text)
//   'retry'    — any video errored, tap to re-prefetch missing ones
//   'remove'   — every video is cached, tap to confirm-and-remove-all
type GameOfflineState = {
  label: string;
  bg: string;
  fg: string;
  action: 'download' | 'inflight' | 'retry' | 'remove';
};
function computeGameOffline(
  game: Game,
  statusMap: Record<string, CacheStatus>,
  progressMap: Record<string, CacheProgress>,
): GameOfflineState | null {
  const ready = game.videos.filter(v => v.uploadStatus === 'ready');
  if (ready.length === 0) return null;

  const statuses = ready.map(v => statusMap[v.id] ?? 'idle');
  const anyError = statuses.some(s => s === 'error');
  const anyInFlight = statuses.some(s => s === 'downloading' || s === 'queued');
  const cachedCount = statuses.filter(s => s === 'cached').length;
  const total = ready.length;

  const PURPLE = { bg: '#534AB7', fg: '#fff' };
  const GREEN  = { bg: '#e8f5e9', fg: '#2e7d32' };
  const RED    = { bg: '#fdecea', fg: '#c62828' };

  if (anyInFlight) {
    // Sum live progress across still-active videos. Cached videos aren't in
    // the progress map. The shown percent is "of the work in flight right now."
    let totalWritten = 0;
    let totalExpected = 0;
    for (const v of ready) {
      const p = progressMap[v.id];
      if (!p) continue;
      totalWritten += p.bytesWritten;
      if (p.bytesExpected > 0) totalExpected += p.bytesExpected;
    }
    // Preferred: percent when expected-size is known. Fallback: MB-so-far so
    // the coach at least sees a number tick up when the server didn't return
    // a Content-Length. Last resort: '⋯ Starting…' before the first packet.
    let label: string;
    if (totalExpected > 0) {
      label = `⋯ ${Math.round((totalWritten / totalExpected) * 100)}%`;
    } else if (totalWritten > 0) {
      label = `⋯ ${(totalWritten / (1024 * 1024)).toFixed(1)} MB`;
    } else {
      label = '⋯ Starting…';
    }
    return { label, ...PURPLE, action: 'inflight' };
  }
  if (anyError) return { label: '↻ Retry', ...RED, action: 'retry' };
  if (cachedCount === total) return { label: '✓ Offline', ...GREEN, action: 'remove' };
  return { label: '⬇ Offline', ...PURPLE, action: 'download' };
}

// Tagging-status traffic light for the GAME badge outline. Vivid hues so they
// read against the badge's amber fill (yellow is the tightest contrast — tune
// here if it muddies). Green ("done") arrives with the tagging_complete flag.
const TAG_STATUS = {
  notStarted: '#FF453A', // red   — no clips yet
  inProgress: '#FFD60A', // yellow — has clips
  done:       '#32D74B', // green  — marked fully tagged (Shot 2)
};
// A game is "done" (green) only when it has videos AND every one is marked
// tagging-complete. An empty game (no videos) can never be green.
function gameIsDone(game: Game): boolean {
  return game.videos.length > 0 && game.videos.every(v => v.taggingComplete);
}
// Filter-bar options for My Work. Team options are built from the user's teams
// at render (see teamOptions); Type stays a small fixed set.
const MY_WORK_TYPE_OPTIONS: DropdownOption[] = [
  { value: 'all', label: 'All' },
  { value: 'reel', label: 'Reels' },
  { value: 'game', label: 'Games' },
];
const MY_WORK_SORT_OPTIONS: DropdownOption[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'az', label: 'A–Z' },
  { value: 'longest', label: 'Longest' },
];

// Grouped candidates for the "Post to wall" player picker.
type PickerPlayer = { player_id: string; name: string };
type PickerGroup = { key: string; title: string; players: PickerPlayer[] };

export default function MyWorkScreen() {
  const insets = useSafeAreaInsets();
  const { userId, userKids, userTeams } = useTeamContext();

  const [reels, setReels] = useState<Reel[]>([]);
  // Games derived from the user's own videos (videos.uploaded_by_user_id=me,
  // grouped by game_id). Tapping a game card expands it inline to reveal
  // game.videos — no navigation off Film Room until a video row is tapped.
  const [games, setGames] = useState<Game[]>([]);
  // Loose footage: the user's uploads with no game (game_id IS NULL) — personal
  // "+" uploads. Kept as its OWN list, never forced through the game grouping.
  const [looseVideos, setLooseVideos] = useState<GameVideo[]>([]);
  // Video being attached/moved to a game — non-null opens the game picker.
  // fromGameId = the video's current game (null = loose); excluded from the picker.
  const [attachTarget, setAttachTarget] = useState<{ video: GameVideo; fromGameId: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Filtered+sorted items, produced by FilterBar (a FilterableItem subset; the
  // full Reel/Game is recovered via reelsById/gamesById for the card render).
  const [visibleReels, setVisibleReels] = useState<FilterableItem[]>([]);
  // Batch-loaded tag data for the reel feed: each reel's tag set + tag metadata.
  const [tagsById, setTagsById] = useState<Map<string, Set<string>>>(new Map());
  const [tagMeta, setTagMeta] = useState<Map<string, { name: string; category: string }>>(new Map());

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [savedItems, setSavedItems] = useState<SavedEntry[]>([]);

  // Per-video offline cache state. Aggregated into per-game "Save for offline"
  // buttons on game cards below. Hydrated once from the persisted manifest,
  // then kept live via video-cache subscribers.
  const [videoCacheStatus, setVideoCacheStatus] = useState<Record<string, CacheStatus>>({});
  const [videoCacheProgress, setVideoCacheProgress] = useState<Record<string, CacheProgress>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const m = await getVideoCacheManifest();
      if (cancelled) return;
      setVideoCacheStatus(prev => ({
        ...prev,
        ...Object.fromEntries(m.map(e => [e.videoId, 'cached' as CacheStatus])),
      }));
    })();
    const unsubStatus = subscribeVideoCache((vid, s) =>
      setVideoCacheStatus(prev => ({ ...prev, [vid]: s })),
    );
    const unsubProgress = subscribeVideoProgress((vid, p) =>
      setVideoCacheProgress(prev => ({ ...prev, [vid]: p })),
    );
    return () => { cancelled = true; unsubStatus(); unsubProgress(); };
  }, []);
  // Inline video-label rename (per-video, e.g. Q1 → Q3): which video + draft.
  const [renamingVideoId, setRenamingVideoId] = useState<string | null>(null);
  const [videoDraft, setVideoDraft] = useState('');

  // Players on teams the user coaches (loaded below) — candidates for the
  // post-to-wall picker beyond the user's own kids.
  const [coachedPlayers, setCoachedPlayers] = useState<{ player_id: string; name: string; team_id: string }[]>([]);
  // Which reel's grouped player-picker sheet is open. null = sheet hidden.
  const [pickerReel, setPickerReel] = useState<Postable | null>(null);

  // Destination picker state. tierReel drives the top-level chooser (Your Kids /
  // Your Teams / Coaches' Corner). teamWallReel / coachesReel drive the team
  // sub-pickers; teamWallChoice holds the chosen team while the user picks
  // Team-only vs Public for a team-wall post.
  const [tierReel, setTierReel] = useState<Postable | null>(null);
  const [teamWallReel, setTeamWallReel] = useState<Postable | null>(null);
  const [coachesReel, setCoachesReel] = useState<Postable | null>(null);
  const [teamWallChoice, setTeamWallChoice] = useState<{ item: Postable; teamId: string; teamName: string } | null>(null);
  // Optional per-share note compose. `run` does the actual post(s) + set_share_note.
  const [noteSheet, setNoteSheet] = useState<{ audience: NoteAudience; run: (note: string) => Promise<void>; initialNote?: string } | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);

  async function submitNote(note: string) {
    if (!noteSheet) return;
    setNoteBusy(true);
    try { await noteSheet.run(note); }
    finally { setNoteBusy(false); setNoteSheet(null); }
  }

  // Reruns all three loaders; used by the error-state Retry button.
  function reloadFilmRoom() { loadReels(); loadGames(); loadSaved(); }

  async function loadReels() {
    if (!userId) { setReels([]); setLoadError(null); setLoading(false); return; }
    setLoading(true);
    setLoadError(null);

    // 1. My reels, newest first (creator-read RLS branch covers this). loadReels
    //    is the primary probe — a timeout/error here drives the screen's error
    //    state (loadGames/loadSaved are secondary and still Alert on failure).
    let reelRows: any[] | null; let error: any;
    try {
      ({ data: reelRows, error } = await withTimeout(
        supabase
          .from('highlight_reels')
          .select('id, name, storage_path, duration_seconds, created_at')
          .eq('created_by_user_id', userId)
          .order('created_at', { ascending: false }),
      ));
    } catch (e: any) {
      setLoadError(e?.message || 'Couldn’t load your Film Room.'); setLoading(false); return;
    }
    if (error) { setLoadError(error.message); setLoading(false); return; }

    const rows = reelRows || [];
    const reelIds = rows.map((r: any) => r.id);

    // 2. One batched query for every reel's share destinations. shares_read lets
    //    the sharer read their own rows, so this returns where I've published.
    const destByReel = new Map<string, Destination[]>();
    if (reelIds.length > 0) {
      // Map a player-audience share's target_player_id → the kid's name. Names
      // aren't joinable on shares, so resolve them client-side from userKids.
      const kidNameById = new Map(userKids.map(k => [k.player_id, k.name]));
      const { data: shareRows } = await supabase
        .from('shares')
        .select('id, content_id, audience, team_id, visible, target_player_id, note, teams ( name )')
        .eq('content_type', 'reel')
        .in('content_id', reelIds);
      (shareRows || []).forEach((s: any) => {
        const list = destByReel.get(s.content_id) ?? [];
        const note = (s.note as string) ?? null;
        if (s.audience === 'public' && s.visible) {
          if (!list.some(d => d.kind === 'public')) list.push({ kind: 'public', shareId: s.id, note });
        } else if (s.audience === 'team') {
          const teamName = s.teams?.name ?? 'Team';
          if (!list.some(d => d.kind === 'team' && d.teamId === s.team_id)) list.push({ kind: 'team', teamName, teamId: s.team_id, shareId: s.id, note });
        } else if (s.audience === 'coaches') {
          const teamName = s.teams?.name ?? 'Team';
          if (!list.some(d => d.kind === 'coaches' && d.teamId === s.team_id)) list.push({ kind: 'coaches', teamName, teamId: s.team_id, shareId: s.id, note });
        } else if (s.audience === 'player') {
          // A 'player' post lands on the kid's own wall (family-only).
          const kidName = kidNameById.get(s.target_player_id) ?? 'Kid';
          if (!list.some(d => d.kind === 'player' && d.playerId === s.target_player_id)) list.push({ kind: 'player', kidName, playerId: s.target_player_id, shareId: s.id, note });
        }
        destByReel.set(s.content_id, list);
      });
    }

    setReels(rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      storagePath: r.storage_path ?? null,
      durationSeconds: r.duration_seconds != null ? Number(r.duration_seconds) : null,
      createdAt: r.created_at,
      destinations: destByReel.get(r.id) ?? [],
    })));
    setLoading(false);
  }

  // Games + loose footage are derived from the user's own video uploads. ONE
  // query: pull every video the user uploaded, embed games(...) for the parent
  // row. Then split into three buckets:
  //   • game_id IS NULL          → LOOSE footage (personal "+" upload) — its own list.
  //   • game_id set, games null   → game is RLS-blocked → dropped (not ours to show).
  //   • game_id set, games present → grouped by game_id into the games Map.
  async function loadGames() {
    if (!userId) { setGames([]); setLooseVideos([]); return; }
    const { data, error } = await supabase
      .from('videos')
      .select('id, label, url, sort_order, game_id, created_at, tagging_complete, event_type, upload_status, clips (count), games (id, title, opponent, game_date, team_id, created_at, season_id, tournament_id, seasons (name), tournaments (name))')
      .eq('uploaded_by_user_id', userId);
    if (error) { Alert.alert('Error', error.message); return; }

    const byId = new Map<string, Game>();
    const loose: (GameVideo & { createdAt: string })[] = [];
    (data || []).forEach((row: any) => {
      // Loose footage: no game at all. Distinct bucket — never touches the map.
      if (row.game_id == null) {
        loose.push({ id: row.id, label: row.label, url: row.url, sortOrder: row.sort_order, taggingComplete: row.tagging_complete === true, uploadStatus: row.upload_status, createdAt: row.created_at });
        return;
      }
      const g = row.games;
      if (!g) return; // game_id set but RLS-blocked → drop
      let game = byId.get(row.game_id);
      if (!game) {
        game = {
          id: g.id,
          title: g.title,
          opponent: g.opponent ?? null,
          gameDate: g.game_date ?? null,
          teamId: g.team_id,
          createdAt: g.created_at,
          videos: [],
          clipCount: 0,
          eventType: null,
          seasonId: g.season_id ?? null,
          seasonName: g.seasons?.name ?? null,
          tournamentId: g.tournament_id ?? null,
          tournamentName: g.tournaments?.name ?? null,
          destinations: [],
        };
        byId.set(row.game_id, game);
      }
      game.videos.push({ id: row.id, label: row.label, url: row.url, sortOrder: row.sort_order, taggingComplete: row.tagging_complete === true, uploadStatus: row.upload_status });
      // clips(count) embeds as [{ count: N }] on the video row; accumulate per game.
      game.clipCount += row.clips?.[0]?.count ?? 0;
      // First video that carries an event type sets the game's (game.tsx uploads
      // leave it null; upload.tsx uploads set it).
      if (!game.eventType && row.event_type) game.eventType = row.event_type;
    });
    for (const game of byId.values()) {
      game.videos.sort((a, b) => a.sortOrder - b.sortOrder);
    }

    // Where each game is posted — one batched shares query, keyed by game id
    // (content_type='game'). Mirrors the reel destination load exactly.
    const gameIds = [...byId.keys()];
    if (gameIds.length > 0) {
      const kidNameById = new Map(userKids.map(k => [k.player_id, k.name]));
      const { data: shareRows } = await supabase
        .from('shares')
        .select('id, content_id, audience, team_id, visible, target_player_id, note, teams ( name )')
        .eq('content_type', 'game')
        .in('content_id', gameIds);
      (shareRows || []).forEach((s: any) => {
        const g = byId.get(s.content_id);
        if (!g) return;
        const note = (s.note as string) ?? null;
        if (s.audience === 'public' && s.visible) {
          if (!g.destinations.some(d => d.kind === 'public')) g.destinations.push({ kind: 'public', shareId: s.id, note });
        } else if (s.audience === 'team') {
          const teamName = s.teams?.name ?? 'Team';
          if (!g.destinations.some(d => d.kind === 'team' && d.teamId === s.team_id)) g.destinations.push({ kind: 'team', teamName, teamId: s.team_id, shareId: s.id, note });
        } else if (s.audience === 'coaches') {
          const teamName = s.teams?.name ?? 'Team';
          if (!g.destinations.some(d => d.kind === 'coaches' && d.teamId === s.team_id)) g.destinations.push({ kind: 'coaches', teamName, teamId: s.team_id, shareId: s.id, note });
        } else if (s.audience === 'player') {
          const kidName = kidNameById.get(s.target_player_id) ?? 'Kid';
          if (!g.destinations.some(d => d.kind === 'player' && d.playerId === s.target_player_id)) g.destinations.push({ kind: 'player', kidName, playerId: s.target_player_id, shareId: s.id, note });
        }
      });
    }

    // Newest loose footage first; strip the sort-only createdAt back to GameVideo.
    loose.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    setGames([...byId.values()]);
    setLooseVideos(loose.map(({ createdAt, ...v }) => v));
  }

  // Manual per-video "done tagging" toggle. Coach decides — not derived from
  // clip count. Flipping the last incomplete video to done turns the game green.
  // Delete a game. videos.game_id and clips.video_id both CASCADE, so one delete
  // removes the game, its videos, and their clips — warn about that.
  function confirmDeleteGame(game: Game) {
    const n = game.videos.length;
    Alert.alert(
      'Delete game',
      `Delete “${game.title}”? This also deletes its ${n} video${n === 1 ? '' : 's'} and their clips. This can’t be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            // delete_game clears the game_lineups guard, then deletes (cascades
            // videos/clips). A raw games.delete() would error once a lineup exists.
            const { error } = await supabase.rpc('delete_game', { p_game_id: game.id });
            if (error) { Alert.alert('Error', error.message); return; }
            loadGames();
          },
        },
      ],
    );
  }

  // Delete a single video (game footage or loose). clips.video_id CASCADEs.
  function confirmDeleteVideo(video: GameVideo) {
    Alert.alert(
      'Delete video',
      `Delete “${video.label}”? This also deletes its clips. This can’t be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.from('videos').delete().eq('id', video.id);
            if (error) { Alert.alert('Error', error.message); return; }
            loadGames();
          },
        },
      ],
    );
  }

  // Open the game picker to attach a LOOSE video (fromGameId null) or MOVE an
  // in-game video to a different game (fromGameId = its current game, excluded).
  function openAttachPicker(video: GameVideo, fromGameId: string | null = null) {
    const targets = games.filter(g => g.id !== fromGameId);
    if (targets.length === 0) {
      Alert.alert(
        fromGameId ? 'No other games' : 'No games yet',
        fromGameId
          ? 'There are no other games to move this into.'
          : 'Upload with a team selected to create a game, then you can add this footage to it.',
      );
      return;
    }
    setAttachTarget({ video, fromGameId });
  }

  // Attach loose footage to an existing game. Mirrors edit-game.tsx's cascade:
  //  • adopt the game's team (anti-misfile) + team visibility,
  //  • INHERIT the game's shared attributes (event_type / event_date / sport /
  //    player_id / season_id) read from the game's FIRST video — the same source
  //    edit-game prefills from — so the footage matches the rest and can't shift
  //    the game's displayed type,
  //  • APPEND (sort_order = the game's current max + 1) so it can't collide with
  //    an existing sort_order (there's no unique constraint) or land as "first".
  // videos_update RLS already permits the uploader — no policy change. Reload so
  // the video leaves "Unsorted footage".
  async function attachToGame(video: GameVideo, game: Game) {
    setAttachTarget(null);
    const { data: gv } = await supabase.from('videos')
      .select('sort_order, event_type, event_date, sport, player_id, season_id')
      .eq('game_id', game.id)
      .order('sort_order', { ascending: true });
    const first = gv?.[0] as any;                                   // lowest sort_order = attr source
    const maxSort = Math.max(-1, ...(gv ?? []).map((r: any) => r.sort_order ?? -1));

    const patch: Record<string, any> = {
      game_id: game.id,
      team_id: game.teamId,
      visibility: 'team',
      sort_order: maxSort + 1,           // append after the game's last video (no collision)
    };
    // Inherit shared attrs only when the game already has a video to match; an
    // empty game has none, so the footage keeps its own attributes.
    if (first) {
      patch.event_type = first.event_type;
      patch.event_date = first.event_date;
      patch.sport = first.sport;
      patch.player_id = first.player_id;
      patch.season_id = first.season_id;
    }

    const { error } = await supabase.from('videos').update(patch).eq('id', video.id);
    if (error) { Alert.alert('Could not add to game', error.message); return; }
    loadGames();
  }

  // Reload on focus (and when the user changes) so returning from edit-game /
  // edit-reel / a delete reflects the change without a manual refresh.
  useFocusEffect(
    useCallback(() => {
      loadReels();
      loadGames();
      loadSaved();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]),
  );

  // Batch-load tags for BOTH reels and games whenever either changes. Reels via
  // reel_tags; games via their clips' clip_tags. All merged into one tagsById
  // (item id → tag id set) + tagMeta so the FilterBar's per-category dropdowns
  // work across the whole Film Room. Batched .in() queries — no N+1.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const reelIds = reels.map(r => r.id);
      const byId = new Map<string, Set<string>>();
      const allTagIds = new Set<string>();
      if (reelIds.length > 0) {
        const { data } = await supabase.from('reel_tags').select('reel_id, tag_id').in('reel_id', reelIds);
        (data || []).forEach((r: any) => {
          const s = byId.get(r.reel_id) ?? new Set<string>();
          s.add(r.tag_id);
          byId.set(r.reel_id, s);
          allTagIds.add(r.tag_id);
        });
      }

      // Game clip-tags: game → videos → clips → clip_tags. Batched .in() queries
      // (no N+1), keyed by GAME id so the per-category filters (Player/Offense/
      // Defense/Plays) light up for games the same way they do for reels. A
      // game's tag set is the union of tags across all its clips (any bundle).
      const videoToGame = new Map<string, string>();
      games.forEach(g => g.videos.forEach(v => videoToGame.set(v.id, g.id)));
      const videoIds = [...videoToGame.keys()];
      if (videoIds.length > 0) {
        const { data: clipRows } = await supabase.from('clips').select('id, video_id').in('video_id', videoIds);
        const clipToGame = new Map<string, string>();
        (clipRows || []).forEach((c: any) => {
          const gid = videoToGame.get(c.video_id);
          if (gid) clipToGame.set(c.id, gid);
        });
        const clipIds = [...clipToGame.keys()];
        if (clipIds.length > 0) {
          const { data: ctRows } = await supabase.from('clip_tags').select('clip_id, tag_id').in('clip_id', clipIds);
          (ctRows || []).forEach((ct: any) => {
            const gid = clipToGame.get(ct.clip_id);
            if (!gid) return;
            const s = byId.get(gid) ?? new Set<string>();
            s.add(ct.tag_id);
            byId.set(gid, s);
            allTagIds.add(ct.tag_id);
          });
        }
      }

      const meta = new Map<string, { name: string; category: string }>();
      if (allTagIds.size > 0) {
        const { data } = await supabase.from('tags').select('id, name, category').in('id', [...allTagIds]);
        (data || []).forEach((t: any) => meta.set(t.id, { name: t.name, category: t.category }));
      }
      if (cancelled) return;
      setTagsById(byId);
      setTagMeta(meta);
    })();
    return () => { cancelled = true; };
  }, [reels, games]);

  // Team ids the user coaches. players_read RLS only returns players on teams the
  // user is a confirmed member of, so this candidate set and post_to_wall's
  // permission gate agree by construction.
  const coachedTeamIds = useMemo(
    () => userTeams.filter(t => COACH_ROLES.includes(t.role)).map(t => t.team_id),
    [userTeams],
  );

  // Teams the user coaches, with names — candidates for the team-wall and
  // coaches-board destination sub-pickers.
  const coachedTeams = useMemo(
    () => userTeams.filter(t => COACH_ROLES.includes(t.role)),
    [userTeams],
  );

  // Load coached-team players. Mirrors refreshKids' style (junction → nested
  // players select → filter RLS-nulled rows → flatten). Skips the query entirely
  // when the user coaches no teams. Non-blocking: the screen renders without it.
  useEffect(() => {
    if (coachedTeamIds.length === 0) { setCoachedPlayers([]); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('player_teams')
        .select('team_id, players ( id, name )')
        .in('team_id', coachedTeamIds);
      if (cancelled) return;
      if (error || !data) { setCoachedPlayers([]); return; }
      const flattened = (data as any[])
        .filter(r => r.players)
        .map(r => ({ player_id: r.players.id, name: r.players.name, team_id: r.team_id }));
      setCoachedPlayers(flattened);
    })();
    return () => { cancelled = true; };
  }, [coachedTeamIds]);

  // Grouped picker candidates: "Your kids" first, then one group per coached
  // team. Dedupe by player_id across the whole structure — a kid who's also on a
  // team you coach shows ONLY under "Your kids"; within a team, each player once.
  const pickerGroups = useMemo<PickerGroup[]>(() => {
    const groups: PickerGroup[] = [];
    const kidIds = new Set(userKids.map(k => k.player_id));

    const kidSeen = new Set<string>();
    const kidPlayers: PickerPlayer[] = [];
    for (const k of userKids) {
      if (kidSeen.has(k.player_id)) continue;
      kidSeen.add(k.player_id);
      kidPlayers.push({ player_id: k.player_id, name: k.name });
    }
    if (kidPlayers.length > 0) groups.push({ key: 'kids', title: 'Your kids', players: kidPlayers });

    const coachTeams = userTeams.filter(t => COACH_ROLES.includes(t.role));
    for (const t of coachTeams) {
      const seen = new Set<string>();
      const players: PickerPlayer[] = [];
      for (const p of coachedPlayers) {
        if (p.team_id !== t.team_id) continue;
        if (kidIds.has(p.player_id)) continue;   // kid relationship wins
        if (seen.has(p.player_id)) continue;      // dedupe within team
        seen.add(p.player_id);
        players.push({ player_id: p.player_id, name: p.name });
      }
      if (players.length > 0) groups.push({ key: `team:${t.team_id}`, title: t.name, players });
    }
    return groups;
  }, [userKids, userTeams, coachedPlayers]);

  // Real team options so the FilterBar's Team dropdown appears. Games carry a
  // team_id; reels don't yet, so a reel falls under "no team" and is hidden when
  // a specific team is selected (expected until reels get team attach).
  const teamNameById = useMemo(() => {
    const m = new Map<string, string>();
    userTeams.forEach(t => { if (!m.has(t.team_id)) m.set(t.team_id, t.name); });
    return m;
  }, [userTeams]);
  const teamOptions = useMemo<DropdownOption[]>(
    () => [{ value: 'all', label: 'All teams' }, ...[...teamNameById].map(([value, label]) => ({ value, label }))],
    [teamNameById],
  );

  // Extra FilterBar dimensions, built from what's actually present across the
  // games. Event & Season show only when there are 2+ to choose between (a
  // single value can't partition the list); Tournament shows with even one, so
  // you can isolate "just the tournament games" from everything else.
  const extraFilters = useMemo(() => {
    const out: { key: string; label: string; options: DropdownOption[] }[] = [];

    const events = new Set(games.map(g => g.eventType).filter(Boolean) as string[]);
    if (events.size >= 2) {
      const labelFor = (v: string) => EVENT_TYPES.find(e => e.value === v)?.label ?? v;
      out.push({
        key: 'eventType', label: 'Event',
        options: [{ value: 'all', label: 'All events' }, ...[...events].map(v => ({ value: v, label: labelFor(v) }))],
      });
    }

    const seasons = new Map<string, string>();
    games.forEach(g => { if (g.seasonId) seasons.set(g.seasonId, g.seasonName ?? 'Season'); });
    if (seasons.size >= 2) {
      out.push({
        key: 'seasonId', label: 'Season',
        options: [{ value: 'all', label: 'All seasons' }, ...[...seasons].map(([value, label]) => ({ value, label }))],
      });
    }

    const tours = new Map<string, string>();
    games.forEach(g => { if (g.tournamentId) tours.set(g.tournamentId, g.tournamentName ?? 'Tournament'); });
    if (tours.size >= 1) {
      out.push({
        key: 'tournamentId', label: 'Tournament',
        options: [{ value: 'all', label: 'All' }, ...[...tours].map(([value, label]) => ({ value, label }))],
      });
    }

    return out;
  }, [games]);

  // Map reels + games → FilterableItem for FilterBar. Reels carry no team
  // (teamId/teamName empty); games carry game.teamId + its team name. Games have
  // no durationSeconds so 'longest' sort lands them at the bottom (acceptable).
  // reelsById/gamesById recover the full row for the card render; the
  // list-render branches on fi.contentType.
  const items = useMemo<FilterableItem[]>(
    () => [
      ...reels.map(r => ({
        id: r.id, teamId: '', teamName: '',
        contentType: 'reel', title: r.name, createdAt: r.createdAt,
        durationSeconds: r.durationSeconds,
      })),
      ...games.map(g => ({
        id: g.id, teamId: g.teamId, teamName: teamNameById.get(g.teamId) ?? '',
        contentType: 'game', title: g.title, createdAt: g.createdAt,
        extra: { eventType: g.eventType ?? '', seasonId: g.seasonId ?? '', tournamentId: g.tournamentId ?? '' },
      })),
    ],
    [reels, games, teamNameById],
  );
  const reelsById = useMemo(() => new Map(reels.map(r => [r.id, r])), [reels]);
  const gamesById = useMemo(() => new Map(games.map(g => [g.id, g])), [games]);

  function formatDuration(seconds: number | null) {
    if (seconds == null) return '—';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // games.game_date is a DATE (YYYY-MM-DD). new Date('YYYY-MM-DD') parses as
  // UTC midnight, which renders as the prior day in any timezone west of UTC.
  // Reconstruct as a local-time date so the displayed date matches what the
  // user entered on the game-creation screen.
  function formatGameDate(ymd: string | null) {
    if (!ymd) return '';
    const [y, m, d] = ymd.split('-').map(n => parseInt(n, 10));
    if (!y || !m || !d) return '';
    return new Date(y, m - 1, d).toLocaleDateString();
  }

  function openReel(reel: Reel) {
    if (!reel.storagePath) { Alert.alert('Unavailable', 'This reel’s video could not be loaded.'); return; }
    // Omit startTime/endTime so shared-viewer plays the whole rendered reel.
    router.push({
      pathname: '/shared-viewer',
      params: { title: reel.name, storagePath: reel.storagePath },
    });
  }

  // Inline rename of a single video's LABEL (per-video, e.g. Q1 → Q3) — distinct
  // from a game's title. Owner/coach only (videos_update RLS). Optimistic across
  // both in-game footage (games[].videos) and loose footage (looseVideos).
  function startVideoRename(video: GameVideo) {
    setRenamingVideoId(video.id);
    setVideoDraft(video.label);
  }

  async function commitVideoRename(video: GameVideo) {
    const next = videoDraft.trim();
    setRenamingVideoId(null);
    if (!next || next === video.label) return;
    const applyLocal = (label: string) => {
      setGames(prev => prev.map(g => ({
        ...g,
        videos: g.videos.map(v => (v.id === video.id ? { ...v, label } : v)),
      })));
      setLooseVideos(prev => prev.map(v => (v.id === video.id ? { ...v, label } : v)));
    };
    applyLocal(next);
    const { error } = await supabase.from('videos').update({ label: next }).eq('id', video.id);
    if (error) {
      applyLocal(video.label); // revert
      Alert.alert('Error', error.message);
    }
  }

  // Open the destination tier chooser (Your Kids / Your Teams / Coaches' Corner).
  // Your Kids routes to the player sheet → note → post to that kid's family; the
  // two team tiers post player-less, coach-gated shares. Empty-state stands when
  // the user has neither kids nor coached teams.
  function confirmPostToWall(item: Postable) {
    const hasKids = pickerGroups.some(g => g.key === 'kids');
    const hasTeams = coachedTeams.length > 0;
    if (!hasKids && !hasTeams) {
      Alert.alert('No one to share with', 'Add a kid, or join a team as a coach, to share a reel.');
      return;
    }
    setTierReel(item);
  }

  // Player chosen in the sheet → straight to the note sheet, then post to that
  // kid's family (audience='player'). No visibility step: picking a kid already
  // says who it's for, so re-asking "Only me / Friends & Family / Team wall"
  // (which is where a mistaken "Only me" silently kept it private) is dropped.
  function postReelToKid(item: Postable, playerId: string, kidName: string) {
    setNoteSheet({
      audience: { label: `Only ${kidName}’s family will see this`, icon: 'people', color: '#8B7CF6' },
      run: async (note) => {
        const { data: shareId, error } = await supabase.rpc('post_to_wall', {
          p_content_type: item.contentType,
          p_content_id: item.contentId,
          p_audience: 'player',
          p_target_player_id: playerId,
        });
        if (error) { Alert.alert('Couldn’t share', error.message); return; }
        if (note && shareId) await supabase.rpc('set_share_note', { p_share_id: shareId, p_note: note });
        addDestinations(item.contentId, [{ kind: 'player', kidName, playerId }]);
        Alert.alert('Shared', `Sent to ${kidName}’s family.` + (note ? ' With your note.' : ''));
      },
    });
  }

  // Merge destination badges onto content (dedup by kind; team by name).
  function mergeDests(existing: Destination[], incoming: Destination[]): Destination[] {
    const have = new Set(existing.map(destKey));
    const merged = [...existing];
    for (const d of incoming) {
      const k = destKey(d);
      if (!have.has(k)) { have.add(k); merged.push(d); }
    }
    return merged;
  }

  // Optimistically reflect a post on the card (reel OR game) without a reload —
  // loadReels/loadGames read all destinations back, so badges survive a refresh.
  function addDestinations(contentId: string, dests: Destination[]) {
    setReels(prev => prev.map(r => (r.id === contentId ? { ...r, destinations: mergeDests(r.destinations, dests) } : r)));
    setGames(prev => prev.map(g => (g.id === contentId ? { ...g, destinations: mergeDests(g.destinations, dests) } : g)));
  }

  // Optimistically drop a destination badge from a card after un-posting.
  function removeDestinationLocal(contentId: string, dest: Destination) {
    const k = destKey(dest);
    setReels(prev => prev.map(r => (r.id === contentId ? { ...r, destinations: r.destinations.filter(d => destKey(d) !== k) } : r)));
    setGames(prev => prev.map(g => (g.id === contentId ? { ...g, destinations: g.destinations.filter(d => destKey(d) !== k) } : g)));
  }

  // Delete the shares row(s) for one destination (precise via team/player id),
  // then drop the badge. RLS lets the sharer or a team coach delete; a no-op
  // delete (0 rows) means the user isn't permitted.
  async function removeDestination(item: Postable, dest: Destination) {
    let q = supabase.from('shares').delete().eq('content_type', item.contentType).eq('content_id', item.contentId);
    if (dest.kind === 'public') q = q.eq('audience', 'public');
    else if (dest.kind === 'team') q = q.eq('audience', 'team').eq('team_id', dest.teamId);
    else if (dest.kind === 'coaches') q = q.eq('audience', 'coaches').eq('team_id', dest.teamId);
    else q = q.eq('audience', 'player').eq('target_player_id', dest.playerId);
    const { data, error } = await q.select('id');
    if (error) { Alert.alert('Couldn’t remove', error.message); return; }
    if (!data || data.length === 0) {
      Alert.alert('Couldn’t remove', 'You can only remove things you posted, or content on a team you coach.');
      return;
    }
    removeDestinationLocal(item.contentId, dest);
  }

  // The note-sheet banner for one destination — same audience visuals used at
  // post time, so editing a coaches note shows the green "only coaches" banner.
  function audienceForDest(dest: Destination): NoteAudience {
    if (dest.kind === 'team') return { label: `Everyone on ${dest.teamName} will see this`, icon: 'people-circle', color: '#EF9F27' };
    if (dest.kind === 'coaches') return { label: `Only ${dest.teamName} coaches will see this`, icon: 'shield-checkmark', color: '#1D9E75' };
    if (dest.kind === 'player') return { label: `${dest.kidName}’s family will see this`, icon: 'people', color: '#8B7CF6' };
    return { label: 'Anyone with the link will see this', icon: 'globe', color: '#8B7CF6' };
  }

  // Optimistically set the note on one destination badge after an edit.
  function updateDestinationNote(contentId: string, dest: Destination, note: string | null) {
    const k = destKey(dest);
    const patch = (d: Destination) => (destKey(d) === k ? { ...d, note } : d);
    setReels(prev => prev.map(r => (r.id === contentId ? { ...r, destinations: r.destinations.map(patch) } : r)));
    setGames(prev => prev.map(g => (g.id === contentId ? { ...g, destinations: g.destinations.map(patch) } : g)));
  }

  // Add / edit / clear the per-share note for one destination. Opens the note
  // sheet pre-filled; set_share_note is sharer-gated and nullif-clears on empty.
  function editDestinationNote(item: Postable, dest: Destination) {
    if (!dest.shareId) { Alert.alert('Not ready', 'Reopen this screen and try again.'); return; }
    const shareId = dest.shareId;
    setNoteSheet({
      audience: audienceForDest(dest),
      initialNote: dest.note ?? '',
      run: async (note: string) => {
        const trimmed = note.trim();
        const { error } = await supabase.rpc('set_share_note', { p_share_id: shareId, p_note: trimmed || null });
        if (error) { Alert.alert('Error', error.message); return; }
        updateDestinationNote(item.contentId, dest, trimmed || null);
      },
    });
  }

  // Film Room "Manage sharing" sheet: an Alert listing each current destination
  // with an edit-note + remove action, plus "Share…" (the existing add flow).
  function manageSharing(item: Postable, destinations: Destination[]) {
    const label = (d: Destination) =>
      d.kind === 'public' ? 'Public' : d.kind === 'team' ? d.teamName : d.kind === 'coaches' ? `${d.teamName} coaches` : `${d.kidName} (shared)`;
    Alert.alert('Sharing', item.title, [
      ...destinations.map(d => ({
        text: `${d.note ? 'Edit' : 'Add'} note · ${label(d)}`,
        onPress: () => editDestinationNote(item, d),
      })),
      ...destinations.map(d => ({ text: `Remove from ${label(d)}`, style: 'destructive' as const, onPress: () => removeDestination(item, d) })),
      { text: 'Share…', onPress: () => confirmPostToWall(item) },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  // Download to the device — reel = its one file, game = all its videos. Goes
  // through getSignedVideoUrl → sign-media, so you can only download what you're
  // entitled to watch. Camera roll on phone, browser download on web.
  async function downloadReel(reel: Reel) {
    if (!reel.storagePath) { Alert.alert('Download', 'This reel isn’t ready yet.'); return; }
    setDownloadingId(reel.id);
    try {
      const { failed } = await downloadMedia([{ key: reel.storagePath, filename: reel.name }]);
      Alert.alert('Download', failed ? 'Couldn’t save the reel.' : 'Saved to your device.');
    } catch (e: any) {
      Alert.alert('Download', e?.message ?? 'Download failed.');
    } finally {
      setDownloadingId(null);
    }
  }

  // Tap handler for the per-game Save Offline button. Branches on the aggregate
  // state's action (see computeGameOffline). Prefetch is idempotent — cached
  // videos are cheap to re-request (they return { ok: true } immediately).
  function handleOfflineTap(game: Game, action: GameOfflineState['action']) {
    if (action === 'inflight') return;
    const ready = game.videos.filter(v => v.uploadStatus === 'ready');
    if (ready.length === 0) return;

    if (action === 'remove') {
      Alert.alert(
        'Remove from device?',
        `The videos stay in the cloud — you can save them offline again later.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: async () => {
            for (const v of ready) await removeVideoFromCache(v.id);
          }},
        ],
      );
      return;
    }

    // 'download' or 'retry' — kick off missing/errored videos. prefetch is
    // dedup'd inside video-cache (in-flight promise + serial queue), so mass
    // calling here is safe.
    for (const v of ready) {
      const s = videoCacheStatus[v.id] ?? 'idle';
      if (s === 'cached' || s === 'downloading' || s === 'queued') continue;
      prefetchVideo(v.id, v.url).catch(() => { /* per-video errors surface via status → 'error' → red button */ });
    }
  }

  async function downloadGame(game: Game) {
    const items = game.videos.filter(v => v.url && v.uploadStatus === 'ready').map(v => ({ key: v.url, filename: `${game.title} - ${v.label}` }));
    if (items.length === 0) { Alert.alert('Download', 'This game has no finished videos yet.'); return; }
    setDownloadingId(game.id);
    try {
      const { saved, failed } = await downloadMedia(items);
      Alert.alert('Download', failed
        ? `Saved ${saved} of ${items.length}. ${failed} couldn’t be saved.`
        : `Saved ${saved} video${saved === 1 ? '' : 's'} to your device.`);
    } catch (e: any) {
      Alert.alert('Download', e?.message ?? 'Download failed.');
    } finally {
      setDownloadingId(null);
    }
  }

  // "Saved to My Film" — live bookmarks to shares. Resolve each via
  // resolve_shared_content (which re-checks entitlement); anything you've lost
  // access to simply drops out. Save lives in the single-file shared viewer, so
  // saved items always carry a storagePath.
  async function loadSaved() {
    if (!userId) { setSavedItems([]); return; }
    const { data: rows } = await supabase
      .from('saved_items').select('id, share_id').eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (!rows?.length) { setSavedItems([]); return; }
    const entries: SavedEntry[] = [];
    for (const row of rows) {
      const { data: resolved, error } = await supabase.rpc('resolve_shared_content', { p_share_id: row.share_id });
      if (error || !resolved?.length) continue; // un-shared / lost access → skip
      const c = resolved[0];
      entries.push({
        savedId: row.id, shareId: row.share_id,
        contentType: c.content_type, contentId: c.content_id,
        title: c.title, storagePath: c.storage_path,
        startTime: c.start_time, endTime: c.end_time,
      });
    }
    setSavedItems(entries);
  }

  function openSaved(e: SavedEntry) {
    if (!e.storagePath) { Alert.alert('Unavailable', 'This content could not be loaded.'); return; }
    router.push({ pathname: '/shared-viewer', params: {
      title: e.title, storagePath: e.storagePath, contentType: e.contentType, contentId: e.contentId,
      shareId: e.shareId,
      startTime: e.startTime != null ? String(e.startTime) : '',
      endTime: e.endTime != null ? String(e.endTime) : '',
    } });
  }

  async function removeSaved(e: SavedEntry) {
    const { error } = await supabase.from('saved_items').delete().eq('id', e.savedId);
    if (error) { Alert.alert('Couldn’t remove', error.message); return; }
    setSavedItems(prev => prev.filter(x => x.savedId !== e.savedId));
  }

  async function downloadSaved(e: SavedEntry) {
    if (!e.storagePath) return;
    setDownloadingId(e.savedId);
    try {
      const { failed } = await downloadMedia([{ key: e.storagePath, filename: e.title }]);
      Alert.alert('Download', failed ? 'Couldn’t save this video.' : 'Saved to your device.');
    } catch (err: any) {
      Alert.alert('Download', err?.message ?? 'Download failed.');
    } finally {
      setDownloadingId(null);
    }
  }

  // Post a reel to a team WALL (player-less, coach-gated). "Public" ALSO posts a
  // separate public share — mirroring the kid flow's treatment of public vs team
  // as independent audiences (so a public team post is visible publicly AND on
  // the team wall).
  async function postTeamWall(choice: { item: Postable; teamId: string; teamName: string }, alsoPublic: boolean) {
    const { item, teamId, teamName } = choice;
    setTeamWallChoice(null);
    if (!(await requirePermission(teamId, 'post_wall'))) return;

    setNoteSheet({
      audience: { label: `Everyone on ${teamName} will see this`, icon: 'people-circle', color: '#EF9F27' },
      run: async (note) => {
        const { data: teamShareId, error: teamErr } = await supabase.rpc('post_to_wall', {
          p_content_type: item.contentType,
          p_content_id: item.contentId,
          p_audience: 'team',
          p_target_player_id: null,
          p_team_id: teamId,
        });
        if (teamErr) { Alert.alert('Error', teamErr.message); return; }
        // The note goes on the TEAM share (the team wall audience).
        if (note && teamShareId) await supabase.rpc('set_share_note', { p_share_id: teamShareId, p_note: note });

        const dests: Destination[] = [{ kind: 'team', teamName, teamId }];
        if (alsoPublic) {
          const { error: pubErr } = await supabase.rpc('post_to_wall', {
            p_content_type: item.contentType,
            p_content_id: item.contentId,
            p_audience: 'public',
            p_target_player_id: null,
            p_team_id: teamId,
          });
          if (pubErr) { Alert.alert('Error', pubErr.message); return; }
          dests.push({ kind: 'public' });
        }

        addDestinations(item.contentId, dests);
        Alert.alert('Posted', alsoPublic ? `Posted to ${teamName} wall and public.` : `Posted to ${teamName} wall.`);
      },
    });
  }

  // Post a reel to a team's COACHES' board (player-less, coach-gated). No
  // visibility choice — selecting the team posts immediately.
  function postCoachesBoard(item: Postable, teamId: string, teamName: string) {
    setCoachesReel(null);
    setNoteSheet({
      audience: { label: 'Only coaches will see this', icon: 'shield-checkmark', color: '#1D9E75' },
      run: async (note) => {
        const { data: shareId, error } = await supabase.rpc('post_to_wall', {
          p_content_type: item.contentType,
          p_content_id: item.contentId,
          p_audience: 'coaches',
          p_target_player_id: null,
          p_team_id: teamId,
        });
        if (error) { Alert.alert('Error', error.message); return; }
        if (note && shareId) await supabase.rpc('set_share_note', { p_share_id: shareId, p_note: note });
        addDestinations(item.contentId, [{ kind: 'coaches', teamId, teamName }]);
        Alert.alert('Posted', `Posted to ${teamName} coaches’ board.` + (note ? ' With your note.' : ''));
      },
    });
  }

  function confirmDelete(reel: Reel) {
    Alert.alert('Delete reel', `Delete “${reel.name}”? This can’t be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          const { error } = await supabase.from('highlight_reels').delete().eq('id', reel.id);
          if (error) { Alert.alert('Error', error.message); return; }
          setReels(prev => prev.filter(r => r.id !== reel.id));
        },
      },
    ]);
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topRow}>
        <TouchableOpacity onPress={goBackOrHome} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/export')} style={styles.makeReelBtn}>
          <Text style={styles.makeReelText}>＋ Make a reel</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>Film Room</Text>
      <Text style={styles.subtitle}>Your workbench — tag film, build reels, and share them out.</Text>

      <FilterBar
        items={items}
        tagsById={tagsById}
        tagMeta={tagMeta}
        teamOptions={teamOptions}
        typeOptions={MY_WORK_TYPE_OPTIONS}
        sortOptions={MY_WORK_SORT_OPTIONS}
        extraFilters={extraFilters}
        searchPlaceholder="Search reels"
        onVisibleChange={setVisibleReels}
      />

      <View style={[styles.content, (visibleReels.length > 0 || looseVideos.length > 0) && styles.contentTop]}>
        {loading ? (
          <SkeletonCards />
        ) : loadError ? (
          <LoadError message={loadError} onRetry={reloadFilmRoom} />
        ) : reels.length === 0 && games.length === 0 && looseVideos.length === 0 && savedItems.length === 0 ? (
          <Text style={styles.empty}>Nothing here yet. Export a reel or upload game film to see it.</Text>
        ) : (
          <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
            {/* Unsorted footage — loose uploads (game_id null). Distinct list,
                always shown when present, independent of the reels/games filter. */}
            {looseVideos.length > 0 && (
              <View style={styles.unsortedSection}>
                <Text style={styles.sectionHeader}>Unsorted footage</Text>
                <Text style={styles.sectionHint}>Uploaded, not on a game yet — tap to tag.</Text>
                {looseVideos.map(v => (
                  renamingVideoId === v.id ? (
                    <View key={v.id} style={styles.looseCard}>
                      <View style={styles.looseThumb}><Ionicons name="videocam-outline" size={22} color="#888" /></View>
                      <View style={styles.cardBody}>
                        <TextInput
                          style={styles.cardTitleInput}
                          value={videoDraft}
                          onChangeText={setVideoDraft}
                          autoFocus
                          selectTextOnFocus
                          returnKeyType="done"
                          onSubmitEditing={() => commitVideoRename(v)}
                          onBlur={() => commitVideoRename(v)}
                        />
                      </View>
                    </View>
                  ) : (
                  <TouchableOpacity
                    key={v.id}
                    style={styles.looseCard}
                    onLongPress={() => confirmDeleteVideo(v)}
                    onPress={() => v.uploadStatus !== 'ready'
                      ? Alert.alert(v.label, v.uploadStatus === 'uploading' ? 'Still uploading — check back in a moment.' : 'This upload didn’t finish.', [
                          { text: 'Delete', style: 'destructive', onPress: () => confirmDeleteVideo(v) },
                          { text: 'Cancel', style: 'cancel' },
                        ])
                      : Alert.alert(v.label, undefined, [
                          { text: 'Add to a game', onPress: () => openAttachPicker(v) },
                          { text: 'Tag Video', onPress: () => router.push({ pathname: '/tagging-overlay', params: { videoId: v.id, url: v.url, label: v.label, personal: '1' } }) },
                          { text: 'View Clips', onPress: () => router.push({ pathname: '/clips', params: { videoId: v.id, label: v.label } }) },
                          { text: 'Rename', onPress: () => startVideoRename(v) },
                          { text: 'Cancel', style: 'cancel' },
                        ])}
                  >
                    <View style={styles.looseThumb}><Ionicons name="videocam-outline" size={22} color="#888" /></View>
                    <View style={styles.cardBody}>
                      <Text style={styles.cardTitle} numberOfLines={1}>{v.label}</Text>
                      <Text style={styles.cardMeta}>
                        {v.uploadStatus === 'uploading' ? 'Uploading…' : v.uploadStatus === 'failed' ? 'Upload didn’t finish' : 'Not on a game yet'}
                      </Text>
                    </View>
                    <Ionicons name="pricetag-outline" size={18} color="#534AB7" />
                  </TouchableOpacity>
                  )
                ))}
              </View>
            )}

            {/* Saved to My Film — live bookmarks to content shared with you.
                Always shown when present, independent of the reels/games filter. */}
            {savedItems.length > 0 && (
              <View style={styles.unsortedSection}>
                <Text style={styles.sectionHeader}>Saved to My Film</Text>
                <Text style={styles.sectionHint}>Shared with you — stays here while it’s shared.</Text>
                {savedItems.map(e => (
                  <View key={e.savedId} style={styles.looseCard}>
                    <TouchableOpacity style={styles.looseThumb} onPress={() => openSaved(e)}>
                      <Ionicons name="play-circle-outline" size={24} color="#534AB7" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.cardBody} onPress={() => openSaved(e)}>
                      <Text style={styles.cardTitle} numberOfLines={1}>{e.title || 'Shared video'}</Text>
                      <Text style={styles.cardMeta}>Saved · tap to play</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.trashBtn} onPress={() => downloadSaved(e)} disabled={downloadingId === e.savedId}>
                      {downloadingId === e.savedId
                        ? <ActivityIndicator size="small" color="#4a90d9" />
                        : <Ionicons name="download-outline" size={18} color="#4a90d9" />}
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.trashBtn} onPress={() => removeSaved(e)}>
                      <Ionicons name="close" size={18} color="#a55" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* "No matches" only when there ARE reels/games but the filter hid them. */}
            {(reels.length > 0 || games.length > 0) && visibleReels.length === 0 && (
              <Text style={styles.emptyInline}>Nothing matches your filters.</Text>
            )}

            {visibleReels.map(fi => {
              if (fi.contentType === 'reel') {
                const reel = reelsById.get(fi.id);
                if (!reel) return null;
                return (
                  <ContentCard
                    key={`reel:${reel.id}`}
                    content={{
                      id: reel.id,
                      kind: 'reel',
                      title: reel.name,
                      meta: `${formatDuration(reel.durationSeconds)} · ${new Date(reel.createdAt).toLocaleDateString()}`,
                      thumbnailUri: null,
                    }}
                    onOpen={() => openReel(reel)}
                    onLongPress={() => Alert.alert(reel.name, undefined, [
                      { text: 'Edit reel (rename)', onPress: () => router.push({ pathname: '/edit-reel', params: { id: reel.id } }) },
                      { text: 'Delete reel', style: 'destructive', onPress: () => confirmDelete(reel) },
                      { text: 'Cancel', style: 'cancel' },
                    ])}
                    shareStatus={deriveShareStatus(reel.destinations)}
                    actions={[
                      {
                        icon: reel.destinations.length ? 'share-social' : 'share-outline',
                        label: reel.destinations.length ? 'Manage sharing' : 'Share',
                        active: reel.destinations.length > 0,
                        onPress: () => {
                          const item: Postable = { contentType: 'reel', contentId: reel.id, title: reel.name };
                          if (reel.destinations.length) manageSharing(item, reel.destinations); else confirmPostToWall(item);
                        },
                      },
                      { icon: 'download-outline', label: 'Download', busy: downloadingId === reel.id, onPress: () => downloadReel(reel) },
                      { icon: 'trash-outline', label: 'Delete reel', danger: true, onPress: () => confirmDelete(reel) },
                    ]}
                  />
                );
              }
              if (fi.contentType === 'game') {
                const game = gamesById.get(fi.id);
                if (!game) return null;
                const done = gameIsDone(game);
                const dateStr = formatGameDate(game.gameDate);
                const videoCount = `${game.videos.length} video${game.videos.length === 1 ? '' : 's'}`;
                return (
                  <View key={`game:${game.id}`}>
                    <ContentCard
                      content={{
                        id: game.id,
                        kind: 'game',
                        title: game.title,
                        meta: dateStr ? `${dateStr} · ${videoCount}` : videoCount,
                        clipCount: game.videos.length,
                        tagStatus: done ? 'done' : (game.clipCount > 0 ? 'tagging' : 'none'),
                        thumbnailUri: null,
                      }}
                      onOpen={() => router.push({ pathname: '/game-detail', params: { id: game.id, title: game.title } })}
                      onLongPress={() => Alert.alert(game.title, undefined, [
                        { text: 'Edit game', onPress: () => router.push({ pathname: '/edit-game', params: { id: game.id } }) },
                        { text: 'Edit lineup (who played)', onPress: () => router.push({ pathname: '/edit-lineup', params: { gameId: game.id, gameTitle: game.title } }) },
                        { text: 'Delete game', style: 'destructive', onPress: () => confirmDeleteGame(game) },
                        { text: 'Cancel', style: 'cancel' },
                      ])}
                      shareStatus={deriveShareStatus(game.destinations)}
                      trailing={<Ionicons name="chevron-forward" size={20} color="#888" />}
                      actions={(() => {
                        const acts: CardAction[] = [{
                          icon: game.destinations.length ? 'share-social' : 'share-outline',
                          label: game.destinations.length ? 'Manage sharing' : 'Share',
                          active: game.destinations.length > 0,
                          onPress: () => {
                            // A shared game plays only its finalized videos — nothing ready → nothing to share.
                            if (!game.videos.some(v => v.uploadStatus === 'ready')) { Alert.alert('Share', 'No finished videos to share yet.'); return; }
                            const item: Postable = { contentType: 'game', contentId: game.id, title: game.title };
                            if (game.destinations.length) manageSharing(item, game.destinations); else confirmPostToWall(item);
                          },
                        }];
                        const off = computeGameOffline(game, videoCacheStatus, videoCacheProgress);
                        if (off) acts.push({
                          icon: off.action === 'remove' ? 'cloud-done' : off.action === 'retry' ? 'refresh' : 'cloud-download-outline',
                          label: off.label,
                          active: off.action === 'remove',
                          busy: off.action === 'inflight',
                          onPress: () => handleOfflineTap(game, off.action),
                        });
                        acts.push({ icon: 'download-outline', label: 'Download', busy: downloadingId === game.id, onPress: () => downloadGame(game) });
                        return acts;
                      })()}
                    />
                  </View>
                );
              }
              return null;
            })}
          </ScrollView>
        )}
      </View>

      {/* Attach a loose video to a game, or move an in-game video to another. */}
      {attachTarget && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setAttachTarget(null)}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setAttachTarget(null)}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <Text style={styles.sheetTitle}>{attachTarget.fromGameId ? 'Move to another game' : 'Add to a game'}</Text>
              <ScrollView style={styles.sheetScroll}>
                {games.filter(g => g.id !== attachTarget.fromGameId).map(g => (
                  <TouchableOpacity key={g.id} style={styles.sheetRow} onPress={() => attachToGame(attachTarget.video, g)}>
                    <Text style={styles.sheetRowText} numberOfLines={1}>{g.title}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TouchableOpacity style={styles.sheetCancel} onPress={() => setAttachTarget(null)}>
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {pickerReel && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setPickerReel(null)}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setPickerReel(null)}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <Text style={styles.sheetTitle}>Share…</Text>
              <ScrollView style={styles.sheetScroll}>
                {pickerGroups.map(g => (
                  <View key={g.key}>
                    <Text style={styles.sheetSectionHeader}>{g.title}</Text>
                    {g.players.map(p => (
                      <TouchableOpacity
                        key={`${g.key}:${p.player_id}`}
                        style={styles.sheetRow}
                        onPress={() => { postReelToKid(pickerReel, p.player_id, p.name); setPickerReel(null); }}
                      >
                        <Text style={styles.sheetRowText}>{g.key === 'kids' ? `Post to ${p.name}’s wall` : `Share with ${p.name}`}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ))}
              </ScrollView>
              <TouchableOpacity style={styles.sheetCancel} onPress={() => setPickerReel(null)}>
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Destination tier chooser: Your Kids / Your Teams / Coaches' Corner. */}
      {tierReel && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setTierReel(null)}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setTierReel(null)}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <Text style={styles.sheetTitle}>Share…</Text>
              <ScrollView style={styles.sheetScroll}>
                {pickerGroups.some(g => g.key === 'kids') && (
                  <TouchableOpacity style={styles.sheetRow} onPress={() => { setPickerReel(tierReel); setTierReel(null); }}>
                    <Text style={styles.sheetRowText}>Your kids</Text>
                  </TouchableOpacity>
                )}
                {coachedTeams.length > 0 && (
                  <TouchableOpacity style={styles.sheetRow} onPress={() => { setTeamWallReel(tierReel); setTierReel(null); }}>
                    <Text style={styles.sheetRowText}>Your teams</Text>
                  </TouchableOpacity>
                )}
                {coachedTeams.length > 0 && (
                  <TouchableOpacity style={styles.sheetRow} onPress={() => { setCoachesReel(tierReel); setTierReel(null); }}>
                    <Text style={styles.sheetRowText}>Coaches&apos; Corner</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
              <TouchableOpacity style={styles.sheetCancel} onPress={() => setTierReel(null)}>
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Your Teams → pick a coached team for a team-wall post. */}
      {teamWallReel && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setTeamWallReel(null)}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setTeamWallReel(null)}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <Text style={styles.sheetTitle}>Post to a team wall</Text>
              <ScrollView style={styles.sheetScroll}>
                <Text style={styles.sheetSectionHeader}>Your teams</Text>
                {coachedTeams.map(t => (
                  <TouchableOpacity
                    key={t.team_id}
                    style={styles.sheetRow}
                    onPress={() => { setTeamWallChoice({ item: teamWallReel, teamId: t.team_id, teamName: t.name }); setTeamWallReel(null); }}
                  >
                    <Text style={styles.sheetRowText}>{t.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TouchableOpacity style={styles.sheetCancel} onPress={() => setTeamWallReel(null)}>
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Team-wall visibility: Team only (default) vs Public. */}
      {teamWallChoice && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setTeamWallChoice(null)}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setTeamWallChoice(null)}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <Text style={styles.sheetTitle}>Post to {teamWallChoice.teamName}</Text>
              <ScrollView style={styles.sheetScroll}>
                <TouchableOpacity style={styles.sheetRow} onPress={() => postTeamWall(teamWallChoice, false)}>
                  <Text style={styles.sheetRowText}>Team only</Text>
                </TouchableOpacity>
                {/* "Public" removed — retired app-wide (child-safety data-leak). */}
              </ScrollView>
              <TouchableOpacity style={styles.sheetCancel} onPress={() => setTeamWallChoice(null)}>
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Coaches' Corner → pick a coached team; selecting posts immediately. */}
      {coachesReel && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setCoachesReel(null)}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setCoachesReel(null)}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <Text style={styles.sheetTitle}>Coaches&apos; Corner</Text>
              <ScrollView style={styles.sheetScroll}>
                <Text style={styles.sheetSectionHeader}>Your teams</Text>
                {coachedTeams.map(t => (
                  <TouchableOpacity
                    key={t.team_id}
                    style={styles.sheetRow}
                    onPress={() => postCoachesBoard(coachesReel, t.team_id, t.name)}
                  >
                    <Text style={styles.sheetRowText}>{t.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TouchableOpacity style={styles.sheetCancel} onPress={() => setCoachesReel(null)}>
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {noteSheet && (
        <ShareNoteSheet
          audience={noteSheet.audience}
          initialNote={noteSheet.initialNote}
          busy={noteBusy}
          onSend={submitNote}
          onCancel={() => setNoteSheet(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingHorizontal: 20 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { paddingVertical: 8 },
  backText: { color: '#534AB7', fontSize: 16 },
  makeReelBtn: { backgroundColor: '#534AB7', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  makeReelText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  title: { color: '#fff', fontSize: 26, fontWeight: '700', marginTop: 8, marginBottom: 4 },
  subtitle: { color: '#888', fontSize: 13, lineHeight: 18, marginBottom: 16 },

  content: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  contentTop: { alignItems: 'stretch', justifyContent: 'flex-start' },
  empty: { color: '#555', fontSize: 15, textAlign: 'center', paddingHorizontal: 20 },
  list: { alignSelf: 'stretch' },

  card: {
    flexDirection: 'row', alignItems: 'stretch', gap: 12,
    backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, marginBottom: 10,
    borderWidth: 1, borderColor: '#333',
  },
  // Game cards stack header above the expanded video sub-list — column layout
  // overrides the reel card's row layout, and gap:0 lets videoList own the
  // spacing under its top divider.
  gameCard: { flexDirection: 'column', gap: 0 },
  // Done signal: all videos tagged. Green border + faint green wash on the face.
  gameCardDone: { borderColor: TAG_STATUS.done, borderWidth: 2, backgroundColor: '#14241a' },
  gameHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  gameThumb: {
    width: 72, height: 46, borderRadius: 8, backgroundColor: '#0d0d0d',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2a2a2a',
  },
  videoList: {
    marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#2a2a2a', gap: 8,
  },
  videoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  videoCheck: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  videoCheckLabel: { color: '#666', fontSize: 12, fontWeight: '600' },
  videoCheckLabelDone: { color: TAG_STATUS.done },
  // Filled, rounded "tap for options" cell — inset #0d0d0d contrasts the #1a1a1a
  // game card; the ••• + hint signal a menu, not playback.
  videoOptionsCell: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#0d0d0d', borderRadius: 8, borderWidth: 1, borderColor: '#2a2a2a',
    paddingVertical: 10, paddingHorizontal: 12,
  },
  videoOptBody: { flex: 1 },
  videoOptTitle: { color: '#fff', fontSize: 14, fontWeight: '600' },
  videoRenameInput: {
    flex: 1, color: '#fff', fontSize: 14, fontWeight: '600', padding: 0,
    borderBottomWidth: 1, borderBottomColor: '#534AB7',
  },
  videoOptHint: { color: '#888', fontSize: 11, marginTop: 1 },
  gamePostBtn: { alignSelf: 'flex-start', backgroundColor: '#534AB7', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, marginTop: 10, alignItems: 'center', justifyContent: 'center' },
  gameOfflineBtn: { borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, marginTop: 10, alignItems: 'center', justifyContent: 'center' },
  gameOfflineText: { fontSize: 12, fontWeight: '700' },
  gameAddBtn: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#534AB7', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, marginTop: 8 },
  gameAddText: { color: '#534AB7', fontSize: 12, fontWeight: '700' },
  typeBadgeWrap: { marginBottom: 6 },
  videoRowEmpty: { color: '#555', fontSize: 13, fontStyle: 'italic', paddingVertical: 6 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  thumb: {
    width: 92, minHeight: 92, borderRadius: 10, backgroundColor: '#0d0d0d',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2a2a2a',
  },
  cardBody: { flex: 1, gap: 6 },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  cardTitleInput: {
    color: '#fff', fontSize: 15, fontWeight: '600', padding: 0,
    borderBottomWidth: 1, borderBottomColor: '#534AB7',
  },
  cardMeta: { color: '#888', fontSize: 12 },
  unsortedSection: { marginBottom: 6 },
  sectionHeader: { color: '#fff', fontSize: 14, fontWeight: '700', marginTop: 2 },
  sectionHint: { color: '#888', fontSize: 12, marginTop: 2, marginBottom: 10 },
  looseCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: '#333',
  },
  looseThumb: {
    width: 44, height: 44, borderRadius: 8, backgroundColor: '#0d0d0d',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2a2a2a',
  },
  emptyInline: { color: '#555', fontSize: 14, textAlign: 'center', paddingVertical: 20 },

  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, maxWidth: 160,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  badgePublic: { backgroundColor: '#1D9E75' },   // green = public/personal wall
  badgeTeam: { backgroundColor: '#534AB7' },      // purple = team wall
  badgeCoaches: { backgroundColor: '#C8742B' },   // amber = coaches-only
  badgePlayer: { backgroundColor: '#4A6B8A' },    // slate = kid's wall (family-only)
  badgeLock: { backgroundColor: '#222', borderWidth: 1, borderColor: '#333' },
  badgeLockText: { color: '#888', fontSize: 11, fontWeight: '600' },

  postBtn: {
    backgroundColor: '#534AB7', borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 6,
  },
  postBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  trashBtn: { padding: 8 },

  // Grouped "Post to wall" player-picker bottom sheet.
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1a1a1a', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 32 },
  sheetTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  sheetScroll: { maxHeight: 380 },
  sheetSectionHeader: { color: '#888', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12, marginBottom: 6 },
  sheetRow: { backgroundColor: '#222', borderRadius: 10, padding: 16, marginBottom: 8 },
  sheetRowText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  sheetCancel: { padding: 14, alignItems: 'center', marginTop: 4 },
  sheetCancelText: { color: '#888', fontSize: 15 },
});

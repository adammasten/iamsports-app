import { COACH_ROLES, useTeamContext } from '@/context';
import { supabase } from '@/supabase';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EVENT_TYPES } from '@/lib/core/upload-meta';
import { downloadMedia } from '@/lib/native/download-media';
import { requirePermission } from './permissionGuard';
import { type DropdownOption } from './components/Dropdown';
import FilterBar, { type FilterableItem } from './components/FilterBar';
import ContentTypeBadge from './components/ContentTypeBadge';
import VisibilityPicker, { type VisibilitySelection } from './components/VisibilityPicker';

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
type Destination =
  | { kind: 'public' }
  | { kind: 'team'; teamName: string; teamId: string }
  | { kind: 'coaches'; teamName: string; teamId: string }
  | { kind: 'player'; kidName: string; playerId: string };

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
type GameVideo = { id: string; label: string; url: string; sortOrder: number; taggingComplete: boolean };

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
// Green (all videos complete) takes precedence; otherwise the derived
// clip-based signal: yellow = has clips, red = none yet.
function gameStatusColor(game: Game): string {
  if (gameIsDone(game)) return TAG_STATUS.done;
  return game.clipCount > 0 ? TAG_STATUS.inProgress : TAG_STATUS.notStarted;
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
  const [expandedGameId, setExpandedGameId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Filtered+sorted items, produced by FilterBar (a FilterableItem subset; the
  // full Reel/Game is recovered via reelsById/gamesById for the card render).
  const [visibleReels, setVisibleReels] = useState<FilterableItem[]>([]);
  // Batch-loaded tag data for the reel feed: each reel's tag set + tag metadata.
  const [tagsById, setTagsById] = useState<Map<string, Set<string>>>(new Map());
  const [tagMeta, setTagMeta] = useState<Map<string, { name: string; category: string }>>(new Map());

  // Inline rename state: which reel is being renamed + the working draft.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [savedItems, setSavedItems] = useState<SavedEntry[]>([]);
  const [draftName, setDraftName] = useState('');

  // Post-to-wall picker state: which reel + kid the user chose in the Alert,
  // held while VisibilityPicker collects the tier. null = picker hidden.
  const [pendingPost, setPendingPost] = useState<{ item: Postable; playerId: string; kidName: string } | null>(null);

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

  async function loadReels() {
    if (!userId) { setReels([]); setLoading(false); return; }
    setLoading(true);

    // 1. My reels, newest first (creator-read RLS branch covers this).
    const { data: reelRows, error } = await supabase
      .from('highlight_reels')
      .select('id, name, storage_path, duration_seconds, created_at')
      .eq('created_by_user_id', userId)
      .order('created_at', { ascending: false });
    if (error) { Alert.alert('Error', error.message); setLoading(false); return; }

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
        .select('content_id, audience, team_id, visible, target_player_id, teams ( name )')
        .eq('content_type', 'reel')
        .in('content_id', reelIds);
      (shareRows || []).forEach((s: any) => {
        const list = destByReel.get(s.content_id) ?? [];
        if (s.audience === 'public' && s.visible) {
          if (!list.some(d => d.kind === 'public')) list.push({ kind: 'public' });
        } else if (s.audience === 'team') {
          const teamName = s.teams?.name ?? 'Team';
          if (!list.some(d => d.kind === 'team' && d.teamId === s.team_id)) list.push({ kind: 'team', teamName, teamId: s.team_id });
        } else if (s.audience === 'coaches') {
          const teamName = s.teams?.name ?? 'Team';
          if (!list.some(d => d.kind === 'coaches' && d.teamId === s.team_id)) list.push({ kind: 'coaches', teamName, teamId: s.team_id });
        } else if (s.audience === 'player') {
          // A 'player' post lands on the kid's own wall (family-only).
          const kidName = kidNameById.get(s.target_player_id) ?? 'Kid';
          if (!list.some(d => d.kind === 'player' && d.playerId === s.target_player_id)) list.push({ kind: 'player', kidName, playerId: s.target_player_id });
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
      .select('id, label, url, sort_order, game_id, created_at, tagging_complete, event_type, clips (count), games (id, title, opponent, game_date, team_id, created_at, season_id, tournament_id, seasons (name), tournaments (name))')
      .eq('uploaded_by_user_id', userId);
    if (error) { Alert.alert('Error', error.message); return; }

    const byId = new Map<string, Game>();
    const loose: (GameVideo & { createdAt: string })[] = [];
    (data || []).forEach((row: any) => {
      // Loose footage: no game at all. Distinct bucket — never touches the map.
      if (row.game_id == null) {
        loose.push({ id: row.id, label: row.label, url: row.url, sortOrder: row.sort_order, taggingComplete: row.tagging_complete === true, createdAt: row.created_at });
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
      game.videos.push({ id: row.id, label: row.label, url: row.url, sortOrder: row.sort_order, taggingComplete: row.tagging_complete === true });
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
        .select('content_id, audience, team_id, visible, target_player_id, teams ( name )')
        .eq('content_type', 'game')
        .in('content_id', gameIds);
      (shareRows || []).forEach((s: any) => {
        const g = byId.get(s.content_id);
        if (!g) return;
        if (s.audience === 'public' && s.visible) {
          if (!g.destinations.some(d => d.kind === 'public')) g.destinations.push({ kind: 'public' });
        } else if (s.audience === 'team') {
          const teamName = s.teams?.name ?? 'Team';
          if (!g.destinations.some(d => d.kind === 'team' && d.teamId === s.team_id)) g.destinations.push({ kind: 'team', teamName, teamId: s.team_id });
        } else if (s.audience === 'coaches') {
          const teamName = s.teams?.name ?? 'Team';
          if (!g.destinations.some(d => d.kind === 'coaches' && d.teamId === s.team_id)) g.destinations.push({ kind: 'coaches', teamName, teamId: s.team_id });
        } else if (s.audience === 'player') {
          const kidName = kidNameById.get(s.target_player_id) ?? 'Kid';
          if (!g.destinations.some(d => d.kind === 'player' && d.playerId === s.target_player_id)) g.destinations.push({ kind: 'player', kidName, playerId: s.target_player_id });
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
  // Optimistic: flip the check locally first (instant, and re-derives the green
  // card face), write in the background, revert only if the write fails.
  async function toggleVideoComplete(video: GameVideo) {
    const next = !video.taggingComplete;
    const applyLocal = (val: boolean) =>
      setGames(prev => prev.map(g => ({
        ...g,
        videos: g.videos.map(v => (v.id === video.id ? { ...v, taggingComplete: val } : v)),
      })));
    applyLocal(next);
    const { error } = await supabase
      .from('videos')
      .update({ tagging_complete: next })
      .eq('id', video.id);
    if (error) {
      applyLocal(!next); // revert
      Alert.alert('Error', error.message);
    }
  }

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
            const { error } = await supabase.from('games').delete().eq('id', game.id);
            if (error) { Alert.alert('Error', error.message); return; }
            if (expandedGameId === game.id) setExpandedGameId(null);
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

  function startRename(reel: Reel) {
    setRenamingId(reel.id);
    setDraftName(reel.name);
  }

  async function commitRename(reel: Reel) {
    const next = draftName.trim();
    setRenamingId(null);
    if (!next || next === reel.name) return;
    // Optimistic local update; revert on error.
    setReels(prev => prev.map(r => r.id === reel.id ? { ...r, name: next } : r));
    const { error } = await supabase.from('highlight_reels').update({ name: next }).eq('id', reel.id);
    if (error) {
      Alert.alert('Error', error.message);
      setReels(prev => prev.map(r => r.id === reel.id ? { ...r, name: reel.name } : r));
    }
  }

  // Open the destination tier chooser (Your Kids / Your Teams / Coaches' Corner).
  // Your Kids routes to the existing player sheet + VisibilityPicker flow; the
  // two team tiers post player-less, coach-gated shares. Empty-state stands when
  // the user has neither kids nor coached teams.
  function confirmPostToWall(item: Postable) {
    const hasKids = pickerGroups.some(g => g.key === 'kids');
    const hasTeams = coachedTeams.length > 0;
    if (!hasKids && !hasTeams) {
      Alert.alert('Nothing to post to', 'Add a kid, or join a team as a coach, to post a reel.');
      return;
    }
    setTierReel(item);
  }

  // Player chosen in the sheet — defer posting and let VisibilityPicker collect
  // the tier (public / team / private) before any RPC fires.
  function postReelToKid(item: Postable, playerId: string, kidName: string) {
    setPendingPost({ item, playerId, kidName });
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

  // Film Room "Manage sharing" sheet: an Alert listing each current destination
  // with a Remove, plus "Post to a wall" (the existing add flow).
  function manageSharing(item: Postable, destinations: Destination[]) {
    const label = (d: Destination) =>
      d.kind === 'public' ? 'Public' : d.kind === 'team' ? d.teamName : d.kind === 'coaches' ? `${d.teamName} coaches` : `${d.kidName}’s wall`;
    Alert.alert('Sharing', item.title, [
      ...destinations.map(d => ({ text: `Remove from ${label(d)}`, style: 'destructive' as const, onPress: () => removeDestination(item, d) })),
      { text: 'Post to a wall', onPress: () => confirmPostToWall(item) },
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

  async function downloadGame(game: Game) {
    const items = game.videos.filter(v => v.url).map(v => ({ key: v.url, filename: `${game.title} - ${v.label}` }));
    if (items.length === 0) { Alert.alert('Download', 'This game has no videos yet.'); return; }
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

    const { error: teamErr } = await supabase.rpc('post_to_wall', {
      p_content_type: item.contentType,
      p_content_id: item.contentId,
      p_audience: 'team',
      p_target_player_id: null,
      p_team_id: teamId,
    });
    if (teamErr) { Alert.alert('Error', teamErr.message); return; }

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
  }

  // Post a reel to a team's COACHES' board (player-less, coach-gated). No
  // visibility choice — selecting the team posts immediately.
  async function postCoachesBoard(item: Postable, teamId: string, teamName: string) {
    setCoachesReel(null);
    const { error } = await supabase.rpc('post_to_wall', {
      p_content_type: item.contentType,
      p_content_id: item.contentId,
      p_audience: 'coaches',
      p_target_player_id: null,
      p_team_id: teamId,
    });
    if (error) { Alert.alert('Error', error.message); return; }
    addDestinations(item.contentId, [{ kind: 'coaches', teamId, teamName }]);
    Alert.alert('Posted', `Posted to ${teamName} coaches' board.`);
  }

  // Picker resolved a SET of audiences. "Only me" writes nothing; each other
  // selection is one post_to_wall call (SECURITY DEFINER — requires the caller
  // be a linked parent of the target player, true for the user's own kids).
  // Friends & Family maps to the 'player' audience (family-only — NEVER 'public').
  async function handleVisibilitySelect(sel: VisibilitySelection) {
    const pending = pendingPost;
    if (!pending) return;
    setPendingPost(null);
    const { item, playerId, kidName } = pending;

    // Build the list of audiences to post, each with the badge it maps to.
    const targets: { audience: 'player' | 'public' | 'team'; teamId?: string; label: string; dest: Destination }[] = [];
    if (sel.friendsFamily) {
      targets.push({ audience: 'player', label: 'Friends & Family', dest: { kind: 'player', kidName, playerId } });
    }
    if (sel.public) {
      targets.push({ audience: 'public', label: 'Public', dest: { kind: 'public' } });
    }
    if (sel.teamWall && sel.teamId) {
      const teamName = sel.teamName ?? 'Team';
      targets.push({ audience: 'team', teamId: sel.teamId, label: `${teamName} wall`, dest: { kind: 'team', teamName, teamId: sel.teamId } });
    }

    // Only-me (or an empty set) means no wall placement at all.
    if (targets.length === 0) {
      Alert.alert('Kept private', `“${item.title}” stays visible only to you.`);
      return;
    }

    // Post each selected audience. One failure doesn't abort the rest.
    const posted: string[] = [];
    const failed: string[] = [];
    const newDests: Destination[] = [];
    for (const t of targets) {
      const params: Record<string, any> = {
        p_content_type: item.contentType,
        p_content_id: item.contentId,
        p_audience: t.audience,
        p_target_player_id: playerId,
      };
      if (t.audience === 'team' && t.teamId) params.p_team_id = t.teamId;

      const { error } = await supabase.rpc('post_to_wall', params);
      if (error) { failed.push(`${t.label}: ${error.message}`); continue; }
      posted.push(t.label);
      newDests.push(t.dest);
    }

    // Optimistic badges for everything that posted — no full reload. loadReels/
    // loadGames read all kinds back, so badges survive a refresh.
    if (newDests.length > 0) addDestinations(item.contentId, newDests);

    // Summarize what landed.
    if (failed.length === 0) {
      Alert.alert('Posted', `Posted to ${kidName}'s wall: ${posted.join(', ')}.`);
    } else if (posted.length === 0) {
      Alert.alert('Error', `Nothing posted.\n${failed.join('\n')}`);
    } else {
      Alert.alert('Partly posted', `Posted: ${posted.join(', ')}.\nFailed:\n${failed.join('\n')}`);
    }
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

  function renderBadges(destinations: Destination[]) {
    if (destinations.length === 0) {
      return (
        <View style={[styles.badge, styles.badgeLock]}>
          <Ionicons name="lock-closed" size={11} color="#888" />
          <Text style={styles.badgeLockText}>Only you</Text>
        </View>
      );
    }
    return destinations.map((d, i) => {
      if (d.kind === 'public') {
        return (
          <View key={`pub-${i}`} style={[styles.badge, styles.badgePublic]}>
            <Ionicons name="globe-outline" size={11} color="#fff" />
            <Text style={styles.badgeText}>Public</Text>
          </View>
        );
      }
      if (d.kind === 'coaches') {
        return (
          <View key={`co-${i}`} style={[styles.badge, styles.badgeCoaches]}>
            <Ionicons name="clipboard-outline" size={11} color="#fff" />
            <Text style={styles.badgeText}>Coaches</Text>
          </View>
        );
      }
      if (d.kind === 'player') {
        return (
          <View key={`player-${i}`} style={[styles.badge, styles.badgePlayer]}>
            <Ionicons name="lock-closed" size={11} color="#fff" />
            <Text style={styles.badgeText} numberOfLines={1}>On {d.kidName}’s wall</Text>
          </View>
        );
      }
      return (
        <View key={`team-${i}`} style={[styles.badge, styles.badgeTeam]}>
          <Ionicons name="people" size={11} color="#fff" />
          <Text style={styles.badgeText} numberOfLines={1}>{d.teamName}</Text>
        </View>
      );
    });
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/export')} style={styles.makeReelBtn}>
          <Text style={styles.makeReelText}>＋ Make a reel</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>Film Room</Text>
      <Text style={styles.subtitle}>Your workbench. Everything you’ve made — games and reels. Tap “Share” to post to a wall, “Manage sharing” to change where it lives.</Text>

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
          <ActivityIndicator size="large" color="#534AB7" />
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
                  <TouchableOpacity
                    key={v.id}
                    style={styles.looseCard}
                    onLongPress={() => confirmDeleteVideo(v)}
                    onPress={() => Alert.alert(v.label, undefined, [
                      { text: 'Tag Video', onPress: () => router.push({ pathname: '/tagging-overlay', params: { videoId: v.id, url: v.url, label: v.label, personal: '1' } }) },
                      { text: 'View Clips', onPress: () => router.push({ pathname: '/clips', params: { videoId: v.id, label: v.label } }) },
                      { text: 'Cancel', style: 'cancel' },
                    ])}
                  >
                    <View style={styles.looseThumb}><Ionicons name="videocam-outline" size={22} color="#888" /></View>
                    <View style={styles.cardBody}>
                      <Text style={styles.cardTitle} numberOfLines={1}>{v.label}</Text>
                      <Text style={styles.cardMeta}>Not on a game yet</Text>
                    </View>
                    <Ionicons name="pricetag-outline" size={18} color="#534AB7" />
                  </TouchableOpacity>
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
                  <View key={`reel:${reel.id}`} style={styles.card}>
                    <TouchableOpacity
                      style={styles.thumb}
                      onPress={() => openReel(reel)}
                      onLongPress={() => Alert.alert(reel.name, undefined, [
                        { text: 'Edit reel', onPress: () => router.push({ pathname: '/edit-reel', params: { id: reel.id } }) },
                        { text: 'Delete reel', style: 'destructive', onPress: () => confirmDelete(reel) },
                        { text: 'Cancel', style: 'cancel' },
                      ])}
                    >
                      <Ionicons name="film-outline" size={30} color="#666" />
                    </TouchableOpacity>

                    <View style={styles.cardBody}>
                      <View style={styles.typeBadgeWrap}><ContentTypeBadge type="reel" /></View>
                      {renamingId === reel.id ? (
                        <TextInput
                          style={styles.cardTitleInput}
                          value={draftName}
                          onChangeText={setDraftName}
                          autoFocus
                          selectTextOnFocus
                          returnKeyType="done"
                          onSubmitEditing={() => commitRename(reel)}
                          onBlur={() => commitRename(reel)}
                        />
                      ) : (
                        <TouchableOpacity onPress={() => startRename(reel)}>
                          <Text style={styles.cardTitle} numberOfLines={1}>{reel.name}</Text>
                        </TouchableOpacity>
                      )}

                      <TouchableOpacity onPress={() => openReel(reel)} activeOpacity={0.7}>
                        <Text style={styles.cardMeta} numberOfLines={1}>
                          {formatDuration(reel.durationSeconds)} · {new Date(reel.createdAt).toLocaleDateString()}
                        </Text>
                      </TouchableOpacity>

                      <View style={styles.badgeRow}>{renderBadges(reel.destinations)}</View>

                      <View style={styles.actions}>
                        <TouchableOpacity style={styles.postBtn} onPress={() => {
                          const item: Postable = { contentType: 'reel', contentId: reel.id, title: reel.name };
                          reel.destinations.length ? manageSharing(item, reel.destinations) : confirmPostToWall(item);
                        }}>
                          <Text style={styles.postBtnText}>{reel.destinations.length ? 'Manage sharing' : 'Share'}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.trashBtn} onPress={() => downloadReel(reel)} disabled={downloadingId === reel.id}>
                          {downloadingId === reel.id
                            ? <ActivityIndicator size="small" color="#4a90d9" />
                            : <Ionicons name="download-outline" size={18} color="#4a90d9" />}
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.trashBtn} onPress={() => confirmDelete(reel)}>
                          <Ionicons name="trash-outline" size={18} color="#a55" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                );
              }
              if (fi.contentType === 'game') {
                const game = gamesById.get(fi.id);
                if (!game) return null;
                const expanded = expandedGameId === game.id;
                const done = gameIsDone(game);
                const dateStr = formatGameDate(game.gameDate);
                const videoCount = `${game.videos.length} video${game.videos.length === 1 ? '' : 's'}`;
                return (
                  <View key={`game:${game.id}`} style={[styles.card, styles.gameCard, done && styles.gameCardDone]}>
                    <TouchableOpacity
                      style={styles.gameHeader}
                      onPress={() => setExpandedGameId(expanded ? null : game.id)}
                      onLongPress={() => Alert.alert(game.title, undefined, [
                        { text: 'Edit game', onPress: () => router.push({ pathname: '/edit-game', params: { id: game.id } }) },
                        { text: 'Delete game', style: 'destructive', onPress: () => confirmDeleteGame(game) },
                        { text: 'Cancel', style: 'cancel' },
                      ])}
                      activeOpacity={0.7}
                    >
                      <View style={styles.gameThumb}>
                        <Ionicons name="basketball" size={24} color="#C8742B" />
                      </View>
                      <View style={styles.cardBody}>
                        <View style={styles.typeBadgeWrap}>
                          <ContentTypeBadge type="game" outlineColor={gameStatusColor(game)} />
                        </View>
                        <Text style={styles.cardTitle} numberOfLines={1}>{game.title}</Text>
                        <Text style={styles.cardMeta} numberOfLines={1}>
                          {dateStr ? `${dateStr} · ${videoCount}` : videoCount}
                        </Text>
                      </View>
                      <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={20} color="#888" />
                    </TouchableOpacity>
                    <View style={[styles.badgeRow, { marginTop: 10 }]}>{renderBadges(game.destinations)}</View>
                    <View style={styles.actions}>
                      <TouchableOpacity
                        style={[styles.gamePostBtn, { flex: 1 }]}
                        onPress={() => {
                          const item: Postable = { contentType: 'game', contentId: game.id, title: game.title };
                          game.destinations.length ? manageSharing(item, game.destinations) : confirmPostToWall(item);
                        }}
                      >
                        <Text style={styles.postBtnText}>{game.destinations.length ? 'Manage sharing' : 'Share'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.trashBtn} onPress={() => downloadGame(game)} disabled={downloadingId === game.id}>
                        {downloadingId === game.id
                          ? <ActivityIndicator size="small" color="#4a90d9" />
                          : <Ionicons name="download-outline" size={18} color="#4a90d9" />}
                      </TouchableOpacity>
                    </View>
                    {expanded && (
                      <View style={styles.videoList}>
                        {game.videos.length === 0 ? (
                          <Text style={styles.videoRowEmpty}>No videos uploaded yet.</Text>
                        ) : (
                          game.videos.map(v => (
                            <View key={v.id} style={styles.videoRow}>
                              {/* Tap the circle or "Tagged" to toggle this video's
                                  tagging-complete. When every video is checked, the
                                  game card face turns green. */}
                              <TouchableOpacity style={styles.videoCheck} onPress={() => toggleVideoComplete(v)} hitSlop={8}>
                                <Ionicons
                                  name={v.taggingComplete ? 'checkmark-circle' : 'ellipse-outline'}
                                  size={22}
                                  color={v.taggingComplete ? TAG_STATUS.done : '#666'}
                                />
                                <Text style={[styles.videoCheckLabel, v.taggingComplete && styles.videoCheckLabelDone]}>Tagged</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={styles.videoOptionsCell}
                                activeOpacity={0.7}
                                onLongPress={() => confirmDeleteVideo(v)}
                                onPress={() => Alert.alert(v.label, undefined, [
                                  { text: 'Tag video', onPress: () => router.push({ pathname: '/tagging-overlay', params: { videoId: v.id, url: v.url, label: v.label } }) },
                                  // Watch game: same player, view-only. `watch: '1'` suppresses all tag
                                  // chrome in tagging-overlay — no new player, no divergent playback.
                                  { text: 'Watch game', onPress: () => router.push({ pathname: '/tagging-overlay', params: { videoId: v.id, url: v.url, label: v.label, watch: '1' } }) },
                                  { text: 'View clips', onPress: () => router.push({ pathname: '/clips', params: { videoId: v.id, label: v.label } }) },
                                  { text: 'Cancel', style: 'cancel' },
                                ])}
                              >
                                <Ionicons name="film-outline" size={18} color="#888" />
                                <View style={styles.videoOptBody}>
                                  <Text style={styles.videoOptTitle} numberOfLines={1}>{v.label}</Text>
                                  <Text style={styles.videoOptHint}>Tap for options • Hold to delete</Text>
                                </View>
                                <Ionicons name="ellipsis-horizontal" size={18} color="#888" />
                              </TouchableOpacity>
                            </View>
                          ))
                        )}
                        {/* Add-video is safe: game.tsx sources team_id from the game's own row, not the active team. */}
                        <TouchableOpacity
                          style={styles.gameAddBtn}
                          onPress={() => router.push({ pathname: '/game', params: { id: game.id, title: game.title } })}
                        >
                          <Text style={styles.gameAddText}>＋ Add video</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              }
              return null;
            })}
          </ScrollView>
        )}
      </View>

      {pickerReel && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setPickerReel(null)}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setPickerReel(null)}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <Text style={styles.sheetTitle}>Post to wall</Text>
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
                        <Text style={styles.sheetRowText}>{p.name}</Text>
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
              <Text style={styles.sheetTitle}>Post to wall</Text>
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

      {pendingPost && (
        <VisibilityPicker
          teams={userTeams.map(t => ({ id: t.team_id, name: t.name }))}
          onSelect={handleVisibilitySelect}
          onCancel={() => setPendingPost(null)}
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
  videoOptHint: { color: '#888', fontSize: 11, marginTop: 1 },
  gamePostBtn: { alignSelf: 'flex-start', backgroundColor: '#534AB7', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, marginTop: 10 },
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

  // Grouped "Post to wall" player-picker bottom sheet (mirrors VisibilityPicker).
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

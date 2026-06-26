import { COACH_ROLES, useTeamContext } from '@/context';
import { supabase } from '@/supabase';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type DropdownOption } from './components/Dropdown';
import FilterBar, { type FilterableItem } from './components/FilterBar';
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

type Destination =
  | { kind: 'public' }
  | { kind: 'team'; teamName: string }
  | { kind: 'coaches' }
  | { kind: 'player'; kidName: string };

type Reel = {
  id: string;
  name: string;
  storagePath: string | null;
  durationSeconds: number | null;
  createdAt: string;
  destinations: Destination[];
};

// Filter-bar options for My Work. Single-entry teamOptions hides the Team
// dropdown (reels carry no team); single-entry typeOptions keeps the Type
// dropdown visible but constrained — reels-only feed today.
const MY_WORK_TEAM_OPTIONS: DropdownOption[] = [{ value: 'all', label: 'All reels' }];
const MY_WORK_TYPE_OPTIONS: DropdownOption[] = [{ value: 'all', label: 'All' }];
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
  const [loading, setLoading] = useState(true);
  // Filtered+sorted items, produced by FilterBar (a FilterableItem subset; the
  // full Reel is recovered via reelsById for the card render).
  const [visibleReels, setVisibleReels] = useState<FilterableItem[]>([]);
  // Batch-loaded tag data for the reel feed: each reel's tag set + tag metadata.
  const [tagsById, setTagsById] = useState<Map<string, Set<string>>>(new Map());
  const [tagMeta, setTagMeta] = useState<Map<string, { name: string; category: string }>>(new Map());

  // Inline rename state: which reel is being renamed + the working draft.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  // Post-to-wall picker state: which reel + kid the user chose in the Alert,
  // held while VisibilityPicker collects the tier. null = picker hidden.
  const [pendingPost, setPendingPost] = useState<{ reel: Reel; playerId: string; kidName: string } | null>(null);

  // Players on teams the user coaches (loaded below) — candidates for the
  // post-to-wall picker beyond the user's own kids.
  const [coachedPlayers, setCoachedPlayers] = useState<{ player_id: string; name: string; team_id: string }[]>([]);
  // Which reel's grouped player-picker sheet is open. null = sheet hidden.
  const [pickerReel, setPickerReel] = useState<Reel | null>(null);

  // Destination picker state. tierReel drives the top-level chooser (Your Kids /
  // Your Teams / Coaches' Corner). teamWallReel / coachesReel drive the team
  // sub-pickers; teamWallChoice holds the chosen team while the user picks
  // Team-only vs Public for a team-wall post.
  const [tierReel, setTierReel] = useState<Reel | null>(null);
  const [teamWallReel, setTeamWallReel] = useState<Reel | null>(null);
  const [coachesReel, setCoachesReel] = useState<Reel | null>(null);
  const [teamWallChoice, setTeamWallChoice] = useState<{ reel: Reel; teamId: string; teamName: string } | null>(null);

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
          if (!list.some(d => d.kind === 'team' && d.teamName === teamName)) {
            list.push({ kind: 'team', teamName });
          }
        } else if (s.audience === 'coaches') {
          if (!list.some(d => d.kind === 'coaches')) list.push({ kind: 'coaches' });
        } else if (s.audience === 'player') {
          // A 'player' post lands on the kid's own wall (family-only).
          const kidName = kidNameById.get(s.target_player_id) ?? 'Kid';
          if (!list.some(d => d.kind === 'player' && d.kidName === kidName)) {
            list.push({ kind: 'player', kidName });
          }
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

  useEffect(() => {
    loadReels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Batch-load tags for the reel feed whenever reels change. ONE .in() query on
  // reel_tags, then ONE on tags for names/categories. No N+1. Mirrors the reel
  // branch of coaches-corner.tsx's tag batch-load — reels-only here.
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
  }, [reels]);

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

  // Map reels → FilterableItem for FilterBar. id is the reel id (unique).
  // teamId/teamName are empty — reels carry no team (no highlight_reels.team_id),
  // and MY_WORK_TEAM_OPTIONS is single-entry so the Team dropdown is hidden.
  // reelsById recovers the full Reel for the card render.
  const items = useMemo<FilterableItem[]>(
    () => reels.map(r => ({
      id: r.id, teamId: '', teamName: '',
      contentType: 'reel', title: r.name, createdAt: r.createdAt,
      durationSeconds: r.durationSeconds,
    })),
    [reels],
  );
  const reelsById = useMemo(() => new Map(reels.map(r => [r.id, r])), [reels]);

  function formatDuration(seconds: number | null) {
    if (seconds == null) return '—';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
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
  function confirmPostToWall(reel: Reel) {
    const hasKids = pickerGroups.some(g => g.key === 'kids');
    const hasTeams = coachedTeams.length > 0;
    if (!hasKids && !hasTeams) {
      Alert.alert('Nothing to post to', 'Add a kid, or join a team as a coach, to post a reel.');
      return;
    }
    setTierReel(reel);
  }

  // Kid chosen in the Alert — defer posting and let VisibilityPicker collect
  // the tier (public / team / private) before any RPC fires.
  function postReelToKid(reel: Reel, playerId: string, kidName: string) {
    setPendingPost({ reel, playerId, kidName });
  }

  // Merge new destination badges onto a reel optimistically (dedup by kind; team
  // by name) so the card reflects the post without a reload — mirrors the
  // post-to-kid flow's optimistic update.
  function addReelDestinations(reelId: string, dests: Destination[]) {
    const keyOf = (d: Destination) =>
      d.kind === 'team' ? `team:${d.teamName}` : d.kind === 'player' ? `player:${d.kidName}` : d.kind;
    setReels(prev => prev.map(r => {
      if (r.id !== reelId) return r;
      const have = new Set(r.destinations.map(keyOf));
      const merged = [...r.destinations];
      for (const d of dests) {
        const k = keyOf(d);
        if (!have.has(k)) { have.add(k); merged.push(d); }
      }
      return { ...r, destinations: merged };
    }));
  }

  // Post a reel to a team WALL (player-less, coach-gated). "Public" ALSO posts a
  // separate public share — mirroring the kid flow's treatment of public vs team
  // as independent audiences (so a public team post is visible publicly AND on
  // the team wall).
  async function postTeamWall(choice: { reel: Reel; teamId: string; teamName: string }, alsoPublic: boolean) {
    const { reel, teamId, teamName } = choice;
    setTeamWallChoice(null);

    const { error: teamErr } = await supabase.rpc('post_to_wall', {
      p_content_type: 'reel',
      p_content_id: reel.id,
      p_audience: 'team',
      p_target_player_id: null,
      p_team_id: teamId,
    });
    if (teamErr) { Alert.alert('Error', teamErr.message); return; }

    const dests: Destination[] = [{ kind: 'team', teamName }];
    if (alsoPublic) {
      const { error: pubErr } = await supabase.rpc('post_to_wall', {
        p_content_type: 'reel',
        p_content_id: reel.id,
        p_audience: 'public',
        p_target_player_id: null,
        p_team_id: teamId,
      });
      if (pubErr) { Alert.alert('Error', pubErr.message); return; }
      dests.push({ kind: 'public' });
    }

    addReelDestinations(reel.id, dests);
    Alert.alert('Posted', alsoPublic ? `Posted to ${teamName} wall and public.` : `Posted to ${teamName} wall.`);
  }

  // Post a reel to a team's COACHES' board (player-less, coach-gated). No
  // visibility choice — selecting the team posts immediately.
  async function postCoachesBoard(reel: Reel, teamId: string, teamName: string) {
    setCoachesReel(null);
    const { error } = await supabase.rpc('post_to_wall', {
      p_content_type: 'reel',
      p_content_id: reel.id,
      p_audience: 'coaches',
      p_target_player_id: null,
      p_team_id: teamId,
    });
    if (error) { Alert.alert('Error', error.message); return; }
    addReelDestinations(reel.id, [{ kind: 'coaches' }]);
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
    const { reel, playerId, kidName } = pending;

    // Build the list of audiences to post, each with the badge it maps to.
    const targets: { audience: 'player' | 'public' | 'team'; teamId?: string; label: string; dest: Destination }[] = [];
    if (sel.friendsFamily) {
      targets.push({ audience: 'player', label: 'Friends & Family', dest: { kind: 'player', kidName } });
    }
    if (sel.public) {
      targets.push({ audience: 'public', label: 'Public', dest: { kind: 'public' } });
    }
    if (sel.teamWall && sel.teamId) {
      const teamName = sel.teamName ?? 'Team';
      targets.push({ audience: 'team', teamId: sel.teamId, label: `${teamName} wall`, dest: { kind: 'team', teamName } });
    }

    // Only-me (or an empty set) means no wall placement at all.
    if (targets.length === 0) {
      Alert.alert('Kept private', `“${reel.name}” stays visible only to you.`);
      return;
    }

    // Post each selected audience. One failure doesn't abort the rest.
    const posted: string[] = [];
    const failed: string[] = [];
    const newDests: Destination[] = [];
    for (const t of targets) {
      const params: Record<string, any> = {
        p_content_type: 'reel',
        p_content_id: reel.id,
        p_audience: t.audience,
        p_target_player_id: playerId,
      };
      if (t.audience === 'team' && t.teamId) params.p_team_id = t.teamId;

      const { error } = await supabase.rpc('post_to_wall', params);
      if (error) { failed.push(`${t.label}: ${error.message}`); continue; }
      posted.push(t.label);
      newDests.push(t.dest);
    }

    // Optimistic badges for everything that posted — no full reload. loadReels
    // reads all three kinds back, so badges survive a refresh. Dedup by kind
    // (team by name, player by kid).
    if (newDests.length > 0) {
      const key = (d: Destination) =>
        d.kind === 'team' ? `team:${d.teamName}` : d.kind === 'player' ? `player:${d.kidName}` : d.kind;
      setReels(prev => prev.map(r => {
        if (r.id !== reel.id) return r;
        const have = new Set(r.destinations.map(key));
        const add = newDests.filter(d => !have.has(key(d)));
        return add.length ? { ...r, destinations: [...r.destinations, ...add] } : r;
      }));
    }

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
            <Text style={styles.badgeText} numberOfLines={1}>On {d.kidName}'s wall</Text>
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
      </View>

      <Text style={styles.title}>My Work</Text>

      <FilterBar
        items={items}
        tagsById={tagsById}
        tagMeta={tagMeta}
        teamOptions={MY_WORK_TEAM_OPTIONS}
        typeOptions={MY_WORK_TYPE_OPTIONS}
        sortOptions={MY_WORK_SORT_OPTIONS}
        searchPlaceholder="Search reels"
        onVisibleChange={setVisibleReels}
      />

      <View style={[styles.content, visibleReels.length > 0 && styles.contentTop]}>
        {loading ? (
          <ActivityIndicator size="large" color="#534AB7" />
        ) : reels.length === 0 ? (
          <Text style={styles.empty}>No reels yet. Export a highlight to see it here.</Text>
        ) : visibleReels.length === 0 ? (
          <Text style={styles.empty}>No reels match your filters.</Text>
        ) : (
          <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
            {visibleReels.map(fi => {
              const reel = reelsById.get(fi.id);
              if (!reel) return null;
              return (
              <View key={reel.id} style={styles.card}>
                <TouchableOpacity style={styles.thumb} onPress={() => openReel(reel)}>
                  <Ionicons name="film-outline" size={30} color="#666" />
                </TouchableOpacity>

                <View style={styles.cardBody}>
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
                    <TouchableOpacity style={styles.postBtn} onPress={() => confirmPostToWall(reel)}>
                      <Text style={styles.postBtnText}>Post to wall</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.trashBtn} onPress={() => confirmDelete(reel)}>
                      <Ionicons name="trash-outline" size={18} color="#a55" />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
              );
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
                    onPress={() => { setTeamWallChoice({ reel: teamWallReel, teamId: t.team_id, teamName: t.name }); setTeamWallReel(null); }}
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
                <TouchableOpacity style={styles.sheetRow} onPress={() => postTeamWall(teamWallChoice, true)}>
                  <Text style={styles.sheetRowText}>Public</Text>
                </TouchableOpacity>
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
  title: { color: '#fff', fontSize: 26, fontWeight: '700', marginTop: 8, marginBottom: 16 },

  content: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  contentTop: { alignItems: 'stretch', justifyContent: 'flex-start' },
  empty: { color: '#555', fontSize: 15, textAlign: 'center', paddingHorizontal: 20 },
  list: { alignSelf: 'stretch' },

  card: {
    flexDirection: 'row', alignItems: 'stretch', gap: 12,
    backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, marginBottom: 10,
    borderWidth: 1, borderColor: '#333',
  },
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

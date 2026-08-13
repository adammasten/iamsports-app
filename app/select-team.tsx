import { useTeamContext } from '@/context';
import { TeamLogo } from '@/components/team-logo';
import { SkeletonCards } from '@/components/skeleton-cards';
import { DebugPanel } from '@/components/debug-panel';
import { loadContentFeed, type ContentFeedDebug, type FeedItem } from '@/lib/core/homeFeed';
import { getSignedVideoUrl } from '@/lib/native/video-url';
import { supabase } from '@/supabase';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, AppState, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ContentCard from '@/components/content-card/ContentCard';
import Dropdown, { type DropdownOption } from './components/Dropdown';
import FilterBar, { type FilterableItem } from './components/FilterBar';
import FadeRail from './components/FadeRail';
import WebTopNav from './components/WebTopNav';

// Type + Sort dropdowns for the home content feed's FilterBar (mirrors Film Room).
const TYPE_OPTIONS: DropdownOption[] = [
  { value: 'all', label: 'All' },
  { value: 'video', label: 'Videos' },
  { value: 'reel', label: 'Reels' },
];
const SORT_OPTIONS: DropdownOption[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'az', label: 'A–Z' },
  { value: 'longest', label: 'Longest' },
];
// Stable empty identities — the feed has no tag dropdowns yet, and a fresh Map
// each render would churn FilterBar's memos.
const EMPTY_TAG_IDS = new Map<string, Set<string>>();
const EMPTY_TAG_META = new Map<string, { name: string; category: string }>();

// Stable palette for team avatars (hashed by team id below).
const AVATAR_COLORS = ['#534AB7', '#1D9E75', '#D85A30', '#1A6FD4', '#7D3C98', '#C0392B'];

// Mirrors context.tsx's ROLE_RANK (not exported there). Used only to show the
// HIGHEST role per team in the rail. Keep in sync if the enum changes.
const ROLE_RANK: Record<string, number> = {
  admin: 6, head_coach: 5, coach: 4, parent: 3, player: 2, follower: 1,
};

export function teamColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// Initials for a kid avatar when there's no jersey number (and no photo yet).
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '🏀';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export default function SelectTeamScreen() {
  const insets = useSafeAreaInsets();
  const { userId, userTeams, userKids, setActiveTeam, refreshTeams, refreshKids } = useTeamContext();
  const [showNewTeam, setShowNewTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamSport, setNewTeamSport] = useState('Basketball');
  const [creating, setCreating] = useState(false);
  const [showNewKid, setShowNewKid] = useState(false);
  const [newKidName, setNewKidName] = useState('');
  const [creatingKid, setCreatingKid] = useState(false);
  // player_id -> signed photo URL, minted from each kid's photo_path.
  const [kidPhotoUris, setKidPhotoUris] = useState<Record<string, string>>({});
  // Unseen-notification count for the header bell badge. Refetched on focus (clears
  // after returning from the notifications list, which marks seen), then kept live
  // WHILE sitting on this screen via a light 30s poll + a refetch when the app
  // returns to the foreground — so a bell that arrives mid-session shows up without
  // leaving and coming back. (v1: polling, not realtime — no extra infra.)
  const [unseenNotif, setUnseenNotif] = useState(0);
  const refreshUnseen = useCallback(() => {
    supabase.rpc('notifications_unseen_count').then(({ data }) => setUnseenNotif((data as number) ?? 0));
  }, []);
  useFocusEffect(useCallback(() => {
    refreshUnseen();
    const poll = setInterval(refreshUnseen, 30000);
    const sub = AppState.addEventListener('change', s => { if (s === 'active') refreshUnseen(); });
    return () => { clearInterval(poll); sub.remove(); };
  }, [refreshUnseen]));

  // Home content feed: newest games (quarters collapsed to one card), loose
  // videos + reels across ALL my teams + kids, deduped in @/lib/core/homeFeed.
  // `visible` is FilterBar's output (Team/Type/Sort/Event/Season/Tournament); the
  // Player lens is a separate dropdown (a card can be on several kids' walls).
  const [items, setItems] = useState<FeedItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedDebug, setFeedDebug] = useState<ContentFeedDebug | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState('all');
  const [visible, setVisible] = useState<FilterableItem[]>([]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setFeedLoading(true);
      const { items: it, debug } = await loadContentFeed(userId, userTeams, userKids);
      if (cancelled) return;
      setItems(it);
      setFeedDebug(debug);
      setFeedLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId, userTeams, userKids]);

  // Team name lookup for cards + the FilterBar Team dropdown.
  const teamNameById = useMemo(() => {
    const m = new Map<string, string>();
    userTeams.forEach(t => { if (!m.has(t.team_id)) m.set(t.team_id, t.name); });
    return m;
  }, [userTeams]);
  const teamOptions = useMemo<DropdownOption[]>(
    () => [{ value: 'all', label: 'All teams' }, ...[...teamNameById].map(([value, label]) => ({ value, label }))],
    [teamNameById],
  );

  // Player lens — always lists my kids. "All players" shows everything; picking a
  // kid narrows to content on THAT kid's wall (player-share) or attributed to
  // them (player_id). Multi-value, so it lives outside FilterBar's single-value row.
  const playerOptions = useMemo<DropdownOption[]>(
    () => [{ value: 'all', label: 'All players' }, ...userKids.map(k => ({ value: k.player_id, label: k.name }))],
    [userKids],
  );
  const scopedItems = useMemo(
    () => selectedPlayer === 'all' ? items : items.filter(it => it.kidPlayerIds.includes(selectedPlayer)),
    [items, selectedPlayer],
  );

  // Event / Season / Tournament dropdowns, built from what's present across the
  // player-scoped items (Event & Season need 2+ to partition; Tournament with 1).
  const extraFilters = useMemo(() => {
    const out: { key: string; label: string; options: DropdownOption[] }[] = [];
    // Year — the load-bearing axis for a multi-year archive. Derived from each
    // item's date so it spans games, reels, and loose footage alike. Only shown
    // once content spans 2+ years.
    const years = new Set(scopedItems.map(it => new Date(it.createdAt).getFullYear().toString()));
    if (years.size >= 2) {
      out.push({ key: 'year', label: 'Year', options: [{ value: 'all', label: 'All years' }, ...[...years].sort().reverse().map(y => ({ value: y, label: y }))] });
    }
    const events = new Set(scopedItems.map(it => it.eventType).filter(Boolean) as string[]);
    if (events.size >= 2) {
      out.push({ key: 'eventType', label: 'Event', options: [{ value: 'all', label: 'All events' }, ...[...events].map(v => ({ value: v, label: v }))] });
    }
    const seasons = new Map<string, string>();
    scopedItems.forEach(it => { if (it.seasonId) seasons.set(it.seasonId, it.seasonName ?? 'Season'); });
    if (seasons.size >= 2) {
      out.push({ key: 'seasonId', label: 'Season', options: [{ value: 'all', label: 'All seasons' }, ...[...seasons].map(([value, label]) => ({ value, label }))] });
    }
    const tours = new Map<string, string>();
    scopedItems.forEach(it => { if (it.tournamentId) tours.set(it.tournamentId, it.tournamentName ?? 'Tournament'); });
    if (tours.size >= 1) {
      out.push({ key: 'tournamentId', label: 'Tournament', options: [{ value: 'all', label: 'All' }, ...[...tours].map(([value, label]) => ({ value, label }))] });
    }
    return out;
  }, [scopedItems]);

  // Player-scoped items → FilterableItem for FilterBar. game/loose-video → 'video'
  // for the Type filter; reels → 'reel'. itemsByKey recovers the row on tap.
  const filterItems = useMemo<FilterableItem[]>(
    () => scopedItems.map(it => ({
      id: it.key, teamId: it.teamId, teamName: teamNameById.get(it.teamId) ?? '',
      contentType: it.kind === 'reel' ? 'reel' : 'video',
      title: it.title, createdAt: it.createdAt, durationSeconds: it.durationSeconds,
      extra: { year: new Date(it.createdAt).getFullYear().toString(), eventType: it.eventType ?? '', seasonId: it.seasonId ?? '', tournamentId: it.tournamentId ?? '' },
    })),
    [scopedItems, teamNameById],
  );
  const itemsByKey = useMemo(() => new Map(items.map(it => [it.key, it])), [items]);

  // Open a feed card → play through the entitlement-gated shared-viewer (which
  // signs via sign-media). A game plays its newest video; reels play whole.
  function openItem(fi: FilterableItem) {
    const it = itemsByKey.get(fi.id);
    if (!it) return;
    // A game → the plays-through game-player (same player as the Film Room). Reels/
    // single videos → the single-video shared-viewer.
    if (it.kind === 'game') { router.push({ pathname: '/game-player', params: { id: it.contentId, title: it.title } }); return; }
    if (!it.storagePath) { Alert.alert('Unavailable', 'This content could not be loaded.'); return; }
    router.push({ pathname: '/shared-viewer', params: { title: it.title, storagePath: it.storagePath } });
  }

  // One entry per team, keeping the HIGHEST-ranked role (a user can hold several
  // roles on one team — UNIQUE key is (team_id, user_id, role)).
  const teamMap = new Map<string, (typeof userTeams)[number]>();
  for (const t of userTeams) {
    const existing = teamMap.get(t.team_id);
    if (!existing || (ROLE_RANK[t.role] ?? 0) > (ROLE_RANK[existing.role] ?? 0)) {
      teamMap.set(t.team_id, t);
    }
  }
  const uniqueTeams = Array.from(teamMap.values());

  async function createTeam() {
    if (!newTeamName.trim()) { Alert.alert('Enter a team name'); return; }
    if (!newTeamSport.trim()) { Alert.alert('Enter a sport'); return; }
    if (!userId) { Alert.alert('Not signed in'); return; }
    setCreating(true);

    const { data: team, error: teamError } = await supabase
      .from('teams')
      .insert({ name: newTeamName.trim(), sport: newTeamSport.trim(), created_by_user_id: userId })
      .select()
      .single();
    if (teamError || !team) {
      Alert.alert('Error creating team', teamError?.message ?? 'unknown');
      setCreating(false);
      return;
    }

    // Two-step write: if the membership insert fails, best-effort delete the
    // just-created team to avoid an orphan. (Long-term fix: a DB trigger that
    // creates the admin membership atomically on team insert.)
    const { error: memberError } = await supabase
      .from('team_memberships')
      .insert({ team_id: team.id, user_id: userId, role: 'admin', status: 'confirmed' });
    if (memberError) {
      await supabase.from('teams').delete().eq('id', team.id);
      Alert.alert('Error joining team', memberError.message);
      setCreating(false);
      return;
    }

    // New teams need a join code — the original code migration only backfilled
    // teams that existed then; creation doesn't set one and there's no trigger.
    // Best-effort (coach membership above satisfies the RPC's is_team_coach gate);
    // the roster's "Generate join code" button covers a miss.
    await supabase.rpc('regenerate_team_code', { p_team_id: team.id }).then(() => {}, () => {});

    await refreshTeams();
    setActiveTeam(team.id);
    setNewTeamName('');
    setShowNewTeam(false);
    setCreating(false);
    router.replace('/');
  }

  function selectTeam(teamId: string) {
    setActiveTeam(teamId);
    router.replace('/');
  }

  // Mint signed URLs for kids that have a photo. Re-runs when userKids changes
  // (e.g. after refreshKids); signed URLs are short-lived so re-minting is fine.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const withPhotos = userKids.filter(k => k.photo_path);
      if (withPhotos.length === 0) { setKidPhotoUris({}); return; }
      const entries = await Promise.all(
        withPhotos.map(async k => [k.player_id, await getSignedVideoUrl(k.photo_path as string)] as const)
      );
      if (cancelled) return;
      const map: Record<string, string> = {};
      for (const [id, url] of entries) { if (url) map[id] = url; }
      setKidPhotoUris(map);
    })();
    return () => { cancelled = true; };
  }, [userKids]);

  // Add a kid via the create_kid RPC (SECURITY DEFINER) — it creates a teamless
  // player and links the current user as 'parent' atomically, bypassing the
  // teamless-insert RLS. Stays on home; refreshKids() updates the rail in place.
  async function addKid() {
    if (!newKidName.trim()) { Alert.alert("Enter the kid's name"); return; }
    if (!userId) { Alert.alert('Not signed in'); return; }
    setCreatingKid(true);
    const { error } = await supabase.rpc('create_kid', { name: newKidName.trim() });
    if (error) {
      Alert.alert('Error adding kid', error.message);
      setCreatingKid(false);
      return;
    }
    await refreshKids();
    setNewKidName('');
    setShowNewKid(false);
    setCreatingKid(false);
  }

  // Create-team form (unchanged logic, dark-themed).
  if (showNewTeam) {
    return (
      <View style={[styles.formScreen, { paddingTop: insets.top + 20 }]}>
        <Text style={styles.formTitle}>New team</Text>
        <TextInput
          style={styles.input}
          placeholder="Team name (e.g. Travel Team)"
          placeholderTextColor="#888"
          value={newTeamName}
          onChangeText={setNewTeamName}
          autoFocus
          editable={!creating}
        />
        <TextInput
          style={styles.input}
          placeholder="Sport (e.g. Basketball)"
          placeholderTextColor="#888"
          value={newTeamSport}
          onChangeText={setNewTeamSport}
          editable={!creating}
        />
        <TouchableOpacity style={styles.saveBtn} onPress={createTeam} disabled={creating}>
          <Text style={styles.saveBtnText}>{creating ? 'Creating…' : 'Create Team'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowNewTeam(false)} disabled={creating}>
          <Text style={styles.cancel}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Add-kid form (mirrors the create-team form).
  if (showNewKid) {
    return (
      <View style={[styles.formScreen, { paddingTop: insets.top + 20 }]}>
        <Text style={styles.formTitle}>Add kid</Text>
        <TextInput
          style={styles.input}
          placeholder="Kid's name"
          placeholderTextColor="#888"
          value={newKidName}
          onChangeText={setNewKidName}
          autoFocus
          editable={!creatingKid}
        />
        <TouchableOpacity style={styles.saveBtn} onPress={addKid} disabled={creatingKid}>
          <Text style={styles.saveBtnText}>{creatingKid ? 'Adding…' : 'Add kid'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowNewKid(false)} disabled={creatingKid}>
          <Text style={styles.cancel}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header — WEB gets a top nav bar; native keeps the phone header. */}
      {Platform.OS === 'web' ? (
        <WebTopNav active="home" unseenNotif={unseenNotif} />
      ) : (
        <View style={styles.header}>
          <Text style={styles.brand}>🏀 IamSports</Text>
          <View style={styles.headerIcons}>
            <TouchableOpacity style={styles.iconBtn} onPress={() => router.push('/search')}>
              <Ionicons name="search-outline" size={22} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={() => router.push('/notifications')}>
              <Ionicons name="notifications-outline" size={22} color="#fff" />
              {unseenNotif > 0 && (
                <View style={styles.notifBadge}>
                  <Text style={styles.notifBadgeText}>{unseenNotif > 99 ? '99+' : unseenNotif}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Your kids — always shown so "+ Add kid" is reachable even with zero
            kids (mirrors the teams rail's "+ New team"). */}
        <Text style={styles.sectionLabel}>Your kids</Text>
        <FadeRail contentContainerStyle={styles.rail} fadeColor="#000000">
          {userKids.map(kid => (
            <TouchableOpacity
              key={kid.player_id}
              style={styles.teamItem}
              onPress={() => router.push({ pathname: '/kid', params: { playerId: kid.player_id } })}
            >
              {kidPhotoUris[kid.player_id] ? (
                <Image source={{ uri: kidPhotoUris[kid.player_id] }} style={styles.avatarImage} contentFit="cover" cachePolicy="memory-disk" transition={120} />
              ) : (
                <View style={[styles.avatar, { backgroundColor: teamColor(kid.player_id) }]}>
                  <Text style={styles.avatarText}>
                    {kid.jersey_number ? kid.jersey_number : initials(kid.name)}
                  </Text>
                </View>
              )}
              <Text style={styles.teamName} numberOfLines={2}>{kid.name}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.teamItem} onPress={() => setShowNewKid(true)}>
            <View style={[styles.avatar, styles.avatarAdd]}>
              <Ionicons name="add" size={28} color="#534AB7" />
            </View>
            <Text style={styles.teamName}>Add kid</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.teamItem} onPress={() => router.push('/claim-kid')}>
            <View style={[styles.avatar, styles.avatarAdd]}>
              <Ionicons name="key-outline" size={24} color="#534AB7" />
            </View>
            <Text style={styles.teamName}>Have a code?</Text>
          </TouchableOpacity>
        </FadeRail>

        <Text style={styles.sectionLabel}>Your teams</Text>

        {/* Team rail */}
        <FadeRail contentContainerStyle={styles.rail} fadeColor="#000000">
          {uniqueTeams.map(team => (
            <TouchableOpacity
              key={team.team_id}
              style={styles.teamItem}
              onPress={() => selectTeam(team.team_id)}
            >
              {team.logo_path ? (
                <View style={{ marginBottom: 6 }}>
                  <TeamLogo logoPath={team.logo_path} name={team.name} size={60} />
                </View>
              ) : (
                <View style={[styles.avatar, { backgroundColor: teamColor(team.team_id) }]}>
                  <Text style={styles.avatarText}>
                    {team.name.trim().charAt(0).toUpperCase() || '🏀'}
                  </Text>
                </View>
              )}
              <Text style={styles.teamName} numberOfLines={2}>{team.name}</Text>
              <Text style={styles.teamRole}>{team.role}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.teamItem} onPress={() => setShowNewTeam(true)}>
            <View style={[styles.avatar, styles.avatarAdd]}>
              <Ionicons name="add" size={28} color="#534AB7" />
            </View>
            <Text style={styles.teamName}>New team</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.teamItem} onPress={() => router.push('/join-team')}>
            <View style={[styles.avatar, styles.avatarAdd]}>
              <Ionicons name="enter-outline" size={26} color="#534AB7" />
            </View>
            <Text style={styles.teamName}>Join team</Text>
          </TouchableOpacity>
        </FadeRail>

        {/* Player lens (multi-value) sits above the single-select FilterBar. */}
        <View style={styles.filterWrap}>
          {userKids.length > 0 && (
            <View style={styles.playerRow}>
              <Dropdown value={selectedPlayer} options={playerOptions} onSelect={setSelectedPlayer} placeholder="Player" />
            </View>
          )}
          <FilterBar
            items={filterItems}
            tagsById={EMPTY_TAG_IDS}
            tagMeta={EMPTY_TAG_META}
            teamOptions={teamOptions}
            typeOptions={TYPE_OPTIONS}
            sortOptions={SORT_OPTIONS}
            extraFilters={extraFilters}
            searchPlaceholder="Search videos & reels"
            onVisibleChange={setVisible}
          />
        </View>

        {/* Home content feed — newest games (deduped), videos + reels across every
            team + kid, RLS-scoped (@/lib/core/homeFeed). Tapping a team above
            still opens that team's page; this feed shows everything on open. */}
        {/* Surface load errors instead of silently showing an empty feed. */}
        {feedDebug && (feedDebug.videoErr || feedDebug.reelErr || feedDebug.kidShareErr) ? (
          <Text style={styles.feedError}>Couldn’t load everything: {feedDebug.videoErr || feedDebug.reelErr || feedDebug.kidShareErr}</Text>
        ) : null}

        {feedDebug ? (
          <DebugPanel
            title="SCREEN: select-team.tsx (app-home)"
            lines={[
              `userTeams ${userTeams.length} · userKids ${userKids.length}`,
              `games+loose: ${feedDebug.videoRows}${feedDebug.videoErr ? `  ⛔ ${feedDebug.videoErr}` : ''}`,
              `reels: ${feedDebug.reelRows}${feedDebug.reelErr ? `  ⛔ ${feedDebug.reelErr}` : ''}`,
              `kid-wall shares: ${feedDebug.kidShareRows}${feedDebug.kidShareErr ? `  ⛔ ${feedDebug.kidShareErr}` : ''}`,
              `player ${selectedPlayer === 'all' ? 'All' : (playerOptions.find(o => o.value === selectedPlayer)?.label ?? '?')} · visible ${visible.length}`,
            ]}
          />
        ) : null}

        {feedLoading ? (
          <SkeletonCards />
        ) : visible.length === 0 ? (
          <View style={styles.feedPlaceholder}>
            <Text style={styles.feedPlaceholderText}>
              Nothing here yet.{'\n'}Videos and reels from your teams and kids show up here.
            </Text>
          </View>
        ) : (
          <View style={styles.feed}>
            {visible.map(fi => {
              const it = itemsByKey.get(fi.id);
              const isReel = (it?.kind ?? 'video') === 'reel';
              const d = new Date(fi.createdAt).toLocaleDateString();
              const dur = it?.durationSeconds ? `${Math.floor(it.durationSeconds / 60)}:${String(Math.floor(it.durationSeconds % 60)).padStart(2, '0')}` : null;
              const meta = isReel ? [dur, d].filter(Boolean).join(' · ') : (fi.teamName ? `${fi.teamName} · ${d}` : d);
              const typeLabel = isReel ? 'Reel' : (it?.eventType ? it.eventType.charAt(0).toUpperCase() + it.eventType.slice(1) : 'Video');
              return (
                <ContentCard
                  key={`${fi.contentType}:${fi.id}`}
                  content={{ id: fi.id, kind: isReel ? 'reel' : 'game', title: fi.title, meta, typeLabel, thumbnailKey: it?.thumbnailPath ?? null }}
                  onOpen={() => openItem(fi)}
                  showPlayOnThumb
                  onPlay={() => openItem(fi)}
                />
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Bottom nav — native only; web uses the top nav above. */}
      {Platform.OS !== 'web' ? (
      <View style={[styles.bottomNav, { paddingBottom: insets.bottom + 8 }]}>
        <TouchableOpacity style={styles.navItem}>
          <Ionicons name="home" size={24} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => router.push('/search')}>
          <Ionicons name="search" size={24} color="#888" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.navCenter} onPress={() => router.push('/upload')}>
          <Ionicons name="add" size={30} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => router.push('/my-work')}>
          <Ionicons name="folder-outline" size={24} color="#888" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => router.push('/coaches-corner')}>
          <Ionicons name="clipboard-outline" size={24} color="#888" />
        </TouchableOpacity>
      </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 12,
  },
  brand: { fontSize: 22, fontWeight: '700', color: '#fff' },
  headerIcons: { flexDirection: 'row', gap: 4 },
  iconBtn: { padding: 6 },
  notifBadge: {
    position: 'absolute', top: 0, right: 0, minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: '#EF5350', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  notifBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },

  body: { paddingHorizontal: 20, paddingBottom: 24 },
  sectionLabel: {
    color: '#aaa', fontSize: 13, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8, marginBottom: 14,
  },

  rail: { gap: 16, paddingRight: 8 },
  teamItem: { alignItems: 'center', width: 96 },
  avatar: {
    width: 60, height: 60, borderRadius: 30,
    alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  avatarImage: { width: 60, height: 60, borderRadius: 30, marginBottom: 6, backgroundColor: '#1a1a1a' },
  avatarText: { color: '#fff', fontSize: 24, fontWeight: '700' },
  avatarAdd: { backgroundColor: 'transparent', borderWidth: 2, borderColor: '#534AB7', borderStyle: 'dashed' },
  teamName: { color: '#fff', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  teamRole: { color: '#888', fontSize: 11, textAlign: 'center', textTransform: 'capitalize' },

  filterWrap: { marginTop: 14, marginBottom: 4 },
  playerRow: { flexDirection: 'row', marginBottom: 8 },
  feedError: { color: '#ff8a80', fontSize: 13, marginTop: 12, marginHorizontal: 16, textAlign: 'center' },

  feedPlaceholder: { paddingVertical: 60, alignItems: 'center' },
  feedPlaceholderText: { color: '#555', fontSize: 14, textAlign: 'center', lineHeight: 20 },

  // App-home feed cards (parity with the tabs Home cards).
  feed: { paddingHorizontal: 16, paddingTop: 4 },
  card: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#333' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' },
  sourcePill: {
    color: '#ddd', fontSize: 11, fontWeight: '700',
    backgroundColor: '#2a2740', borderColor: '#534AB7', borderWidth: 1,
    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, maxWidth: 160,
  },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  cardMeta: { color: '#888', fontSize: 12, marginTop: 4 },

  empty: { color: '#888', textAlign: 'center', marginTop: 40, fontSize: 15 },

  bottomNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    borderTopWidth: 1, borderTopColor: '#222', backgroundColor: '#0a0a0a', paddingTop: 8,
  },
  navItem: { padding: 8, minWidth: 48, alignItems: 'center' },
  navCenter: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#534AB7',
    alignItems: 'center', justifyContent: 'center', marginTop: -20,
    shadowColor: '#534AB7', shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 6,
  },

  formScreen: { flex: 1, backgroundColor: '#000', paddingHorizontal: 20 },
  formTitle: { color: '#fff', fontSize: 28, fontWeight: '700', marginBottom: 24 },
  input: {
    backgroundColor: '#1a1a1a', borderRadius: 8, padding: 14, marginBottom: 12,
    fontSize: 16, borderWidth: 1, borderColor: '#333', color: '#fff',
  },
  saveBtn: { backgroundColor: '#534AB7', borderRadius: 8, padding: 16, alignItems: 'center', marginTop: 8, marginBottom: 12 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancel: { textAlign: 'center', color: '#888', fontSize: 14 },
});

import { useTeamContext } from '@/context';
import { loadMergedFeed, type FeedDebug, type WallPost } from '@/lib/core/homeFeed';
import { getSignedVideoUrl } from '@/lib/native/video-url';
import { supabase } from '@/supabase';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ContentTypeBadge from './components/ContentTypeBadge';

// Visual-only filter chips for now — wiring to real data is a later task.
const FILTERS = ['All', 'Lars', 'Highlights', 'Sent', 'Games'];

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
  const [selectedFilter, setSelectedFilter] = useState('All');
  const [showNewKid, setShowNewKid] = useState(false);
  const [newKidName, setNewKidName] = useState('');
  const [creatingKid, setCreatingKid] = useState(false);
  // player_id -> signed photo URL, minted from each kid's photo_path.
  const [kidPhotoUris, setKidPhotoUris] = useState<Record<string, string>>({});

  // App-home feed: the merged "everything I'm attached to and allowed to see"
  // list. The merge/dedup is the SINGLE source of truth in @/lib/core/homeFeed —
  // the exact same call the tabs Home uses. No team selection needed; it scopes
  // to ALL my teams + ALL my kids and reloads when those memberships resolve.
  const [feedPosts, setFeedPosts] = useState<WallPost[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [debug, setDebug] = useState<FeedDebug | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setFeedLoading(true);
      const { posts, debug: dbg } = await loadMergedFeed(userTeams, userKids);
      if (cancelled) return;
      setFeedPosts(posts);
      setDebug(dbg);
      setFeedLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userTeams, userKids]);

  // Open a feed card. Mirrors the tabs Home's handler — navigation is UI, so it
  // stays per-screen (only the feed *data* logic is shared in lib/core).
  function openShared(item: WallPost) {
    if (item.contentType === 'game') {
      router.push({ pathname: '/shared-game', params: { shareId: item.shareId, title: item.title } });
      return;
    }
    if (!item.storagePath) { Alert.alert('Unavailable', 'This content could not be loaded.'); return; }
    router.push({
      pathname: '/shared-viewer',
      params: {
        title: item.title, storagePath: item.storagePath,
        startTime: item.startTime != null ? String(item.startTime) : '',
        endTime: item.endTime != null ? String(item.endTime) : '',
      },
    });
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
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.brand}>🏀 IamSports</Text>
        <View style={styles.headerIcons}>
          <TouchableOpacity style={styles.iconBtn}>
            <Ionicons name="search-outline" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn}>
            <Ionicons name="notifications-outline" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Your kids — always shown so "+ Add kid" is reachable even with zero
            kids (mirrors the teams rail's "+ New team"). */}
        <Text style={styles.sectionLabel}>Your kids</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.rail}
        >
          {userKids.map(kid => (
            <TouchableOpacity
              key={kid.player_id}
              style={styles.teamItem}
              onPress={() => router.push({ pathname: '/kid', params: { playerId: kid.player_id } })}
            >
              {kidPhotoUris[kid.player_id] ? (
                <Image source={{ uri: kidPhotoUris[kid.player_id] }} style={styles.avatarImage} />
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
        </ScrollView>

        <Text style={styles.sectionLabel}>Your teams</Text>

        {/* Team rail */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.rail}
        >
          {uniqueTeams.map(team => (
            <TouchableOpacity
              key={team.team_id}
              style={styles.teamItem}
              onPress={() => selectTeam(team.team_id)}
            >
              <View style={[styles.avatar, { backgroundColor: teamColor(team.team_id) }]}>
                <Text style={styles.avatarText}>
                  {team.name.trim().charAt(0).toUpperCase() || '🏀'}
                </Text>
              </View>
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
        </ScrollView>

        {/* Filter chips (visual only) */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {FILTERS.map(f => {
            const active = selectedFilter === f;
            return (
              <TouchableOpacity
                key={f}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setSelectedFilter(f)}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{f}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* App-home feed — the merged cross-team/cross-kid list (same logic as
            the tabs Home, from @/lib/core/homeFeed). Tapping a team above still
            opens that team's page; this feed shows everything on open. */}
        {__DEV__ && debug ? (
          <View style={styles.debugBox}>
            <Text style={styles.debugTitle}>▶ SCREEN: select-team.tsx (app-home)</Text>
            <Text style={styles.debugText}>userTeams {userTeams.length} · userKids {userKids.length}</Text>
            <Text style={styles.debugText}>Q1 team/player rows: {debug.q1Rows}{debug.q1Err ? `  ⛔ ${debug.q1Err}` : ''}</Text>
            <Text style={styles.debugText}>Q2 public rows: {debug.q2Rows}{debug.q2Err ? `  ⛔ ${debug.q2Err}` : ''}</Text>
            {debug.ptErr ? <Text style={styles.debugText}>player_teams ⛔ {debug.ptErr}</Text> : null}
            <Text style={styles.debugText}>final after dedup: {debug.final}</Text>
          </View>
        ) : null}

        {feedLoading ? (
          <ActivityIndicator size="large" color="#534AB7" style={{ marginTop: 30 }} />
        ) : feedPosts.length === 0 ? (
          <View style={styles.feedPlaceholder}>
            <Text style={styles.feedPlaceholderText}>
              Nothing new yet.{'\n'}Games and reels from your teams and kids show up here.
            </Text>
          </View>
        ) : (
          <View style={styles.feed}>
            {feedPosts.map(item => {
              // Teams before "Family" in the source pills.
              const sources = [...item.sources].sort((a, b) => (a === 'Family' ? 1 : 0) - (b === 'Family' ? 1 : 0));
              return (
                <TouchableOpacity key={item.key} style={styles.card} onPress={() => openShared(item)}>
                  <View style={styles.cardTop}>
                    <ContentTypeBadge type={item.contentType === 'video' ? 'game' : item.contentType} />
                    {sources.map(s => (
                      <Text key={s} style={styles.sourcePill} numberOfLines={1}>{s}</Text>
                    ))}
                  </View>
                  <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.cardMeta}>{new Date(item.createdAt).toLocaleDateString()}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Bottom nav */}
      <View style={[styles.bottomNav, { paddingBottom: insets.bottom + 8 }]}>
        <TouchableOpacity style={styles.navItem}>
          <Ionicons name="home" size={24} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem}>
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

  chipRow: { gap: 8, paddingVertical: 18, paddingRight: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18,
    backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333',
  },
  chipActive: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
  chipText: { color: '#aaa', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#fff' },

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

  // TEMP diagnostic panel — remove after on-device verify.
  debugBox: { backgroundColor: '#3a2f00', borderColor: '#c8a400', borderWidth: 1, borderRadius: 8, padding: 10, marginHorizontal: 16, marginVertical: 10, gap: 2 },
  debugTitle: { color: '#ffd11a', fontSize: 12, fontWeight: '800', marginBottom: 4, fontFamily: 'Courier' },
  debugText: { color: '#ffe680', fontSize: 12, fontFamily: 'Courier' },
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

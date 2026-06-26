import { COACH_ROLES, useTeamContext } from '@/context';
import { supabase } from '@/supabase';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Dropdown, { type DropdownOption } from './components/Dropdown';

// Coaches' Corner — feed of coaches'-board posts (shares with audience='coaches')
// for the teams the user coaches. shares_read RLS already scopes the query to
// coached teams (audience='coaches' AND is_team_coach(team_id)), so no client-side
// team filter is needed. Mirrors the team-wall feed (app/team.tsx): shares →
// resolve_shared_content → card list → /shared-viewer. Slice 1: feed only, no
// team-filter UI yet.

// Display label per content type. 'video' shares are full game uploads.
const CONTENT_LABEL: Record<string, string> = { reel: 'Reel', video: 'Game', clip: 'Clip' };

// Static filter-bar options (Team options are derived from the user's coached teams).
const TYPE_OPTIONS: DropdownOption[] = [
  { value: 'all', label: 'All types' },
  { value: 'video', label: 'Games' },
  { value: 'reel', label: 'Reels' },
  { value: 'clip', label: 'Clips' },
];

const SORT_OPTIONS: DropdownOption[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'az', label: 'A–Z' },
];

// Tag-filter categories — each renders as a dropdown ONLY when the current feed
// has at least one tag of that category. Order matches the filter bar.
const TAG_CATEGORIES: { key: string; label: string; allLabel: string }[] = [
  { key: 'players', label: 'Player', allLabel: 'All players' },
  { key: 'offense', label: 'Offense', allLabel: 'All offense' },
  { key: 'defense', label: 'Defense', allLabel: 'All defense' },
  { key: 'plays', label: 'Plays', allLabel: 'All plays' },
];

function relativeTime(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

type Post = {
  shareId: string;
  contentType: string;
  contentId: string;
  teamId: string;
  teamName: string;
  createdAt: string;
  title: string;
  storagePath: string | null;
  startTime: number | null;
  endTime: number | null;
};

export default function CoachesCornerScreen() {
  const insets = useSafeAreaInsets();
  const { userTeams } = useTeamContext();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter-bar state (all in-memory; no refetch on change).
  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');

  // Per-category tag filters (single-select; 'all' = no constraint). Rendered
  // only when the feed has tags of that category.
  const [playerFilter, setPlayerFilter] = useState('all');
  const [offenseFilter, setOffenseFilter] = useState('all');
  const [defenseFilter, setDefenseFilter] = useState('all');
  const [playsFilter, setPlaysFilter] = useState('all');

  // Batch-loaded tag data for the feed: each post's tag set (by contentId) and
  // tag metadata (id → name/category). Three queries total, no N+1 (see effect).
  const [tagsByContentId, setTagsByContentId] = useState<Map<string, Set<string>>>(new Map());
  const [tagMeta, setTagMeta] = useState<Map<string, { name: string; category: string }>>(new Map());

  // Coaches-audience shares for the user's coached teams (RLS-scoped), each
  // resolved to its content. Reuses the team-wall pattern exactly.
  async function loadCoachesBoard() {
    setLoading(true);
    const { data: rows } = await supabase
      .from('shares')
      .select('id, content_type, content_id, team_id, created_at, teams ( name )')
      .eq('audience', 'coaches')
      .order('created_at', { ascending: false });
    const items = await Promise.all((rows || []).map(async (r: any) => {
      const { data: resolved } = await supabase.rpc('resolve_shared_content', { p_share_id: r.id });
      const c = Array.isArray(resolved) ? resolved[0] : null;
      return {
        shareId: r.id,
        contentType: r.content_type,
        contentId: r.content_id,
        teamId: r.team_id,
        teamName: r.teams?.name ?? 'Team',
        createdAt: r.created_at,
        title: c?.title ?? '(content unavailable)',
        storagePath: c?.storage_path ?? null,
        startTime: c?.start_time ?? null,
        endTime: c?.end_time ?? null,
      };
    }));
    setPosts(items);
    setLoading(false);
  }

  useEffect(() => {
    loadCoachesBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Batch-load tags for the whole feed whenever posts change. Bucket content ids
  // by type (reel → reel_tags, clip → clip_tags; video/game have no tags), load
  // each join table with ONE .in() query, then resolve all tag ids → name/category
  // in one more. Builds tagsByContentId (contentId → Set<tag_id>) + tagMeta. No N+1.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const reelIds = posts.filter(p => p.contentType === 'reel').map(p => p.contentId);
      const clipIds = posts.filter(p => p.contentType === 'clip').map(p => p.contentId);

      const byContent = new Map<string, Set<string>>();
      const allTagIds = new Set<string>();
      const add = (cid: string, tid: string) => {
        const s = byContent.get(cid) ?? new Set<string>();
        s.add(tid);
        byContent.set(cid, s);
        allTagIds.add(tid);
      };

      if (reelIds.length > 0) {
        const { data } = await supabase.from('reel_tags').select('reel_id, tag_id').in('reel_id', reelIds);
        (data || []).forEach((r: any) => add(r.reel_id, r.tag_id));
      }
      if (clipIds.length > 0) {
        const { data } = await supabase.from('clip_tags').select('clip_id, tag_id').in('clip_id', clipIds);
        (data || []).forEach((r: any) => add(r.clip_id, r.tag_id));
      }

      const meta = new Map<string, { name: string; category: string }>();
      if (allTagIds.size > 0) {
        const { data } = await supabase.from('tags').select('id, name, category').in('id', [...allTagIds]);
        (data || []).forEach((t: any) => meta.set(t.id, { name: t.name, category: t.category }));
      }

      if (cancelled) return;
      setTagsByContentId(byContent);
      setTagMeta(meta);
    })();
    return () => { cancelled = true; };
  }, [posts]);

  // Team dropdown options: "All teams" + one per coached team.
  const teamOptions = useMemo<DropdownOption[]>(() => [
    { value: 'all', label: 'All teams' },
    ...userTeams.filter(t => COACH_ROLES.includes(t.role)).map(t => ({ value: t.team_id, label: t.name })),
  ], [userTeams]);

  // Per-category tag options derived from tags actually present on the feed.
  // Categories with zero feed tags yield an empty list → no dropdown rendered.
  const tagOptionsByCategory = useMemo<Record<string, DropdownOption[]>>(() => {
    const present = new Set<string>();
    posts.forEach(p => tagsByContentId.get(p.contentId)?.forEach(tid => present.add(tid)));
    const byCat: Record<string, DropdownOption[]> = {};
    for (const cat of TAG_CATEGORIES) {
      byCat[cat.key] = [...present]
        .filter(tid => tagMeta.get(tid)?.category === cat.key)
        .map(tid => ({ value: tid, label: tagMeta.get(tid)!.name }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    return byCat;
  }, [posts, tagsByContentId, tagMeta]);

  // Map each category to its filter value + setter so the dropdowns render in a loop.
  const tagFilterByCategory: Record<string, { value: string; set: (v: string) => void }> = {
    players: { value: playerFilter, set: setPlayerFilter },
    offense: { value: offenseFilter, set: setOffenseFilter },
    defense: { value: defenseFilter, set: setDefenseFilter },
    plays: { value: playsFilter, set: setPlaysFilter },
  };

  // Apply team / type / search + per-category tag filters (AND), then sort.
  const visiblePosts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const activeTags = [playerFilter, offenseFilter, defenseFilter, playsFilter].filter(v => v !== 'all');
    const filtered = posts.filter(p => {
      if (!(teamFilter === 'all' || p.teamId === teamFilter)) return false;
      if (!(typeFilter === 'all' || p.contentType === typeFilter)) return false;
      if (!(q === '' || p.title.toLowerCase().includes(q) || p.teamName.toLowerCase().includes(q))) return false;
      // AND across categories: the post must carry EVERY selected tag. A post with
      // no tags (video/game, or untagged) fails any active tag filter.
      if (activeTags.length > 0) {
        const tagSet = tagsByContentId.get(p.contentId);
        if (!activeTags.every(tid => tagSet?.has(tid))) return false;
      }
      return true;
    });
    const sorted = [...filtered];
    if (sortBy === 'az') {
      sorted.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === 'oldest') {
      sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    } else {
      sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest
    }
    return sorted;
  }, [posts, search, teamFilter, typeFilter, sortBy, playerFilter, offenseFilter, defenseFilter, playsFilter, tagsByContentId]);

  function openShared(item: Post) {
    if (!item.storagePath) { Alert.alert('Unavailable', 'This content could not be loaded.'); return; }
    router.push({
      pathname: '/shared-viewer',
      params: {
        title: item.title,
        storagePath: item.storagePath,
        startTime: item.startTime != null ? String(item.startTime) : '',
        endTime: item.endTime != null ? String(item.endTime) : '',
      },
    });
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>Coaches&apos; Corner</Text>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color="#888" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search posts"
          placeholderTextColor="#666"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={16} color="#666" />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.filterRow}>
        <Dropdown compact value={teamFilter} options={teamOptions} onSelect={setTeamFilter} placeholder="Team" />
        <Dropdown compact value={typeFilter} options={TYPE_OPTIONS} onSelect={setTypeFilter} placeholder="Type" />
        <Dropdown compact value={sortBy} options={SORT_OPTIONS} onSelect={setSortBy} placeholder="Sort" />
        {TAG_CATEGORIES.map(cat => {
          const opts = tagOptionsByCategory[cat.key];
          if (!opts || opts.length === 0) return null;
          const f = tagFilterByCategory[cat.key];
          return (
            <Dropdown
              key={cat.key}
              compact
              value={f.value}
              options={[{ value: 'all', label: cat.allLabel }, ...opts]}
              onSelect={f.set}
              placeholder={cat.label}
            />
          );
        })}
      </View>

      <View style={[styles.content, visiblePosts.length > 0 && styles.contentTop]}>
        {loading ? (
          <ActivityIndicator size="large" color="#534AB7" />
        ) : posts.length === 0 ? (
          <Text style={styles.empty}>No posts yet</Text>
        ) : visiblePosts.length === 0 ? (
          <Text style={styles.empty}>No posts match your filters.</Text>
        ) : (
          <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 20 }}>
            {visiblePosts.map(item => (
              <TouchableOpacity key={item.shareId} style={styles.card} onPress={() => openShared(item)}>
                <View style={styles.cardTop}>
                  <Text style={styles.teamPill} numberOfLines={1}>{item.teamName}</Text>
                  <Text style={styles.typeLabel}>{CONTENT_LABEL[item.contentType] ?? item.contentType}</Text>
                </View>
                <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.cardMeta}>{relativeTime(item.createdAt)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingHorizontal: 20 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { paddingVertical: 8 },
  backText: { color: '#534AB7', fontSize: 16 },
  title: { color: '#fff', fontSize: 26, fontWeight: '700', marginTop: 8, marginBottom: 16 },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#1a1a1a', borderRadius: 10, borderWidth: 1, borderColor: '#333',
    paddingHorizontal: 12, height: 42,
  },
  searchInput: { flex: 1, color: '#fff', fontSize: 15, padding: 0 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 8 },

  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  contentTop: { alignItems: 'stretch', justifyContent: 'flex-start' },
  empty: { color: '#555', fontSize: 15 },
  list: { alignSelf: 'stretch' },

  card: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#333' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  teamPill: {
    color: '#ddd', fontSize: 11, fontWeight: '700',
    backgroundColor: '#2a2740', borderColor: '#534AB7', borderWidth: 1,
    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, maxWidth: 180,
  },
  typeLabel: { color: '#888', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  cardMeta: { color: '#888', fontSize: 12, marginTop: 4 },
});

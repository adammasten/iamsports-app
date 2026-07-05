import { supabase } from '@/supabase';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ContentTypeBadge from './components/ContentTypeBadge';
import { type DropdownOption } from './components/Dropdown';
import FilterBar, { type FilterableItem } from './components/FilterBar';

// Single-team wall: no tags loaded here, and the Team dropdown is hidden (one
// team). Stable module-level refs so FilterBar's memo doesn't churn each render.
const EMPTY_TAGS = new Map<string, Set<string>>();
const EMPTY_TAG_META = new Map<string, { name: string; category: string }>();
const TEAM_OPTIONS: DropdownOption[] = [{ value: 'all', label: 'All' }];
const TYPE_OPTIONS: DropdownOption[] = [
  { value: 'all', label: 'All' },
  { value: 'reel', label: 'Reels' },
  { value: 'game', label: 'Games' },
  { value: 'clip', label: 'Clips' },
];
const SORT_OPTIONS: DropdownOption[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'az', label: 'A–Z' },
];

export default function TeamWallScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const teamId = Array.isArray(params.teamId) ? params.teamId[0] : params.teamId;
  const teamName = Array.isArray(params.teamName) ? params.teamName[0] : params.teamName;

  // Team wall — team-audience shares for this team, each resolved to its
  // content (reuses the kid-wall/inbox pattern: resolve → storage path →
  // signed URL in /shared-viewer). RLS: shares_read team branch is
  // is_team_member(team_id), so a confirmed member can read these and
  // resolve_shared_content mirrors the same check.
  const [posts, setPosts] = useState<{
    shareId: string; contentType: string; createdAt: string;
    title: string; storagePath: string | null;
    startTime: number | null; endTime: number | null;
  }[]>([]);
  const [loading, setLoading] = useState(true);
  const [visiblePosts, setVisiblePosts] = useState<FilterableItem[]>([]);

  async function loadTeamWall() {
    if (!teamId) return;
    setLoading(true);
    const { data: rows } = await supabase
      .from('shares')
      .select('id, content_type, created_at')
      .eq('team_id', teamId)
      .eq('audience', 'team')
      .order('created_at', { ascending: false });
    const items = await Promise.all((rows || []).map(async (r: any) => {
      const { data: resolved } = await supabase.rpc('resolve_shared_content', { p_share_id: r.id });
      const c = Array.isArray(resolved) ? resolved[0] : null;
      return {
        shareId: r.id,
        contentType: r.content_type,
        createdAt: r.created_at,
        title: r.content_type === 'game' ? 'Shared game' : (c?.title ?? '(content unavailable)'),
        storagePath: c?.storage_path ?? null,
        startTime: c?.start_time ?? null,
        endTime: c?.end_time ?? null,
      };
    }));
    setPosts(items);
    setLoading(false);
  }

  useEffect(() => {
    loadTeamWall();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  // Map posts → FilterableItem for FilterBar (id = share id). 'video' uploads are
  // game films, so normalize them to 'game' for the Type filter. postsById
  // recovers the full post for the card render + openShared.
  const items = useMemo<FilterableItem[]>(
    () => posts.map(p => ({
      id: p.shareId,
      teamId: teamId ?? '',
      teamName: teamName ?? 'Team',
      contentType: p.contentType === 'video' ? 'game' : p.contentType,
      title: p.title,
      createdAt: p.createdAt,
    })),
    [posts, teamId, teamName],
  );
  const postsById = useMemo(() => new Map(posts.map(p => [p.shareId, p])), [posts]);

  function openShared(item: { shareId: string; contentType: string; title: string; storagePath: string | null; startTime: number | null; endTime: number | null }) {
    if (item.contentType === 'game') {
      router.push({ pathname: '/shared-game', params: { shareId: item.shareId, title: item.title } });
      return;
    }
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

      <View style={styles.headerBlock}>
        <Text style={styles.name} numberOfLines={1}>{teamName || 'Team'}</Text>
        <Text style={styles.subtitle}>Team wall</Text>
      </View>

      <FilterBar
        items={items}
        tagsById={EMPTY_TAGS}
        tagMeta={EMPTY_TAG_META}
        teamOptions={TEAM_OPTIONS}
        typeOptions={TYPE_OPTIONS}
        sortOptions={SORT_OPTIONS}
        searchPlaceholder="Search"
        onVisibleChange={setVisiblePosts}
      />

      <View style={[styles.content, visiblePosts.length > 0 && styles.contentTop]}>
        {loading ? (
          <ActivityIndicator size="large" color="#534AB7" />
        ) : posts.length === 0 ? (
          <Text style={styles.empty}>Nothing on the team wall yet</Text>
        ) : visiblePosts.length === 0 ? (
          <Text style={styles.empty}>Nothing matches your filters.</Text>
        ) : (
          <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 20 }}>
            {visiblePosts.map(fi => {
              const item = postsById.get(fi.id);
              if (!item) return null;
              return (
                <TouchableOpacity key={item.shareId} style={styles.card} onPress={() => openShared(item)}>
                  <View style={styles.typeBadgeWrap}><ContentTypeBadge type={item.contentType} /></View>
                  <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.cardMeta}>{new Date(item.createdAt).toLocaleDateString()}</Text>
                </TouchableOpacity>
              );
            })}
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

  headerBlock: { alignItems: 'center', marginTop: 8, marginBottom: 20 },
  name: { color: '#fff', fontSize: 26, fontWeight: '700', textAlign: 'center' },
  subtitle: { color: '#aaa', fontSize: 14, marginTop: 4, textAlign: 'center' },

  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  contentTop: { alignItems: 'stretch', justifyContent: 'flex-start', paddingTop: 16 },
  empty: { color: '#555', fontSize: 15 },
  list: { alignSelf: 'stretch' },
  card: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#333' },
  typeBadgeWrap: { marginBottom: 6 },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  cardMeta: { color: '#888', fontSize: 12, marginTop: 4 },
});

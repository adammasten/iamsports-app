import { supabase } from '@/supabase';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Coaches' Corner — feed of coaches'-board posts (shares with audience='coaches')
// for the teams the user coaches. shares_read RLS already scopes the query to
// coached teams (audience='coaches' AND is_team_coach(team_id)), so no client-side
// team filter is needed. Mirrors the team-wall feed (app/team.tsx): shares →
// resolve_shared_content → card list → /shared-viewer. Slice 1: feed only, no
// team-filter UI yet.

// Display label per content type. 'video' shares are full game uploads.
const CONTENT_LABEL: Record<string, string> = { reel: 'Reel', video: 'Game', clip: 'Clip' };

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
  teamName: string;
  createdAt: string;
  title: string;
  storagePath: string | null;
  startTime: number | null;
  endTime: number | null;
};

export default function CoachesCornerScreen() {
  const insets = useSafeAreaInsets();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  // Coaches-audience shares for the user's coached teams (RLS-scoped), each
  // resolved to its content. Reuses the team-wall pattern exactly.
  async function loadCoachesBoard() {
    setLoading(true);
    const { data: rows } = await supabase
      .from('shares')
      .select('id, content_type, team_id, created_at, teams ( name )')
      .eq('audience', 'coaches')
      .order('created_at', { ascending: false });
    const items = await Promise.all((rows || []).map(async (r: any) => {
      const { data: resolved } = await supabase.rpc('resolve_shared_content', { p_share_id: r.id });
      const c = Array.isArray(resolved) ? resolved[0] : null;
      return {
        shareId: r.id,
        contentType: r.content_type,
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

      <View style={[styles.content, posts.length > 0 && styles.contentTop]}>
        {loading ? (
          <ActivityIndicator size="large" color="#534AB7" />
        ) : posts.length === 0 ? (
          <Text style={styles.empty}>No posts yet</Text>
        ) : (
          <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 20 }}>
            {posts.map(item => (
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

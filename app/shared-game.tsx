import { supabase } from '@/supabase';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Shared game viewer — opens a game posted to a wall and lists its videos. Loads
// via resolve_shared_game(shareId), a SECURITY DEFINER RPC that returns the
// game's videos even for a NON-team-member (the normal team-gated videos query
// would return zero rows). Tapping a video opens /shared-viewer to play it.
// Parallel of /shared-viewer + resolve_shared_content, one level up.

function param(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

type GameVideo = { video_id: string; title: string; storage_path: string | null; sort_order: number };

export default function SharedGameScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const shareId = param(params.shareId);
  const headerTitle = param(params.title) || 'Shared game';

  const [videos, setVideos] = useState<GameVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!shareId) { setFailed(true); setLoading(false); return; }
      const { data, error } = await supabase.rpc('resolve_shared_game', { p_share_id: shareId });
      if (cancelled) return;
      if (error) { console.warn('[shared-game] resolve failed:', error.message); setFailed(true); setLoading(false); return; }
      const rows = ((data || []) as GameVideo[]).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      setVideos(rows);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [shareId]);

  function playVideo(v: GameVideo) {
    if (!v.storage_path) { Alert.alert('Unavailable', 'This video could not be loaded.'); return; }
    // Omit start/end so the whole video plays.
    router.push({ pathname: '/shared-viewer', params: { title: v.title, storagePath: v.storage_path } });
  }

  const count = `${videos.length} video${videos.length === 1 ? '' : 's'}`;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.headerBlock}>
        <View style={styles.gameAvatar}><Ionicons name="basketball" size={26} color="#C8742B" /></View>
        <Text style={styles.eyebrow}>GAME</Text>
        <Text style={styles.title} numberOfLines={1}>{headerTitle}</Text>
        {!loading && !failed && <Text style={styles.subtitle}>{count}</Text>}
      </View>

      <View style={[styles.content, videos.length > 0 && styles.contentTop]}>
        {loading ? (
          <ActivityIndicator size="large" color="#534AB7" />
        ) : failed ? (
          <Text style={styles.empty}>Couldn’t load this game.</Text>
        ) : videos.length === 0 ? (
          <Text style={styles.empty}>No videos in this game yet.</Text>
        ) : (
          <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 20 }}>
            {videos.map(v => (
              <TouchableOpacity key={v.video_id} style={styles.videoRow} onPress={() => playVideo(v)}>
                <Ionicons name="film-outline" size={18} color="#888" />
                <Text style={styles.videoRowText} numberOfLines={1}>{v.title}</Text>
                <Ionicons name="play" size={16} color="#8B82E8" />
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
  headerBlock: { alignItems: 'center', marginTop: 8, marginBottom: 20 },
  gameAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  eyebrow: { color: '#C8742B', fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginBottom: 4 },
  title: { color: '#fff', fontSize: 24, fontWeight: '700', textAlign: 'center' },
  subtitle: { color: '#aaa', fontSize: 14, marginTop: 4 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  contentTop: { alignItems: 'stretch', justifyContent: 'flex-start' },
  empty: { color: '#555', fontSize: 15, textAlign: 'center' },
  list: { alignSelf: 'stretch' },
  videoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#333',
  },
  videoRowText: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '500' },
});

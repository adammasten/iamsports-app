// Frozen past-team archive: the games a kid played on a team (current or left).
// Access survives leaving — games_read RLS returns exactly the games this
// caller's kid was in the lineup of (via is_lineup_parent), so a plain query by
// team_id yields the kid's games with no membership required.
import { goBackOrHome } from '@/lib/nav';
import { supabase } from '@/supabase';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type ArchiveGame = { id: string; title: string; date: string | null; storagePath: string | null };

export default function TeamArchiveScreen() {
  const params = useLocalSearchParams();
  const teamId = Array.isArray(params.teamId) ? params.teamId[0] : params.teamId;
  const teamName = Array.isArray(params.teamName) ? params.teamName[0] : (params.teamName as string);
  const insets = useSafeAreaInsets();
  const [games, setGames] = useState<ArchiveGame[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!teamId) return;
      setLoading(true);
      const { data } = await supabase
        .from('games')
        .select('id, title, game_date, videos ( url, sort_order )')
        .eq('team_id', teamId)
        .order('game_date', { ascending: false });
      if (cancelled) return;
      const rows: ArchiveGame[] = (data || []).map((g: any) => {
        const vids = (g.videos || []).slice().sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        return { id: g.id, title: g.title, date: g.game_date ?? null, storagePath: vids[0]?.url ?? null };
      });
      setGames(rows);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [teamId]);

  function openGame(g: ArchiveGame) {
    if (!g.storagePath) return;
    router.push({ pathname: '/shared-viewer', params: { title: g.title, storagePath: g.storagePath } });
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <TouchableOpacity onPress={goBackOrHome} style={styles.back}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
      <Text style={styles.title}>{teamName || 'Team'}</Text>
      <Text style={styles.subtitle}>Games your player was part of.</Text>
      {loading ? (
        <ActivityIndicator size="large" color="#534AB7" style={{ marginTop: 40 }} />
      ) : games.length === 0 ? (
        <Text style={styles.empty}>No games to show from this team yet.</Text>
      ) : (
        <FlatList
          data={games}
          keyExtractor={(g) => g.id}
          contentContainerStyle={{ paddingBottom: 30 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => openGame(item)} disabled={!item.storagePath} activeOpacity={0.7}>
              <View style={styles.thumb}><Text style={styles.thumbIcon}>🎬</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.cardMeta}>
                  {item.date ? new Date(item.date).toLocaleDateString() : (item.storagePath ? 'Tap to watch' : 'No video yet')}
                </Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingHorizontal: 20 },
  back: { marginBottom: 8 },
  backText: { color: '#534AB7', fontSize: 16, fontWeight: '600' },
  title: { color: '#fff', fontSize: 26, fontWeight: '800' },
  subtitle: { color: '#888', fontSize: 13, marginTop: 2, marginBottom: 16 },
  empty: { color: '#666', fontSize: 14, textAlign: 'center', marginTop: 40 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#141414', borderRadius: 12, padding: 12, marginBottom: 10 },
  thumb: { width: 54, height: 54, borderRadius: 8, backgroundColor: '#1e1a2e', alignItems: 'center', justifyContent: 'center' },
  thumbIcon: { fontSize: 22 },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  cardMeta: { color: '#888', fontSize: 12, marginTop: 2 },
});

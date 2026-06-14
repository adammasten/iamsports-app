import { useTeamContext } from '@/context';
import { supabase } from '@/supabase';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Unified coach clips library — all clips across the teams the viewer coaches,
// filtered by team chips (client-side), tap → /shared-viewer. Clips here are
// owned/team clips (NOT shares), so we query clips + videos directly under the
// existing clips_read/videos_read RLS rather than resolve_shared_content.
export default function ClipsLibraryScreen() {
  const insets = useSafeAreaInsets();
  const { userTeams } = useTeamContext();

  // Viewer's teams where they coach (admin/head_coach/coach), deduped — mirrors
  // kid.tsx's coachingTeams derivation.
  const coachingTeams = useMemo(() => {
    const map = new Map<string, { team_id: string; name: string }>();
    for (const t of userTeams) {
      if ((t.role === 'admin' || t.role === 'head_coach' || t.role === 'coach') && !map.has(t.team_id)) {
        map.set(t.team_id, { team_id: t.team_id, name: t.name });
      }
    }
    return Array.from(map.values());
  }, [userTeams]);

  const [clips, setClips] = useState<{
    id: string; teamId: string | null; teamName: string;
    title: string; storagePath: string | null;
    startTime: number; endTime: number; createdAt: string;
  }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTeam, setSelectedTeam] = useState<string>('all');

  async function loadClips() {
    const ids = coachingTeams.map(t => t.team_id);
    if (ids.length === 0) { setClips([]); setLoading(false); return; }
    setLoading(true);
    const teamNameById = new Map(coachingTeams.map(t => [t.team_id, t.name]));
    const { data: rows } = await supabase
      .from('clips')
      .select('id, team_id, start_time, end_time, note, created_at, videos ( url, label )')
      .in('team_id', ids)
      .order('created_at', { ascending: false });
    const items = (rows || []).map((r: any) => {
      const v = Array.isArray(r.videos) ? r.videos[0] : r.videos;
      return {
        id: r.id,
        teamId: r.team_id,
        teamName: (r.team_id && teamNameById.get(r.team_id)) || 'Team',
        title: (v?.label || r.note || 'Clip') as string,
        storagePath: v?.url ?? null,
        startTime: Number(r.start_time),
        endTime: Number(r.end_time),
        createdAt: r.created_at,
      };
    });
    setClips(items);
    setLoading(false);
  }

  useEffect(() => {
    loadClips();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coachingTeams]);

  const visibleClips = selectedTeam === 'all'
    ? clips
    : clips.filter(c => c.teamId === selectedTeam);

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function openClip(item: { title: string; storagePath: string | null; startTime: number; endTime: number }) {
    if (!item.storagePath) { Alert.alert('Unavailable', 'This clip’s video could not be loaded.'); return; }
    router.push({
      pathname: '/shared-viewer',
      params: {
        title: item.title,
        storagePath: item.storagePath,
        startTime: String(item.startTime),
        endTime: String(item.endTime),
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

      <Text style={styles.title}>Clips</Text>

      {coachingTeams.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {[{ team_id: 'all', name: 'All' }, ...coachingTeams].map(t => {
            const active = selectedTeam === t.team_id;
            return (
              <TouchableOpacity
                key={t.team_id}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setSelectedTeam(t.team_id)}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{t.name}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <View style={[styles.content, visibleClips.length > 0 && styles.contentTop]}>
        {loading ? (
          <ActivityIndicator size="large" color="#534AB7" />
        ) : coachingTeams.length === 0 ? (
          <Text style={styles.empty}>You don&apos;t coach any teams.</Text>
        ) : visibleClips.length === 0 ? (
          <Text style={styles.empty}>No clips yet.</Text>
        ) : (
          <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 20 }}>
            {visibleClips.map(item => (
              <TouchableOpacity key={item.id} style={styles.card} onPress={() => openClip(item)}>
                <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.cardMeta}>
                  {formatTime(item.startTime)} → {formatTime(item.endTime)} · {item.teamName} · {new Date(item.createdAt).toLocaleDateString()}
                </Text>
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

  chipRow: { gap: 8, paddingBottom: 16, paddingRight: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18,
    backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333',
    height: 36,
  },
  chipActive: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
  chipText: { color: '#aaa', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#fff' },

  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  contentTop: { alignItems: 'stretch', justifyContent: 'flex-start' },
  empty: { color: '#555', fontSize: 15 },
  list: { alignSelf: 'stretch' },
  card: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#333' },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  cardMeta: { color: '#888', fontSize: 12, marginTop: 4 },
});

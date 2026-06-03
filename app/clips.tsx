import { supabase } from '@/supabase';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function ClipsScreen() {
  const params = useLocalSearchParams();
  const videoId = Array.isArray(params.videoId) ? params.videoId[0] : params.videoId;
  const videoLabel = Array.isArray(params.label) ? params.label[0] : params.label;
  const [clips, setClips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // Resolved from tags by name + category='special'. The ★/POE display badges
  // and card border styles read tag-presence via these IDs instead of the
  // (dead, no-longer-written) is_starred / is_point_of_emphasis columns.
  const [specialTagIds, setSpecialTagIds] = useState<{ highlight: string | null; poe: string | null }>({ highlight: null, poe: null });

  useEffect(() => { if (videoId) fetchClips(); }, [videoId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('tags')
        .select('id, name')
        .eq('category', 'special')
        .eq('scope', 'global');
      if (cancelled || !data) return;
      let highlightId: string | null = null;
      let poeId: string | null = null;
      data.forEach((t: any) => {
        if (t.name === '★ Highlight') highlightId = t.id;
        else if (t.name === 'POE') poeId = t.id;
      });
      setSpecialTagIds({ highlight: highlightId, poe: poeId });
    })();
    return () => { cancelled = true; };
  }, []);

  async function fetchClips() {
    const { data: clipsData, error } = await supabase
      .from('clips')
      .select('*')
      .eq('video_id', videoId)
      .order('start_time');
    if (error) { Alert.alert('Error', error.message); setLoading(false); return; }

    const clipsWithTags = await Promise.all((clipsData || []).map(async (clip) => {
      const { data: tagData } = await supabase
        .from('clip_tags')
        .select('tag_id')
        .eq('clip_id', clip.id);

      if (!tagData || tagData.length === 0) return { ...clip, tagIds: [], tagNames: [] };

      const tagIds = tagData.map((t: any) => t.tag_id);
      const { data: tags } = await supabase.from('tags').select('name').in('id', tagIds);
      return { ...clip, tagIds, tagNames: (tags || []).map((t: any) => t.name) };
    }));

    setClips(clipsWithTags);
    setLoading(false);
  }

  async function deleteClip(clipId: string) {
    Alert.alert('Delete Clip', 'Permanently delete this clip?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await supabase.from('clip_tags').delete().eq('clip_id', clipId);
          await supabase.from('clips').delete().eq('id', clipId);
          fetchClips();
        }
      }
    ]);
  }

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function getTagNames(clip: any) {
    if (!clip.tagNames || clip.tagNames.length === 0) return 'No tags';
    return clip.tagNames.join(', ');
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => router.back()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>{videoLabel} — Clips</Text>
      <Text style={styles.subtitle}>Tap to preview • Hold to delete</Text>

      {loading ? (
        <Text style={styles.empty}>Loading...</Text>
      ) : clips.length === 0 ? (
        <Text style={styles.empty}>No clips yet. Go tag some!</Text>
      ) : (
        <FlatList
          data={clips}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const ids: string[] = item.tagIds ?? [];
            const isHighlighted = !!specialTagIds.highlight && ids.includes(specialTagIds.highlight);
            const isPOE = !!specialTagIds.poe && ids.includes(specialTagIds.poe);
            return (
            <TouchableOpacity
              style={[
                styles.clipCard,
                // POE first, starred second — when both true, starred (gold) wins the card.
                isPOE && styles.poeCard,
                isHighlighted && styles.starredCard,
              ]}
              onLongPress={() => deleteClip(item.id)}
            >
              <View style={styles.clipHeader}>
                <Text style={styles.clipTime}>
                  {formatTime(item.start_time)} → {formatTime(item.end_time)}
                </Text>
                <View style={styles.badges}>
                  {isHighlighted && <Text style={styles.star}>★ Highlight</Text>}
                  {isPOE && <Text style={styles.poe}>! POE</Text>}
                </View>
              </View>
              <Text style={styles.clipTags}>{getTagNames(item)}</Text>
              {item.note ? <Text style={styles.clipNote}>{item.note}</Text> : null}
            </TouchableOpacity>
          );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 60, backgroundColor: '#fff' },
  back: { marginBottom: 16 },
  backText: { color: '#534AB7', fontSize: 16 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  subtitle: { fontSize: 12, color: '#aaa', marginBottom: 24 },
  clipCard: { backgroundColor: '#f5f5f5', borderRadius: 12, padding: 16, marginBottom: 12 },
  starredCard: { borderWidth: 2, borderColor: '#EF9F27', backgroundColor: '#fffbf0' },
  poeCard: { borderWidth: 2, borderColor: '#DC3545', backgroundColor: '#fff5f5' },
  clipHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  clipTime: { fontSize: 16, fontWeight: '600', color: '#333' },
  badges: { flexDirection: 'row', gap: 8 },
  star: { fontSize: 12, color: '#EF9F27', fontWeight: '600' },
  poe: { fontSize: 12, color: '#DC3545', fontWeight: '600' },
  clipTags: { fontSize: 13, color: '#534AB7', marginBottom: 4 },
  clipNote: { fontSize: 12, color: '#888' },
  empty: { textAlign: 'center', color: '#888', marginTop: 60, fontSize: 16 },
});
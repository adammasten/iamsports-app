import { supabase } from '@/supabase';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, FlatList, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function ExportScreen() {
  const [games, setGames] = useState<any[]>([]);
  const [tags, setTags] = useState<any[]>([]);
  const [selectedGames, setSelectedGames] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [clips, setClips] = useState<any[]>([]);
  const [excludedClips, setExcludedClips] = useState<string[]>([]);
  const [step, setStep] = useState<'games' | 'tags' | 'review'>('games');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchGames();
    fetchTags();
  }, []);

  async function fetchGames() {
    const { data } = await supabase.from('games').select('*').order('created_at', { ascending: false });
    setGames(data || []);
  }

  async function fetchTags() {
    const { data } = await supabase.from('tags').select('*').order('category', { ascending: true });
    setTags(data || []);
  }

  function toggleGame(id: string) {
    setSelectedGames(prev => prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]);
  }

  function toggleTag(id: string) {
    setSelectedTags(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
  }

  function toggleClip(id: string) {
    setExcludedClips(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
  }

  async function loadClips() {
    if (selectedGames.length === 0) { Alert.alert('Select at least one game'); return; }
    if (selectedTags.length === 0) { Alert.alert('Select at least one tag'); return; }
    setLoading(true);

    const { data: videos } = await supabase
      .from('videos')
      .select('id, url, label, game_id')
      .in('game_id', selectedGames);
    const videoMap: Record<string, any> = {};
    (videos || []).forEach((v: any) => { videoMap[v.id] = v; });
    const videoIds = Object.keys(videoMap);

    if (videoIds.length === 0) {
      Alert.alert('No videos found for selected games');
      setLoading(false);
      return;
    }

    const { data: clipData } = await supabase
      .from('clips')
      .select('*')
      .in('video_id', videoIds);

    const clipsWithTags = await Promise.all((clipData || []).map(async (clip: any) => {
      const { data: tagData } = await supabase
        .from('clip_tags')
        .select('tag_id')
        .eq('clip_id', clip.id);
      const tagIds = (tagData || []).map((t: any) => t.tag_id);
      const matchingTags = tags.filter(t => tagIds.includes(t.id) && selectedTags.includes(t.id));
      const video = videoMap[clip.video_id];
      const game = games.find(g => g.id === video?.game_id);
      return {
        ...clip,
        matchingTags,
        tagIds,
        videoUrl: video?.url,
        videoLabel: video?.label,
        gameTitle: game?.title,
      };
    }));

    const filtered = clipsWithTags.filter(c => c.matchingTags.length > 0);
    setClips(filtered);
    setStep('review');
    setLoading(false);
  }

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function getDuration(start: number, end: number) {
    const dur = Math.round(end - start);
    return `${dur}s`;
  }

  function groupClipsByTag() {
    const groups: Record<string, { tag: any; clips: any[] }> = {};
    selectedTags.forEach(tagId => {
      const tag = tags.find(t => t.id === tagId);
      if (!tag) return;
      const tagClips = clips.filter(c => c.tagIds.includes(tagId) && !excludedClips.includes(c.id));
      if (tagClips.length > 0) groups[tagId] = { tag, clips: tagClips };
    });
    return groups;
  }

  if (step === 'games') {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Export Highlights</Text>
        <Text style={styles.subtitle}>Step 1 of 3 — Pick games to include</Text>
        <FlatList
          data={games}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.selectCard, selectedGames.includes(item.id) && styles.selectedCard]}
              onPress={() => toggleGame(item.id)}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, selectedGames.includes(item.id) && styles.selectedText]}>{item.title}</Text>
                <Text style={[styles.cardSub, selectedGames.includes(item.id) && { color: '#ddd' }]}>{item.game_date}</Text>
              </View>
              {selectedGames.includes(item.id) && <Text style={styles.check}>✓</Text>}
            </TouchableOpacity>
          )}
        />
        <TouchableOpacity
          style={[styles.nextBtn, selectedGames.length === 0 && styles.disabledBtn]}
          onPress={() => selectedGames.length > 0 && setStep('tags')}
        >
          <Text style={styles.nextBtnText}>Next: Pick Tags →</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (step === 'tags') {
    const categories = ['offense', 'defense', 'plays'];
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
        <TouchableOpacity onPress={() => setStep('games')} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Export Highlights</Text>
        <Text style={styles.subtitle}>Step 2 of 3 — Pick tags to include</Text>
        {categories.map(cat => {
          const catTags = tags.filter(t => t.category === cat);
          if (catTags.length === 0) return null;
          return (
            <View key={cat} style={styles.section}>
              <Text style={styles.sectionTitle}>{cat.toUpperCase()}</Text>
              <View style={styles.tagGrid}>
                {catTags.map(tag => (
                  <TouchableOpacity
                    key={tag.id}
                    style={[styles.tagBtn, selectedTags.includes(tag.id) && styles.tagBtnSelected]}
                    onPress={() => toggleTag(tag.id)}
                  >
                    <Text style={[styles.tagBtnText, selectedTags.includes(tag.id) && styles.tagBtnTextSelected]}>
                      {tag.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          );
        })}
        <TouchableOpacity
          style={[styles.nextBtn, (selectedTags.length === 0 || loading) && styles.disabledBtn]}
          onPress={loadClips}
        >
          <Text style={styles.nextBtnText}>{loading ? 'Loading...' : 'Next: Review Clips →'}</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  const grouped = groupClipsByTag();
  const groupKeys = Object.keys(grouped);
  const totalClips = Object.values(grouped).reduce((sum, g) => sum + g.clips.length, 0);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <TouchableOpacity onPress={() => setStep('tags')} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Export Highlights</Text>
      <Text style={styles.subtitle}>Step 3 of 3 — Review clips ({totalClips} selected)</Text>
      <Text style={styles.hint}>Tap a clip to exclude it • Tap preview to watch</Text>

      {groupKeys.length === 0 ? (
        <Text style={styles.empty}>No clips found for selected tags</Text>
      ) : (
        groupKeys.map(tagId => {
          const { tag, clips: groupClips } = grouped[tagId];
          const allClips = clips.filter(c => c.tagIds.includes(tagId));
          return (
            <View key={tagId} style={styles.group}>
              <View style={styles.groupHeader}>
                <Text style={styles.groupTitle}>{tag.name}</Text>
                <Text style={styles.groupCount}>{groupClips.length} clips</Text>
              </View>
              {allClips.map((clip: any) => {
                const excluded = excludedClips.includes(clip.id);
                return (
                  <View key={clip.id} style={[styles.clipCard, excluded && styles.excludedCard]}>
                    <TouchableOpacity style={styles.clipInfo} onPress={() => toggleClip(clip.id)}>
                      <View style={styles.clipTop}>
                        <Text style={[styles.clipTime, excluded && styles.excludedText]}>
                          {formatTime(clip.start_time)} → {formatTime(clip.end_time)}
                        </Text>
                        <Text style={styles.clipDuration}>{getDuration(clip.start_time, clip.end_time)}</Text>
                        {clip.is_starred && <Text style={styles.star}>★</Text>}
                        {excluded && <Text style={styles.excludedLabel}>Excluded</Text>}
                      </View>
                      <Text style={[styles.clipMeta, excluded && styles.excludedText]}>
                        {clip.gameTitle} • {clip.videoLabel}
                      </Text>
                      <Text style={[styles.clipTags, excluded && styles.excludedText]}>
                        {clip.matchingTags.map((t: any) => t.name).join(', ')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.previewBtn}
                      onPress={() => router.push({
                        pathname: '/tagging',
                        params: {
                          videoId: clip.video_id,
                          url: clip.videoUrl,
                          label: clip.videoLabel,
                          startAt: clip.start_time,
                        }
                      })}
                    >
                      <Text style={styles.previewBtnText}>▶</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          );
        })
      )}

      {totalClips > 0 && (
        <TouchableOpacity
          style={styles.exportBtn}
          onPress={() => Alert.alert('Export', `Ready to export ${totalClips} clips! Video processing coming soon.`)}
        >
          <Text style={styles.exportBtnText}>🎬 Export {totalClips} Clips</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 20, paddingTop: 60 },
  back: { marginBottom: 16 },
  backText: { color: '#534AB7', fontSize: 16 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 8 },
  hint: { fontSize: 12, color: '#aaa', marginBottom: 20 },
  selectCard: { backgroundColor: '#f5f5f5', borderRadius: 12, padding: 16, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  selectedCard: { backgroundColor: '#534AB7' },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  cardSub: { fontSize: 12, color: '#888', marginTop: 2 },
  selectedText: { color: '#fff' },
  check: { color: '#fff', fontSize: 18, fontWeight: '700' },
  nextBtn: { backgroundColor: '#534AB7', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
  disabledBtn: { backgroundColor: '#ccc' },
  nextBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: '#888', marginBottom: 8, letterSpacing: 0.5 },
  tagGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagBtn: { backgroundColor: '#f0f0f0', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  tagBtnSelected: { backgroundColor: '#534AB7' },
  tagBtnText: { fontSize: 13, color: '#333', fontWeight: '500' },
  tagBtnTextSelected: { color: '#fff' },
  group: { marginBottom: 24 },
  groupHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  groupTitle: { fontSize: 16, fontWeight: '700', color: '#534AB7' },
  groupCount: { fontSize: 12, color: '#888' },
  clipCard: { backgroundColor: '#f5f5f5', borderRadius: 10, padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center' },
  excludedCard: { backgroundColor: '#ffe8e8', opacity: 0.6 },
  clipInfo: { flex: 1 },
  clipTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  clipTime: { fontSize: 15, fontWeight: '600' },
  clipDuration: { fontSize: 11, color: '#888', backgroundColor: '#e0e0e0', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  star: { fontSize: 14, color: '#EF9F27' },
  excludedLabel: { fontSize: 11, color: '#e00', fontWeight: '600' },
  excludedText: { color: '#999' },
  clipMeta: { fontSize: 12, color: '#888', marginBottom: 2 },
  clipTags: { fontSize: 12, color: '#534AB7', fontWeight: '500' },
  previewBtn: { backgroundColor: '#534AB7', borderRadius: 8, width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  previewBtnText: { color: '#fff', fontSize: 14 },
  exportBtn: { backgroundColor: '#1D9E75', borderRadius: 12, padding: 18, alignItems: 'center', marginTop: 8 },
  exportBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  empty: { textAlign: 'center', color: '#888', marginTop: 40, fontSize: 16 },
});
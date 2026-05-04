import { useTeamContext } from '@/context';
import { supabase } from '@/supabase';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function TaggingScreen() {
  const params = useLocalSearchParams();
  const videoId = Array.isArray(params.videoId) ? params.videoId[0] : params.videoId;
  const videoUrl = Array.isArray(params.url) ? params.url[0] : params.url;
  const videoLabel = Array.isArray(params.label) ? params.label[0] : params.label;
  const startAt = params.startAt ? parseFloat(Array.isArray(params.startAt) ? params.startAt[0] : params.startAt as string) : null;

  const { profileId, teamId } = useTeamContext();

  const player = useVideoPlayer(videoUrl, player => {
    player.pause();
    if (startAt !== null) {
      setTimeout(() => { player.currentTime = startAt; }, 800);
    }
  });

  const [startTime, setStartTime] = useState<number | null>(null);
  const [endTime, setEndTime] = useState<number | null>(null);
  const [isHighlight, setIsHighlight] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tags, setTags] = useState<Record<string, any[]>>({ offense: [], defense: [], plays: [], players: [] });
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchTags(); }, [profileId, teamId]);

  async function fetchTags() {
    let query = supabase.from('tags').select('*').order('sort_order');
    if (profileId && teamId && teamId !== 'all') {
      query = query.or(`scope.eq.global,and(scope.eq.player,profile_id.eq.${profileId}),and(scope.eq.team,team_id.eq.${teamId})`);
    } else if (profileId) {
      query = query.or(`scope.eq.global,and(scope.eq.player,profile_id.eq.${profileId})`);
    } else {
      query = query.eq('scope', 'global');
    }
    const { data } = await query;
    if (!data) return;
    const grouped: Record<string, any[]> = { offense: [], defense: [], plays: [], players: [] };
    data.forEach((t: any) => { if (grouped[t.category]) grouped[t.category].push(t); });
    setTags(grouped);
  }

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function getCurrentTime() {
    return player.currentTime || 0;
  }

  function toggleTag(tagId: string) {
    setSelectedTags(prev =>
      prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
    );
  }

  async function saveClip() {
    if (startTime === null || endTime === null) {
      Alert.alert('Missing times', 'Please mark a start and end time first.');
      return;
    }
    if (endTime <= startTime) {
      Alert.alert('Invalid clip', 'End time must be after start time.');
      return;
    }
    setSaving(true);

    const { data: clip, error: clipError } = await supabase
      .from('clips')
      .insert({
        video_id: videoId,
        start_time: startTime,
        end_time: endTime,
        is_starred: isHighlight,
        note: '',
      })
      .select()
      .single();

    if (clipError) {
      Alert.alert('Error saving clip', clipError.message);
      setSaving(false);
      return;
    }

    if (selectedTags.length > 0) {
      for (const tagId of selectedTags) {
        const { error: tagError } = await supabase
          .from('clip_tags')
          .insert({ clip_id: clip.id, tag_id: tagId });
        if (tagError) {
          Alert.alert('Error saving tag', tagError.message);
          setSaving(false);
          return;
        }
      }
    }

    Alert.alert('Saved!', `Clip saved with ${selectedTags.length} tags!`, [{
      text: 'OK', onPress: () => {
        setStartTime(null);
        setEndTime(null);
        setIsHighlight(false);
        setSelectedTags([]);
      }
    }]);
    setSaving(false);
  }

  const CATEGORIES = [
    { key: 'offense', label: 'Offense', color: '#1a6fd4', bg: '#e8f0fe' },
    { key: 'defense', label: 'Defense', color: '#c0392b', bg: '#fde8e8' },
    { key: 'plays', label: 'Plays', color: '#1e8449', bg: '#e8f8ed' },
    { key: 'players', label: 'Players', color: '#7d3c98', bg: '#f5eef8' },
  ];

  const hasClipMarked = startTime !== null && endTime !== null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.topRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.saveBtn, (!hasClipMarked || saving) && styles.saveBtnDisabled]}
          onPress={saveClip}
          disabled={!hasClipMarked || saving}
        >
          <Text style={styles.saveBtnText}>{saving ? 'Saving...' : 'Save Clip'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>{videoLabel}</Text>

      <VideoView
        player={player}
        style={styles.video}
        allowsFullscreen
        allowsPictureInPicture
      />

      {startAt !== null && (
        <Text style={styles.previewNote}>Previewing from {formatTime(startAt)}</Text>
      )}

      <View style={styles.controls}>
        <TouchableOpacity style={styles.startBtn} onPress={() => setStartTime(getCurrentTime())}>
          <Text style={styles.btnText}>
            {startTime !== null ? `Start ${formatTime(startTime)}` : 'Mark Start'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.endBtn} onPress={() => setEndTime(getCurrentTime())}>
          <Text style={styles.btnText}>
            {endTime !== null ? `End ${formatTime(endTime)}` : 'Mark End'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.highlightBtn, isHighlight && styles.highlightActive]}
          onPress={() => setIsHighlight(!isHighlight)}
        >
          <Text style={[styles.highlightText, isHighlight && { color: '#fff' }]}>
            {isHighlight ? 'Highlighted!' : 'Highlight'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.columns}>
        {CATEGORIES.map(cat => (
          <View key={cat.key} style={styles.column}>
            <Text style={[styles.colHeader, { color: cat.color }]}>{cat.label}</Text>
            {tags[cat.key].length === 0 ? (
              <Text style={styles.noTags}>No tags</Text>
            ) : (
              tags[cat.key].map((tag: any) => (
                <TouchableOpacity
                  key={tag.id}
                  onPress={() => toggleTag(tag.id)}
                  style={[styles.tag, { backgroundColor: selectedTags.includes(tag.id) ? cat.color : cat.bg }]}
                >
                  <Text style={[styles.tagText, { color: selectedTags.includes(tag.id) ? '#fff' : cat.color }]}>
                    {tag.name}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 16, paddingTop: 56 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  back: {},
  backText: { color: '#534AB7', fontSize: 16 },
  saveBtn: { backgroundColor: '#534AB7', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 16 },
  saveBtnDisabled: { backgroundColor: '#ccc' },
  saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  video: { width: '100%', height: 200, backgroundColor: '#000', borderRadius: 12, marginBottom: 8 },
  previewNote: { fontSize: 12, color: '#534AB7', marginBottom: 8, textAlign: 'center' },
  controls: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  startBtn: { flex: 1, backgroundColor: '#1D9E75', borderRadius: 8, padding: 10, alignItems: 'center' },
  endBtn: { flex: 1, backgroundColor: '#D85A30', borderRadius: 8, padding: 10, alignItems: 'center' },
  highlightBtn: { flex: 1, borderWidth: 2, borderColor: '#EF9F27', borderRadius: 8, padding: 10, alignItems: 'center' },
  highlightActive: { backgroundColor: '#EF9F27' },
  highlightText: { color: '#BA7517', fontSize: 11, fontWeight: '600' },
  btnText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  columns: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  column: { flex: 1 },
  colHeader: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', marginBottom: 6 },
  tag: { padding: 7, borderRadius: 6, marginBottom: 4 },
  tagText: { fontSize: 10, fontWeight: '500', textAlign: 'center' },
  noTags: { fontSize: 10, color: '#aaa', textAlign: 'center' },
});
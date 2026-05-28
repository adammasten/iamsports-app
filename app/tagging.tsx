import { useTeamContext } from '@/context';
import { getCachedPathSync, touch as touchVideoCache } from '@/lib/native/video-cache';
import { supabase } from '@/supabase';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function TaggingScreen() {
  const params = useLocalSearchParams();
  const videoId = Array.isArray(params.videoId) ? params.videoId[0] : params.videoId;
  const remoteUrl = Array.isArray(params.url) ? params.url[0] : params.url;
  const videoLabel = Array.isArray(params.label) ? params.label[0] : params.label;
  const startAt = params.startAt ? parseFloat(Array.isArray(params.startAt) ? params.startAt[0] : params.startAt as string) : null;

  const { profileId, teamId } = useTeamContext();

  // Prefer the on-device cached file at player init; fall back to remote URL
  // if the manifest doesn't have an entry (or we're on web).
  const initialSource = (videoId ? getCachedPathSync(videoId) : null) ?? remoteUrl;

  const player = useVideoPlayer(initialSource, player => {
    player.pause();
    if (startAt !== null) {
      setTimeout(() => { player.currentTime = startAt; }, 800);
    }
  });

  useEffect(() => {
    if (videoId) touchVideoCache(videoId).catch(() => {});
  }, [videoId]);

  const [startTime, setStartTime] = useState<number | null>(null);
  const [endTime, setEndTime] = useState<number | null>(null);
  const [isHighlight, setIsHighlight] = useState(false);
  const [clipLevelTags, setClipLevelTags] = useState<string[]>([]);
  const [bundles, setBundles] = useState<string[][]>([]);
  const [activeSection, setActiveSection] = useState<'clip' | number>('clip');
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

  // Tags currently in the active section (used to highlight tag picker)
  function getActiveTags(): string[] {
    if (activeSection === 'clip') return clipLevelTags;
    return bundles[activeSection] || [];
  }

  // Look up a tag's name by id (for displaying chips above)
  function getTagName(tagId: string): string {
    for (const cat of Object.values(tags)) {
      const t = cat.find((tag: any) => tag.id === tagId);
      if (t) return t.name;
    }
    return '?';
  }

  // Toggle a tag in the active section only
  function toggleTag(tagId: string) {
    if (activeSection === 'clip') {
      setClipLevelTags(prev =>
        prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
      );
    } else {
      const idx = activeSection;
      setBundles(prev => prev.map((bundle, i) => {
        if (i !== idx) return bundle;
        return bundle.includes(tagId) ? bundle.filter(id => id !== tagId) : [...bundle, tagId];
      }));
    }
  }

  // Create a new empty bundle and make it active
  function addBundle() {
    const newIdx = bundles.length;
    setBundles(prev => [...prev, []]);
    setActiveSection(newIdx);
  }

  // Remove a bundle (confirms first if non-empty)
  function removeBundle(idx: number) {
    const bundle = bundles[idx];
    const doRemove = () => {
      setBundles(prev => prev.filter((_, i) => i !== idx));
      if (activeSection === idx) {
        setActiveSection('clip');
      } else if (typeof activeSection === 'number' && activeSection > idx) {
        setActiveSection(activeSection - 1);
      }
    };
    if (bundle.length > 0) {
      Alert.alert(
        'Remove bundle?',
        `Bundle ${idx + 1} has ${bundle.length} tag(s). This can't be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: doRemove },
        ]
      );
    } else {
      doRemove();
    }
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

    // Build all clip_tags rows in one batch: clip-level (bundle_number=0) + bundles (1, 2, 3...)
    const rows: any[] = [];
    for (const tagId of clipLevelTags) {
      rows.push({ clip_id: clip.id, tag_id: tagId, bundle_number: 0 });
    }
    bundles.forEach((bundle, idx) => {
      const bundleNum = idx + 1;
      for (const tagId of bundle) {
        rows.push({ clip_id: clip.id, tag_id: tagId, bundle_number: bundleNum });
      }
    });

    if (rows.length > 0) {
      const { error: tagError } = await supabase.from('clip_tags').insert(rows);
      if (tagError) {
        Alert.alert('Error saving tags', tagError.message);
        setSaving(false);
        return;
      }
    }

    const nonEmptyBundles = bundles.filter(b => b.length > 0).length;
    Alert.alert(
      'Saved!',
      `Clip saved with ${rows.length} tag(s)${nonEmptyBundles > 0 ? ` across ${nonEmptyBundles} bundle(s)` : ''}.`,
      [{
        text: 'OK',
        onPress: () => {
          setStartTime(null);
          setEndTime(null);
          setIsHighlight(false);
          setClipLevelTags([]);
          setBundles([]);
          setActiveSection('clip');
        }
      }]
    );
    setSaving(false);
  }

  const CATEGORIES = [
    { key: 'offense', label: 'Offense', color: '#1a6fd4', bg: '#e8f0fe' },
    { key: 'defense', label: 'Defense', color: '#c0392b', bg: '#fde8e8' },
    { key: 'plays', label: 'Plays', color: '#1e8449', bg: '#e8f8ed' },
    { key: 'players', label: 'Players', color: '#7d3c98', bg: '#f5eef8' },
  ];

  const hasClipMarked = startTime !== null && endTime !== null;
  const activeTags = getActiveTags();

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

      {/* Tag groups (clip-level + bundles) */}
      <View style={styles.bundlesContainer}>
        <Text style={styles.bundlesHeader}>TAG GROUPS</Text>
        <Text style={styles.bundlesHint}>
          Clip-level applies to the whole play. Bundles group tags that go together (e.g. player + action).
        </Text>

        {/* Clip-level section */}
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => setActiveSection('clip')}
          style={[styles.tagSection, activeSection === 'clip' && styles.tagSectionActive]}
        >
          <View style={styles.tagSectionHeader}>
            <Text style={[styles.tagSectionLabel, activeSection === 'clip' && styles.tagSectionLabelActive]}>
              CLIP-LEVEL{activeSection === 'clip' ? ' • ACTIVE' : ''}
            </Text>
          </View>
          <View style={styles.chipsContainer}>
            {clipLevelTags.length === 0 ? (
              <Text style={styles.emptyHint}>
                {activeSection === 'clip' ? 'Tap tags below to add here' : 'Empty'}
              </Text>
            ) : (
              clipLevelTags.map(tagId => (
                <View key={tagId} style={styles.chip}>
                  <Text style={styles.chipText}>{getTagName(tagId)}</Text>
                </View>
              ))
            )}
          </View>
        </TouchableOpacity>

        {/* Each bundle */}
        {bundles.map((bundle, idx) => (
          <View
            key={idx}
            style={[styles.tagSection, activeSection === idx && styles.tagSectionActive]}
          >
            <View style={styles.tagSectionHeader}>
              <TouchableOpacity onPress={() => setActiveSection(idx)} style={{ flex: 1 }}>
                <Text style={[styles.tagSectionLabel, activeSection === idx && styles.tagSectionLabelActive]}>
                  BUNDLE {idx + 1}{activeSection === idx ? ' • ACTIVE' : ''}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => removeBundle(idx)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.removeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={() => setActiveSection(idx)} activeOpacity={0.7}>
              <View style={styles.chipsContainer}>
                {bundle.length === 0 ? (
                  <Text style={styles.emptyHint}>
                    {activeSection === idx ? 'Tap tags below to add here' : 'Empty'}
                  </Text>
                ) : (
                  bundle.map(tagId => (
                    <View key={tagId} style={styles.chip}>
                      <Text style={styles.chipText}>{getTagName(tagId)}</Text>
                    </View>
                  ))
                )}
              </View>
            </TouchableOpacity>
          </View>
        ))}

        {/* Add new bundle */}
        <TouchableOpacity onPress={addBundle} style={styles.addBundleBtn}>
          <Text style={styles.addBundleText}>+ New Bundle</Text>
        </TouchableOpacity>
      </View>

      {/* Tag picker */}
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
                  style={[styles.tag, { backgroundColor: activeTags.includes(tag.id) ? cat.color : cat.bg }]}
                >
                  <Text style={[styles.tagText, { color: activeTags.includes(tag.id) ? '#fff' : cat.color }]}>
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

  bundlesContainer: { marginBottom: 12 },
  bundlesHeader: { fontSize: 11, fontWeight: '700', color: '#666', letterSpacing: 0.5, marginBottom: 4 },
  bundlesHint: { fontSize: 10, color: '#888', marginBottom: 8, fontStyle: 'italic' },
  tagSection: {
    borderWidth: 1.5,
    borderColor: '#e0e0e0',
    backgroundColor: '#fafafa',
    borderRadius: 8,
    padding: 8,
    marginBottom: 6,
  },
  tagSectionActive: {
    borderColor: '#534AB7',
    backgroundColor: '#f3f1ff',
  },
  tagSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  tagSectionLabel: { fontSize: 10, fontWeight: '700', color: '#888', letterSpacing: 0.5 },
  tagSectionLabelActive: { color: '#534AB7' },
  removeBtnText: { color: '#888', fontSize: 14, fontWeight: '600', paddingHorizontal: 4 },
  chipsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, minHeight: 22 },
  chip: {
    backgroundColor: '#fff',
    borderColor: '#ddd',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  chipText: { fontSize: 10, color: '#333', fontWeight: '500' },
  emptyHint: { fontSize: 10, color: '#aaa', fontStyle: 'italic' },
  addBundleBtn: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#534AB7',
    borderStyle: 'dashed',
    borderRadius: 8,
    padding: 8,
    alignItems: 'center',
    marginTop: 2,
  },
  addBundleText: { color: '#534AB7', fontSize: 12, fontWeight: '600' },

  columns: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  column: { flex: 1 },
  colHeader: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', marginBottom: 6 },
  tag: { padding: 7, borderRadius: 6, marginBottom: 4 },
  tagText: { fontSize: 10, fontWeight: '500', textAlign: 'center' },
  noTags: { fontSize: 10, color: '#aaa', textAlign: 'center' },
});
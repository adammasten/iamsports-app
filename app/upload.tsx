import { useTeamContext } from '@/context';
import { pickVideo, uploadVideoToBucket, type PendingFile } from '@/lib/native/video-upload';
import { supabase } from '@/supabase';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Personal (no-team) video upload. Standalone video: game_id null, team_id null,
// owned by the uploader, optionally attributed to a kid (playerId param),
// visibility private_to_creator. After upload, jumps straight to tagging.
export default function UploadScreen() {
  const insets = useSafeAreaInsets();
  const { userId } = useTeamContext();
  const params = useLocalSearchParams();
  const playerId = (Array.isArray(params.playerId) ? params.playerId[0] : params.playerId) || null;

  const [pending, setPending] = useState<PendingFile | null>(null);
  const [label, setLabel] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  // After a successful upload we show a confirmation instead of force-jumping
  // into tagging — the user chooses to tag now or finish.
  const [done, setDone] = useState<{ videoId: string; url: string; label: string } | null>(null);

  async function pick() {
    const f = await pickVideo();
    if (f) setPending(f);
  }

  async function doUpload() {
    if (!pending) { await pick(); return; }
    if (!label.trim()) { Alert.alert('Add a label'); return; }
    if (!userId) { Alert.alert('Not signed in'); return; }
    setUploading(true);
    setProgress(0);
    try {
      const fileName = `personal-${userId}-${Date.now()}.mp4`;
      await uploadVideoToBucket(fileName, pending, setProgress);
      const { data, error } = await supabase
        .from('videos')
        .insert({
          game_id: null,
          team_id: null,
          uploaded_by_user_id: userId,
          player_id: playerId,
          url: fileName,
          label: label.trim(),
          sort_order: 0,
          visibility: 'private_to_creator',
        })
        .select('id')
        .single();
      if (error || !data) {
        Alert.alert('Upload error', error?.message ?? 'Failed to save video');
        setUploading(false);
        return;
      }
      // Confirm the upload landed, then let the user choose to tag now or finish
      // (replaces the old force-jump straight into tagging).
      setUploading(false);
      setDone({ videoId: data.id, url: fileName, label: label.trim() });
    } catch (e: any) {
      Alert.alert('Upload error', e?.message ?? 'Unknown');
      setUploading(false);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <TouchableOpacity onPress={() => router.back()} style={styles.back} disabled={uploading}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Upload video</Text>

      {done ? (
        <View style={styles.doneWrap}>
          <Text style={styles.doneCheck}>✓</Text>
          <Text style={styles.doneTitle}>Uploaded</Text>
          <Text style={styles.doneBody}>“{done.label}” is saved to Film Room. Tag it now to pull out clips, or find it later under “Unsorted footage.”</Text>
          <TouchableOpacity
            style={[styles.saveBtn, styles.doneBtn]}
            onPress={() => router.replace({
              pathname: '/tagging-overlay',
              params: { videoId: done.videoId, url: done.url, label: done.label, personal: '1' },
            })}
          >
            <Text style={styles.saveBtnText}>Tag it now</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.doneOutlineBtn, styles.doneBtn]} onPress={() => router.replace('/my-work')}>
            <Text style={styles.doneOutlineText}>Go to Film Room</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.doneSecondary} onPress={() => router.back()}>
            <Text style={styles.doneSecondaryText}>Done</Text>
          </TouchableOpacity>
        </View>
      ) : uploading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#534AB7" />
          <Text style={styles.progress}>{progress}%</Text>
        </View>
      ) : (
        <>
          <TouchableOpacity style={styles.pickBtn} onPress={pick}>
            <Text style={styles.pickText}>
              {pending ? 'Video selected ✓ — choose another' : 'Choose a video'}
            </Text>
          </TouchableOpacity>
          {pending ? (
            <>
              <Text style={styles.label}>Label</Text>
              <TextInput
                style={styles.input}
                value={label}
                onChangeText={setLabel}
                placeholder="e.g. Backyard reps"
                placeholderTextColor="#888"
                autoFocus
              />
              <TouchableOpacity
                style={[styles.saveBtn, !label.trim() && styles.saveBtnDisabled]}
                onPress={doUpload}
                disabled={!label.trim()}
              >
                <Text style={styles.saveBtnText}>Upload</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingHorizontal: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  progress: { color: '#fff', fontSize: 18, marginTop: 16 },
  back: { paddingVertical: 8 },
  backText: { color: '#534AB7', fontSize: 16 },
  title: { color: '#fff', fontSize: 28, fontWeight: '700', marginBottom: 24, marginTop: 8 },
  pickBtn: { backgroundColor: '#1a1a1a', borderRadius: 8, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  pickText: { color: '#534AB7', fontSize: 16, fontWeight: '600' },
  label: { color: '#aaa', fontSize: 13, fontWeight: '600', marginTop: 20, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: '#1a1a1a', borderRadius: 8, padding: 14, fontSize: 16, borderWidth: 1, borderColor: '#333', color: '#fff' },
  saveBtn: { backgroundColor: '#534AB7', borderRadius: 8, padding: 16, alignItems: 'center', marginTop: 18 },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  doneWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 40 },
  doneCheck: { color: '#2e7d32', fontSize: 56, fontWeight: '800', lineHeight: 60 },
  doneTitle: { color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 8 },
  doneBody: { color: '#aaa', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 10, marginBottom: 8, paddingHorizontal: 12 },
  doneBtn: { alignSelf: 'stretch', marginTop: 12 },
  doneOutlineBtn: { borderRadius: 8, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#534AB7' },
  doneOutlineText: { color: '#534AB7', fontSize: 16, fontWeight: '600' },
  doneSecondary: { padding: 14, marginTop: 4 },
  doneSecondaryText: { color: '#888', fontSize: 15, fontWeight: '600' },
});

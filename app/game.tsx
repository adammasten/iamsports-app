import { useTeamContext } from '@/context';
import { makeVideoLabel } from '@/lib/core/upload-meta';
import { pendingFileSize, pickVideo, uploadVideoToBucket } from '@/lib/native/video-upload';
import { requirePermission } from './permissionGuard';
import { supabase } from '@/supabase';
import { router, useLocalSearchParams } from 'expo-router';
import { goBackOrHome } from '@/lib/nav';
import { useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

// Note: the per-video "Save Offline" badge used to live here — it moved to the
// game card on my-work.tsx (Film Room) as a single per-GAME action. Videos on
// this screen are the tag/clip workflow only.

export default function GameScreen() {
  const params = useLocalSearchParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const title = Array.isArray(params.title) ? params.title[0] : params.title;
  const { userId } = useTeamContext();
  const [videos, setVideos] = useState<any[]>([]);
  // The GAME's own team_id (from its row), used for the video insert — never the
  // active team, which can differ from the game's team.
  const [gameTeamId, setGameTeamId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showLabelForm, setShowLabelForm] = useState(false);
  const [videoLabel, setVideoLabel] = useState('');
  const [pendingFile, setPendingFile] = useState<any>(null);
  // Persistent "it worked / here's where it is" confirmation after an upload.
  const [justUploaded, setJustUploaded] = useState<string | null>(null);
  // Inline per-video label rename (Q1 → Q3): which video + working draft.
  const [renamingVideoId, setRenamingVideoId] = useState<string | null>(null);
  const [videoDraft, setVideoDraft] = useState('');

  useEffect(() => {
    if (id) { fetchGame(); fetchVideos(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function fetchVideos() {
    const { data, error } = await supabase.from('videos').select('*').eq('game_id', id).order('sort_order');
    if (error) Alert.alert('Error', error.message);
    else setVideos(data || []);
  }

  // Inline rename of a single video's LABEL (per-video, e.g. Q1 → Q3) — distinct
  // from the game's title. Owner/coach only (videos_update RLS). Optimistic.
  function startVideoRename(video: any) {
    setRenamingVideoId(video.id);
    setVideoDraft(video.label);
  }

  async function commitVideoRename(video: any) {
    const next = videoDraft.trim();
    setRenamingVideoId(null);
    if (!next || next === video.label) return;
    setVideos(prev => prev.map(v => (v.id === video.id ? { ...v, label: next } : v)));
    const { error } = await supabase.from('videos').update({ label: next }).eq('id', video.id);
    if (error) {
      setVideos(prev => prev.map(v => (v.id === video.id ? { ...v, label: video.label } : v)));
      Alert.alert('Error', error.message);
    }
  }

  async function fetchGame() {
    // Source team_id from the GAME's own row. RLS (games_read) only returns the
    // row to a member of that team, so this also gates who can add a video.
    const { data } = await supabase.from('games').select('team_id').eq('id', id).single();
    setGameTeamId(data?.team_id ?? null);
  }

  async function startPick() {
    setJustUploaded(null);
    const f = await pickVideo();
    if (f) {
      setPendingFile(f);
      setShowLabelForm(true);
    }
  }

  async function uploadVideo() {
    if (!pendingFile) { Alert.alert('Choose a video first'); return; }
    // team_id comes from the GAME's own row (fetchGame), never the active team —
    // they can differ (Film Room entry, or a mid-flow team switch). A game with
    // no readable team is a broken state: block and surface it, never misfile.
    if (!userId) { Alert.alert('Not signed in'); return; }
    if (!gameTeamId) {
      Alert.alert('Couldn’t determine this game’s team — can’t add video');
      return;
    }
    if (!(await requirePermission(gameTeamId, 'upload_video'))) return;
    // Blank label → the shared "{date} {index}" default (index continues from the
    // game's current video count, in sync with sort_order). A typed label wins.
    const finalLabel = videoLabel.trim() || makeVideoLabel('', videos.length, true);
    setShowLabelForm(false);
    setUploading(true);
    setUploadProgress(0);

    let newVideoId: string | null = null;
    try {
      const fileName = `game-${id}-${Date.now()}.mp4`;
      console.log('[Upload] Starting upload for', fileName);

      // Row-first lifecycle: insert as 'uploading' with the expected byte size,
      // upload, then flip to 'ready'. A killed upload leaves an 'uploading' row
      // that reconciliation resolves — never a silent orphan. Store the bare
      // storage object key in url (bucket is private; consumers sign via
      // getSignedVideoUrl()).
      const bytes = await pendingFileSize(pendingFile);
      const { data: v, error } = await supabase.from('videos').insert({
        game_id: id,
        team_id: gameTeamId,
        uploaded_by_user_id: userId,
        url: fileName,
        label: finalLabel,
        sort_order: videos.length,
        upload_status: 'uploading',
        upload_bytes: bytes,
      }).select('id').single();
      if (error || !v) throw new Error(error?.message ?? 'Failed to save video');
      newVideoId = v.id;

      await uploadVideoToBucket(fileName, pendingFile, setUploadProgress, bytes);

      const { error: flipErr } = await supabase.from('videos')
        .update({ upload_status: 'ready' }).eq('id', newVideoId);
      // Non-fatal: the object is up, so reconciliation size-verifies and flips it.
      if (flipErr) console.warn('[Upload] ready-flip failed, leaving for reconcile:', flipErr.message);

      setJustUploaded(finalLabel);
      fetchVideos();
      setVideoLabel('');
      setPendingFile(null);
    } catch (e: any) {
      console.error('[Upload] Catch error:', e);
      // Surface the failure AND mark the row 'failed' (visible + deletable) so a
      // half-upload never hides as a silent orphan. Invariant 5.
      if (newVideoId) {
        await supabase.from('videos').update({ upload_status: 'failed' }).eq('id', newVideoId)
          .then(undefined, () => {});
        fetchVideos();
      }
      Alert.alert(
        'Upload Error',
        `${e?.message || 'Unknown'}\n${String(e?.stack || '').slice(0, 300)}`
      );
    } finally {
      setTimeout(() => {
        setUploading(false);
        setUploadProgress(0);
      }, 1000);
    }
  }

  async function deleteVideo(videoId: string) {
    Alert.alert('Delete Video', 'Delete this video?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await supabase.from('videos').delete().eq('id', videoId);
          fetchVideos();
        }
      }
    ]);
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={goBackOrHome} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>{title}</Text>

      {!uploading && !showLabelForm && (
        <TouchableOpacity
          style={[styles.uploadBtn, !gameTeamId && styles.uploadBtnDisabled]}
          onPress={startPick}
          disabled={!gameTeamId}
        >
          <Text style={styles.uploadText}>+ Upload Video</Text>
        </TouchableOpacity>
      )}

      {showLabelForm && (
        <View style={styles.labelForm}>
          <Text style={styles.labelTitle}>Label this video</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Q1, Q2, Halftime"
            value={videoLabel}
            onChangeText={setVideoLabel}
            autoFocus
          />
          <TouchableOpacity style={styles.uploadBtn} onPress={uploadVideo}>
            <Text style={styles.uploadText}>Start Upload</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setShowLabelForm(false); setPendingFile(null); }}>
            <Text style={styles.cancel}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {uploading && (
        <View style={styles.progressContainer}>
          <View style={[styles.progressBar, { width: `${uploadProgress}%` as any }]} />
          <Text style={styles.progressText}>
            {uploadProgress < 100 ? `${uploadProgress}% uploaded — keep app open!` : 'Upload complete! ✅'}
          </Text>
        </View>
      )}

      {justUploaded && !uploading && !showLabelForm && (
        <View style={styles.uploadedBanner}>
          <Text style={styles.uploadedTitle}>✓ Uploaded</Text>
          <Text style={styles.uploadedBody}>
            “{justUploaded}” is saved to this game. Tap it below to tag it — all your footage lives in Film Room.
          </Text>
        </View>
      )}

      {videos.length === 0 ? (
        <Text style={styles.empty}>No videos yet. Upload your first one!</Text>
      ) : (
        <FlatList
          data={videos}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.videoCard}>
              {renamingVideoId === item.id ? (
                <View style={styles.videoCardMain}>
                  <TextInput
                    style={styles.videoRenameInput}
                    value={videoDraft}
                    onChangeText={setVideoDraft}
                    autoFocus
                    selectTextOnFocus
                    returnKeyType="done"
                    onSubmitEditing={() => commitVideoRename(item)}
                    onBlur={() => commitVideoRename(item)}
                  />
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.videoCardMain}
                  onPress={() => item.upload_status && item.upload_status !== 'ready'
                    ? Alert.alert(item.label, item.upload_status === 'uploading' ? 'Still uploading — check back in a moment.' : 'This upload didn’t finish.', [
                        { text: 'Delete', style: 'destructive', onPress: () => deleteVideo(item.id) },
                        { text: 'Cancel', style: 'cancel' },
                      ])
                    : Alert.alert(item.label, 'What would you like to do?', [
                        { text: 'Tag Video', onPress: () => router.push({ pathname: '/tagging-overlay', params: { videoId: item.id, url: item.url, label: item.label } }) },
                        { text: 'View Clips', onPress: () => router.push({ pathname: '/clips', params: { videoId: item.id, label: item.label } }) },
                        { text: 'Rename', onPress: () => startVideoRename(item) },
                        { text: 'Cancel', style: 'cancel' }
                      ])}
                  onLongPress={() => deleteVideo(item.id)}
                >
                  <Text style={styles.videoLabel}>{item.label}</Text>
                  <Text style={styles.videoHint}>
                    {item.upload_status === 'uploading' ? 'Uploading…' : item.upload_status === 'failed' ? 'Upload didn’t finish · tap to delete' : 'Tap for options • Hold to delete'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 60, backgroundColor: '#fff' },
  back: { marginBottom: 16 },
  backText: { color: '#534AB7', fontSize: 16 },
  title: { fontSize: 26, fontWeight: '700', marginBottom: 24 },
  uploadBtn: { backgroundColor: '#534AB7', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 12 },
  uploadBtnDisabled: { opacity: 0.5 },
  uploadText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  uploadedBanner: { backgroundColor: '#e8f5e9', borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#a5d6a7' },
  uploadedTitle: { color: '#2e7d32', fontSize: 15, fontWeight: '800', marginBottom: 4 },
  uploadedBody: { color: '#33691e', fontSize: 13, lineHeight: 18 },
  labelForm: { backgroundColor: '#f5f5f5', borderRadius: 12, padding: 16, marginBottom: 16 },
  labelTitle: { fontSize: 16, fontWeight: '600', marginBottom: 10 },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 12, marginBottom: 10, fontSize: 16, borderWidth: 1, borderColor: '#ddd' },
  cancel: { textAlign: 'center', color: '#888', marginTop: 8, fontSize: 14 },
  progressContainer: { marginBottom: 16, backgroundColor: '#f0f0f0', borderRadius: 8, overflow: 'hidden', height: 44, justifyContent: 'center' },
  progressBar: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#534AB7', borderRadius: 8 },
  progressText: { textAlign: 'center', fontSize: 12, color: '#fff', fontWeight: '600', zIndex: 1 },
  videoCard: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: '#f5f5f5', borderRadius: 12, marginBottom: 12, overflow: 'hidden' },
  videoCardMain: { flex: 1, padding: 16 },
  videoLabel: { fontSize: 18, fontWeight: '600', marginBottom: 4 },
  videoRenameInput: {
    fontSize: 18, fontWeight: '600', color: '#000', padding: 0,
    borderBottomWidth: 1, borderBottomColor: '#534AB7',
  },
  videoHint: { fontSize: 12, color: '#aaa' },
  empty: { textAlign: 'center', color: '#888', marginTop: 60, fontSize: 16 },
});
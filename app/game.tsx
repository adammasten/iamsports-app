import { useTeamContext } from '@/context';
import { CacheStatus, getManifest, prefetch, remove as removeFromCache, subscribe } from '@/lib/native/video-cache';
import { makeVideoLabel } from '@/lib/core/upload-meta';
import { pickVideo, uploadVideoToBucket } from '@/lib/native/video-upload';
import { supabase } from '@/supabase';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

function badgeProps(status: CacheStatus): { label: string; bg: string; fg: string; pressable: boolean } {
  switch (status) {
    case 'cached':      return { label: '✓ Offline',      bg: '#e8f5e9', fg: '#2e7d32', pressable: true };
    case 'downloading': return { label: '⋯ Saving',       bg: '#ede9fe', fg: '#534AB7', pressable: false };
    case 'queued':      return { label: '⏸ Queued',       bg: '#f0f0f0', fg: '#666',    pressable: false };
    case 'error':       return { label: '↻ Retry',        bg: '#fdecea', fg: '#c62828', pressable: true };
    case 'idle':
    default:            return { label: '⬇ Save Offline', bg: '#ede9fe', fg: '#534AB7', pressable: true };
  }
}

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
  const [cacheState, setCacheState] = useState<Record<string, CacheStatus>>({});
  // Persistent "it worked / here's where it is" confirmation after an upload.
  const [justUploaded, setJustUploaded] = useState<string | null>(null);

  useEffect(() => {
    if (id) { fetchGame(); fetchVideos(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const m = await getManifest();
      if (cancelled) return;
      setCacheState(prev => ({
        ...prev,
        ...Object.fromEntries(m.map(e => [e.videoId, 'cached' as CacheStatus])),
      }));
    })();
    const unsub = subscribe((videoId, status) => {
      setCacheState(prev => ({ ...prev, [videoId]: status }));
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  async function fetchVideos() {
    const { data, error } = await supabase.from('videos').select('*').eq('game_id', id).order('sort_order');
    if (error) Alert.alert('Error', error.message);
    else setVideos(data || []);
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
    // Blank label → the shared "{date} {index}" default (index continues from the
    // game's current video count, in sync with sort_order). A typed label wins.
    const finalLabel = videoLabel.trim() || makeVideoLabel('', videos.length, true);
    setShowLabelForm(false);
    setUploading(true);
    setUploadProgress(0);

    try {
      const fileName = `game-${id}-${Date.now()}.mp4`;
      console.log('[Upload] Starting upload for', fileName);

      await uploadVideoToBucket(fileName, pendingFile, setUploadProgress);

      // Store the bare storage path (object key), not a public URL. The bucket
      // is private; consumers mint a signed URL from this path via
      // getSignedVideoUrl(). Matches the format existing rows were migrated to.
      const { error } = await supabase.from('videos').insert({
        game_id: id,
        team_id: gameTeamId,
        uploaded_by_user_id: userId,
        url: fileName,
        label: finalLabel,
        sort_order: videos.length,
      });

      if (error) Alert.alert('Error', error.message);
      else {
        setJustUploaded(finalLabel);
        fetchVideos();
        setVideoLabel('');
        setPendingFile(null);
      }
    } catch (e: any) {
      console.error('[Upload] Catch error:', e);
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
      <TouchableOpacity onPress={() => router.back()} style={styles.back}>
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
          renderItem={({ item }) => {
            const status = cacheState[item.id] ?? 'idle';
            const badge = badgeProps(status);
            return (
              <View style={styles.videoCard}>
                <TouchableOpacity
                  style={styles.videoCardMain}
                  onPress={() => Alert.alert(item.label, 'What would you like to do?', [
                    { text: 'Tag Video', onPress: () => router.push({ pathname: '/tagging-overlay', params: { videoId: item.id, url: item.url, label: item.label } }) },
                    { text: 'View Clips', onPress: () => router.push({ pathname: '/clips', params: { videoId: item.id, label: item.label } }) },
                    { text: 'Cancel', style: 'cancel' }
                  ])}
                  onLongPress={() => deleteVideo(item.id)}
                >
                  <Text style={styles.videoLabel}>{item.label}</Text>
                  <Text style={styles.videoHint}>Tap for options • Hold to delete</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.cacheBadge, { backgroundColor: badge.bg }]}
                  onPress={() => {
                    if (status === 'idle' || status === 'error') {
                      prefetch(item.id, item.url);
                    } else if (status === 'cached') {
                      Alert.alert(
                        'Remove from device?',
                        'The video stays in the cloud — you can save it offline again later.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Remove', style: 'destructive', onPress: () => removeFromCache(item.id) },
                        ]
                      );
                    }
                  }}
                  disabled={!badge.pressable}
                  activeOpacity={badge.pressable ? 0.6 : 1}
                >
                  <Text style={[styles.cacheBadgeText, { color: badge.fg }]} numberOfLines={2}>{badge.label}</Text>
                </TouchableOpacity>
              </View>
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
  videoHint: { fontSize: 12, color: '#aaa' },
  cacheBadge: { width: 96, paddingHorizontal: 8, paddingVertical: 8, justifyContent: 'center', alignItems: 'center' },
  cacheBadgeText: { fontSize: 11, fontWeight: '600', textAlign: 'center' },
  empty: { textAlign: 'center', color: '#888', marginTop: 60, fontSize: 16 },
});
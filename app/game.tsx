import { supabase } from '@/supabase';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, FlatList, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as tus from 'tus-js-client';

// Direct storage hostname for better large-file performance per Supabase docs
const SUPABASE_STORAGE_URL = 'https://wscfpkaltajnrhiusoze.storage.supabase.co';
const CHUNK_SIZE = 15 * 1024 * 1024; // 15MB - safely under Cloudflare's 100s timeout

// Convert base64 string to Uint8Array for binary upload
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export default function GameScreen() {
  const params = useLocalSearchParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const title = Array.isArray(params.title) ? params.title[0] : params.title;
  const [videos, setVideos] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showLabelForm, setShowLabelForm] = useState(false);
  const [videoLabel, setVideoLabel] = useState('');
  const [pendingFile, setPendingFile] = useState<any>(null);

  useEffect(() => {
    if (id) fetchVideos();
  }, [id]);

  async function fetchVideos() {
    const { data, error } = await supabase.from('videos').select('*').eq('game_id', id).order('sort_order');
    if (error) Alert.alert('Error', error.message);
    else setVideos(data || []);
  }

  async function pickVideoMobile() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Please allow access to your photo library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsEditing: false,
      quality: 1,
    });
    if (result.canceled) return;
    setPendingFile({ uri: result.assets[0].uri, type: 'video/mp4', isWeb: false });
    setShowLabelForm(true);
  }

  function pickVideoWeb() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (file) {
        setPendingFile({ file, type: file.type, name: file.name, isWeb: true });
        setShowLabelForm(true);
      }
    };
    input.click();
  }

  // WEB upload path: tus-js-client (works great in browsers)
  async function uploadVideoWeb(fileName: string, fileBlob: Blob, accessToken: string) {
    return new Promise<void>((resolve, reject) => {
      const upload = new tus.Upload(fileBlob, {
        endpoint: `${SUPABASE_STORAGE_URL}/storage/v1/upload/resumable`,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: {
          authorization: `Bearer ${accessToken}`,
          'x-upsert': 'true',
        },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        metadata: {
          bucketName: 'Videos',
          objectName: fileName,
          contentType: 'video/mp4',
          cacheControl: '3600',
        },
        chunkSize: 6 * 1024 * 1024,
        onError: (error: any) => {
          console.error('Web TUS error:', error);
          reject(error);
        },
        onProgress: (bytesUploaded, bytesTotal) => {
          const percent = Math.round((bytesUploaded / bytesTotal) * 100);
          setUploadProgress(percent);
        },
        onSuccess: () => resolve(),
      });
      upload.start();
    });
  }

  // Upload a single chunk via PATCH with retries
  async function patchChunk(
    uploadUrl: string,
    bytes: Uint8Array,
    offset: number,
    accessToken: string
  ): Promise<void> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const resp = await fetch(uploadUrl, {
          method: 'PATCH',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'Tus-Resumable': '1.0.0',
            'Upload-Offset': String(offset),
            'Content-Type': 'application/offset+octet-stream',
          },
          body: bytes,
        });

        if (resp.ok || resp.status === 204) {
          return; // success
        }

        const body = await resp.text();
        throw new Error(`PATCH ${resp.status} at offset ${offset}: ${body.slice(0, 200)}`);
      } catch (e: any) {
        if (attempt === maxAttempts) throw e;
        console.log(`[Upload] Chunk retry ${attempt}/${maxAttempts} at offset ${offset}: ${e?.message}`);
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
  }

  // MOBILE upload: manual chunked TUS protocol
  async function uploadVideoMobile(fileName: string, fileUri: string, accessToken: string, fileSize: number) {
    // Step 1: Create the upload session
    console.log('[Upload] Creating TUS session for', fileSize, 'bytes');
    const createResp = await fetch(`${SUPABASE_STORAGE_URL}/storage/v1/upload/resumable`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'x-upsert': 'true',
        'Tus-Resumable': '1.0.0',
        'Upload-Length': String(fileSize),
        'Upload-Metadata': [
          `bucketName ${btoa('Videos')}`,
          `objectName ${btoa(fileName)}`,
          `contentType ${btoa('video/mp4')}`,
          `cacheControl ${btoa('3600')}`,
        ].join(','),
      },
    });

    if (!createResp.ok) {
      const body = await createResp.text();
      throw new Error(`Create upload failed: ${createResp.status} ${body.slice(0, 300)}`);
    }

    const uploadUrl = createResp.headers.get('location');
    if (!uploadUrl) throw new Error('No upload URL returned from Supabase');
    console.log('[Upload] Got upload URL, starting chunked upload');

    // Step 2: Upload chunks sequentially
    let offset = 0;
    let chunkNum = 0;
    const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);

    while (offset < fileSize) {
      const remaining = fileSize - offset;
      const currentChunkSize = Math.min(CHUNK_SIZE, remaining);
      chunkNum++;

      console.log(`[Upload] Chunk ${chunkNum}/${totalChunks} (offset ${offset}, size ${currentChunkSize})`);

      // Read chunk from disk (returns base64)
      const base64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
        position: offset,
        length: currentChunkSize,
      });

      // Convert to bytes
      const bytes = base64ToBytes(base64);

      // Upload it
      await patchChunk(uploadUrl, bytes, offset, accessToken);

      offset += currentChunkSize;
      const percent = Math.round((offset / fileSize) * 100);
      setUploadProgress(percent);
    }

    console.log('[Upload] All chunks uploaded successfully');
  }

  async function uploadVideo() {
    if (!pendingFile || !videoLabel) { Alert.alert('Please add a label'); return; }
    setShowLabelForm(false);
    setUploading(true);
    setUploadProgress(0);

    try {
      const fileName = `game-${id}-${Date.now()}.mp4`;
      console.log('[Upload] Starting upload for', fileName);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        Alert.alert('Not logged in', 'Please log in again.');
        setUploading(false);
        return;
      }

      if (pendingFile.isWeb) {
        await uploadVideoWeb(fileName, pendingFile.file, session.access_token);
      } else {
        const info = await FileSystem.getInfoAsync(pendingFile.uri, { size: true });
        if (!info.exists) {
          Alert.alert('File not found', 'Could not access the selected video.');
          setUploading(false);
          return;
        }
        const fileSize = (info as any).size as number;
        console.log('[Upload] File size:', fileSize, 'bytes');
        await uploadVideoMobile(fileName, pendingFile.uri, session.access_token, fileSize);
      }

      const { data: urlData } = supabase.storage.from('Videos').getPublicUrl(fileName);

      const { error } = await supabase.from('videos').insert({
        game_id: id,
        url: urlData.publicUrl,
        label: videoLabel,
        sort_order: videos.length,
      });

      if (error) Alert.alert('Error', error.message);
      else {
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
          style={styles.uploadBtn}
          onPress={Platform.OS === 'web' ? pickVideoWeb : pickVideoMobile}
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

      {videos.length === 0 ? (
        <Text style={styles.empty}>No videos yet. Upload your first one!</Text>
      ) : (
        <FlatList
          data={videos}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.videoCard}
              onPress={() => Alert.alert(item.label, 'What would you like to do?', [
                { text: 'Tag Video', onPress: () => router.push({ pathname: '/tagging', params: { videoId: item.id, url: item.url, label: item.label } }) },
                { text: 'View Clips', onPress: () => router.push({ pathname: '/clips', params: { videoId: item.id, label: item.label } }) },
                { text: 'Cancel', style: 'cancel' }
              ])}
              onLongPress={() => deleteVideo(item.id)}
            >
              <Text style={styles.videoLabel}>{item.label}</Text>
              <Text style={styles.videoHint}>Tap for options • Hold to delete</Text>
            </TouchableOpacity>
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
  uploadText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  labelForm: { backgroundColor: '#f5f5f5', borderRadius: 12, padding: 16, marginBottom: 16 },
  labelTitle: { fontSize: 16, fontWeight: '600', marginBottom: 10 },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 12, marginBottom: 10, fontSize: 16, borderWidth: 1, borderColor: '#ddd' },
  cancel: { textAlign: 'center', color: '#888', marginTop: 8, fontSize: 14 },
  progressContainer: { marginBottom: 16, backgroundColor: '#f0f0f0', borderRadius: 8, overflow: 'hidden', height: 44, justifyContent: 'center' },
  progressBar: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#534AB7', borderRadius: 8 },
  progressText: { textAlign: 'center', fontSize: 12, color: '#fff', fontWeight: '600', zIndex: 1 },
  videoCard: { backgroundColor: '#f5f5f5', borderRadius: 12, padding: 16, marginBottom: 12 },
  videoLabel: { fontSize: 18, fontWeight: '600', marginBottom: 4 },
  videoHint: { fontSize: 12, color: '#aaa' },
  empty: { textAlign: 'center', color: '#888', marginTop: 60, fontSize: 16 },
});
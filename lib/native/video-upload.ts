import { supabase } from '@/supabase';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Platform } from 'react-native';
import * as tus from 'tus-js-client';

export const SUPABASE_STORAGE_URL = 'https://wscfpkaltajnrhiusoze.storage.supabase.co';
const CHUNK_SIZE = 15 * 1024 * 1024; // 15MB chunks
const TOKEN_REFRESH_THRESHOLD_SEC = 300; // refresh if < 5 min left on token

export type PendingFile =
  | { isWeb: false; uri: string; type: string }
  | { isWeb: true; file: File; type: string; name: string };

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Get a fresh token, refreshing if it's close to expiring.
export async function getFreshToken(forceRefresh = false): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not logged in');

  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = session.expires_at || 0;
  const secondsLeft = expiresAt - nowSec;

  if (forceRefresh || secondsLeft < TOKEN_REFRESH_THRESHOLD_SEC) {
    console.log(`[Token] Refreshing (${secondsLeft}s left, forceRefresh=${forceRefresh})`);
    const { data: { session: refreshed }, error } = await supabase.auth.refreshSession();
    if (error || !refreshed) throw new Error(`Failed to refresh session: ${error?.message || 'unknown'}`);
    return refreshed.access_token;
  }

  return session.access_token;
}

// Pick a video — library on native, file input on web. Returns null if the user
// cancels or denies permission.
export async function pickVideo(): Promise<PendingFile | null> {
  if (Platform.OS === 'web') {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'video/*';
      input.onchange = (e: any) => {
        const file = e.target.files[0];
        resolve(file ? { isWeb: true, file, type: file.type, name: file.name } : null);
      };
      input.click();
    });
  }
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert('Permission needed', 'Please allow access to your photo library.');
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    allowsEditing: false,
    quality: 1,
  });
  if (result.canceled) return null;
  return { isWeb: false, uri: result.assets[0].uri, type: 'video/mp4' };
}

// Pick MULTIPLE videos at once (for building a game from several clips). Returns
// them in the order the OS reports (used as play order). Empty array if cancelled
// or permission denied.
export async function pickVideos(): Promise<PendingFile[]> {
  if (Platform.OS === 'web') {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'video/*';
      input.multiple = true;
      input.onchange = (e: any) => {
        const files: File[] = Array.from(e.target.files || []);
        resolve(files.map(file => ({ isWeb: true, file, type: file.type, name: file.name })));
      };
      input.click();
    });
  }
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert('Permission needed', 'Please allow access to your photo library.');
    return [];
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    allowsMultipleSelection: true,
    allowsEditing: false,
    quality: 1,
  });
  if (result.canceled) return [];
  return result.assets.map(a => ({ isWeb: false as const, uri: a.uri, type: 'video/mp4' }));
}

// Upload a single chunk via PATCH with retries + token refresh on auth errors.
async function patchChunk(uploadUrl: string, bytes: Uint8Array, offset: number): Promise<void> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const token = await getFreshToken(attempt > 1);
    try {
      const resp = await fetch(uploadUrl, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${token}`,
          'Tus-Resumable': '1.0.0',
          'Upload-Offset': String(offset),
          'Content-Type': 'application/offset+octet-stream',
        },
        body: bytes,
      });
      if (resp.ok || resp.status === 204) return;
      const body = await resp.text();
      throw new Error(`PATCH ${resp.status} at offset ${offset}: ${body.slice(0, 200)}`);
    } catch (e: any) {
      if (attempt === maxAttempts) throw e;
      console.log(`[Upload] Chunk retry ${attempt}/${maxAttempts} at offset ${offset}: ${e?.message}`);
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
}

async function uploadVideoWeb(
  fileName: string,
  fileBlob: Blob,
  accessToken: string,
  onProgress: (pct: number) => void
): Promise<void> {
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
        onProgress(Math.round((bytesUploaded / bytesTotal) * 100));
      },
      onSuccess: () => resolve(),
    });
    upload.start();
  });
}

async function uploadVideoMobile(
  fileName: string,
  fileUri: string,
  fileSize: number,
  onProgress: (pct: number) => void
): Promise<void> {
  const initialToken = await getFreshToken();
  console.log('[Upload] Creating TUS session for', fileSize, 'bytes');
  const createResp = await fetch(`${SUPABASE_STORAGE_URL}/storage/v1/upload/resumable`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${initialToken}`,
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

  let offset = 0;
  let chunkNum = 0;
  const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);

  while (offset < fileSize) {
    const remaining = fileSize - offset;
    const currentChunkSize = Math.min(CHUNK_SIZE, remaining);
    chunkNum++;

    console.log(`[Upload] Chunk ${chunkNum}/${totalChunks} (offset ${offset}, size ${currentChunkSize})`);

    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
      position: offset,
      length: currentChunkSize,
    });
    const bytes = base64ToBytes(base64);

    await patchChunk(uploadUrl, bytes, offset);

    offset += currentChunkSize;
    onProgress(Math.round((offset / fileSize) * 100));
  }

  console.log('[Upload] All chunks uploaded successfully');
}

// Upload a picked file to the 'Videos' bucket at <fileName>. Reports 0-100 via
// onProgress. Throws on failure. Bucket/path semantics are the caller's concern
// (the caller writes the videos row with whatever team_id/game_id/player_id).
export async function uploadVideoToBucket(
  fileName: string,
  pending: PendingFile,
  onProgress: (pct: number) => void
): Promise<void> {
  if (pending.isWeb) {
    const token = await getFreshToken();
    await uploadVideoWeb(fileName, pending.file, token, onProgress);
  } else {
    const info = await FileSystem.getInfoAsync(pending.uri, { size: true });
    if (!info.exists) throw new Error('Could not access the selected video.');
    const fileSize = (info as any).size as number;
    await uploadVideoMobile(fileName, pending.uri, fileSize, onProgress);
  }
}

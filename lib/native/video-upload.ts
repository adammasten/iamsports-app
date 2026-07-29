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

// Send ONE chunk via PATCH starting at `offset`. On success returns the server's
// authoritative Upload-Offset from the response header (or null if the server
// omitted it — the caller then falls back to offset+length, which is exact for a
// 2xx). Throws on network error or non-2xx so the caller can HEAD-resync + retry.
async function patchChunk(uploadUrl: string, bytes: Uint8Array, offset: number, token: string): Promise<number | null> {
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
  if (!resp.ok && resp.status !== 204) {
    const body = await resp.text();
    throw new Error(`PATCH ${resp.status} at offset ${offset}: ${body.slice(0, 200)}`);
  }
  const raw = resp.headers.get('upload-offset');
  if (raw == null) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

// HEAD the upload URL to read the server's current Upload-Offset — the TUS way to
// recover after a failed PATCH (the server may have consumed part of the body
// before the client saw an error, so its offset has advanced). Throws loudly if
// the offset can't be read; the caller must not retry blindly.
async function headUploadOffset(uploadUrl: string, token: string): Promise<number> {
  const resp = await fetch(uploadUrl, {
    method: 'HEAD',
    headers: {
      authorization: `Bearer ${token}`,
      'Tus-Resumable': '1.0.0',
    },
  });
  if (!resp.ok && resp.status !== 200 && resp.status !== 204) {
    throw new Error(`HEAD ${resp.status} on upload URL`);
  }
  const raw = resp.headers.get('upload-offset');
  const n = raw != null ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) throw new Error(`HEAD returned no valid Upload-Offset (got "${raw}")`);
  return n;
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
    // Log status/body directly — the thrown Error below is swallowed by the
    // caller, which turned a real failure into "Creating TUS session" then silence.
    console.error('[Upload] TUS create failed:', createResp.status, body.slice(0, 300));
    throw new Error(`Create upload failed: ${createResp.status} ${body.slice(0, 300)}`);
  }

  const uploadUrl = createResp.headers.get('location');
  if (!uploadUrl) throw new Error('No upload URL returned from Supabase');
  console.log('[Upload] Got upload URL, starting chunked upload');

  // Server-truth offset tracking. We NEVER advance `offset` by local arithmetic;
  // we adopt the server's Upload-Offset from each PATCH response (falling back to
  // offset+length only if a 2xx omits the header, which is exact for a success).
  // On any PATCH failure we HEAD the upload URL to learn the server's real offset
  // (it can consume part of the body before the client sees an error), reconcile
  // it against the chunk we tried, then re-read from there — the fix for the
  // "409 Upload-Offset conflict on retry" bug.
  const MAX_ATTEMPTS = 3;
  let offset = 0;
  let attempt = 0;

  while (offset < fileSize) {
    const chunkStart = offset;
    const currentChunkSize = Math.min(CHUNK_SIZE, fileSize - offset);
    console.log(`[Upload] Chunk at offset ${chunkStart} (size ${currentChunkSize}) of ${fileSize}`);

    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
      position: chunkStart,
      length: currentChunkSize,
    });
    const bytes = base64ToBytes(base64);
    const token = await getFreshToken(attempt > 0);

    try {
      const serverOffset = await patchChunk(uploadUrl, bytes, chunkStart, token);
      const next = serverOffset ?? chunkStart + currentChunkSize;
      if (next < chunkStart || next > fileSize) {
        throw new Error(`PATCH returned impossible Upload-Offset ${next} (chunk started ${chunkStart}, fileSize ${fileSize})`);
      }
      offset = next;      // server truth, not arithmetic
      attempt = 0;
      onProgress(Math.round((offset / fileSize) * 100));
    } catch (e: any) {
      attempt++;
      if (attempt >= MAX_ATTEMPTS) throw e;
      console.log(`[Upload] Chunk retry ${attempt}/${MAX_ATTEMPTS} near offset ${chunkStart}: ${e?.message}`);
      await new Promise(r => setTimeout(r, 2000 * attempt));

      // Recover the server's real offset before retrying, then re-read from there.
      const recoveryToken = await getFreshToken(true);
      let serverOffset: number;
      try {
        serverOffset = await headUploadOffset(uploadUrl, recoveryToken);
      } catch (headErr: any) {
        throw new Error(
          `Upload recovery failed: HEAD could not read the server offset after a chunk error near ${chunkStart} ` +
          `(${headErr?.message}); original error: ${e?.message}`,
        );
      }
      const chunkEnd = chunkStart + currentChunkSize;
      if (serverOffset < chunkStart || serverOffset > chunkEnd) {
        throw new Error(
          `Upload offset unreconcilable: server=${serverOffset}, client chunk=[${chunkStart}, ${chunkEnd}], ` +
          `fileSize=${fileSize}. Aborting rather than corrupt the upload.`,
        );
      }
      offset = serverOffset;   // loop re-reads a fresh chunk from the server's truth
      onProgress(Math.round((offset / fileSize) * 100));
    }
  }

  console.log('[Upload] All chunks uploaded successfully');
}

// Byte size of a picked file, captured BEFORE upload so the caller can store it
// on the pending videos row (upload_bytes). Reconciliation later verifies the
// finalized object's content-length matches this exactly, so a partial/truncated
// object can never be marked 'ready'. Cost: a single metadata stat on mobile (no
// bytes read, no network round trip); instant on web (in-memory Blob.size).
export async function pendingFileSize(pending: PendingFile): Promise<number> {
  if (pending.isWeb) return pending.file.size;
  // legacy getInfoAsync returns size by default; { size: true } isn't in its
  // typed InfoOptions but is accepted at runtime (mirrors the prior call site).
  const info = await FileSystem.getInfoAsync(pending.uri, { size: true } as any);
  if (!info.exists) throw new Error('Could not access the selected video.');
  return (info as any).size as number;
}

// Upload a picked file to the 'Videos' bucket at <fileName>. Reports 0-100 via
// onProgress. Throws on failure. Bucket/path semantics are the caller's concern
// (the caller writes the videos row with whatever team_id/game_id/player_id).
// Pass knownBytes (from pendingFileSize) to skip the mobile re-stat.
export async function uploadVideoToBucket(
  fileName: string,
  pending: PendingFile,
  onProgress: (pct: number) => void,
  knownBytes?: number
): Promise<void> {
  if (pending.isWeb) {
    const token = await getFreshToken();
    await uploadVideoWeb(fileName, pending.file, token, onProgress);
  } else {
    const fileSize = knownBytes ?? (await pendingFileSize(pending));
    await uploadVideoMobile(fileName, pending.uri, fileSize, onProgress);
  }
}

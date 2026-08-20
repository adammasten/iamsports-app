// Stitch a game's videos into ONE file (server-side ffmpeg concat) and download
// it to the device. Additive to downloadMedia() — which saves each video as a
// separate file — this is the optional "one combined file" path.
//
// Flow: POST the game's video KEYS (in play order) to Railway /concat-game →
// poll /job/:id → on done, download the returned signed URL (web anchor /
// native camera roll). The stitched output lives under game-downloads/ and is
// delivered by a signed URL (sign-media can't authorize it — it isn't a videos
// row), so we download that URL directly.
//
// SPEED: the server re-encodes each full video so the concat can't glitch on
// mismatched quarters — so this is SLOW (minutes for a full game). downloadMedia
// (all videos, no re-encode) stays the fast path; this trades time for one file.

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';

const SERVER_URL = 'https://web-production-1bf7f.up.railway.app';

function safeName(name: string): string {
  const cleaned = name.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'game';
  return cleaned.toLowerCase().endsWith('.mp4') ? cleaned : `${cleaned}.mp4`;
}

export type StitchStatus = { stage: string; label: string; progress: number };

// Stitch `keys` (storage object keys, in play order) into one MP4 and save it.
// Reports progress via onStatus. Throws on any failure (never fails silently).
export async function stitchAndDownloadGame(
  keys: string[],
  filename: string,
  onStatus?: (s: StitchStatus) => void,
): Promise<void> {
  if (!keys.length) throw new Error('No videos to combine.');

  // Ask for camera-roll permission BEFORE the long render (native only).
  if (Platform.OS !== 'web') {
    const perm = await MediaLibrary.requestPermissionsAsync();
    if (!perm.granted) throw new Error('Camera-roll permission is needed to save.');
  }

  onStatus?.({ stage: 'starting', label: 'Starting…', progress: 0 });
  const startRes = await fetch(`${SERVER_URL}/concat-game`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys, outputFileName: filename }),
  });
  if (!startRes.ok) throw new Error(`Server error (${startRes.status})`);
  const { jobId, error } = await startRes.json();
  if (error || !jobId) throw new Error(error || 'Could not start combining.');

  // Poll until done/failed. Generous cap — a full-game re-encode can take a
  // while (~20 min at 3s intervals).
  let signedUrl: string | null = null;
  for (let i = 0; i < 400; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    let job: any;
    try {
      const jr = await fetch(`${SERVER_URL}/job/${jobId}`);
      if (!jr.ok) continue;
      job = await jr.json();
    } catch {
      continue; // transient network blip — keep polling
    }
    onStatus?.({
      stage: job.stage ?? 'processing',
      label: job.label ?? 'Working…',
      progress: job.progress ?? 0,
    });
    if (job.status === 'done') { signedUrl = job.url; break; }
    if (job.status === 'failed') throw new Error(job.error || 'Combining failed.');
  }
  if (!signedUrl) throw new Error('Combining timed out — try again.');

  onStatus?.({ stage: 'saving', label: 'Saving to your device…', progress: 100 });
  const outName = safeName(filename);

  if (Platform.OS === 'web') {
    // Fetch → blob → anchor (cross-origin `download` attr is ignored otherwise).
    const res = await fetch(signedUrl);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = outName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return;
  }

  const localPath = `${FileSystem.cacheDirectory}${outName}`;
  await FileSystem.downloadAsync(signedUrl, localPath);
  await MediaLibrary.saveToLibraryAsync(localPath);
}

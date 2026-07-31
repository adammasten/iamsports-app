// Download media from the private 'Videos' bucket to the user's device.
//   • Phone → saves to the camera roll (expo-media-library).
//   • Web   → triggers a browser download.
//
// A reel is one file; a game is N videos, so this takes a LIST and reports how
// many saved. Entitlement is enforced upstream: we fetch a signed URL via
// getSignedVideoUrl → sign-media, so you can only download what you may watch.
//
// Mirrors the save-to-camera-roll pattern in app/export.tsx (saveExportToLibrary),
// generalized for reels + games and made web-safe.

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { getSignedVideoUrl } from './video-url';

export type DownloadItem = {
  key: string;       // storage object key (videos.url or a reel's storage_path)
  filename: string;  // suggested file name, e.g. "vs Warriors - Q1.mp4"
};

// Strip characters that are unsafe in a file name; guarantee an .mp4 suffix.
function safeName(name: string): string {
  const cleaned = name.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'video';
  return cleaned.toLowerCase().endsWith('.mp4') ? cleaned : `${cleaned}.mp4`;
}

async function downloadOne(item: DownloadItem): Promise<void> {
  const signed = await getSignedVideoUrl(item.key, { forceRefresh: true });
  if (!signed) throw new Error(`No download link for ${item.filename}`);
  const filename = safeName(item.filename);

  if (Platform.OS === 'web') {
    // Fetch → blob → anchor: the `download` attribute is ignored cross-origin,
    // so we pull the bytes ourselves and hand the browser a same-origin blob URL.
    const res = await fetch(signed);
    if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return;
  }

  // Native: download to cache, then save into the camera roll.
  const localPath = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.downloadAsync(signed, localPath);
  await MediaLibrary.saveToLibraryAsync(localPath);
}

// Download one or more objects. Requests camera-roll permission once (native).
// Never throws for a single item's failure — runs them all and reports counts.
export async function downloadMedia(
  items: DownloadItem[],
): Promise<{ saved: number; failed: number }> {
  if (items.length === 0) return { saved: 0, failed: 0 };

  if (Platform.OS !== 'web') {
    const perm = await MediaLibrary.requestPermissionsAsync();
    if (!perm.granted) throw new Error('Camera-roll permission is needed to save.');
  }

  let saved = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await downloadOne(item);
      saved++;
    } catch (e) {
      console.warn('[download] failed:', item.filename, e);
      failed++;
    }
  }
  return { saved, failed };
}

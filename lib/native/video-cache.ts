// Native-side wrapper around the pure cache policy in @/lib/core/cache-policy.
// Owns: download, file I/O via expo-file-system/legacy, manifest persistence
// in AsyncStorage, and in-memory download status for the badges on game.tsx.
//
// Web is a no-op (every public API returns the "nothing cached" answer).
// Callers can invoke these unconditionally; on web they just fall through to
// the remote Supabase URL. The future lib/web/video-cache.ts will swap in
// IndexedDB / Cache Storage with the same public surface.
//
// Files live under cacheDirectory (NOT documentDirectory) — iOS may evict
// under disk pressure, and that's fine: _layout.tsx calls reconcile() on
// startup to drop manifest rows whose underlying file disappeared.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import {
  CacheEntry,
  DEFAULT_BUDGET_BYTES,
  planEvictions,
  removeEntries,
  totalUsageBytes,
  touch as touchPolicy,
  upsertEntry,
} from '@/lib/core/cache-policy';

const MANIFEST_KEY = '@iamsports/video-cache/manifest/v1';
const CACHE_DIR_NAME = 'videos/';

// Hardcoded for now. A future "auto-prefetch on Wi-Fi" preference (locked
// decision 5b parks auto-prefetch — UI stays tap-only) would also be the
// natural place to expose a user-tunable budget.
const BUDGET_BYTES = DEFAULT_BUDGET_BYTES;

export type CacheStatus = 'idle' | 'queued' | 'downloading' | 'cached' | 'error';

export type PrefetchResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'too_large' | 'network' | 'web' };

type StatusListener = (videoId: string, status: CacheStatus) => void;

const isWeb = Platform.OS === 'web';

// --- in-memory state ---------------------------------------------------------
// Manifest is lazy-loaded from AsyncStorage on first access, then kept in
// sync via saveManifest. downloadStatus is purely transient (resets on app
// restart, hydrated from the manifest on first load).
let manifestCache: CacheEntry[] | null = null;
const downloadStatus = new Map<string, CacheStatus>();
const listeners = new Set<StatusListener>();
const inflight = new Map<string, Promise<PrefetchResult>>();
// Single-slot serial queue: one download at a time so we don't saturate the
// uplink and don't race manifest writes. .catch keeps the chain alive after
// a failed download.
let serialQueue: Promise<unknown> = Promise.resolve();

// --- helpers ----------------------------------------------------------------

function cacheDir(): string {
  return `${FileSystem.cacheDirectory}${CACHE_DIR_NAME}`;
}

function pathFor(videoId: string): string {
  return `${cacheDir()}${videoId}.mp4`;
}

async function ensureCacheDir(): Promise<void> {
  if (isWeb) return;
  const info = await FileSystem.getInfoAsync(cacheDir());
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(cacheDir(), { intermediates: true });
  }
}

async function loadManifest(): Promise<CacheEntry[]> {
  if (manifestCache !== null) return manifestCache;
  try {
    const raw = await AsyncStorage.getItem(MANIFEST_KEY);
    manifestCache = raw ? (JSON.parse(raw) as CacheEntry[]) : [];
  } catch {
    manifestCache = [];
  }
  for (const e of manifestCache) {
    if (!downloadStatus.has(e.videoId)) downloadStatus.set(e.videoId, 'cached');
  }
  return manifestCache;
}

async function saveManifest(next: CacheEntry[]): Promise<void> {
  manifestCache = next;
  await AsyncStorage.setItem(MANIFEST_KEY, JSON.stringify(next));
}

function setStatus(videoId: string, status: CacheStatus): void {
  downloadStatus.set(videoId, status);
  for (const l of listeners) {
    try {
      l(videoId, status);
    } catch (e) {
      console.warn('[video-cache] listener threw:', e);
    }
  }
}

async function headContentLength(remoteUrl: string): Promise<number | null> {
  try {
    const resp = await fetch(remoteUrl, { method: 'HEAD' });
    if (!resp.ok) return null;
    const len = resp.headers.get('content-length');
    if (!len) return null;
    const n = parseInt(len, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function evictAndPersist(
  ids: string[],
  current: CacheEntry[]
): Promise<CacheEntry[]> {
  for (const id of ids) {
    try {
      await FileSystem.deleteAsync(pathFor(id), { idempotent: true });
    } catch (e) {
      console.warn(`[video-cache] failed to delete ${id}:`, e);
    }
    if (downloadStatus.get(id) === 'cached') setStatus(id, 'idle');
  }
  const next = removeEntries(current, ids);
  await saveManifest(next);
  return next;
}

// --- public API -------------------------------------------------------------

export async function isCached(videoId: string): Promise<boolean> {
  if (isWeb) return false;
  const m = await loadManifest();
  return m.some(e => e.videoId === videoId);
}

export async function getCachedPath(videoId: string): Promise<string | null> {
  if (isWeb) return null;
  const m = await loadManifest();
  if (!m.some(e => e.videoId === videoId)) return null;
  // Defensive: iOS may have wiped the file under disk pressure since the
  // manifest was last written. Cheaper to syscall than to hand the player
  // a stale path and watch it explode.
  const info = await FileSystem.getInfoAsync(pathFor(videoId));
  return info.exists ? pathFor(videoId) : null;
}

// Sync variant for initial-render decisions (useVideoPlayer needs a URL
// synchronously). Returns null if the manifest hasn't been hydrated yet —
// relies on _layout.tsx's startup reconcile() to load the manifest before
// any tagging screen mounts. No disk check; if iOS evicted the file since
// reconcile, the player errors and the caller falls back to the remote URL.
export function getCachedPathSync(videoId: string): string | null {
  if (isWeb || manifestCache === null) return null;
  if (!manifestCache.some(e => e.videoId === videoId)) return null;
  return pathFor(videoId);
}

export async function touch(videoId: string): Promise<void> {
  if (isWeb) return;
  const m = await loadManifest();
  if (!m.some(e => e.videoId === videoId)) return;
  await saveManifest(touchPolicy(m, videoId, Date.now()));
}

export async function getManifest(): Promise<CacheEntry[]> {
  if (isWeb) return [];
  return [...(await loadManifest())];
}

export async function totalUsage(): Promise<number> {
  if (isWeb) return 0;
  return totalUsageBytes(await loadManifest());
}

export function getStatus(videoId: string): CacheStatus {
  return downloadStatus.get(videoId) ?? 'idle';
}

export function subscribe(listener: StatusListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function runPrefetch(
  videoId: string,
  remoteUrl: string
): Promise<PrefetchResult> {
  await ensureCacheDir();
  let manifest = await loadManifest();

  if (manifest.some(e => e.videoId === videoId)) {
    const p = pathFor(videoId);
    const info = await FileSystem.getInfoAsync(p);
    if (info.exists) {
      await saveManifest(touchPolicy(manifest, videoId, Date.now()));
      setStatus(videoId, 'cached');
      return { ok: true, path: p };
    }
    // Manifest claims cached but disk says otherwise — drop the stale entry
    // and fall through to download.
    manifest = removeEntries(manifest, [videoId]);
    await saveManifest(manifest);
  }

  const headSize = await headContentLength(remoteUrl);
  const incoming = headSize ?? 0;
  const plan = planEvictions(manifest, BUDGET_BYTES, incoming);

  if (!plan.fits) {
    setStatus(videoId, 'idle');
    return { ok: false, reason: 'too_large' };
  }
  if (plan.evict.length > 0) {
    manifest = await evictAndPersist(plan.evict, manifest);
  }

  setStatus(videoId, 'downloading');

  const dest = pathFor(videoId);
  try {
    const download = FileSystem.createDownloadResumable(remoteUrl, dest);
    const result = await download.downloadAsync();
    if (!result || result.status >= 400) {
      throw new Error(`Download failed: status ${result?.status ?? 'unknown'}`);
    }

    const info = await FileSystem.getInfoAsync(dest, { size: true });
    if (!info.exists) throw new Error('Download finished but file missing');
    const realSize = (info as { size?: number }).size ?? 0;

    // Recovery pass: if HEAD lied (or was missing) and we're now over budget,
    // run eviction again now that we know the real size.
    let nextManifest = await loadManifest();
    if (totalUsageBytes(nextManifest) + realSize > BUDGET_BYTES) {
      const recovery = planEvictions(nextManifest, BUDGET_BYTES, realSize);
      if (recovery.evict.length > 0) {
        nextManifest = await evictAndPersist(recovery.evict, nextManifest);
      }
    }

    nextManifest = upsertEntry(nextManifest, {
      videoId,
      sizeBytes: realSize,
      lastAccessedAt: Date.now(),
    });
    await saveManifest(nextManifest);
    setStatus(videoId, 'cached');
    return { ok: true, path: dest };
  } catch (e) {
    console.warn(`[video-cache] download failed for ${videoId}:`, e);
    try {
      await FileSystem.deleteAsync(dest, { idempotent: true });
    } catch {
      /* ignore */
    }
    setStatus(videoId, 'error');
    return { ok: false, reason: 'network' };
  }
}

export function prefetch(
  videoId: string,
  remoteUrl: string
): Promise<PrefetchResult> {
  if (isWeb) return Promise.resolve({ ok: false, reason: 'web' });

  const existing = inflight.get(videoId);
  if (existing) return existing;

  setStatus(videoId, 'queued');
  const p = serialQueue
    .then(() => runPrefetch(videoId, remoteUrl))
    .finally(() => {
      inflight.delete(videoId);
    });
  serialQueue = p.catch(() => undefined);
  inflight.set(videoId, p);
  return p;
}

export async function remove(videoId: string): Promise<void> {
  if (isWeb) return;
  const m = await loadManifest();
  await evictAndPersist([videoId], m);
}

export async function clear(): Promise<void> {
  if (isWeb) return;
  const m = await loadManifest();
  await evictAndPersist(
    m.map(e => e.videoId),
    m
  );
  try {
    await FileSystem.deleteAsync(cacheDir(), { idempotent: true });
  } catch {
    /* ignore */
  }
  await ensureCacheDir();
}

export async function reconcile(): Promise<{ removed: string[] }> {
  if (isWeb) return { removed: [] };
  await ensureCacheDir();
  const m = await loadManifest();
  const removed: string[] = [];

  for (const e of m) {
    const info = await FileSystem.getInfoAsync(pathFor(e.videoId));
    if (!info.exists) removed.push(e.videoId);
  }
  let next = m;
  if (removed.length > 0) {
    next = removeEntries(m, removed);
    await saveManifest(next);
    for (const id of removed) {
      if (downloadStatus.get(id) === 'cached') setStatus(id, 'idle');
    }
  }

  // Drop orphan files (present on disk but not referenced by the manifest).
  // Happens when an upgrade changes the filename scheme or a previous save
  // crashed between writing the file and persisting the manifest row.
  try {
    const dirContents = await FileSystem.readDirectoryAsync(cacheDir());
    const known = new Set(next.map(e => `${e.videoId}.mp4`));
    for (const name of dirContents) {
      if (!known.has(name)) {
        try {
          await FileSystem.deleteAsync(`${cacheDir()}${name}`, {
            idempotent: true,
          });
        } catch {
          /* ignore */
        }
      }
    }
  } catch (e) {
    console.warn('[video-cache] orphan scan failed:', e);
  }

  return { removed };
}

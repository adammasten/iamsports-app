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
import { getSignedVideoUrl } from './video-url';
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

export type CacheProgress = { bytesWritten: number; bytesExpected: number };

export type PrefetchResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'too_large' | 'network' | 'web' | 'stalled' };

type StatusListener = (videoId: string, status: CacheStatus) => void;
type ProgressListener = (videoId: string, p: CacheProgress) => void;

const isWeb = Platform.OS === 'web';

// Kill a download that hasn't reported any bytes in this many ms. Prevents the
// "just spins forever" case when the network stalls silently (spotty airport
// wifi, dropped tower, etc.) — createDownloadResumable's promise doesn't
// resolve or reject on its own until the OS finally times out (many minutes).
const STALL_TIMEOUT_MS = 90_000;

// --- in-memory state ---------------------------------------------------------
// Manifest is lazy-loaded from AsyncStorage on first access, then kept in
// sync via saveManifest. downloadStatus + downloadProgress are purely
// transient (reset on app restart, status is hydrated from the manifest on
// first load).
let manifestCache: CacheEntry[] | null = null;
const downloadStatus = new Map<string, CacheStatus>();
const downloadProgress = new Map<string, CacheProgress>();
const listeners = new Set<StatusListener>();
const progressListeners = new Set<ProgressListener>();
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

function setProgress(videoId: string, p: CacheProgress): void {
  downloadProgress.set(videoId, p);
  for (const l of progressListeners) {
    try {
      l(videoId, p);
    } catch (e) {
      console.warn('[video-cache] progress listener threw:', e);
    }
  }
}

function clearProgress(videoId: string): void {
  downloadProgress.delete(videoId);
  // Fire a zeroed-out event so subscribers can clean up their local state.
  for (const l of progressListeners) {
    try {
      l(videoId, { bytesWritten: 0, bytesExpected: 0 });
    } catch { /* ignore */ }
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

export function getProgress(videoId: string): CacheProgress | null {
  return downloadProgress.get(videoId) ?? null;
}

export function subscribe(listener: StatusListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function subscribeProgress(listener: ProgressListener): () => void {
  progressListeners.add(listener);
  return () => {
    progressListeners.delete(listener);
  };
}

async function runPrefetch(
  videoId: string,
  path: string
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

  // Mint a signed URL from the storage path for the network calls below — the
  // bucket is private, so the bare path isn't directly fetchable. Cached-file
  // naming and the manifest are keyed by videoId and are unaffected; only the
  // fetch source changes.
  const signedUrl = await getSignedVideoUrl(path, { forceRefresh: true });
  if (!signedUrl) {
    // Couldn't mint — abort without caching. Not fatal for the caller: the
    // players fall back to a freshly-minted URL for playback.
    setStatus(videoId, 'error');
    return { ok: false, reason: 'network' };
  }

  const headSize = await headContentLength(signedUrl);
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
  // Seed with 0/expected — UI can render a paused-looking bar immediately
  // rather than waiting for the first byte before showing anything.
  setProgress(videoId, { bytesWritten: 0, bytesExpected: incoming });

  const dest = pathFor(videoId);
  let lastProgressAt = Date.now();
  let stalled = false;
  // 4th arg is expo's progress callback. Every packet resets the stall timer.
  const download = FileSystem.createDownloadResumable(
    signedUrl,
    dest,
    {},
    (p) => {
      lastProgressAt = Date.now();
      setProgress(videoId, { bytesWritten: p.totalBytesWritten, bytesExpected: p.totalBytesExpectedToWrite });
    },
  );
  // Watchdog: if the download hasn't written a byte in STALL_TIMEOUT_MS, cancel
  // it so the promise below rejects instead of hanging until the OS times out
  // (which can be many minutes). Fixes the "just spins forever" case.
  const stallCheck = setInterval(() => {
    if (Date.now() - lastProgressAt > STALL_TIMEOUT_MS) {
      stalled = true;
      download.cancelAsync().catch(() => { /* ignore — race with completion */ });
    }
  }, 5000);

  try {
    const result = await download.downloadAsync();
    clearInterval(stallCheck);
    if (stalled) {
      // cancelAsync races with normal completion — bias toward reporting the
      // stall since that's the user-visible symptom to fix.
      try { await FileSystem.deleteAsync(dest, { idempotent: true }); } catch { /* ignore */ }
      setStatus(videoId, 'error');
      clearProgress(videoId);
      return { ok: false, reason: 'stalled' };
    }
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
    clearProgress(videoId);
    return { ok: true, path: dest };
  } catch (e) {
    clearInterval(stallCheck);
    console.warn(`[video-cache] download failed for ${videoId}:`, e);
    try {
      await FileSystem.deleteAsync(dest, { idempotent: true });
    } catch {
      /* ignore */
    }
    setStatus(videoId, 'error');
    clearProgress(videoId);
    return { ok: false, reason: stalled ? 'stalled' : 'network' };
  }
}

export function prefetch(
  videoId: string,
  path: string
): Promise<PrefetchResult> {
  if (isWeb) return Promise.resolve({ ok: false, reason: 'web' });

  const existing = inflight.get(videoId);
  if (existing) return existing;

  setStatus(videoId, 'queued');
  const p = serialQueue
    .then(() => runPrefetch(videoId, path))
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

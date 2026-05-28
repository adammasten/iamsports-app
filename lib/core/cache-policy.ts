// Pure LRU + budget math for the on-device video cache. No React Native or
// expo imports — safe to reuse in the upcoming web client (which will swap the
// native wrapper for IndexedDB / Cache Storage but keep this policy unchanged).
//
// The manifest is the source of truth for "what's cached and when did we last
// use it." The native wrapper in lib/native/video-cache.ts owns persistence
// and file I/O; this module just answers: given the manifest, what should be
// evicted to fit a new download under the budget?

export type CacheEntry = {
  videoId: string;
  sizeBytes: number;
  lastAccessedAt: number; // epoch ms
};

// 5 GB. Picked as a generous default for modern iPhones (64GB+) without being
// hostile to lower-storage devices. Callers can override per-device or per-tier.
export const DEFAULT_BUDGET_BYTES = 5 * 1024 * 1024 * 1024;

export function totalUsageBytes(entries: CacheEntry[]): number {
  return entries.reduce((sum, e) => sum + e.sizeBytes, 0);
}

export type EvictionPlan = {
  evict: string[];        // videoIds to remove
  projectedBytes: number; // total usage after evictions + incoming
  fits: boolean;          // false → even evicting all entries leaves us over budget
};

export function planEvictions(
  entries: CacheEntry[],
  budgetBytes: number,
  incomingBytes: number = 0
): EvictionPlan {
  const current = totalUsageBytes(entries);
  // A single file larger than the entire budget can never fit. Refuse without
  // trashing the existing cache for a download that can't land anyway.
  if (incomingBytes > budgetBytes) {
    return { evict: [], projectedBytes: current, fits: false };
  }
  let projected = current + incomingBytes;
  if (projected <= budgetBytes) {
    return { evict: [], projectedBytes: projected, fits: true };
  }
  const sorted = [...entries].sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
  const evict: string[] = [];
  for (const e of sorted) {
    if (projected <= budgetBytes) break;
    evict.push(e.videoId);
    projected -= e.sizeBytes;
  }
  return { evict, projectedBytes: projected, fits: true };
}

export function touch(
  entries: CacheEntry[],
  videoId: string,
  now: number
): CacheEntry[] {
  return entries.map(e =>
    e.videoId === videoId ? { ...e, lastAccessedAt: now } : e
  );
}

export function upsertEntry(
  entries: CacheEntry[],
  entry: CacheEntry
): CacheEntry[] {
  const filtered = entries.filter(e => e.videoId !== entry.videoId);
  return [...filtered, entry];
}

export function removeEntries(
  entries: CacheEntry[],
  ids: string[]
): CacheEntry[] {
  if (ids.length === 0) return entries;
  const idSet = new Set(ids);
  return entries.filter(e => !idSet.has(e.videoId));
}

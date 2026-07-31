// Shared signed-URL helper for the private 'Videos' bucket. The bucket is
// private, so every image/video URL is a short-lived signed URL minted by the
// entitlement-checked 'sign-media' Edge Function.
//
// WHY THE CACHE: without it, the app re-minted a NEW signed url (new token, a
// different string) on every component mount. RN/expo-image key their cache on
// the url string, so a changing url meant every image was a permanent cache
// miss — avatars/logos reloaded on every visit — plus an extra sign-media round
// trip per image per mount. Reusing the same minted url per path within the TTL
// window fixes both: a stable url gets cache hits, and each path is signed once
// per session instead of once per mount.
//
// Video playback + downloads pass { forceRefresh: true } to always get a fresh
// FULL-TTL url — a long stream or download must not ride a near-expiry cached
// url. Images use the cache (default).
//
// INPUT IS A STORAGE PATH, not a URL (e.g. "game123/q1.mp4"). Never throws: on
// any failure it console.warns and returns null so callers can fall back.

import { supabase } from '@/supabase';

const SERVER_TTL_MS = 3 * 60 * 60 * 1000;               // sign-media signs for 3h
const REUSE_WINDOW_MS = SERVER_TTL_MS - 30 * 60 * 1000; // reuse a cached url up to 2.5h (30m safety margin)

// Module-level → survives navigation for the session; lost on app restart (fine:
// the first render after launch mints, the rest of the session reuses).
const urlCache = new Map<string, { url: string; mintedAt: number }>();

export async function getSignedVideoUrl(
  path: string,
  opts?: { forceRefresh?: boolean },
): Promise<string | null> {
  if (!opts?.forceRefresh) {
    const hit = urlCache.get(path);
    if (hit && Date.now() - hit.mintedAt < REUSE_WINDOW_MS) return hit.url;
  }
  try {
    const { data, error } = await supabase.functions.invoke('sign-media', {
      body: { key: path },
    });
    if (error || !data?.url) {
      console.warn('[video-url] sign-media failed:', error ?? data);
      return null;
    }
    const url = data.url as string;
    urlCache.set(path, { url, mintedAt: Date.now() });
    return url;
  } catch (e) {
    console.warn('[video-url] sign-media threw:', e);
    return null;
  }
}

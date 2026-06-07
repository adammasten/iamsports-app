// Shared signed-URL helper for the private 'Videos' bucket (Step 1 of the
// storage privacy fix). Mints a short-lived signed URL so video bytes can be
// fetched without the bucket being public.
//
// TTL defaults to 3 hours — long enough to cover a single uninterrupted
// tagging session without re-minting mid-playback.
//
// INPUT IS A STORAGE PATH, not a URL: pass the object key relative to the
// bucket (e.g. "game123/q1.mp4"), NOT a full https://...supabase.co/... URL.
//
// Never throws: on any failure it console.warns and returns null, so callers
// can fall back gracefully (e.g. to a cached local file or an existing URL).
//
// Works on web as well as native — createSignedUrl is network-only, with no
// platform-bound I/O, so (unlike video-cache.ts) there is no web no-op branch.

import { supabase } from '@/supabase';

export async function getSignedVideoUrl(
  path: string,
  expiresInSeconds = 60 * 60 * 3
): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from('Videos')
      .createSignedUrl(path, expiresInSeconds);
    if (error || !data) {
      console.warn('[video-url] createSignedUrl failed:', error);
      return null;
    }
    return data.signedUrl;
  } catch (e) {
    console.warn('[video-url] createSignedUrl threw:', e);
    return null;
  }
}

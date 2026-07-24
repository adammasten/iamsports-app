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
  expiresInSeconds = 60 * 60 * 3 // kept for call-site compatibility; TTL is now set server-side
): Promise<string | null> {
  try {
    // Route through the entitlement-checked 'sign-media' Edge Function instead of
    // signing directly. The private 'Videos' bucket is (being) locked so the client
    // can no longer mint URLs for arbitrary objects — the function verifies the
    // caller may see this video/reel/photo, then signs. invoke() attaches the JWT.
    const { data, error } = await supabase.functions.invoke('sign-media', {
      body: { key: path },
    });
    if (error || !data?.url) {
      console.warn('[video-url] sign-media failed:', error ?? data);
      return null;
    }
    return data.url as string;
  } catch (e) {
    console.warn('[video-url] sign-media threw:', e);
    return null;
  }
}

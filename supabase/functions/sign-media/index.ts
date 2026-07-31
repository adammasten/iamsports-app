// @ts-nocheck — Deno Edge Function (typechecked by Deno, not the RN tsconfig).
//
// sign-media — Move 2 of the storage privacy fix. Mints a SHORT-LIVED signed URL
// for an object in the PRIVATE 'Videos' bucket, but ONLY after checking the caller
// is entitled to it. Replaces direct client-side createSignedUrl — which, with the
// bucket's blanket-authenticated SELECT policy, let ANY account-holder sign ANY
// video/reel/kid-photo.
//
// Input:  { key: string }  — the storage object key the client wants to play:
//           • a raw video           → matches videos.url
//           • a highlight reel       → matches highlight_reels.storage_path
//           • a kid photo            → kid-photos/<playerId>/<ts>.jpg
// Output: { url } on success; { error } with 400/401/403/404/500 otherwise.
//
// Entitlement is delegated to SECURITY DEFINER SQL run AS THE CALLER (so auth.uid()
// resolves to the caller): authorize_video_playback / authorize_reel_playback /
// authorize_photo_view. Each RETURNS the authoritative key if allowed, else RAISES.
// We sign ONLY the key the gate hands back — never the raw client-supplied one.
//
// Deploy:  supabase functions deploy sign-media
// Env (auto-injected by Supabase): SUPABASE_URL, SUPABASE_ANON_KEY,
//   SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BUCKET = 'Videos';
const TTL_SECONDS = 60 * 60 * 3; // 3h — matches the old client helper (covers a session)
// Avatars/logos render at 40-84px; a 256px square (cover) covers ~3x retina and
// is a fraction of the full upload's bytes. Applied ONLY to image keys.
const IMAGE_TRANSFORM = { width: 256, height: 256, resize: 'cover' };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
    if (!jwt) return json({ error: 'Not authenticated' }, 401);

    const { key } = await req.json().catch(() => ({}));
    if (!key || typeof key !== 'string') return json({ error: 'Missing key' }, 400);

    const url = Deno.env.get('SUPABASE_URL')!;
    // Service-role client: reverse-resolve the key + sign (bypasses RLS).
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    // Caller-context client: runs the authorizer RPCs so auth.uid() = the caller.
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    // Confirm the caller has a valid session.
    const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
    if (whoErr || !who?.user) return json({ error: 'Invalid session' }, 401);

    // Resolve the key → content family, then authorize AS THE CALLER. The gate
    // returns the authoritative key to sign, or errors (→ 403 fail-closed).
    let authedKey: string | null = null;
    let isImage = false; // image keys get a resize transform; videos/reels don't

    if (key.startsWith('kid-photos/')) {
      const playerId = key.split('/')[1];               // kid-photos/<playerId>/<file>
      if (!playerId) return json({ error: 'Bad photo key' }, 400);
      const { data, error } = await asUser.rpc('authorize_photo_view', { p_player_id: playerId });
      if (error) return json({ error: 'Not allowed' }, 403);
      authedKey = data as string;
      isImage = true;
    } else if (key.startsWith('team-logos/')) {
      const teamId = key.split('/')[1];                 // team-logos/<teamId>/<file>
      if (!teamId) return json({ error: 'Bad logo key' }, 400);
      const { data, error } = await asUser.rpc('authorize_team_logo_view', { p_team_id: teamId });
      if (error) return json({ error: 'Not allowed' }, 403);
      authedKey = data as string;
      isImage = true;
    } else {
      const { data: vid } = await admin.from('videos').select('id').eq('url', key).maybeSingle();
      if (vid?.id) {
        const { data, error } = await asUser.rpc('authorize_video_playback', { p_video_id: vid.id });
        if (error) return json({ error: 'Not allowed' }, 403);
        authedKey = data as string;
      } else {
        const { data: reel } = await admin.from('highlight_reels').select('id').eq('storage_path', key).maybeSingle();
        if (reel?.id) {
          const { data, error } = await asUser.rpc('authorize_reel_playback', { p_reel_id: reel.id });
          if (error) return json({ error: 'Not allowed' }, 403);
          authedKey = data as string;
        }
      }
    }

    if (!authedKey) return json({ error: 'Unknown media key' }, 404);

    // Sign ONLY what the gate returned. Image keys get a resize transform so
    // avatars/logos ship ~256px instead of the full-res upload.
    const signOpts = isImage ? { transform: IMAGE_TRANSFORM } : undefined;
    const { data: signed, error: signErr } =
      await admin.storage.from(BUCKET).createSignedUrl(authedKey, TTL_SECONDS, signOpts);
    if (signErr || !signed) return json({ error: 'Could not sign' }, 500);

    return json({ url: signed.signedUrl });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

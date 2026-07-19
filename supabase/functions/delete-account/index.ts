// @ts-nocheck — Deno Edge Function (typechecked by Deno, not the RN tsconfig).
//
// Permanently deletes the CALLER's account — Option B ("personal data only;
// team-shared film survives"). Deleting the auth user can't be done from the
// app (needs the service role), so the app calls this authenticated function.
//
// Deletion scope:
//   • Truly-personal uploads (no game AND no team) → deleted (clips cascade).
//   • The user's reels → deleted.
//   • Teams the user CREATED (created_by is NOT NULL / ON DELETE RESTRICT):
//       - if another confirmed member exists → transfer ownership to them
//         (keeps the team + its film alive for everyone else);
//       - if the user is the only member → delete the (solo) team, cascading its
//         games/videos/clips.
//   • Team-shared film the user uploaded → LEFT IN PLACE; deleting the auth user
//     nulls videos.uploaded_by_user_id (ON DELETE SET NULL), so it stays with
//     the team, just un-attributed.
//   • Finally delete the auth user → cascades memberships / parent links.
//
// Deploy:  supabase functions deploy delete-account
// Env (auto-injected by Supabase): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Identify the caller from their own JWT (never trust a body-supplied id).
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: 'Invalid session' }, 401);
    const userId = userData.user.id;

    // 1. Truly-personal uploads (no team, no game). clips cascade off videos.
    await admin.from('videos').delete()
      .eq('uploaded_by_user_id', userId).is('game_id', null).is('team_id', null);

    // 2. The user's reels.
    await admin.from('highlight_reels').delete().eq('created_by_user_id', userId);

    // 3. Teams the user created — transfer to a co-member, else delete solo team.
    const { data: ownedTeams } = await admin.from('teams').select('id').eq('created_by_user_id', userId);
    for (const t of ownedTeams ?? []) {
      const { data: others } = await admin.from('team_memberships')
        .select('user_id')
        .eq('team_id', t.id).eq('status', 'confirmed').neq('user_id', userId)
        .limit(1);
      const heir = others?.[0]?.user_id;
      if (heir) {
        await admin.from('teams').update({ created_by_user_id: heir }).eq('id', t.id);
      } else {
        await admin.from('teams').delete().eq('id', t.id); // solo team → cascade
      }
    }

    // 4. Delete the auth user (also removes user_profiles, memberships, parent
    //    links via cascade; nulls remaining uploaded_by/created_by references).
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) return json({ error: delErr.message }, 500);

    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

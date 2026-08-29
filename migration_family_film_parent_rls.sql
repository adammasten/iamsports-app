-- Applied live 2026-08-29 via Supabase MCP (apply_migration).
--
-- Slice 3 of the Family Film Room plan (docs/PARENT_FILM_ROOM_PLAN.md).
-- Gate parent access on the coach toggle, and let a linked parent read their OWN
-- kid's clips (needed to build a highlight).
--
-- Verified after apply (impersonating a linked parent via request.jwt.claims):
--   • parent's own kid's game        -> is_family_film_parent = TRUE
--   • a game their kid is NOT in      -> FALSE (no cross-kid / cross-game leak)
--   • coach toggle parent_film_visible = false -> FALSE (toggle revokes)
--
-- Reversible: restore the two policies to their prior USING expressions (drop the
-- new parent branch from clips_read; change videos_read's branch back to
-- is_lineup_parent(game_id)) and drop is_family_film_parent.

create or replace function public.is_family_film_parent(p_game_id uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from game_lineups gl
    join games g  on g.id = gl.game_id
    join teams tm on tm.id = g.team_id
    where gl.game_id = p_game_id
      and tm.parent_film_visible
      and is_linked_parent(gl.player_id)
  );
$$;

alter policy videos_read on public.videos
using (
  is_super_admin()
  or (uploaded_by_user_id = auth.uid())
  or ((visibility = 'team'::content_visibility) and is_team_member(team_id))
  or ((visibility = 'public_link'::content_visibility) and is_team_member(team_id))
  or ((visibility = 'coaches_only'::content_visibility) and is_team_coach(team_id))
  or ((game_id is not null) and is_family_film_parent(game_id))
  or can_tag_video(id)
);

alter policy clips_read on public.clips
using (
  is_super_admin()
  or (created_by_user_id = auth.uid())
  or ((visibility = 'team'::content_visibility) and is_team_member(team_id))
  or ((visibility = 'public_link'::content_visibility) and is_team_member(team_id))
  or ((visibility = 'coaches_only'::content_visibility) and is_team_coach(team_id))
  or (
    visibility = any (array['team'::content_visibility, 'public_link'::content_visibility])
    and exists (
      select 1 from videos v
      where v.id = clips.video_id and v.game_id is not null
        and is_family_film_parent(v.game_id)
    )
  )
);

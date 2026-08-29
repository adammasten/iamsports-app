-- Applied live 2026-08-29 via Supabase MCP (apply_migration).
--
-- Revised parent visibility (Adam changed the model 2026-08-29). Supersedes the
-- "Light enforcement" note from Slice 6: polarity IS now enforced in RLS for the
-- parent's view of OTHER players.
--
-- Rule: a parent can read a clip in their kid's game if
--   (a) it is ABOUT THEIR KID (any polarity — good or bad), OR
--   (b) it is NOT a lowlight.
-- So: everything about your own kid, plus other players' good/neutral plays;
-- other players' pure-bad plays are hidden.
--
-- "Lowlight" (clip_is_pure_negative) = has a negative tag AND no positive tag.
-- A mixed clip that also has a positive tag is NOT a lowlight (it features
-- something good) — a deliberate call; tighten to "any negative tag" if wanted.
--
-- Verified (impersonating a linked parent): kid's own 48 clips visible (any
-- polarity); 13 other-player lowlights hidden; 35 other-player good/neutral visible.
--
-- Reversible: drop the two helpers and restore the clips_read parent branch to the
-- Slice-3 form (visibility in team/public_link AND is_family_film_parent, no
-- polarity clause).

create or replace function public.clip_involves_my_kid(p_clip uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from clip_tags ct join tags t on t.id = ct.tag_id
    where ct.clip_id = p_clip
      and t.category = 'players' and t.player_id is not null
      and is_linked_parent(t.player_id)
  );
$$;

create or replace function public.clip_is_pure_negative(p_clip uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from clip_tags ct join tags t on t.id=ct.tag_id
                 where ct.clip_id=p_clip and t.tag_polarity='negative')
     and not exists (select 1 from clip_tags ct join tags t on t.id=ct.tag_id
                     where ct.clip_id=p_clip and t.tag_polarity='positive');
$$;

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
    and (clip_involves_my_kid(clips.id) or not clip_is_pure_negative(clips.id))
  )
);

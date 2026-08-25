-- Tagger workflow — Slice 2b: wire the grant into the LIVE authz policies.
-- Every change is a pure OR-branch appended to an existing policy → it can only
-- ADD access for active grant-holders, never remove access from current users
-- (so existing tagging cannot regress). A tagger IS the creator of the clips they
-- make, so the existing created_by_user_id branches already cover reading/updating/
-- deleting their own clips + clip_tags — the only genuinely-blocked things are:
-- read the tag vocabulary, insert a clip, read the video/game, and get a signed URL.
-- Applied live via Supabase MCP 2026-08-24.

-- Helpers (can_tag_video already exists from Slice 2).
create or replace function public.can_tag_game(p_game uuid)
returns boolean language sql security definer set search_path to 'public' stable as $$
  select exists (
    select 1 from video_tagging_rights r join videos v on v.id = r.video_id
    where v.game_id = p_game and r.granted_to_user_id = auth.uid()
      and r.can_tag and r.status = 'active' and (r.expires_at is null or r.expires_at > now())
  );
$$;

-- May I read a tag of this team+category via a grant? Player-category tags carry
-- kids' NAMES, so a names_hidden grant must NOT expose them (jersey path instead).
create or replace function public.can_read_team_tag(p_team uuid, p_category text)
returns boolean language sql security definer set search_path to 'public' stable as $$
  select exists (
    select 1 from video_tagging_rights r join videos v on v.id = r.video_id
    where v.team_id = p_team and r.granted_to_user_id = auth.uid()
      and r.can_tag and r.status = 'active' and (r.expires_at is null or r.expires_at > now())
      and (p_category is distinct from 'players' or r.names_hidden = false)
  );
$$;

-- Sanitized player vocabulary for a NAMES-HIDDEN tagger: jersey label only, name
-- never returned. (If a kid has no jersey the label is a stable placeholder — that
-- is the jersey-coverage problem, surfaced at assignment time, not a leak.)
create or replace function public.tagger_player_tags(p_team uuid)
returns table(tag_id uuid, label text)
language plpgsql security definer set search_path to 'public' stable as $$
begin
  if not exists (
    select 1 from video_tagging_rights r join videos v on v.id = r.video_id
    where v.team_id = p_team and r.granted_to_user_id = auth.uid()
      and r.can_tag and r.status = 'active' and (r.expires_at is null or r.expires_at > now())
      and r.names_hidden
  ) then raise exception 'not authorized'; end if;
  return query
    select t.id,
           coalesce(nullif('#' || nullif(trim(p.jersey_number::text), ''), '#'),
                    'Player ' || upper(substr(t.id::text, 1, 4))) as label
    from tags t left join players p on p.id = t.player_id
    where t.team_id = p_team and t.category = 'players';
end $$;

-- ── Append OR-branches to the live policies (ALTER POLICY preserves cmd + roles) ──
alter policy tags_read on public.tags using (
  (scope = 'global'::tag_scope) OR is_team_member(team_id) OR is_super_admin()
  OR can_read_team_tag(team_id, category)
);

alter policy clips_insert on public.clips with check (
  is_super_admin() OR is_team_member(team_id)
  OR ((team_id IS NULL) AND (created_by_user_id = auth.uid()))
  OR can_tag_video(video_id)
);

alter policy videos_read on public.videos using (
  is_super_admin() OR (uploaded_by_user_id = auth.uid())
  OR ((visibility = 'team'::content_visibility) AND is_team_member(team_id))
  OR ((visibility = 'public_link'::content_visibility) AND is_team_member(team_id))
  OR ((visibility = 'coaches_only'::content_visibility) AND is_team_coach(team_id))
  OR ((game_id IS NOT NULL) AND is_lineup_parent(game_id))
  OR can_tag_video(id)
);

alter policy games_read on public.games using (
  is_team_member(team_id) OR is_super_admin() OR is_lineup_parent(id)
  OR can_tag_game(id)
);

-- Playback: let a grant-holder get a signed URL to watch the video they're tagging.
create or replace function public.authorize_video_playback(p_video_id uuid)
returns text language plpgsql security definer set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); v videos%rowtype;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into v from videos where id = p_video_id;
  if not found then raise exception 'Video not found'; end if;
  if v.deleted_at is not null then raise exception 'This video was deleted'; end if;
  if is_super_admin()
     or v.uploaded_by_user_id = uid
     or (v.visibility in ('team','public_link') and is_team_member(v.team_id))
     or (v.visibility = 'coaches_only'          and is_team_coach(v.team_id))
  then return v.url; end if;
  -- Tagger with an active grant on this video.
  if can_tag_video(p_video_id) then return v.url; end if;
  if v.player_id is not null and exists (select 1 from parent_player_links ppl
       where ppl.player_id = v.player_id and ppl.parent_user_id = uid) then return v.url; end if;
  if v.game_id is not null and exists (select 1 from game_lineups gl
       join parent_player_links ppl on ppl.player_id = gl.player_id
       where gl.game_id = v.game_id and ppl.parent_user_id = uid) then return v.url; end if;
  if exists (select 1 from shares s
       where ( (s.content_type = 'video' and s.content_id = v.id)
            or (s.content_type = 'clip'  and s.content_id in (select c.id from clips c where c.video_id = v.id))
            or (s.content_type = 'game'  and v.game_id is not null and s.content_id = v.game_id) )
         and ( is_super_admin() or s.shared_by_user_id = uid
            or (s.audience='team'    and is_team_member(s.team_id))
            or (s.audience='coaches' and is_team_coach(s.team_id))
            or (s.audience='player'  and exists (select 1 from parent_player_links ppl
                  where ppl.player_id = s.target_player_id and ppl.parent_user_id = uid)))
     ) then return v.url; end if;
  raise exception 'Not allowed to view this video';
end $function$;

grant execute on function public.can_tag_game(uuid)              to authenticated;
grant execute on function public.can_read_team_tag(uuid, text)   to authenticated;
grant execute on function public.tagger_player_tags(uuid)        to authenticated;

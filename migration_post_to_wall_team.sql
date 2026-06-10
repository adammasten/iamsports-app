-- ============================================================
-- post_to_wall — add optional team support (Public + Team wall picker).
--
-- Adds p_team_id (default null). When provided, the inserted shares row carries
-- team_id = p_team_id, and the get-or-create lookup keys on team_id too (so a
-- team post and a public post of the same content are distinct rows). For a
-- 'team' audience, p_team_id is required AND the target player must actually be
-- on that team (player_teams). Linked-parent / super-admin check unchanged.
--
-- Adding a parameter changes the function's argument list, which CREATE OR
-- REPLACE cannot do — and leaving both would make the 4-arg call ambiguous with
-- the new 5-arg-with-default. So drop the old 4-arg version first, then create
-- the 5-arg version. Existing 4-arg callers (public posts) keep working via the
-- p_team_id default.
--
-- UNIQUE CONSTRAINT: this migration also extends the shares unique key from
--   (content_type, content_id, audience, target_player_id, shared_by_user_id)
-- to add team_id, so the SAME content can be posted to MULTIPLE teams as
-- distinct rows. team_id is nullable, so NULL-team rows (public/personal) are
-- NOT deduped by the constraint (NULLs are distinct) — dedup for those relies on
-- post_to_wall's get-or-create, consistent with the shared_by_user_id handling.
--
-- Depends on: shares, player_teams, parent_player_links, is_super_admin(),
--   enums share_content/share_audience.
-- ============================================================

-- Extend the shares unique key to include team_id (name-agnostic: find the
-- existing 5-column unique constraint by its column set, drop it, re-add with
-- team_id). Done BEFORE post_to_wall so the get-or-create's team_id keying is
-- backed by a matching constraint.
do $$
declare cname text;
begin
  select c.conname into cname
  from pg_constraint c
  where c.conrelid = 'public.shares'::regclass
    and c.contype = 'u'
    and (
      select array_agg(a.attname::text order by a.attname)
      from unnest(c.conkey) k
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
    ) = array['audience','content_id','content_type','shared_by_user_id','target_player_id']::text[]
  limit 1;
  if cname is not null then
    execute format('alter table public.shares drop constraint %I', cname);
  end if;
end $$;

alter table shares
  add constraint shares_content_audience_player_sharer_team_key
  unique (content_type, content_id, audience, target_player_id, shared_by_user_id, team_id);

-- Drop the old 4-arg signature (CREATE OR REPLACE can't change the arg list).
drop function if exists post_to_wall(share_content, uuid, share_audience, uuid);

create or replace function post_to_wall(
  p_content_type     share_content,
  p_content_id       uuid,
  p_audience         share_audience,
  p_target_player_id uuid,
  p_team_id          uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if not is_super_admin() and not exists (
    select 1 from parent_player_links ppl
    where ppl.player_id = p_target_player_id
      and ppl.parent_user_id = uid
  ) then
    raise exception 'Not allowed: not a linked parent of this player';
  end if;

  -- A 'team' post must name a team the kid is actually on.
  if p_audience = 'team' then
    if p_team_id is null then
      raise exception 'A team is required to post to a team audience';
    end if;
    if not exists (
      select 1 from player_teams pt
      where pt.player_id = p_target_player_id
        and pt.team_id   = p_team_id
    ) then
      raise exception 'Player is not on the specified team';
    end if;
  end if;

  -- Get-or-create THIS caller's own wall row, keyed on team_id too so a team
  -- post and a public post of the same content are distinct rows.
  select id into new_id
  from shares
  where content_type      = p_content_type
    and content_id        = p_content_id
    and audience          = p_audience
    and target_player_id  = p_target_player_id
    and shared_by_user_id = uid
    and team_id is not distinct from p_team_id;
  if new_id is not null then
    return new_id;
  end if;

  insert into shares (content_type, content_id, audience, target_player_id, shared_by_user_id, team_id)
  values (p_content_type, p_content_id, p_audience, p_target_player_id, uid, p_team_id)
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function post_to_wall(share_content, uuid, share_audience, uuid, uuid) from public, anon;
grant execute on function post_to_wall(share_content, uuid, share_audience, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

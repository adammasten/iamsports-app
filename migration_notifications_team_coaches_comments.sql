-- migration_notifications_team_coaches_comments.sql
--
-- Extends the notification system (migration_notifications.sql) to fire the bell
-- for THREE more events Adam asked for:
--   1. A share to the TEAM board  → every confirmed member of that team.
--   2. A share to the COACHES' board → that team's coaches (admin/head_coach/coach).
--   3. A new COMMENT on a shared item → that team's coaches.
--
-- DESIGN: these are TABLE TRIGGERS, not edits to post_to_wall. post_to_wall has
-- been redefined across four migrations (team / widen_player / *_notify /
-- share_on_wall) and rewriting it risks reintroducing drift. A trigger on the
-- shares / share_comments tables fires regardless of which function or direct
-- client insert created the row, so it's robust to that history AND it covers the
-- comment path (share_comments is a direct client insert — components/share-
-- comments.tsx — with no RPC to hook). The existing player-audience notify stays
-- INSIDE post_to_wall, so this trigger deliberately handles only team + coaches
-- (no double-fire). notify_users already skips the actor and null recipients.
--
-- Depends on: notifications + notify_users (migration_notifications.sql),
--   shares, share_comments, team_memberships.

-- 1) shares INSERT → team / coaches audiences.
create or replace function public.notify_on_share()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.team_id is null then
    return new;
  end if;

  if new.audience = 'team' then
    perform notify_users(
      array(select distinct tm.user_id from team_memberships tm
            where tm.team_id = new.team_id and tm.status = 'confirmed'),
      'share_to_team', new.shared_by_user_id, new.target_player_id, new.team_id,
      new.content_type::text, new.content_id
    );
  elsif new.audience = 'coaches' then
    perform notify_users(
      array(select distinct tm.user_id from team_memberships tm
            where tm.team_id = new.team_id and tm.status = 'confirmed'
              and tm.role in ('admin','head_coach','coach')),
      'share_to_coaches', new.shared_by_user_id, new.target_player_id, new.team_id,
      new.content_type::text, new.content_id
    );
  end if;
  return new;
end $$;

drop trigger if exists on_share_insert on shares;
create trigger on_share_insert
  after insert on shares
  for each row execute function public.notify_on_share();

-- 2) share_comments INSERT → the team's coaches (minus the author).
create or replace function public.notify_on_share_comment()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  s_team uuid; s_type text; s_id uuid; s_player uuid;
begin
  select s.team_id, s.content_type::text, s.content_id, s.target_player_id
    into s_team, s_type, s_id, s_player
  from shares s where s.id = new.share_id;

  if s_team is null then
    return new;
  end if;

  perform notify_users(
    array(select distinct tm.user_id from team_memberships tm
          where tm.team_id = s_team and tm.status = 'confirmed'
            and tm.role in ('admin','head_coach','coach')),
    'new_comment', new.author_user_id, s_player, s_team, s_type, s_id
  );
  return new;
end $$;

drop trigger if exists on_share_comment_insert on share_comments;
create trigger on_share_comment_insert
  after insert on share_comments
  for each row execute function public.notify_on_share_comment();

-- 3) get_notifications — add team_id so the client can route team/coaches
-- notifications to the right board. (Rest identical to migration_notifications.sql.)
create or replace function public.get_notifications()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); result jsonb;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id,
    'type', n.type,
    'actor_name', coalesce((select up.display_name from user_profiles up where up.user_id = n.actor_user_id), 'Someone'),
    'player_name', split_part(coalesce(p.name, ''), ' ', 1),
    'team_name', t.name,
    'team_id', n.team_id,
    'entity_type', n.entity_type,
    'entity_id', n.entity_id,
    'target_player_id', n.target_player_id,
    'created_at', n.created_at,
    'read_at', n.read_at
  ) order by n.created_at desc), '[]'::jsonb)
  into result
  from notifications n
  left join players p on p.id = n.target_player_id
  left join teams t on t.id = n.team_id
  where n.recipient_user_id = uid;
  return result;
end $$;
grant execute on function public.get_notifications() to authenticated;

notify pgrst, 'reload schema';

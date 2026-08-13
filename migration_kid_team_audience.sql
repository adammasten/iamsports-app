-- kid_team_audience(player_id)
-- ---------------------------------------------------------------------------
-- Powers the "Who can see [kid]" panel on the kid profile. A guardian needs to
-- see, in one place, everyone who can view their kid's film — not just the
-- FAMILY (guardians, handled by kid_guardians) but the TEAM side too: the
-- coaches on each team the kid is on can see team/coaches content involving the
-- kid, so a security-conscious parent must be able to audit them.
--
-- Mirrors kid_guardians exactly: SECURITY DEFINER, same authorization gate
-- (linked parent OR super admin OR a coach of the kid's team). Returns a jsonb
-- array, one object per ACTIVE team (left_at IS NULL):
--   { team_id, team_name, member_count, coaches: [{ user_id, name, role, is_you }] }
-- Coaches are deduped per user (a user holding both head_coach + coach shows
-- once, strongest role kept) and sorted by name. member_count is every
-- confirmed member, so the UI can say "+ N others on the team".
--
-- Read-only; grants no new access (RLS on the underlying tables is unchanged) —
-- it just packages what a guardian is already entitled to see.

create or replace function public.kid_team_audience(p_player_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not (is_linked_parent(p_player_id) or is_super_admin()
          or is_team_coach((select team_id from players where id = p_player_id))) then
    raise exception 'Not allowed';
  end if;
  return coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'team_id', pt.team_id,
               'team_name', coalesce(te.name, 'Team'),
               'member_count', (
                 select count(distinct tm2.user_id)
                 from team_memberships tm2
                 where tm2.team_id = pt.team_id and tm2.status = 'confirmed'
               ),
               'coaches', coalesce((
                 select jsonb_agg(c order by c->>'name')
                 from (
                   select distinct on (tm.user_id)
                          jsonb_build_object(
                            'user_id', tm.user_id,
                            'name', coalesce(up.display_name, 'Coach'),
                            'role', tm.role,
                            'is_you', tm.user_id = uid
                          ) as c
                   from team_memberships tm
                   left join user_profiles up on up.user_id = tm.user_id
                   where tm.team_id = pt.team_id
                     and tm.status = 'confirmed'
                     and tm.role in ('admin','head_coach','coach')
                   order by tm.user_id,
                            case tm.role
                              when 'admin' then 1
                              when 'head_coach' then 2
                              else 3
                            end
                 ) d
               ), '[]'::jsonb)
             )
             order by coalesce(te.name, 'Team')
           )
    from player_teams pt
    left join teams te on te.id = pt.team_id
    where pt.player_id = p_player_id
      and pt.left_at is null
  ), '[]'::jsonb);
end $$;

grant execute on function public.kid_team_audience(uuid) to authenticated;

-- PostgREST schema cache refresh (new function must be visible to the client).
notify pgrst, 'reload schema';

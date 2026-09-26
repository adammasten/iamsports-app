-- Slice D0.5 — close the kid_team_audience cross-organisation leak.
--
-- THE LEAK
--   kid_team_audience(p_player_id) was gated on
--       is_linked_parent(player) OR is_super_admin() OR is_team_coach(players.team_id)
--   -- the LEGACY players.team_id column -- and then returned, for EVERY open spell the
--   child has: team_id, team_name, member_count, and each team's FULL COACH LIST
--   (user_id, display name, role). So a coach of the child's legacy team could enumerate
--   every other club that child plays for and who coaches there. Granted to PUBLIC, anon
--   and authenticated. One live child (on 2 teams) is exposed today; it scales with every
--   multi-team child. Nothing in the database depends on this function (verified: no
--   policy, function or view references it), and the only caller is app/kid.tsx:180.
--
-- THE FIX -- narrowly scoped, backward compatible
--   1. Row-level visibility: a caller now sees ONLY the team rows they are entitled to.
--        linked guardian / super admin -> every open spell (the family's full picture,
--                                        which is the screen's whole purpose)
--        coach                         -> only spells for teams THEY coach
--      Because the filter drops the whole row, the nested member_count and coaches array
--      for a hidden team are never evaluated and cannot leak through the aggregate.
--   2. The authorisation gate stops depending on the legacy players.team_id and instead
--      asks whether the caller coaches ANY team with a spell for this child.
--   3. The RETURN SHAPE IS UNCHANGED -- same jsonb array of
--      {team_id, team_name, member_count, coaches:[{user_id,name,role,is_you}]} -- so
--      Build 68 and production web keep working with no client change. A coach simply
--      receives a shorter array; a guardian receives exactly what they receive today.
--
-- NOT CHANGED: grants (still authenticated-callable, as the client needs), the function
-- signature, C.5's controls. Modifies no data.

create or replace function public.kid_team_audience(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid          uuid := auth.uid();
  v_is_family  boolean;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  -- Family authority: a linked guardian, or a super admin acting on their behalf.
  v_is_family := public.is_linked_parent(p_player_id) or public.is_super_admin();

  -- Gate. Coach authority is no longer derived from the legacy players.team_id; it is
  -- derived from an actual spell on a team the caller coaches.
  if not (
    v_is_family
    or exists (
      select 1 from public.player_teams pt
       where pt.player_id = p_player_id
         and pt.left_on is null
         and public.is_team_coach(pt.team_id)
    )
  ) then
    raise exception 'Not allowed';
  end if;

  return coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'team_id', pt.team_id,
               'team_name', coalesce(te.name, 'Team'),
               'member_count', (
                 select count(distinct tm2.user_id)
                 from public.team_memberships tm2
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
                   from public.team_memberships tm
                   left join public.user_profiles up on up.user_id = tm.user_id
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
    from public.player_teams pt
    left join public.teams te on te.id = pt.team_id
    where pt.player_id = p_player_id
      and pt.left_on is null
      -- ROW-LEVEL VISIBILITY. This single predicate is the fix: a coach sees only their
      -- own team's row, so Team B and Team B's coaches are invisible to a coach of Team A.
      and (v_is_family or public.is_team_coach(pt.team_id))
  ), '[]'::jsonb);
end $function$;

comment on function public.kid_team_audience(uuid) is
  'Family-facing "who can see this kid" summary. Guardians and super admins see every open team spell; a coach sees ONLY teams they coach (Slice D0.5 -- previously any coach of the legacy players.team_id could enumerate every club the child played for, and those clubs coaches). Return shape unchanged for installed builds.';

notify pgrst, 'reload schema';

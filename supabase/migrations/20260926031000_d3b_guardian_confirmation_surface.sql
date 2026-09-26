-- ============================================================================
-- Slice D3b — THE SURFACE THAT CLOSES THE AUTHORITY LOOP
--
-- D2/D3 made claiming a child stop conferring management authority. That is the security fix,
-- but on its own it would leave a real family LINKED and unable to manage their own child,
-- waiting on a confirmation with nowhere to perform it. This migration supplies the read side
-- so the Roster tab can show a coach "this adult claimed Lars -- is that who you meant?" and
-- call coach_confirm_guardian_claim.
--
-- list_player_guardians gains two fields:
--     can_manage_guardians  — does this adult hold authority for the child
--     needs_confirmation    — is this a claimant awaiting the coach's second signal
--                             (i.e. they hold no authority AND nobody else does either)
--
-- Adding columns to a RETURNS TABLE requires DROP + CREATE. Build 68 destructures only the
-- five keys it knows (user_id, display_name, email, relationship, team_role) from the JSON
-- response, so two extra keys are inert there -- verified against the Guardian type in
-- app/(tabs)/roster.tsx.
--
-- AUTHORITY UNCHANGED: still super admin or admin/head_coach of the team, still requires the
-- child to be on that team. This function only READS; the grant happens in
-- coach_confirm_guardian_claim, which has its own narrower rules.
-- ============================================================================

drop function if exists public.list_player_guardians(uuid, uuid);

create or replace function public.list_player_guardians(p_team_id uuid, p_player_id uuid)
returns table(
  user_id uuid,
  display_name text,
  email text,
  relationship text,
  team_role membership_role,
  can_manage_guardians boolean,
  needs_confirmation boolean
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_any_manager boolean;
begin
  if not (is_super_admin() or exists (
    select 1 from team_memberships tm
    where tm.team_id = p_team_id and tm.user_id = auth.uid()
      and tm.role in ('admin','head_coach') and tm.status = 'confirmed'
  )) then
    raise exception 'not authorized';
  end if;
  if not exists (
    select 1 from player_teams pt
    where pt.player_id = p_player_id and pt.team_id = p_team_id and pt.left_on is null
  ) then
    raise exception 'player not on this team';
  end if;

  select exists (select 1 from parent_player_links l
                  where l.player_id = p_player_id and l.can_manage_guardians)
    into v_any_manager;

  return query
    select ppl.parent_user_id,
           coalesce(nullif(trim(up.display_name), ''), 'Guardian') as display_name,
           au.email::text as email,
           ppl.relationship,
           (select tm.role from team_memberships tm
             where tm.team_id = p_team_id and tm.user_id = ppl.parent_user_id
             order by (case tm.role when 'admin' then 0 when 'head_coach' then 1
                                    when 'coach' then 2 when 'parent' then 3 else 4 end)
             limit 1) as team_role,
           ppl.can_manage_guardians,
           -- a confirmation is only meaningful while NOBODY manages the child: once a family
           -- holds authority, adding another manager is the family's decision, not a coach's.
           (not ppl.can_manage_guardians and not v_any_manager
            and ppl.parent_user_id <> auth.uid()) as needs_confirmation
    from parent_player_links ppl
    left join user_profiles up on up.user_id = ppl.parent_user_id
    left join auth.users au on au.id = ppl.parent_user_id
    where ppl.player_id = p_player_id
    order by 2;
end $function$;

grant execute on function public.list_player_guardians(uuid, uuid) to authenticated, service_role;

comment on function public.list_player_guardians(uuid, uuid) is
  'Guardians attached to a player on this team, for admin/head_coach. Slice D3b adds can_manage_guardians and needs_confirmation so the Roster tab can offer coach_confirm_guardian_claim for a claimant who is waiting on the coach''s second signal. Read-only.';

notify pgrst, 'reload schema';

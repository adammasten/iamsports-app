-- migration_coguardian_flow.sql — Phase A pt4 (applied as coguardian_flow)
-- Co-guardian flow (a parent adds a co-parent/grandparent to their own kid) +
-- lock the per-kid guardian code to guardians only. Coaches never need it —
-- claiming a roster spot is team-code + roster-pick, so only a kid's own
-- guardians can read/share its code.

-- 1. Guardian code readable only by the kid's guardians (or super admin).
drop policy if exists player_guardian_codes_read on public.player_guardian_codes;
create policy player_guardian_codes_read on public.player_guardian_codes for select
  using (is_super_admin() or is_linked_parent(player_id));

-- 2. Accept side: confirm which kid a guardian code points at before attaching.
create or replace function public.preview_guardian_code(p_code text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p_id uuid; nm text; n int; mine boolean;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select player_id into p_id from player_guardian_codes where code = upper(trim(p_code));
  if p_id is null then raise exception 'Invalid code'; end if;
  select split_part(name, ' ', 1) into nm from players where id = p_id;
  select count(*) into n from parent_player_links where player_id = p_id;
  select exists (select 1 from parent_player_links where player_id = p_id and parent_user_id = uid) into mine;
  return jsonb_build_object('player_id', p_id, 'first_name', nm, 'guardian_count', n, 'already_mine', mine, 'full', n >= 4);
end $$;
grant execute on function public.preview_guardian_code(text) to authenticated;

-- 3. Invite side: the kid's current guardians (names + you-flag) for the profile.
create or replace function public.kid_guardians(p_player_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not (is_linked_parent(p_player_id) or is_super_admin()
          or is_team_coach((select team_id from players where id = p_player_id))) then
    raise exception 'Not allowed';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', ppl.parent_user_id,
             'name', coalesce(up.display_name, 'Guardian'),
             'relationship', ppl.relationship,
             'is_you', ppl.parent_user_id = uid
           ) order by (ppl.relationship = 'parent') desc, ppl.created_at)
    from parent_player_links ppl
    left join user_profiles up on up.user_id = ppl.parent_user_id
    where ppl.player_id = p_player_id
  ), '[]'::jsonb);
end $$;
grant execute on function public.kid_guardians(uuid) to authenticated;

-- 4. Revocation: the primary ('parent') removes a co-guardian; anyone removes
--    themselves. Drops the removed guardian's now-orphaned team membership too.
create or replace function public.remove_guardian(p_player_id uuid, p_guardian_user_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); caller_rel text; target_rel text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select relationship into caller_rel from parent_player_links where player_id = p_player_id and parent_user_id = uid;
  select relationship into target_rel from parent_player_links where player_id = p_player_id and parent_user_id = p_guardian_user_id;
  if target_rel is null then raise exception 'That person is not a guardian of this player'; end if;

  if not (p_guardian_user_id = uid
          or (caller_rel = 'parent' and target_rel <> 'parent')) then
    raise exception 'Only the primary guardian can remove another guardian';
  end if;

  delete from parent_player_links where player_id = p_player_id and parent_user_id = p_guardian_user_id;

  delete from team_memberships tm
  where tm.user_id = p_guardian_user_id
    and tm.role = 'parent'
    and tm.team_id in (select team_id from player_teams where player_id = p_player_id)
    and not exists (
      select 1 from parent_player_links ppl2
      join player_teams pt2 on pt2.player_id = ppl2.player_id
      where ppl2.parent_user_id = p_guardian_user_id and pt2.team_id = tm.team_id
    );

  insert into admin_audit_log (actor_user_id, action, target_user_id, target_table, target_id, detail)
  values (uid, 'remove_guardian', p_guardian_user_id, 'parent_player_links', p_player_id,
          jsonb_build_object('player_id', p_player_id, 'removed_user_id', p_guardian_user_id));
end $$;
grant execute on function public.remove_guardian(uuid, uuid) to authenticated;

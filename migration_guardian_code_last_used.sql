-- Guardian invite code: track "last used"
-- ---------------------------------------------------------------------------
-- A parent shares a kid's 6-char code out-of-band (text/email). They want to
-- know whether the code they sent has actually been REDEEMED — so they can tell
-- a real "someone joined" from "still waiting" and reset it if it went stale.
--
-- Adds player_guardian_codes.last_used_at, stamped when the code actually adds a
-- NEW guardian (not on idempotent re-claims), and CLEARED when the code is reset
-- (a fresh code has never been used). Read-only in the UI; no access change.

alter table public.player_guardian_codes
  add column if not exists last_used_at timestamptz;

-- Redemption point. Copied verbatim from migration_notifications_phase_c.sql
-- (the live version), with one added line: stamp last_used_at when a NEW link is
-- created. Placed inside the `if not exists` block so re-claims by an existing
-- guardian don't move the timestamp.
create or replace function public.claim_or_link_guardian(p_code text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); p_id uuid; n int;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select player_id into p_id from player_guardian_codes where code = upper(trim(p_code));
  if p_id is null then raise exception 'Invalid code'; end if;

  perform 1 from players where id = p_id for update;

  if not exists (select 1 from parent_player_links where parent_user_id = uid and player_id = p_id) then
    select count(*) into n from parent_player_links where player_id = p_id;
    if n >= 4 then raise exception 'This player already has the maximum of 4 guardians'; end if;
    insert into parent_player_links (parent_user_id, player_id, relationship)
    values (uid, p_id, case when n = 0 then 'parent' else 'guardian' end);
    -- mark the code as redeemed (only on a real new-guardian claim)
    update player_guardian_codes set last_used_at = now() where player_id = p_id;
    -- notify the kid's OTHER guardians that a co-guardian joined
    perform notify_users(
      array(select ppl.parent_user_id from parent_player_links ppl where ppl.player_id = p_id),
      'guardian_joined', uid, p_id, null, 'player', p_id
    );
  end if;

  insert into team_memberships (team_id, user_id, role, status)
  select pt.team_id, uid, 'parent', 'confirmed' from player_teams pt where pt.player_id = p_id
  on conflict (team_id, user_id, role) do nothing;

  return p_id;
end $$;

-- Reset point. Copied verbatim from migration_regenerate_codes.sql, with one
-- change: a freshly minted code has never been used, so clear last_used_at.
create or replace function public.regenerate_guardian_code(p_player_id uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); c text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not (is_linked_parent(p_player_id) or is_super_admin()) then
    raise exception 'Only a guardian can reset this code';
  end if;
  loop c := gen_join_code(6); exit when not exists (select 1 from player_guardian_codes where code = c); end loop;
  update player_guardian_codes set code = c, last_used_at = null where player_id = p_player_id;
  if not found then
    insert into player_guardian_codes (player_id, code) values (p_player_id, c);
  end if;
  insert into admin_audit_log (actor_user_id, action, target_table, target_id, detail)
  values (uid, 'regenerate_guardian_code', 'players', p_player_id, jsonb_build_object('player_id', p_player_id));
  return c;
end $$;

notify pgrst, 'reload schema';

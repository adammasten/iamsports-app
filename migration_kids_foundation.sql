-- ============================================================
-- Kids foundation — captures schema/functions that were applied DIRECTLY in
-- Supabase (no prior migration file) so the repo matches production. Function
-- bodies below are the EXACT live definitions (pg_get_functiondef), not
-- reconstructed.
--
-- Covers:
--   * players.team_id made nullable (kids can be teamless)
--   * players.grad_class text column
--   * is_linked_parent(p_player_id) — used by the players_read policy branch
--   * create_kid(name) RPC
--   * update_kid(player_id, name, grad_class) RPC
--
-- Depends on: players, parent_player_links, teams, auth.users, and
--   is_super_admin() (migration_rls_helpers.sql).
--
-- NOTE on players_read: the live policy was also modified to add an
--   `OR is_linked_parent(id)` branch (so a linked parent can read their kid).
--   That policy edit is NOT reproduced here because its full current text
--   wasn't captured — see the comment at the bottom. is_linked_parent itself
--   IS defined here so the branch's dependency is tracked.
--
-- Idempotent: safe to re-run.
-- ============================================================

-- 1. Schema changes on players.
alter table players alter column team_id drop not null;
alter table players add column if not exists grad_class text;

-- 2. is_linked_parent — true when the current user is a linked parent of the
--    given player. Used by the players_read RLS branch.
CREATE OR REPLACE FUNCTION public.is_linked_parent(p_player_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from parent_player_links
    where player_id = p_player_id
      and parent_user_id = auth.uid()
  );
$function$;

-- 3. create_kid — creates a teamless player + links the caller as parent.
CREATE OR REPLACE FUNCTION public.create_kid(name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  clean_name text := trim(coalesce(name, ''));
  new_id uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if clean_name = '' then
    raise exception 'Kid name is required';
  end if;
  insert into players (name, team_id, user_id)
  values (clean_name, null, null)
  returning id into new_id;
  insert into parent_player_links (parent_user_id, player_id, relationship)
  values (uid, new_id, 'parent');
  return new_id;
end;
$function$;

revoke all on function create_kid(text) from public, anon;
grant execute on function create_kid(text) to authenticated;

-- 4. update_kid — edits a kid's name + grad_class; linked-parent or super-admin only.
CREATE OR REPLACE FUNCTION public.update_kid(player_id uuid, name text, grad_class text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  clean_name text := trim(coalesce(name, ''));
  clean_grad text := nullif(trim(coalesce(grad_class, '')), '');
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if clean_name = '' then raise exception 'Kid name is required'; end if;
  if not is_super_admin() and not exists (
    select 1 from parent_player_links ppl
    where ppl.player_id = update_kid.player_id
      and ppl.parent_user_id = uid
  ) then
    raise exception 'Not allowed to edit this player';
  end if;
  update players
    set name = clean_name,
        grad_class = clean_grad
    where id = update_kid.player_id;
end;
$function$;

revoke all on function update_kid(uuid, text, text) from public, anon;
grant execute on function update_kid(uuid, text, text) to authenticated;

-- 5. players_read — recreate with the linked-parent branch, captured from the
--    live policy qual. Originally migration_rls_lockdown_7_players.sql; the only
--    change vs. that file is the added `OR is_linked_parent(id)`.
drop policy if exists players_read on players;
create policy players_read on players
  for select
  using (is_super_admin() OR is_team_member(team_id) OR (user_id = auth.uid()) OR is_linked_parent(id));

notify pgrst, 'reload schema';

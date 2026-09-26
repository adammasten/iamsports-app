-- ============================================================================
-- Slice D6b — TWO THINGS THE D8 ASSERTION CAUGHT IN MY OWN WORK
--
-- Running audit_legacy_player_column_dependence() against the finished D6 returned two rows.
-- One was a genuine miss; one was a flaw in the audit itself.
--
-- 1. kid_guardians — A GENUINE MISS, and it had TWO defects:
--
--    a) Its gate is `is_team_coach((select team_id from players where id = p_player_id))` --
--       the legacy column D6 was supposed to eliminate everywhere. So a coach of a team the
--       child has LEFT could still enumerate the child's whole guardian list (names included),
--       while a coach of the team the child actually plays for today could be refused.
--
--    b) Its `is_primary` flag is computed as the EARLIEST parent_player_links.created_at --
--       the exact "arrival order is authority" signal D0.75 and D2 existed to abolish. After
--       D2, the family screen would show one adult as primary while the database granted
--       authority to another: the same class of divergence C.5 shipped a whole slice to fix,
--       reintroduced through a display RPC. It now reads can_manage_guardians.
--
-- 2. The audit function matched its OWN comment text: kid_team_audience's D0.5 header says
--    "no longer derived from the legacy players.team_id", and a regex over prosrc cannot tell
--    a comment from code. An assertion that cries wolf gets ignored, so it now strips SQL
--    comments before matching.
--
-- BUILD 68 COMPATIBILITY: kid_guardians keeps its signature and its exact JSON shape
-- (user_id, name, relationship, is_you, is_primary), so app/kid.tsx:167 is unaffected. The
-- is_primary VALUE changes only where arrival order and real authority disagree -- which is
-- the bug. On live data they agree for all 9 families, so nothing visible changes today.
-- ============================================================================

create or replace function public.kid_guardians(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  -- Spell-aware, like every other D6 gate: a coach of a team this child CURRENTLY plays on.
  if not (public.is_linked_parent(p_player_id)
          or public.is_super_admin()
          or public.is_current_team_coach_of_player(p_player_id)) then
    raise exception 'Not allowed';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', ppl.parent_user_id,
             'name', coalesce(up.display_name, 'Guardian'),
             'relationship', ppl.relationship,
             'is_you', ppl.parent_user_id = uid,
             -- authority, not arrival order (Slice D2)
             'is_primary', ppl.can_manage_guardians
           ) order by ppl.can_manage_guardians desc, ppl.created_at)
    from parent_player_links ppl
    left join user_profiles up on up.user_id = ppl.parent_user_id
    where ppl.player_id = p_player_id
  ), '[]'::jsonb);
end $function$;

comment on function public.kid_guardians(uuid) is
  'Family-facing guardian list for a child. Gate is spell-aware (Slice D6b); is_primary reads can_manage_guardians, the single authority primitive, rather than earliest created_at (Slice D2). JSON shape unchanged for installed builds.';

-- ----------------------------------------------------------------------------
-- Make the assertion trustworthy: ignore comments, and ignore the strings inside
-- comment-on statements, so only real code counts.
-- ----------------------------------------------------------------------------
create or replace function public.audit_legacy_player_column_dependence()
returns table (kind text, object_name text, detail text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with fn as (
    select n.nspname, pr.proname,
           -- strip /* block */ and -- line comments before matching
           regexp_replace(
             regexp_replace(pr.prosrc, '/\*.*?\*/', ' ', 'gs'),
             '--[^\n]*', ' ', 'g') as code
      from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
     where n.nspname = 'public'
  )
  select 'policy'::text,
         (p.schemaname || '.' || p.tablename || '.' || p.policyname)::text,
         left(coalesce(p.qual, p.with_check), 240)::text
    from pg_policies p
   where p.schemaname = 'public'
     and (coalesce(p.qual,'') || coalesce(p.with_check,'')) ~* '(team_id from players|players\.team_id)'
  union all
  select 'function'::text,
         (fn.nspname || '.' || fn.proname)::text,
         'reads players.team_id in an is_team_* check'::text
    from fn
   where fn.code ~* '(team_id\s+from\s+(public\.)?players|players\.team_id)'
     and fn.code ~* 'is_team_(coach|member)'
     and fn.proname <> 'audit_legacy_player_column_dependence'
  order by 1, 2;
$function$;

notify pgrst, 'reload schema';

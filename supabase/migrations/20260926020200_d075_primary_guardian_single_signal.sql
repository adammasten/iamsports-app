-- Slice D0.75 — one authoritative signal for primary-guardian authority.
--
-- THE INCONSISTENCY (C.5-adjacent, latent)
--   Three mechanisms defined "primary" differently:
--     is_primary_guardian()        -> the link with the EARLIEST created_at
--     remove_guardian()            -> the link whose relationship = 'parent'
--     admin_set_primary_guardian() -> REWRITES relationship, does not touch ordering
--   and is_primary_guardian() is referenced by the shares.shares_read RLS policy. Today
--   zero rows disagree only because no primary transfer has run in production yet. The
--   FIRST use of admin_set_primary_guardian would diverge them, leaving a live RLS policy
--   reading the signal that the recovery RPC does not update -- i.e. a repaired family
--   would still be denied, and the evicted adult would still be granted.
--
-- THE FIX -- smallest safe change
--   Redefine is_primary_guardian() to read the explicit relationship = 'parent' signal,
--   which is what remove_guardian() already enforces and what admin_set_primary_guardian()
--   already writes. One CREATE OR REPLACE. No schema change, no new column, no data change.
--
-- VERIFIED ZERO-BEHAVIOUR-CHANGE against live production data before writing this:
--     players with links but NO relationship='parent' row .......... 0
--     players with MORE THAN ONE relationship='parent' row ......... 0
--     players where earliest-link <> the parent-flagged link ........ 0
--     player-audience shares in existence .......................... 3
--       ...of those, rows whose visibility actually depends on this
--       signal (audience='player' AND on_wall = false) ............... 0
--       (shares_read gates a player-audience row on is_primary_guardian ONLY while it is
--        an unapproved inbox item; all 3 live rows are already on_wall = true, so every
--        linked guardian reads them either way and this change moves nothing today.)
--   Re-verified against live production 2026-09-26. Nobody gains or loses access on the day
--   this ships; it only makes divergence structurally impossible from here on.
--
-- INTERIM BY DESIGN
--   This does NOT expand `relationship` into a richer authorisation vocabulary. It is a
--   stepping stone: D2 introduces parent_player_links.can_manage_guardians, at which point
--   is_primary_guardian() moves from reading `relationship` to reading that capability and
--   shares_read follows automatically, exactly as it will follow this change.
--
-- NOT CHANGED: the function signature, its volatility/security settings, its grants,
-- remove_guardian(), admin_set_primary_guardian(), admin_remove_guardian(), shares_read
-- itself, or any C.5 control.

create or replace function public.is_primary_guardian(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from parent_player_links ppl
    where ppl.player_id     = p_player_id
      and ppl.parent_user_id = auth.uid()
      and ppl.relationship   = 'parent'
  );
$function$;

comment on function public.is_primary_guardian(uuid) is
  'TRUE when the caller holds the primary guardian link for this child. Authority signal is the explicit relationship = ''parent'' (Slice D0.75) -- previously earliest created_at, which admin_set_primary_guardian could not update and which therefore diverged from remove_guardian() and shares_read. D2 will move this to an explicit can_manage_guardians capability.';

notify pgrst, 'reload schema';

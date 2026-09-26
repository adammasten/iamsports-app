-- ============================================================================
-- Slice D7 — NAME MODEL (plan v2 §10)
--
-- THREE ADDITIVE, ALWAYS-NULLABLE COLUMNS AND NO BACKFILL, EVER.
--   players.name is untouched and remains the historical value and the final display
--   fallback. first_name / last_name / preferred_name start NULL for every row and are
--   populated only when a human types them.
--
--   WHY NO BACKFILL: live players.name values include "Lars Masten" (clean), "Austin" /
--   "Will" / "Max" (first-name-only), "Alex D." (initial-as-surname), and
--   create_roster_placeholder writes "#12" -- the name column doubles as a jersey sentinel.
--   Splitting on the first space would produce last_name = "D.", last_name = NULL for half
--   the roster, and first_name = "#12". A wrong structured name is worse than no structured
--   name, because downstream code would trust it.
--
-- NAMES ARE NEVER IDENTITY. These columns are for display and for human discovery only.
--   Nothing in this migration compares names to decide whether two records are the same
--   child; D4's conflict list reads recorded relationships and never touches a name column.
--
-- A LIVE BUG FIXED HERE
--   player_chip_label derives the surname with split_part(name, ' ', 2), which returns the
--   MIDDLE name for "William Jackson Smith" -- so the disambiguating initial can be wrong
--   ("William J." for a Smith). The last name is the LAST whitespace token, and that is what
--   the new helper returns.
--
-- BUILD 68 COMPATIBILITY: three nullable columns nothing reads yet, plus two new helper
-- functions, plus a behaviour-preserving rewrite of player_chip_label (same signature, same
-- output for every value shape except the middle-name case it was getting wrong).
-- ============================================================================

alter table public.players
  add column if not exists first_name     text null,
  add column if not exists last_name      text null,
  add column if not exists preferred_name text null;

comment on column public.players.first_name is
  'Structured given name (Slice D7). NULL until a human types it -- never backfilled by splitting players.name. Display/discovery only; never identity.';
comment on column public.players.preferred_name is
  'What the child is actually called (Slice D7). Highest-priority display source. Never identity.';

-- ----------------------------------------------------------------------------
-- DISPLAY FALLBACKS (display only, never identity)
-- ----------------------------------------------------------------------------
create or replace function public.player_display_first(p_player uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
           nullif(trim(p.preferred_name), ''),
           nullif(trim(p.first_name), ''),
           -- legacy parse: a jersey sentinel ("#12") is used verbatim, otherwise the first token
           case when p.name like '#%' then p.name else split_part(p.name, ' ', 1) end)
    from players p where p.id = p_player;
$function$;

create or replace function public.player_display_last(p_player uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- The LAST whitespace-separated token when there are 2+ tokens -- NOT split_part(name,' ',2),
  -- which returns the middle name for "William Jackson Smith".
  select coalesce(
           nullif(trim(p.last_name), ''),
           case when p.name not like '#%'
                     and array_length(regexp_split_to_array(trim(p.name), '\s+'), 1) >= 2
                then (regexp_split_to_array(trim(p.name), '\s+'))[
                        array_length(regexp_split_to_array(trim(p.name), '\s+'), 1)]
           end)
    from players p where p.id = p_player;
$function$;

grant execute on function public.player_display_first(uuid) to authenticated, service_role;
grant execute on function public.player_display_last(uuid)  to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- ONE SHARED CHIP LABEL, ROUTED THROUGH THE DISPLAY HELPERS
--   Same signature and same disambiguation ladder as before: plain first name -> last initial
--   (only when that initial is itself unique) -> jersey -> numeric backstop.
-- ----------------------------------------------------------------------------
create or replace function public.player_chip_label(p_team uuid, p_player uuid, p_jersey text)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_name text; v_first text; v_last text; v_base text; v_label text;
  v_peers int; v_same_initial int; n int := 1;
begin
  select name into v_name from players where id = p_player;
  if v_name is null then return null; end if;

  v_first  := public.player_display_first(p_player);
  v_last   := public.player_display_last(p_player);
  p_jersey := nullif(trim(p_jersey), '');

  -- A name already written as a jersey ("#32") is used verbatim, as before.
  if v_first like '#%' then return v_first; end if;
  v_base := v_first;

  select count(*) into v_peers
  from tags t join players p on p.id = t.player_id
  where t.team_id = p_team and t.category = 'players'
    and t.player_id is not null and t.player_id <> p_player
    and lower(public.player_display_first(t.player_id)) = lower(v_first);

  if v_peers = 0 then
    return v_base || coalesce(' #' || p_jersey, '');
  end if;

  if v_last is not null then
    select count(*) into v_same_initial
    from tags t join players p on p.id = t.player_id
    where t.team_id = p_team and t.category = 'players'
      and t.player_id is not null and t.player_id <> p_player
      and lower(public.player_display_first(t.player_id)) = lower(v_first)
      and lower(left(public.player_display_last(t.player_id), 1)) = lower(left(v_last, 1));
    if v_same_initial = 0 then
      return v_base || ' ' || upper(left(v_last, 1)) || '.';
    end if;
  end if;

  if p_jersey is not null then
    return v_base || ' #' || p_jersey;
  end if;

  loop
    v_label := v_base || ' ' || n;
    exit when not exists (
      select 1 from tags
      where team_id = p_team and category = 'players' and lower(name) = lower(v_label)
        and player_id is distinct from p_player
    );
    n := n + 1;
  end loop;
  return v_label;
end $function$;

comment on function public.player_chip_label(uuid, uuid, text) is
  'The ONE shared roster chip label. Routes through player_display_first/last (Slice D7), which fixes the surname being read as the MIDDLE name for three-token names. Same signature and same disambiguation ladder as before.';

-- ----------------------------------------------------------------------------
-- WRITE PATH — the structured fields are family-owned, same rule as the legacy name
-- ----------------------------------------------------------------------------
create or replace function public.update_player_identity(
  p_player_id uuid,
  p_name           text default null,
  p_grad_class     text default null,
  p_first_name     text default null,
  p_last_name      text default null,
  p_preferred_name text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  if not (public.is_super_admin()
          or public.is_linked_parent(p_player_id)
          or (not public.player_has_guardian(p_player_id)
              and public.is_current_team_coach_of_player(p_player_id))) then
    raise exception 'Only this child''s family can change their name or graduation year'
      using hint = 'A coach can edit a roster spot only until a family claims it.';
  end if;

  update players set
    name           = coalesce(nullif(trim(p_name), ''), name),
    grad_class     = case when p_grad_class     is null then grad_class     else nullif(trim(p_grad_class), '')     end,
    first_name     = case when p_first_name     is null then first_name     else nullif(trim(p_first_name), '')     end,
    last_name      = case when p_last_name      is null then last_name      else nullif(trim(p_last_name), '')      end,
    preferred_name = case when p_preferred_name is null then preferred_name else nullif(trim(p_preferred_name), '') end
  where id = p_player_id;

  -- Re-label this child's chip on every team, through the one shared label function.
  update tags tg
     set name = public.player_chip_label(tg.team_id, tg.player_id,
                  (select pt.jersey_number from player_teams pt
                    where pt.player_id = tg.player_id and pt.team_id = tg.team_id limit 1))
   where tg.player_id = p_player_id and tg.category = 'players';
end $function$;

-- The 3-argument form D6 created is now the leading prefix of the 6-argument one, so drop it
-- to keep calls unambiguous. (Both were added in this same slice; nothing installed calls it.)
drop function if exists public.update_player_identity(uuid, text, text);

grant execute on function public.update_player_identity(uuid, text, text, text, text, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';

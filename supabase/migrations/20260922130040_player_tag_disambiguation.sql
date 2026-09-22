-- Player chip labels: disambiguate duplicate first names, and require a roster link.
--
-- Why: ensure_player_tag() labelled a chip "<first name> [#jersey]". Two kids with
-- the same first name and no jersey produced two identical, indistinguishable chips
-- (live case: Jackson Schneider + Jackson Tochman on Regents Bangels). The workaround
-- was to hand-create chips on the My Tags screen, and that path never sets player_id
-- — so the chip tags clips but carries no player identity, and per
-- clip_tags' lineup trigger, "only player-category tags that carry a real player_id
-- create a lineup row". Those kids silently dropped out of lineups/box score.
--
-- Safe to change labels: nothing reads a player tag by NAME. make-highlight, export
-- and the lineup trigger all key on tags.player_id or tags.id, and the export bundle
-- matcher is id-based. Renaming is display-only.
--
-- No backfill needed: no team currently holds two player chips with the same label.

-- 1. Label helper. Returns a chip label for one player on one team, adding the
--    least-noisy distinguishing suffix only when another chip on that team already
--    holds the same first name. Fallback order: last initial -> jersey -> number.
--    Peers are detected from the team's existing CHIPS (the actual collision
--    surface) rather than roster membership, so left_at semantics don't matter.
CREATE OR REPLACE FUNCTION public.player_chip_label (
  p_team   uuid,
  p_player uuid,
  p_jersey text
)
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_name text; v_first text; v_last text; v_base text; v_label text;
  v_peers int; v_same_initial int; n int := 1;
begin
  select name into v_name from players where id = p_player;
  if v_name is null then return null; end if;

  v_first  := split_part(v_name, ' ', 1);
  v_last   := nullif(trim(split_part(v_name, ' ', 2)), '');
  p_jersey := nullif(trim(p_jersey), '');

  -- A name already written as a jersey ("#32 Smith") is used verbatim, as before.
  if v_first like '#%' then return v_first; end if;
  v_base := v_first;

  select count(*) into v_peers
  from tags t join players p on p.id = t.player_id
  where t.team_id = p_team and t.category = 'players'
    and t.player_id is not null and t.player_id <> p_player
    and lower(split_part(p.name, ' ', 1)) = lower(v_first);

  -- No clash: keep today's exact behaviour.
  if v_peers = 0 then
    return v_base || coalesce(' #' || p_jersey, '');
  end if;

  -- Clash. Prefer a last initial, but only if it is itself unique among the peers.
  if v_last is not null then
    select count(*) into v_same_initial
    from tags t join players p on p.id = t.player_id
    where t.team_id = p_team and t.category = 'players'
      and t.player_id is not null and t.player_id <> p_player
      and lower(split_part(p.name, ' ', 1)) = lower(v_first)
      and lower(left(nullif(trim(split_part(p.name, ' ', 2)), ''), 1)) = lower(left(v_last, 1));
    if v_same_initial = 0 then
      return v_base || ' ' || upper(left(v_last, 1)) || '.';
    end if;
  end if;

  -- Half this product's rosters are first-name-only and jerseys are rarely set,
  -- so a numeric backstop is load-bearing, not theoretical.
  if p_jersey is not null then
    return v_base || ' #' || p_jersey;
  end if;

  -- Exclude this player's OWN chip: the relabel pass re-runs this for a chip that
  -- already holds a numbered label, and counting itself as a collision would walk
  -- the number up on every pass and make the result depend on row order.
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

-- 2. Create the chip with a distinguishing label, then re-label every existing chip
--    on the team that shares the first name. Both sides get a suffix — renaming only
--    the newcomer would leave the incumbent ambiguous ("Jackson" vs "Jackson T.").
CREATE OR REPLACE FUNCTION public.ensure_player_tag()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_first text;
  r record;
begin
  insert into tags (name, category, scope, team_id, player_id, sort_order)
  select public.player_chip_label(NEW.team_id, NEW.player_id, NEW.jersey_number),
         'players', 'team', NEW.team_id, NEW.player_id,
         coalesce((select max(sort_order) + 1 from tags
                   where team_id = NEW.team_id and category = 'players'), 0)
  from players p
  where p.id = NEW.player_id
  on conflict do nothing;

  select lower(split_part(p.name, ' ', 1)) into v_first
  from players p where p.id = NEW.player_id;
  if v_first is null then return NEW; end if;

  -- distinct on (t.id): a player can hold several player_teams rows for the same
  -- team across seasons, which would otherwise re-update the same chip per season.
  for r in
    select distinct on (t.id) t.id, t.player_id, pt.jersey_number
    from tags t
    join players p on p.id = t.player_id
    left join player_teams pt
      on pt.player_id = t.player_id and pt.team_id = t.team_id
    where t.team_id = NEW.team_id and t.category = 'players'
      and t.player_id is not null
      and lower(split_part(p.name, ' ', 1)) = v_first
    order by t.id, pt.joined_on desc nulls last
  loop
    update tags
       set name = public.player_chip_label(NEW.team_id, r.player_id, r.jersey_number)
     where id = r.id
       and name is distinct from public.player_chip_label(NEW.team_id, r.player_id, r.jersey_number);
  end loop;

  return NEW;
end $function$;

-- 3. Close the hand-made-chip hole at the database, so it holds for every client —
--    including installed iOS builds that still offer "+ Add" under Players.
--    BEFORE INSERT only: tags_player_id_fkey is ON DELETE SET NULL, so a CHECK
--    constraint here would make deleting a player fail.
CREATE OR REPLACE FUNCTION public.reject_unlinked_player_tag()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public'
  AS $function$
begin
  if NEW.category = 'players' and NEW.player_id is null then
    raise exception 'Player tags come from the team roster, not tag management.'
      using errcode = '23514',
            hint = 'Add the player to the roster; their tag is created automatically.';
  end if;
  return NEW;
end $function$;

DROP TRIGGER IF EXISTS trg_reject_unlinked_player_tag ON public.tags;
CREATE TRIGGER trg_reject_unlinked_player_tag
  BEFORE INSERT ON public.tags
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_unlinked_player_tag();

GRANT EXECUTE ON FUNCTION public.player_chip_label(uuid, uuid, text)
  TO PUBLIC, anon, authenticated, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.reject_unlinked_player_tag()
  TO PUBLIC, anon, authenticated, postgres, service_role;

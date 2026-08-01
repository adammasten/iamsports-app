-- migration_search.sql — global home search. One SECURITY INVOKER function so
-- every sub-query runs AS THE CALLER: each entity table's existing RLS
-- (players_read / teams_read / games_read / highlight_reels_read) already limits
-- rows to the user's teams/kids + shared content, so a UNION of ILIKE queries is
-- AUTOMATICALLY permission-scoped and can never surface another kid's footage.
-- No search index needed. Returns grouped results (Players / Teams / Games /
-- Reels), each capped. Number-only roster spots ("#12") match by name OR jersey.
-- INVOKER (not DEFINER) is load-bearing here — do not make it SECURITY DEFINER.

create or replace function public.search_all(q text)
returns jsonb language plpgsql stable set search_path to 'public' as $$
declare raw text := trim(coalesce(q, '')); pat text; result jsonb;
begin
  if length(raw) < 2 then
    return jsonb_build_object('players','[]'::jsonb,'teams','[]'::jsonb,'games','[]'::jsonb,'reels','[]'::jsonb);
  end if;
  pat := '%' || raw || '%';

  select jsonb_build_object(
    'players', (select coalesce(jsonb_agg(x order by (x->>'name')), '[]'::jsonb) from (
      select distinct jsonb_build_object('id', p.id, 'name', p.name) as x
      from players p
      where p.name ilike pat
         or exists (select 1 from player_teams pt where pt.player_id = p.id and pt.jersey_number = raw)
      limit 6
    ) s),
    'teams', (select coalesce(jsonb_agg(x order by (x->>'name')), '[]'::jsonb) from (
      select jsonb_build_object('id', t.id, 'name', t.name, 'logo_path', t.logo_path) as x
      from teams t where t.name ilike pat limit 6
    ) s),
    'games', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select jsonb_build_object('id', g.id, 'title', g.title, 'opponent', g.opponent,
                                'game_date', g.game_date, 'team_id', g.team_id) as x
      from games g where g.title ilike pat or g.opponent ilike pat
      order by g.game_date desc nulls last limit 6
    ) s),
    'reels', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select jsonb_build_object('id', r.id, 'name', r.name, 'storage_path', r.storage_path) as x
      from highlight_reels r where r.name ilike pat
      order by r.created_at desc limit 6
    ) s)
  ) into result;
  return result;
end $$;
grant execute on function public.search_all(text) to authenticated;

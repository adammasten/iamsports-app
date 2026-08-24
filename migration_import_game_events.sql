-- =====================================================================
-- Bulk import of AI-parsed games (Stage 1 "add without notifying").
-- APPLIED LIVE via the Supabase MCP (migration: import_game_events_bulk).
-- Inserts the whole reviewed batch in ONE transaction with the events trigger
-- suppressed, so a 12-game season import fires ZERO per-game alerts. SECURITY
-- INVOKER → events/games RLS (is_team_coach) still gates it. Mirrors saveEvent's
-- event + linked-games shape. Called by app/import-schedule.tsx.
-- =====================================================================
create or replace function public.import_game_events(p_team_id uuid, p_rows jsonb)
returns integer
language plpgsql security invoker set search_path = public as $$
declare r jsonb; v_event uuid; v_opp text; v_title text; n int := 0;
begin
  perform set_config('app.suppress_event_notify', '1', true);
  for r in select value from jsonb_array_elements(p_rows) loop
    v_opp := nullif(trim(r->>'opponent'), '');
    v_title := case when v_opp is not null then 'vs ' || v_opp else null end;
    insert into public.events (team_id, event_type, title, local_date, starts_at, time_status, home_away, venue_name, event_timezone, created_by)
    values (
      p_team_id, 'game', v_title, (r->>'date')::date,
      case when coalesce(r->>'starts_at','') <> '' then (r->>'starts_at')::timestamptz end,
      coalesce(nullif(r->>'time_status',''), 'tbd'),
      nullif(r->>'home_away', ''),
      nullif(trim(r->>'venue_name'), ''),
      coalesce(nullif(r->>'tz',''), 'America/Chicago'),
      auth.uid()
    ) returning id into v_event;
    insert into public.games (team_id, title, opponent, game_date, event_id)
    values (p_team_id, coalesce(v_title, 'Game'), v_opp, (r->>'date')::date, v_event);
    n := n + 1;
  end loop;
  return n;
end;
$$;
grant execute on function public.import_game_events(uuid, jsonb) to authenticated;
-- =====================================================================

-- =====================================================================
-- Edit "this & all future occurrences" of a recurring series (Slice 5 polish).
-- APPLIED LIVE via the Supabase MCP (migration: schedule_update_series_forward).
-- Updates this + every later still-scheduled occurrence in the series; each
-- occurrence's times are recomputed for its OWN date at the event timezone
-- (DST-correct). Past occurrences are untouched (history). SECURITY INVOKER so
-- the events_update RLS (is_team_coach) gates every row.
-- =====================================================================
create or replace function public.update_series_forward(
  p_series_id uuid,
  p_from_date date,
  p_title text,
  p_start_time time,
  p_arrival_time time,
  p_end_time time,
  p_tz text,
  p_venue_name text,
  p_venue_address text,
  p_uniform text,
  p_notes text
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count int;
begin
  update public.events e set
    title = p_title,
    starts_at   = case when p_start_time   is not null then ((e.local_date::text || ' ' || p_start_time)::timestamp   at time zone p_tz) end,
    arrival_at  = case when p_arrival_time is not null then ((e.local_date::text || ' ' || p_arrival_time)::timestamp at time zone p_tz) end,
    ends_at     = case when p_end_time     is not null then ((e.local_date::text || ' ' || p_end_time)::timestamp     at time zone p_tz) end,
    time_status = case when p_start_time is not null then 'confirmed' else 'tbd' end,
    venue_name = p_venue_name,
    venue_address = p_venue_address,
    uniform = p_uniform,
    notes = p_notes,
    event_timezone = p_tz
  where e.series_id = p_series_id
    and e.local_date >= p_from_date
    and e.status = 'scheduled';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.update_series_forward(uuid, date, text, time, time, time, text, text, text, text, text) to authenticated;
-- =====================================================================

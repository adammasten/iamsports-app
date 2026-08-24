-- =====================================================================
-- Recurring practices / team events — MATERIALIZED (Slice 5, decision D4).
-- APPLIED LIVE via the Supabase MCP (migration: schedule_practice_series).
-- Generates one discrete events row per matching date, all sharing a
-- series_id, so every occurrence stays individually editable/cancelable.
-- No client RRULE. Games never recur (guarded to practice/team_event).
-- SECURITY INVOKER: the events_insert RLS (is_team_coach) gates each row.
-- Times resolve at the event's own IANA tz so DST is correct.
-- =====================================================================
create or replace function public.create_practice_series(
  p_team_id uuid,
  p_event_type text,
  p_title text,
  p_first_date date,
  p_until_date date,
  p_weekdays int[],            -- Postgres dow: 0=Sun .. 6=Sat
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
  v_series uuid := gen_random_uuid();
  v_count int := 0;
  d date;
begin
  -- Suppress the events notification trigger: a recurring series must not fire one
  -- alert per occurrence (added with the notification backbone, Stage 1).
  perform set_config('app.suppress_event_notify', '1', true);
  if p_event_type not in ('practice','team_event') then
    raise exception 'Only practices and team events can repeat.';
  end if;
  if p_until_date < p_first_date then
    raise exception 'The end date must be on or after the first date.';
  end if;
  if p_until_date - p_first_date > 400 then
    raise exception 'That recurrence spans too long — keep it under about 13 months.';
  end if;
  if p_weekdays is null or array_length(p_weekdays, 1) is null then
    raise exception 'Pick at least one day of the week.';
  end if;

  for d in
    select gs::date from generate_series(p_first_date, p_until_date, interval '1 day') gs
    where extract(dow from gs)::int = any (p_weekdays)
  loop
    insert into public.events (
      team_id, event_type, title, local_date, starts_at, arrival_at, ends_at,
      event_timezone, time_status, venue_name, venue_address, uniform, notes,
      series_id, created_by
    ) values (
      p_team_id, p_event_type, p_title, d,
      case when p_start_time   is not null then ((d::text || ' ' || p_start_time)::timestamp   at time zone p_tz) end,
      case when p_arrival_time is not null then ((d::text || ' ' || p_arrival_time)::timestamp at time zone p_tz) end,
      case when p_end_time     is not null then ((d::text || ' ' || p_end_time)::timestamp     at time zone p_tz) end,
      p_tz,
      case when p_start_time is not null then 'confirmed' else 'tbd' end,
      p_venue_name, p_venue_address, p_uniform, p_notes,
      v_series, auth.uid()
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.create_practice_series(uuid, text, text, date, date, int[], time, time, time, text, text, text, text, text) to authenticated;
-- =====================================================================

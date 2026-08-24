// Scheduling data layer (RN-agnostic; UI stays platform-specific). Reads the
// unified `events` table joined to the linked `games` row (game-family events
// carry opponent + score from games). Writes an event and, for game-family
// types, creates/updates the 1:1 linked games row so film/tagging/stats attach
// exactly as before. Cancel-not-delete. Optimistic concurrency via `version`.

import { supabase } from '@/supabase';

export type EventType = 'game' | 'scrimmage' | 'practice' | 'tournament_game' | 'team_event';
export type TimeStatus = 'confirmed' | 'tbd' | 'all_day';
export type EventStatus = 'scheduled' | 'completed' | 'canceled' | 'postponed';

export const EVENT_TYPES: { value: EventType; label: string }[] = [
  { value: 'game', label: 'Game' },
  { value: 'scrimmage', label: 'Scrimmage' },
  { value: 'practice', label: 'Practice' },
  { value: 'tournament_game', label: 'Tournament game' },
  { value: 'team_event', label: 'Team event' },
];

export const GAME_FAMILY: EventType[] = ['game', 'scrimmage', 'tournament_game'];
export const isGameFamily = (t: EventType) => GAME_FAMILY.includes(t);
export function eventTypeLabel(t: EventType): string {
  return EVENT_TYPES.find(e => e.value === t)?.label ?? t;
}

// Filter chips: All · Games (game/scrimmage/tournament) · Practices · Events.
export type ScheduleFilter = 'all' | 'games' | 'practices' | 'events';
export function matchesFilter(t: EventType, f: ScheduleFilter): boolean {
  if (f === 'all') return true;
  if (f === 'games') return isGameFamily(t);
  if (f === 'practices') return t === 'practice';
  return t === 'team_event';
}

export type ScheduleEvent = {
  id: string;
  teamId: string;
  eventType: EventType;
  title: string | null;
  localDate: string;         // YYYY-MM-DD
  startsAt: string | null;   // ISO instant
  endsAt: string | null;
  arrivalAt: string | null;
  eventTimezone: string;
  timeStatus: TimeStatus;
  homeAway: 'home' | 'away' | null;
  venueName: string | null;
  venueAddress: string | null;
  status: EventStatus;
  uniform: string | null;
  notes: string | null;
  tournamentId: string | null;
  seasonId: string | null;
  seriesId: string | null;
  snacksEnabled: boolean;
  version: number;
  // From the linked game (game-family only):
  gameId: string | null;
  opponent: string | null;
  teamScore: number | null;
  opponentScore: number | null;
};

export async function loadEvents(teamIds: string | string[]): Promise<ScheduleEvent[]> {
  const ids = Array.isArray(teamIds) ? teamIds : [teamIds];
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('events')
    .select('id, team_id, event_type, title, local_date, starts_at, ends_at, arrival_at, event_timezone, time_status, home_away, venue_name, venue_address, status, uniform, notes, tournament_id, season_id, series_id, snacks_enabled, version, games(id, opponent, team_score, opponent_score, deleted_at)')
    .in('team_id', ids)
    .order('local_date', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: any) => {
    const games = Array.isArray(r.games) ? r.games : r.games ? [r.games] : [];
    const g = games.find((x: any) => !x.deleted_at) ?? games[0] ?? null;
    return {
      id: r.id, teamId: r.team_id, eventType: r.event_type, title: r.title,
      localDate: r.local_date, startsAt: r.starts_at, endsAt: r.ends_at, arrivalAt: r.arrival_at,
      eventTimezone: r.event_timezone, timeStatus: r.time_status, homeAway: r.home_away,
      venueName: r.venue_name, venueAddress: r.venue_address, status: r.status,
      uniform: r.uniform, notes: r.notes, tournamentId: r.tournament_id, seasonId: r.season_id,
      seriesId: r.series_id, snacksEnabled: r.snacks_enabled ?? true, version: r.version,
      gameId: g?.id ?? null, opponent: g?.opponent ?? null,
      teamScore: g?.team_score ?? null, opponentScore: g?.opponent_score ?? null,
    };
  });
}

export type EventInput = {
  id?: string;               // present = edit
  teamId: string;
  eventType: EventType;
  title: string | null;
  localDate: string;
  startsAt: string | null;
  endsAt: string | null;
  arrivalAt: string | null;
  eventTimezone: string;
  timeStatus: TimeStatus;
  homeAway: 'home' | 'away' | null;
  venueName: string | null;
  venueAddress: string | null;
  uniform: string | null;
  notes: string | null;
  tournamentId: string | null;
  seasonId: string | null;
  snacksEnabled?: boolean;
  opponent: string | null;   // game-family
  version?: number;          // edit: optimistic concurrency
  gameId?: string | null;    // edit: existing linked game
};

// Insert or update an event (+ its linked game for game-family types).
export async function saveEvent(input: EventInput, userId: string): Promise<void> {
  const gameFamily = isGameFamily(input.eventType);
  const title = input.title?.trim()
    || (gameFamily && input.opponent?.trim() ? `vs ${input.opponent.trim()}` : null)
    || (input.eventType === 'practice' ? 'Practice' : null);

  const row: any = {
    team_id: input.teamId, event_type: input.eventType, title,
    local_date: input.localDate, starts_at: input.startsAt, ends_at: input.endsAt, arrival_at: input.arrivalAt,
    event_timezone: input.eventTimezone, time_status: input.timeStatus,
    home_away: gameFamily ? input.homeAway : null,
    venue_name: input.venueName?.trim() || null, venue_address: input.venueAddress?.trim() || null,
    uniform: input.uniform?.trim() || null, notes: input.notes?.trim() || null,
    tournament_id: input.tournamentId, season_id: input.seasonId,
    snacks_enabled: input.snacksEnabled ?? true,
  };

  let eventId = input.id;
  if (eventId) {
    const { data, error } = await supabase.from('events').update(row).eq('id', eventId).eq('version', input.version ?? -1).select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('This event was just changed by someone else — refresh and try again.');
  } else {
    row.created_by = userId;
    const { data, error } = await supabase.from('events').insert(row).select('id').single();
    if (error) throw error;
    eventId = (data as any).id;
  }

  // Game-family → keep the linked games row in sync (film/tagging/stats attach here).
  if (gameFamily) {
    const gameRow: any = {
      team_id: input.teamId, title: title ?? 'Game', opponent: input.opponent?.trim() || null,
      game_date: input.localDate, season_id: input.seasonId, tournament_id: input.tournamentId, event_id: eventId,
    };
    if (input.gameId) {
      const { error } = await supabase.from('games').update(gameRow).eq('id', input.gameId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('games').insert(gameRow);
      if (error) throw error;
    }
  }
}

// ── Tournaments (containers of multiple games) ─────────────────────────
export type Tournament = { id: string; teamId: string; name: string };

export async function loadTournaments(teamIds: string[]): Promise<Tournament[]> {
  if (teamIds.length === 0) return [];
  const { data, error } = await supabase.from('tournaments').select('id, team_id, name').in('team_id', teamIds);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ id: r.id, teamId: r.team_id, name: r.name }));
}

export async function createTournament(teamId: string, name: string, userId: string): Promise<string> {
  const { data, error } = await supabase.from('tournaments')
    .insert({ team_id: teamId, name: name.trim(), created_by_user_id: userId }).select('id').single();
  if (error) throw error;
  return (data as any).id as string;
}

// Cancel, don't delete — keeps history + notifications explainable.
export async function cancelEvent(eventId: string): Promise<void> {
  const { error } = await supabase.from('events').update({ status: 'canceled' }).eq('id', eventId);
  if (error) throw error;
}

// ── Recurring practices / team events (materialized) ───────────────────
export type SeriesInput = {
  teamId: string;
  eventType: 'practice' | 'team_event';
  title: string | null;
  firstDate: string;             // YYYY-MM-DD
  untilDate: string;             // YYYY-MM-DD inclusive
  weekdays: number[];            // 0=Sun .. 6=Sat
  startTime: string | null;      // 'HH:MM' (24h) or null = TBD
  arrivalTime: string | null;
  endTime: string | null;
  eventTimezone: string;
  venueName: string | null;
  venueAddress: string | null;
  uniform: string | null;
  notes: string | null;
};

// Generate all occurrences server-side (one events row each, shared series_id).
// Returns the number of occurrences created.
export async function createPracticeSeries(s: SeriesInput): Promise<number> {
  const t = (v: string | null) => (v && v.trim() ? `${v.trim()}:00` : null);
  const { data, error } = await supabase.rpc('create_practice_series', {
    p_team_id: s.teamId, p_event_type: s.eventType, p_title: s.title?.trim() || (s.eventType === 'practice' ? 'Practice' : null),
    p_first_date: s.firstDate, p_until_date: s.untilDate, p_weekdays: s.weekdays,
    p_start_time: t(s.startTime), p_arrival_time: t(s.arrivalTime), p_end_time: t(s.endTime),
    p_tz: s.eventTimezone,
    p_venue_name: s.venueName?.trim() || null, p_venue_address: s.venueAddress?.trim() || null,
    p_uniform: s.uniform?.trim() || null, p_notes: s.notes?.trim() || null,
  });
  if (error) throw error;
  return (data as number) ?? 0;
}

// Apply an edit to this + every later still-scheduled occurrence in a series.
// Times recompute per each occurrence's own date (server-side). Returns count.
export async function updateSeriesForward(args: {
  seriesId: string; fromDate: string; title: string | null;
  startTime: string | null; arrivalTime: string | null; endTime: string | null; eventTimezone: string;
  venueName: string | null; venueAddress: string | null; uniform: string | null; notes: string | null;
}): Promise<number> {
  const t = (v: string | null) => (v && v.trim() ? `${v.trim()}:00` : null);
  const { data, error } = await supabase.rpc('update_series_forward', {
    p_series_id: args.seriesId, p_from_date: args.fromDate, p_title: args.title?.trim() || null,
    p_start_time: t(args.startTime), p_arrival_time: t(args.arrivalTime), p_end_time: t(args.endTime), p_tz: args.eventTimezone,
    p_venue_name: args.venueName?.trim() || null, p_venue_address: args.venueAddress?.trim() || null,
    p_uniform: args.uniform?.trim() || null, p_notes: args.notes?.trim() || null,
  });
  if (error) throw error;
  return (data as number) ?? 0;
}

// Cancel every still-scheduled occurrence of a series from a date forward
// (past occurrences keep their history). Returns how many were canceled.
export async function cancelSeries(seriesId: string, fromDate: string): Promise<number> {
  const { data, error } = await supabase.from('events').update({ status: 'canceled' })
    .eq('series_id', seriesId).gte('local_date', fromDate).eq('status', 'scheduled').select('id');
  if (error) throw error;
  return (data ?? []).length;
}

// ── RSVP / attendance ──────────────────────────────────────────────────
export type RsvpStatus = 'going' | 'maybe' | 'out';
export type Attendance = { eventId: string; playerId: string; status: RsvpStatus };

export async function loadAttendance(eventIds: string[]): Promise<Attendance[]> {
  if (eventIds.length === 0) return [];
  const { data, error } = await supabase
    .from('event_attendance').select('event_id, player_id, rsvp_status').in('event_id', eventIds);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ eventId: r.event_id, playerId: r.player_id, status: r.rsvp_status }));
}

// Upsert a player's RSVP for an event (keyed to player_id; records the responder).
export async function setRsvp(eventId: string, playerId: string, status: RsvpStatus, userId: string): Promise<void> {
  const { error } = await supabase.from('event_attendance').upsert(
    { event_id: eventId, player_id: playerId, rsvp_status: status, responder_user_id: userId, updated_at: new Date().toISOString() },
    { onConflict: 'event_id,player_id' },
  );
  if (error) throw error;
}

// ── Calendar export (.ics) ─────────────────────────────────────────────
// Build a standard iCalendar file from upcoming events. Timed events export with
// their UTC instant (calendars render in the viewer's local tz); TBD/all-day
// events export as all-day. Game-family events get a 2-hour reminder.
function icsStamp(iso: string): string { return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
function icsEsc(s: string): string { return s.replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n'); }

export function buildICS(events: ScheduleEvent[], calName: string): string {
  const now = icsStamp(new Date().toISOString());
  const out: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//IamSports//Schedule//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsEsc(calName)} Schedule`];
  for (const ev of events) {
    if (ev.status === 'canceled') continue;
    const summary = ev.title || (isGameFamily(ev.eventType) && ev.opponent ? `vs ${ev.opponent}` : eventTypeLabel(ev.eventType));
    out.push('BEGIN:VEVENT', `UID:${ev.id}@iamsports`, `DTSTAMP:${now}`);
    if (ev.timeStatus === 'confirmed' && ev.startsAt) {
      out.push(`DTSTART:${icsStamp(ev.startsAt)}`);
      if (ev.endsAt) out.push(`DTEND:${icsStamp(ev.endsAt)}`);
    } else {
      out.push(`DTSTART;VALUE=DATE:${ev.localDate.replace(/-/g, '')}`);
    }
    out.push(`SUMMARY:${icsEsc(`${calName}: ${summary}`)}`);
    const loc = [ev.venueName, ev.venueAddress].filter(Boolean).join(', ');
    if (loc) out.push(`LOCATION:${icsEsc(loc)}`);
    const desc = [ev.uniform ? `Uniform: ${ev.uniform}` : '', ev.notes ?? ''].filter(Boolean).join('\n');
    if (desc) out.push(`DESCRIPTION:${icsEsc(desc)}`);
    if (isGameFamily(ev.eventType) && ev.timeStatus === 'confirmed' && ev.startsAt) {
      out.push('BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(summary)}`, 'END:VALARM');
    }
    out.push('END:VEVENT');
  }
  out.push('END:VCALENDAR');
  return out.join('\r\n');
}

// Active-roster player count per team (denominator for the "no answer" headcount).
export async function loadRosterCounts(teamIds: string[]): Promise<Record<string, number>> {
  if (teamIds.length === 0) return {};
  const { data, error } = await supabase
    .from('player_teams').select('team_id').in('team_id', teamIds).is('left_at', null);
  if (error) throw error;
  const out: Record<string, number> = {};
  (data ?? []).forEach((r: any) => { out[r.team_id] = (out[r.team_id] ?? 0) + 1; });
  return out;
}

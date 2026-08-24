// team-calendar — a live, read-only ICS feed per team (Stage 4). Parents subscribe
// once (webcal://…?token=<ics_token>) and their calendar app re-polls forever, so
// every schedule change flows in automatically. Public + token-gated (calendar
// apps can't send a JWT); the unguessable per-team token IS the auth. verify_jwt=false.
// ETag / If-None-Match caching is MANDATORY — hundreds of phones poll ~every 15 min.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const svc = createClient(SUPA_URL, SERVICE_ROLE);

const TYPE_LABEL: Record<string, string> = { game: "Game", scrimmage: "Scrimmage", tournament_game: "Tournament game", practice: "Practice", team_event: "Team event" };
const GAME_FAMILY = new Set(["game", "scrimmage", "tournament_game"]);
function icsEsc(s: string): string { return s.replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\n/g, "\\n"); }
function stampUtc(iso: string): string { return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const cors = { "Access-Control-Allow-Origin": "*" };
  if (!token) return new Response("Missing token", { status: 400, headers: cors });

  const { data: team } = await svc.from("teams").select("id, name").eq("ics_token", token).maybeSingle();
  if (!team) return new Response("Calendar not found", { status: 404, headers: cors });

  const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
  const { data: events } = await svc.from("events")
    .select("id, title, event_type, local_date, starts_at, ends_at, event_timezone, time_status, venue_name, venue_address, uniform, notes, status, updated_at, games(opponent, deleted_at)")
    .eq("team_id", (team as any).id).gte("local_date", since).order("local_date", { ascending: true });
  const evs = events ?? [];

  // ETag from row count + newest change → unchanged feed returns 304 (no rebuild).
  const maxUpd = evs.reduce((m: number, e: any) => Math.max(m, new Date(e.updated_at || 0).getTime()), 0);
  const etag = `"${evs.length}-${maxUpd}"`;
  const cacheHeaders = { ...cors, "ETag": etag, "Cache-Control": "public, max-age=900" };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: cacheHeaders });

  const now = stampUtc(new Date().toISOString());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//IamSports//Schedule//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsEsc((team as any).name)}`];
  for (const ev of evs as any[]) {
    const game = Array.isArray(ev.games) ? ev.games.find((g: any) => !g.deleted_at) : ev.games;
    const summary = ev.title || (game?.opponent ? `vs ${game.opponent}` : (TYPE_LABEL[ev.event_type] ?? "Event"));
    lines.push("BEGIN:VEVENT", `UID:${ev.id}@iamsports`, `DTSTAMP:${now}`);
    if (ev.time_status === "confirmed" && ev.starts_at) {
      lines.push(`DTSTART:${stampUtc(ev.starts_at)}`);
      if (ev.ends_at) lines.push(`DTEND:${stampUtc(ev.ends_at)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${(ev.local_date as string).replace(/-/g, "")}`);
    }
    lines.push(`SUMMARY:${icsEsc(summary)}`);
    const loc = [ev.venue_name, ev.venue_address].filter(Boolean).join(", ");
    if (loc) lines.push(`LOCATION:${icsEsc(loc)}`);
    const desc = [ev.uniform ? `Uniform: ${ev.uniform}` : "", ev.notes ?? ""].filter(Boolean).join("\n");
    if (desc) lines.push(`DESCRIPTION:${icsEsc(desc)}`);
    lines.push(`STATUS:${ev.status === "canceled" ? "CANCELLED" : "CONFIRMED"}`);
    if (GAME_FAMILY.has(ev.event_type) && ev.time_status === "confirmed" && ev.starts_at) {
      lines.push("BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(summary)}`, "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");

  return new Response(lines.join("\r\n"), {
    status: 200,
    headers: { ...cacheHeaders, "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `inline; filename="iamsports.ics"` },
  });
});

// team-calendar — a live, read-only ICS feed per team (Stage 4). Parents subscribe
// once (webcal://…?token=<ics_token>) and their calendar app re-polls forever, so
// every schedule change flows in automatically. Public + token-gated (calendar
// apps can't send a JWT); the unguessable per-team token IS the auth. verify_jwt=false.
// ETag / If-None-Match caching is MANDATORY — hundreds of phones poll ~every 15 min.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
// ── NEW SUPABASE API KEYS (transitional) ─────────────────────────────────────
// The new key system exposes SUPABASE_SECRET_KEYS / SUPABASE_PUBLISHABLE_KEYS as JSON
// objects keyed by key NAME ('default' here) — NOT plain strings like the legacy vars.
// Supabase adds them ALONGSIDE the legacy vars and does NOT repoint the legacy ones, so
// every function must read the new shape itself.
//
// The legacy fallback is what makes this deploy zero-downtime while legacy JWT keys are
// still enabled: a malformed or missing new var can never take the function down.
// DELETE THE FALLBACK (the final `?? Deno.env.get(legacyEnv)`) once legacy keys are
// deactivated. test_edge_key_migration.ts fails if a direct legacy read reappears
// anywhere outside this resolver.
function namedKey(jsonEnv: string, legacyEnv: string): string {
  const raw = Deno.env.get(jsonEnv);
  if (raw) {
    try {
      const k = JSON.parse(raw)?.default;
      if (typeof k === "string" && k.length > 0) return k;
    } catch { /* malformed → fall through to the legacy var */ }
  }
  // LEGACY FALLBACK. Logged by NAME so the function logs prove which key source is live —
  // with a fallback in place, "the function works" does NOT prove the migration took
  // effect. Never logs a key value.
  console.warn(`[keys] ${jsonEnv} unavailable — falling back to ${legacyEnv}`);
  return Deno.env.get(legacyEnv) ?? "";
}
// Privileged backend key. Sent as the project apikey; never as a user JWT.
const SECRET_KEY = namedKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
// Acting AS THE USER: apikey = publishable, Authorization = the caller's own JWT, so RLS
// applies to them. Some of these previously passed the SECRET key as the apikey, which
// worked but shipped a secret on a request that never needed one.
const PUBLISHABLE_KEY = namedKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
const svc = createClient(SUPA_URL, SECRET_KEY);

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

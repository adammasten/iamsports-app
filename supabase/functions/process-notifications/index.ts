// process-notifications — the notification backbone worker (Stage 1).
// Runs on a schedule (pg_cron, ~every minute). Two phases:
//   1) EXPAND: drain due notification_outbox rows → per-recipient schedule_notifications
//      rows (idempotent via dedupe_key), with recipient-local quiet-hours deferral.
//   2) DISPATCH: send due queued push rows via Expo, record delivery status.
// Channel dispatchers live here; adding SMS later = one more dispatch block.
// Service-role only; invoked by cron with the anon/service header. Never throws
// in a way that would wedge the queue — each item is isolated.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXPO_PUSH = "https://exp.host/--/api/v2/push/send";
const DEFAULT_TZ = "America/Chicago";
const URGENT_WINDOW_HOURS = 6; // time/venue change within this of kickoff bypasses quiet hours
const QUIET_START = 22, QUIET_END = 7;

const svc = createClient(SUPA_URL, SERVICE_ROLE);

function chunk<T>(a: T[], n: number): T[][] { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }

// ── tz / quiet-hours helpers ────────────────────────────────────────────
function partsInTz(tz: string, at: Date) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(at)) p[part.type] = part.value;
  return { y: +p.year, m: +p.month, d: +p.day, H: +(p.hour === "24" ? "0" : p.hour), M: +p.minute };
}
function localWallToUtc(y: number, m: number, d: number, H: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, H, 0, 0);
  const p = partsInTz(tz, new Date(guess));
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.H, p.M, 0);
  return new Date(guess - (asUtc - guess)); // subtract the tz offset
}
function next7am(tz: string, now: Date): Date {
  const p = partsInTz(tz, now);
  if (p.H < QUIET_END) return localWallToUtc(p.y, p.m, p.d, QUIET_END, tz);            // early AM → today 7am
  const t = new Date(now.getTime() + 24 * 3600 * 1000);                                // late night → tomorrow 7am
  const q = partsInTz(tz, t);
  return localWallToUtc(q.y, q.m, q.d, QUIET_END, tz);
}
function computeSendAfter(kind: string, startsAt: string | null, tz: string, now: Date): string {
  const urgent = kind === "canceled" ||
    (!!startsAt && new Date(startsAt).getTime() - now.getTime() < URGENT_WINDOW_HOURS * 3600 * 1000);
  if (urgent) return now.toISOString();
  try {
    const h = partsInTz(tz, now).H;
    if (h >= QUIET_START || h < QUIET_END) return next7am(tz, now).toISOString();
  } catch { /* fall through to send now */ }
  return now.toISOString();
}

// ── copy ────────────────────────────────────────────────────────────────
const TYPE_LABEL: Record<string, string> = { game: "Game", scrimmage: "Scrimmage", tournament_game: "Tournament game", practice: "Practice", team_event: "Team event" };
function fmtDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  try { return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); } catch { return ymd; }
}
function fmtWhen(startsAt: string | null, ymd: string, tz: string): string {
  if (!startsAt) return fmtDate(ymd);
  try {
    const t = new Date(startsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
    return `${fmtDate(ymd)} · ${t}`;
  } catch { return fmtDate(ymd); }
}
function copyFor(kind: string, ev: any): { title: string; body: string } | null {
  const team = ev.team_name ?? "Team";
  const label = ev.title || (ev.opponent ? `vs ${ev.opponent}` : (TYPE_LABEL[ev.event_type] ?? "Event"));
  const when = fmtWhen(ev.starts_at, ev.local_date, ev.event_timezone ?? DEFAULT_TZ);
  switch (kind) {
    case "created": return { title: `🗓️ ${team}: new ${(TYPE_LABEL[ev.event_type] ?? "event").toLowerCase()}`, body: `${label} — ${when}` };
    case "time_changed": return { title: `🕒 ${team}: schedule update`, body: `${label} is now ${when}` };
    case "venue_changed": return { title: `📍 ${team}: location update`, body: `${label}${ev.venue_name ? ` — ${ev.venue_name}` : ""}` };
    case "canceled": return { title: `❌ ${team}: canceled`, body: `${label} on ${fmtDate(ev.local_date)} is canceled` };
    default: return null; // 'completed' → handled by the film hook (Stage 5), not a team blast
  }
}

// ── phase 1: expand outbox → per-recipient rows ─────────────────────────
async function expand(): Promise<number> {
  const now = new Date();
  const { data: due } = await svc.from("notification_outbox").select("*")
    .is("processed_at", null).lte("dispatch_after", now.toISOString()).limit(100);
  if (!due || due.length === 0) return 0;

  for (const ob of due) {
    try {
      const { data: ev } = await svc.from("events")
        .select("id, team_id, title, event_type, local_date, starts_at, event_timezone, venue_name, teams(name), games(opponent, deleted_at)")
        .eq("id", ob.event_id).maybeSingle();
      const copy = ev ? copyFor(ob.change_kind, {
        ...ev, team_name: (ev as any).teams?.name,
        opponent: (Array.isArray((ev as any).games) ? (ev as any).games.find((g: any) => !g.deleted_at) : (ev as any).games)?.opponent ?? null,
      }) : null;

      if (copy) {
        const { data: recips } = await svc.rpc("resolve_event_recipients", { p_event_id: ob.event_id, p_exclude: ob.actor_user_id });
        const tz_rows = recips && recips.length
          ? await svc.from("user_profiles").select("user_id, timezone").in("user_id", recips.map((r: any) => r.recipient_user_id))
          : { data: [] as any[] };
        const tzByUser = new Map<string, string>((tz_rows.data ?? []).map((r: any) => [r.user_id, r.timezone || DEFAULT_TZ]));

        const rows = (recips ?? []).map((r: any) => {
          const uid = r.recipient_user_id;
          const tz = tzByUser.get(uid) || DEFAULT_TZ;
          return {
            event_id: ob.event_id, team_id: ob.team_id, recipient_user_id: uid, channel: "push",
            change_kind: ob.change_kind, dedupe_key: `${ob.event_id}:${uid}:push:${ob.change_kind}:${ob.event_version ?? 0}`,
            status: "queued", send_after: computeSendAfter(ob.change_kind, (ev as any)?.starts_at ?? null, tz, now),
            title: copy.title, body: copy.body, data: { url: "/schedule", event_id: ob.event_id },
          };
        });
        if (rows.length) await svc.from("schedule_notifications").upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true });
      }
      await svc.from("notification_outbox").update({ processed_at: new Date().toISOString() }).eq("id", ob.id);
    } catch (_e) {
      // isolate failures: mark processed so one bad row can't wedge the queue
      await svc.from("notification_outbox").update({ processed_at: new Date().toISOString() }).eq("id", ob.id);
    }
  }
  return due.length;
}

// ── phase 2: dispatch due queued push rows ──────────────────────────────
async function dispatchPush(): Promise<number> {
  const now = new Date().toISOString();
  const { data: candidates } = await svc.from("schedule_notifications").select("id, recipient_user_id, title, body, data")
    .eq("status", "queued").eq("channel", "push").lte("send_after", now).limit(500);
  if (!candidates || candidates.length === 0) return 0;

  // Claim atomically so a second worker tick can't re-send the same rows.
  const ids = candidates.map((c) => c.id);
  const { data: claimed } = await svc.from("schedule_notifications")
    .update({ status: "sent", sent_at: now, status_updated_at: now }).in("id", ids).eq("status", "queued")
    .select("id, recipient_user_id, title, body, data");
  if (!claimed || claimed.length === 0) return 0;

  const { data: tokenRows } = await svc.from("device_push_tokens").select("user_id, token")
    .in("user_id", Array.from(new Set(claimed.map((c) => c.recipient_user_id))));
  const tokensByUser = new Map<string, string[]>();
  for (const t of tokenRows ?? []) { const a = tokensByUser.get(t.user_id) ?? []; a.push(t.token); tokensByUser.set(t.user_id, a); }

  // Rows whose recipient has no device → skipped (SMS/wall will catch them later).
  const noDevice = claimed.filter((c) => !(tokensByUser.get(c.recipient_user_id)?.length));
  if (noDevice.length) await svc.from("schedule_notifications").update({ status: "skipped", error_code: "no_device", status_updated_at: now }).in("id", noDevice.map((c) => c.id));

  const pairs: { id: string; to: string; title: string; body: string; data: any }[] = [];
  for (const c of claimed) for (const to of (tokensByUser.get(c.recipient_user_id) ?? [])) pairs.push({ id: c.id, to, title: c.title, body: c.body, data: c.data });

  const failedRowIds = new Set<string>();
  for (const batch of chunk(pairs, 100)) {
    try {
      const res = await fetch(EXPO_PUSH, {
        method: "POST", headers: { "content-type": "application/json", "accept": "application/json" },
        body: JSON.stringify(batch.map((p) => ({ to: p.to, title: p.title, body: p.body, data: p.data, sound: "default" }))),
      });
      const out = await res.json().catch(() => null);
      const tickets = out?.data ?? [];
      if (!Array.isArray(tickets)) { for (const p of batch) failedRowIds.add(p.id); continue; }
      tickets.forEach((t: any, i: number) => { if (t?.status !== "ok") failedRowIds.add(batch[i].id); });
    } catch { for (const p of batch) failedRowIds.add(p.id); }
  }
  if (failedRowIds.size) await svc.from("schedule_notifications").update({ status: "failed", error_code: "push_error", status_updated_at: new Date().toISOString() }).in("id", Array.from(failedRowIds));
  return claimed.length;
}

Deno.serve(async () => {
  const expanded = await expand();
  const dispatched = await dispatchPush();
  return new Response(JSON.stringify({ expanded, dispatched }), { headers: { "content-type": "application/json" } });
});

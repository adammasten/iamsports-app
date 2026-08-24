// process-notifications — the notification backbone worker (Stage 1 + 3).
// pg_cron every minute. EXPAND drains notification_outbox → per-recipient
// schedule_notifications rows (idempotent, quiet-hours), for BOTH event changes
// and message announcements. DISPATCH sends due queued push rows via Expo.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXPO_PUSH = "https://exp.host/--/api/v2/push/send";
const DEFAULT_TZ = "America/Chicago";
const URGENT_WINDOW_HOURS = 6;
const QUIET_START = 22, QUIET_END = 7;

const svc = createClient(SUPA_URL, SERVICE_ROLE);
function chunk<T>(a: T[], n: number): T[][] { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }

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
  return new Date(guess - (asUtc - guess));
}
function next7am(tz: string, now: Date): Date {
  const p = partsInTz(tz, now);
  if (p.H < QUIET_END) return localWallToUtc(p.y, p.m, p.d, QUIET_END, tz);
  const t = new Date(now.getTime() + 24 * 3600 * 1000);
  const q = partsInTz(tz, t);
  return localWallToUtc(q.y, q.m, q.d, QUIET_END, tz);
}
function computeSendAfter(kind: string, startsAt: string | null, tz: string, now: Date): string {
  const urgent = kind === "canceled" || (!!startsAt && new Date(startsAt).getTime() - now.getTime() < URGENT_WINDOW_HOURS * 3600 * 1000);
  if (urgent) return now.toISOString();
  try { const h = partsInTz(tz, now).H; if (h >= QUIET_START || h < QUIET_END) return next7am(tz, now).toISOString(); } catch { /* now */ }
  return now.toISOString();
}
async function tzMap(userIds: string[]): Promise<Map<string, string>> {
  if (!userIds.length) return new Map();
  const { data } = await svc.from("user_profiles").select("user_id, timezone").in("user_id", userIds);
  return new Map((data ?? []).map((r: any) => [r.user_id, r.timezone || DEFAULT_TZ]));
}

const TYPE_LABEL: Record<string, string> = { game: "Game", scrimmage: "Scrimmage", tournament_game: "Tournament game", practice: "Practice", team_event: "Team event" };
function fmtDate(ymd: string): string { const [y, m, d] = ymd.split("-").map(Number); try { return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); } catch { return ymd; } }
function fmtWhen(startsAt: string | null, ymd: string, tz: string): string { if (!startsAt) return fmtDate(ymd); try { const t = new Date(startsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }); return `${fmtDate(ymd)} · ${t}`; } catch { return fmtDate(ymd); } }
function copyFor(kind: string, ev: any): { title: string; body: string } | null {
  const team = ev.team_name ?? "Team";
  const label = ev.title || (ev.opponent ? `vs ${ev.opponent}` : (TYPE_LABEL[ev.event_type] ?? "Event"));
  const when = fmtWhen(ev.starts_at, ev.local_date, ev.event_timezone ?? DEFAULT_TZ);
  switch (kind) {
    case "created": return { title: `🗓️ ${team}: new ${(TYPE_LABEL[ev.event_type] ?? "event").toLowerCase()}`, body: `${label} — ${when}` };
    case "time_changed": return { title: `🕒 ${team}: schedule update`, body: `${label} is now ${when}` };
    case "venue_changed": return { title: `📍 ${team}: location update`, body: `${label}${ev.venue_name ? ` — ${ev.venue_name}` : ""}` };
    case "canceled": return { title: `❌ ${team}: canceled`, body: `${label} on ${fmtDate(ev.local_date)} is canceled` };
    case "snack_reminder": return { title: `🍎 ${team}: you're on snacks`, body: `Bring snacks for ${label} — ${when}` };
    case "completed": return { title: `🎥 ${team}: ${label} finished`, body: `Add your film from today — tap to upload.` };
    default: return null;
  }
}
function dedupeKey(ob: any, uid: string, channel = "push"): string {
  if (ob.change_kind === "snack_reminder") return `${ob.event_id}:${uid}:${channel}:snack`;
  if (ob.change_kind === "completed") return `${ob.event_id}:${uid}:${channel}:completed`;
  return `${ob.event_id}:${uid}:${channel}:${ob.change_kind}:${ob.event_version ?? 0}`;
}
// SMS is reserved for "gravity" — schedule disruptions + the snack reminder. Never
// chat, announcements, new-event, or the film prompt (those are push-only).
const SMS_KINDS = new Set(["canceled", "time_changed", "venue_changed", "snack_reminder"]);
function smsBody(copy: { title: string; body: string }): string {
  return `${copy.title} ${copy.body}\nReply STOP to opt out.`;
}

async function expandEvent(ob: any, now: Date) {
  const { data: ev } = await svc.from("events")
    .select("id, team_id, title, event_type, local_date, starts_at, event_timezone, venue_name, teams(name), games(opponent, deleted_at)")
    .eq("id", ob.event_id).maybeSingle();
  if (!ev) return;
  const evx = { ...ev, team_name: (ev as any).teams?.name, opponent: (Array.isArray((ev as any).games) ? (ev as any).games.find((g: any) => !g.deleted_at) : (ev as any).games)?.opponent ?? null };
  const copy = copyFor(ob.change_kind, evx);
  if (!copy) return;
  // Recipients: a targeted reminder → just that user; a game-completed film prompt
  // → coaches only; otherwise the whole team (minus the actor).
  let ids: string[];
  if (ob.target_user_id) ids = [ob.target_user_id];
  else if (ob.change_kind === "completed") { const { data } = await svc.rpc("resolve_team_coaches", { p_team_id: (ev as any).team_id }); ids = (data ?? []).map((r: any) => r.recipient_user_id); }
  else { const { data } = await svc.rpc("resolve_event_recipients", { p_event_id: ob.event_id, p_exclude: ob.actor_user_id }); ids = (data ?? []).map((r: any) => r.recipient_user_id); }
  if (!ids.length) return;

  // SMS goes to the eligible subset (verified + consented + not opted out) for
  // gravity changes only. Targeted rows (snack) → just the claimer's phone.
  let sms: { uid: string; phone: string }[] = [];
  if (SMS_KINDS.has(ob.change_kind)) {
    if (ob.target_user_id) { const { data } = await svc.rpc("sms_target", { p_user_id: ob.target_user_id }); sms = (data ?? []).map((r: any) => ({ uid: r.recipient_user_id, phone: r.phone })); }
    else { const { data } = await svc.rpc("resolve_event_sms_recipients", { p_event_id: ob.event_id, p_exclude: ob.actor_user_id }); sms = (data ?? []).map((r: any) => ({ uid: r.recipient_user_id, phone: r.phone })); }
  }

  const tz = await tzMap(Array.from(new Set([...ids, ...sms.map(s => s.uid)])));
  const dataUrl = ob.change_kind === "completed" ? "/upload" : "/schedule";
  const startsAt = (evx as any).starts_at ?? null;
  const rows: any[] = ids.map((uid: string) => ({
    event_id: ob.event_id, team_id: ob.team_id, recipient_user_id: uid, channel: "push", change_kind: ob.change_kind,
    dedupe_key: dedupeKey(ob, uid, "push"), status: "queued",
    send_after: computeSendAfter(ob.change_kind, startsAt, tz.get(uid) || DEFAULT_TZ, now),
    title: copy.title, body: copy.body, data: { url: dataUrl, event_id: ob.event_id },
  }));
  for (const s of sms) rows.push({
    event_id: ob.event_id, team_id: ob.team_id, recipient_user_id: s.uid, channel: "sms", change_kind: ob.change_kind,
    dedupe_key: dedupeKey(ob, s.uid, "sms"), status: "queued",
    send_after: computeSendAfter(ob.change_kind, startsAt, tz.get(s.uid) || DEFAULT_TZ, now),
    title: null, body: smsBody(copy), data: { phone: s.phone, event_id: ob.event_id },
  });
  await svc.from("schedule_notifications").upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true });
}

async function expandMessage(ob: any, now: Date) {
  const { data: msg } = await svc.from("messages").select("id, team_id, body, author_user_id, deleted_at, teams(name)").eq("id", ob.message_id).maybeSingle();
  if (!msg || (msg as any).deleted_at) return;
  const { data: prof } = await svc.from("user_profiles").select("display_name").eq("user_id", (msg as any).author_user_id).maybeSingle();
  const team = (msg as any).teams?.name ?? "Team";
  const author = prof?.display_name ?? "Coach";
  const raw = (msg as any).body as string;
  const title = `📣 ${team}`;
  const body = `${author}: ${raw.length > 140 ? raw.slice(0, 137) + "…" : raw}`;
  const { data: recips } = await svc.rpc("resolve_team_recipients", { p_team_id: (msg as any).team_id, p_exclude: ob.actor_user_id });
  const ids = (recips ?? []).map((r: any) => r.recipient_user_id);
  const tz = await tzMap(ids);
  const rows = (recips ?? []).map((r: any) => {
    const uid = r.recipient_user_id;
    return { event_id: null, team_id: (msg as any).team_id, recipient_user_id: uid, channel: "push", change_kind: "announcement",
      dedupe_key: `msg:${(msg as any).id}:${uid}:push`, status: "queued",
      send_after: computeSendAfter("announcement", null, tz.get(uid) || DEFAULT_TZ, now),
      title, body, data: { url: "/messages", team_id: (msg as any).team_id } };
  });
  if (rows.length) await svc.from("schedule_notifications").upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true });
}

async function expand(): Promise<number> {
  const now = new Date();
  const { data: due } = await svc.from("notification_outbox").select("*").is("processed_at", null).lte("dispatch_after", now.toISOString()).limit(100);
  if (!due || due.length === 0) return 0;
  for (const ob of due) {
    try { if (ob.message_id) await expandMessage(ob, now); else await expandEvent(ob, now); }
    catch (_e) { /* isolate */ }
    await svc.from("notification_outbox").update({ processed_at: new Date().toISOString() }).eq("id", ob.id);
  }
  return due.length;
}

async function dispatchPush(): Promise<number> {
  const now = new Date().toISOString();
  const { data: candidates } = await svc.from("schedule_notifications").select("id, recipient_user_id, title, body, data").eq("status", "queued").eq("channel", "push").lte("send_after", now).limit(500);
  if (!candidates || candidates.length === 0) return 0;
  const ids = candidates.map((c) => c.id);
  const { data: claimed } = await svc.from("schedule_notifications").update({ status: "sent", sent_at: now, status_updated_at: now }).in("id", ids).eq("status", "queued").select("id, recipient_user_id, title, body, data");
  if (!claimed || claimed.length === 0) return 0;
  const { data: tokenRows } = await svc.from("device_push_tokens").select("user_id, token").in("user_id", Array.from(new Set(claimed.map((c) => c.recipient_user_id))));
  const tokensByUser = new Map<string, string[]>();
  for (const t of tokenRows ?? []) { const a = tokensByUser.get(t.user_id) ?? []; a.push(t.token); tokensByUser.set(t.user_id, a); }
  const noDevice = claimed.filter((c) => !(tokensByUser.get(c.recipient_user_id)?.length));
  if (noDevice.length) await svc.from("schedule_notifications").update({ status: "skipped", error_code: "no_device", status_updated_at: now }).in("id", noDevice.map((c) => c.id));
  const pairs: { id: string; to: string; title: string; body: string; data: any }[] = [];
  for (const c of claimed) for (const to of (tokensByUser.get(c.recipient_user_id) ?? [])) pairs.push({ id: c.id, to, title: c.title, body: c.body, data: c.data });
  const failedRowIds = new Set<string>();
  for (const batch of chunk(pairs, 100)) {
    try {
      const res = await fetch(EXPO_PUSH, { method: "POST", headers: { "content-type": "application/json", "accept": "application/json" }, body: JSON.stringify(batch.map((p) => ({ to: p.to, title: p.title, body: p.body, data: p.data, sound: "default" }))) });
      const out = await res.json().catch(() => null);
      const tickets = out?.data ?? [];
      if (!Array.isArray(tickets)) { for (const p of batch) failedRowIds.add(p.id); continue; }
      tickets.forEach((t: any, i: number) => { if (t?.status !== "ok") failedRowIds.add(batch[i].id); });
    } catch { for (const p of batch) failedRowIds.add(p.id); }
  }
  if (failedRowIds.size) await svc.from("schedule_notifications").update({ status: "failed", error_code: "push_error", status_updated_at: new Date().toISOString() }).in("id", Array.from(failedRowIds));
  return claimed.length;
}

// Send due queued SMS rows via Twilio. Env-gated: with no Twilio secrets yet, due
// rows are marked skipped:no_sms_config (harmless) rather than rotting in the queue.
// Claimed 'sent' on submit; the sms-status webhook later moves to delivered/failed.
async function dispatchSms(): Promise<number> {
  const now = new Date().toISOString();
  const { data: candidates } = await svc.from("schedule_notifications").select("id, body, data").eq("status", "queued").eq("channel", "sms").lte("send_after", now).limit(300);
  if (!candidates || candidates.length === 0) return 0;
  const SID = Deno.env.get("TWILIO_ACCOUNT_SID"), TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN"), FROM = Deno.env.get("TWILIO_FROM");
  const ids = candidates.map((c) => c.id);
  if (!SID || !TOKEN || !FROM) {
    await svc.from("schedule_notifications").update({ status: "skipped", error_code: "no_sms_config", status_updated_at: now }).in("id", ids).eq("status", "queued");
    return 0;
  }
  const { data: claimed } = await svc.from("schedule_notifications").update({ status: "sent", sent_at: now, status_updated_at: now }).in("id", ids).eq("status", "queued").select("id, body, data");
  if (!claimed || claimed.length === 0) return 0;
  const auth = "Basic " + btoa(`${SID}:${TOKEN}`);
  const statusCb = `${SUPA_URL}/functions/v1/sms-status`;
  for (const row of claimed) {
    const to = (row.data as any)?.phone;
    if (!to) { await svc.from("schedule_notifications").update({ status: "failed", error_code: "no_phone" }).eq("id", row.id); continue; }
    try {
      const params = new URLSearchParams();
      if (FROM.startsWith("MG")) params.set("MessagingServiceSid", FROM); else params.set("From", FROM);
      params.set("To", to); params.set("Body", row.body); params.set("StatusCallback", statusCb);
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() });
      const out = await res.json().catch(() => null);
      if (res.ok && out?.sid) await svc.from("schedule_notifications").update({ provider_message_id: out.sid, status_updated_at: new Date().toISOString() }).eq("id", row.id);
      else await svc.from("schedule_notifications").update({ status: "failed", error_code: out?.code ? String(out.code) : "twilio_error", status_updated_at: new Date().toISOString() }).eq("id", row.id);
    } catch { await svc.from("schedule_notifications").update({ status: "failed", error_code: "twilio_exception", status_updated_at: new Date().toISOString() }).eq("id", row.id); }
  }
  return claimed.length;
}

Deno.serve(async () => {
  const expanded = await expand();
  const dispatched = await dispatchPush();
  const sms = await dispatchSms();
  return new Response(JSON.stringify({ expanded, dispatched, sms }), { headers: { "content-type": "application/json" } });
});

// send-push — deliver an Expo push notification to a team's members.
// Deployed live via the Supabase MCP. verify_jwt=false; auth is manual so the
// browser preflight works. Authorization is team-scoped: the caller must be a
// CONFIRMED COACH of the target team, and recipients are resolved server-side
// from team membership (never arbitrary user_ids from the client) so this can't
// be used to spam. An optional userIds list is intersected with the team roster.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const COACH_ROLES = ["admin", "head_coach", "coach"];
const EXPO_PUSH = "https://exp.host/--/api/v2/push/send";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const asUser = createClient(SUPA_URL, SERVICE_ROLE, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "Please sign in and try again." }, 401);

  const body = await req.json().catch(() => null);
  const teamId = body?.teamId as string | undefined;
  const title = (body?.title as string | undefined)?.trim();
  const message = (body?.body as string | undefined)?.trim();
  const data = (body?.data as Record<string, unknown> | undefined) ?? {};
  const only = Array.isArray(body?.userIds) ? (body.userIds as string[]) : null;
  if (!teamId || !title || !message) return json({ error: "teamId, title and body are required." }, 400);

  const svc = createClient(SUPA_URL, SERVICE_ROLE);

  // Authorize: caller must be a confirmed coach of this team.
  const { data: coachRows } = await svc.from("team_memberships")
    .select("id").eq("team_id", teamId).eq("user_id", user.id).eq("status", "confirmed").in("role", COACH_ROLES).limit(1);
  if (!coachRows || coachRows.length === 0) return json({ error: "Only a coach of this team can send notifications." }, 403);

  // Recipients = confirmed team members (minus the sender), optionally narrowed
  // to a caller-supplied subset (still intersected with the roster).
  const { data: memberRows } = await svc.from("team_memberships")
    .select("user_id").eq("team_id", teamId).eq("status", "confirmed");
  let recipientIds = Array.from(new Set((memberRows ?? []).map((r: any) => r.user_id as string)))
    .filter((id) => id !== user.id);
  if (only) { const set = new Set(only); recipientIds = recipientIds.filter((id) => set.has(id)); }

  // NOTE: the existing typed `notifications` table (recipient_user_id + type +
  // entity refs, no free-text body) is a separate system; wiring push sends into
  // it is a deliberate follow-up, not a silent best-effort insert here.
  if (recipientIds.length === 0) return json({ recipients: 0, delivered: 0, note: "No recipients." });

  const { data: tokenRows } = await svc.from("device_push_tokens").select("token").in("user_id", recipientIds);
  const tokens = Array.from(new Set((tokenRows ?? []).map((r: any) => r.token as string))).filter(Boolean);
  if (tokens.length === 0) return json({ recipients: recipientIds.length, delivered: 0, note: "No registered devices yet." });

  // Push in batches of 100 (Expo's cap).
  let ok = 0, failed = 0;
  for (const batch of chunk(tokens, 100)) {
    const messages = batch.map((to) => ({ to, title, body: message, data, sound: "default" }));
    try {
      const res = await fetch(EXPO_PUSH, {
        method: "POST",
        headers: { "content-type": "application/json", "accept": "application/json" },
        body: JSON.stringify(messages),
      });
      const out = await res.json().catch(() => null);
      const tickets = out?.data ?? [];
      for (const t of tickets) (t?.status === "ok" ? ok++ : failed++);
      if (!Array.isArray(tickets)) failed += batch.length;
    } catch { failed += batch.length; }
  }

  return json({ recipients: recipientIds.length, tokens: tokens.length, delivered: ok, failed });
});

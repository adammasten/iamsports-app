// send-web-push — deliver a Web Push notification to a user's browsers.
//
// The native path posts Expo tokens to Expo's service (see send-push /
// process-notifications). Browsers have no such service: each subscription
// carries its own endpoint, and the payload must be encrypted per RFC 8291 and
// signed with VAPID per RFC 8292. That crypto is not worth hand-rolling, so this
// uses npm:web-push, which Supabase's Deno runtime supports via npm: specifiers.
//
// SUBSCRIPTION SHAPE: web rows live in the same `device_push_tokens` table as
// Expo tokens, with platform = 'web' and the subscription JSON-stringified into
// `token`. Branching on platform is all the delivery side needs.
//
// ENV-GATED, like the SMS dispatcher: with no VAPID secrets set, this returns
// skipped:no_vapid_config rather than erroring. That means it can ship and sit
// inert until the keys exist — nothing half-works in the meantime.
//   VAPID_PUBLIC_KEY   — same value as EXPO_PUBLIC_VAPID_PUBLIC_KEY in the app
//   VAPID_PRIVATE_KEY  — secret; never ships to a client
//   VAPID_SUBJECT      — "mailto:support@iamsports.com" or the site URL
//
// AUTHORIZATION: recipients are resolved server-side from the caller's identity
// or from team membership — never taken as arbitrary user_ids from the client —
// so this can't be turned into a spam cannon. Same rule as send-push.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:support@iamsports.com";
const COACH_ROLES = ["admin", "head_coach", "coach"];

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

const configured = Boolean(VAPID_PUBLIC && VAPID_PRIVATE);
if (configured) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

type Payload = { title: string; body: string; url?: string; tag?: string };

/**
 * Send to every web subscription belonging to these users.
 * Returns per-endpoint outcomes and prunes subscriptions the push service has
 * retired (404/410) — otherwise dead endpoints accumulate forever and every
 * later send wastes a round trip on them.
 */
async function sendToUsers(
  svc: ReturnType<typeof createClient>,
  userIds: string[],
  payload: Payload,
): Promise<{ sent: number; failed: number; pruned: number }> {
  if (!userIds.length) return { sent: 0, failed: 0, pruned: 0 };

  const { data: rows } = await svc
    .from("device_push_tokens")
    .select("token")
    .eq("platform", "web")
    .in("user_id", userIds);

  const body = JSON.stringify(payload);
  let sent = 0, failed = 0;
  const dead: string[] = [];

  await Promise.all((rows ?? []).map(async (r: { token: string }) => {
    let sub: unknown;
    try {
      sub = JSON.parse(r.token);
    } catch {
      dead.push(r.token);              // unparseable row can never be delivered to
      return;
    }
    try {
      await webpush.sendNotification(sub as any, body, { TTL: 60 * 60 * 24 });
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) dead.push(r.token);
      else failed++;
    }
  }));

  if (dead.length) {
    await svc.from("device_push_tokens").delete().in("token", dead);
  }
  return { sent, failed, pruned: dead.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  if (!configured) {
    // Deliberately a 200: callers treat this like the SMS path's
    // skipped:no_sms_config — an unconfigured channel is not an error.
    return json({ skipped: "no_vapid_config", sent: 0 });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const asUser = createClient(SUPA_URL, SERVICE_ROLE, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "Please sign in and try again." }, 401);

  const input = await req.json().catch(() => null);
  const title = (input?.title as string | undefined)?.trim();
  const message = (input?.body as string | undefined)?.trim();
  const url = (input?.url as string | undefined) ?? "/";
  const tag = input?.tag as string | undefined;
  const teamId = input?.teamId as string | undefined;
  if (!title || !message) return json({ error: "title and body are required." }, 400);

  const svc = createClient(SUPA_URL, SERVICE_ROLE);
  const payload: Payload = { title, body: message, url, tag };

  // No team → a self-test to the caller's own browsers. Useful for verifying the
  // whole chain end to end without needing a second account.
  if (!teamId) {
    const out = await sendToUsers(svc, [user.id], payload);
    return json({ scope: "self", ...out });
  }

  // Team send: the caller must be a confirmed, still-current coach of that team.
  const { data: coachRows } = await svc.from("team_memberships")
    .select("id").eq("team_id", teamId).eq("user_id", user.id)
    .eq("status", "confirmed").is("left_on", null)
    .in("role", COACH_ROLES).limit(1);
  if (!coachRows?.length) return json({ error: "Only a coach of this team can send." }, 403);

  const { data: members } = await svc.from("team_memberships")
    .select("user_id").eq("team_id", teamId).eq("status", "confirmed").is("left_on", null);
  const recipients = Array.from(
    new Set((members ?? []).map((m: { user_id: string }) => m.user_id)),
  ).filter((id) => id !== user.id);

  const out = await sendToUsers(svc, recipients, payload);
  return json({ scope: "team", recipients: recipients.length, ...out });
});

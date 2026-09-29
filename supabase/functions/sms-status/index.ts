// sms-status — Twilio delivery-status callback. Moves a sent SMS row to its final
// state (delivered / failed / opted-out) by provider_message_id, powering the coach
// "delivered / failed / not-receiving-by-choice" surface. Public endpoint (Twilio
// cannot send a Supabase JWT, so verify_jwt=false stays), authenticated by Twilio's
// native X-Twilio-Signature. See the AUTHENTICATION block below.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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
// applies to them.
const PUBLISHABLE_KEY = namedKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
const svc = createClient(Deno.env.get("SUPABASE_URL")!, SECRET_KEY);

// ── TWILIO REQUEST AUTHENTICATION ────────────────────────────────────────────
// WHY THIS REPLACED THE SHARED SECRET. The previous gate was
//   if (SECRET && url.searchParams.get("secret") !== SECRET) return 403
// which FAILED OPEN: with TWILIO_WEBHOOK_SECRET unset the check was skipped entirely,
// and verify_jwt=false, so ANY caller on the internet reached the handler and could
// forge delivery status for any provider_message_id — this function writes
// schedule_notifications with the service-role key, bypassing RLS. A forged 'failed' on
// a queued row both falsifies the coach-facing delivery surface AND stops that
// notification from ever sending, since the dispatcher only picks up status='queued'.
// Confirmed against production before the fix: both "no secret" and "wrong secret"
// returned 200.
//
// Twilio's native X-Twilio-Signature is used instead: per-request, cryptographic, and
// bound to the exact URL so a captured signature cannot be replayed at another
// endpoint. It introduces no secret beyond the Twilio auth token the account must
// already hold to send SMS. A query-string secret also leaks into access logs and
// referrers.
//
// CURRENT STATE (2026-09-28): TWILIO_AUTH_TOKEN is NOT configured in this project and
// SMS is not live — no SMS has ever been sent. This function therefore fails closed
// with 503 for EVERY caller, which is the intended interim: it removes the fail-open
// hole now, and real Twilio callbacks will also be refused until Twilio is
// deliberately wired up. See docs/TWILIO_SMS_ENABLEMENT.md for what must be
// configured before SMS is switched on.
//
// ALGORITHM (Twilio spec — do NOT "simplify"): HMAC-SHA1 keyed on the auth token, over
//   <full signed URL> + (for each POST param sorted by key: key + value)
// base64-encoded. Values are the DECODED form values. This construction is verified
// against Twilio's own published test vector in test_twilio_signature.mjs.
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
// The URL Twilio signs is the PUBLIC function URL configured in the Twilio console.
// req.url is the URL as seen INSIDE the edge runtime and is not guaranteed to be that
// public URL, so the scheme+host are DERIVED FROM DEPLOYMENT CONFIG rather than trusted
// from the request. TWILIO_WEBHOOK_BASE_URL is an optional override for a custom domain;
// unset, it falls back to this project's own SUPABASE_URL. Only the query string comes
// from the request, because query params survive proxying unchanged and Twilio includes
// them in the signed string.
const PUBLIC_BASE = (Deno.env.get("TWILIO_WEBHOOK_BASE_URL") ?? Deno.env.get("SUPABASE_URL") ?? "")
  .replace(/\/+$/, "");
const SIGNED_PATH = "/functions/v1/sms-status";

// Constant-time comparison, so a near-miss reveals nothing through timing.
function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

async function twilioSignatureValid(
  signedUrl: string, params: URLSearchParams, signature: string,
): Promise<boolean> {
  // Sort by key, then concatenate key+value for EVERY entry. Repeated keys keep their
  // relative order, matching Twilio's reference implementations.
  const entries = [...params.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  const canonical = signedUrl + entries.map(([k, v]) => k + v).join("");
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(TWILIO_AUTH_TOKEN),
    { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return timingSafeEqual(expected, signature);
}

Deno.serve(async (req) => {
  // FAIL CLOSED, in this order. Nothing below runs unless Twilio signed this request.
  // Never logs the signature, the canonical string, or any key material.
  if (!TWILIO_AUTH_TOKEN || !PUBLIC_BASE) {
    console.error("[auth] refusing: Twilio webhook authentication is not configured");
    return new Response("Webhook authentication is not configured", { status: 503 });
  }
  const signature = req.headers.get("X-Twilio-Signature");
  if (!signature) return new Response("Forbidden", { status: 403 });

  // The body is read ONCE as text: it is needed both to verify the signature and to read
  // the fields. req.formData() would consume the stream, leaving nothing to verify.
  const raw = await req.text().catch(() => null);
  if (raw === null) return new Response("Forbidden", { status: 403 });
  const params = new URLSearchParams(raw);
  const signedUrl = PUBLIC_BASE + SIGNED_PATH + new URL(req.url).search;
  if (!(await twilioSignatureValid(signedUrl, params, signature))) {
    return new Response("Forbidden", { status: 403 });
  }

  // ===== AUTHENTICATED — original behavior below is unchanged. =====
  const sid = params.get("MessageSid");
  const status = params.get("MessageStatus")?.toLowerCase();
  const errorCode = params.get("ErrorCode");
  if (!sid || !status) return new Response("ok");

  // Twilio statuses: queued/sent/delivered/undelivered/failed. 30007/21610 ≈ carrier
  // block / opted-out. Only advance to a terminal state; never regress a delivered row.
  let mapped: string | null = null;
  if (status === "delivered") mapped = "delivered";
  else if (status === "failed" || status === "undelivered") mapped = (errorCode === "21610") ? "opted_out" : "failed";
  if (!mapped) return new Response("ok");

  try {
    await svc.from("schedule_notifications")
      .update({ status: mapped, error_code: errorCode, status_updated_at: new Date().toISOString() })
      .eq("provider_message_id", sid).neq("status", "delivered");
  } catch { /* ignore */ }
  return new Response("ok");
});

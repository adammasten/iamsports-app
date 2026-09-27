// sms-status — Twilio delivery-status callback. Moves a sent SMS row to its final
// state (delivered / failed / opted-out) by provider_message_id, powering the coach
// "delivered / failed / not-receiving-by-choice" surface. Public, secret-protected.
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
const SECRET = Deno.env.get("TWILIO_WEBHOOK_SECRET");

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (SECRET && url.searchParams.get("secret") !== SECRET) return new Response("Forbidden", { status: 403 });
  const form = await req.formData().catch(() => null);
  const sid = form?.get("MessageSid") as string | null;
  const status = (form?.get("MessageStatus") as string | null)?.toLowerCase();
  const errorCode = form?.get("ErrorCode") as string | null;
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

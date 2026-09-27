// sms-inbound — Twilio inbound-SMS webhook. Handles STOP/START at the PHONE-NUMBER
// level (numbers move between families). Public endpoint, protected by a shared
// secret in the URL (?secret=…, matched against TWILIO_WEBHOOK_SECRET) since Twilio
// can't send a JWT. verify_jwt=false.
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
const STOP = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START = new Set(["START", "YES", "UNSTOP"]);

function twiml(msg?: string) {
  const body = msg ? `<Response><Message>${msg}</Message></Response>` : "<Response></Response>";
  return new Response(body, { headers: { "content-type": "text/xml" } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (SECRET && url.searchParams.get("secret") !== SECRET) return new Response("Forbidden", { status: 403 });
  const form = await req.formData().catch(() => null);
  const from = (form?.get("From") as string | null)?.trim();
  const word = (form?.get("Body") as string | null)?.trim().toUpperCase() ?? "";
  if (!from) return twiml();

  const now = new Date().toISOString();
  try {
    if (STOP.has(word)) {
      await svc.from("sms_opt_outs").upsert({ phone_number: from, opted_out_at: now, opted_back_in_at: null }, { onConflict: "phone_number" });
      return twiml("You're unsubscribed from IamSports alerts. Reply START to resume.");
    }
    if (START.has(word)) {
      await svc.from("sms_opt_outs").update({ opted_back_in_at: now }).eq("phone_number", from);
      return twiml("You're re-subscribed to IamSports alerts. Reply STOP to opt out.");
    }
    if (word === "HELP") return twiml("IamSports team schedule alerts. Help: adam.admin@iamsports.com. Msg&data rates may apply. Reply STOP to opt out.");
  } catch { /* fall through */ }
  return twiml();
});

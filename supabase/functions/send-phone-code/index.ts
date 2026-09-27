// send-phone-code — start phone verification. Authed (the requesting user). Generates
// a 6-digit code, stores it HASHED with a 10-min expiry, and texts it via Twilio.
// Env-gated: with no Twilio secrets yet it returns 503 (texting not enabled). Manual
// auth + CORS; verify_jwt=false.
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
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, x-client-info, apikey, content-type", "access-control-allow-methods": "POST, OPTIONS" };
function json(o: unknown, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json" } }); }

// Normalize to E.164 (US default). Returns null if it can't.
function normalize(raw: string): string | null {
  const t = raw.trim();
  if (t.startsWith("+")) { const d = t.replace(/[^\d]/g, ""); return d.length >= 10 && d.length <= 15 ? "+" + d : null; }
  const d = t.replace(/\D/g, "");
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  return null;
}
async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const asUser = createClient(SUPA_URL, PUBLISHABLE_KEY, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "Please sign in." }, 401);

  const body = await req.json().catch(() => null);
  const phone = normalize(body?.phone ?? "");
  if (!phone) return json({ error: "Enter a valid mobile number." }, 400);

  const svc = createClient(SUPA_URL, SECRET_KEY);
  // Simple resend throttle: one code per 45s per user.
  const { data: existing } = await svc.from("phone_verifications").select("created_at").eq("user_id", user.id).maybeSingle();
  if (existing && Date.now() - new Date(existing.created_at).getTime() < 45_000) return json({ error: "Hang on a moment before requesting another code." }, 429);

  const SID = Deno.env.get("TWILIO_ACCOUNT_SID"), TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN"), FROM = Deno.env.get("TWILIO_FROM");
  if (!SID || !TOKEN || !FROM) return json({ error: "Text alerts aren't turned on yet — check back soon.", not_enabled: true }, 503);

  const code = String(Math.floor(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)));
  await svc.from("phone_verifications").upsert({
    user_id: user.id, phone, code_hash: await sha256(code),
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(), attempts: 0, created_at: new Date().toISOString(),
  }, { onConflict: "user_id" });

  const params = new URLSearchParams();
  if (FROM.startsWith("MG")) params.set("MessagingServiceSid", FROM); else params.set("From", FROM);
  params.set("To", phone);
  params.set("Body", `IamSports verification code: ${code}. Reply STOP to opt out.`);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
    method: "POST", headers: { Authorization: "Basic " + btoa(`${SID}:${TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString(),
  });
  if (!res.ok) { const t = await res.text(); return json({ error: "Couldn't send the code — check the number.", detail: t.slice(0, 200) }, 502); }
  return json({ ok: true, phone });
});

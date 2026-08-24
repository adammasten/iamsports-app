// send-phone-code — start phone verification. Authed (the requesting user). Generates
// a 6-digit code, stores it HASHED with a 10-min expiry, and texts it via Twilio.
// Env-gated: with no Twilio secrets yet it returns 503 (texting not enabled). Manual
// auth + CORS; verify_jwt=false.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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
  const asUser = createClient(SUPA_URL, SERVICE_ROLE, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "Please sign in." }, 401);

  const body = await req.json().catch(() => null);
  const phone = normalize(body?.phone ?? "");
  if (!phone) return json({ error: "Enter a valid mobile number." }, 400);

  const svc = createClient(SUPA_URL, SERVICE_ROLE);
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

// check-phone-code — finish phone verification. On the right code we record the
// verified number AND the consent trail (phone_consent_at/source) on user_profiles.
// Authed; verify_jwt=false; manual auth + CORS.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, x-client-info, apikey, content-type", "access-control-allow-methods": "POST, OPTIONS" };
function json(o: unknown, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "content-type": "application/json" } }); }
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
  const code = (body?.code ?? "").toString().trim();
  if (!/^\d{6}$/.test(code)) return json({ error: "Enter the 6-digit code." }, 400);

  const svc = createClient(SUPA_URL, SERVICE_ROLE);
  const { data: v } = await svc.from("phone_verifications").select("*").eq("user_id", user.id).maybeSingle();
  if (!v) return json({ error: "Request a new code." }, 400);
  if (new Date(v.expires_at).getTime() < Date.now()) { await svc.from("phone_verifications").delete().eq("user_id", user.id); return json({ error: "That code expired — request a new one." }, 400); }
  if (v.attempts >= 5) { await svc.from("phone_verifications").delete().eq("user_id", user.id); return json({ error: "Too many tries — request a new code." }, 429); }

  if (await sha256(code) !== v.code_hash) {
    await svc.from("phone_verifications").update({ attempts: v.attempts + 1 }).eq("user_id", user.id);
    return json({ error: "That code isn't right — try again." }, 400);
  }

  const now = new Date().toISOString();
  const { error } = await svc.from("user_profiles").update({
    phone_number: v.phone, phone_verified_at: now, phone_consent_at: now, phone_consent_source: "sms_verify",
  }).eq("user_id", user.id);
  if (error) return json({ error: error.message }, 500);
  // Verifying re-subscribes the number if it had opted out earlier.
  await svc.from("sms_opt_outs").update({ opted_back_in_at: now }).eq("phone_number", v.phone).then(() => {}, () => {});
  await svc.from("phone_verifications").delete().eq("user_id", user.id);
  return json({ ok: true, phone: v.phone });
});

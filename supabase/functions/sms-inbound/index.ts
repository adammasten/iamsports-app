// sms-inbound — Twilio inbound-SMS webhook. Handles STOP/START at the PHONE-NUMBER
// level (numbers move between families). Public endpoint, protected by a shared
// secret in the URL (?secret=…, matched against TWILIO_WEBHOOK_SECRET) since Twilio
// can't send a JWT. verify_jwt=false.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
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
    if (word === "HELP") return twiml("IamSports team alerts. Reply STOP to opt out. Msg&data rates may apply.");
  } catch { /* fall through */ }
  return twiml();
});

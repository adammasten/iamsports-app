// sms-status — Twilio delivery-status callback. Moves a sent SMS row to its final
// state (delivered / failed / opted-out) by provider_message_id, powering the coach
// "delivered / failed / not-receiving-by-choice" surface. Public, secret-protected.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
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

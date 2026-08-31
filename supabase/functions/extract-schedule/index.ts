// extract-schedule — vision extraction of a team schedule from a photo.
// Deployed live via the Supabase MCP (deploy_edge_function), verify_jwt=false.
// Reads ANTHROPIC_API_KEY (a Supabase secret — never in the app bundle). Manual
// auth + CORS so the browser preflight works. Per-user daily rate limit. Returns
// ONLY a parsed JSON array of extracted rows; the app shows a MANDATORY editable
// preview before saving (never silently save AI-extracted data).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
// claude-3-5-sonnet was retired by Anthropic (2025-10-28) → requests 404'd and the
// schedule importer silently broke. Sonnet 5 is API-compatible for this vision call.
const MODEL = Deno.env.get("EXTRACT_MODEL") ?? "claude-sonnet-5";
const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DAILY_LIMIT = 10;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}

const PROMPT = `You are extracting a youth sports team's schedule from a photo of a printed or emailed schedule.
Return ONLY a JSON array (no prose, no markdown). Each element:
{"date":"YYYY-MM-DD","time":"HH:MM 24-hour or null","opponent":"string or null","location":"string or null","home_away":"home"|"away"|null,"notes":"string or null"}
Rules:
- Use null when a field is not clearly present. NEVER guess.
- Infer the year from context; if no year is shown anywhere, use the current calendar year.
- If the image is not a schedule, return [].
Output the JSON array and nothing else.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ANTHROPIC_API_KEY) return json({ error: "The schedule importer isn't configured yet (missing API key)." }, 500);

  const authHeader = req.headers.get("Authorization") ?? "";
  const asUser = createClient(SUPA_URL, SERVICE_ROLE, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "Please sign in and try again." }, 401);

  const svc = createClient(SUPA_URL, SERVICE_ROLE);

  const since = new Date(); since.setHours(0, 0, 0, 0);
  const { count } = await svc.from("schedule_import_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id).gte("created_at", since.toISOString());
  if ((count ?? 0) >= DAILY_LIMIT) return json({ error: `You've hit today's import limit (${DAILY_LIMIT}). Try again tomorrow.` }, 429);

  const body = await req.json().catch(() => null);
  const image = body?.image as string | undefined;
  const mediaType = (body?.mediaType as string) || "image/jpeg";
  if (!image) return json({ error: "No image was received." }, 400);

  // Optional free-text context from the user (e.g. "We're the Bengals") — helps the
  // model pick which team is "us" (home/away) and avoid listing our own team as opponent.
  const userContext = (body?.context as string | undefined)?.trim();
  const promptText = userContext
    ? PROMPT + `

Context the user gave about this schedule: ${userContext.slice(0, 500)}
Use it to tell which team is ours (for home/away) and to avoid listing our own team as the opponent.`
    : PROMPT;

  let aRes: Response;
  try {
    aRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 2000,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
          { type: "text", text: promptText },
        ] }],
      }),
    });
  } catch (e) {
    return json({ error: "Couldn't reach the extraction service — try again.", detail: String(e).slice(0, 200) }, 502);
  }
  if (!aRes.ok) {
    const t = await aRes.text();
    return json({ error: `Extraction service error (${aRes.status}).`, detail: t.slice(0, 300) }, 502);
  }
  const aData = await aRes.json();
  const text = (aData?.content?.[0]?.text ?? "").trim();

  let rows: unknown[] = [];
  try {
    const cleaned = text.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    rows = parsed;
  } catch {
    return json({ error: "Couldn't read a schedule from that image. Try a clearer, straight-on photo.", raw: text.slice(0, 200) }, 422);
  }

  await svc.from("schedule_import_log").insert({ user_id: user.id });
  return json({ rows });
});

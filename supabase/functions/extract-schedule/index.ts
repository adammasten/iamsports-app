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
  const asUser = createClient(SUPA_URL, PUBLISHABLE_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "Please sign in and try again." }, 401);

  const svc = createClient(SUPA_URL, SECRET_KEY);

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

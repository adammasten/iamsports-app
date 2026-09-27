// purge-deleted — deployed live via the Supabase MCP (deploy_edge_function).
// Purges content soft-deleted > 30 days ago: removes the physical storage files
// (via the storage API — the reason this is an edge function, not SQL), then
// hard-deletes the rows and any shares pointing at them. Idempotent.
//
// CUSTOM AUTH: gated on the NARROW 'purge_secret' (stored in Vault, read via the
// get_purge_secret() SECURITY DEFINER RPC) — NOT the service-role key. The daily
// cron therefore carries a token that can do nothing but trigger this purge.
// verify_jwt is OFF; the bearer check below is the gate.
// Scheduling: see migration_purge_schedule.sql.

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
// applies to them. Some of these previously passed the SECRET key as the apikey, which
// worked but shipped a secret on a request that never needed one.
const PUBLISHABLE_KEY = namedKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const WINDOW_DAYS = 30;

Deno.serve(async (req) => {
  const supa = createClient(SUPA_URL, SECRET_KEY);

  // Gate on the narrow purge secret (from Vault), not the service-role key.
  const { data: expected, error: secretErr } = await supa.rpc("get_purge_secret");
  if (secretErr || !expected) {
    return new Response("Gate secret unavailable", { status: 500 });
  }
  if ((req.headers.get("Authorization") ?? "") !== `Bearer ${expected}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: vids }  = await supa.from("videos").select("id, url, original_url, thumbnail_path").not("deleted_at", "is", null).lt("deleted_at", cutoff);
  const { data: reels } = await supa.from("highlight_reels").select("id, storage_path").not("deleted_at", "is", null).lt("deleted_at", cutoff);
  const { data: games } = await supa.from("games").select("id").not("deleted_at", "is", null).lt("deleted_at", cutoff);

  const vidIds  = (vids  ?? []).map((v: any) => v.id);
  const reelIds = (reels ?? []).map((r: any) => r.id);
  const gameIds = (games ?? []).map((g: any) => g.id);
  // Include the 4K master (original_url) + thumbnail, not just the 720p copy (url) —
  // otherwise the biggest file (a 15–50 GB master) is orphaned in storage forever.
  const keys = [
    ...(vids ?? []).flatMap((v: any) => [v.url, v.original_url, v.thumbnail_path]),
    ...(reels ?? []).map((r: any) => r.storage_path),
  ].filter(Boolean) as string[];

  let storageError: string | null = null;
  if (keys.length) {
    const { error } = await supa.storage.from("Videos").remove(keys);
    if (error) storageError = error.message; // don't block the row purge on a missing file
  }

  if (vidIds.length) {
    const { data: clips } = await supa.from("clips").select("id").in("video_id", vidIds);
    const clipIds = (clips ?? []).map((c: any) => c.id);
    if (clipIds.length) await supa.from("shares").delete().eq("content_type", "clip").in("content_id", clipIds);
    await supa.from("shares").delete().eq("content_type", "video").in("content_id", vidIds);
  }
  if (reelIds.length) await supa.from("shares").delete().eq("content_type", "reel").in("content_id", reelIds);
  if (gameIds.length) await supa.from("shares").delete().eq("content_type", "game").in("content_id", gameIds);

  if (gameIds.length) await supa.from("game_lineups").delete().in("game_id", gameIds);
  if (vidIds.length)  await supa.from("videos").delete().in("id", vidIds);            // clips cascade
  if (reelIds.length) await supa.from("highlight_reels").delete().in("id", reelIds);
  if (gameIds.length) await supa.from("games").delete().in("id", gameIds);

  return new Response(JSON.stringify({
    purged: { videos: vidIds.length, reels: reelIds.length, games: gameIds.length, files: keys.length },
    storageError, cutoff,
  }), { headers: { "content-type": "application/json" } });
});

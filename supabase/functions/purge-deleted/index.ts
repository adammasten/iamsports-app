// purge-deleted — deployed live via Supabase MCP (deploy_edge_function).
// Purges content soft-deleted > 30 days ago: removes the physical storage files
// (via the storage API — the reason this is an edge function, not SQL), then
// hard-deletes the rows and any shares pointing at them. Idempotent.
// CUSTOM AUTH: only a caller with the service-role key (the scheduled cron) may
// run it — verify_jwt is OFF; the bearer check below is the gate.
// Scheduling: see migration_purge_schedule.sql (run by Adam — needs the key).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const WINDOW_DAYS = 30;

Deno.serve(async (req) => {
  if ((req.headers.get("Authorization") ?? "") !== `Bearer ${SERVICE_ROLE}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supa = createClient(SUPA_URL, SERVICE_ROLE);
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: vids }  = await supa.from("videos").select("id, url").not("deleted_at", "is", null).lt("deleted_at", cutoff);
  const { data: reels } = await supa.from("highlight_reels").select("id, storage_path").not("deleted_at", "is", null).lt("deleted_at", cutoff);
  const { data: games } = await supa.from("games").select("id").not("deleted_at", "is", null).lt("deleted_at", cutoff);

  const vidIds  = (vids  ?? []).map((v: any) => v.id);
  const reelIds = (reels ?? []).map((r: any) => r.id);
  const gameIds = (games ?? []).map((g: any) => g.id);
  const keys = [...(vids ?? []).map((v: any) => v.url), ...(reels ?? []).map((r: any) => r.storage_path)].filter(Boolean) as string[];

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

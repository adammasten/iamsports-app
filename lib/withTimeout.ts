// Race a promise against a timeout so a hanging fetch surfaces an error instead
// of spinning forever (the app had no fetch timeouts — a stalled Supabase call
// spun indefinitely and looked identical to an empty result). Supabase query
// builders are thenable, so they pass through Promise.resolve fine; the caller
// still checks the resolved { error } separately for real query errors.
export const LOAD_TIMEOUT_MS = 10_000;

export function withTimeout<T>(p: PromiseLike<T>, ms: number = LOAD_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Timed out — check your connection and retry.')), ms),
    ),
  ]);
}

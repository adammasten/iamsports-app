// AUTHORIZATION FOR THE MEDIA / RENDER SERVER (Railway).
//
// The render service holds the Supabase SERVICE-ROLE key, so it can read and write
// the private Videos bucket regardless of RLS. Until 2026-09-26 it had no
// authentication at all: any caller on the internet could POST a storage key and
// have private media rendered back, or trigger a mass mutation. Every request now
// carries the CALLER'S OWN Supabase access token, and the server re-derives the
// user from the verified token and re-checks entitlement through RLS.
//
// THERE IS NO SHARED CLIENT SECRET HERE, deliberately. A secret shipped in a web
// bundle or an app binary is not a secret. The only credential sent is the user's
// own short-lived session token — the same one every other Supabase call uses.
//
// RN-agnostic (lib/core): imports the Supabase singleton and nothing else, so web
// and native share one implementation.
import { supabase } from '@/supabase';

// Refresh when this little is left, so a long render's follow-up polls don't 401.
const TOKEN_REFRESH_THRESHOLD_SEC = 300;   // 5 minutes

/**
 * The current user's access token, refreshed when it is close to expiring.
 * Throws when signed out — callers surface that rather than sending no header,
 * because an unauthenticated render is exactly what we are closing.
 */
export async function getMediaAuthToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('You’re signed out — sign in and try again.');
  const secondsLeft = (session.expires_at ?? 0) - Math.floor(Date.now() / 1000);
  if (secondsLeft < TOKEN_REFRESH_THRESHOLD_SEC) {
    const { data: { session: refreshed }, error } = await supabase.auth.refreshSession();
    if (error || !refreshed) throw new Error('Your session expired — sign in and try again.');
    return refreshed.access_token;
  }
  return session.access_token;
}

/** Headers for a JSON POST to the media server. */
export async function mediaAuthHeaders(): Promise<Record<string, string>> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${await getMediaAuthToken()}` };
}

/** Headers for a GET (job polling) — no Content-Type needed. */
export async function mediaAuthGetHeaders(): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await getMediaAuthToken()}` };
}


// Client helper for the send-push edge function (RN-agnostic; works web + native).
// The server authorizes (caller must be a coach of the team) and resolves
// recipients from the roster, so callers only pass what to say.
import { supabase } from '@/supabase';

export type SendPushResult = { recipients: number; delivered?: number; tokens?: number; failed?: number; note?: string };

export async function sendTeamPush(args: {
  teamId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  userIds?: string[]; // optional subset (intersected with the roster server-side)
}): Promise<SendPushResult> {
  const { data, error } = await supabase.functions.invoke('send-push', { body: args });
  if (error) {
    let msg = 'Could not send the notification.';
    try { const b = await (error as any).context?.json?.(); if (b?.error) msg = b.error; } catch {}
    throw new Error(msg);
  }
  return (data as SendPushResult) ?? { recipients: 0 };
}

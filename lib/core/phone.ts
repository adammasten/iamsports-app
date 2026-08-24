// Text-alert phone verification + consent (Stage 6 UI). Verifying a number records
// the consent trail server-side (check-phone-code). RN-agnostic.
import { supabase } from '@/supabase';

export type PhoneStatus = { phone: string | null; verified: boolean };

async function invokeErr(error: any, fallback: string): Promise<never> {
  let msg = fallback;
  try { const b = await error?.context?.json?.(); if (b?.error) msg = b.error; } catch { /* ignore */ }
  const e = new Error(msg);
  (e as any).notEnabled = false;
  try { const b = await error?.context?.clone?.().json?.(); if (b?.not_enabled) (e as any).notEnabled = true; } catch { /* ignore */ }
  throw e;
}

export async function loadPhoneStatus(userId: string): Promise<PhoneStatus> {
  const { data } = await supabase.from('user_profiles').select('phone_number, phone_verified_at').eq('user_id', userId).maybeSingle();
  return { phone: (data as any)?.phone_number ?? null, verified: !!(data as any)?.phone_verified_at };
}

// Returns { notEnabled: true } when Twilio isn't configured yet (graceful UI state).
export async function sendPhoneCode(phone: string): Promise<{ notEnabled?: boolean }> {
  const { data, error } = await supabase.functions.invoke('send-phone-code', { body: { phone } });
  if (error) {
    // 503 not_enabled is an expected pre-launch state, surfaced softly rather than thrown.
    try { const b = await (error as any).context?.json?.(); if (b?.not_enabled) return { notEnabled: true }; if (b?.error) throw new Error(b.error); } catch (e) { if (e instanceof Error) throw e; }
    throw new Error('Could not send the code.');
  }
  return { notEnabled: !!(data as any)?.not_enabled };
}

export async function checkPhoneCode(code: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('check-phone-code', { body: { code } });
  if (error) return invokeErr(error, 'Could not verify the code.');
  return (data as any)?.phone as string;
}

export async function removePhone(): Promise<void> {
  const { error } = await supabase.rpc('clear_my_phone');
  if (error) throw error;
}

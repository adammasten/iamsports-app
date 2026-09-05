// Web Push for the web app and the mobile browser.
//
// The native counterpart (push.ts) uses expo-notifications + Expo's push
// service. The browser has neither, so this registers a service worker and
// subscribes through the standard Push API instead. Both paths end up writing a
// row to `device_push_tokens`, so the delivery side only has to branch on
// `platform`.
//
// STORAGE SHAPE: a web subscription isn't a token, it's an object (endpoint +
// two keys). It is stored JSON-stringified in `device_push_tokens.token`, with
// `platform = 'web'`. That table already has UNIQUE(token) and per-user RLS on
// all four operations, so no schema change was needed.
//
// KEY: subscribing requires the VAPID PUBLIC key, which is public by design —
// it ships in the client bundle. It comes from EXPO_PUBLIC_VAPID_PUBLIC_KEY.
// Until that is set, every function here no-ops quietly: the app behaves exactly
// as it did before, and nothing half-registers. The matching PRIVATE key lives
// only as a Supabase secret, read by the send-web-push Edge Function.
//
// PLATFORM REALITY: desktop Chrome/Edge/Firefox/Safari and Android Chrome all
// work from a normal tab. iOS Safari only delivers Web Push once the user has
// added the site to their Home Screen — that is an Apple rule, not something the
// code can work around. isWebPushInstallGated() reports that case so the UI can
// explain it instead of silently doing nothing.
import { supabase } from '@/supabase';
import { useEffect } from 'react';

const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function supported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

// True on an iPhone/iPad browser that hasn't been installed to the Home Screen —
// the one case where support exists but a subscription can never succeed.
export function isWebPushInstallGated(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1);
  if (!isIOS) return false;
  const standalone = (navigator as any).standalone === true
    || window.matchMedia?.('(display-mode: standalone)')?.matches === true;
  return !standalone;
}

// VAPID keys are base64url; PushManager wants raw bytes. Returns an ArrayBuffer
// rather than a Uint8Array because that's what `applicationServerKey` (a
// BufferSource) accepts under this TS lib version.
function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

/** Registers the service worker. Safe to call repeatedly. */
async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!supported()) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (e) {
    console.warn('[push.web] service worker registration failed:', e);
    return null;
  }
}

/**
 * Subscribe this browser and store the subscription.
 *
 * Does NOT prompt on its own — a permission prompt fired on page load is the
 * fastest way to get permanently blocked. Call requestWebPushPermission() from
 * an explicit user action; this only picks up an already-granted permission.
 */
export async function registerForPushNotifications(userId: string): Promise<void> {
  if (!supported() || !VAPID_PUBLIC_KEY) return;
  if (Notification.permission !== 'granted') return;   // never auto-prompt
  await subscribeAndStore(userId);
}

/** Prompt for permission, then subscribe. Call from a button, not on mount. */
export async function requestWebPushPermission(userId: string): Promise<
  'granted' | 'denied' | 'unsupported' | 'install-required'
> {
  if (!supported() || !VAPID_PUBLIC_KEY) return 'unsupported';
  if (isWebPushInstallGated()) return 'install-required';
  const result = await Notification.requestPermission();
  if (result !== 'granted') return 'denied';
  await subscribeAndStore(userId);
  return 'granted';
}

async function subscribeAndStore(userId: string): Promise<void> {
  const reg = await ensureServiceWorker();
  if (!reg) return;
  try {
    await navigator.serviceWorker.ready;
    // Reuse an existing subscription when there is one; re-subscribing churns
    // the endpoint and orphans the stored row.
    const existing = await reg.pushManager.getSubscription();
    const sub = existing ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBuffer(VAPID_PUBLIC_KEY),
    });

    const { error } = await supabase.from('device_push_tokens').upsert(
      {
        user_id: userId,
        token: JSON.stringify(sub.toJSON()),
        platform: 'web',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'token' },
    );
    // Surface rather than swallow — a silent failure here looks like "push just
    // doesn't work" with nothing to debug.
    if (error) console.warn('[push.web] could not store subscription:', error.message);
  } catch (e) {
    console.warn('[push.web] subscribe failed:', e);
  }
}

/** Turn push off for this browser and drop the stored subscription. */
export async function unregisterWebPush(): Promise<void> {
  if (!supported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    const token = JSON.stringify(sub.toJSON());
    await sub.unsubscribe();
    await supabase.from('device_push_tokens').delete().eq('token', token);
  } catch (e) {
    console.warn('[push.web] unsubscribe failed:', e);
  }
}

/** Current state, for a settings toggle. */
export function webPushStatus(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (!supported() || !VAPID_PUBLIC_KEY) return 'unsupported';
  return Notification.permission as 'granted' | 'denied' | 'default';
}

// Mirrors the native hook's shape. Registers the worker so a click-through can
// route, and picks up an already-granted permission — but never prompts.
export function usePushRegistration(userId: string | null): void {
  useEffect(() => {
    if (!userId) return;
    ensureServiceWorker().catch(() => {});
    registerForPushNotifications(userId).catch(() => {});
  }, [userId]);
}

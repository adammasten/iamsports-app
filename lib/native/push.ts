// Native (iOS/Android): register this device for Expo push notifications and
// store its token, plus route notification taps into the app. Web uses the
// .web.ts no-op stub, so expo-notifications never enters the web bundle.
import { supabase } from '@/supabase';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

// Show banners even while the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const PROJECT_ID =
  (Constants?.expoConfig?.extra as any)?.eas?.projectId ?? 'ff1f3af9-f645-4ac5-9411-7ba489daea92';

// Ask permission (once), get the Expo push token, and upsert it for this user.
// No-ops on simulators (they can't receive push) and when permission is denied.
export async function registerForPushNotifications(userId: string): Promise<void> {
  if (!Device.isDevice) return;
  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted && existing.canAskAgain) {
    granted = (await Notifications.requestPermissionsAsync()).granted;
  }
  if (!granted) return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID });
  if (!token) return;
  await supabase.from('device_push_tokens').upsert(
    { user_id: userId, token, platform: Platform.OS, updated_at: new Date().toISOString() },
    { onConflict: 'token' },
  );
}

// A tapped notification can carry a `url` (deep link) in its data; default to the
// schedule (the first place push is used).
function routeFromData(data: any) {
  const url = data?.url ?? data?.route;
  if (typeof url === 'string' && url.startsWith('/')) router.push(url as any);
  else router.push('/schedule');
}

// Hook: register on login and route notification taps. Called from a gate in the
// root layout so it runs once per signed-in user.
export function usePushRegistration(userId: string | null) {
  useEffect(() => {
    if (!userId) return;
    registerForPushNotifications(userId).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(resp => {
      routeFromData(resp.notification.request.content.data);
    });
    return () => sub.remove();
  }, [userId]);
}

// ---------------------------------------------------------------------------
// Cross-platform surface for the Account screen's push card.
// push.web.ts exports the same three names with the browser's behaviour; these
// are the native counterparts so one shared import resolves on both platforms.
// ---------------------------------------------------------------------------

/** Browser-only concern (iOS Safari needs a Home Screen install). Never true here. */
export function isWebPushInstallGated(): boolean {
  return false;
}

/** Ask for permission and register. Mirrors the web signature. */
export async function requestWebPushPermission(userId: string): Promise<
  'granted' | 'denied' | 'unsupported' | 'install-required'
> {
  if (!Device.isDevice) return 'unsupported';   // simulators can't receive push
  const existing = await Notifications.getPermissionsAsync();
  const granted = existing.granted
    || (existing.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
  if (!granted) return 'denied';
  await registerForPushNotifications(userId);
  return 'granted';
}

/** Current permission, read synchronously from the last known value. */
export function webPushStatus(): 'granted' | 'denied' | 'default' | 'unsupported' {
  return Device.isDevice ? 'default' : 'unsupported';
}

/** Drop this device's token so it stops receiving push. */
export async function unregisterWebPush(): Promise<void> {
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID });
    if (token) await supabase.from('device_push_tokens').delete().eq('token', token);
  } catch { /* nothing registered */ }
}

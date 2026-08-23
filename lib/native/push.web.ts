// Web stub — no device push in the browser. Present so shared imports resolve
// without pulling expo-notifications into the web bundle.
export async function registerForPushNotifications(_userId: string): Promise<void> {}
export function usePushRegistration(_userId: string | null): void {}

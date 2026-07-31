// Runtime debug-overlay flag. __DEV__ is compile-time (false/eliminated in
// preview + release builds), so the yellow diagnostic panels couldn't be turned
// on to debug a real device build. This adds a persisted runtime flag: overlays
// show when __DEV__ OR the flag is on. Toggle it from a hidden gesture in the
// Account screen. The panels were the instrument that caught the orphaned-file
// bug (edits landing in home.tsx while index.tsx rendered) — keep them reachable.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

const KEY = 'iamsports.debug';
let enabled = false;
const listeners = new Set<(v: boolean) => void>();

// Call once on app start so the persisted value is loaded before first render.
export async function initDebugFlag() {
  try {
    enabled = (await AsyncStorage.getItem(KEY)) === '1';
    listeners.forEach(l => l(enabled));
  } catch {
    // ignore — flag stays off
  }
}

export function toggleDebug(): boolean {
  enabled = !enabled;
  AsyncStorage.setItem(KEY, enabled ? '1' : '0').catch(() => {});
  listeners.forEach(l => l(enabled));
  return enabled;
}

// Overlays show in dev always, or when the runtime flag is on (preview/release).
export function useDebugEnabled(): boolean {
  const [v, setV] = useState(enabled);
  useEffect(() => {
    const l = (x: boolean) => setV(x);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return __DEV__ || v;
}

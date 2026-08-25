// The app's ONE persistent bottom navigation (native only — web uses WebTopNav).
// Rendered on every browsing screen so the bar is always visible; immersive
// screens (video playback, tagging, upload, PIN, full-screen editors) simply don't
// render it. Search moved OUT of the bar (it lives in the Home header + Home search
// bar); Schedule — the highest-frequency destination — took its place.
import { COACH_ROLES, useTeamContext } from '@/context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type NavTab = 'home' | 'schedule' | 'filmroom' | 'coaches';

// Height the bar occupies (excluding the safe-area inset) — screens reserve this
// much bottom padding so content isn't hidden behind it.
export const BOTTOM_NAV_HEIGHT = 64;

export default function BottomNav({ active }: { active?: NavTab }) {
  const insets = useSafeAreaInsets();
  const { userTeams } = useTeamContext();
  const isCoachAnywhere = userTeams.some(t => COACH_ROLES.includes(t.role));
  if (Platform.OS === 'web') return null;

  const tint = (t: NavTab) => (active === t ? '#fff' : '#888');
  // navigate() reuses the route if it's already in history (tab-like), rather than
  // stacking a new copy on every tap.
  const go = (path: string, t: NavTab) => { if (active !== t) router.navigate(path as any); };

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom + 8 }]}>
      <TouchableOpacity style={styles.item} onPress={() => go('/select-team', 'home')} accessibilityLabel="Home">
        <Ionicons name="home" size={24} color={tint('home')} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.item} onPress={() => go('/schedule', 'schedule')} accessibilityLabel="Schedule">
        <Ionicons name="calendar-outline" size={24} color={tint('schedule')} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.center} onPress={() => router.push('/upload')} accessibilityLabel="Upload a video">
        <Ionicons name="add" size={30} color="#fff" />
      </TouchableOpacity>
      <TouchableOpacity style={styles.item} onPress={() => go('/my-work', 'filmroom')} accessibilityLabel="Film Room">
        <Ionicons name="folder-outline" size={24} color={tint('filmroom')} />
      </TouchableOpacity>
      {isCoachAnywhere ? (
        <TouchableOpacity style={styles.item} onPress={() => go('/coaches-corner', 'coaches')} accessibilityLabel="Coaches' Corner">
          <Ionicons name="clipboard-outline" size={24} color={tint('coaches')} />
        </TouchableOpacity>
      ) : (
        <View style={styles.item} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    borderTopWidth: 1, borderTopColor: '#222', backgroundColor: '#0a0a0a', paddingTop: 8,
  },
  item: { padding: 8, minWidth: 48, alignItems: 'center' },
  center: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#534AB7',
    alignItems: 'center', justifyContent: 'center', marginTop: -20,
    shadowColor: '#534AB7', shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 6,
  },
});

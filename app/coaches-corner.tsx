import { router } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// "Coaches' Corner" — placeholder stub. The film-review board for teams you
// coach (audience='coaches' reels) lands in a later slice; this screen is nav
// scaffold only, no data or logic yet.
export default function CoachesCornerScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>Coaches&apos; Corner</Text>

      <View style={styles.content}>
        <Text style={styles.empty}>
          Film review for the teams you coach. Posting reels here is coming next.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingHorizontal: 20 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { paddingVertical: 8 },
  backText: { color: '#534AB7', fontSize: 16 },
  title: { color: '#fff', fontSize: 26, fontWeight: '700', marginTop: 8, marginBottom: 16 },

  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: '#555', fontSize: 15, textAlign: 'center', paddingHorizontal: 20 },
});

// DARK dev route — /playbook-dev. NOT in any tab or navigation; reachable only
// by typing the URL. Renders the seed plays IN the real app so we can eyeball
// the renderer on the actual web surface (not just the standalone artifact).
// Zero launch surface: static seed data, no DB, no auth, no mutations.
//
// This is scaffolding for the real install viewer (list → install → play view),
// which will read installs/install_plays/play_versions from Supabase. Delete or
// gate this route before it would ever matter to a real user.

import PlayPlayer from '@/components/PlayPlayer';
import { SEED_PLAYS } from '@/lib/core/playbook/seeds';
import { goBackOrHome } from '@/lib/nav';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export default function PlaybookDev() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable onPress={() => goBackOrHome()} hitSlop={8} style={styles.back}>
        <Text style={styles.backTxt}>← Back</Text>
      </Pressable>
      <Text style={styles.eyebrow}>PLAYBOOK · DEV PREVIEW</Text>
      <Text style={styles.h1}>Seed plays — press ▶ to run them</Text>
      <Text style={styles.sub}>Dark route — not in navigation. Press Play (or scrub / step) to watch the five move along their routes.</Text>

      <View style={styles.grid}>
        {SEED_PLAYS.map((p, i) => (
          <View key={i} style={styles.card}>
            <Text style={styles.name}>{p.name}</Text>
            <PlayPlayer doc={p} />
          </View>
        ))}
      </View>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0e1b2c' },
  content: { padding: 20, maxWidth: 1120, width: '100%', alignSelf: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 4 },
  back: { alignSelf: 'flex-start', paddingVertical: 6 },
  backTxt: { color: '#ff6a2c', fontSize: 14, fontWeight: '700' },
  eyebrow: { color: '#ff6a2c', fontSize: 12, fontWeight: '800', letterSpacing: 1.6, marginTop: 8 },
  h1: { color: '#f1f4f6', fontSize: 26, fontWeight: '800', letterSpacing: -0.4, marginTop: 6 },
  sub: { color: '#9db0bd', fontSize: 14, marginTop: 6, marginBottom: 12 },
  card: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 16, padding: 16, gap: 10, flexGrow: 1, flexBasis: 300, minWidth: 280, maxWidth: 460 },
  name: { color: '#f1f4f6', fontSize: 16, fontWeight: '700' },
});

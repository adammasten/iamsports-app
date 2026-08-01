// Shared yellow diagnostic overlay (one component instead of three per-screen
// copies that drifted). Renders in development only (__DEV__ via useDebugEnabled)
// — compiled out of preview/release/TestFlight builds. Pass a screen title +
// stage-count lines.
import { useDebugEnabled } from '@/lib/debug-flag';
import { StyleSheet, Text, View } from 'react-native';

export function DebugPanel({ title, lines }: { title: string; lines: (string | null | undefined | false)[] }) {
  const show = useDebugEnabled();
  if (!show) return null;
  return (
    <View style={styles.box}>
      <Text style={styles.title}>▶ {title}</Text>
      {lines.filter(Boolean).map((l, i) => (
        <Text key={i} style={styles.text}>{l}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: '#3a2f00', borderWidth: 1, borderColor: '#c8a400', borderRadius: 8, padding: 8, marginBottom: 10 },
  title: { color: '#ffd11a', fontWeight: '700', fontSize: 12, marginBottom: 2 },
  text: { color: '#ffe98a', fontSize: 11 },
});

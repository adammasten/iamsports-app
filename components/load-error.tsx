// Distinct ERROR state (vs loading vs empty) with a Retry action. Screens used
// to collapse "failed fetch" into the empty state, so a real failure looked like
// "nothing here." This makes the failure explicit and recoverable.
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export function LoadError({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.icon}>⚠️</Text>
      <Text style={styles.msg}>{message || 'Couldn’t load this. Check your connection.'}</Text>
      <TouchableOpacity style={styles.btn} onPress={onRetry} activeOpacity={0.8}>
        <Text style={styles.btnText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 36, gap: 10 },
  icon: { fontSize: 26 },
  msg: { color: '#c9c9c9', fontSize: 14, textAlign: 'center', lineHeight: 20, maxWidth: 300 },
  btn: { backgroundColor: '#534AB7', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 28, marginTop: 4 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});

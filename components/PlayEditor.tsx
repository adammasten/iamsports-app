// PlayEditor (native fallback) — the editor is web-only for now (pointer drag +
// DOM controls). On device, point coaches to the web app to author plays.
import { StyleSheet, Text, View } from 'react-native';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function PlayEditor({ editId }: { editId?: string } = {}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.txt}>The play editor is available on the web app for now.{'\n'}Open iamsports.com on a computer to draw plays.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 24, alignItems: 'center' },
  txt: { color: '#9db0bd', fontSize: 14, textAlign: 'center', lineHeight: 21 },
});

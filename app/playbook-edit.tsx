// /playbook-edit — host screen for the play editor. Coaches only (the editor's
// team picker + RLS on save enforce it). Reachable from All Plays via "＋ New play".

import PlayEditor from '@/components/PlayEditor';
import { goBackOrHome } from '@/lib/nav';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import WebTopNav from './components/WebTopNav';

export default function PlaybookEditScreen() {
  return (
    <View style={styles.root}>
      {Platform.OS === 'web' ? <WebTopNav /> : null}
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Pressable onPress={() => goBackOrHome()} hitSlop={8} style={styles.back}>
          <Text style={styles.backTxt}>← Back</Text>
        </Pressable>
        <Text style={styles.eyebrow}>PLAYBOOK</Text>
        <Text style={styles.h1}>New play</Text>
        <Text style={styles.sub}>Drag your players into a formation, draw their routes, tag it, and save it to your team.</Text>
        <View style={{ height: 14 }} />
        <PlayEditor />
        <View style={{ height: 60 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e1b2c' },
  screen: { flex: 1, backgroundColor: '#0e1b2c' },
  content: { padding: 20, maxWidth: 1000, width: '100%', alignSelf: 'center' },
  back: { alignSelf: 'flex-start', paddingVertical: 6 },
  backTxt: { color: '#ff6a2c', fontSize: 14, fontWeight: '700' },
  eyebrow: { color: '#ff6a2c', fontSize: 12, fontWeight: '800', letterSpacing: 1.6, marginTop: 8 },
  h1: { color: '#f1f4f6', fontSize: 28, fontWeight: '800', letterSpacing: -0.5, marginTop: 6 },
  sub: { color: '#9db0bd', fontSize: 14, marginTop: 6, lineHeight: 20 },
});

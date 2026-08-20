// /playbook-edit — host screen for the play editor. Coaches only (the editor's
// team picker + RLS on save enforce it). Reachable from All Plays via "＋ New play".

import PlayEditor from '@/components/PlayEditor';
import { goBackOrHome } from '@/lib/nav';
import { useLocalSearchParams } from 'expo-router';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import WebTopNav from './components/WebTopNav';

export default function PlaybookEditScreen() {
  const params = useLocalSearchParams();
  const editId = Array.isArray(params.editId) ? params.editId[0] : params.editId;
  return (
    <View style={styles.root}>
      {Platform.OS === 'web' ? <WebTopNav /> : null}
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Pressable onPress={() => goBackOrHome()} hitSlop={8} style={styles.back}>
          <Text style={styles.backTxt}>← Back</Text>
        </Pressable>
        <Text style={styles.eyebrow}>MY PLAYBOOK</Text>
        <Text style={styles.h1}>{editId ? 'Edit play' : 'New play'}</Text>
        <Text style={styles.sub}>Drag players into a formation, draw their routes, tag it, and save it to your library. {editId ? 'Saving also updates every team you’ve attached it to.' : 'Attach it to teams from My Playbook.'}</Text>
        <View style={{ height: 14 }} />
        <PlayEditor editId={editId} />
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

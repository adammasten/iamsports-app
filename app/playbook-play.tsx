// /playbook-play?playId=… — one play, with its linked FILM. View the play, then
// watch the clips of your team running it (the teach → run → review loop). Coaches
// get "＋ Link film" to attach game clips.

import PlayPlayer from '@/components/PlayPlayer';
import { useTeamContext } from '@/context';
import { LINK_TYPE_LABEL, fetchPlay, fetchPlayClips, unlinkClip, type PlayClip, type PlayFull } from '@/lib/core/playbook/filmLinks';
import { fetchCoachTeams } from '@/lib/core/playbook/installs';
import { tagColor } from '@/lib/core/playbook/tags';
import { goBackOrHome } from '@/lib/nav';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import WebTopNav from './components/WebTopNav';

export default function PlayDetail() {
  const { playId } = useLocalSearchParams<{ playId: string }>();
  const { userId } = useTeamContext();
  const [play, setPlay] = useState<PlayFull | null>(null);
  const [clips, setClips] = useState<PlayClip[]>([]);
  const [isCoach, setIsCoach] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadClips = useCallback(() => { if (playId) fetchPlayClips(playId).then(setClips).catch(() => {}); }, [playId]);

  useEffect(() => {
    if (!playId) return;
    let alive = true;
    fetchPlay(playId)
      .then(p => {
        if (!alive) return;
        setPlay(p);
        if (userId) fetchCoachTeams(userId).then(ts => { if (alive) setIsCoach(ts.some(t => t.id === p.teamId)); }).catch(() => {});
      })
      .catch(e => { if (alive) setErr(e?.message ?? String(e)); });
    return () => { alive = false; };
  }, [playId, userId]);

  // Re-pull linked clips whenever the screen refocuses (e.g. back from the linker).
  useFocusEffect(useCallback(() => { loadClips(); }, [loadClips]));

  function watch(c: PlayClip) {
    if (!c.storagePath) return;
    router.push({ pathname: '/shared-viewer', params: { title: c.title, storagePath: c.storagePath, startTime: String(c.start), endTime: String(c.end) } });
  }
  async function remove(linkId: string) { try { await unlinkClip(linkId); loadClips(); } catch (e: any) { setErr(e?.message ?? String(e)); } }

  return (
    <View style={styles.root}>
      {Platform.OS === 'web' ? <WebTopNav /> : null}
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Pressable onPress={() => goBackOrHome()} hitSlop={8} style={styles.back}><Text style={styles.backTxt}>← Back</Text></Pressable>

        {err ? <View style={styles.errBox}><Text style={styles.errTxt}>{err}</Text></View> : null}
        {play === null ? (
          <ActivityIndicator color="#ff6a2c" style={{ marginTop: 30 }} />
        ) : (
          <>
            <Text style={styles.h1}>{play.doc?.name ?? play.name}</Text>
            {play.tags.length > 0 ? (
              <View style={styles.tagWrap}>
                {play.tags.map(t => (
                  <View key={t} style={[styles.tagChip, { borderColor: tagColor(t) }]}>
                    <View style={[styles.tagDot, { backgroundColor: tagColor(t) }]} />
                    <Text style={styles.tagChipTxt}>{t}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.diagramWrap}>
              {play.doc ? <PlayPlayer doc={play.doc} /> : <Text style={styles.missing}>Play couldn’t be loaded.</Text>}
            </View>
            {play.doc?.note ? (
              <View style={styles.noteBox}><Text style={styles.noteLabel}>COACH’S NOTES</Text><Text style={styles.noteTxt}>{play.doc.note}</Text></View>
            ) : null}

            {/* Film */}
            <View style={styles.filmHead}>
              <Text style={styles.filmTitle}>🎬  Film</Text>
              {isCoach ? (
                <Pressable style={styles.linkBtn} onPress={() => router.push({ pathname: '/playbook-link', params: { playId: play.id, teamId: play.teamId, version: String(play.latestVersion || 1) } })}>
                  <Text style={styles.linkBtnTxt}>＋ Link film</Text>
                </Pressable>
              ) : null}
            </View>
            {clips.length === 0 ? (
              <Text style={styles.empty}>No film linked yet.{isCoach ? ' Tap “Link film” to attach a clip of your team running this.' : ''}</Text>
            ) : (
              clips.map(c => (
                <View key={c.linkId} style={styles.clipRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.clipTitle} numberOfLines={1}>{c.title}</Text>
                    <Text style={styles.clipType}>{LINK_TYPE_LABEL[c.linkType]}</Text>
                  </View>
                  <Pressable style={styles.watchBtn} onPress={() => watch(c)}><Text style={styles.watchTxt}>▶ Watch</Text></Pressable>
                  {isCoach ? <Pressable hitSlop={8} onPress={() => remove(c.linkId)}><Text style={styles.unlink}>✕</Text></Pressable> : null}
                </View>
              ))
            )}
          </>
        )}
        <View style={{ height: 50 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e1b2c' },
  screen: { flex: 1, backgroundColor: '#0e1b2c' },
  content: { padding: 20, maxWidth: 640, width: '100%', alignSelf: 'center' },
  back: { alignSelf: 'flex-start', paddingVertical: 6 },
  backTxt: { color: '#ff6a2c', fontSize: 14, fontWeight: '700' },
  h1: { color: '#f1f4f6', fontSize: 26, fontWeight: '800', letterSpacing: -0.4, marginTop: 8 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tagChip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  tagDot: { width: 7, height: 7, borderRadius: 4 },
  tagChipTxt: { color: '#c7d2dc', fontSize: 11.5, fontWeight: '700' },
  diagramWrap: { marginTop: 14, maxWidth: 460, width: '100%' },
  missing: { color: '#ffb4a8', fontSize: 13.5 },
  noteBox: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 10, padding: 12, gap: 6, marginTop: 12 },
  noteLabel: { color: '#ff6a2c', fontSize: 10.5, fontWeight: '800', letterSpacing: 1.2 },
  noteTxt: { color: '#c7d2dc', fontSize: 13.5, lineHeight: 19 },
  filmHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26, marginBottom: 10 },
  filmTitle: { color: '#f1f4f6', fontSize: 18, fontWeight: '800' },
  linkBtn: { backgroundColor: '#ff6a2c', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  linkBtnTxt: { color: '#160b02', fontSize: 13, fontWeight: '800' },
  empty: { color: '#9db0bd', fontSize: 14, lineHeight: 20 },
  clipRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10 },
  clipTitle: { color: '#f1f4f6', fontSize: 14, fontWeight: '700' },
  clipType: { color: '#9db0bd', fontSize: 12, marginTop: 2 },
  watchBtn: { backgroundColor: '#534AB7', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  watchTxt: { color: '#fff', fontSize: 13, fontWeight: '700' },
  unlink: { color: '#9db0bd', fontSize: 16, fontWeight: '800', paddingHorizontal: 4 },
  errBox: { backgroundColor: '#2a1416', borderColor: '#5c2a2a', borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 12 },
  errTxt: { color: '#ffb4a8', fontSize: 13.5, lineHeight: 19 },
});

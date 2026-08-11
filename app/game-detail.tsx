// Game detail — matches docs/game-card-prototype.html (the design Adam approved).
// A LIST screen (no inline player): header + a Film-Room Watch/Tag toggle + video ROWS
// (thumb + name + "Uploaded date", ⋯ overflow) + a "Game" actions section. Watch mode:
// tap a row → launch the fullscreen plays-through player (app/game-player). Tag mode:
// rows show tagging status + tapping opens the tagger. Portrait, Expo-Go-testable.
//
// Deferred (flagged): "Move to another game" in the sheet (needs a game picker) and a
// full Share/Offline row here (those live on the Film Room card for now). Real
// thumbnails + per-video durations arrive with the optimize pipeline.
import { Ionicons } from '@expo/vector-icons';
import { goBackOrHome } from '@/lib/nav';
import { supabase } from '@/supabase';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ── design tokens (game-card-prototype.html) ──
const C = {
  bg: '#0a0a0c', surface: '#16161a', surface2: '#1e1e24', line: '#2a2a32',
  text: '#f4f4f6', dim: '#9a9aa5', faint: '#62626c', accent: '#6c5ce7',
  accentSoft: 'rgba(108,92,231,0.2)', danger: '#e2574a', plays: '#3ec46d',
};

type Vid = { id: string; label: string; url: string; taggingComplete: boolean; uploadStatus: 'uploading' | 'ready' | 'failed'; createdAt: string };

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function resultStr(t: number | null, o: number | null): string | null {
  if (t == null || o == null) return null;
  return `${t > o ? 'Won' : t < o ? 'Lost' : 'Tied'} ${t}–${o}`;
}

export default function GameDetailScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const gameId = (Array.isArray(params.id) ? params.id[0] : params.id) as string;
  const paramTitle = (Array.isArray(params.title) ? params.title[0] : params.title) as string | undefined;

  const [title, setTitle] = useState(paramTitle ?? 'Game');
  const [sub, setSub] = useState<string>('');
  const [videos, setVideos] = useState<Vid[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'watch' | 'tag'>('watch');
  const [sheetVid, setSheetVid] = useState<Vid | null>(null);

  const load = useCallback(async () => {
    if (!gameId) { setLoading(false); return; }
    const [{ data: g }, { data: vs }] = await Promise.all([
      supabase.from('games').select('title, game_date, team_score, opponent_score').eq('id', gameId).maybeSingle(),
      supabase.from('videos').select('id, label, url, tagging_complete, upload_status, created_at').eq('game_id', gameId).order('sort_order'),
    ]);
    if (g?.title) setTitle(g.title);
    const list: Vid[] = (vs ?? []).map((v: any) => ({
      id: v.id, label: v.label, url: v.url, taggingComplete: v.tagging_complete === true,
      uploadStatus: v.upload_status, createdAt: v.created_at,
    }));
    setVideos(list);
    const parts = [fmtDate((g?.game_date as string) ?? null), resultStr(g?.team_score ?? null, g?.opponent_score ?? null), `${list.length} video${list.length === 1 ? '' : 's'}`].filter(Boolean);
    setSub(parts.join(' · '));
    setLoading(false);
  }, [gameId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const readyIndex = (v: Vid) => videos.filter(x => x.uploadStatus === 'ready').findIndex(x => x.id === v.id);
  const openPlayer = (v: Vid) => {
    const i = readyIndex(v);
    if (i < 0) { Alert.alert(v.label, v.uploadStatus === 'uploading' ? 'Still uploading — check back in a moment.' : 'This upload didn’t finish.'); return; }
    router.push({ pathname: '/game-player', params: { id: gameId, index: String(i), title } });
  };
  const openTagger = (v: Vid) => router.push({ pathname: '/tagging-overlay', params: { videoId: v.id, url: v.url, label: v.label } });
  const viewClips = (v: Vid) => router.push({ pathname: '/clips', params: { videoId: v.id, label: v.label } });

  function renameVideo(v: Vid) {
    Alert.prompt?.('Rename video', undefined, async (text?: string) => {
      const next = (text ?? '').trim();
      if (!next || next === v.label) return;
      setVideos(prev => prev.map(x => x.id === v.id ? { ...x, label: next } : x));
      const { error } = await supabase.from('videos').update({ label: next }).eq('id', v.id);
      if (error) { Alert.alert('Error', error.message); load(); }
    }, 'plain-text', v.label);
  }
  function removeFromGame(v: Vid) {
    Alert.alert('Remove from game', `Take “${v.label}” out of this game? It becomes loose footage — not deleted.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('videos').update({ game_id: null }).eq('id', v.id);
        if (error) { Alert.alert('Error', error.message); return; }
        setVideos(prev => prev.filter(x => x.id !== v.id));
        setSheetVid(null);
      } },
    ]);
  }

  const sheetActions = (v: Vid) => [
    { icon: 'play', label: 'Watch', onPress: () => { setSheetVid(null); openPlayer(v); } },
    { icon: 'pricetag-outline', label: 'Tag video', onPress: () => { setSheetVid(null); openTagger(v); } },
    { icon: 'sparkles-outline', label: 'View clips', onPress: () => { setSheetVid(null); viewClips(v); } },
    { icon: 'create-outline', label: 'Rename', onPress: () => { setSheetVid(null); renameVideo(v); } },
    { icon: 'remove-circle-outline', label: 'Remove from game', danger: true, onPress: () => removeFromGame(v) },
  ];

  return (
    <View style={[styles.c, { paddingTop: insets.top + 6 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBackOrHome} hitSlop={10}><Text style={styles.back}>‹</Text></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {sub ? <Text style={styles.sub} numberOfLines={1}>{sub}</Text> : null}
        </View>
      </View>

      {/* Watch / Tag toggle (Film Room) */}
      <View style={styles.toggle}>
        {(['watch', 'tag'] as const).map(m => (
          <TouchableOpacity key={m} style={[styles.toggleBtn, mode === m && styles.toggleBtnOn]} onPress={() => setMode(m)}>
            <Text style={[styles.toggleText, mode === m && styles.toggleTextOn]}>{m === 'watch' ? '▶ Watch' : '⊕ Tag'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionLabel}>{mode === 'watch' ? 'Tap a video to watch · plays through' : 'Tap a video to tag it'}</Text>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={C.accent} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
          {videos.length === 0 ? (
            <Text style={styles.empty}>No videos in this game yet.</Text>
          ) : videos.map((v) => {
            return (
              <TouchableOpacity key={v.id} style={styles.row} activeOpacity={0.85} onPress={() => mode === 'watch' ? openPlayer(v) : openTagger(v)}>
                <View style={styles.thumb}>
                  <Ionicons name="play" size={20} color="rgba(255,255,255,0.85)" />
                </View>
                <View style={styles.info}>
                  <Text style={styles.name} numberOfLines={1}>{v.label}</Text>
                  {mode === 'tag'
                    ? <Text style={[styles.meta, { color: v.taggingComplete ? C.plays : C.dim }]}>{v.taggingComplete ? '✓ Tagged' : 'Not tagged yet'}</Text>
                    : <Text style={styles.meta}>{v.uploadStatus === 'uploading' ? 'Uploading…' : v.uploadStatus === 'failed' ? 'Upload didn’t finish' : `Uploaded ${fmtDate(v.createdAt) ?? ''}`}</Text>}
                </View>
                <TouchableOpacity
                  style={[styles.rowAction, mode === 'tag' && styles.rowActionTag]}
                  onPress={() => mode === 'watch' ? setSheetVid(v) : openTagger(v)}
                  hitSlop={8}
                >
                  <Text style={[styles.rowActionText, mode === 'tag' && { color: '#b3a7f5' }]}>{mode === 'watch' ? '⋯' : '⊕'}</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })}

          <Text style={[styles.sectionLabel, { marginTop: 22 }]}>Game</Text>
          <View style={styles.gameActions}>
            <TouchableOpacity style={[styles.gameBtn, styles.gameBtnPrimary]} onPress={() => router.push({ pathname: '/game', params: { id: gameId, title } })}>
              <Text style={[styles.gameBtnText, { color: '#fff' }]}>＋ Add video</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* Overflow sheet */}
      <Modal visible={!!sheetVid} transparent animationType="slide" onRequestClose={() => setSheetVid(null)}>
        <Pressable style={styles.scrim} onPress={() => setSheetVid(null)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]} onPress={() => {}}>
            <View style={styles.grip} />
            {sheetVid ? <Text style={styles.sheetTitle} numberOfLines={1}>{sheetVid.label}</Text> : null}
            {sheetVid ? sheetActions(sheetVid).map(a => (
              <TouchableOpacity key={a.label} style={styles.sheetItem} onPress={a.onPress}>
                <Ionicons name={a.icon as any} size={19} color={a.danger ? C.danger : C.dim} style={{ width: 26, textAlign: 'center' }} />
                <Text style={[styles.sheetLabel, a.danger && { color: C.danger }]}>{a.label}</Text>
              </TouchableOpacity>
            )) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingBottom: 14 },
  back: { color: C.accent, fontSize: 30, fontWeight: '400', width: 24 },
  title: { color: C.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  sub: { color: C.dim, fontSize: 13, marginTop: 2 },

  toggle: { flexDirection: 'row', backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 11, padding: 4, marginBottom: 16 },
  toggleBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  toggleBtnOn: { backgroundColor: C.accent },
  toggleText: { color: C.dim, fontSize: 14, fontWeight: '600' },
  toggleTextOn: { color: '#fff' },

  sectionLabel: { color: C.faint, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12, marginLeft: 2 },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50 },
  empty: { color: C.dim, fontSize: 15, textAlign: 'center', marginTop: 40 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 13, padding: 11, marginBottom: 11 },
  thumb: { width: 92, height: 56, borderRadius: 9, backgroundColor: '#232733', alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, minWidth: 0 },
  name: { color: C.text, fontSize: 15, fontWeight: '700' },
  meta: { color: C.dim, fontSize: 12, marginTop: 3 },
  rowAction: { width: 38, height: 38, borderRadius: 10, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  rowActionTag: { backgroundColor: C.accentSoft, borderColor: C.accent },
  rowActionText: { color: C.dim, fontSize: 18, fontWeight: '700' },

  gameActions: { flexDirection: 'row', gap: 10, marginLeft: 2 },
  gameBtn: { flex: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  gameBtnPrimary: { backgroundColor: C.accent, borderColor: C.accent },
  gameBtnText: { color: C.text, fontSize: 13, fontWeight: '600' },

  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.surface2, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: C.line, paddingHorizontal: 14, paddingTop: 6 },
  grip: { width: 38, height: 4, borderRadius: 2, backgroundColor: C.line, alignSelf: 'center', marginVertical: 8 },
  sheetTitle: { color: C.dim, fontSize: 13, textAlign: 'center', marginBottom: 8 },
  sheetItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 15, paddingHorizontal: 12, borderRadius: 12 },
  sheetLabel: { color: C.text, fontSize: 16, fontWeight: '500' },
});

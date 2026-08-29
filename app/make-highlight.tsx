// Parent "Make a highlight": pick your kid → pick games (one / some / all) →
// auto-gather the kid's POSITIVE clips → render a reel (saved to My Work + your
// device). The clip set is automatic — always "your kid's best plays" — so there's
// no coach-style tag wizard. Reached from the Home "Make a highlight" bar.
import { useTeamContext } from '@/context';
import { deriveStoragePath, renderReel, saveHighlightReel, type RenderClip } from '@/lib/core/render-reel';
import { goBackOrHome } from '@/lib/nav';
import { downloadMedia } from '@/lib/native/download-media';
import { supabase } from '@/supabase';
import { webAlert } from '@/lib/webAlert';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type ClipRow = { id: string; start_time: number; end_time: number; url: string; tagIds: string[] };
type GameRow = { id: string; title: string; date: string | null; clips: ClipRow[] };

function fmtDate(d: string | null): string {
  if (!d) return '';
  try { return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  catch { return ''; }
}

export default function MakeHighlightScreen() {
  const insets = useSafeAreaInsets();
  const { userKids } = useTeamContext();
  const params = useLocalSearchParams();
  const paramKid = Array.isArray(params.playerId) ? params.playerId[0] : params.playerId;

  const [kidId, setKidId] = useState<string | null>(
    (paramKid as string) ?? (userKids.length === 1 ? userKids[0].player_id : null),
  );
  const kidName = userKids.find((k) => k.player_id === kidId)?.name ?? 'your kid';

  const [loading, setLoading] = useState(false);
  const [games, setGames] = useState<GameRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [doneReel, setDoneReel] = useState<{ storagePath: string } | null>(null);

  // Load the kid's games + their POSITIVE clips (only games with ≥1 highlight show).
  useEffect(() => {
    if (!kidId) { setGames([]); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: lu } = await supabase.from('game_lineups').select('game_id').eq('player_id', kidId);
      const gameIds = [...new Set((lu || []).map((r: any) => r.game_id))];
      if (gameIds.length === 0) { if (!cancelled) { setGames([]); setLoading(false); } return; }

      const { data: gs } = await supabase.from('games').select('id, title, game_date').in('id', gameIds);
      const gameMeta = new Map<string, { title: string; date: string | null }>(
        (gs || []).map((g: any) => [g.id, { title: g.title, date: g.game_date ?? null }]),
      );
      const { data: vids } = await supabase.from('videos').select('id, url, game_id').in('game_id', gameIds).is('deleted_at', null);
      const videoInfo = new Map<string, { url: string; gameId: string }>(
        (vids || []).map((v: any) => [v.id, { url: v.url, gameId: v.game_id }]),
      );
      const videoIds = (vids || []).map((v: any) => v.id);
      if (videoIds.length === 0) { if (!cancelled) { setGames([]); setLoading(false); } return; }

      const { data: cs } = await supabase.from('clips')
        .select('id, start_time, end_time, video_id, clip_tags ( tag_id, tags ( category, player_id, tag_polarity ) )')
        .in('video_id', videoIds);

      // Keep clips that involve THIS kid AND include a positive-polarity tag.
      const byGame = new Map<string, GameRow>();
      (cs || []).forEach((c: any) => {
        const tags = (c.clip_tags || []).map((ct: any) => ct.tags).filter(Boolean);
        const involvesKid = tags.some((t: any) => t.category === 'players' && t.player_id === kidId);
        const hasPositive = tags.some((t: any) => t.tag_polarity === 'positive');
        if (!involvesKid || !hasPositive) return;
        const vinfo = videoInfo.get(c.video_id);
        const meta = vinfo ? gameMeta.get(vinfo.gameId) : null;
        if (!vinfo || !meta) return;
        let g = byGame.get(vinfo.gameId);
        if (!g) { g = { id: vinfo.gameId, title: meta.title, date: meta.date, clips: [] }; byGame.set(vinfo.gameId, g); }
        g.clips.push({
          id: c.id, start_time: c.start_time, end_time: c.end_time, url: vinfo.url,
          tagIds: (c.clip_tags || []).map((ct: any) => ct.tag_id).filter(Boolean),
        });
      });
      const list = [...byGame.values()].filter((g) => g.clips.length > 0)
        .sort((a, b) => (a.date && b.date ? (a.date < b.date ? 1 : -1) : 0));
      if (!cancelled) {
        setGames(list);
        setSelected(new Set(list.map((g) => g.id))); // default: all games in
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [kidId]);

  const selectedClips = useMemo(
    () => games.filter((g) => selected.has(g.id)).flatMap((g) => g.clips),
    [games, selected],
  );
  const allSelected = games.length > 0 && selected.size === games.length;
  const toggleGame = (id: string) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(games.map((g) => g.id)));

  async function makeIt() {
    if (selectedClips.length === 0) return;
    setRendering(true); setProgress(0); setProgressLabel('Starting…');
    try {
      const renderClips: RenderClip[] = selectedClips.map((c) => ({ url: c.url, start_time: c.start_time, end_time: c.end_time }));
      const url = await renderReel(renderClips, {
        fileName: `${kidName}-highlights.mp4`,
        onProgress: (p, l) => { setProgress(p); if (l) setProgressLabel(l); },
      });
      await saveHighlightReel({
        videoUrl: url,
        clips: selectedClips.map((c) => ({ id: c.id, start_time: c.start_time, end_time: c.end_time, tagIds: c.tagIds })),
        name: `${kidName}'s highlights`,
      });
      setDoneReel({ storagePath: deriveStoragePath(url) });
    } catch (e: any) {
      webAlert('Highlight failed', e?.message || 'Something went wrong making the reel.');
    } finally {
      setRendering(false);
    }
  }

  async function download() {
    if (!doneReel) return;
    setDownloading(true);
    try {
      const res = await downloadMedia([{ key: doneReel.storagePath, filename: `${kidName} highlights.mp4` }]);
      webAlert('Saved', res.saved > 0 ? 'Saved to your device.' : 'Could not save it.');
    } catch (e: any) {
      webAlert('Download', e?.message || 'Could not save it.');
    } finally {
      setDownloading(false);
    }
  }

  const Frame = ({ children }: { children: React.ReactNode }) => (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.wrap}>
        <TouchableOpacity onPress={goBackOrHome} style={styles.back} hitSlop={8}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
        {children}
      </View>
    </View>
  );

  // ----- Success -----
  if (doneReel) {
    return (
      <Frame>
        <Text style={styles.big}>🎉</Text>
        <Text style={styles.title}>{`${kidName}'s highlight is ready`}</Text>
        <Text style={styles.sub}>{"It's saved to your My Work — play or share it anytime. Want it on your phone too?"}</Text>
        <TouchableOpacity style={styles.primary} onPress={download} disabled={downloading}>
          {downloading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Save to my phone</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.ghost} onPress={goBackOrHome}><Text style={styles.ghostText}>Done</Text></TouchableOpacity>
      </Frame>
    );
  }

  // ----- Rendering -----
  if (rendering) {
    return (
      <Frame>
        <Text style={styles.title}>{`Making ${kidName}'s highlight…`}</Text>
        <View style={styles.progressWrap}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={styles.progressPct}>{Math.round(progress)}%</Text>
          <Text style={styles.sub}>{progressLabel || 'Stitching the best plays together…'}</Text>
          <Text style={styles.tiny}>This can take a minute — keep the app open.</Text>
        </View>
      </Frame>
    );
  }

  // ----- Kid picker (only when we don't already know the kid) -----
  if (!kidId) {
    return (
      <Frame>
        <Text style={styles.title}>Make a highlight</Text>
        <Text style={styles.sub}>Which child?</Text>
        {userKids.map((k) => (
          <TouchableOpacity key={k.player_id} style={styles.kidRow} onPress={() => setKidId(k.player_id)}>
            <Text style={styles.kidName}>{k.name}</Text>
            <Text style={styles.chev}>›</Text>
          </TouchableOpacity>
        ))}
        {userKids.length === 0 && <Text style={styles.sub}>{"You don't have any kids linked yet."}</Text>}
      </Frame>
    );
  }

  // ----- Game picker -----
  const totalClips = selectedClips.length;
  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.wrap}>
        <TouchableOpacity onPress={goBackOrHome} style={styles.back} hitSlop={8}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>{`Make ${kidName}'s highlight`}</Text>
        <Text style={styles.sub}>{`Pick which games to include — we'll grab ${kidName}'s best plays from them.`}</Text>

        {loading ? (
          <ActivityIndicator color="#2563eb" style={{ marginTop: 40 }} />
        ) : games.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🎬</Text>
            <Text style={styles.emptyTitle}>No highlights yet</Text>
            <Text style={styles.sub}>{`Once ${kidName}'s coach tags a game with good plays, they'll show up here.`}</Text>
          </View>
        ) : (
          <>
            <TouchableOpacity style={styles.selectAll} onPress={toggleAll}>
              <Text style={styles.selectAllText}>{allSelected ? 'Clear all' : 'Select all'}</Text>
            </TouchableOpacity>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 20 }} showsVerticalScrollIndicator={false}>
              {games.map((g) => {
                const on = selected.has(g.id);
                return (
                  <Pressable key={g.id} style={[styles.gameRow, on && styles.gameRowOn]} onPress={() => toggleGame(g.id)}>
                    <View style={[styles.check, on && styles.checkOn]}>{on ? <Text style={styles.checkMark}>✓</Text> : null}</View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.gameTitle} numberOfLines={1}>{g.title}</Text>
                      <Text style={styles.gameMeta}>{fmtDate(g.date)}{g.date ? ' · ' : ''}{g.clips.length} highlight{g.clips.length === 1 ? '' : 's'}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
            <TouchableOpacity
              style={[styles.primary, totalClips === 0 && styles.primaryDisabled]}
              disabled={totalClips === 0}
              onPress={makeIt}
            >
              <Text style={styles.primaryText}>
                {totalClips === 0 ? 'Pick at least one game' : `Make highlight · ${totalClips} clip${totalClips === 1 ? '' : 's'}`}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b1220', paddingHorizontal: 20 },
  wrap: { flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center' },
  back: { paddingVertical: 8 },
  backText: { color: '#6ea8ff', fontSize: 16, fontWeight: '600' },
  title: { color: '#f1f4f6', fontSize: 24, fontWeight: '800', letterSpacing: -0.4, marginTop: 4 },
  sub: { color: '#8b96a3', fontSize: 14, lineHeight: 20, marginTop: 8 },
  tiny: { color: '#5b6b7c', fontSize: 12, marginTop: 10 },
  big: { fontSize: 44, marginTop: 30 },

  kidRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#12202e', borderColor: '#22384c', borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 16, marginTop: 12 },
  kidName: { color: '#f1f4f6', fontSize: 16, fontWeight: '600' },
  chev: { color: '#5b6b7c', fontSize: 22 },

  selectAll: { alignSelf: 'flex-start', marginTop: 14, marginBottom: 4, paddingVertical: 6 },
  selectAllText: { color: '#6ea8ff', fontSize: 14, fontWeight: '700' },
  gameRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#12202e', borderColor: '#22384c', borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 9 },
  gameRowOn: { borderColor: '#2f6ae0', backgroundColor: '#14273f' },
  check: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: '#3a5068', alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  checkMark: { color: '#fff', fontSize: 14, fontWeight: '900' },
  gameTitle: { color: '#f1f4f6', fontSize: 15, fontWeight: '600' },
  gameMeta: { color: '#8b96a3', fontSize: 12.5, marginTop: 2 },

  primary: { backgroundColor: '#2563eb', borderRadius: 13, paddingVertical: 16, alignItems: 'center', marginTop: 14, marginBottom: 20 },
  primaryDisabled: { backgroundColor: '#1c2f47' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  ghost: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  ghostText: { color: '#8b96a3', fontSize: 15, fontWeight: '600' },

  progressWrap: { alignItems: 'center', marginTop: 50, gap: 10 },
  progressPct: { color: '#f1f4f6', fontSize: 30, fontWeight: '800', marginTop: 8 },

  empty: { alignItems: 'center', marginTop: 50, gap: 6 },
  emptyEmoji: { fontSize: 40 },
  emptyTitle: { color: '#f1f4f6', fontSize: 18, fontWeight: '700' },
});

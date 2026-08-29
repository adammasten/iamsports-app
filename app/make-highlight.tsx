// Parent "Make a highlight": pick kid -> pick sport (auto-skip if one) -> pick
// games -> choose what to include (universal quick picks + sport-specific play
// checklist) -> render a reel (My Work + save to device). Data-driven per sport,
// so new sports need no screen changes. Reached from the Home "Make a highlight" bar.
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

type TagRef = { name: string; category: string };
type Clip = {
  id: string; start: number; end: number; url: string;
  gameId: string; gameTitle: string; gameDate: string | null;
  sportKey: string; sportLabel: string;
  starred: boolean;
  posTags: TagRef[];        // this clip's positive-polarity tags
};
type Preset = 'all' | 'highlights' | 'scoring' | 'defense' | 'custom';

function titleCase(s: string): string {
  return s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
function sportEmoji(key: string): string {
  if (key.includes('basket')) return '🏀';
  if (key.includes('foot')) return '🏈';
  if (key.includes('base') || key.includes('soft')) return '⚾';
  if (key.includes('soccer')) return '⚽';
  if (key.includes('volley')) return '🏐';
  if (key.includes('lacrosse')) return '🥍';
  if (key.includes('hockey')) return '🏒';
  return '🎽';
}
function fmtDate(d: string | null): string {
  if (!d) return '';
  try { return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  catch { return ''; }
}
function estDuration(clips: { start: number; end: number }[]): string {
  const secs = clips.reduce((s, c) => s + Math.max(0, c.end - c.start), 0);
  const m = Math.floor(secs / 60), s = Math.round(secs % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `0:${s.toString().padStart(2, '0')}`;
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
  const [clips, setClips] = useState<Clip[]>([]);
  const [sportKey, setSportKey] = useState<string | null>(null);
  const [selectedGames, setSelectedGames] = useState<Set<string>>(new Set());
  const [preset, setPreset] = useState<Preset>('all');
  const [tagSel, setTagSel] = useState<Set<string>>(new Set()); // tag NAMES chosen (custom / preset)
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [doneReel, setDoneReel] = useState<{ storagePath: string } | null>(null);

  // Load ALL of the kid's highlight-eligible clips once (involves the kid AND is
  // positive or starred), with sport + game + tag metadata.
  useEffect(() => {
    if (!kidId) { setClips([]); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: lu } = await supabase.from('game_lineups').select('game_id').eq('player_id', kidId);
      const gameIds = [...new Set((lu || []).map((r: any) => r.game_id))];
      if (gameIds.length === 0) { if (!cancelled) { setClips([]); setLoading(false); } return; }

      const { data: gs } = await supabase.from('games').select('id, title, game_date').in('id', gameIds);
      const gmeta = new Map<string, { title: string; date: string | null }>(
        (gs || []).map((g: any) => [g.id, { title: g.title, date: g.game_date ?? null }]),
      );
      const { data: vids } = await supabase.from('videos').select('id, url, game_id, sport').in('game_id', gameIds).is('deleted_at', null);
      const vinfo = new Map<string, { url: string; gameId: string; sport: string }>(
        (vids || []).map((v: any) => [v.id, { url: v.url, gameId: v.game_id, sport: (v.sport || '').trim() }]),
      );
      const videoIds = (vids || []).map((v: any) => v.id);
      if (videoIds.length === 0) { if (!cancelled) { setClips([]); setLoading(false); } return; }

      const { data: cs } = await supabase.from('clips')
        .select('id, start_time, end_time, is_starred, video_id, clip_tags ( tags ( name, category, player_id, tag_polarity ) )')
        .in('video_id', videoIds);

      const out: Clip[] = [];
      (cs || []).forEach((c: any) => {
        const tags = (c.clip_tags || []).map((ct: any) => ct.tags).filter(Boolean);
        const involvesKid = tags.some((t: any) => t.category === 'players' && t.player_id === kidId);
        if (!involvesKid) return;
        const posTags: TagRef[] = tags.filter((t: any) => t.tag_polarity === 'positive').map((t: any) => ({ name: t.name, category: t.category }));
        const starred = c.is_starred === true;
        if (posTags.length === 0 && !starred) return; // not highlight-worthy
        const v = vinfo.get(c.video_id);
        if (!v) return;
        const m = gmeta.get(v.gameId);
        if (!m) return;
        const sportKeyC = (v.sport || 'other').toLowerCase() || 'other';
        out.push({
          id: c.id, start: c.start_time, end: c.end_time, url: v.url,
          gameId: v.gameId, gameTitle: m.title, gameDate: m.date,
          sportKey: sportKeyC, sportLabel: titleCase(sportKeyC),
          starred, posTags,
        });
      });
      if (!cancelled) { setClips(out); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [kidId]);

  // Sports the kid actually has highlight clips in.
  const sports = useMemo(() => {
    const m = new Map<string, string>();
    clips.forEach((c) => { if (!m.has(c.sportKey)) m.set(c.sportKey, c.sportLabel); });
    return [...m.entries()].map(([key, label]) => ({ key, label }));
  }, [clips]);

  // Auto-pick sport when there's exactly one.
  useEffect(() => {
    if (sportKey === null && sports.length === 1) setSportKey(sports[0].key);
  }, [sports, sportKey]);

  const sportClips = useMemo(() => (sportKey ? clips.filter((c) => c.sportKey === sportKey) : []), [clips, sportKey]);

  // Games for the chosen sport (default: all selected).
  const games = useMemo(() => {
    const m = new Map<string, { id: string; title: string; date: string | null; count: number }>();
    sportClips.forEach((c) => {
      const g = m.get(c.gameId) ?? { id: c.gameId, title: c.gameTitle, date: c.gameDate, count: 0 };
      g.count += 1; m.set(c.gameId, g);
    });
    return [...m.values()].sort((a, b) => (a.date && b.date ? (a.date < b.date ? 1 : -1) : 0));
  }, [sportClips]);
  useEffect(() => { setSelectedGames(new Set(games.map((g) => g.id))); }, [games]);

  const gameClips = useMemo(() => sportClips.filter((c) => selectedGames.has(c.gameId)), [sportClips, selectedGames]);

  // Positive-tag palette present in the chosen games, grouped by category, with counts.
  const tagPalette = useMemo(() => {
    const byName = new Map<string, { name: string; category: string; count: number }>();
    gameClips.forEach((c) => c.posTags.forEach((t) => {
      const e = byName.get(t.name) ?? { name: t.name, category: t.category, count: 0 };
      e.count += 1; byName.set(t.name, e);
    }));
    const groups = new Map<string, { name: string; count: number }[]>();
    [...byName.values()].forEach((t) => {
      const arr = groups.get(t.category) ?? []; arr.push({ name: t.name, count: t.count }); groups.set(t.category, arr);
    });
    for (const arr of groups.values()) arr.sort((a, b) => b.count - a.count);
    return groups; // Map<category, [{name,count}]>
  }, [gameClips]);
  const allTagNames = useMemo(() => { const s = new Set<string>(); gameClips.forEach((c) => c.posTags.forEach((t) => s.add(t.name))); return s; }, [gameClips]);

  // Default the selection to "All best plays" whenever the game set changes.
  useEffect(() => { setPreset('all'); setTagSel(new Set(allTagNames)); }, [allTagNames]);

  // Apply a quick pick.
  function applyPreset(p: Preset) {
    setPreset(p);
    if (p === 'highlights') { setTagSel(new Set()); return; } // starred, tag-independent
    if (p === 'all') { setTagSel(new Set(allTagNames)); return; }
    if (p === 'scoring') {
      const s = new Set<string>();
      [...allTagNames].forEach((n) => { const l = n.toLowerCase(); if (l.includes('made') || l.includes('touchdown') || l.includes(' td') || l === 'goal' || l.includes('score') || l.includes('kill') || l.includes('hit') || l.includes('run')) s.add(n); });
      setTagSel(s); return;
    }
    if (p === 'defense') {
      const s = new Set<string>();
      const defNames = new Set<string>();
      for (const [cat, arr] of tagPalette) if (cat === 'defense') arr.forEach((t) => defNames.add(t.name));
      [...allTagNames].forEach((n) => { if (defNames.has(n)) s.add(n); });
      setTagSel(s); return;
    }
  }
  function toggleTag(name: string) {
    setPreset('custom');
    setTagSel((prev) => { const n = new Set(prev); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  }

  // Clips that match the current selection.
  const selectedClips = useMemo(() => {
    if (preset === 'highlights') return gameClips.filter((c) => c.starred);
    return gameClips.filter((c) => c.posTags.some((t) => tagSel.has(t.name)));
  }, [gameClips, preset, tagSel]);

  async function makeIt() {
    if (selectedClips.length === 0) return;
    setRendering(true); setProgress(0); setProgressLabel('Starting…');
    try {
      const renderClips: RenderClip[] = selectedClips.map((c) => ({ url: c.url, start_time: c.start, end_time: c.end }));
      const url = await renderReel(renderClips, {
        fileName: `${kidName}-highlights.mp4`,
        onProgress: (p, l) => { setProgress(p); if (l) setProgressLabel(l); },
      });
      await saveHighlightReel({
        videoUrl: url,
        clips: selectedClips.map((c) => ({ id: c.id, start_time: c.start, end_time: c.end })),
        name: `${kidName}'s highlights`,
      });
      setDoneReel({ storagePath: deriveStoragePath(url) });
    } catch (e: any) {
      webAlert('Highlight failed', e?.message || 'Something went wrong making the reel.');
    } finally { setRendering(false); }
  }

  async function download() {
    if (!doneReel) return;
    setDownloading(true);
    try {
      const res = await downloadMedia([{ key: doneReel.storagePath, filename: `${kidName} highlights.mp4` }]);
      webAlert('Saved', res.saved > 0 ? 'Saved to your device.' : 'Could not save it.');
    } catch (e: any) { webAlert('Download', e?.message || 'Could not save it.'); }
    finally { setDownloading(false); }
  }

  const Frame = ({ children }: { children: React.ReactNode }) => (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.wrap}>
        <TouchableOpacity onPress={goBackOrHome} style={styles.back} hitSlop={8}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
        {children}
      </View>
    </View>
  );

  // ---- Success / rendering / kid-picker states ----
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
  if (!kidId) {
    return (
      <Frame>
        <Text style={styles.title}>Make a highlight</Text>
        <Text style={styles.sub}>Which child?</Text>
        {userKids.map((k) => (
          <TouchableOpacity key={k.player_id} style={styles.kidRow} onPress={() => setKidId(k.player_id)}>
            <Text style={styles.kidName}>{k.name}</Text><Text style={styles.chev}>›</Text>
          </TouchableOpacity>
        ))}
        {userKids.length === 0 && <Text style={styles.sub}>{"You don't have any kids linked yet."}</Text>}
      </Frame>
    );
  }
  if (loading) return <Frame><ActivityIndicator color="#2563eb" style={{ marginTop: 40 }} /></Frame>;
  if (clips.length === 0) {
    return (
      <Frame>
        <Text style={styles.title}>{`Make ${kidName}'s highlight`}</Text>
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>🎬</Text>
          <Text style={styles.emptyTitle}>No highlights yet</Text>
          <Text style={styles.sub}>{`Once ${kidName}'s coach tags a game with good plays, they'll show up here.`}</Text>
        </View>
      </Frame>
    );
  }
  // Multi-sport gate: choose a sport first.
  if (!sportKey) {
    return (
      <Frame>
        <Text style={styles.title}>{`Make ${kidName}'s highlight`}</Text>
        <Text style={styles.sub}>Which sport?</Text>
        {sports.map((s) => (
          <TouchableOpacity key={s.key} style={styles.kidRow} onPress={() => setSportKey(s.key)}>
            <Text style={styles.kidName}>{sportEmoji(s.key)}  {s.label}</Text><Text style={styles.chev}>›</Text>
          </TouchableOpacity>
        ))}
      </Frame>
    );
  }

  // ---- Main: sport strip + games + what-to-include ----
  const totalSel = selectedClips.length;
  const scoringActive = preset === 'scoring', defenseActive = preset === 'defense', allActive = preset === 'all', hlActive = preset === 'highlights';
  const starredCount = gameClips.filter((c) => c.starred).length;
  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.wrap}>
        <TouchableOpacity onPress={goBackOrHome} style={styles.back} hitSlop={8}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>{`Make ${kidName}'s highlight`}</Text>

        {/* Sport strip — horizontal scroll; only shown when there's more than one. */}
        {sports.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12, flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
            {sports.map((s) => (
              <TouchableOpacity key={s.key} style={[styles.sp, s.key === sportKey && styles.spOn]} onPress={() => setSportKey(s.key)}>
                <Text style={[styles.spText, s.key === sportKey && styles.spTextOn]}>{sportEmoji(s.key)}  {s.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        <ScrollView style={{ flex: 1, marginTop: 14 }} contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
          {/* Games */}
          <Text style={styles.lbl}>Games</Text>
          {games.map((g) => {
            const on = selectedGames.has(g.id);
            return (
              <Pressable key={g.id} style={[styles.row, on && styles.rowOn]} onPress={() => setSelectedGames((prev) => { const n = new Set(prev); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })}>
                <View style={[styles.check, on && styles.checkOn]}>{on ? <Text style={styles.checkMark}>✓</Text> : null}</View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{g.title}</Text>
                  <Text style={styles.rowMeta}>{fmtDate(g.date)}{g.date ? ' · ' : ''}{g.count} highlight{g.count === 1 ? '' : 's'}</Text>
                </View>
              </Pressable>
            );
          })}

          {/* Quick picks */}
          <Text style={[styles.lbl, { marginTop: 20 }]}>Quick picks · works for any sport</Text>
          <View style={styles.quick}>
            <QP on={hlActive} icon="⭐" name="Highlights" desc={`Coach's starred · ${starredCount}`} onPress={() => applyPreset('highlights')} />
            <QP on={allActive} icon="🏀" name="All best plays" desc={`Every good clip · ${gameClips.length}`} onPress={() => applyPreset('all')} />
            <QP on={scoringActive} icon="🎯" name="Scoring" desc="Made plays" onPress={() => applyPreset('scoring')} />
            <QP on={defenseActive} icon="🛡️" name="Defense & hustle" desc="Steals · blocks · boards" onPress={() => applyPreset('defense')} />
          </View>

          {/* Build your own (hidden in Highlights mode — that's starred-only) */}
          {preset !== 'highlights' && (
            <>
              <View style={styles.divider}><View style={styles.ln} /><Text style={styles.divTxt}>or pick specific plays</Text><View style={styles.ln} /></View>
              {[...tagPalette.entries()].map(([cat, tags]) => (
                <View key={cat} style={{ marginBottom: 10 }}>
                  <Text style={[styles.gh, { color: catColor(cat) }]}>{cat.toUpperCase()}</Text>
                  {tags.map((t) => {
                    const on = tagSel.has(t.name);
                    return (
                      <Pressable key={t.name} style={[styles.row, on && styles.rowOn]} onPress={() => toggleTag(t.name)}>
                        <View style={[styles.check, on && styles.checkOn]}>{on ? <Text style={styles.checkMark}>✓</Text> : null}</View>
                        <Text style={styles.rowTitle}>{t.name}</Text>
                        <View style={styles.countPill}><Text style={styles.countTxt}>{t.count}</Text></View>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </>
          )}
        </ScrollView>

        <View style={styles.foot}>
          <View style={styles.tally}>
            <Text style={styles.tallyN}>{totalSel} clip{totalSel === 1 ? '' : 's'}</Text>
            {totalSel > 0 && <Text style={styles.tallyT}>· about {estDuration(selectedClips)}</Text>}
          </View>
          <TouchableOpacity style={[styles.primary, { marginTop: 0, marginBottom: 0 }, totalSel === 0 && styles.primaryDisabled]} disabled={totalSel === 0} onPress={makeIt}>
            <Text style={styles.primaryText}>{totalSel === 0 ? 'Pick some plays' : 'Make highlight'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function QP({ on, icon, name, desc, onPress }: { on: boolean; icon: string; name: string; desc: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={[qp.card, on && qp.cardOn]} onPress={onPress} activeOpacity={0.85}>
      <Text style={qp.ic}>{icon}</Text>
      <Text style={qp.nm}>{name}</Text>
      <Text style={[qp.ds, on && qp.dsOn]}>{desc}</Text>
    </TouchableOpacity>
  );
}
function catColor(cat: string): string {
  if (cat === 'defense') return '#f0917f';
  if (cat === 'plays') return '#79dca0';
  if (cat === 'players') return '#d7b0f5';
  return '#5aa0ff'; // offense / default
}

const qp = StyleSheet.create({
  card: { width: '48%', backgroundColor: '#12202e', borderWidth: 1.5, borderColor: '#22384c', borderRadius: 14, padding: 13 },
  cardOn: { borderColor: '#2f6ae0', backgroundColor: '#14273f' },
  ic: { fontSize: 22 },
  nm: { color: '#f1f4f6', fontSize: 14.5, fontWeight: '700', marginTop: 7, letterSpacing: -0.2 },
  ds: { color: '#8b96a3', fontSize: 11.5, marginTop: 2 },
  dsOn: { color: '#a9c4e8' },
});
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b1220', paddingHorizontal: 20 },
  wrap: { flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center' },
  back: { paddingVertical: 8 },
  backText: { color: '#6ea8ff', fontSize: 16, fontWeight: '600' },
  title: { color: '#f1f4f6', fontSize: 24, fontWeight: '800', letterSpacing: -0.4, marginTop: 4 },
  sub: { color: '#8b96a3', fontSize: 14, lineHeight: 20, marginTop: 8 },
  tiny: { color: '#5b6b7c', fontSize: 12, marginTop: 10 },
  big: { fontSize: 44, marginTop: 30 },
  lbl: { color: '#5b6b7c', fontSize: 11, fontWeight: '800', letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 10, marginLeft: 2 },

  kidRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#12202e', borderColor: '#22384c', borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 16, marginTop: 12 },
  kidName: { color: '#f1f4f6', fontSize: 16, fontWeight: '600' },
  chev: { color: '#5b6b7c', fontSize: 22 },

  sp: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, backgroundColor: '#12202e', borderWidth: 1.5, borderColor: '#22384c' },
  spOn: { backgroundColor: '#14273f', borderColor: '#2f6ae0' },
  spText: { color: '#8b96a3', fontSize: 13, fontWeight: '700' },
  spTextOn: { color: '#fff' },

  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20, marginBottom: 14 },
  ln: { flex: 1, height: 1, backgroundColor: '#22384c' },
  divTxt: { color: '#5b6b7c', fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  gh: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8, marginLeft: 2 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#12202e', borderColor: '#22384c', borderWidth: 1, borderRadius: 11, padding: 12, marginBottom: 7 },
  rowOn: { borderColor: '#2f6ae0', backgroundColor: '#14273f' },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#3a5068', alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  checkMark: { color: '#fff', fontSize: 13, fontWeight: '900' },
  rowTitle: { flex: 1, color: '#f1f4f6', fontSize: 14.5, fontWeight: '600' },
  rowMeta: { color: '#8b96a3', fontSize: 12.5, marginTop: 2 },
  countPill: { backgroundColor: '#0c1a28', borderColor: '#22384c', borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 },
  countTxt: { color: '#8b96a3', fontSize: 12, fontWeight: '700' },

  foot: { paddingTop: 12, borderTopWidth: 1, borderTopColor: '#22384c' },
  tally: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 8, marginBottom: 10 },
  tallyN: { color: '#f1f4f6', fontSize: 18, fontWeight: '800' },
  tallyT: { color: '#8b96a3', fontSize: 13 },

  primary: { backgroundColor: '#2563eb', borderRadius: 13, paddingVertical: 15, alignItems: 'center', marginTop: 14, marginBottom: 20 },
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

// Parent "Make a highlight": pick kid -> pick sport (auto-skip if one) -> pick
// games -> choose what to include (universal quick picks + sport-specific play
// checklist) -> REVIEW clips (remove / reorder / shuffle / expand who-did-what /
// duplicate flags) -> render a reel. Data-driven per sport. Reached from the Home
// "Make a highlight" bar.
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
type Bundle = { player: string | null; actions: string[] };  // "who did what" for the expand
type Clip = {
  id: string; start: number; end: number; url: string; videoId: string;
  gameId: string; gameTitle: string; gameDate: string | null;
  sportKey: string; sportLabel: string;
  starred: boolean;
  posTags: TagRef[];      // positive tags — drives the include filter
  summary: string[];      // action tag names for the compact row
  bundles: Bundle[];      // per-bundle player + actions for the expand
};
type Preset = 'all' | 'highlights' | 'scoring' | 'defense' | 'custom';

function titleCase(s: string): string { return s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '); }
function sportEmoji(key: string): string {
  if (key.includes('basket')) return '🏀'; if (key.includes('foot')) return '🏈';
  if (key.includes('base') || key.includes('soft')) return '⚾'; if (key.includes('soccer')) return '⚽';
  if (key.includes('volley')) return '🏐'; if (key.includes('lacrosse')) return '🥍'; if (key.includes('hockey')) return '🏒';
  return '🎽';
}
function fmtDate(d: string | null): string {
  if (!d) return '';
  try { return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; }
}
function fmtTime(s: number): string { const m = Math.floor(s / 60), sec = Math.floor(s % 60); return `${m}:${sec.toString().padStart(2, '0')}`; }
function estDuration(clips: { start: number; end: number }[]): string {
  const secs = clips.reduce((s, c) => s + Math.max(0, c.end - c.start), 0);
  const m = Math.floor(secs / 60), s = Math.round(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
// Two clips are likely duplicates: same video and near-overlapping windows.
function nearDup(a: Clip, b: Clip): boolean {
  if (a.videoId !== b.videoId) return false;
  return a.start <= b.end + 1.5 && b.start <= a.end + 1.5;
}

export default function MakeHighlightScreen() {
  const insets = useSafeAreaInsets();
  const { userKids } = useTeamContext();
  const params = useLocalSearchParams();
  const paramKid = Array.isArray(params.playerId) ? params.playerId[0] : params.playerId;

  const [kidId, setKidId] = useState<string | null>((paramKid as string) ?? (userKids.length === 1 ? userKids[0].player_id : null));
  const kidName = userKids.find((k) => k.player_id === kidId)?.name ?? 'your kid';

  const [loading, setLoading] = useState(false);
  const [clips, setClips] = useState<Clip[]>([]);
  const [sportKey, setSportKey] = useState<string | null>(null);
  const [selectedGames, setSelectedGames] = useState<Set<string>>(new Set());
  const [preset, setPreset] = useState<Preset>('all');
  const [tagSel, setTagSel] = useState<Set<string>>(new Set());
  // review step
  const [reviewList, setReviewList] = useState<Clip[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // render / result
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [doneReel, setDoneReel] = useState<{ storagePath: string } | null>(null);

  useEffect(() => {
    if (!kidId) { setClips([]); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: lu } = await supabase.from('game_lineups').select('game_id').eq('player_id', kidId);
      const gameIds = [...new Set((lu || []).map((r: any) => r.game_id))];
      if (gameIds.length === 0) { if (!cancelled) { setClips([]); setLoading(false); } return; }

      const { data: gs } = await supabase.from('games').select('id, title, game_date').in('id', gameIds);
      const gmeta = new Map<string, { title: string; date: string | null }>((gs || []).map((g: any) => [g.id, { title: g.title, date: g.game_date ?? null }]));
      const { data: vids } = await supabase.from('videos').select('id, url, game_id, sport').in('game_id', gameIds).is('deleted_at', null);
      const vinfo = new Map<string, { url: string; gameId: string; sport: string }>((vids || []).map((v: any) => [v.id, { url: v.url, gameId: v.game_id, sport: (v.sport || '').trim() }]));
      const videoIds = (vids || []).map((v: any) => v.id);
      if (videoIds.length === 0) { if (!cancelled) { setClips([]); setLoading(false); } return; }

      const { data: cs } = await supabase.from('clips')
        .select('id, start_time, end_time, is_starred, video_id, clip_tags ( bundle_number, tags ( name, category, player_id, tag_polarity ) )')
        .in('video_id', videoIds);

      // Resolve player names (best-effort — a parent may only see some).
      const playerIds = new Set<string>();
      (cs || []).forEach((c: any) => (c.clip_tags || []).forEach((ct: any) => { if (ct.tags?.category === 'players' && ct.tags.player_id) playerIds.add(ct.tags.player_id); }));
      const nameById = new Map<string, string>();
      if (playerIds.size > 0) {
        const { data: pl } = await supabase.from('players').select('id, name').in('id', [...playerIds]);
        (pl || []).forEach((p: any) => nameById.set(p.id, p.name));
      }

      const out: Clip[] = [];
      (cs || []).forEach((c: any) => {
        const ctags = c.clip_tags || [];
        const allTags = ctags.map((ct: any) => ct.tags).filter(Boolean);
        const involvesKid = allTags.some((t: any) => t.category === 'players' && t.player_id === kidId);
        if (!involvesKid) return;
        const posTags: TagRef[] = allTags.filter((t: any) => t.tag_polarity === 'positive').map((t: any) => ({ name: t.name, category: t.category }));
        const starred = c.is_starred === true;
        if (posTags.length === 0 && !starred) return;
        const v = vinfo.get(c.video_id); if (!v) return;
        const m = gmeta.get(v.gameId); if (!m) return;

        // Bundles: group tags by bundle_number → player + actions.
        const bmap = new Map<number, { playerId: string | null; actions: string[] }>();
        ctags.forEach((ct: any) => {
          const t = ct.tags; if (!t) return;
          const bn = ct.bundle_number ?? 0;
          const b = bmap.get(bn) ?? { playerId: null, actions: [] };
          if (t.category === 'players') b.playerId = t.player_id;
          else if (t.category === 'offense' || t.category === 'defense' || t.category === 'plays') b.actions.push(t.name);
          bmap.set(bn, b);
        });
        const bundles: Bundle[] = [...bmap.values()].filter((b) => b.actions.length > 0 || b.playerId)
          .map((b) => ({ player: b.playerId ? (nameById.get(b.playerId) ?? null) : null, actions: b.actions }));
        const summary = [...new Set(bundles.flatMap((b) => b.actions))];

        const sportKeyC = (v.sport || 'other').toLowerCase() || 'other';
        out.push({
          id: c.id, start: c.start_time, end: c.end_time, url: v.url, videoId: c.video_id,
          gameId: v.gameId, gameTitle: m.title, gameDate: m.date,
          sportKey: sportKeyC, sportLabel: titleCase(sportKeyC),
          starred, posTags, summary, bundles,
        });
      });
      if (!cancelled) { setClips(out); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [kidId]);

  const sports = useMemo(() => {
    const m = new Map<string, string>(); clips.forEach((c) => { if (!m.has(c.sportKey)) m.set(c.sportKey, c.sportLabel); });
    return [...m.entries()].map(([key, label]) => ({ key, label }));
  }, [clips]);
  useEffect(() => { if (sportKey === null && sports.length === 1) setSportKey(sports[0].key); }, [sports, sportKey]);

  const sportClips = useMemo(() => (sportKey ? clips.filter((c) => c.sportKey === sportKey) : []), [clips, sportKey]);
  const games = useMemo(() => {
    const m = new Map<string, { id: string; title: string; date: string | null; count: number }>();
    sportClips.forEach((c) => { const g = m.get(c.gameId) ?? { id: c.gameId, title: c.gameTitle, date: c.gameDate, count: 0 }; g.count += 1; m.set(c.gameId, g); });
    return [...m.values()].sort((a, b) => (a.date && b.date ? (a.date < b.date ? 1 : -1) : 0));
  }, [sportClips]);
  useEffect(() => { setSelectedGames(new Set(games.map((g) => g.id))); }, [games]);

  const gameClips = useMemo(() => sportClips.filter((c) => selectedGames.has(c.gameId)), [sportClips, selectedGames]);
  const tagPalette = useMemo(() => {
    const byName = new Map<string, { name: string; category: string; count: number }>();
    gameClips.forEach((c) => c.posTags.forEach((t) => { const e = byName.get(t.name) ?? { name: t.name, category: t.category, count: 0 }; e.count += 1; byName.set(t.name, e); }));
    const groups = new Map<string, { name: string; count: number }[]>();
    [...byName.values()].forEach((t) => { const arr = groups.get(t.category) ?? []; arr.push({ name: t.name, count: t.count }); groups.set(t.category, arr); });
    for (const arr of groups.values()) arr.sort((a, b) => b.count - a.count);
    return groups;
  }, [gameClips]);
  const allTagNames = useMemo(() => { const s = new Set<string>(); gameClips.forEach((c) => c.posTags.forEach((t) => s.add(t.name))); return s; }, [gameClips]);
  useEffect(() => { setPreset('all'); setTagSel(new Set(allTagNames)); }, [allTagNames]);

  function applyPreset(p: Preset) {
    setPreset(p);
    if (p === 'highlights') { setTagSel(new Set()); return; }
    if (p === 'all') { setTagSel(new Set(allTagNames)); return; }
    if (p === 'scoring') {
      const s = new Set<string>();
      [...allTagNames].forEach((n) => { const l = n.toLowerCase(); if (l.includes('made') || l.includes('touchdown') || l.includes(' td') || l === 'goal' || l.includes('score') || l.includes('kill') || l.includes('hit') || l.includes('run')) s.add(n); });
      setTagSel(s); return;
    }
    if (p === 'defense') {
      const def = new Set<string>(); for (const [cat, arr] of tagPalette) if (cat === 'defense') arr.forEach((t) => def.add(t.name));
      setTagSel(new Set([...allTagNames].filter((n) => def.has(n)))); return;
    }
  }
  function toggleTag(name: string) { setPreset('custom'); setTagSel((prev) => { const n = new Set(prev); if (n.has(name)) n.delete(name); else n.add(name); return n; }); }

  const selectedClips = useMemo(() => {
    if (preset === 'highlights') return gameClips.filter((c) => c.starred);
    return gameClips.filter((c) => c.posTags.some((t) => tagSel.has(t.name)));
  }, [gameClips, preset, tagSel]);

  // Duplicate ids within the current review list.
  const dupIds = useMemo(() => {
    const s = new Set<string>(); if (!reviewList) return s;
    for (let i = 0; i < reviewList.length; i++) for (let j = i + 1; j < reviewList.length; j++) {
      if (nearDup(reviewList[i], reviewList[j])) { s.add(reviewList[i].id); s.add(reviewList[j].id); }
    }
    return s;
  }, [reviewList]);

  function enterReview() { setReviewList([...selectedClips]); setExpanded(new Set()); }
  function removeClip(id: string) { setReviewList((prev) => prev ? prev.filter((c) => c.id !== id) : prev); }
  function moveClip(idx: number, dir: -1 | 1) {
    setReviewList((prev) => { if (!prev) return prev; const n = [...prev]; const j = idx + dir; if (j < 0 || j >= n.length) return prev; [n[idx], n[j]] = [n[j], n[idx]]; return n; });
  }
  function shuffle() {
    setReviewList((prev) => { if (!prev) return prev; const n = [...prev]; for (let i = n.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [n[i], n[j]] = [n[j], n[i]]; } return n; });
  }
  function toggleExpand(id: string) { setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }

  async function makeIt() {
    const list = reviewList ?? selectedClips;
    if (list.length === 0) return;
    setRendering(true); setProgress(0); setProgressLabel('Starting…');
    try {
      const renderClips: RenderClip[] = list.map((c) => ({ url: c.url, start_time: c.start, end_time: c.end }));
      const url = await renderReel(renderClips, { fileName: `${kidName}-highlights.mp4`, onProgress: (p, l) => { setProgress(p); if (l) setProgressLabel(l); } });
      await saveHighlightReel({ videoUrl: url, clips: list.map((c) => ({ id: c.id, start_time: c.start, end_time: c.end })), name: `${kidName}'s highlights` });
      setDoneReel({ storagePath: deriveStoragePath(url) });
    } catch (e: any) { webAlert('Highlight failed', e?.message || 'Something went wrong making the reel.'); }
    finally { setRendering(false); }
  }
  async function download() {
    if (!doneReel) return; setDownloading(true);
    try { const res = await downloadMedia([{ key: doneReel.storagePath, filename: `${kidName} highlights.mp4` }]); webAlert('Saved', res.saved > 0 ? 'Saved to your device.' : 'Could not save it.'); }
    catch (e: any) { webAlert('Download', e?.message || 'Could not save it.'); } finally { setDownloading(false); }
  }

  const Frame = ({ onBack, children }: { onBack?: () => void; children: React.ReactNode }) => (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.wrap}>
        <TouchableOpacity onPress={onBack ?? goBackOrHome} style={styles.back} hitSlop={8}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
        {children}
      </View>
    </View>
  );

  // ---------- terminal states ----------
  if (doneReel) return (
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
  if (rendering) return (
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

  // ---------- REVIEW step ----------
  if (reviewList) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
        <View style={styles.wrap}>
          <TouchableOpacity onPress={() => setReviewList(null)} style={styles.back} hitSlop={8}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
          <Text style={styles.title}>Review clips</Text>
          <Text style={styles.sub}>{"Remove any you don't want, reorder, or shuffle."}</Text>
          <View style={styles.revBar}>
            <Text style={styles.revTally}><Text style={styles.revTallyN}>{reviewList.length} clip{reviewList.length === 1 ? '' : 's'}</Text>{reviewList.length > 0 ? ` · about ${estDuration(reviewList)}` : ''}</Text>
            <TouchableOpacity style={styles.shuffle} onPress={shuffle}><Text style={styles.shuffleTxt}>🔀 Shuffle</Text></TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1, marginTop: 12 }} contentContainerStyle={{ paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
            {reviewList.map((c, i) => {
              const isDup = dupIds.has(c.id); const open = expanded.has(c.id);
              return (
                <Pressable key={c.id} style={[styles.clip, isDup && styles.clipDup, open && styles.clipOpen]} onPress={() => toggleExpand(c.id)}>
                  <Text style={styles.clipNum}>{i + 1}</Text>
                  <View style={styles.thumb}><Text style={styles.thumbPl}>▶</Text></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.clipTags} numberOfLines={1}>{c.summary.join('  ·  ') || 'Highlight'}</Text>
                    <Text style={styles.clipMeta} numberOfLines={1}>{c.gameTitle} · {fmtTime(c.start)}{open ? ' ▾' : ''}</Text>
                    {open && (
                      <View style={styles.detail}>
                        {c.bundles.map((b, bi) => (
                          <View key={bi} style={styles.pchip}>
                            {b.player ? <Text style={styles.pchipName}>{b.player}</Text> : null}
                            <Text style={styles.pchipTxt}>{b.player ? ' · ' : ''}{b.actions.join(' · ')}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                  <View style={styles.ctrls}>
                    <TouchableOpacity style={styles.cbtn} onPress={() => moveClip(i, -1)}><Text style={styles.cbtnTxt}>▲</Text></TouchableOpacity>
                    <TouchableOpacity style={styles.cbtn} onPress={() => moveClip(i, 1)}><Text style={styles.cbtnTxt}>▼</Text></TouchableOpacity>
                    <TouchableOpacity style={[styles.cbtn, styles.cbtnRm]} onPress={() => removeClip(c.id)}><Text style={styles.cbtnRmTxt}>✕</Text></TouchableOpacity>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.foot}>
            <TouchableOpacity style={[styles.primary, { marginTop: 0, marginBottom: 0 }, reviewList.length === 0 && styles.primaryDisabled]} disabled={reviewList.length === 0} onPress={makeIt}>
              <Text style={styles.primaryText}>{reviewList.length === 0 ? 'No clips left' : `Make highlight · ${reviewList.length} clip${reviewList.length === 1 ? '' : 's'}`}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // ---------- pickers ----------
  if (!kidId) return (
    <Frame>
      <Text style={styles.title}>Make a highlight</Text>
      <Text style={styles.sub}>Which child?</Text>
      {userKids.map((k) => (<TouchableOpacity key={k.player_id} style={styles.pickRow} onPress={() => setKidId(k.player_id)}><Text style={styles.pickName}>{k.name}</Text><Text style={styles.chev}>›</Text></TouchableOpacity>))}
      {userKids.length === 0 && <Text style={styles.sub}>{"You don't have any kids linked yet."}</Text>}
    </Frame>
  );
  if (loading) return <Frame><ActivityIndicator color="#2563eb" style={{ marginTop: 40 }} /></Frame>;
  if (clips.length === 0) return (
    <Frame>
      <Text style={styles.title}>{`Make ${kidName}'s highlight`}</Text>
      <View style={styles.empty}><Text style={styles.emptyEmoji}>🎬</Text><Text style={styles.emptyTitle}>No highlights yet</Text>
        <Text style={styles.sub}>{`Once ${kidName}'s coach tags a game with good plays, they'll show up here.`}</Text></View>
    </Frame>
  );
  if (!sportKey) return (
    <Frame>
      <Text style={styles.title}>{`Make ${kidName}'s highlight`}</Text>
      <Text style={styles.sub}>Which sport?</Text>
      {sports.map((s) => (<TouchableOpacity key={s.key} style={styles.pickRow} onPress={() => setSportKey(s.key)}><Text style={styles.pickName}>{sportEmoji(s.key)}  {s.label}</Text><Text style={styles.chev}>›</Text></TouchableOpacity>))}
    </Frame>
  );

  const totalSel = selectedClips.length;
  const starredCount = gameClips.filter((c) => c.starred).length;
  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.wrap}>
        <TouchableOpacity onPress={goBackOrHome} style={styles.back} hitSlop={8}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>{`Make ${kidName}'s highlight`}</Text>

        {sports.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12, flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
            {sports.map((s) => (<TouchableOpacity key={s.key} style={[styles.sp, s.key === sportKey && styles.spOn]} onPress={() => setSportKey(s.key)}><Text style={[styles.spText, s.key === sportKey && styles.spTextOn]}>{sportEmoji(s.key)}  {s.label}</Text></TouchableOpacity>))}
          </ScrollView>
        )}

        <ScrollView style={{ flex: 1, marginTop: 14 }} contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
          <Text style={styles.lbl}>Games</Text>
          {games.map((g) => {
            const on = selectedGames.has(g.id);
            return (
              <Pressable key={g.id} style={[styles.row, on && styles.rowOn]} onPress={() => setSelectedGames((prev) => { const n = new Set(prev); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })}>
                <View style={[styles.check, on && styles.checkOn]}>{on ? <Text style={styles.checkMark}>✓</Text> : null}</View>
                <View style={{ flex: 1 }}><Text style={styles.rowTitle} numberOfLines={1}>{g.title}</Text><Text style={styles.rowMeta}>{fmtDate(g.date)}{g.date ? ' · ' : ''}{g.count} highlight{g.count === 1 ? '' : 's'}</Text></View>
              </Pressable>
            );
          })}

          <Text style={[styles.lbl, { marginTop: 20 }]}>Quick picks · works for any sport</Text>
          <View style={styles.quick}>
            <QP on={preset === 'highlights'} icon="⭐" name="Highlights" desc={`Coach's starred · ${starredCount}`} onPress={() => applyPreset('highlights')} />
            <QP on={preset === 'all'} icon="🏀" name="All best plays" desc={`Every good clip · ${gameClips.length}`} onPress={() => applyPreset('all')} />
            <QP on={preset === 'scoring'} icon="🎯" name="Scoring" desc="Made plays" onPress={() => applyPreset('scoring')} />
            <QP on={preset === 'defense'} icon="🛡️" name="Defense & hustle" desc="Steals · blocks · boards" onPress={() => applyPreset('defense')} />
          </View>

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
          <View style={styles.tally}><Text style={styles.tallyN}>{totalSel} clip{totalSel === 1 ? '' : 's'}</Text>{totalSel > 0 && <Text style={styles.tallyT}>· about {estDuration(selectedClips)}</Text>}</View>
          <TouchableOpacity style={[styles.primary, { marginTop: 0, marginBottom: 0 }, totalSel === 0 && styles.primaryDisabled]} disabled={totalSel === 0} onPress={enterReview}>
            <Text style={styles.primaryText}>{totalSel === 0 ? 'Pick some plays' : 'Next: review clips'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function QP({ on, icon, name, desc, onPress }: { on: boolean; icon: string; name: string; desc: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={[qp.card, on && qp.cardOn]} onPress={onPress} activeOpacity={0.85}>
      <Text style={qp.ic}>{icon}</Text><Text style={qp.nm}>{name}</Text><Text style={[qp.ds, on && qp.dsOn]}>{desc}</Text>
    </TouchableOpacity>
  );
}
function catColor(cat: string): string { if (cat === 'defense') return '#f0917f'; if (cat === 'plays') return '#79dca0'; if (cat === 'players') return '#d7b0f5'; return '#5aa0ff'; }

const qp = StyleSheet.create({
  card: { width: '48%', backgroundColor: '#12202e', borderWidth: 1.5, borderColor: '#22384c', borderRadius: 14, padding: 13 },
  cardOn: { borderColor: '#2f6ae0', backgroundColor: '#14273f' },
  ic: { fontSize: 22 }, nm: { color: '#f1f4f6', fontSize: 14.5, fontWeight: '700', marginTop: 7, letterSpacing: -0.2 },
  ds: { color: '#8b96a3', fontSize: 11.5, marginTop: 2 }, dsOn: { color: '#a9c4e8' },
});
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b1220', paddingHorizontal: 20 },
  wrap: { flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center' },
  back: { paddingVertical: 8 }, backText: { color: '#6ea8ff', fontSize: 16, fontWeight: '600' },
  title: { color: '#f1f4f6', fontSize: 24, fontWeight: '800', letterSpacing: -0.4, marginTop: 4 },
  sub: { color: '#8b96a3', fontSize: 14, lineHeight: 20, marginTop: 8 },
  tiny: { color: '#5b6b7c', fontSize: 12, marginTop: 10 },
  big: { fontSize: 44, marginTop: 30 },
  lbl: { color: '#5b6b7c', fontSize: 11, fontWeight: '800', letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 10, marginLeft: 2 },

  pickRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#12202e', borderColor: '#22384c', borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 16, marginTop: 12 },
  pickName: { color: '#f1f4f6', fontSize: 16, fontWeight: '600' }, chev: { color: '#5b6b7c', fontSize: 22 },

  sp: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, backgroundColor: '#12202e', borderWidth: 1.5, borderColor: '#22384c' },
  spOn: { backgroundColor: '#14273f', borderColor: '#2f6ae0' }, spText: { color: '#8b96a3', fontSize: 13, fontWeight: '700' }, spTextOn: { color: '#fff' },

  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20, marginBottom: 14 },
  ln: { flex: 1, height: 1, backgroundColor: '#22384c' }, divTxt: { color: '#5b6b7c', fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  gh: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8, marginLeft: 2 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#12202e', borderColor: '#22384c', borderWidth: 1, borderRadius: 11, padding: 12, marginBottom: 7 },
  rowOn: { borderColor: '#2f6ae0', backgroundColor: '#14273f' },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#3a5068', alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: '#2563eb', borderColor: '#2563eb' }, checkMark: { color: '#fff', fontSize: 13, fontWeight: '900' },
  rowTitle: { flex: 1, color: '#f1f4f6', fontSize: 14.5, fontWeight: '600' }, rowMeta: { color: '#8b96a3', fontSize: 12.5, marginTop: 2 },
  countPill: { backgroundColor: '#0c1a28', borderColor: '#22384c', borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 }, countTxt: { color: '#8b96a3', fontSize: 12, fontWeight: '700' },

  // review
  revBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 13 },
  revTally: { color: '#8b96a3', fontSize: 13 }, revTallyN: { color: '#f1f4f6', fontWeight: '800', fontSize: 15 },
  shuffle: { backgroundColor: '#12202e', borderWidth: 1.5, borderColor: '#2f6ae0', borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 }, shuffleTxt: { color: '#bcd6ff', fontSize: 12.5, fontWeight: '700' },
  clip: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#12202e', borderWidth: 1, borderColor: '#22384c', borderRadius: 9, padding: 7, marginBottom: 6 },
  clipDup: { borderColor: '#ff9f43', backgroundColor: '#1c1810' },
  clipOpen: { alignItems: 'flex-start', borderColor: '#2f6ae0' },
  clipNum: { width: 18, textAlign: 'center', fontSize: 12, fontWeight: '700', color: '#5b6b7c' },
  thumb: { width: 44, height: 31, borderRadius: 6, backgroundColor: '#16283a', alignItems: 'center', justifyContent: 'center' }, thumbPl: { color: '#fff', opacity: 0.8, fontSize: 12 },
  clipTags: { color: '#f1f4f6', fontSize: 11.5, fontWeight: '600' }, clipMeta: { color: '#8b96a3', fontSize: 11, marginTop: 1 },
  detail: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 7 },
  pchip: { flexDirection: 'row', backgroundColor: '#0c1a28', borderWidth: 1, borderColor: '#22384c', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  pchipName: { color: '#fff', fontSize: 10.5, fontWeight: '800' }, pchipTxt: { color: '#cfe0f2', fontSize: 10.5, fontWeight: '600' },
  ctrls: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cbtn: { width: 27, height: 27, borderRadius: 7, backgroundColor: '#0c1a28', borderWidth: 1, borderColor: '#22384c', alignItems: 'center', justifyContent: 'center' }, cbtnTxt: { color: '#9fb3c7', fontSize: 11 },
  cbtnRm: { backgroundColor: '#241318', borderColor: '#5a2730' }, cbtnRmTxt: { color: '#ff8b8b', fontSize: 13 },

  foot: { paddingTop: 12, borderTopWidth: 1, borderTopColor: '#22384c' },
  tally: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 8, marginBottom: 10 }, tallyN: { color: '#f1f4f6', fontSize: 18, fontWeight: '800' }, tallyT: { color: '#8b96a3', fontSize: 13 },
  primary: { backgroundColor: '#2563eb', borderRadius: 13, paddingVertical: 15, alignItems: 'center', marginTop: 14, marginBottom: 20 }, primaryDisabled: { backgroundColor: '#1c2f47' }, primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  ghost: { paddingVertical: 14, alignItems: 'center', marginTop: 4 }, ghostText: { color: '#8b96a3', fontSize: 15, fontWeight: '600' },
  progressWrap: { alignItems: 'center', marginTop: 50, gap: 10 }, progressPct: { color: '#f1f4f6', fontSize: 30, fontWeight: '800', marginTop: 8 },
  empty: { alignItems: 'center', marginTop: 50, gap: 6 }, emptyEmoji: { fontSize: 40 }, emptyTitle: { color: '#f1f4f6', fontSize: 18, fontWeight: '700' },
});

// /my-playbook — the coach's PERSONAL library (cross-team). Create plays here
// (the editor saves here), then Attach them to any team you coach. Plays live
// with you, independent of any team; attaching drops an independent copy on the
// team (diagram + tags, never film).

import PlayPlayer from '@/components/PlayPlayer';
import { useTeamContext } from '@/context';
import { fetchCoachTeams, type CoachTeam } from '@/lib/core/playbook/installs';
import { attachToTeam, deleteLibraryPlay, fetchLibraryPlays, type LibraryPlay } from '@/lib/core/playbook/library';
import { tagColor } from '@/lib/core/playbook/tags';
import { goBackOrHome } from '@/lib/nav';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import WebTopNav from './components/WebTopNav';

export default function MyPlaybook() {
  const { userId } = useTeamContext();
  const [plays, setPlays] = useState<LibraryPlay[] | null>(null);
  const [teams, setTeams] = useState<CoachTeam[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [attachFor, setAttachFor] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<string | null>(null);
  const [sportFilter, setSportFilter] = useState<string>('all');
  const [sideFilter, setSideFilter] = useState<string>('all');

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    fetchLibraryPlays(userId).then(p => { if (alive) setPlays(p); }).catch(e => { if (alive) setErr(e?.message ?? String(e)); });
    fetchCoachTeams(userId).then(t => { if (alive) setTeams(t); }).catch(() => {});
    return () => { alive = false; };
  }, [userId]);

  async function attach(play: LibraryPlay, team: CoachTeam) {
    if (!play.doc || !userId) return;
    const key = play.id + ':' + team.id;
    setBusyKey(key); setErr(null);
    try {
      await attachToTeam({ libraryPlayId: play.id, doc: play.doc, tags: play.tags, teamId: team.id, userId });
      setDone(d => ({ ...d, [play.id]: `Attached to ${team.name}` }));
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusyKey(null); }
  }

  async function del(p: LibraryPlay) {
    const label = p.doc?.name ?? p.name;
    if (Platform.OS === 'web' && !window.confirm(`Delete “${label}” from My Playbook?\n\nTeams you've already attached it to keep their own copy.`)) return;
    try { await deleteLibraryPlay(p.id); setPlays(list => (list ?? []).filter(x => x.id !== p.id)); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
  }

  // Sport / side present across the library (drive which filters to show).
  const sportsPresent = plays ? Array.from(new Set(plays.map(p => p.doc?.sport).filter(Boolean) as string[])).sort() : [];
  const sidesPresent: string[] = plays ? Array.from(new Set(plays.map(p => (p.doc?.side ?? 'offense') as string))) : [];
  const SIDE_ORDER = ['offense', 'defense', 'special_teams'];
  const sideLabel = (s: string) => s === 'offense' ? 'Offense' : s === 'defense' ? 'Defense' : 'Special Teams';
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  // Apply sport + side first, so the tag chips reflect what's visible.
  const scoped = plays ? plays.filter(p =>
    (sportFilter === 'all' || p.doc?.sport === sportFilter) &&
    (sideFilter === 'all' || (p.doc?.side ?? 'offense') === sideFilter),
  ) : [];
  const allTags = Array.from(new Set(scoped.flatMap(p => p.tags))).sort();
  const filtered = filter ? scoped.filter(p => p.tags.includes(filter)) : scoped;

  return (
    <View style={styles.root}>
      {Platform.OS === 'web' ? <WebTopNav /> : null}
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Pressable onPress={() => goBackOrHome()} hitSlop={8} style={styles.back}><Text style={styles.backTxt}>← Back</Text></Pressable>
        <Text style={styles.eyebrow}>MY PLAYBOOK</Text>
        <Text style={styles.h1}>Your plays</Text>
        <Text style={styles.sub}>Your personal library — these belong to you, across every team you coach. Attach any of them to a team to teach it.</Text>

        <Pressable style={styles.newBtn} onPress={() => router.push('/playbook-edit')}>
          <Text style={styles.newBtnTxt}>＋  New play</Text>
        </Pressable>

        {plays && sportsPresent.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowInner}>
            <Pressable onPress={() => setSportFilter('all')} style={[styles.chip, sportFilter === 'all' && styles.chipOn]}>
              <Text style={[styles.chipTxt, sportFilter === 'all' && styles.chipTxtOn]}>All sports</Text>
            </Pressable>
            {sportsPresent.map(s => (
              <Pressable key={s} onPress={() => setSportFilter(f => (f === s ? 'all' : s))} style={[styles.chip, sportFilter === s && styles.chipOn]}>
                <Text style={[styles.chipTxt, sportFilter === s && styles.chipTxtOn]}>{cap(s)}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {plays && sidesPresent.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowInner}>
            <Pressable onPress={() => setSideFilter('all')} style={[styles.chip, sideFilter === 'all' && styles.chipOn]}>
              <Text style={[styles.chipTxt, sideFilter === 'all' && styles.chipTxtOn]}>All sides</Text>
            </Pressable>
            {SIDE_ORDER.filter(s => sidesPresent.includes(s)).map(s => (
              <Pressable key={s} onPress={() => setSideFilter(f => (f === s ? 'all' : s))} style={[styles.chip, sideFilter === s && styles.chipOn]}>
                <Text style={[styles.chipTxt, sideFilter === s && styles.chipTxtOn]}>{sideLabel(s)}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {plays && allTags.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowInner}>
            <Pressable onPress={() => setFilter(null)} style={[styles.chip, !filter && styles.chipOn]}>
              <Text style={[styles.chipTxt, !filter && styles.chipTxtOn]}>All ({scoped.length})</Text>
            </Pressable>
            {allTags.map(t => (
              <Pressable key={t} onPress={() => setFilter(f => (f === t ? null : t))} style={[styles.chip, filter === t && styles.chipOn]}>
                <View style={[styles.tagDot, { backgroundColor: tagColor(t) }]} />
                <Text style={[styles.chipTxt, filter === t && styles.chipTxtOn]}>{t}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {err ? <View style={styles.errBox}><Text style={styles.errTxt}>{err}</Text></View> : null}
        {plays === null ? (
          <ActivityIndicator color="#ff6a2c" style={{ marginTop: 30 }} />
        ) : plays.length === 0 ? (
          <Text style={styles.empty}>No plays yet. Tap “＋ New play” to draw your first — it’ll live here, ready to attach to any team.</Text>
        ) : filtered.length === 0 ? (
          <Text style={styles.empty}>No plays tagged “{filter}”.</Text>
        ) : (
          <View style={styles.grid}>
            {filtered.map((p, i) => (
              <View key={p.id} style={[styles.card, styles.gridCard]}>
                <Text style={styles.name}>{p.doc?.name ?? p.name ?? `Play ${i + 1}`}</Text>
                {p.tags.length > 0 ? (
                  <View style={styles.tagWrap}>
                    {p.tags.map(t => (
                      <Pressable key={t} onPress={() => setFilter(t)} style={[styles.tagChip, { borderColor: tagColor(t) }]}>
                        <View style={[styles.tagDot, { backgroundColor: tagColor(t) }]} /><Text style={styles.tagChipTxt}>{t}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                {p.doc ? <PlayPlayer doc={p.doc} /> : <Text style={styles.missing}>Couldn’t load.</Text>}

                {teams.length > 0 ? (
                  <View style={styles.attachBox}>
                    <Pressable onPress={() => setAttachFor(f => (f === p.id ? null : p.id))}>
                      <Text style={styles.attachToggle}>📎  Attach to team  {attachFor === p.id ? '▲' : '▼'}</Text>
                    </Pressable>
                    {attachFor === p.id ? (
                      <View style={styles.attachTeams}>
                        {teams.map(t => (
                          <Pressable key={t.id} style={styles.attachTeamBtn} onPress={() => attach(p, t)} disabled={busyKey === p.id + ':' + t.id}>
                            <Text style={styles.attachTeamTxt}>{busyKey === p.id + ':' + t.id ? '…' : `→ ${t.name}`}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                    {done[p.id] ? <Text style={styles.doneTxt}>✓ {done[p.id]}</Text> : null}
                  </View>
                ) : null}

                <View style={styles.cardActions}>
                  <Pressable onPress={() => router.push({ pathname: '/playbook-edit', params: { editId: p.id } })}><Text style={styles.editLink}>✎ Edit</Text></Pressable>
                  <Pressable onPress={() => del(p)}><Text style={styles.deleteLink}>Delete</Text></Pressable>
                </View>
              </View>
            ))}
          </View>
        )}
        <View style={{ height: 50 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e1b2c' },
  screen: { flex: 1, backgroundColor: '#0e1b2c' },
  content: { padding: 20, maxWidth: 1120, width: '100%', alignSelf: 'center' },
  back: { alignSelf: 'flex-start', paddingVertical: 6 },
  backTxt: { color: '#ff6a2c', fontSize: 14, fontWeight: '700' },
  eyebrow: { color: '#ff6a2c', fontSize: 12, fontWeight: '800', letterSpacing: 1.6, marginTop: 8 },
  h1: { color: '#f1f4f6', fontSize: 28, fontWeight: '800', letterSpacing: -0.5, marginTop: 6 },
  sub: { color: '#9db0bd', fontSize: 14, marginTop: 6, marginBottom: 14, lineHeight: 20 },
  newBtn: { alignSelf: 'flex-start', backgroundColor: '#ff6a2c', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, marginBottom: 10 },
  newBtnTxt: { color: '#160b02', fontSize: 14, fontWeight: '800' },
  chipRow: { marginBottom: 6 },
  chipRowInner: { gap: 8, paddingRight: 20, paddingVertical: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: '#ff6a2c', borderColor: '#ff6a2c' },
  chipTxt: { color: '#c7d2dc', fontSize: 13, fontWeight: '700' },
  chipTxtOn: { color: '#160b02' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  gridCard: { flexBasis: '30%', flexGrow: 1, minWidth: 250, maxWidth: 380, marginTop: 0 },
  card: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 16, padding: 16, gap: 10 },
  name: { color: '#f1f4f6', fontSize: 16, fontWeight: '700' },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tagChip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  tagDot: { width: 7, height: 7, borderRadius: 4 },
  tagChipTxt: { color: '#c7d2dc', fontSize: 11.5, fontWeight: '700' },
  missing: { color: '#ffb4a8', fontSize: 13.5 },
  attachBox: { borderTopColor: '#25333f', borderTopWidth: 1, paddingTop: 10, gap: 8 },
  attachToggle: { color: '#ff6a2c', fontSize: 13.5, fontWeight: '800' },
  attachTeams: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  attachTeamBtn: { backgroundColor: '#0e1b2c', borderColor: '#534AB7', borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  attachTeamTxt: { color: '#c7d2dc', fontSize: 13, fontWeight: '700' },
  doneTxt: { color: '#3ec48c', fontSize: 13, fontWeight: '700' },
  cardActions: { flexDirection: 'row', justifyContent: 'space-between', borderTopColor: '#25333f', borderTopWidth: 1, paddingTop: 10 },
  editLink: { color: '#ff6a2c', fontSize: 13.5, fontWeight: '800' },
  deleteLink: { color: '#c0392b', fontSize: 13.5, fontWeight: '700' },
  empty: { color: '#9db0bd', fontSize: 14, marginTop: 20, lineHeight: 20 },
  errBox: { backgroundColor: '#2a1416', borderColor: '#5c2a2a', borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 12 },
  errTxt: { color: '#ffb4a8', fontSize: 13.5, lineHeight: 19 },
});

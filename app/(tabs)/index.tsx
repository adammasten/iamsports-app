import { useTeamContext } from '@/context';
import { supabase } from '@/supabase';
import DateTimePicker, { DateTimePickerAndroid, DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { loadTeamWall, type WallPost } from '@/lib/core/homeFeed';
import ContentTypeBadge from '../components/ContentTypeBadge';
import { type DropdownOption } from '../components/Dropdown';
import FilterBar, { type FilterableItem } from '../components/FilterBar';

// Extract local YYYY-MM-DD from a Date. Never use .toISOString() — that
// converts via UTC and shifts the date by a day for users west of UTC.
function dateToLocalYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDate(ymd: string | null): string {
  if (!ymd) return 'No date set';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

// Home feed filter/sort. TYPE/SORT are static; the Team dropdown options are
// derived from the teams actually present in the merged feed (see teamOptions).
const TYPE_OPTIONS: DropdownOption[] = [
  { value: 'all', label: 'All' },
  { value: 'reel', label: 'Reels' },
  { value: 'game', label: 'Games' },
  { value: 'clip', label: 'Clips' },
];
const SORT_OPTIONS: DropdownOption[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'az', label: 'A–Z' },
];

// The feed's data model (WallPost) and the merge/dedup logic live in
// @/lib/core/homeFeed — the SINGLE source of truth, shared with the app-home
// screen (select-team.tsx). This screen only renders + filters the result.

export default function HomeScreen() {
  const { activeTeam } = useTeamContext();

  // Games manager (create + open existing to add film) — behind the New Game button.
  const [games, setGames] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [opponent, setOpponent] = useState('');
  const [gameDate, setGameDate] = useState<Date>(new Date());

  // This is a TEAM page: the feed shows ONLY the active team's own wall (its
  // team-audience shares). The merged cross-team/cross-kid feed lives on the
  // app-home screen (select-team.tsx). Both use @/lib/core/homeFeed.
  const [posts, setPosts] = useState<WallPost[]>([]);
  const [wallLoading, setWallLoading] = useState(true);
  const [visiblePosts, setVisiblePosts] = useState<FilterableItem[]>([]);

  // TEMP diagnostic panel (verify-on-device, remove after). Surfaces per-stage
  // COUNTS *and* the previously-swallowed Postgres errors — a blank feed is
  // otherwise indistinguishable from an errored one. This is the error-visibility
  // fix in miniature: if Query 1 hits an RLS/recursion error, you SEE it here
  // instead of a blank screen.
  const [debug, setDebug] = useState<{
    q1Rows: number; q1Err: string | null;
    q2Rows: number; q2Err: string | null;
    ptErr: string | null; final: number;
  } | null>(null);

  // Batch-loaded tag data for the feed: each post's tag set (by contentId) and
  // tag metadata (id → name/category). Three queries total, no N+1 (see effect).
  const [tagsByContentId, setTagsByContentId] = useState<Map<string, Set<string>>>(new Map());
  const [tagMeta, setTagMeta] = useState<Map<string, { name: string; category: string }>>(new Map());

  // Team page: the wall + games both reload when the active team changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadHome(); }, [activeTeam]);
  useEffect(() => {
    if (activeTeam) fetchGames(activeTeam.id);
    else setGames([]);
  }, [activeTeam]);

  // Batch-load tags for the whole wall whenever posts change. Bucket content ids
  // by type (reel → reel_tags, clip → clip_tags; game/video have no tags), load
  // each join table with ONE .in() query, then resolve all tag ids → name/category
  // in one more. Builds tagsByContentId (contentId → Set<tag_id>) + tagMeta. No N+1.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const reelIds = posts.filter(p => p.contentType === 'reel').map(p => p.contentId);
      const clipIds = posts.filter(p => p.contentType === 'clip').map(p => p.contentId);

      const byContent = new Map<string, Set<string>>();
      const allTagIds = new Set<string>();
      const add = (cid: string, tid: string) => {
        const s = byContent.get(cid) ?? new Set<string>();
        s.add(tid);
        byContent.set(cid, s);
        allTagIds.add(tid);
      };

      if (reelIds.length > 0) {
        const { data } = await supabase.from('reel_tags').select('reel_id, tag_id').in('reel_id', reelIds);
        (data || []).forEach((r: any) => add(r.reel_id, r.tag_id));
      }
      if (clipIds.length > 0) {
        const { data } = await supabase.from('clip_tags').select('clip_id, tag_id').in('clip_id', clipIds);
        (data || []).forEach((r: any) => add(r.clip_id, r.tag_id));
      }

      const meta = new Map<string, { name: string; category: string }>();
      if (allTagIds.size > 0) {
        const { data } = await supabase.from('tags').select('id, name, category').in('id', [...allTagIds]);
        (data || []).forEach((t: any) => meta.set(t.id, { name: t.name, category: t.category }));
      }

      if (cancelled) return;
      setTagsByContentId(byContent);
      setTagMeta(meta);
    })();
    return () => { cancelled = true; };
  }, [posts]);

  async function fetchGames(teamId: string) {
    const { data } = await supabase
      .from('games').select('*').eq('team_id', teamId)
      .order('game_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    setGames(data || []);
  }

  async function loadHome() {
    if (!activeTeam) { setPosts([]); setDebug(null); setWallLoading(false); return; }
    setWallLoading(true);
    // ONLY this team's own wall — scoped in @/lib/core/homeFeed (single source of
    // truth). No merge; the merged cross-team feed is the app-home screen's job.
    const { posts: wall, debug: dbg } = await loadTeamWall(activeTeam.id);
    setDebug(dbg);
    setPosts(wall);
    setWallLoading(false);
  }

  const items = useMemo<FilterableItem[]>(
    () => posts.map(p => ({
      id: p.key,
      teamId: p.teamId,
      teamName: p.teamName || 'Family',
      contentType: p.contentType === 'video' ? 'game' : p.contentType,
      title: p.title,
      createdAt: p.createdAt,
    })),
    [posts],
  );
  // Team dropdown options derived from the teams actually in the feed (+ "All").
  // FilterBar hides the dropdown when there's ≤1 team, so a single-team user sees
  // no Team filter, and a multi-team coach/parent does.
  const teamOptions = useMemo<DropdownOption[]>(() => {
    const seen = new Map<string, string>();
    posts.forEach(p => { if (p.teamId) seen.set(p.teamId, p.teamName); });
    return [{ value: 'all', label: 'All' }, ...[...seen].map(([value, label]) => ({ value, label }))];
  }, [posts]);
  // tagsByContentId is re-keyed by the item key (contentType:contentId) so each
  // item's tag set lines up with its FilterBar item.
  const tagsById = useMemo(
    () => new Map(posts.map(p => [p.key, tagsByContentId.get(p.contentId) ?? new Set<string>()])),
    [posts, tagsByContentId],
  );
  const postsById = useMemo(() => new Map(posts.map(p => [p.key, p])), [posts]);

  function openShared(item: WallPost) {
    if (item.contentType === 'game') {
      router.push({ pathname: '/shared-game', params: { shareId: item.shareId, title: item.title } });
      return;
    }
    if (!item.storagePath) { Alert.alert('Unavailable', 'This content could not be loaded.'); return; }
    router.push({
      pathname: '/shared-viewer',
      params: {
        title: item.title, storagePath: item.storagePath,
        startTime: item.startTime != null ? String(item.startTime) : '',
        endTime: item.endTime != null ? String(item.endTime) : '',
      },
    });
  }

  function toggleForm() {
    if (!showForm) setGameDate(new Date());
    setShowForm(!showForm);
  }
  function onDateChange(_: DateTimePickerEvent, selected?: Date) { if (selected) setGameDate(selected); }
  function openAndroidPicker() {
    DateTimePickerAndroid.open({ value: gameDate, mode: 'date', onChange: onDateChange });
  }

  async function createGame() {
    if (!opponent.trim()) { Alert.alert('Enter an opponent'); return; }
    if (!activeTeam) { Alert.alert('No team selected'); return; }
    const { data, error } = await supabase
      .from('games')
      .insert({ title: `vs ${opponent.trim()}`, opponent: opponent.trim(), game_date: dateToLocalYMD(gameDate), team_id: activeTeam.id })
      .select('id, title')
      .single();
    if (error) { Alert.alert('Error', error.message); return; }
    setShowForm(false);
    setOpponent('');
    setGameDate(new Date());
    fetchGames(activeTeam.id);
    // Straight into the new game to add film.
    if (data?.id) router.push({ pathname: '/game', params: { id: data.id, title: data.title } });
  }

  function deleteGame(id: string, title: string) {
    Alert.alert('Delete game', `Delete “${title}”? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('games').delete().eq('id', id);
        if (error) Alert.alert('Error', error.message);
        else if (activeTeam) fetchGames(activeTeam.id);
      }},
    ]);
  }

  async function signOut() { await supabase.auth.signOut(); }

  // TEMP diagnostic — rendered in BOTH the no-team gate and the feed so the
  // numbers show regardless of whether activeTeam resolved. Remove after verify.
  const debugPanel = __DEV__ && debug ? (
    <View style={styles.debugBox}>
      <Text style={styles.debugTitle}>▶ SCREEN: (tabs)/index.tsx — TEAM page ({activeTeam?.name ?? '—'})</Text>
      <Text style={styles.debugText}>team wall rows: {debug.q1Rows}{debug.q1Err ? `  ⛔ ${debug.q1Err}` : ''}</Text>
      <Text style={styles.debugText}>final after dedup: {debug.final}</Text>
    </View>
  ) : null;

  if (!activeTeam) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <View />
          <TouchableOpacity onPress={signOut}><Text style={styles.signOut}>Sign out</Text></TouchableOpacity>
        </View>
        {debugPanel}
        <Text style={styles.heading}>No team selected</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/select-team')}>
          <Text style={styles.primaryBtnText}>Pick a team</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/select-team')}>
          <Text style={styles.switchBtn}>← Switch team</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={signOut}><Text style={styles.signOut}>Sign out</Text></TouchableOpacity>
      </View>

      <Text style={styles.heading} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{activeTeam.name}</Text>

      {debugPanel}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.smallBtn} onPress={toggleForm}>
          <Text style={styles.smallBtnText}>{showForm ? 'Cancel' : '+ New Game'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.smallBtn, styles.smallBtnAlt]} onPress={() => router.push('/export')}>
          <Text style={styles.smallBtnText}>Export</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.subtitle}>This team’s wall.</Text>

      {showForm ? (
        // Games manager: create a game, or open an existing one to add film.
        <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
          <View style={styles.form}>
            <Text style={styles.formTeam}>New game for {activeTeam.name}</Text>
            <TextInput
              style={styles.input}
              placeholder="Opponent name"
              placeholderTextColor="#666"
              value={opponent}
              onChangeText={setOpponent}
              autoFocus
            />
            <View style={styles.dateRow}>
              <Text style={styles.dateLabel}>Game date:</Text>
              {Platform.OS === 'ios' ? (
                <DateTimePicker value={gameDate} mode="date" display="compact" themeVariant="dark" onChange={onDateChange} />
              ) : (
                <TouchableOpacity style={styles.dateBtn} onPress={openAndroidPicker}>
                  <Text style={styles.dateBtnText}>{formatDate(dateToLocalYMD(gameDate))}</Text>
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity style={styles.saveBtn} onPress={createGame}>
              <Text style={styles.saveBtnText}>Save &amp; add film</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionLabel}>Your games — tap to add film</Text>
          {games.length === 0 ? (
            <Text style={styles.empty}>No games yet.</Text>
          ) : (
            games.map(g => (
              <TouchableOpacity
                key={g.id}
                style={styles.gameCard}
                onPress={() => router.push({ pathname: '/game', params: { id: g.id, title: g.title } })}
                onLongPress={() => deleteGame(g.id, g.title)}
              >
                <Text style={styles.gameTitle} numberOfLines={1}>{g.title}</Text>
                <Text style={styles.gameDate}>{formatDate(g.game_date)}</Text>
                <Text style={styles.hint}>Tap to open · Hold to delete</Text>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      ) : (
        // The Home feed — the main view.
        <>
          <FilterBar
            items={items}
            tagsById={tagsById}
            tagMeta={tagMeta}
            teamOptions={teamOptions}
            typeOptions={TYPE_OPTIONS}
            sortOptions={SORT_OPTIONS}
            searchPlaceholder="Search"
            onVisibleChange={setVisiblePosts}
          />

          <View style={[styles.content, visiblePosts.length > 0 && styles.contentTop]}>
            {wallLoading ? (
              <ActivityIndicator size="large" color="#534AB7" />
            ) : posts.length === 0 ? (
              <Text style={styles.empty}>Nothing on this team’s wall yet.{'\n'}Post games or reels from Film Room.</Text>
            ) : visiblePosts.length === 0 ? (
              <Text style={styles.empty}>Nothing matches your filters.</Text>
            ) : (
              <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 20 }}>
                {visiblePosts.map(fi => {
                  const item = postsById.get(fi.id);
                  if (!item) return null;
                  // Show the wall labels this content lives on, teams before Family.
                  const sources = [...item.sources].sort((a, b) => (a === 'Family' ? 1 : 0) - (b === 'Family' ? 1 : 0));
                  return (
                    <TouchableOpacity key={item.key} style={styles.card} onPress={() => openShared(item)}>
                      <View style={styles.cardTop}>
                        <ContentTypeBadge type={item.contentType} />
                        {sources.map(s => (
                          <Text key={s} style={styles.sourcePill} numberOfLines={1}>{s}</Text>
                        ))}
                      </View>
                      <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                      <Text style={styles.cardMeta}>{new Date(item.createdAt).toLocaleDateString()}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 60, backgroundColor: '#000' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  switchBtn: { color: '#534AB7', fontSize: 14, fontWeight: '600' },
  signOut: { color: '#888', fontSize: 14 },

  heading: { color: '#fff', fontSize: 28, fontWeight: '700', letterSpacing: -0.3 },

  // TEMP diagnostic panel — remove after on-device verify.
  debugBox: { backgroundColor: '#3a2f00', borderColor: '#c8a400', borderWidth: 1, borderRadius: 8, padding: 10, marginVertical: 10, gap: 2 },
  debugTitle: { color: '#ffd11a', fontSize: 12, fontWeight: '800', marginBottom: 4, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  debugText: { color: '#ffe680', fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  actions: { flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 12, marginBottom: 10 },
  subtitle: { color: '#888', fontSize: 13, lineHeight: 18, textAlign: 'center', marginBottom: 14 },
  smallBtn: { backgroundColor: '#534AB7', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  smallBtnAlt: { backgroundColor: '#1D9E75' },
  smallBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  primaryBtn: { backgroundColor: '#534AB7', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 16 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  contentTop: { alignItems: 'stretch', justifyContent: 'flex-start' },
  empty: { color: '#555', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  list: { alignSelf: 'stretch', flex: 1 },

  // wall cards
  card: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#333' },
  typeBadgeWrap: { marginBottom: 6 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' },
  sourcePill: {
    color: '#ddd', fontSize: 11, fontWeight: '700',
    backgroundColor: '#2a2740', borderColor: '#534AB7', borderWidth: 1,
    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, maxWidth: 160,
  },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  cardMeta: { color: '#888', fontSize: 12, marginTop: 4 },

  // games manager
  form: { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#333' },
  formTeam: { color: '#888', fontSize: 12, fontWeight: '600', marginBottom: 10 },
  input: { backgroundColor: '#0d0d0d', borderRadius: 8, padding: 12, marginBottom: 10, fontSize: 16, color: '#fff', borderWidth: 1, borderColor: '#333' },
  dateRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 10 },
  dateLabel: { fontSize: 15, color: '#aaa' },
  dateBtn: { backgroundColor: '#0d0d0d', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#333', flex: 1 },
  dateBtnText: { fontSize: 16, color: '#fff' },
  saveBtn: { backgroundColor: '#534AB7', borderRadius: 8, padding: 14, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  sectionLabel: { color: '#888', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  gameCard: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#333' },
  gameTitle: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 3 },
  gameDate: { color: '#888', fontSize: 12, marginBottom: 3 },
  hint: { color: '#555', fontSize: 11 },
});

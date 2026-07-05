import { useTeamContext } from '@/context';
import { supabase } from '@/supabase';
import DateTimePicker, { DateTimePickerAndroid, DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
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

// Team wall filter/sort — tags batch-loaded (parity with Coaches' Corner), Team
// dropdown hidden (single team → one-element TEAM_OPTIONS).
const TEAM_OPTIONS: DropdownOption[] = [{ value: 'all', label: 'All' }];
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

type WallPost = {
  shareId: string; contentType: string; contentId: string; createdAt: string;
  title: string; storagePath: string | null;
  startTime: number | null; endTime: number | null;
};

export default function HomeScreen() {
  const { activeTeam } = useTeamContext();

  // Games manager (create + open existing to add film) — behind the New Game button.
  const [games, setGames] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [opponent, setOpponent] = useState('');
  const [gameDate, setGameDate] = useState<Date>(new Date());

  // Team wall (the main view): team-audience shares for this team.
  const [posts, setPosts] = useState<WallPost[]>([]);
  const [wallLoading, setWallLoading] = useState(true);
  const [visiblePosts, setVisiblePosts] = useState<FilterableItem[]>([]);

  // Batch-loaded tag data for the wall: each post's tag set (by contentId) and
  // tag metadata (id → name/category). Three queries total, no N+1 (see effect).
  const [tagsByContentId, setTagsByContentId] = useState<Map<string, Set<string>>>(new Map());
  const [tagMeta, setTagMeta] = useState<Map<string, { name: string; category: string }>>(new Map());

  useEffect(() => {
    if (activeTeam) {
      fetchGames(activeTeam.id);
      loadTeamWall(activeTeam.id);
    } else {
      setGames([]); setPosts([]); setWallLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  async function loadTeamWall(teamId: string) {
    setWallLoading(true);
    const { data: rows } = await supabase
      .from('shares').select('id, content_type, content_id, created_at')
      .eq('team_id', teamId).eq('audience', 'team')
      .order('created_at', { ascending: false });
    const items = await Promise.all((rows || []).map(async (r: any) => {
      const { data: resolved } = await supabase.rpc('resolve_shared_content', { p_share_id: r.id });
      const c = Array.isArray(resolved) ? resolved[0] : null;
      return {
        shareId: r.id, contentType: r.content_type, contentId: r.content_id, createdAt: r.created_at,
        title: c?.title ?? (r.content_type === 'game' ? 'Shared game' : '(content unavailable)'),
        storagePath: c?.storage_path ?? null,
        startTime: c?.start_time ?? null, endTime: c?.end_time ?? null,
      };
    }));
    setPosts(items);
    setWallLoading(false);
  }

  const items = useMemo<FilterableItem[]>(
    () => posts.map(p => ({
      id: p.shareId,
      teamId: activeTeam?.id ?? '',
      teamName: activeTeam?.name ?? 'Team',
      contentType: p.contentType === 'video' ? 'game' : p.contentType,
      title: p.title,
      createdAt: p.createdAt,
    })),
    [posts, activeTeam],
  );
  // tagsByContentId is re-keyed by SHARE id so each item's tag set lines up with
  // its FilterBar item (whose id is the share id, not the contentId).
  const tagsById = useMemo(
    () => new Map(posts.map(p => [p.shareId, tagsByContentId.get(p.contentId) ?? new Set<string>()])),
    [posts, tagsByContentId],
  );
  const postsById = useMemo(() => new Map(posts.map(p => [p.shareId, p])), [posts]);

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

  if (!activeTeam) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <View />
          <TouchableOpacity onPress={signOut}><Text style={styles.signOut}>Sign out</Text></TouchableOpacity>
        </View>
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

      <View style={styles.actions}>
        <TouchableOpacity style={styles.smallBtn} onPress={toggleForm}>
          <Text style={styles.smallBtnText}>{showForm ? 'Cancel' : '+ New Game'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.smallBtn, styles.smallBtnAlt]} onPress={() => router.push('/export')}>
          <Text style={styles.smallBtnText}>Export</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.subtitle}>Team wall</Text>

      {showForm ? (
        // Games manager: create a game, or open an existing one to add film.
        <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
          <View style={styles.form}>
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
        // The team wall — the main view.
        <>
          <FilterBar
            items={items}
            tagsById={tagsById}
            tagMeta={tagMeta}
            teamOptions={TEAM_OPTIONS}
            typeOptions={TYPE_OPTIONS}
            sortOptions={SORT_OPTIONS}
            searchPlaceholder="Search the wall"
            onVisibleChange={setVisiblePosts}
          />

          <View style={[styles.content, visiblePosts.length > 0 && styles.contentTop]}>
            {wallLoading ? (
              <ActivityIndicator size="large" color="#534AB7" />
            ) : posts.length === 0 ? (
              <Text style={styles.empty}>Nothing on the team wall yet.{'\n'}Post reels or games from Film Room.</Text>
            ) : visiblePosts.length === 0 ? (
              <Text style={styles.empty}>Nothing matches your filters.</Text>
            ) : (
              <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 20 }}>
                {visiblePosts.map(fi => {
                  const item = postsById.get(fi.id);
                  if (!item) return null;
                  return (
                    <TouchableOpacity key={item.shareId} style={styles.card} onPress={() => openShared(item)}>
                      <View style={styles.typeBadgeWrap}><ContentTypeBadge type={item.contentType} /></View>
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
  actions: { flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 12, marginBottom: 10 },
  subtitle: { color: '#888', fontSize: 13, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '600', marginBottom: 14 },
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
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  cardMeta: { color: '#888', fontSize: 12, marginTop: 4 },

  // games manager
  form: { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#333' },
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

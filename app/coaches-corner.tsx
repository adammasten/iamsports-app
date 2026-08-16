import { COACH_ROLES, useTeamContext } from '@/context';
import { filterModerated, loadModeration } from '@/lib/core/moderation';
import { supabase } from '@/supabase';
import { showContentActions } from './moderationActions';
import { router } from 'expo-router';
import { goBackOrHome } from '@/lib/nav';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ContentCard from '@/components/content-card/ContentCard';
import { ShareComments } from '@/components/share-comments';
import WebTopNav from './components/WebTopNav';
import { type DropdownOption } from './components/Dropdown';
import FilterBar, { type FilterableItem } from './components/FilterBar';

// Coaches' Corner — feed of coaches'-board posts (shares with audience='coaches')
// for the teams the user coaches. shares_read RLS already scopes the query to
// coached teams (audience='coaches' AND is_team_coach(team_id)), so no client-side
// team filter is needed. Mirrors the team-wall feed (app/team.tsx): shares →
// resolve_shared_content → card list → /shared-viewer. Slice 1: feed only, no
// team-filter UI yet.

// Static filter-bar options (Team options are derived from the user's coached teams).
const TYPE_OPTIONS: DropdownOption[] = [
  { value: 'all', label: 'All types' },
  { value: 'video', label: 'Games' },
  { value: 'reel', label: 'Reels' },
  { value: 'clip', label: 'Clips' },
];

const SORT_OPTIONS: DropdownOption[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'az', label: 'A–Z' },
];

function relativeTime(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

type Post = {
  shareId: string;
  contentType: string;
  contentId: string;
  teamId: string;
  teamName: string;
  createdAt: string;
  title: string;
  storagePath: string | null;
  thumbnailPath: string | null;
  startTime: number | null;
  endTime: number | null;
  sharedByUserId: string | null;
  note: string | null;
};

// Whether the Coaches' Corner PIN has been entered this app session (module-level
// so navigating away and back doesn't re-prompt until the app is relaunched).
let CORNER_UNLOCKED = false;

export default function CoachesCornerScreen() {
  const insets = useSafeAreaInsets();
  const { userTeams } = useTeamContext();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  // PIN gate: 'checking' → status pending; 'set' → a team requires it but I have no
  // PIN yet; 'enter' → I have a PIN to enter; 'ok' → unlocked (or not required).
  const [pinGate, setPinGate] = useState<'checking' | 'set' | 'enter' | 'ok'>(CORNER_UNLOCKED ? 'ok' : 'checking');
  const [pin, setPin] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinErr, setPinErr] = useState<string | null>(null);

  // Filtered+sorted items, produced by FilterBar (a FilterableItem subset; the
  // full Post is recovered via postsById for the card render).
  const [visiblePosts, setVisiblePosts] = useState<FilterableItem[]>([]);

  // Batch-loaded tag data for the feed: each post's tag set (by contentId) and
  // tag metadata (id → name/category). Three queries total, no N+1 (see effect).
  const [tagsByContentId, setTagsByContentId] = useState<Map<string, Set<string>>>(new Map());
  const [tagMeta, setTagMeta] = useState<Map<string, { name: string; category: string }>>(new Map());

  // Coaches-audience shares for the user's coached teams (RLS-scoped), each
  // resolved to its content. Reuses the team-wall pattern exactly.
  async function loadCoachesBoard() {
    setLoading(true);
    const { data: rows } = await supabase
      .from('shares')
      .select('id, content_type, content_id, team_id, shared_by_user_id, created_at, note, teams ( name )')
      .eq('audience', 'coaches')
      .eq('visible', true)
      .order('created_at', { ascending: false });
    const items = await Promise.all((rows || []).map(async (r: any) => {
      const { data: resolved } = await supabase.rpc('resolve_shared_content', { p_share_id: r.id });
      const c = Array.isArray(resolved) ? resolved[0] : null;
      return {
        shareId: r.id,
        contentType: r.content_type,
        contentId: r.content_id,
        teamId: r.team_id,
        teamName: r.teams?.name ?? 'Team',
        createdAt: r.created_at,
        // Prefer the resolved title — games now return games.title via the added
        // resolve_shared_content 'game' branch; fall back to "Shared game" if absent.
        title: c?.title ?? (r.content_type === 'game' ? 'Shared game' : '(content unavailable)'),
        storagePath: c?.storage_path ?? null,
        thumbnailPath: c?.thumbnail_path ?? null,
        startTime: c?.start_time ?? null,
        endTime: c?.end_time ?? null,
        sharedByUserId: r.shared_by_user_id ?? null,
        note: (r.note as string) ?? null,
      };
    }));
    setPosts(filterModerated(items, await loadModeration()));
    setLoading(false);
  }

  useEffect(() => {
    loadCoachesBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Does this coach need to enter a PIN before seeing the board?
  useEffect(() => {
    if (CORNER_UNLOCKED) return;
    (async () => {
      const { data, error } = await supabase.rpc('coaches_pin_status');
      const st = (data as { required?: boolean; has_pin?: boolean } | null) ?? null;
      // Fail OPEN on error — the board is already coaches-only via RLS; the PIN is a
      // casual lock, so a transient error shouldn't strand a coach out of it.
      if (error || !st || !st.required) { CORNER_UNLOCKED = true; setPinGate('ok'); return; }
      setPinGate(st.has_pin ? 'enter' : 'set');
    })();
  }, []);

  async function submitSetPin() {
    if (!/^[0-9]{4,8}$/.test(pin)) { setPinErr('Pick a 4–8 digit PIN.'); return; }
    setPinBusy(true);
    const { error } = await supabase.rpc('set_coaches_pin', { p_pin: pin });
    setPinBusy(false);
    if (error) { setPinErr(error.message); return; }
    CORNER_UNLOCKED = true; setPin(''); setPinErr(null); setPinGate('ok');
  }

  async function submitEnterPin() {
    if (!pin) return;
    setPinBusy(true);
    const { data, error } = await supabase.rpc('verify_coaches_pin', { p_pin: pin });
    setPinBusy(false);
    if (error) { setPinErr(error.message); return; }
    if (data === true) { CORNER_UNLOCKED = true; setPin(''); setPinErr(null); setPinGate('ok'); }
    else setPinErr('Incorrect PIN. Try again.');
  }

  // Batch-load tags for the whole feed whenever posts change. Bucket content ids
  // by type (reel → reel_tags, clip → clip_tags; video/game have no tags), load
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

  // Team dropdown options: "All teams" + one per coached team.
  const teamOptions = useMemo<DropdownOption[]>(() => [
    { value: 'all', label: 'All teams' },
    ...userTeams.filter(t => COACH_ROLES.includes(t.role)).map(t => ({ value: t.team_id, label: t.name })),
  ], [userTeams]);

  // Map posts → FilterableItem for FilterBar. id is the SHARE id (unique per
  // post), not contentId — the same content can appear on multiple coaches
  // boards, so contentId isn't unique and would collapse cards. tagsByContentId
  // is therefore re-keyed by share id so each item's tag set still lines up.
  // postsById recovers the full Post (storagePath etc.) for the card render.
  const items = useMemo<FilterableItem[]>(
    () => posts.map(p => ({
      id: p.shareId, teamId: p.teamId, teamName: p.teamName,
      contentType: p.contentType, title: p.title, createdAt: p.createdAt,
    })),
    [posts],
  );
  const tagsById = useMemo(
    () => new Map(posts.map(p => [p.shareId, tagsByContentId.get(p.contentId) ?? new Set<string>()])),
    [posts, tagsByContentId],
  );
  const postsById = useMemo(() => new Map(posts.map(p => [p.shareId, p])), [posts]);

  function openShared(item: Post) {
    const mod = { contentType: item.contentType, contentId: item.contentId, shareId: item.shareId, sharedBy: item.sharedByUserId ?? '' };
    if (item.contentType === 'game') {
      router.push({ pathname: '/game-player', params: { title: item.title, ...mod } });
      return;
    }
    if (!item.storagePath) { Alert.alert('Unavailable', 'This content could not be loaded.'); return; }
    router.push({
      pathname: '/shared-viewer',
      params: {
        title: item.title,
        storagePath: item.storagePath,
        startTime: item.startTime != null ? String(item.startTime) : '',
        endTime: item.endTime != null ? String(item.endTime) : '',
        ...mod,
      },
    });
  }

  if (pinGate !== 'ok') {
    return (
      <View style={[styles.container, { paddingTop: Platform.OS === 'web' ? 0 : insets.top }]}>
        {Platform.OS === 'web' ? <WebTopNav active="coaches" /> : null}
        <View style={Platform.OS === 'web' ? [styles.pageWrap, styles.pageWrapWeb] : styles.pageWrap}>
          <View style={styles.lockWrap}>
            {pinGate === 'checking' ? (
              <ActivityIndicator size="large" color="#534AB7" />
            ) : (
              <>
                <Text style={styles.lockIcon}>🔒</Text>
                <Text style={styles.lockTitle}>{pinGate === 'set' ? 'Set a Coaches’ Corner PIN' : 'Enter your PIN'}</Text>
                <Text style={styles.lockSub}>
                  {pinGate === 'set'
                    ? 'Your team requires a PIN to open Coaches’ Corner. Pick a 4–8 digit PIN you’ll remember — you’ll use it to unlock this board.'
                    : 'Coaches’ Corner is locked. Enter your PIN to continue.'}
                </Text>
                <TextInput
                  style={styles.lockInput}
                  value={pin}
                  onChangeText={t => { setPin(t.replace(/[^0-9]/g, '')); setPinErr(null); }}
                  placeholder="PIN"
                  placeholderTextColor="#666"
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={8}
                  autoFocus
                  onSubmitEditing={pinGate === 'set' ? submitSetPin : submitEnterPin}
                />
                {pinErr ? <Text style={styles.lockErr}>{pinErr}</Text> : null}
                <TouchableOpacity style={styles.lockBtn} onPress={pinGate === 'set' ? submitSetPin : submitEnterPin} disabled={pinBusy}>
                  <Text style={styles.lockBtnText}>{pinBusy ? 'Please wait…' : pinGate === 'set' ? 'Set PIN & open' : 'Unlock'}</Text>
                </TouchableOpacity>
                {pinGate === 'enter' ? (
                  <TouchableOpacity onPress={() => { setPin(''); setPinErr(null); setPinGate('set'); }} style={{ marginTop: 14 }}>
                    <Text style={styles.lockLink}>Forgot PIN? Set a new one</Text>
                  </TouchableOpacity>
                ) : null}
              </>
            )}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === 'web' ? 0 : insets.top }]}>
      {Platform.OS === 'web' ? <WebTopNav active="coaches" /> : null}
      <View style={Platform.OS === 'web' ? [styles.pageWrap, styles.pageWrapWeb] : styles.pageWrap}>
      {Platform.OS === 'web' ? null : (
        <View style={styles.topRow}>
          <TouchableOpacity onPress={goBackOrHome} style={styles.back}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        </View>
      )}

      <Text style={styles.title}>Coaches&apos; Corner</Text>
      <Text style={styles.subtitle}>Coaches only. A private board for your staff — players and families never see this.</Text>

      <FilterBar
        items={items}
        tagsById={tagsById}
        tagMeta={tagMeta}
        teamOptions={teamOptions}
        typeOptions={TYPE_OPTIONS}
        sortOptions={SORT_OPTIONS}
        searchPlaceholder="Search posts"
        onVisibleChange={setVisiblePosts}
      />

      <View style={[styles.content, visiblePosts.length > 0 && styles.contentTop]}>
        {loading ? (
          <ActivityIndicator size="large" color="#534AB7" />
        ) : posts.length === 0 ? (
          <Text style={styles.empty}>No posts yet</Text>
        ) : visiblePosts.length === 0 ? (
          <Text style={styles.empty}>No posts match your filters.</Text>
        ) : (
          <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 20 }} showsVerticalScrollIndicator={false}>
            <View style={Platform.OS === 'web' ? styles.feedGrid : undefined}>
            {visiblePosts.map(fi => {
              const item = postsById.get(fi.id);
              if (!item) return null;
              const isReel = item.contentType === 'reel';
              const typeLabel = item.contentType.charAt(0).toUpperCase() + item.contentType.slice(1);
              return (
                <View key={item.shareId} style={Platform.OS === 'web' ? styles.gridCell : undefined}>
                  <ContentCard
                    content={{ id: item.contentId, kind: isReel ? 'reel' : 'game', title: item.title, meta: `${item.teamName} · ${relativeTime(item.createdAt)}`, typeLabel, thumbnailKey: item.thumbnailPath }}
                    onOpen={() => openShared(item)}
                    onLongPress={() => showContentActions({ contentType: item.contentType, contentId: item.contentId, shareId: item.shareId, sharedByUserId: item.sharedByUserId, canRemove: true, onChanged: loadCoachesBoard })}
                    showPlayOnThumb
                    onPlay={() => openShared(item)}
                    note={item.note ? { text: item.note } : undefined}
                  />
                  <ShareComments shareId={item.shareId} />
                </View>
              );
            })}
            </View>
          </ScrollView>
        )}
      </View>
      </View>{/* pageWrap */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  pageWrap: { flex: 1, paddingHorizontal: 20 },
  pageWrapWeb: { maxWidth: 1180, width: '100%', alignSelf: 'center' },

  // Coaches' Corner PIN lock screen
  lockWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, maxWidth: 420, width: '100%', alignSelf: 'center' },
  lockIcon: { fontSize: 40 },
  lockTitle: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  lockSub: { color: '#888', fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 6 },
  lockInput: { backgroundColor: '#17171d', color: '#fff', fontSize: 24, fontWeight: '800', letterSpacing: 8, textAlign: 'center', borderRadius: 12, paddingVertical: 14, width: '100%' },
  lockErr: { color: '#EF5350', fontSize: 13, fontWeight: '600' },
  lockBtn: { backgroundColor: '#534AB7', borderRadius: 12, paddingVertical: 15, alignItems: 'center', width: '100%', marginTop: 4 },
  lockBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  lockLink: { color: '#8b83e6', fontWeight: '700', fontSize: 14 },
  // Grid like Home/Film Room, but 2-across (wider cells) so each post's comment
  // thread has room to read + type.
  feedGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' },
  gridCell: { flexGrow: 1, flexBasis: 420, maxWidth: 640 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { paddingVertical: 8 },
  backText: { color: '#534AB7', fontSize: 16 },
  title: { color: '#fff', fontSize: 26, fontWeight: '700', marginTop: 8, marginBottom: 4 },
  subtitle: { color: '#888', fontSize: 13, lineHeight: 18, marginBottom: 16 },

  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  contentTop: { alignItems: 'stretch', justifyContent: 'flex-start' },
  empty: { color: '#555', fontSize: 15 },
  list: { alignSelf: 'stretch' },

  card: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#333' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  teamPill: {
    color: '#ddd', fontSize: 11, fontWeight: '700',
    backgroundColor: '#2a2740', borderColor: '#534AB7', borderWidth: 1,
    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, maxWidth: 180,
  },
  typeLabel: { color: '#888', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  gameBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#C8742B', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  gameBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '600', flexShrink: 1 },
  cardMeta: { color: '#888', fontSize: 12, marginTop: 4 },
});

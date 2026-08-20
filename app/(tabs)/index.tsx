import { COACH_ROLES, useTeamContext } from '@/context';
import { TeamLogo } from '@/components/team-logo';
import { LoadError } from '@/components/load-error';
import { SkeletonCards } from '@/components/skeleton-cards';
import { withTimeout } from '@/lib/withTimeout';
import { pickAndUploadTeamLogo } from '@/lib/native/team-logo-upload';
import { supabase } from '@/supabase';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { loadTeamWall, type WallPost } from '@/lib/core/homeFeed';
import { showContentActions } from '../moderationActions';
import ContentCard from '@/components/content-card/ContentCard';
import { type DropdownOption } from '../components/Dropdown';
import FilterBar, { type FilterableItem } from '../components/FilterBar';
import WebTopNav from '../components/WebTopNav';

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
  const { activeTeam, activeRole, userId, refreshTeams } = useTeamContext();
  const isCoach = !!activeRole && COACH_ROLES.includes(activeRole);
  const [logoBusy, setLogoBusy] = useState(false);

  async function changeLogo() {
    if (!activeTeam) return;
    try {
      setLogoBusy(true);
      const dest = await pickAndUploadTeamLogo(activeTeam.id);
      if (dest) await refreshTeams();
    } catch (e: any) {
      Alert.alert('Logo error', e?.message ?? 'Could not set logo');
    } finally {
      setLogoBusy(false);
    }
  }

  // This is a TEAM page: the feed shows ONLY the active team's own wall (its
  // team-audience shares). The merged cross-team/cross-kid feed lives on the
  // app-home screen (select-team.tsx). Both use @/lib/core/homeFeed.
  const [posts, setPosts] = useState<WallPost[]>([]);
  const [wallLoading, setWallLoading] = useState(true);
  const [wallError, setWallError] = useState<string | null>(null);
  const [visiblePosts, setVisiblePosts] = useState<FilterableItem[]>([]);

  // Playbook entry — shown only when the active team has a published install, so
  // the feature stays dark on every team we haven't seeded (RLS limits the count
  // to installs this member is allowed to see).
  const [hasPlaybook, setHasPlaybook] = useState(false);
  useEffect(() => {
    // VIEWING plays works on mobile (react-native-svg renders the diagrams);
    // creating/editing stays web-only. So the viewer entry shows on both.
    const team = activeTeam;
    if (!team) { setHasPlaybook(false); return; }
    let alive = true;
    supabase
      .from('installs')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', team.id)
      .eq('status', 'published')
      .then(({ count }) => { if (alive) setHasPlaybook((count ?? 0) > 0); });
    return () => { alive = false; };
  }, [activeTeam]);

  // Batch-loaded tag data for the feed: each post's tag set (by contentId) and
  // tag metadata (id → name/category). Three queries total, no N+1 (see effect).
  const [tagsByContentId, setTagsByContentId] = useState<Map<string, Set<string>>>(new Map());
  const [tagMeta, setTagMeta] = useState<Map<string, { name: string; category: string }>>(new Map());

  // Team page: the wall reloads when the active team changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadHome(); }, [activeTeam]);

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

  async function loadHome() {
    if (!activeTeam) { setPosts([]); setWallError(null); setWallLoading(false); return; }
    setWallLoading(true);
    setWallError(null);
    // ONLY this team's own wall — scoped in @/lib/core/homeFeed (single source of
    // truth). No merge; the merged cross-team feed is the app-home screen's job.
    try {
      const { posts: wall, debug: dbg } = await withTimeout(loadTeamWall(activeTeam.id));
      if (dbg?.q1Err) { setWallError('Couldn’t load the wall. ' + dbg.q1Err); setPosts([]); }
      else setPosts(wall);
    } catch (e: any) {
      setWallError(e?.message || 'Couldn’t load the wall.');
      setPosts([]);
    } finally {
      setWallLoading(false);
    }
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
    const mod = { contentType: item.contentType, contentId: item.contentId, shareId: item.shareId, sharedBy: item.sharedByUserId ?? '' };
    if (item.contentType === 'game') {
      router.push({ pathname: '/game-player', params: { title: item.title, ...mod } });
      return;
    }
    if (!item.storagePath) { Alert.alert('Unavailable', 'This content could not be loaded.'); return; }
    router.push({
      pathname: '/shared-viewer',
      params: {
        title: item.title, storagePath: item.storagePath,
        startTime: item.startTime != null ? String(item.startTime) : '',
        endTime: item.endTime != null ? String(item.endTime) : '',
        ...mod,
      },
    });
  }

  if (!activeTeam) {
    return (
      <View style={styles.container}>
        {Platform.OS === 'web' ? <WebTopNav /> : null}
        <View style={[styles.body, Platform.OS === 'web' ? styles.bodyWeb : styles.bodyNative]}>
          {Platform.OS === 'web' ? null : (
            <View style={styles.header}>
              <View />
              <TouchableOpacity onPress={() => router.push('/account')}><Text style={styles.signOut}>Account</Text></TouchableOpacity>
            </View>
          )}
          <Text style={styles.heading}>No team selected</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/select-team')}>
            <Text style={styles.primaryBtnText}>Pick a team</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {Platform.OS === 'web' ? <WebTopNav /> : null}
      <View style={[styles.body, Platform.OS === 'web' ? styles.bodyWeb : styles.bodyNative]}>
        {Platform.OS === 'web' ? null : (
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.replace('/select-team')}>
              <Text style={styles.switchBtn}>← Back</Text>
            </TouchableOpacity>
            <View style={styles.headerRight}>
              {isCoach ? (
                <TouchableOpacity onPress={() => router.push({ pathname: '/team-permissions', params: { teamId: activeTeam.id } })}>
                  <Text style={styles.manageBtn}>Permissions</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity onPress={() => router.push('/account')}><Text style={styles.signOut}>Account</Text></TouchableOpacity>
            </View>
          </View>
        )}

        <ScrollView contentContainerStyle={styles.teamBody} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.teamHeadingRow}>
            {isCoach ? (
              <TouchableOpacity onPress={changeLogo} disabled={logoBusy} activeOpacity={0.7} hitSlop={8}>
                {logoBusy
                  ? <ActivityIndicator color="#b9b1e8" style={{ width: 40, height: 40 }} />
                  : <TeamLogo logoPath={activeTeam.logo_path} name={activeTeam.name} size={40} />}
              </TouchableOpacity>
            ) : (
              <TeamLogo logoPath={activeTeam.logo_path} name={activeTeam.name} size={40} />
            )}
            <Text style={[styles.heading, { flexShrink: 1, marginBottom: 0 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{activeTeam.name}</Text>
            {/* On web the mobile header is hidden, so Permissions lives beside the team name. */}
            {Platform.OS === 'web' && isCoach ? (
              <TouchableOpacity style={styles.headingAction} onPress={() => router.push({ pathname: '/team-permissions', params: { teamId: activeTeam.id } })}>
                <Text style={styles.manageBtn}>Permissions</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <Text style={styles.subtitle}>The published team feed — watch-only. Make &amp; post from the Film Room.</Text>

          {hasPlaybook ? (
            <TouchableOpacity
              style={styles.playbookBtn}
              onPress={() => router.push({ pathname: '/playbook', params: { teamId: activeTeam.id, teamName: activeTeam.name } })}
            >
              <Text style={styles.playbookBtnText}>🏀  Playbook &amp; Installs</Text>
            </TouchableOpacity>
          ) : null}

          {/* Watch-only wall. Create a game via + (upload); manage games & make
              reels in the Film Room. */}
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
              <SkeletonCards />
            ) : wallError ? (
              <LoadError message={wallError} onRetry={loadHome} />
            ) : posts.length === 0 ? (
              <Text style={styles.empty}>Nothing on this team’s wall yet.{'\n'}Post games or reels from Film Room.</Text>
            ) : visiblePosts.length === 0 ? (
              <Text style={styles.empty}>Nothing matches your filters.</Text>
            ) : (
              <View style={Platform.OS === 'web' ? styles.feedGrid : styles.list}>
                {visiblePosts.map(fi => {
                  const item = postsById.get(fi.id);
                  if (!item) return null;
                  // Show the wall labels this content lives on, teams before Family.
                  const sources = [...item.sources].sort((a, b) => (a === 'Family' ? 1 : 0) - (b === 'Family' ? 1 : 0));
                  const isReel = item.contentType === 'reel';
                  const typeLabel = item.contentType.charAt(0).toUpperCase() + item.contentType.slice(1);
                  const d = new Date(item.createdAt).toLocaleDateString();
                  return (
                    <View key={item.key} style={Platform.OS === 'web' ? styles.gridCell : undefined}>
                      <ContentCard
                        content={{ id: item.contentId, kind: isReel ? 'reel' : 'game', title: item.title, meta: [sources.join(' · '), d].filter(Boolean).join(' · '), typeLabel, thumbnailKey: item.thumbnailPath }}
                        onOpen={() => openShared(item)}
                        onLongPress={() => showContentActions({ contentType: item.contentType, contentId: item.contentId, shareId: item.shareId, sharedByUserId: item.sharedByUserId, canRemove: item.sharedByUserId === userId || isCoach, onChanged: loadHome })}
                        showPlayOnThumb
                        onPlay={() => openShared(item)}
                        note={item.note ? { text: item.note } : undefined}
                      />
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  // Centered, max-width column on web; full-width with a status-bar gap on native.
  body: { flex: 1, paddingHorizontal: 20 },
  bodyNative: { paddingTop: 60 },
  bodyWeb: { maxWidth: 1180, width: '100%', alignSelf: 'center', paddingTop: 16 },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  switchBtn: { color: '#534AB7', fontSize: 14, fontWeight: '600' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  manageBtn: { color: '#1D9E75', fontSize: 14, fontWeight: '700' },
  signOut: { color: '#888', fontSize: 14 },

  heading: { color: '#fff', fontSize: 28, fontWeight: '700', letterSpacing: -0.3 },
  teamHeadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headingAction: { marginLeft: 'auto' },
  subtitle: { color: '#888', fontSize: 13, lineHeight: 18, textAlign: 'center', marginBottom: 14 },
  playbookBtn: { alignSelf: 'center', backgroundColor: '#534AB7', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, marginBottom: 14 },
  playbookBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  primaryBtn: { backgroundColor: '#534AB7', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 16 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  teamBody: { paddingBottom: 40 },
  content: { alignItems: 'center', justifyContent: 'center', minHeight: 220 },
  contentTop: { alignItems: 'stretch', justifyContent: 'flex-start' },
  empty: { color: '#555', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  list: { alignSelf: 'stretch' },

  // Web feed grid — 3-across, matching Home + Film Room.
  feedGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' },
  gridCell: { flexGrow: 1, flexBasis: 300, maxWidth: 400 },
});

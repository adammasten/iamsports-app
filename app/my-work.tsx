import { useTeamContext } from '@/context';
import { supabase } from '@/supabase';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// "My Work" — lists the current user's highlight reels (highlight_reels rows
// they created). Each card shows WHERE the reel lives (public / team / private)
// derived from the shares table, plus play / rename / delete. Reels are read
// directly under the highlight_reels creator-read RLS branch; the where-it-lives
// badges come from one batched shares query.
//
// This is slice 1 of several. Reel *publishing* (the action that creates the
// 'reel' shares these badges read) ships in the next slice — until then most
// reels correctly show the "Only you" lock. Built to extend cleanly.

type Destination =
  | { kind: 'public' }
  | { kind: 'team'; teamName: string }
  | { kind: 'coaches' };

type Reel = {
  id: string;
  name: string;
  storagePath: string | null;
  durationSeconds: number | null;
  createdAt: string;
  destinations: Destination[];
};

type SortKey = 'date' | 'name' | 'duration';

export default function MyWorkScreen() {
  const insets = useSafeAreaInsets();
  const { userId } = useTeamContext();

  const [reels, setReels] = useState<Reel[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('date');

  // Inline rename state: which reel is being renamed + the working draft.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  async function loadReels() {
    if (!userId) { setReels([]); setLoading(false); return; }
    setLoading(true);

    // 1. My reels, newest first (creator-read RLS branch covers this).
    const { data: reelRows, error } = await supabase
      .from('highlight_reels')
      .select('id, name, storage_path, duration_seconds, created_at')
      .eq('created_by_user_id', userId)
      .order('created_at', { ascending: false });
    if (error) { Alert.alert('Error', error.message); setLoading(false); return; }

    const rows = reelRows || [];
    const reelIds = rows.map((r: any) => r.id);

    // 2. One batched query for every reel's share destinations. shares_read lets
    //    the sharer read their own rows, so this returns where I've published.
    const destByReel = new Map<string, Destination[]>();
    if (reelIds.length > 0) {
      const { data: shareRows } = await supabase
        .from('shares')
        .select('content_id, audience, team_id, visible, teams ( name )')
        .eq('content_type', 'reel')
        .in('content_id', reelIds);
      (shareRows || []).forEach((s: any) => {
        const list = destByReel.get(s.content_id) ?? [];
        if (s.audience === 'public' && s.visible) {
          if (!list.some(d => d.kind === 'public')) list.push({ kind: 'public' });
        } else if (s.audience === 'team') {
          const teamName = s.teams?.name ?? 'Team';
          if (!list.some(d => d.kind === 'team' && d.teamName === teamName)) {
            list.push({ kind: 'team', teamName });
          }
        } else if (s.audience === 'coaches') {
          if (!list.some(d => d.kind === 'coaches')) list.push({ kind: 'coaches' });
        }
        // audience === 'player' is an inbox send, not a wall placement — ignored.
        destByReel.set(s.content_id, list);
      });
    }

    setReels(rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      storagePath: r.storage_path ?? null,
      durationSeconds: r.duration_seconds != null ? Number(r.duration_seconds) : null,
      createdAt: r.created_at,
      destinations: destByReel.get(r.id) ?? [],
    })));
    setLoading(false);
  }

  useEffect(() => {
    loadReels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const visibleReels = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? reels.filter(r => r.name.toLowerCase().includes(q)) : reels;
    const sorted = [...filtered];
    if (sortBy === 'name') {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === 'duration') {
      sorted.sort((a, b) => (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0));
    } else {
      sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // date, newest first
    }
    return sorted;
  }, [reels, search, sortBy]);

  function formatDuration(seconds: number | null) {
    if (seconds == null) return '—';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function openReel(reel: Reel) {
    if (!reel.storagePath) { Alert.alert('Unavailable', 'This reel’s video could not be loaded.'); return; }
    // Omit startTime/endTime so shared-viewer plays the whole rendered reel.
    router.push({
      pathname: '/shared-viewer',
      params: { title: reel.name, storagePath: reel.storagePath },
    });
  }

  function startRename(reel: Reel) {
    setRenamingId(reel.id);
    setDraftName(reel.name);
  }

  async function commitRename(reel: Reel) {
    const next = draftName.trim();
    setRenamingId(null);
    if (!next || next === reel.name) return;
    // Optimistic local update; revert on error.
    setReels(prev => prev.map(r => r.id === reel.id ? { ...r, name: next } : r));
    const { error } = await supabase.from('highlight_reels').update({ name: next }).eq('id', reel.id);
    if (error) {
      Alert.alert('Error', error.message);
      setReels(prev => prev.map(r => r.id === reel.id ? { ...r, name: reel.name } : r));
    }
  }

  function confirmDelete(reel: Reel) {
    Alert.alert('Delete reel', `Delete “${reel.name}”? This can’t be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          const { error } = await supabase.from('highlight_reels').delete().eq('id', reel.id);
          if (error) { Alert.alert('Error', error.message); return; }
          setReels(prev => prev.filter(r => r.id !== reel.id));
        },
      },
    ]);
  }

  function renderBadges(destinations: Destination[]) {
    if (destinations.length === 0) {
      return (
        <View style={[styles.badge, styles.badgeLock]}>
          <Ionicons name="lock-closed" size={11} color="#888" />
          <Text style={styles.badgeLockText}>Only you</Text>
        </View>
      );
    }
    return destinations.map((d, i) => {
      if (d.kind === 'public') {
        return (
          <View key={`pub-${i}`} style={[styles.badge, styles.badgePublic]}>
            <Ionicons name="globe-outline" size={11} color="#fff" />
            <Text style={styles.badgeText}>Public</Text>
          </View>
        );
      }
      if (d.kind === 'coaches') {
        return (
          <View key={`co-${i}`} style={[styles.badge, styles.badgeCoaches]}>
            <Ionicons name="clipboard-outline" size={11} color="#fff" />
            <Text style={styles.badgeText}>Coaches</Text>
          </View>
        );
      }
      return (
        <View key={`team-${i}`} style={[styles.badge, styles.badgeTeam]}>
          <Ionicons name="people" size={11} color="#fff" />
          <Text style={styles.badgeText} numberOfLines={1}>{d.teamName}</Text>
        </View>
      );
    });
  }

  const SORTS: { key: SortKey; label: string }[] = [
    { key: 'date', label: 'Newest' },
    { key: 'name', label: 'A–Z' },
    { key: 'duration', label: 'Longest' },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>My Work</Text>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color="#888" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search reels"
          placeholderTextColor="#666"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={16} color="#666" />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.sortRow}>
        {SORTS.map(s => {
          const active = sortBy === s.key;
          return (
            <TouchableOpacity
              key={s.key}
              style={[styles.sortChip, active && styles.sortChipActive]}
              onPress={() => setSortBy(s.key)}
            >
              <Text style={[styles.sortChipText, active && styles.sortChipTextActive]}>{s.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={[styles.content, visibleReels.length > 0 && styles.contentTop]}>
        {loading ? (
          <ActivityIndicator size="large" color="#534AB7" />
        ) : reels.length === 0 ? (
          <Text style={styles.empty}>No reels yet. Export a highlight to see it here.</Text>
        ) : visibleReels.length === 0 ? (
          <Text style={styles.empty}>No reels match “{search}”.</Text>
        ) : (
          <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
            {visibleReels.map(reel => (
              <View key={reel.id} style={styles.card}>
                <TouchableOpacity style={styles.thumb} onPress={() => openReel(reel)}>
                  <Ionicons name="film-outline" size={22} color="#666" />
                </TouchableOpacity>

                <View style={styles.cardBody}>
                  {renamingId === reel.id ? (
                    <TextInput
                      style={styles.cardTitleInput}
                      value={draftName}
                      onChangeText={setDraftName}
                      autoFocus
                      selectTextOnFocus
                      returnKeyType="done"
                      onSubmitEditing={() => commitRename(reel)}
                      onBlur={() => commitRename(reel)}
                    />
                  ) : (
                    <TouchableOpacity onPress={() => startRename(reel)}>
                      <Text style={styles.cardTitle} numberOfLines={1}>{reel.name}</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity onPress={() => openReel(reel)} activeOpacity={0.7}>
                    <Text style={styles.cardMeta}>
                      {formatDuration(reel.durationSeconds)} · {new Date(reel.createdAt).toLocaleDateString()}
                    </Text>
                    <View style={styles.badgeRow}>{renderBadges(reel.destinations)}</View>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity style={styles.trashBtn} onPress={() => confirmDelete(reel)}>
                  <Ionicons name="trash-outline" size={18} color="#a55" />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingHorizontal: 20 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { paddingVertical: 8 },
  backText: { color: '#534AB7', fontSize: 16 },
  title: { color: '#fff', fontSize: 26, fontWeight: '700', marginTop: 8, marginBottom: 16 },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#1a1a1a', borderRadius: 10, borderWidth: 1, borderColor: '#333',
    paddingHorizontal: 12, height: 42,
  },
  searchInput: { flex: 1, color: '#fff', fontSize: 15, padding: 0 },

  sortRow: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 4 },
  sortChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16,
    backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333',
  },
  sortChipActive: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
  sortChipText: { color: '#aaa', fontSize: 13, fontWeight: '600' },
  sortChipTextActive: { color: '#fff' },

  content: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  contentTop: { alignItems: 'stretch', justifyContent: 'flex-start' },
  empty: { color: '#555', fontSize: 15, textAlign: 'center', paddingHorizontal: 20 },
  list: { alignSelf: 'stretch' },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, marginBottom: 10,
    borderWidth: 1, borderColor: '#333',
  },
  thumb: {
    width: 56, height: 56, borderRadius: 8, backgroundColor: '#0d0d0d',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2a2a2a',
  },
  cardBody: { flex: 1, gap: 4 },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  cardTitleInput: {
    color: '#fff', fontSize: 15, fontWeight: '600', padding: 0,
    borderBottomWidth: 1, borderBottomColor: '#534AB7',
  },
  cardMeta: { color: '#888', fontSize: 12 },

  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, maxWidth: 160,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  badgePublic: { backgroundColor: '#1D9E75' },   // green = public/personal wall
  badgeTeam: { backgroundColor: '#534AB7' },      // purple = team wall
  badgeCoaches: { backgroundColor: '#C8742B' },   // amber = coaches-only
  badgeLock: { backgroundColor: '#222', borderWidth: 1, borderColor: '#333' },
  badgeLockText: { color: '#888', fontSize: 11, fontWeight: '600' },

  trashBtn: { padding: 8 },
});

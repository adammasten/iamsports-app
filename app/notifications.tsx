// The notification INBOX (what the header bell opens). Works identically on the
// app, the web app and the mobile browser — one component, one code path.
//
// Three states, all now driven:
//   seen_at      — cleared on open, drives the bell badge
//   read_at      — cleared on tap, un-bolds the row
//   dismissed_at — swipe (native) or ✕ (everywhere) removes it from the inbox
//
// Before this, dismissal existed in the DB (a notifications_delete policy) but
// NOTHING called it, so the list only ever grew. Dismissal is SOFT so "Undo"
// works, and the server also hides anything older than 60 days.
//
// WHY ✕ ON EVERY PLATFORM, SWIPE ONLY ON NATIVE: RNGH gestures have been fragile
// in this stack (see the DraggableFlatList note in CLAUDE.md) and there is no
// GestureHandlerRootView at the app root — game-player.tsx and tagging-overlay.tsx
// each wrap locally, so this screen does the same. Swipe is the native bonus; the
// ✕ is what guarantees the feature works in a desktop browser.
import { goBackOrHome } from '@/lib/nav';
import { supabase } from '@/supabase';
import { useTeamContext } from '@/context';
import { webAlert } from '@/lib/webAlert';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, FlatList, Platform, StyleSheet, Text,
  TouchableOpacity, View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Notif = {
  id: string; type: string; actor_name: string; player_name: string;
  team_name: string | null; team_id: string | null; entity_type: string | null; entity_id: string | null;
  target_player_id: string | null; created_at: string; read_at: string | null;
};

// A rendered row is either one notification or a collapsed group of same-type,
// same-team, same-day ones ("Coach added 4 videos to Regents").
type Row = { key: string; head: Notif; members: Notif[] };

function relTime(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}

function message(n: Notif, count = 1): string {
  const player = n.player_name || 'your kid';
  const ent = n.entity_type || 'clip';
  const team = n.team_name || 'your team';
  const many = count > 1;
  switch (n.type) {
    case 'share_to_kid': return many
      ? `${n.actor_name} shared ${count} items with ${player}`
      : `${n.actor_name} shared a ${ent} with ${player}`;
    case 'guardian_joined': return `${n.actor_name} joined ${player} as a guardian`;
    case 'kid_added_to_team': return `${player} was added to ${n.team_name || 'a team'}`;
    case 'share_to_team': return many
      ? `${n.actor_name} shared ${count} items with ${team}`
      : `${n.actor_name} shared a ${ent} with ${team}`;
    case 'share_to_coaches': return `${n.actor_name} posted a ${ent} to the coaches’ board`;
    case 'new_comment': return many
      ? `${count} new comments`
      : `${n.actor_name} commented on a ${ent}`;
    case 'team_message': return `${n.actor_name} posted an announcement to ${team}`;
    case 'video_uploaded': return many
      ? `${n.actor_name} added ${count} videos to ${team}`
      : `${n.actor_name} added new film to ${team}`;
    case 'reel_ready': return 'Your highlight reel is ready';
    default: return `${n.actor_name} did something with ${player}`;
  }
}

// Collapse consecutive same-type/team/day notifications into one row.
function groupRows(items: Notif[]): Row[] {
  const out: Row[] = [];
  for (const n of items) {
    const day = n.created_at.slice(0, 10);
    const prev = out[out.length - 1];
    if (prev && prev.head.type === n.type && prev.head.team_id === n.team_id
        && prev.head.created_at.slice(0, 10) === day
        && (n.type === 'video_uploaded' || n.type === 'share_to_team'
            || n.type === 'share_to_kid' || n.type === 'new_comment')) {
      prev.members.push(n);
    } else {
      out.push({ key: n.id, head: n, members: [n] });
    }
  }
  return out;
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { setActiveTeam } = useTeamContext();
  const [items, setItems] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [undo, setUndo] = useState<Notif[] | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_notifications');
    if (error) { webAlert('Notifications', error.message); setLoading(false); return; }
    setItems((data as Notif[]) ?? []);
    setLoading(false);
    // Awaited + error-checked on purpose: this was fire-and-forget before, so a
    // failure left the badge stuck with nothing reported. Never fail silently.
    const { error: seenErr } = await supabase.rpc('mark_notifications_seen');
    if (seenErr) webAlert('Notifications', `Couldn’t clear the badge: ${seenErr.message}`);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  function armUndo(removed: Notif[]) {
    setUndo(removed);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 6000);
  }

  async function dismissRow(row: Row) {
    const removed = row.members;
    setItems(prev => prev.filter(x => !removed.some(r => r.id === x.id)));
    armUndo(removed);
    for (const n of removed) {
      const { error } = await supabase.rpc('dismiss_notification', { p_id: n.id });
      if (error) { webAlert('Notifications', error.message); load(); return; }
    }
  }

  async function undoDismiss() {
    const restore = undo ?? [];
    setUndo(null);
    for (const n of restore) {
      const { error } = await supabase.rpc('undismiss_notification', { p_id: n.id });
      if (error) { webAlert('Notifications', error.message); break; }
    }
    load();
  }

  async function clearAll() {
    const snapshot = items;
    setItems([]);
    const { data, error } = await supabase.rpc('dismiss_all_notifications');
    if (error) { webAlert('Notifications', error.message); setItems(snapshot); return; }
    if ((data as number) > 0) armUndo(snapshot);
  }

  function openNotif(n: Notif) {
    if (!n.read_at) {
      supabase.rpc('mark_notification_read', { p_id: n.id });
      setItems(prev => prev.map(x => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
    }
    // Route by TYPE (not just target_player_id — team/coaches shares also carry a
    // player, but belong on a board, not the kid's page).
    switch (n.type) {
      case 'share_to_team':
      case 'video_uploaded':
        if (n.team_id) { setActiveTeam(n.team_id); router.replace('/'); }
        return;
      case 'share_to_coaches':
      case 'new_comment':
        if (n.team_id) setActiveTeam(n.team_id);
        router.push('/coaches-corner');
        return;
      case 'team_message':
        if (n.team_id) setActiveTeam(n.team_id);
        router.push('/messages');
        return;
      case 'reel_ready':
        if (n.team_id) setActiveTeam(n.team_id);
        router.push('/my-work');
        return;
      default:
        if (n.target_player_id) router.push({ pathname: '/kid', params: { playerId: n.target_player_id } });
    }
  }

  const rows = groupRows(items);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={goBackOrHome} style={styles.back}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Notifications</Text>
          {rows.length > 0 && (
            <TouchableOpacity onPress={clearAll} hitSlop={8}>
              <Text style={styles.clearAll}>Clear all</Text>
            </TouchableOpacity>
          )}
        </View>

        {loading ? (
          <ActivityIndicator size="large" color="#534AB7" style={{ marginTop: 40 }} />
        ) : rows.length === 0 ? (
          <Text style={styles.empty}>You’re all caught up.</Text>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={r => r.key}
            contentContainerStyle={{ paddingBottom: 90 }}
            renderItem={({ item }) => (
              <NotifRow row={item} onOpen={openNotif} onDismiss={dismissRow} />
            )}
          />
        )}

        {undo && (
          <View style={styles.undoBar}>
            <Text style={styles.undoText}>
              {undo.length === 1 ? 'Notification dismissed' : `${undo.length} dismissed`}
            </Text>
            <TouchableOpacity onPress={undoDismiss} hitSlop={8}>
              <Text style={styles.undoAction}>Undo</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </GestureHandlerRootView>
  );
}

function NotifRow({ row, onOpen, onDismiss }: {
  row: Row; onOpen: (n: Notif) => void; onDismiss: (r: Row) => void;
}) {
  const tx = useRef(new Animated.Value(0)).current;
  const count = row.members.length;
  const unread = row.members.some(m => !m.read_at);

  // Swipe-to-dismiss, native only. On web a horizontal drag fights text
  // selection and page scroll, and the ✕ is the better desktop affordance.
  const pan = Gesture.Pan()
    .enabled(Platform.OS !== 'web')
    .activeOffsetX([-14, 14])
    .failOffsetY([-10, 10])
    .onUpdate(e => { if (e.translationX < 0) tx.setValue(e.translationX); })
    .onEnd(e => {
      if (e.translationX < -110) {
        Animated.timing(tx, { toValue: -500, duration: 160, useNativeDriver: true })
          .start(() => onDismiss(row));
      } else {
        Animated.spring(tx, { toValue: 0, useNativeDriver: true }).start();
      }
    })
    .runOnJS(true);

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={{ transform: [{ translateX: tx }] }}>
        <View style={styles.row}>
          <TouchableOpacity
            style={styles.rowMain}
            onPress={() => onOpen(row.head)}
            activeOpacity={0.7}
          >
            <View style={[styles.dot, unread ? styles.dotUnread : styles.dotRead]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.msg, unread && styles.msgUnread]}>
                {message(row.head, count)}
              </Text>
              <Text style={styles.time}>{relTime(row.head.created_at)}</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onDismiss(row)}
            hitSlop={10}
            style={styles.dismiss}
            accessibilityLabel="Dismiss notification"
          >
            <Text style={styles.dismissText}>✕</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingHorizontal: 20 },
  back: { marginBottom: 8 },
  backText: { color: '#534AB7', fontSize: 16, fontWeight: '600' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { color: '#fff', fontSize: 26, fontWeight: '800' },
  clearAll: { color: '#8b83e6', fontSize: 14, fontWeight: '700' },
  empty: { color: '#666', fontSize: 14, textAlign: 'center', marginTop: 48 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: '#161616', backgroundColor: '#000',
  },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotUnread: { backgroundColor: '#EF5350' },
  dotRead: { backgroundColor: 'transparent' },
  msg: { color: '#ddd', fontSize: 15, lineHeight: 20 },
  msgUnread: { color: '#fff', fontWeight: '700' },
  time: { color: '#777', fontSize: 12, marginTop: 2 },
  dismiss: { paddingHorizontal: 10, paddingVertical: 14 },
  dismissText: { color: '#666', fontSize: 16, fontWeight: '700' },
  undoBar: {
    position: 'absolute', left: 20, right: 20, bottom: 24,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#1b1b22', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
  },
  undoText: { color: '#ddd', fontSize: 14 },
  undoAction: { color: '#8b83e6', fontSize: 14, fontWeight: '800' },
});

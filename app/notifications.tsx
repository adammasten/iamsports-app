// The notification list (what the header bell opens). Loads enriched rows via
// get_notifications, marks everything SEEN on open (clears the bell badge), and
// keeps each row bold/unread until tapped (mark_notification_read). Tapping a row
// deep-links to the kid it's about. Notify sparingly → this list stays short.
import { goBackOrHome } from '@/lib/nav';
import { supabase } from '@/supabase';
import { useTeamContext } from '@/context';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Notif = {
  id: string; type: string; actor_name: string; player_name: string;
  team_name: string | null; team_id: string | null; entity_type: string | null; entity_id: string | null;
  target_player_id: string | null; created_at: string; read_at: string | null;
};

function relTime(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}

function message(n: Notif): string {
  const player = n.player_name || 'your kid';
  const ent = n.entity_type || 'clip';
  const team = n.team_name || 'your team';
  switch (n.type) {
    case 'share_to_kid': return `${n.actor_name} shared a ${ent} with ${player}`;
    case 'guardian_joined': return `${n.actor_name} joined ${player} as a guardian`;
    case 'kid_added_to_team': return `${player} was added to ${n.team_name || 'a team'}`;
    case 'share_to_team': return `${n.actor_name} shared a ${ent} with ${team}`;
    case 'share_to_coaches': return `${n.actor_name} posted a ${ent} to the coaches’ board`;
    case 'new_comment': return `${n.actor_name} commented on a ${ent}`;
    default: return `${n.actor_name} did something with ${player}`;
  }
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { setActiveTeam } = useTeamContext();
  const [items, setItems] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc('get_notifications');
      if (cancelled) return;
      setItems((data as Notif[]) ?? []);
      setLoading(false);
      supabase.rpc('mark_notifications_seen'); // opening the list clears the badge
    })();
    return () => { cancelled = true; };
  }, []);

  function openNotif(n: Notif) {
    if (!n.read_at) {
      supabase.rpc('mark_notification_read', { p_id: n.id });
      setItems(prev => prev.map(x => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
    }
    // Route by TYPE (not just target_player_id — team/coaches shares also carry a
    // player, but belong on a board, not the kid's page).
    switch (n.type) {
      case 'share_to_team':
        if (n.team_id) { setActiveTeam(n.team_id); router.replace('/'); }
        return;
      case 'share_to_coaches':
      case 'new_comment':
        if (n.team_id) setActiveTeam(n.team_id);
        router.push('/coaches-corner');
        return;
      default:
        if (n.target_player_id) router.push({ pathname: '/kid', params: { playerId: n.target_player_id } });
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <TouchableOpacity onPress={goBackOrHome} style={styles.back}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
      <Text style={styles.title}>Notifications</Text>
      {loading ? (
        <ActivityIndicator size="large" color="#534AB7" style={{ marginTop: 40 }} />
      ) : items.length === 0 ? (
        <Text style={styles.empty}>You’re all caught up.</Text>
      ) : (
        <FlatList
          data={items}
          keyExtractor={n => n.id}
          contentContainerStyle={{ paddingBottom: 30 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => openNotif(item)} activeOpacity={0.7}>
              <View style={[styles.dot, item.read_at ? styles.dotRead : styles.dotUnread]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.msg, !item.read_at && styles.msgUnread]}>{message(item)}</Text>
                <Text style={styles.time}>{relTime(item.created_at)}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingHorizontal: 20 },
  back: { marginBottom: 8 },
  backText: { color: '#534AB7', fontSize: 16, fontWeight: '600' },
  title: { color: '#fff', fontSize: 26, fontWeight: '800', marginBottom: 12 },
  empty: { color: '#666', fontSize: 14, textAlign: 'center', marginTop: 48 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#161616' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotUnread: { backgroundColor: '#EF5350' },
  dotRead: { backgroundColor: 'transparent' },
  msg: { color: '#ddd', fontSize: 15, lineHeight: 20 },
  msgUnread: { color: '#fff', fontWeight: '700' },
  time: { color: '#777', fontSize: 12, marginTop: 2 },
});

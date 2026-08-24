// Team messaging (Stage 3) — public to the whole team. Announcements (coach
// broadcast, fires push) + Team Chat (everyone), with public replies. No private
// DMs. Cross-platform (web + native). Event-attached conversations reuse the same
// data layer via an eventId param.
import { COACH_ROLES, useTeamContext } from '@/context';
import { deleteMessage, loadMessages, loadReplies, postMessage, type Message, type MessageKind } from '@/lib/core/messages';
import { goBackOrHome } from '@/lib/nav';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebTopNav from './components/WebTopNav';

function webSafeAlert(title: string, message: string) {
  if (Platform.OS === 'web') { if (typeof window !== 'undefined') window.alert(message); return; }
  Alert.alert(title, message);
}
function confirmDelete(): Promise<boolean> {
  const q = 'Delete this message for everyone?';
  return new Promise(resolve => {
    if (Platform.OS === 'web') { resolve(window.confirm(q)); return; }
    Alert.alert('Delete', q, [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) }, { text: 'Delete', style: 'destructive', onPress: () => resolve(true) }]);
  });
}
function relTime(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return ''; }
}

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const { activeTeam, activeRole, userId } = useTeamContext();
  const isCoach = !!activeRole && COACH_ROLES.includes(activeRole);
  const [segment, setSegment] = useState<MessageKind>('announcement');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [composeText, setComposeText] = useState('');
  const [posting, setPosting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [replies, setReplies] = useState<Message[]>([]);
  const [replyText, setReplyText] = useState('');

  const canCompose = segment === 'chat' || isCoach;

  const load = useCallback(async () => {
    if (!activeTeam) { setMessages([]); setLoading(false); return; }
    setLoading(true);
    try { setMessages(await loadMessages(activeTeam.id, { kind: segment })); }
    catch (e: any) { webSafeAlert('Messages', e?.message ?? 'Could not load messages.'); }
    setLoading(false);
  }, [activeTeam, segment]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function openThread(id: string) {
    if (openId === id) { setOpenId(null); setReplies([]); return; }
    setOpenId(id); setReplies([]); setReplyText('');
    try { setReplies(await loadReplies(id)); } catch { /* ignore */ }
  }

  async function send(kind: MessageKind, body: string, parentId: string | null) {
    if (!activeTeam || !userId || !body.trim()) return;
    setPosting(true);
    try {
      await postMessage({ teamId: activeTeam.id, kind, body, parentId }, userId);
      if (parentId) { setReplyText(''); setReplies(await loadReplies(parentId)); setMessages(ms => ms.map(m => m.id === parentId ? { ...m, replyCount: m.replyCount + 1 } : m)); }
      else { setComposeText(''); await load(); }
    } catch (e: any) { webSafeAlert('Post', e?.message ?? 'Could not post.'); }
    setPosting(false);
  }

  async function onDelete(m: Message) {
    if (!userId) return;
    if (!(await confirmDelete())) return;
    try {
      await deleteMessage(m.id, userId);
      if (m.parentId) setReplies(rs => rs.filter(r => r.id !== m.id));
      else { setMessages(ms => ms.filter(x => x.id !== m.id)); if (openId === m.id) { setOpenId(null); setReplies([]); } }
    } catch (e: any) { webSafeAlert('Delete', e?.message ?? 'Could not delete.'); }
  }

  if (!activeTeam) {
    return (
      <View style={styles.root}>
        {Platform.OS === 'web' ? <WebTopNav /> : null}
        <View style={{ paddingTop: insets.top + 40, paddingHorizontal: 20 }}><Text style={styles.empty}>Pick a team to see its messages.</Text></View>
      </View>
    );
  }

  const canDelete = (m: Message) => m.authorUserId === userId || isCoach;

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={80}>
      {Platform.OS === 'web' ? <WebTopNav /> : null}
      <View style={{ flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' }}>
        <View style={{ paddingTop: Platform.OS === 'web' ? 14 : insets.top + 10, paddingHorizontal: 16 }}>
          {Platform.OS !== 'web' ? <TouchableOpacity onPress={goBackOrHome} hitSlop={8} style={{ paddingVertical: 4 }}><Text style={styles.back}>← Back</Text></TouchableOpacity> : null}
          <Text style={styles.title}>{activeTeam.name}</Text>
          <Text style={styles.subtitle}>Messages</Text>
          <View style={styles.segRow}>
            {(['announcement', 'chat'] as MessageKind[]).map(s => (
              <TouchableOpacity key={s} onPress={() => { setSegment(s); setOpenId(null); }} style={[styles.seg, segment === s && styles.segOn]}>
                <Text style={[styles.segTxt, segment === s && styles.segTxtOn]}>{s === 'announcement' ? '📣 Announcements' : '💬 Team Chat'}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          {loading ? <ActivityIndicator color="#ff6a2c" style={{ marginTop: 30 }} /> :
            messages.length === 0 ? (
              <Text style={styles.empty}>{segment === 'announcement' ? 'No announcements yet.' : 'No messages yet — say hi 👋'}</Text>
            ) : messages.map(m => (
              <View key={m.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <Text style={styles.author}>{m.authorName}</Text>
                  <Text style={styles.time}>{relTime(m.createdAt)}</Text>
                </View>
                <Text style={styles.body}>{m.body}</Text>
                <View style={styles.cardFoot}>
                  <TouchableOpacity onPress={() => openThread(m.id)} hitSlop={6}>
                    <Text style={styles.footBtn}>💬 {m.replyCount > 0 ? `${m.replyCount} ${m.replyCount === 1 ? 'reply' : 'replies'}` : 'Reply'}</Text>
                  </TouchableOpacity>
                  {canDelete(m) ? <TouchableOpacity onPress={() => onDelete(m)} hitSlop={6}><Text style={styles.del}>Delete</Text></TouchableOpacity> : null}
                </View>

                {openId === m.id ? (
                  <View style={styles.thread}>
                    {replies.map(r => (
                      <View key={r.id} style={styles.reply}>
                        <View style={styles.cardHead}>
                          <Text style={styles.replyAuthor}>{r.authorName}</Text>
                          <Text style={styles.time}>{relTime(r.createdAt)}</Text>
                        </View>
                        <Text style={styles.replyBody}>{r.body}</Text>
                        {canDelete(r) ? <TouchableOpacity onPress={() => onDelete(r)} hitSlop={6}><Text style={styles.delSmall}>Delete</Text></TouchableOpacity> : null}
                      </View>
                    ))}
                    <View style={styles.replyRow}>
                      <TextInput style={styles.replyInput} value={replyText} onChangeText={setReplyText} placeholder="Write a reply…" placeholderTextColor="#667" multiline />
                      <TouchableOpacity style={[styles.replySend, (!replyText.trim() || posting) && { opacity: 0.4 }]} disabled={!replyText.trim() || posting} onPress={() => send('chat', replyText, m.id)}>
                        <Text style={styles.replySendTxt}>Send</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}
              </View>
            ))}
        </ScrollView>

        {canCompose ? (
          <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
            <TextInput style={styles.input} value={composeText} onChangeText={setComposeText}
              placeholder={segment === 'announcement' ? 'Write an announcement to the team…' : 'Message the team…'} placeholderTextColor="#667" multiline />
            <TouchableOpacity style={[styles.sendBtn, (!composeText.trim() || posting) && { opacity: 0.4 }]} disabled={!composeText.trim() || posting} onPress={() => send(segment, composeText, null)}>
              <Text style={styles.sendTxt}>{posting ? '…' : segment === 'announcement' ? 'Post' : 'Send'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.composer}><Text style={styles.coachOnly}>Only coaches can post announcements. Switch to 💬 Team Chat to post.</Text></View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e1b2c' },
  back: { color: '#ff6a2c', fontSize: 14, fontWeight: '700' },
  title: { color: '#f1f4f6', fontSize: 22, fontWeight: '800' },
  subtitle: { color: '#8b96a3', fontSize: 14, fontWeight: '600', marginBottom: 12 },
  segRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  seg: { flex: 1, backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 999, paddingVertical: 9, alignItems: 'center' },
  segOn: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
  segTxt: { color: '#c7d2dc', fontSize: 13, fontWeight: '800' },
  segTxtOn: { color: '#fff' },
  empty: { color: '#8b96a3', fontSize: 15, textAlign: 'center', marginTop: 40, lineHeight: 22 },
  card: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 12, padding: 13, marginBottom: 10 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  author: { color: '#8b7bff', fontSize: 13.5, fontWeight: '800' },
  time: { color: '#62707e', fontSize: 12, fontWeight: '600' },
  body: { color: '#e7edf2', fontSize: 15, lineHeight: 21 },
  cardFoot: { flexDirection: 'row', gap: 18, marginTop: 10, alignItems: 'center' },
  footBtn: { color: '#9db0bd', fontSize: 13, fontWeight: '700' },
  del: { color: '#c0392b', fontSize: 13, fontWeight: '700' },
  thread: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#25333f', paddingTop: 10, gap: 10 },
  reply: { backgroundColor: '#0e1b2c', borderRadius: 9, padding: 10 },
  replyAuthor: { color: '#6ea8ff', fontSize: 12.5, fontWeight: '800' },
  replyBody: { color: '#d6dee6', fontSize: 14, lineHeight: 20 },
  delSmall: { color: '#a5483f', fontSize: 11.5, fontWeight: '700', marginTop: 6 },
  replyRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  replyInput: { flex: 1, backgroundColor: '#0e1b2c', borderColor: '#25333f', borderWidth: 1, borderRadius: 9, color: '#f1f4f6', paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, maxHeight: 100 },
  replySend: { backgroundColor: '#534AB7', borderRadius: 9, paddingHorizontal: 14, paddingVertical: 9 },
  replySendTxt: { color: '#fff', fontSize: 13, fontWeight: '800' },
  composer: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#1b2735', backgroundColor: '#0e1b2c' },
  input: { flex: 1, backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 10, color: '#f1f4f6', paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, maxHeight: 120 },
  sendBtn: { backgroundColor: '#ff6a2c', borderRadius: 10, paddingHorizontal: 18, paddingVertical: 11 },
  sendTxt: { color: '#160b02', fontSize: 14, fontWeight: '800' },
  coachOnly: { color: '#8b96a3', fontSize: 13, paddingVertical: 12, textAlign: 'center', flex: 1 },
});

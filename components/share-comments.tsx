// Coaches' Corner comment thread for one shared item (share_comments table).
// Coach-only by RLS (is_team_coach of the share's team), so everyone here is a
// coach — we show the author's display name (which they set in Account; e.g.
// "Coach Masten") with no forced prefix. Collapsed by default with a count;
// expands to the thread + a post box. Author can long-press their own to delete.
import { useTeamContext } from '@/context';
import { supabase } from '@/supabase';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

type Comment = { id: string; body: string; createdAt: string; authorId: string; authorName: string; isMine: boolean };

function ago(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function ShareComments({ shareId }: { shareId: string }) {
  const { userId } = useTeamContext();
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);

  // Cheap count for the collapsed toggle — head:true returns no rows.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { count: n } = await supabase.from('share_comments')
        .select('id', { count: 'exact', head: true }).eq('share_id', shareId);
      if (!cancelled) setCount(n ?? 0);
    })();
    return () => { cancelled = true; };
  }, [shareId]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('share_comments')
      .select('id, body, created_at, author_user_id')
      .eq('share_id', shareId).order('created_at', { ascending: true });
    if (error) { setLoading(false); Alert.alert('Error', error.message); return; }
    const rows = data || [];
    // Resolve author names once per distinct author (RLS-gated RPC; falls back to "Coach").
    const ids = [...new Set(rows.map((r: any) => r.author_user_id as string))];
    const nameById = new Map<string, string>();
    await Promise.all(ids.map(async (id) => {
      try { const { data: n } = await supabase.rpc('get_user_display_name', { p_user_id: id }); nameById.set(id, typeof n === 'string' && n ? n : 'Coach'); }
      catch { nameById.set(id, 'Coach'); }
    }));
    setComments(rows.map((r: any) => ({
      id: r.id, body: r.body, createdAt: r.created_at, authorId: r.author_user_id,
      authorName: nameById.get(r.author_user_id) || 'Coach', isMine: r.author_user_id === userId,
    })));
    setCount(rows.length);
    setLoading(false);
  }, [shareId, userId]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && comments.length === 0) load();
  }

  async function post() {
    const body = draft.trim();
    if (!body || !userId) return;
    setPosting(true);
    const { error } = await supabase.from('share_comments').insert({ share_id: shareId, author_user_id: userId, body });
    setPosting(false);
    if (error) { Alert.alert('Couldn’t post', error.message); return; }
    setDraft('');
    load();
  }

  function remove(id: string) {
    Alert.alert('Delete comment', 'Remove your comment?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('share_comments').delete().eq('id', id);
        if (error) Alert.alert('Error', error.message); else load();
      } },
    ]);
  }

  return (
    <View style={styles.wrap}>
      <TouchableOpacity onPress={toggle} hitSlop={8}>
        <Text style={styles.toggle}>
          💬 {count === null ? '' : count > 0 ? `${count} ${count === 1 ? 'comment' : 'comments'}` : 'Add a comment'}{open ? '  ▲' : count ? '  ▼' : ''}
        </Text>
      </TouchableOpacity>

      {open && (
        <View style={styles.thread}>
          {loading ? (
            <ActivityIndicator color="#534AB7" style={{ marginVertical: 8 }} />
          ) : (
            comments.map(c => (
              <TouchableOpacity key={c.id} activeOpacity={1} onLongPress={() => c.isMine && remove(c.id)} style={styles.comment}>
                <Text style={styles.meta}>
                  <Text style={styles.author}>{c.authorName}{c.isMine ? ' (you)' : ''}</Text>{`  ·  ${ago(c.createdAt)}`}
                </Text>
                <Text style={styles.body}>{c.body}</Text>
              </TouchableOpacity>
            ))
          )}
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="Write to your staff…"
              placeholderTextColor="#666"
              multiline
              maxLength={2000}
              editable={!posting}
            />
            <TouchableOpacity style={[styles.postBtn, (!draft.trim() || posting) && { opacity: 0.5 }]} onPress={post} disabled={!draft.trim() || posting}>
              <Text style={styles.postText}>{posting ? '…' : 'Post'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10, borderTopWidth: 1, borderTopColor: '#2a2a2a', paddingTop: 8 },
  toggle: { color: '#a99cf0', fontSize: 13, fontWeight: '700' },
  thread: { marginTop: 8, gap: 8 },
  comment: { backgroundColor: '#141414', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#262626' },
  meta: { fontSize: 11, color: '#888', marginBottom: 3 },
  author: { color: '#cbd0ff', fontWeight: '700' },
  body: { color: '#eee', fontSize: 14, lineHeight: 19 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 2 },
  input: { flex: 1, backgroundColor: '#0e0e0e', borderRadius: 8, borderWidth: 1, borderColor: '#333', color: '#fff', fontSize: 14, padding: 10, maxHeight: 120 },
  postBtn: { backgroundColor: '#534AB7', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 },
  postText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});

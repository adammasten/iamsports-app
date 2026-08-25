// Tagging Job detail — the shared surface for both parties. Shows the game,
// status, instructions, and the private message thread. Actions are role- and
// status-aware: the tagger starts/tags/marks-complete; the owner reviews, requests
// changes, or finalizes. Finalizing is the only thing that blesses the work.
import { useTeamContext } from '@/context';
import {
  cancelJob, completeJob, declineJob, finalizeJob, listGameVideos, listJobMessages,
  listMyTaggingJobs, postJobMessage, requestChanges, startJob, STATUS_LABEL,
  type GameVideo, type JobMessage, type TaggingJob,
} from '@/lib/core/tagging-jobs';
import { goBackOrHome } from '@/lib/nav';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import WebTopNav from './components/WebTopNav';

function webAlert(title: string, message: string) {
  if (Platform.OS === 'web') { if (typeof window !== 'undefined') window.alert(message); return; }
  Alert.alert(title, message);
}

export default function TaggingJobScreen() {
  const { userId } = useTeamContext();
  const params = useLocalSearchParams();
  const jobId = Array.isArray(params.jobId) ? params.jobId[0] : (params.jobId as string);

  const [job, setJob] = useState<TaggingJob | null>(null);
  const [videos, setVideos] = useState<GameVideo[]>([]);
  const [messages, setMessages] = useState<JobMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const all = await listMyTaggingJobs();
      const j = all.find(x => x.id === jobId) ?? null;
      setJob(j);
      const [vids, msgs] = await Promise.all([
        j ? listGameVideos(j.gameId).catch(() => []) : Promise.resolve([]),
        listJobMessages(jobId).catch(() => []),
      ]);
      setVideos(vids);
      setMessages(msgs);
    } catch (e: any) { webAlert('Job', e?.message ?? 'Could not load the job.'); }
    finally { setLoading(false); }
  }, [jobId]);
  useEffect(() => { if (userId) load(); }, [userId, load]);

  async function act(fn: () => Promise<void>, okMsg?: string) {
    setBusy(true);
    try { await fn(); await load(); if (okMsg) webAlert('Done', okMsg); }
    catch (e: any) { webAlert('Action', e?.message ?? 'That action failed.'); }
    finally { setBusy(false); }
  }
  async function send() {
    const body = msg.trim();
    if (!body) return;
    setMsg('');
    try { await postJobMessage(jobId, body); setMessages(await listJobMessages(jobId)); }
    catch (e: any) { webAlert('Message', e?.message ?? 'Could not send.'); setMsg(body); }
  }
  const openTag = (v: GameVideo, watch = false) =>
    router.push({ pathname: '/tagging-overlay', params: { videoId: v.id, url: v.url ?? '', label: v.label ?? '', ...(watch ? { watch: '1' } : {}) } });

  if (loading) return <View style={styles.screen}><ActivityIndicator color="#8b7bff" style={{ marginTop: 80 }} /></View>;
  if (!job) return (
    <View style={styles.screen}>
      {Platform.OS === 'web' ? <WebTopNav /> : null}
      <View style={styles.content}><Pressable onPress={goBackOrHome}><Text style={styles.backTxt}>← Back</Text></Pressable>
        <Text style={styles.empty}>This job isn’t available.</Text></View>
    </View>
  );

  const isTagger = job.role === 'tagger';
  const isOwner = job.role === 'owner';
  const canTagNow = isTagger && (job.status === 'in_progress' || job.status === 'changes_requested');

  return (
    <View style={styles.screen}>
      {Platform.OS === 'web' ? <WebTopNav /> : null}
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={goBackOrHome} hitSlop={8} style={styles.back}><Text style={styles.backTxt}>← Back</Text></Pressable>

        <Text style={styles.h1} numberOfLines={2}>{job.gameTitle}</Text>
        <Text style={styles.meta}>
          {isTagger ? `From ${job.counterpartName}` : `Tagger: ${job.counterpartName}`}
          {job.teamName ? ` · ${job.teamName}` : ''}
        </Text>
        <View style={styles.statusRow}>
          <Text style={styles.statusPill}>{STATUS_LABEL[job.status]}</Text>
          {job.dueAt ? <Text style={styles.due}>Due {new Date(job.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text> : null}
          {job.revisions > 0 ? <Text style={styles.due}>· {job.revisions} revision{job.revisions === 1 ? '' : 's'}</Text> : null}
        </View>

        {job.instructions ? (
          <View style={styles.block}>
            <Text style={styles.blockLabel}>Instructions</Text>
            <Text style={styles.blockBody}>{job.instructions}</Text>
          </View>
        ) : null}

        {/* Status hint */}
        <Text style={styles.hint}>
          {isTagger && job.status === 'new' && 'Start the job to begin tagging, or decline it.'}
          {isTagger && canTagNow && 'Tag each video below, then mark the job complete.'}
          {isTagger && job.status === 'review' && `Sent for review — waiting on ${job.counterpartName} to finalize.`}
          {isOwner && job.status === 'new' && `Waiting for ${job.counterpartName} to start.`}
          {isOwner && job.status === 'in_progress' && `${job.counterpartName} is tagging.`}
          {isOwner && job.status === 'review' && 'Review the tagged game, then finalize or request changes.'}
          {isOwner && job.status === 'changes_requested' && `Changes requested — waiting on ${job.counterpartName}.`}
          {job.status === 'complete' && '✓ Completed.'}
          {job.status === 'canceled' && 'This job was canceled.'}
          {job.status === 'declined' && 'This job was declined.'}
        </Text>

        {/* Tagger: start / decline */}
        {isTagger && job.status === 'new' && (
          <View style={styles.btnRow}>
            <Pressable style={styles.primaryBtn} disabled={busy} onPress={() => act(() => startJob(jobId))}><Text style={styles.primaryTxt}>Start tagging</Text></Pressable>
            <Pressable style={styles.dangerBtn} disabled={busy} onPress={() => act(() => declineJob(jobId))}><Text style={styles.dangerTxt}>Decline</Text></Pressable>
          </View>
        )}

        {/* Video list — tagger tags; owner watches in review */}
        {(canTagNow || (isOwner && (job.status === 'review' || job.status === 'changes_requested' || job.status === 'complete'))) && videos.length > 0 && (
          <View style={styles.block}>
            <Text style={styles.blockLabel}>{canTagNow ? 'Tag these videos' : 'Review'}</Text>
            {videos.map((v, i) => (
              <View key={v.id} style={styles.vidRow}>
                <Text style={styles.vidLabel} numberOfLines={1}>{v.label || `Video ${i + 1}`}</Text>
                <Pressable style={styles.vidBtn} onPress={() => openTag(v, !canTagNow)}>
                  <Text style={styles.vidBtnTxt}>{canTagNow ? 'Tag ▸' : 'Watch ▸'}</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {/* Tagger: mark complete */}
        {canTagNow && (
          <Pressable style={[styles.primaryBtn, styles.fullBtn]} disabled={busy} onPress={() => act(() => completeJob(jobId), 'Marked complete — the owner will review it.')}>
            <Text style={styles.primaryTxt}>Mark complete</Text>
          </Pressable>
        )}

        {/* Owner: review actions */}
        {isOwner && (job.status === 'review' || job.status === 'changes_requested') && (
          <View style={styles.btnRow}>
            <Pressable style={styles.primaryBtn} disabled={busy} onPress={() => act(() => finalizeJob(jobId), 'Finalized. Tagging is marked complete.')}><Text style={styles.primaryTxt}>Finalize (approve)</Text></Pressable>
            {job.status === 'review' && (
              <Pressable style={styles.ghostBtn} disabled={busy} onPress={() => act(() => requestChanges(jobId), 'Sent back for changes.')}><Text style={styles.ghostTxt}>Request changes</Text></Pressable>
            )}
          </View>
        )}
        {isOwner && job.status !== 'complete' && job.status !== 'canceled' && job.status !== 'declined' && (
          <Pressable style={styles.cancelLink} disabled={busy} onPress={() => act(() => cancelJob(jobId))}><Text style={styles.cancelTxt}>Cancel job</Text></Pressable>
        )}

        {/* Thread */}
        <Text style={styles.blockLabel}>Messages</Text>
        <View style={styles.thread}>
          {messages.length === 0 ? <Text style={styles.threadEmpty}>No messages yet. Use this to agree on exactly what to tag.</Text> :
            messages.map(m => (
              <View key={m.id} style={[styles.bubble, m.isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
                {!m.isMine ? <Text style={styles.bubbleAuthor}>{m.authorName}</Text> : null}
                <Text style={styles.bubbleBody}>{m.body}</Text>
              </View>
            ))}
        </View>
        <View style={styles.msgRow}>
          <TextInput style={styles.msgInput} value={msg} onChangeText={setMsg} placeholder="Message…" placeholderTextColor="#66748a" onSubmitEditing={send} returnKeyType="send" />
          <Pressable style={[styles.msgBtn, !msg.trim() && { opacity: 0.5 }]} disabled={!msg.trim()} onPress={send}><Text style={styles.msgBtnTxt}>Send</Text></Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0e1b2c' },
  content: { padding: 20, maxWidth: 720, width: '100%', alignSelf: 'center' },
  back: { alignSelf: 'flex-start', paddingVertical: 6 },
  backTxt: { color: '#8b7bff', fontSize: 14, fontWeight: '700' },
  h1: { color: '#f1f4f6', fontSize: 24, fontWeight: '800', letterSpacing: -0.4, marginTop: 8 },
  meta: { color: '#9db0bd', fontSize: 14, marginTop: 6 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' },
  statusPill: { color: '#c7bdf7', backgroundColor: '#2a2350', borderColor: '#8b7bff', borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 4, fontSize: 12.5, fontWeight: '800' },
  due: { color: '#8b96a3', fontSize: 13, fontWeight: '600' },
  block: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 16 },
  blockLabel: { color: '#8090a0', fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 18, marginBottom: 8 },
  blockBody: { color: '#e4ebf1', fontSize: 15, lineHeight: 21 },
  hint: { color: '#9db0bd', fontSize: 14, marginTop: 14, lineHeight: 20 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 14, flexWrap: 'wrap' },
  fullBtn: { marginTop: 14, alignSelf: 'stretch' },
  primaryBtn: { backgroundColor: '#8b7bff', borderRadius: 11, paddingVertical: 13, paddingHorizontal: 18, alignItems: 'center' },
  primaryTxt: { color: '#140b02', fontSize: 14.5, fontWeight: '800' },
  ghostBtn: { borderColor: '#3a3560', borderWidth: 1, borderRadius: 11, paddingVertical: 13, paddingHorizontal: 18, justifyContent: 'center' },
  ghostTxt: { color: '#b9b1e8', fontSize: 14.5, fontWeight: '700' },
  dangerBtn: { borderColor: '#5a2b2b', borderWidth: 1, borderRadius: 11, paddingVertical: 13, paddingHorizontal: 18, justifyContent: 'center' },
  dangerTxt: { color: '#e2574a', fontSize: 14.5, fontWeight: '700' },
  cancelLink: { marginTop: 16, alignSelf: 'flex-start' },
  cancelTxt: { color: '#e2574a', fontSize: 14, fontWeight: '700' },
  vidRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#23323f' },
  vidLabel: { color: '#f1f4f6', fontSize: 15, fontWeight: '600', flex: 1 },
  vidBtn: { backgroundColor: '#2a2350', borderColor: '#8b7bff', borderWidth: 1, borderRadius: 9, paddingHorizontal: 14, paddingVertical: 7 },
  vidBtnTxt: { color: '#c7bdf7', fontSize: 13.5, fontWeight: '800' },
  thread: { gap: 8, marginBottom: 12 },
  threadEmpty: { color: '#7a8794', fontSize: 13.5, lineHeight: 19 },
  bubble: { borderRadius: 12, padding: 11, maxWidth: '85%' },
  bubbleMine: { backgroundColor: '#2a2350', alignSelf: 'flex-end' },
  bubbleTheirs: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, alignSelf: 'flex-start' },
  bubbleAuthor: { color: '#8b7bff', fontSize: 11.5, fontWeight: '800', marginBottom: 3 },
  bubbleBody: { color: '#e4ebf1', fontSize: 14.5, lineHeight: 20 },
  msgRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 4 },
  msgInput: { flex: 1, backgroundColor: '#0e1b2c', borderColor: '#2f4152', borderWidth: 1, borderRadius: 10, color: '#f1f4f6', paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  msgBtn: { backgroundColor: '#8b7bff', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
  msgBtnTxt: { color: '#140b02', fontSize: 14, fontWeight: '800' },
  empty: { color: '#8b96a3', fontSize: 15, textAlign: 'center', marginTop: 40 },
});

// Tagging Jobs — the hub for the paid Tagger workflow. Shows every job you're
// party to (as the tagger doing the work, and as the owner who sent games out),
// split active vs history, plus entry points to send a game and manage My Taggers.
import { useTeamContext } from '@/context';
import { ACTIVE_STATUSES, listMyTaggingJobs, STATUS_LABEL, type TaggingJob, type TaggingJobStatus } from '@/lib/core/tagging-jobs';
import { goBackOrHome } from '@/lib/nav';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import WebTopNav from './components/WebTopNav';

const STATUS_COLOR: Record<TaggingJobStatus, string> = {
  new: '#8b7bff', in_progress: '#3aa0ff', review: '#e0a52e', changes_requested: '#e2574a',
  complete: '#1D9E75', canceled: '#7a8794', declined: '#7a8794',
};

function dueLabel(dueAt: string | null): string {
  if (!dueAt) return 'No due date';
  const d = new Date(dueAt);
  return `Due ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

export default function TaggingJobsScreen() {
  const { userId } = useTeamContext();
  const [jobs, setJobs] = useState<TaggingJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'active' | 'history'>('active');

  const load = useCallback(() => {
    setLoading(true);
    listMyTaggingJobs().then(setJobs).catch(() => setJobs([])).finally(() => setLoading(false));
  }, []);
  useFocusEffect(useCallback(() => { if (userId) load(); }, [userId, load]));

  const shown = useMemo(
    () => jobs.filter(j => (tab === 'active'
      ? ACTIVE_STATUSES.includes(j.status) && !(j.role === 'tagger' && j.releasedAt)
      : !ACTIVE_STATUSES.includes(j.status) || (j.role === 'tagger' && !!j.releasedAt))),
    [jobs, tab]);
  const asTagger = shown.filter(j => j.role === 'tagger');
  const asOwner = shown.filter(j => j.role === 'owner');

  const JobCard = ({ j }: { j: TaggingJob }) => (
    <Pressable style={styles.card} onPress={() => router.push({ pathname: '/tagging-job', params: { jobId: j.id } })}>
      <View style={styles.cardTop}>
        <Text style={styles.cardTitle} numberOfLines={1}>{j.gameTitle}</Text>
        <View style={[styles.pill, { backgroundColor: STATUS_COLOR[j.status] + '22', borderColor: STATUS_COLOR[j.status] }]}>
          <Text style={[styles.pillTxt, { color: STATUS_COLOR[j.status] }]}>{STATUS_LABEL[j.status]}</Text>
        </View>
      </View>
      <Text style={styles.cardMeta} numberOfLines={1}>
        {j.role === 'tagger' ? `From ${j.counterpartName}` : `Tagger: ${j.counterpartName}`}
        {j.teamName ? ` · ${j.teamName}` : ''} · {j.videoCount} video{j.videoCount === 1 ? '' : 's'}
      </Text>
      <Text style={styles.cardDue}>{dueLabel(j.dueAt)}{j.revisions > 0 ? ` · rev ${j.revisions}` : ''}</Text>
    </Pressable>
  );

  return (
    <View style={styles.screen}>
      {Platform.OS === 'web' ? <WebTopNav /> : null}
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={goBackOrHome} hitSlop={8} style={styles.back}><Text style={styles.backTxt}>← Back</Text></Pressable>
        <Text style={styles.eyebrow}>TAGGING JOBS</Text>
        <Text style={styles.h1}>Your tagging work</Text>
        <Text style={styles.sub}>Games you’re tagging for others, and games you’ve sent out to be tagged.</Text>

        <View style={styles.actionRow}>
          <Pressable style={styles.primaryBtn} onPress={() => router.push('/send-to-tagger')}>
            <Text style={styles.primaryBtnTxt}>＋ Send a game to a tagger</Text>
          </Pressable>
          <Pressable style={styles.ghostBtn} onPress={() => router.push('/taggers')}>
            <Text style={styles.ghostBtnTxt}>My taggers</Text>
          </Pressable>
        </View>

        <View style={styles.tabs}>
          {(['active', 'history'] as const).map(t => (
            <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabOn]}>
              <Text style={[styles.tabTxt, tab === t && styles.tabTxtOn]}>{t === 'active' ? 'Active' : 'History'}</Text>
            </Pressable>
          ))}
        </View>

        {loading ? <ActivityIndicator color="#8b7bff" style={{ marginTop: 30 }} /> : (
          <>
            {asTagger.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>I’m tagging these</Text>
                {asTagger.map(j => <JobCard key={j.id} j={j} />)}
              </>
            )}
            {asOwner.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>I sent these out</Text>
                {asOwner.map(j => <JobCard key={j.id} j={j} />)}
              </>
            )}
            {shown.length === 0 && (
              <Text style={styles.empty}>
                {tab === 'active' ? 'No active tagging jobs. Send a game to a tagger to get started.' : 'Nothing here yet.'}
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0e1b2c' },
  content: { padding: 20, maxWidth: 820, width: '100%', alignSelf: 'center' },
  back: { alignSelf: 'flex-start', paddingVertical: 6 },
  backTxt: { color: '#8b7bff', fontSize: 14, fontWeight: '700' },
  eyebrow: { color: '#8b7bff', fontSize: 12, fontWeight: '800', letterSpacing: 1.6, marginTop: 8 },
  h1: { color: '#f1f4f6', fontSize: 26, fontWeight: '800', letterSpacing: -0.5, marginTop: 6 },
  sub: { color: '#9db0bd', fontSize: 14, marginTop: 6, marginBottom: 16, lineHeight: 20 },
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 16, flexWrap: 'wrap' },
  primaryBtn: { backgroundColor: '#8b7bff', borderRadius: 11, paddingVertical: 12, paddingHorizontal: 16 },
  primaryBtnTxt: { color: '#140b02', fontSize: 14, fontWeight: '800' },
  ghostBtn: { borderColor: '#3a3560', borderWidth: 1, borderRadius: 11, paddingVertical: 12, paddingHorizontal: 16, justifyContent: 'center' },
  ghostBtnTxt: { color: '#b9b1e8', fontSize: 14, fontWeight: '700' },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  tab: { paddingVertical: 7, paddingHorizontal: 16, borderRadius: 999, backgroundColor: '#16232f', borderWidth: 1, borderColor: '#25333f' },
  tabOn: { backgroundColor: '#2a2350', borderColor: '#8b7bff' },
  tabTxt: { color: '#c7d2dc', fontSize: 13, fontWeight: '700' },
  tabTxtOn: { color: '#c7bdf7' },
  sectionLabel: { color: '#8090a0', fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 14, marginBottom: 8 },
  card: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 14, padding: 15, marginBottom: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { color: '#f1f4f6', fontSize: 16, fontWeight: '700', flex: 1 },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  pillTxt: { fontSize: 11.5, fontWeight: '800' },
  cardMeta: { color: '#9db0bd', fontSize: 13, marginTop: 6 },
  cardDue: { color: '#7a8794', fontSize: 12.5, marginTop: 3, fontWeight: '600' },
  empty: { color: '#8b96a3', fontSize: 15, textAlign: 'center', marginTop: 34, lineHeight: 22 },
});

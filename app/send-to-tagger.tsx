// Send to Tagger — the owner assigns a game to one of their taggers: pick the game
// (or arrive with one), pick the tagger, set a due date + instructions → creates the
// job and fans a tagging grant out across the game's videos (create_tagging_job RPC).
import { COACH_ROLES, useTeamContext } from '@/context';
import { createTaggingJob, listCoachGames, listMyTaggers, type CoachGame, type Tagger } from '@/lib/core/tagging-jobs';
import { goBackOrHome } from '@/lib/nav';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import WebTopNav from './components/WebTopNav';

function webAlert(title: string, message: string) {
  if (Platform.OS === 'web') { if (typeof window !== 'undefined') window.alert(message); return; }
  Alert.alert(title, message);
}

const DUE_PRESETS: { key: string; label: string; days: number | null }[] = [
  { key: 'none', label: 'No due date', days: null },
  { key: 'tmrw', label: 'Tomorrow', days: 1 },
  { key: '3d', label: 'In 3 days', days: 3 },
  { key: 'wk', label: 'Next week', days: 7 },
];

export default function SendToTaggerScreen() {
  const { userTeams } = useTeamContext();
  const params = useLocalSearchParams();
  const presetGameId = Array.isArray(params.gameId) ? params.gameId[0] : (params.gameId as string | undefined);

  const coachTeamIds = useMemo(() => userTeams.filter(t => COACH_ROLES.includes(t.role)).map(t => t.team_id), [userTeams]);
  const [games, setGames] = useState<CoachGame[]>([]);
  const [taggers, setTaggers] = useState<Tagger[]>([]);
  const [loading, setLoading] = useState(true);

  const [gameId, setGameId] = useState<string | null>(presetGameId ?? null);
  const [taggerId, setTaggerId] = useState<string | null>(null);
  const [duePreset, setDuePreset] = useState<string>('wk');
  const [instructions, setInstructions] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([listCoachGames(coachTeamIds), listMyTaggers()])
      .then(([g, t]) => { setGames(g); setTaggers(t); if (t.length === 1) setTaggerId(t[0].userId); })
      .catch(e => webAlert('Send to tagger', e?.message ?? 'Could not load.'))
      .finally(() => setLoading(false));
  }, [coachTeamIds]);

  function dueIso(): string | null {
    const p = DUE_PRESETS.find(x => x.key === duePreset);
    if (!p || p.days == null) return null;
    const d = new Date();
    d.setDate(d.getDate() + p.days);
    d.setHours(18, 0, 0, 0);
    return d.toISOString();
  }

  async function send() {
    if (!gameId) { webAlert('Send to tagger', 'Pick a game to send.'); return; }
    if (!taggerId) { webAlert('Send to tagger', 'Pick a tagger.'); return; }
    setSending(true);
    try {
      const jobId = await createTaggingJob({ gameId, taggerUserId: taggerId, dueAt: dueIso(), instructions: instructions.trim() || null });
      router.replace({ pathname: '/tagging-job', params: { jobId } });
    } catch (e: any) { webAlert('Send to tagger', e?.message ?? 'Could not send the job.'); setSending(false); }
  }

  const fixedGame = presetGameId ? games.find(g => g.id === presetGameId) : null;

  return (
    <View style={styles.screen}>
      {Platform.OS === 'web' ? <WebTopNav /> : null}
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={goBackOrHome} hitSlop={8} style={styles.back}><Text style={styles.backTxt}>← Back</Text></Pressable>
        <Text style={styles.eyebrow}>SEND TO TAGGER</Text>
        <Text style={styles.h1}>Assign a game</Text>

        {loading ? <ActivityIndicator color="#8b7bff" style={{ marginTop: 30 }} /> : (
          <>
            {/* Tagger */}
            <Text style={styles.sectionLabel}>Tagger</Text>
            {taggers.length === 0 ? (
              <Pressable style={styles.linkCard} onPress={() => router.push('/taggers')}>
                <Text style={styles.linkCardTxt}>You have no taggers yet — add one by code →</Text>
              </Pressable>
            ) : (
              <View style={styles.chipWrap}>
                {taggers.map(t => (
                  <Pressable key={t.userId} onPress={() => setTaggerId(t.userId)} style={[styles.chip, taggerId === t.userId && styles.chipOn]}>
                    <Text style={[styles.chipTxt, taggerId === t.userId && styles.chipTxtOn]}>{t.displayName}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {/* Game */}
            <Text style={styles.sectionLabel}>Game</Text>
            {fixedGame ? (
              <View style={styles.fixedGame}><Text style={styles.fixedGameTxt}>{fixedGame.title}</Text></View>
            ) : games.length === 0 ? (
              <Text style={styles.empty}>No games found on your teams.</Text>
            ) : (
              <View style={styles.gameList}>
                {games.slice(0, 40).map(g => (
                  <Pressable key={g.id} onPress={() => setGameId(g.id)} style={[styles.gameRow, gameId === g.id && styles.gameRowOn]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.gameTitle} numberOfLines={1}>{g.title}</Text>
                      <Text style={styles.gameMeta}>{g.teamName}{g.date ? ` · ${new Date(g.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}</Text>
                    </View>
                    {gameId === g.id ? <Text style={styles.check}>✓</Text> : null}
                  </Pressable>
                ))}
              </View>
            )}

            {/* Due date */}
            <Text style={styles.sectionLabel}>Due</Text>
            <View style={styles.chipWrap}>
              {DUE_PRESETS.map(p => (
                <Pressable key={p.key} onPress={() => setDuePreset(p.key)} style={[styles.chip, duePreset === p.key && styles.chipOn]}>
                  <Text style={[styles.chipTxt, duePreset === p.key && styles.chipTxtOn]}>{p.label}</Text>
                </Pressable>
              ))}
            </View>

            {/* Instructions */}
            <Text style={styles.sectionLabel}>Instructions</Text>
            <TextInput
              style={styles.instructions}
              value={instructions}
              onChangeText={setInstructions}
              placeholder="What do you want tagged? e.g. Tag every possession, star made 3s, note turnovers."
              placeholderTextColor="#66748a"
              multiline
            />

            <Pressable style={[styles.sendBtn, (sending || !gameId || !taggerId) && { opacity: 0.5 }]} disabled={sending || !gameId || !taggerId} onPress={send}>
              <Text style={styles.sendTxt}>{sending ? 'Sending…' : 'Send game to tagger'}</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0e1b2c' },
  content: { padding: 20, maxWidth: 720, width: '100%', alignSelf: 'center' },
  back: { alignSelf: 'flex-start', paddingVertical: 6 },
  backTxt: { color: '#8b7bff', fontSize: 14, fontWeight: '700' },
  eyebrow: { color: '#8b7bff', fontSize: 12, fontWeight: '800', letterSpacing: 1.6, marginTop: 8 },
  h1: { color: '#f1f4f6', fontSize: 26, fontWeight: '800', letterSpacing: -0.5, marginTop: 6, marginBottom: 8 },
  sectionLabel: { color: '#8090a0', fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 20, marginBottom: 10 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  chipOn: { backgroundColor: '#2a2350', borderColor: '#8b7bff' },
  chipTxt: { color: '#c7d2dc', fontSize: 13.5, fontWeight: '700' },
  chipTxtOn: { color: '#c7bdf7' },
  linkCard: { backgroundColor: '#16232f', borderColor: '#8b7bff', borderWidth: 1, borderRadius: 12, padding: 14 },
  linkCardTxt: { color: '#b9b1e8', fontSize: 14, fontWeight: '700' },
  fixedGame: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 12, padding: 14 },
  fixedGameTxt: { color: '#f1f4f6', fontSize: 16, fontWeight: '700' },
  gameList: { gap: 8 },
  gameRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  gameRowOn: { borderColor: '#8b7bff', backgroundColor: '#1b2740' },
  gameTitle: { color: '#f1f4f6', fontSize: 15, fontWeight: '700' },
  gameMeta: { color: '#8b96a3', fontSize: 12.5, marginTop: 2 },
  check: { color: '#8b7bff', fontSize: 18, fontWeight: '800', marginLeft: 10 },
  instructions: { backgroundColor: '#0e1b2c', borderColor: '#2f4152', borderWidth: 1, borderRadius: 12, color: '#f1f4f6', padding: 12, fontSize: 15, minHeight: 96, textAlignVertical: 'top' },
  sendBtn: { backgroundColor: '#8b7bff', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 26 },
  sendTxt: { color: '#140b02', fontSize: 15, fontWeight: '800' },
  empty: { color: '#8b96a3', fontSize: 15, marginTop: 8 },
});

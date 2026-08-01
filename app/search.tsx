// Global home search. "Search everything" (vs the team page's scoped filter):
// debounced search_all across players / teams / games / reels — RLS-scoped, so
// results are only what you're entitled to see. Results grouped by type, each
// row deep-links to its detail. Recent searches shown before typing.
import { useTeamContext } from '@/context';
import { goBackOrHome } from '@/lib/nav';
import { supabase } from '@/supabase';
import { TeamLogo } from '@/components/team-logo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const RECENTS_KEY = 'iamsports.recent_searches';

type Player = { id: string; name: string };
type Team = { id: string; name: string; logo_path: string | null };
type Game = { id: string; title: string; opponent: string | null; game_date: string | null; team_id: string };
type Reel = { id: string; name: string; storage_path: string | null };
type Results = { players: Player[]; teams: Team[]; games: Game[]; reels: Reel[] };
const EMPTY: Results = { players: [], teams: [], games: [], reels: [] };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionHeader}>{title}</Text>
      {children}
    </View>
  );
}

function SearchRow({ leading, title, subtitle, onPress }: { leading: React.ReactNode; title: string; subtitle?: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.leading}>{leading}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.rowSub} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

function IconCircle({ name }: { name: React.ComponentProps<typeof Ionicons>['name'] }) {
  return <View style={styles.iconCircle}><Ionicons name={name} size={18} color="#b9b1e8" /></View>;
}

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const { setActiveTeam } = useTeamContext();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Results>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(RECENTS_KEY).then(v => { if (v) setRecents(JSON.parse(v)); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const raw = q.trim();
    if (raw.length < 2) { setRes(EMPTY); setLoading(false); return; }
    setLoading(true);
    timer.current = setTimeout(async () => {
      const { data } = await supabase.rpc('search_all', { q: raw });
      setRes((data as Results) ?? EMPTY);
      setLoading(false);
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  function remember() {
    const term = q.trim();
    if (term.length < 2) return;
    const next = [term, ...recents.filter(r => r !== term)].slice(0, 6);
    setRecents(next);
    AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(next)).catch(() => {});
  }

  const total = res.players.length + res.teams.length + res.games.length + res.reels.length;
  const showResults = q.trim().length >= 2;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.searchRow}>
        <View style={styles.inputWrap}>
          <Ionicons name="search" size={16} color="#888" />
          <TextInput
            style={styles.input}
            value={q}
            onChangeText={setQ}
            placeholder="Search everything"
            placeholderTextColor="#777"
            autoFocus
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {q.length > 0 && (
            <TouchableOpacity onPress={() => setQ('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color="#666" />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity onPress={goBackOrHome} hitSlop={8}><Text style={styles.cancel}>Cancel</Text></TouchableOpacity>
      </View>

      {!showResults ? (
        recents.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>Recent</Text>
            {recents.map(r => (
              <TouchableOpacity key={r} style={styles.row} onPress={() => setQ(r)}>
                <View style={styles.leading}><Ionicons name="time-outline" size={18} color="#888" /></View>
                <Text style={styles.rowTitle}>{r}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <Text style={styles.hint}>Search across all your teams, kids, games, and reels.</Text>
        )
      ) : loading ? (
        <ActivityIndicator size="large" color="#534AB7" style={{ marginTop: 30 }} />
      ) : total === 0 ? (
        <Text style={styles.empty}>No matches for “{q.trim()}”.{'\n'}Try a player, team, game, or reel name.</Text>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {res.players.length > 0 && (
            <Section title="Players">
              {res.players.map(p => (
                <SearchRow key={p.id} leading={<IconCircle name="person" />} title={p.name}
                  onPress={() => { remember(); router.push({ pathname: '/kid', params: { playerId: p.id } }); }} />
              ))}
            </Section>
          )}
          {res.teams.length > 0 && (
            <Section title="Teams">
              {res.teams.map(t => (
                <SearchRow key={t.id} leading={<TeamLogo logoPath={t.logo_path} name={t.name} size={36} />} title={t.name}
                  onPress={() => { remember(); setActiveTeam(t.id); router.replace('/'); }} />
              ))}
            </Section>
          )}
          {res.games.length > 0 && (
            <Section title="Games">
              {res.games.map(g => (
                <SearchRow key={g.id} leading={<IconCircle name="basketball" />} title={g.title}
                  subtitle={g.opponent ? `vs ${g.opponent}` : (g.game_date ? new Date(g.game_date).toLocaleDateString() : undefined)}
                  onPress={() => { remember(); router.push({ pathname: '/game', params: { id: g.id, title: g.title } }); }} />
              ))}
            </Section>
          )}
          {res.reels.length > 0 && (
            <Section title="Reels">
              {res.reels.map(r => (
                <SearchRow key={r.id} leading={<IconCircle name="film" />} title={r.name}
                  onPress={() => { if (!r.storage_path) return; remember(); router.push({ pathname: '/shared-viewer', params: { title: r.name, storagePath: r.storage_path } }); }} />
              ))}
            </Section>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingHorizontal: 16 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#161616', borderRadius: 10, paddingHorizontal: 10, height: 40 },
  input: { flex: 1, color: '#fff', fontSize: 16 },
  cancel: { color: '#534AB7', fontSize: 15, fontWeight: '600' },
  section: { marginBottom: 18 },
  sectionHeader: { color: '#888', fontSize: 12, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  leading: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  iconCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#2a2540', alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  rowSub: { color: '#888', fontSize: 12, marginTop: 1 },
  hint: { color: '#666', fontSize: 14, textAlign: 'center', marginTop: 40, paddingHorizontal: 30, lineHeight: 20 },
  empty: { color: '#666', fontSize: 14, textAlign: 'center', marginTop: 40, lineHeight: 20 },
});

// Team settings (coach-only): the team's accent color + per-event-type snack
// sign-up toggles. Both are team-level columns on `teams` (coaches already hold
// UPDATE via RLS). Reached from the Schedule header when a single team is active.
import { COACH_ROLES, useTeamContext } from '@/context';
import { ACCENT_PALETTE } from '@/lib/core/schedule';
import { goBackOrHome } from '@/lib/nav';
import { supabase } from '@/supabase';
import { webAlert } from '@/lib/webAlert';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TeamSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { activeTeam, activeRole, refreshTeams } = useTeamContext();
  const isCoach = !!activeRole && COACH_ROLES.includes(activeRole);

  const [loading, setLoading] = useState(true);
  const [accent, setAccent] = useState<string | null>(null);
  const [snackGames, setSnackGames] = useState(true);
  const [snackPractices, setSnackPractices] = useState(false);

  const load = useCallback(async () => {
    if (!activeTeam) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from('teams')
      .select('accent_color, snacks_enabled_games, snacks_enabled_practices')
      .eq('id', activeTeam.id).maybeSingle();
    if (!error && data) {
      setAccent((data as any).accent_color ?? null);
      setSnackGames((data as any).snacks_enabled_games ?? true);
      setSnackPractices((data as any).snacks_enabled_practices ?? false);
    }
    setLoading(false);
  }, [activeTeam]);
  useEffect(() => { load(); }, [load]);

  // Persist a single column; revert local state + surface the error on failure.
  const save = useCallback(async (patch: Record<string, any>, revert: () => void) => {
    if (!activeTeam) return;
    const { error } = await supabase.from('teams').update(patch).eq('id', activeTeam.id);
    if (error) { revert(); webAlert('Could not save', error.message); return; }
    refreshTeams?.();
  }, [activeTeam, refreshTeams]);

  const pickAccent = (color: string) => {
    const prev = accent;
    setAccent(color);
    save({ accent_color: color }, () => setAccent(prev));
  };
  const toggleGames = (v: boolean) => { setSnackGames(v); save({ snacks_enabled_games: v }, () => setSnackGames(!v)); };
  const togglePractices = (v: boolean) => { setSnackPractices(v); save({ snacks_enabled_practices: v }, () => setSnackPractices(!v)); };

  const Frame = ({ children }: { children: React.ReactNode }) => (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.wrap}>
        <TouchableOpacity onPress={goBackOrHome} style={styles.back} hitSlop={8}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
        {children}
      </View>
    </View>
  );

  if (!activeTeam) return <Frame><Text style={styles.empty}>Pick a team from Home to edit its settings.</Text></Frame>;
  if (!isCoach) return <Frame><Text style={styles.empty}>Only coaches can change team settings.</Text></Frame>;

  return (
    <Frame>
      <Text style={styles.caption} numberOfLines={1}>{activeTeam.name}</Text>
      <Text style={styles.title}>Team settings</Text>
      {loading ? <ActivityIndicator color="#ff6a2c" style={{ marginTop: 30 }} /> : (
        <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
          {/* Accent color */}
          <Text style={styles.section}>Team color</Text>
          <Text style={styles.hint}>Marks this team on schedule cards. Only you and other coaches can change it.</Text>
          <View style={styles.swatches}>
            {ACCENT_PALETTE.map(c => (
              <TouchableOpacity key={c} onPress={() => pickAccent(c)} accessibilityLabel={`Set team color ${c}`}
                style={[styles.swatch, { backgroundColor: c }, accent === c && styles.swatchOn]}>
                {accent === c ? <Text style={styles.check}>✓</Text> : null}
              </TouchableOpacity>
            ))}
          </View>

          {/* Snack sign-ups */}
          <Text style={styles.section}>Snack sign-ups</Text>
          <Text style={styles.hint}>Show a snack sign-up on the schedule card for these event types.</Text>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Games</Text>
            <Switch value={snackGames} onValueChange={toggleGames}
              trackColor={{ true: '#3ec46d', false: '#2a3a48' }} thumbColor="#fff" />
          </View>
          <View style={[styles.toggleRow, styles.toggleRowLast]}>
            <Text style={styles.toggleLabel}>Practices</Text>
            <Switch value={snackPractices} onValueChange={togglePractices}
              trackColor={{ true: '#3ec46d', false: '#2a3a48' }} thumbColor="#fff" />
          </View>
          <Text style={styles.hint}>Turning a type off just hides the sign-up — it never deletes who already signed up.</Text>
        </ScrollView>
      )}
    </Frame>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e1b2c', paddingHorizontal: 20 },
  wrap: { flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center' },
  back: { paddingVertical: 8 },
  backText: { color: '#6ea8ff', fontSize: 16, fontWeight: '600' },
  caption: { color: '#8b96a3', fontSize: 12.5, fontWeight: '700', letterSpacing: 0.3, marginTop: 6 },
  title: { color: '#f1f4f6', fontSize: 26, fontWeight: '800', letterSpacing: -0.4, marginTop: 2, marginBottom: 8 },
  empty: { color: '#8b96a3', fontSize: 15, textAlign: 'center', marginTop: 40, lineHeight: 22 },

  section: { color: '#62707e', fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 22, marginBottom: 6 },
  hint: { color: '#8b96a3', fontSize: 13, lineHeight: 19, marginBottom: 12 },

  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  swatch: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  swatchOn: { borderColor: '#fff' },
  check: { color: '#fff', fontSize: 18, fontWeight: '900' },

  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#12202e', borderColor: '#1f2f3d', borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 8 },
  toggleRowLast: { marginBottom: 12 },
  toggleLabel: { color: '#f1f4f6', fontSize: 16, fontWeight: '600' },
});

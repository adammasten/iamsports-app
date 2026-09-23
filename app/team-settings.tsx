// Team settings (coach-only): the team's accent color + per-event-type snack
// sign-up toggles. Both are team-level columns on `teams` (coaches already hold
// UPDATE via RLS). Reached from the Schedule header when a single team is active.
import { COACH_ROLES, useTeamContext } from '@/context';
import { ACCENT_PALETTE } from '@/lib/core/schedule';
import { formatsForSport } from '@/lib/core/upload-meta';
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
  const [parentFilm, setParentFilm] = useState(true);
  // Sport variant (5v5 / 7v7 / 11v11). null = legacy: the sport's full vocabulary.
  const [format, setFormat] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeTeam) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from('teams')
      .select('accent_color, snacks_enabled_games, snacks_enabled_practices, parent_film_visible, format')
      .eq('id', activeTeam.id).maybeSingle();
    if (!error && data) {
      setAccent((data as any).accent_color ?? null);
      setSnackGames((data as any).snacks_enabled_games ?? true);
      setSnackPractices((data as any).snacks_enabled_practices ?? false);
      setParentFilm((data as any).parent_film_visible ?? true);
      setFormat((data as any).format ?? null);
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
  const toggleParentFilm = (v: boolean) => { setParentFilm(v); save({ parent_film_visible: v }, () => setParentFilm(!v)); };
  // Tapping the chip you're already on clears the format back to null (legacy).
  const pickFormat = (v: string) => { const prev = format; const next = format === v ? null : v; setFormat(next); save({ format: next }, () => setFormat(prev)); };

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
          {/* Format — only for sports that have variants (the football family today).
              Choosing one narrows what the tagger OFFERS for new tagging; it never
              changes what historical clips mean. Unset = the full vocabulary. */}
          {formatsForSport(activeTeam.sport).length > 0 ? (
            <>
              <Text style={styles.section}>Format</Text>
              <Text style={styles.hint}>How many players per side. Leave unset to keep the full {activeTeam.sport} vocabulary.</Text>
              <View style={styles.swatches}>
                {formatsForSport(activeTeam.sport).map(f => (
                  <TouchableOpacity key={f.value} onPress={() => pickFormat(f.value)} accessibilityLabel={`Set format ${f.label}`}
                    style={[styles.formatChip, format === f.value && styles.formatChipOn]}>
                    <Text style={[styles.formatChipText, format === f.value && styles.formatChipTextOn]}>{f.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          ) : null}

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

          {/* Family film — let parents see & make highlights of their own kid's tagged games */}
          <Text style={styles.section}>Family film</Text>
          <Text style={styles.hint}>Let parents see their own child&apos;s tagged games from your film — and make highlight reels of their positive plays. Parents only ever see their own kid, never other players.</Text>
          <View style={[styles.toggleRow, styles.toggleRowLast]}>
            <Text style={styles.toggleLabel}>Parents can use my film</Text>
            <Switch value={parentFilm} onValueChange={toggleParentFilm}
              trackColor={{ true: '#3ec46d', false: '#2a3a48' }} thumbColor="#fff" />
          </View>
          <Text style={styles.hint}>Off = parents don&apos;t get your team&apos;s film in their room. Their own uploads and anything you share directly are never affected.</Text>
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
  formatChip: { paddingHorizontal: 18, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#d8d8d8', backgroundColor: '#fff' },
  formatChipOn: { borderColor: '#ff6a2c', backgroundColor: '#fff1ea' },
  formatChipText: { fontSize: 15, fontWeight: '600', color: '#555' },
  formatChipTextOn: { color: '#ff6a2c' },
  swatchOn: { borderColor: '#fff' },
  check: { color: '#fff', fontSize: 18, fontWeight: '900' },

  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#12202e', borderColor: '#1f2f3d', borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 8 },
  toggleRowLast: { marginBottom: 12 },
  toggleLabel: { color: '#f1f4f6', fontSize: 16, fontWeight: '600' },
});

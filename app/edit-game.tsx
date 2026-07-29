import { useTeamContext } from '@/context';
import {
  dateToYMD, deriveResult, EVENT_TYPES, gameTitle, NEW_TOURNAMENT, SEASON_TERMS, SPORTS,
  type EventTypeKey,
} from '@/lib/core/upload-meta';
import { supabase } from '@/supabase';
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Dropdown, { type DropdownOption } from './components/Dropdown';

// Edit an existing game's basics — the same fields the upload screen writes,
// pre-filled and saved back. Game-level fields update the games row; the
// shared video attributes (event type / date / sport / player / season / team)
// cascade to EVERY video in the game so it stays internally consistent.
// Reached from the Film Room game card's long-press → "Edit game".
//
// Deliberately its own screen (not a refactor of upload.tsx) — upload is the
// #1 stability path and isn't worth risking to share one form. Reuses the
// shared Dropdown + upload-meta constants/helpers instead.

// Local YYYY-MM-DD → Date (never Date.parse on the string — that treats it as
// UTC midnight and shifts the day west of UTC).
function ymdToDate(s: string | null): Date {
  if (!s) return new Date();
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
}

export default function EditGameScreen() {
  const insets = useSafeAreaInsets();
  const { userId, userTeams, userKids } = useTeamContext();
  const params = useLocalSearchParams();
  const gameId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Prefilled fields (mirror the upload form, minus per-video Title).
  const [opponent, setOpponent] = useState('');
  const [vsAt, setVsAt] = useState<'vs' | 'at'>('vs');
  const [gameDate, setGameDate] = useState<Date>(new Date());
  const [teamId, setTeamId] = useState('');
  const [origTeamId, setOrigTeamId] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [sport, setSport] = useState('Basketball');
  const [seasonTerm, setSeasonTerm] = useState('');
  const [seasonYear, setSeasonYear] = useState(String(new Date().getFullYear()));
  const [tournamentId, setTournamentId] = useState('');
  const [newTournamentName, setNewTournamentName] = useState('');
  const [tournaments, setTournaments] = useState<{ id: string; name: string }[]>([]);
  const [teamScore, setTeamScore] = useState('');
  const [oppScore, setOppScore] = useState('');
  const [eventType, setEventType] = useState<EventTypeKey>('game');
  const [videoCount, setVideoCount] = useState(0);

  const activeTeam = teamId ? userTeams.find(t => t.team_id === teamId) : null;
  const teamChanged = teamId !== origTeamId;

  const derivedResult = deriveResult(
    teamScore === '' ? null : parseInt(teamScore, 10),
    oppScore === '' ? null : parseInt(oppScore, 10),
  );

  // Games REQUIRE a team (games.team_id is NOT NULL) — no "None / personal"
  // here. You can move a game to a different team, not detach it.
  const teamOptions = useMemo<DropdownOption[]>(() => {
    const seen = new Map<string, string>();
    userTeams.forEach(t => { if (!seen.has(t.team_id)) seen.set(t.team_id, t.name); });
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [userTeams]);

  const playerOptions = useMemo<DropdownOption[]>(
    () => [{ value: '', label: 'None' }, ...userKids.map(k => ({ value: k.player_id, label: k.name }))],
    [userKids],
  );
  const yearOptions = useMemo<DropdownOption[]>(() => {
    const y = new Date().getFullYear();
    return [y - 2, y - 1, y, y + 1].map(n => ({ value: String(n), label: String(n) }));
  }, []);
  const tournamentOptions = useMemo<DropdownOption[]>(() => [
    { value: '', label: 'None' },
    ...tournaments.map(t => ({ value: t.id, label: t.name })),
    { value: NEW_TOURNAMENT, label: '+ New tournament' },
  ], [tournaments]);

  // Load the game + its videos (for shared-attr prefill and the cascade count)
  // + resolve the season name back into term/year.
  useEffect(() => {
    (async () => {
      if (!gameId) { setLoading(false); return; }
      const { data: g, error } = await supabase.from('games')
        .select('id, title, opponent, game_date, team_id, team_score, opponent_score, season_id, tournament_id')
        .eq('id', gameId).single();
      if (error || !g) { Alert.alert('Error', error?.message ?? 'Game not found'); router.back(); return; }

      setOpponent(g.opponent ?? '');
      setVsAt(typeof g.title === 'string' && g.title.startsWith('at ') ? 'at' : 'vs');
      setGameDate(ymdToDate(g.game_date));
      setTeamId(g.team_id);
      setOrigTeamId(g.team_id);
      setTournamentId(g.tournament_id ?? '');
      setTeamScore(g.team_score == null ? '' : String(g.team_score));
      setOppScore(g.opponent_score == null ? '' : String(g.opponent_score));

      // Shared video attributes — prefill from the first video; count all for the
      // team-move confirmation.
      const { data: vids } = await supabase.from('videos')
        .select('event_type, sport, player_id').eq('game_id', gameId).order('sort_order').limit(1);
      const { count } = await supabase.from('videos')
        .select('id', { count: 'exact', head: true }).eq('game_id', gameId);
      setVideoCount(count ?? 0);
      const v0 = vids?.[0] as any;
      if (v0?.event_type) setEventType(v0.event_type as EventTypeKey);
      if (v0?.sport) setSport(v0.sport);
      if (v0?.player_id) setPlayerId(v0.player_id);

      // Season name ("Fall 2026") → term + year.
      if (g.season_id) {
        const { data: s } = await supabase.from('seasons').select('name').eq('id', g.season_id).maybeSingle();
        const parts = (s?.name ?? '').split(' ');
        if (parts.length === 2 && (SEASON_TERMS as readonly string[]).includes(parts[0])) {
          setSeasonTerm(parts[0]);
          setSeasonYear(parts[1]);
        }
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  // Tournaments for the currently-selected team.
  useEffect(() => {
    if (!teamId) { setTournaments([]); return; }
    (async () => {
      const { data } = await supabase.from('tournaments').select('id, name').eq('team_id', teamId).order('name');
      setTournaments((data as any[]) || []);
    })();
  }, [teamId]);

  function onDateChange(_: DateTimePickerEvent, selected?: Date) { if (selected) setGameDate(selected); }
  function openAndroidDate() { DateTimePickerAndroid.open({ value: gameDate, mode: 'date', onChange: onDateChange }); }

  async function persist() {
    if (!gameId) return;
    setSaving(true);
    try {
      const ymd = dateToYMD(gameDate);

      // A team move clears the old team's season + tournament (they belong to the
      // old team). Otherwise resolve season (find-or-create) + tournament.
      let seasonId: string | null = null;
      let tournamentResolved: string | null = null;
      if (!teamChanged) {
        if (teamId && seasonTerm && seasonYear) {
          const seasonName = `${seasonTerm} ${seasonYear}`;
          const { data: ex } = await supabase.from('seasons').select('id').eq('team_id', teamId).eq('name', seasonName).maybeSingle();
          if (ex?.id) seasonId = ex.id;
          else {
            const { data: cr, error } = await supabase.from('seasons').insert({ team_id: teamId, name: seasonName, created_by_user_id: userId }).select('id').single();
            if (error) { Alert.alert('Could not save season', error.message); setSaving(false); return; }
            seasonId = cr?.id ?? null;
          }
        }
        if (tournamentId && tournamentId !== NEW_TOURNAMENT) tournamentResolved = tournamentId;
        else if (tournamentId === NEW_TOURNAMENT && newTournamentName.trim()) {
          const name = newTournamentName.trim();
          const { data: ex } = await supabase.from('tournaments').select('id').eq('team_id', teamId).eq('name', name).maybeSingle();
          if (ex?.id) tournamentResolved = ex.id;
          else {
            const { data: cr, error } = await supabase.from('tournaments').insert({ team_id: teamId, name, created_by_user_id: userId }).select('id').single();
            if (error) { Alert.alert('Could not save tournament', error.message); setSaving(false); return; }
            tournamentResolved = cr?.id ?? null;
          }
        }
      }

      const title = gameTitle(opponent, vsAt, eventType, gameDate);
      const { error: gErr } = await supabase.from('games').update({
        title,
        opponent: opponent.trim() || null,
        game_date: ymd,
        team_id: teamId,
        team_score: teamScore === '' ? null : parseInt(teamScore, 10),
        opponent_score: oppScore === '' ? null : parseInt(oppScore, 10),
        season_id: seasonId,
        tournament_id: tournamentResolved,
      }).eq('id', gameId);
      if (gErr) { Alert.alert('Could not save game', gErr.message); setSaving(false); return; }

      // Cascade the shared attributes to every video in the game.
      const videoPatch: Record<string, any> = {
        team_id: teamId,
        event_type: eventType,
        event_date: ymd,
        sport,
        player_id: playerId || null,
        season_id: seasonId,
      };
      if (teamChanged) videoPatch.visibility = teamId ? 'team' : 'private_to_creator';
      const { error: vErr } = await supabase.from('videos').update(videoPatch).eq('game_id', gameId);
      if (vErr) { Alert.alert('Saved game, but its videos didn’t update', vErr.message); setSaving(false); return; }

      setSaving(false);
      router.back();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Unknown');
      setSaving(false);
    }
  }

  function onSave() {
    if (teamChanged) {
      const newName = activeTeam?.name ?? 'the new team';
      const label = opponent.trim() ? `${vsAt} ${opponent.trim()}` : 'this game';
      Alert.alert(
        'Move game to another team?',
        `Move “${label}” and its ${videoCount} video${videoCount === 1 ? '' : 's'} to ${newName}? Its season and tournament will be cleared.`,
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Move', style: 'destructive', onPress: persist }],
      );
    } else {
      persist();
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
        <View style={styles.center}><ActivityIndicator size="large" color="#534AB7" /></View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <TouchableOpacity onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
      <Text style={styles.title}>Edit game</Text>

      <ScrollView contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Event type</Text>
        <Dropdown value={eventType} options={EVENT_TYPES} onSelect={v => setEventType(v as EventTypeKey)} />

        <Text style={styles.label}>Date</Text>
        {Platform.OS === 'ios' ? (
          <DateTimePicker value={gameDate} mode="date" display="compact" themeVariant="dark" onChange={onDateChange} />
        ) : (
          <TouchableOpacity style={styles.input} onPress={openAndroidDate}>
            <Text style={{ color: '#fff', fontSize: 16 }}>{dateToYMD(gameDate)}</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.label}>Team</Text>
        <Dropdown value={teamId} options={teamOptions} onSelect={setTeamId} />
        {teamChanged ? (
          <Text style={styles.warn}>
            Moving teams will move this game’s {videoCount} video{videoCount === 1 ? '' : 's'} and clear its season &amp; tournament.
          </Text>
        ) : null}

        <Text style={styles.label}>Attach to player</Text>
        <Dropdown value={playerId} options={playerOptions} onSelect={setPlayerId} placeholder="None" />

        <Text style={styles.label}>Sport</Text>
        <Dropdown value={sport} options={SPORTS} onSelect={setSport} />

        {!teamChanged ? (
          <>
            <Text style={styles.label}>Season</Text>
            <View style={styles.row}>
              <View style={styles.flex1}>
                <Dropdown
                  value={seasonTerm}
                  options={[{ value: '', label: 'None' }, ...SEASON_TERMS.map(t => ({ value: t, label: t }))]}
                  onSelect={setSeasonTerm}
                  placeholder="Term"
                />
              </View>
              <View style={styles.flex1}>
                <Dropdown value={seasonYear} options={yearOptions} onSelect={setSeasonYear} />
              </View>
            </View>
          </>
        ) : null}

        <Text style={styles.label}>Game details</Text>
        <View style={styles.row}>
          <TouchableOpacity style={[styles.vsBtn, vsAt === 'vs' && styles.vsBtnOn]} onPress={() => setVsAt('vs')}>
            <Text style={[styles.vsText, vsAt === 'vs' && styles.vsTextOn]}>vs</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.vsBtn, vsAt === 'at' && styles.vsBtnOn]} onPress={() => setVsAt('at')}>
            <Text style={[styles.vsText, vsAt === 'at' && styles.vsTextOn]}>at</Text>
          </TouchableOpacity>
          <TextInput
            style={[styles.input, styles.flex1, { marginTop: 0 }]}
            value={opponent}
            onChangeText={setOpponent}
            placeholder="Opponent"
            placeholderTextColor="#888"
          />
        </View>

        {!teamChanged ? (
          <>
            <Text style={styles.sublabel}>Tournament</Text>
            <Dropdown value={tournamentId} options={tournamentOptions} onSelect={setTournamentId} placeholder="None" />
            {tournamentId === NEW_TOURNAMENT ? (
              <TextInput
                style={styles.input}
                value={newTournamentName}
                onChangeText={setNewTournamentName}
                placeholder="New tournament name"
                placeholderTextColor="#888"
              />
            ) : null}
          </>
        ) : null}

        <Text style={styles.sublabel}>Score</Text>
        <View style={styles.scoreRow}>
          <View style={styles.flex1}>
            <Text style={styles.scoreLbl} numberOfLines={1}>{activeTeam?.name ?? 'Us'}</Text>
            <TextInput
              style={[styles.input, styles.scoreInput]}
              value={teamScore}
              onChangeText={t => setTeamScore(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor="#888"
            />
          </View>
          <View style={styles.flex1}>
            <Text style={styles.scoreLbl}>OPP</Text>
            <TextInput
              style={[styles.input, styles.scoreInput]}
              value={oppScore}
              onChangeText={t => setOppScore(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor="#888"
            />
          </View>
          {derivedResult ? (
            <View style={[
              styles.resultBadge,
              derivedResult === 'W' && styles.badgeW,
              derivedResult === 'L' && styles.badgeL,
              derivedResult === 'T' && styles.badgeT,
            ]}>
              <Text style={styles.resultBadgeText}>{derivedResult}</Text>
            </View>
          ) : null}
        </View>

        <TouchableOpacity style={[styles.saveBtn, saving && styles.saveBtnDisabled]} onPress={onSave} disabled={saving}>
          <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save changes'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingHorizontal: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  back: { paddingVertical: 8 },
  backText: { color: '#534AB7', fontSize: 16 },
  title: { color: '#fff', fontSize: 28, fontWeight: '700', marginBottom: 16, marginTop: 8 },

  label: { color: '#aaa', fontSize: 13, fontWeight: '600', marginTop: 18, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  sublabel: { color: '#888', fontSize: 12, fontWeight: '600', marginTop: 14, marginBottom: 6 },
  input: { backgroundColor: '#1a1a1a', borderRadius: 8, padding: 14, fontSize: 16, borderWidth: 1, borderColor: '#333', color: '#fff', marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  flex1: { flex: 1 },
  warn: { color: '#E0A21E', fontSize: 12, lineHeight: 17, marginTop: 8 },

  scoreRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 6 },
  scoreLbl: { color: '#888', fontSize: 11, fontWeight: '700', marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  scoreInput: { marginTop: 0, textAlign: 'center' },
  resultBadge: { width: 40, height: 46, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#333' },
  resultBadgeText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  badgeW: { backgroundColor: '#1D9E75' },
  badgeL: { backgroundColor: '#C0392B' },
  badgeT: { backgroundColor: '#666' },

  vsBtn: { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12 },
  vsBtnOn: { backgroundColor: '#2a2740', borderColor: '#534AB7' },
  vsText: { color: '#888', fontSize: 15, fontWeight: '700' },
  vsTextOn: { color: '#fff' },

  saveBtn: { backgroundColor: '#534AB7', borderRadius: 8, padding: 16, alignItems: 'center', marginTop: 24 },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

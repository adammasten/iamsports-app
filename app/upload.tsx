import { useTeamContext } from '@/context';
import { pickVideos, uploadVideoToBucket, type PendingFile } from '@/lib/native/video-upload';
import {
  defaultUploadTitle, dateToYMD, deriveResult, EVENT_TYPES, makeVideoLabel, NEW_TOURNAMENT, SEASON_TERMS, SPORTS,
  type EventTypeKey,
} from '@/lib/core/upload-meta';
import { supabase } from '@/supabase';
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Dropdown, { type DropdownOption } from './components/Dropdown';

// Upload a video into the Film Room. Simple path = video + title + event type +
// date + optional team. "More details" adds player (parked — no auto-attach),
// sport, season, game details (opponent/tournament), and score/result. A games
// row is created ONLY when game details are filled. Never auto-posts to a wall.
export default function UploadScreen() {
  const insets = useSafeAreaInsets();
  const { userId, userTeams, userKids } = useTeamContext();
  const params = useLocalSearchParams();
  const paramPlayerId = (Array.isArray(params.playerId) ? params.playerId[0] : params.playerId) || '';

  // Always-visible. `pending` is now a LIST — multi-select creates one game and
  // uploads every picked video to it in pick order.
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [label, setLabel] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const [eventType, setEventType] = useState<EventTypeKey>('game');
  const [eventDate, setEventDate] = useState<Date>(new Date());
  const [teamId, setTeamId] = useState('');            // '' = None / personal

  // More details
  const [showMore, setShowMore] = useState(false);
  const [playerId, setPlayerId] = useState(paramPlayerId);
  const [sport, setSport] = useState('Basketball');
  const [seasonTerm, setSeasonTerm] = useState('');
  const [seasonYear, setSeasonYear] = useState(String(new Date().getFullYear()));
  const [opponent, setOpponent] = useState('');
  const [vsAt, setVsAt] = useState<'vs' | 'at'>('vs');
  const [tournamentId, setTournamentId] = useState('');   // '' = none, NEW_TOURNAMENT, or id
  const [newTournamentName, setNewTournamentName] = useState('');
  const [tournaments, setTournaments] = useState<{ id: string; name: string }[]>([]);
  const [teamScore, setTeamScore] = useState('');
  const [oppScore, setOppScore] = useState('');

  // Flow
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');   // "Video 2 of 4"
  // Multi-upload result: how many landed, out of how many, the row to jump
  // straight into tagging (single video), and the just-created game's context so
  // "Add more videos to this game" can attach more without re-entering details.
  const [done, setDone] = useState<{
    count: number; total: number; where: string;
    first: { videoId: string; url: string; label: string } | null;
    game: { id: string; teamId: string | null; eventType: EventTypeKey; eventDate: string; sport: string | null; seasonId: string | null } | null;
  } | null>(null);

  const activeTeam = teamId ? userTeams.find(t => t.team_id === teamId) : null;

  // Derived W/L/T badge — only when both scores are entered (and not 0-0).
  const derivedResult = deriveResult(
    teamScore === '' ? null : parseInt(teamScore, 10),
    oppScore === '' ? null : parseInt(oppScore, 10),
  );

  // Dedup teams (a user can hold several roles on one team).
  const teamOptions = useMemo<DropdownOption[]>(() => {
    const seen = new Map<string, string>();
    userTeams.forEach(t => { if (!seen.has(t.team_id)) seen.set(t.team_id, t.name); });
    return [{ value: '', label: 'None / personal' }, ...[...seen].map(([value, label]) => ({ value, label }))];
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

  // When a team is chosen, inherit its sport and load its tournaments; clear
  // season/team-only fields when switching to personal.
  useEffect(() => {
    if (!teamId) { setTournaments([]); setTournamentId(''); setSeasonTerm(''); return; }
    if (activeTeam?.sport) setSport(activeTeam.sport);
    (async () => {
      const { data } = await supabase.from('tournaments').select('id, name').eq('team_id', teamId).order('name');
      setTournaments((data as any[]) || []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  async function pick() {
    const files = await pickVideos();
    if (files.length > 0) {
      setPending(files);
      if (!titleTouched && !label.trim()) setLabel(defaultUploadTitle(eventDate));   // sensible default
    }
  }

  function onDateChange(_: DateTimePickerEvent, selected?: Date) {
    if (selected) {
      setEventDate(selected);
      if (!titleTouched && (!label.trim() || label === defaultUploadTitle(eventDate))) {
        setLabel(defaultUploadTitle(selected));
      }
    }
  }
  function openAndroidDate() {
    DateTimePickerAndroid.open({ value: eventDate, mode: 'date', onChange: onDateChange });
  }

  async function doUpload() {
    if (pending.length === 0) { await pick(); return; }
    if (!userId) { Alert.alert('Not signed in'); return; }
    setUploading(true);
    setProgress(0);
    setProgressText('');
    try {
      const resolvedSport = teamId ? (activeTeam?.sport ?? null) : (sport || null);

      // 1. Season — team + term + year; seasons is allow_all, so find-or-create.
      let seasonId: string | null = null;
      if (teamId && seasonTerm && seasonYear) {
        const seasonName = `${seasonTerm} ${seasonYear}`;
        const { data: ex } = await supabase.from('seasons').select('id').eq('team_id', teamId).eq('name', seasonName).maybeSingle();
        if (ex?.id) seasonId = ex.id;
        else {
          const { data: cr, error } = await supabase.from('seasons').insert({ team_id: teamId, name: seasonName, created_by_user_id: userId }).select('id').single();
          if (error) { Alert.alert('Could not save season', error.message); setUploading(false); return; }
          seasonId = cr?.id ?? null;
        }
      }

      // 2. Tournament — pick-or-create.
      let tournamentResolved: string | null = null;
      if (teamId && tournamentId && tournamentId !== NEW_TOURNAMENT) {
        tournamentResolved = tournamentId;
      } else if (teamId && tournamentId === NEW_TOURNAMENT && newTournamentName.trim()) {
        const name = newTournamentName.trim();
        const { data: ex } = await supabase.from('tournaments').select('id').eq('team_id', teamId).eq('name', name).maybeSingle();
        if (ex?.id) tournamentResolved = ex.id;
        else {
          const { data: cr, error } = await supabase.from('tournaments').insert({ team_id: teamId, name, created_by_user_id: userId }).select('id').single();
          if (error) { Alert.alert('Could not save tournament', error.message); setUploading(false); return; }
          tournamentResolved = cr?.id ?? null;
        }
      }

      // 3. Create the game ONCE (team + game details). Every picked video attaches to it.
      let gameId: string | null = null;
      if (teamId && (opponent.trim() !== '' || tournamentResolved !== null)) {
        const gameTitle = opponent.trim() ? `${vsAt} ${opponent.trim()}` : 'Game';
        const { data: g, error } = await supabase.from('games').insert({
          team_id: teamId,
          title: gameTitle,
          opponent: opponent.trim() || null,
          game_date: dateToYMD(eventDate),
          tournament_id: tournamentResolved,
          team_score: teamScore === '' ? null : parseInt(teamScore, 10),
          opponent_score: oppScore === '' ? null : parseInt(oppScore, 10),
          season_id: seasonId,
        }).select('id').single();
        if (error) { Alert.alert('Could not create game', error.message); setUploading(false); return; }
        gameId = g?.id ?? null;
      }

      // 4. Upload every picked video to the game (sort_order = pick order, from 0).
      //    Partial failure is handled inside uploadBatch (keeps successes).
      const total = pending.length;
      const evDate = dateToYMD(eventDate);
      const r = await uploadBatch(pending, {
        gameId, teamId: teamId || null, playerId: playerId || null,
        eventType, eventDate: evDate, sport: resolvedSport, seasonId, base: label.trim(),
      }, 0);

      setUploading(false);
      if (r.succeeded.length === 0) {
        Alert.alert('Upload failed', `None of the ${total} video${total === 1 ? '' : 's'} uploaded — nothing was saved. Please try again.`);
        return;
      }
      if (r.failed.length > 0) {
        Alert.alert(
          'Some videos didn’t upload',
          `${r.succeeded.length} of ${total} uploaded${gameId ? ' to the game' : ''}. Failed: ${r.failed.join(', ')}. The successful videos were kept — re-add the failed ones from Film Room.`,
        );
      }
      setDone({
        count: r.succeeded.length, total, where: activeTeam ? activeTeam.name : 'Film Room', first: r.first,
        game: gameId ? { id: gameId, teamId: teamId || null, eventType, eventDate: evDate, sport: resolvedSport, seasonId } : null,
      });
    } catch (e: any) {
      Alert.alert('Upload error', e?.message ?? 'Unknown');
      setUploading(false);
    }
  }

  // Upload a batch of videos to a game, continuing sort_order from startSortOrder.
  // Each video is independent — a failure is collected, never rolls back the batch.
  async function uploadBatch(
    files: PendingFile[],
    ctx: { gameId: string | null; teamId: string | null; playerId: string | null; eventType: EventTypeKey; eventDate: string; sport: string | null; seasonId: string | null; base: string },
    startSortOrder: number,
  ) {
    const succeeded: string[] = [];
    const failed: string[] = [];
    let first: { videoId: string; url: string; label: string } | null = null;
    for (let i = 0; i < files.length; i++) {
      const sort = startSortOrder + i;
      const vidLabel = makeVideoLabel(ctx.base, sort, files.length > 1 || startSortOrder > 0);
      setProgressText(`Video ${i + 1} of ${files.length}`);
      setProgress(0);
      try {
        const fileName = `${ctx.teamId ? 'team' : 'personal'}-${userId}-${Date.now()}-${sort}.mp4`;
        await uploadVideoToBucket(fileName, files[i], setProgress);
        const { data: v, error } = await supabase.from('videos').insert({
          game_id: ctx.gameId,
          team_id: ctx.teamId,
          uploaded_by_user_id: userId,
          player_id: ctx.playerId,
          url: fileName,
          label: vidLabel,
          sort_order: sort,
          visibility: ctx.teamId ? 'team' : 'private_to_creator',
          event_type: ctx.eventType,
          event_date: ctx.eventDate,
          sport: ctx.sport,
          season_id: ctx.seasonId,
        }).select('id').single();
        if (error || !v) throw new Error(error?.message ?? 'Failed to save video');
        succeeded.push(vidLabel);
        if (!first) first = { videoId: v.id, url: fileName, label: vidLabel };
      } catch {
        failed.push(vidLabel);
      }
    }
    return { succeeded, failed, first };
  }

  // Success-screen "Add more videos to this game" — reuses the picker + uploadBatch
  // against the JUST-CREATED game. team_id comes from the game (anti-misfile), and
  // sort_order continues from the game's CURRENT max, recomputed on every call.
  async function addMore() {
    if (!done?.game || !userId) return;
    const g = done.game;
    const files = await pickVideos();
    if (files.length === 0) return;
    setUploading(true);
    setProgress(0);
    setProgressText('');
    try {
      // Recomputed live EACH call → a 2nd "add more" appends (…3,4 then 5,6), never restarts at 0.
      const { data: last } = await supabase.from('videos')
        .select('sort_order').eq('game_id', g.id)
        .order('sort_order', { ascending: false }).limit(1).maybeSingle();
      const start = (last?.sort_order ?? -1) + 1;
      const r = await uploadBatch(files, {
        gameId: g.id, teamId: g.teamId, playerId: null,
        eventType: g.eventType, eventDate: g.eventDate, sport: g.sport, seasonId: g.seasonId, base: 'Clip',
      }, start);
      setUploading(false);
      if (r.succeeded.length === 0) {
        Alert.alert('Upload failed', `None of the ${files.length} video${files.length === 1 ? '' : 's'} were added.`);
        return;
      }
      if (r.failed.length > 0) {
        Alert.alert('Some videos didn’t upload', `${r.succeeded.length} of ${files.length} added. Failed: ${r.failed.join(', ')}.`);
      }
      setDone({ ...done, count: done.count + r.succeeded.length, total: done.total + files.length });
    } catch (e: any) {
      Alert.alert('Upload error', e?.message ?? 'Unknown');
      setUploading(false);
    }
  }

  // ---- render ----
  if (done) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.title}>Upload video</Text>
        <View style={styles.doneWrap}>
          <Text style={styles.doneCheck}>✓</Text>
          <Text style={styles.doneTitle}>Saved to Film Room</Text>
          <Text style={styles.doneBody}>
            {done.count === 1 ? '1 video' : `${done.count} videos`} landed in your Film Room{done.where !== 'Film Room' ? ` on ${done.where}` : ''}
            {done.count < done.total ? ` — ${done.total - done.count} failed (re-add from Film Room)` : ''}. Not posted to any wall.
          </Text>
          {/* "Tag it now" only makes sense for a single video; N videos → tag them
              individually in Film Room. */}
          {done.count === 1 && done.first ? (
            <TouchableOpacity
              style={[styles.saveBtn, styles.doneBtn]}
              onPress={() => router.replace({ pathname: '/tagging-overlay', params: { videoId: done.first!.videoId, url: done.first!.url, label: done.first!.label, personal: '1' } })}
            >
              <Text style={styles.saveBtnText}>Tag it now</Text>
            </TouchableOpacity>
          ) : null}
          {/* Add more to the SAME game — only when this upload created a game. */}
          {done.game ? (
            <TouchableOpacity style={[styles.doneOutlineBtn, styles.doneBtn]} onPress={addMore}>
              <Text style={styles.doneOutlineText}>＋ Add more videos to this game</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={[styles.doneOutlineBtn, styles.doneBtn]} onPress={() => router.replace('/my-work')}>
            <Text style={styles.doneOutlineText}>Go to Film Room</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.doneSecondary} onPress={() => router.back()}>
            <Text style={styles.doneSecondaryText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (uploading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.title}>Upload video</Text>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#534AB7" />
          {progressText ? <Text style={styles.progress}>{progressText}</Text> : null}
          <Text style={styles.progress}>{progress}%</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <TouchableOpacity onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
      <Text style={styles.title}>Upload video</Text>

      <ScrollView contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        {/* Video(s) — pick one or several; several go to one new game in pick order */}
        <TouchableOpacity style={styles.pickBtn} onPress={pick}>
          <Text style={styles.pickText}>
            {pending.length > 0 ? `${pending.length} video${pending.length === 1 ? '' : 's'} selected ✓ — choose again` : 'Choose video(s)'}
          </Text>
        </TouchableOpacity>

        {pending.length > 0 ? (
          <>
            {/* Title (optional; a base name — each video is titled “{name} 1/2/3…”,
                or “Clip 1/2/3” if left blank) */}
            <Text style={styles.label}>Title (optional)</Text>
            <TextInput
              style={styles.input}
              value={label}
              onChangeText={t => { setLabel(t); setTitleTouched(true); }}
              placeholder="e.g. vs Bulls, or Backyard reps"
              placeholderTextColor="#888"
            />

            {/* Event type */}
            <Text style={styles.label}>Event type</Text>
            <Dropdown value={eventType} options={EVENT_TYPES} onSelect={v => setEventType(v as EventTypeKey)} />

            {/* Date (event date) */}
            <Text style={styles.label}>Date</Text>
            {Platform.OS === 'ios' ? (
              <DateTimePicker value={eventDate} mode="date" display="compact" themeVariant="dark" onChange={onDateChange} />
            ) : (
              <TouchableOpacity style={styles.input} onPress={openAndroidDate}>
                <Text style={{ color: '#fff', fontSize: 16 }}>{dateToYMD(eventDate)}</Text>
              </TouchableOpacity>
            )}

            {/* Attach to team (optional) */}
            <Text style={styles.label}>Attach to team</Text>
            <Dropdown value={teamId} options={teamOptions} onSelect={setTeamId} placeholder="None / personal" />

            {/* More details expander */}
            <TouchableOpacity style={styles.moreToggle} onPress={() => setShowMore(!showMore)}>
              <Text style={styles.moreToggleText}>{showMore ? '▾ Hide details' : '▸ More details (optional)'}</Text>
            </TouchableOpacity>

            {showMore ? (
              <View style={styles.moreBox}>
                {/* Attach to player — field only, no auto-attach (parked) */}
                <Text style={styles.label}>Attach to player</Text>
                <Dropdown value={playerId} options={playerOptions} onSelect={setPlayerId} placeholder="None" />

                {/* Sport */}
                <Text style={styles.label}>Sport{activeTeam ? ` (from ${activeTeam.name})` : ''}</Text>
                <Dropdown value={sport} options={SPORTS} onSelect={setSport} />

                {/* Season — when a team is attached */}
                {teamId ? (
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

                {/* Game details — shown whenever a team is attached (entered once
                    for the game all the picked videos land on). */}
                {teamId ? (
                  <>
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
                  </>
                ) : (
                  <Text style={styles.hint}>Attach a team to add game details, season, opponent, and score.</Text>
                )}
              </View>
            ) : null}

            {/* Upload — title is optional now, so gated only on having video(s) */}
            <TouchableOpacity style={styles.saveBtn} onPress={doUpload}>
              <Text style={styles.saveBtnText}>
                {pending.length > 1 ? `Upload ${pending.length} videos` : 'Upload'}
              </Text>
            </TouchableOpacity>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingHorizontal: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  progress: { color: '#fff', fontSize: 18, marginTop: 16 },
  back: { paddingVertical: 8 },
  backText: { color: '#534AB7', fontSize: 16 },
  title: { color: '#fff', fontSize: 28, fontWeight: '700', marginBottom: 16, marginTop: 8 },

  pickBtn: { backgroundColor: '#1a1a1a', borderRadius: 8, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  pickText: { color: '#534AB7', fontSize: 16, fontWeight: '600' },

  label: { color: '#aaa', fontSize: 13, fontWeight: '600', marginTop: 18, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  sublabel: { color: '#888', fontSize: 12, fontWeight: '600', marginTop: 14, marginBottom: 6 },
  input: { backgroundColor: '#1a1a1a', borderRadius: 8, padding: 14, fontSize: 16, borderWidth: 1, borderColor: '#333', color: '#fff', marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  flex1: { flex: 1 },
  hint: { color: '#666', fontSize: 13, lineHeight: 18, marginTop: 12 },

  moreToggle: { marginTop: 22, paddingVertical: 6 },
  moreToggleText: { color: '#534AB7', fontSize: 15, fontWeight: '700' },
  moreBox: { borderLeftWidth: 2, borderLeftColor: '#2a2740', paddingLeft: 12, marginTop: 4 },

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

  doneWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 40 },
  doneCheck: { color: '#2e7d32', fontSize: 56, fontWeight: '800', lineHeight: 60 },
  doneTitle: { color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 8 },
  doneBody: { color: '#aaa', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 10, marginBottom: 8, paddingHorizontal: 12 },
  doneBtn: { alignSelf: 'stretch', marginTop: 12 },
  doneOutlineBtn: { borderRadius: 8, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#534AB7' },
  doneOutlineText: { color: '#534AB7', fontSize: 16, fontWeight: '600' },
  doneSecondary: { padding: 14, marginTop: 4 },
  doneSecondaryText: { color: '#888', fontSize: 15, fontWeight: '600' },
});

// Edit details for an already-uploaded video — the same fields the upload form
// offers (minus the file picker), pre-filled, on every surface (native app, mobile
// browser, web). Change title/type/date, attach or detach a team (creating the
// team's event container), and attach a player. Uses the SHARED saveVideoMeta so it
// can never diverge from upload. Owner/admin only (enforced by videos_update RLS).
import { COACH_ROLES, useTeamContext } from '@/context';
import { EVENT_TYPES, SPORTS, dateToYMD, type EventTypeKey } from '@/lib/core/upload-meta';
import { isVideoPosted, loadVideoMeta, saveVideoMeta } from '@/lib/core/video-meta';
import { goBackOrHome } from '@/lib/nav';
import { webAlert } from '@/lib/webAlert';
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Dropdown, { type DropdownOption } from './components/Dropdown';

function ymdToDate(ymd: string | null): Date {
  if (!ymd) return new Date();
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export default function EditVideoScreen() {
  const insets = useSafeAreaInsets();
  const { userId, userTeams, userKids } = useTeamContext();
  const params = useLocalSearchParams();
  const videoId = (Array.isArray(params.videoId) ? params.videoId[0] : params.videoId) as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [posted, setPosted] = useState(false);
  const [prevTeamId, setPrevTeamId] = useState<string | null>(null);

  const [label, setLabel] = useState('');
  const [eventType, setEventType] = useState<EventTypeKey>('game');
  const [date, setDate] = useState<Date>(new Date());
  const [teamId, setTeamId] = useState('');          // '' = None / personal
  const [playerId, setPlayerId] = useState('');
  const [sport, setSport] = useState('Basketball');

  useEffect(() => {
    if (!videoId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const [m, p] = await Promise.all([loadVideoMeta(videoId), isVideoPosted(videoId).catch(() => false)]);
        if (cancelled) return;
        setLabel(m.label); setEventType(m.eventType); setDate(ymdToDate(m.eventDate));
        setTeamId(m.teamId ?? ''); setPrevTeamId(m.teamId); setPlayerId(m.playerId ?? '');
        setSport(m.sport ?? 'Basketball'); setPosted(p);
      } catch (e: any) { webAlert('Edit details', e?.message ?? 'Could not load this video.'); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [videoId]);

  // Team options: personal + the teams I COACH (attaching creates the team's event
  // container, which is coach-gated). Always include the current team so it shows.
  const teamOptions = useMemo<DropdownOption[]>(() => {
    const seen = new Map<string, string>();
    userTeams.forEach(t => { if (COACH_ROLES.includes(t.role) && !seen.has(t.team_id)) seen.set(t.team_id, t.name); });
    if (prevTeamId && !seen.has(prevTeamId)) {
      const cur = userTeams.find(t => t.team_id === prevTeamId);
      if (cur) seen.set(prevTeamId, cur.name);
    }
    return [{ value: '', label: 'None / personal' }, ...[...seen].map(([value, l]) => ({ value, label: l }))];
  }, [userTeams, prevTeamId]);

  const playerOptions = useMemo<DropdownOption[]>(
    () => [{ value: '', label: 'None' }, ...userKids.map(k => ({ value: k.player_id, label: k.name }))],
    [userKids],
  );

  function onPickTeam(next: string) {
    // Published content can't be silently moved between team audiences.
    if (posted && next !== (prevTeamId ?? '')) {
      webAlert('This video is posted', 'Unpost this video from the wall first, then you can move it to a different team.');
      return;
    }
    setTeamId(next);
  }

  function onDateChange(_: DateTimePickerEvent, selected?: Date) { if (selected) setDate(selected); }
  function openAndroidDate() { DateTimePickerAndroid.open({ value: date, mode: 'date', onChange: onDateChange }); }

  async function onSave() {
    if (!userId) { webAlert('Not signed in', 'Not signed in'); return; }
    setSaving(true);
    try {
      await saveVideoMeta({
        videoId, label, eventType, eventDate: dateToYMD(date),
        teamId: teamId || null, playerId: playerId || null, sport: sport || null, prevTeamId,
      });
      webAlert('Saved', 'Your changes were saved.');
      goBackOrHome();
    } catch (e: any) {
      webAlert('Could not save', e?.message ?? 'Please try again.');
      setSaving(false);
    }
  }

  if (loading) {
    return <View style={styles.container}><ActivityIndicator size="large" color="#534AB7" style={{ marginTop: 80 }} /></View>;
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <TouchableOpacity onPress={goBackOrHome} style={styles.back} hitSlop={8}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
      <Text style={styles.title}>Edit details</Text>

      <ScrollView contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Title</Text>
        <TextInput style={styles.input} value={label} onChangeText={setLabel} placeholder="e.g. Q1, or Backyard reps" placeholderTextColor="#888" />

        <Text style={styles.label}>Event type</Text>
        <Dropdown value={eventType} options={EVENT_TYPES} onSelect={v => setEventType(v as EventTypeKey)} />

        <Text style={styles.label}>Date</Text>
        {Platform.OS === 'web' ? (
          React.createElement('input', {
            type: 'date',
            value: dateToYMD(date),
            onChange: (e: any) => { const v = e.target.value; if (v) setDate(ymdToDate(v)); },
            style: { background: '#17171d', color: '#fff', border: '1px solid #2a2a33', borderRadius: 10, padding: 12, fontSize: 16, width: '100%', boxSizing: 'border-box' },
          })
        ) : Platform.OS === 'ios' ? (
          <DateTimePicker value={date} mode="date" display="compact" themeVariant="dark" onChange={onDateChange} />
        ) : (
          <TouchableOpacity style={styles.input} onPress={openAndroidDate}>
            <Text style={{ color: '#fff', fontSize: 16 }}>{dateToYMD(date)}</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.label}>Team</Text>
        <Dropdown value={teamId} options={teamOptions} onSelect={onPickTeam} placeholder="None / personal" />
        {!teamId ? (
          <Text style={styles.note}>Personal footage — visible only to you. Attach a team to put it in that team&apos;s Film Room (it won&apos;t auto-post to the wall).</Text>
        ) : posted ? (
          <Text style={styles.note}>This video is posted to a wall — unpost it first to move it to a different team.</Text>
        ) : null}

        <Text style={styles.label}>Attach a player</Text>
        <Dropdown value={playerId} options={playerOptions} onSelect={setPlayerId} placeholder="None" />

        <Text style={styles.label}>Sport</Text>
        <Dropdown value={sport} options={SPORTS} onSelect={setSport} />

        <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={onSave} disabled={saving}>
          <Text style={styles.saveTxt}>{saving ? 'Saving…' : 'Save changes'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0e1b2c', paddingHorizontal: 18, maxWidth: 620, width: '100%', alignSelf: 'center' },
  back: { alignSelf: 'flex-start', paddingVertical: 6 },
  backText: { color: '#8b7bff', fontSize: 14, fontWeight: '700' },
  title: { color: '#f1f4f6', fontSize: 24, fontWeight: '800', marginBottom: 8 },
  label: { color: '#8b7bff', fontSize: 12, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 18, marginBottom: 8 },
  input: { backgroundColor: '#17171d', borderColor: '#2a2a33', borderWidth: 1, borderRadius: 10, color: '#fff', paddingHorizontal: 12, paddingVertical: 12, fontSize: 16 },
  note: { color: '#8b96a3', fontSize: 12.5, lineHeight: 18, marginTop: 8 },
  saveBtn: { backgroundColor: '#534AB7', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 28 },
  saveTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },
});

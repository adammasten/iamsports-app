import { useTeamContext } from '@/context';
import { loadModeration } from '@/lib/core/moderation';
import { getSignedVideoUrl } from '@/lib/native/video-url';
import { supabase } from '@/supabase';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { goBackOrHome } from '@/lib/nav';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getFreshToken, SUPABASE_STORAGE_URL } from '@/lib/native/video-upload';
import { TeamLogo } from '@/components/team-logo';
import { LoadError } from '@/components/load-error';
import { withTimeout } from '@/lib/withTimeout';
import ContentCard from '@/components/content-card/ContentCard';
import { showContentActions } from './moderationActions';
import { initials, teamColor } from './select-team';

// Wall filter tabs — placeholders for now (selecting just highlights).
const TABS = [
  { key: 'shared', label: 'Shared with you' },
  { key: 'wall', label: 'Wall' },
  { key: 'games', label: 'Games' },
  { key: 'clips', label: 'Clips' },
  { key: 'sport', label: 'Sport' },
];

export default function KidWallScreen() {
  const insets = useSafeAreaInsets();
  const { refreshKids, userTeams, userId } = useTeamContext();
  const params = useLocalSearchParams();
  const playerId = Array.isArray(params.playerId) ? params.playerId[0] : params.playerId;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [gradClass, setGradClass] = useState('');
  const [selectedTab, setSelectedTab] = useState('shared');
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [kidTeams, setKidTeams] = useState<{ team_id: string; name: string; jersey_number: string | null; left_at: string | null; logo_path: string | null }[]>([]);
  const [pastTeams, setPastTeams] = useState<{ team_id: string; name: string; jersey_number: string | null; left_at: string | null; logo_path: string | null }[]>([]);
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [jerseyInput, setJerseyInput] = useState('');
  const [attaching, setAttaching] = useState(false);
  const [guardians, setGuardians] = useState<{ user_id: string; name: string; relationship: string; is_you: boolean }[]>([]);
  const [guardianCode, setGuardianCode] = useState<string | null>(null);
  const [guardiansOpen, setGuardiansOpen] = useState(false); // collapsed by default so the wall gets the room
  // "Shared with you" — player-audience shares to this kid that a guardian
  // hasn't put on the wall yet (on_wall=false). Family-wide (any guardian sees).
  const [inbox, setInbox] = useState<{
    shareId: string; contentType: string; contentId: string;
    sharedBy: string | null; sharedByName: string | null; createdAt: string; title: string;
    storagePath: string | null; startTime: number | null; endTime: number | null; note: string | null;
  }[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxError, setInboxError] = useState<string | null>(null);
  // Wall — player-audience shares a guardian has put on this kid's wall
  // (on_wall=true). Family-wide: every linked guardian sees the same wall.
  const [wall, setWall] = useState<{
    shareId: string; contentType: string; audience: string; teamName: string | null;
    createdAt: string; title: string; storagePath: string | null;
    startTime: number | null; endTime: number | null; note: string | null;
  }[]>([]);
  const [wallLoading, setWallLoading] = useState(false);
  const [wallError, setWallError] = useState<string | null>(null);

  // Viewer's teams where they can attach players (coaching roles), deduped.
  const coachingTeams = Array.from(
    new Map(
      userTeams
        .filter(t => t.role === 'admin' || t.role === 'head_coach' || t.role === 'coach')
        .map(t => [t.team_id, t])
    ).values()
  );

  // Load this one kid's row (read allowed via the is_linked_parent branch),
  // then mint a signed URL for the photo if there is one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!playerId) { setLoading(false); return; }
      const { data, error } = await supabase
        .from('players')
        .select('id, name, grad_class, photo_path')
        .eq('id', playerId)
        .single();
      if (cancelled) return;
      if (error || !data) {
        Alert.alert('Error', error?.message ?? 'Could not load kid');
        setLoading(false);
        return;
      }
      setName(data.name ?? '');
      setGradClass(data.grad_class ?? '');
      setPhotoPath(data.photo_path ?? null);
      setLoading(false);
      if (data.photo_path) {
        const signed = await getSignedVideoUrl(data.photo_path);
        if (!cancelled) setPhotoUri(signed);
      }
    })();
    return () => { cancelled = true; };
  }, [playerId]);

  // Load the kid's current teams (player_teams → teams). The team NAME is gated
  // by teams_read RLS, so teams the viewer can't read are filtered out.
  async function loadTeams() {
    if (!playerId) return;
    const { data } = await supabase
      .from('player_teams')
      .select('team_id, jersey_number, left_at, teams ( name, logo_path )')
      .eq('player_id', playerId);
    const rows = (data || [])
      .filter((r: any) => r.teams)
      .map((r: any) => ({ team_id: r.team_id, name: r.teams.name, jersey_number: r.jersey_number ?? null, left_at: r.left_at ?? null, logo_path: r.teams.logo_path ?? null }));
    setKidTeams(rows.filter((r: any) => !r.left_at));   // current roster
    setPastTeams(rows.filter((r: any) => r.left_at));   // teams left → frozen archive
  }

  // Soft-leave: mark the roster link left (never deletes). Games the kid played
  // stay in the family's archive forever (game_lineups + parent link RLS).
  function leaveTeam(t: { team_id: string; name: string }) {
    Alert.alert('Leave team', `Remove ${name || 'your kid'} from ${t.name}? Their games from this team stay in your archive.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: async () => {
        const { error } = await supabase.rpc('leave_team', { p_player_id: playerId, p_team_id: t.team_id });
        if (error) { Alert.alert('Error', error.message); return; }
        loadTeams();
      } },
    ]);
  }

  // Guardians of this kid + the invite code (guardians-only read via RLS/RPC).
  async function loadGuardians() {
    if (!playerId) return;
    const [{ data: g }, { data: c }] = await Promise.all([
      supabase.rpc('kid_guardians', { p_player_id: playerId }),
      supabase.from('player_guardian_codes').select('code').eq('player_id', playerId).maybeSingle(),
    ]);
    setGuardians((g as any[]) ?? []);
    setGuardianCode(c?.code ?? null);
  }

  function shareGuardianCode() {
    if (!guardianCode) return;
    Share.share({ message: `Add me as ${name || 'my kid'}’s guardian on IamSports — code: ${guardianCode}` });
  }

  function resetGuardianCode() {
    Alert.alert(
      'Reset invite code?',
      'The current code stops working immediately. Anyone you shared it with can’t be added until you share the new one.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: async () => {
          const { data, error } = await supabase.rpc('regenerate_guardian_code', { p_player_id: playerId });
          if (error) { Alert.alert('Reset', error.message); return; }
          setGuardianCode(data as string);
        } },
      ],
    );
  }

  function removeGuardian(targetUserId: string, targetName: string, isSelf: boolean) {
    Alert.alert(
      isSelf ? 'Leave' : 'Remove guardian',
      isSelf ? `Remove yourself as ${name}’s guardian?` : `Remove ${targetName} from ${name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: isSelf ? 'Leave' : 'Remove', style: 'destructive', onPress: async () => {
          const { error } = await supabase.rpc('remove_guardian', { p_player_id: playerId, p_guardian_user_id: targetUserId });
          if (error) { Alert.alert('Error', error.message); return; }
          if (isSelf) { await refreshKids(); goBackOrHome(); } else loadGuardians();
        } },
      ],
    );
  }

  const amPrimary = guardians.some(g => g.is_you && g.relationship === 'parent');

  useEffect(() => { loadGuardians(); }, [playerId]);

  useEffect(() => {
    loadTeams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId]);

  // Attach the kid to the selected team (coach/admin only — enforced by the
  // attach_kid_to_team RPC). Idempotent: re-attaching updates the jersey.
  async function attachToTeam() {
    if (!playerId || !selectedTeamId) return;
    setAttaching(true);
    const { error } = await supabase.rpc('attach_kid_to_team', {
      p_player_id: playerId,
      p_team_id: selectedTeamId,
      p_jersey_number: jerseyInput.trim() || null,
    });
    if (error) {
      Alert.alert('Error', error.message);
      setAttaching(false);
      return;
    }
    await loadTeams();
    setAttaching(false);
    setShowAddTeam(false);
    setSelectedTeamId(null);
    setJerseyInput('');
  }

  // Load the kid's inbox: shares to them (audience='player'), each resolved to
  // its content via the resolve_shared_content RPC (title + storage path).
  async function loadInbox() {
    if (!playerId) return;
    setInboxLoading(true);
    setInboxError(null);
    let rows: any[] | null; let error: any;
    try {
      ({ data: rows, error } = await withTimeout(supabase
        .from('shares')
        .select('id, content_type, content_id, shared_by_user_id, created_at, note')
        .eq('target_player_id', playerId)
        .eq('audience', 'player')
        .eq('on_wall', false)           // not yet put on the wall = "Shared with you"
        .eq('visible', true)
        .eq('hidden_by_family', false)  // family-hidden posts drop off entirely
        .order('created_at', { ascending: false })));
    } catch (e: any) { setInboxError(e?.message || 'Couldn’t load shared items.'); setInboxLoading(false); return; }
    if (error) { setInboxError(error.message); setInboxLoading(false); return; }
    const items = await Promise.all((rows || []).map(async (r: any) => {
      const { data: resolved } = await supabase.rpc('resolve_shared_content', { p_share_id: r.id });
      const c = Array.isArray(resolved) ? resolved[0] : null;
      return {
        shareId: r.id,
        contentType: r.content_type,
        contentId: r.content_id,
        sharedBy: r.shared_by_user_id ?? null,
        createdAt: r.created_at,
        title: c?.title ?? (r.content_type === 'game' ? 'Shared game' : '(content unavailable)'),
        storagePath: c?.storage_path ?? null,
        startTime: c?.start_time ?? null,
        endTime: c?.end_time ?? null,
        note: (r.note as string) ?? null,
      };
    }));

    // Resolve each DISTINCT sharer to a display name once (not per row). The RPC
    // is gated to shared context — it returns the name, or null if out of context
    // or no name set; the card falls back to "you" / "someone" accordingly.
    const sharerIds = [...new Set(items.map(i => i.sharedBy).filter((x): x is string => !!x && x !== userId))];
    const nameEntries = await Promise.all(sharerIds.map(async (id) => {
      // A failed/missing name lookup must NEVER drop an item or break the inbox.
      // supabase.rpc returns {error} (no throw) when the function is missing, but
      // guard an unexpected throw too so one bad lookup can't reject the whole load.
      try {
        const { data } = await supabase.rpc('get_user_display_name', { p_user_id: id });
        return [id, typeof data === 'string' ? data : null] as const;
      } catch {
        return [id, null] as const;
      }
    }));
    const nameById = new Map(nameEntries);

    const withNames = items.map(i => ({
      ...i,
      sharedByName: i.sharedBy ? nameById.get(i.sharedBy) ?? null : null,
    }));
    // Hide content from blocked users or that the viewer has reported.
    const mod = await loadModeration();
    setInbox(withNames.filter(i =>
      !(i.sharedBy && mod.blockedUserIds.has(i.sharedBy)) &&
      !mod.reportedKeys.has(`${i.contentType}:${i.contentId}`),
    ));
    setInboxLoading(false);
  }

  // Load the inbox when the "Shared with you" tab is active.
  useEffect(() => {
    if (selectedTab === 'shared') loadInbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTab, playerId]);

  // Load the wall: player-audience shares I (the current user) posted to THIS
  // kid's wall (Friends & Family), newest first, each resolved to its content.
  // NOTE: post-retire-Public, "post to a kid's wall" writes audience='player'
  // (see handleVisilitySelect). This previously queried the retired 'public'
  // audience, which is why the wall always came up empty. teams(name) embedded
  // for the badge (falls back to "Team").
  async function loadWall() {
    if (!playerId || !userId) return;
    setWallLoading(true);
    setWallError(null);
    let rows: any[] | null; let error: any;
    try {
      ({ data: rows, error } = await withTimeout(supabase
        .from('shares')
        .select('id, content_type, audience, team_id, created_at, note, teams ( name )')
        .eq('target_player_id', playerId)
        .eq('audience', 'player')
        .eq('on_wall', true)            // family-wide: any guardian's wall placement
        .eq('visible', true)
        .order('created_at', { ascending: false })));
    } catch (e: any) { setWallError(e?.message || 'Couldn’t load the wall.'); setWallLoading(false); return; }
    if (error) { setWallError(error.message); setWallLoading(false); return; }
    const items = await Promise.all((rows || []).map(async (r: any) => {
      const { data: resolved } = await supabase.rpc('resolve_shared_content', { p_share_id: r.id });
      const c = Array.isArray(resolved) ? resolved[0] : null;
      return {
        shareId: r.id,
        contentType: r.content_type,
        audience: r.audience as string,
        teamName: r.teams?.name ?? null,
        createdAt: r.created_at,
        title: c?.title ?? (r.content_type === 'game' ? 'Shared game' : '(content unavailable)'),
        storagePath: c?.storage_path ?? null,
        startTime: c?.start_time ?? null,
        endTime: c?.end_time ?? null,
        note: (r.note as string) ?? null,
      };
    }));
    setWall(items);
    setWallLoading(false);
  }

  useEffect(() => {
    if (selectedTab === 'wall') loadWall();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTab, playerId]);

  // Take a post off the wall — flip on_wall=false so it drops back into
  // "Shared with you" (the item stays shared with the family, just off the wall).
  function takeOffWall(shareId: string, title: string) {
    Alert.alert('Take off wall', `Take “${title}” off ${name || 'the'} wall? It stays in "Shared with you".`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Take off', style: 'destructive', onPress: async () => {
          const { error } = await supabase.rpc('set_share_on_wall', { p_share_id: shareId, p_on_wall: false });
          if (error) Alert.alert('Error', error.message);
          else { loadWall(); loadInbox(); }
        },
      },
    ]);
  }

  function openShared(item: { shareId: string; contentType: string; title: string; storagePath: string | null; startTime: number | null; endTime: number | null; contentId?: string; sharedBy?: string | null }) {
    // moderation params only carry through for inbox items (others' content);
    // wall items are the viewer's own posts, so sharedBy stays empty → no report.
    const mod = { contentType: item.contentType, contentId: item.contentId ?? '', shareId: item.shareId, sharedBy: item.sharedBy ?? '' };
    if (item.contentType === 'game') {
      router.push({ pathname: '/game-player', params: { title: item.title, ...mod } });
      return;
    }
    if (!item.storagePath) { Alert.alert('Unavailable', 'This content could not be loaded.'); return; }
    router.push({
      pathname: '/shared-viewer',
      params: {
        title: item.title,
        storagePath: item.storagePath,
        startTime: item.startTime != null ? String(item.startTime) : '',
        endTime: item.endTime != null ? String(item.endTime) : '',
        ...mod,
      },
    });
  }

  // Put a "Shared with you" item on the kid's wall — flip on_wall=true on the
  // SAME share row (no new row). Family-wide by construction: every linked
  // guardian's wall reads on_wall=true, and the sharer's note rides the row.
  // Any note from the coach/sharer travels as-is; the guardian doesn't retype it.
  async function putOnWall(shareId: string) {
    const { error } = await supabase.rpc('set_share_on_wall', { p_share_id: shareId, p_on_wall: true });
    if (error) { Alert.alert('Error', error.message); return; }
    loadInbox();
    loadWall();
  }

  // Pick → one-shot upload to the private Videos bucket (kid-photos/<id>/<ts>.jpg)
  // with the user's JWT (mirrors game.tsx) → save the path via set_kid_photo RPC
  // → re-sign for immediate display.
  async function pickAndUploadPhoto() {
    if (!playerId) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo access to set a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (result.canceled) return;
    const asset = result.assets[0];

    setUploadingPhoto(true);
    try {
      const token = await getFreshToken();
      const dest = `kid-photos/${playerId}/${Date.now()}.jpg`;
      const res = await FileSystem.uploadAsync(
        `${SUPABASE_STORAGE_URL}/storage/v1/object/Videos/${dest}`,
        asset.uri,
        {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'image/jpeg',
            'x-upsert': 'true',
          },
        }
      );
      if (res.status !== 200) {
        throw new Error(`Upload failed: ${res.status} ${(res.body || '').slice(0, 200)}`);
      }
      const { error } = await supabase.rpc('set_kid_photo', { player_id: playerId, photo_path: dest });
      if (error) throw new Error(error.message);

      setPhotoPath(dest);
      const signed = await getSignedVideoUrl(dest);
      setPhotoUri(signed);
    } catch (e: any) {
      Alert.alert('Photo error', e?.message ?? 'Could not set photo');
    } finally {
      setUploadingPhoto(false);
    }
  }

  // Save name/grad via update_kid RPC. Returns to the wall view.
  async function save() {
    if (!name.trim()) { Alert.alert("Enter the kid's name"); return; }
    if (!playerId) return;
    setSaving(true);
    const { error } = await supabase.rpc('update_kid', {
      player_id: playerId,
      name: name.trim(),
      grad_class: gradClass.trim() || null,
    });
    if (error) {
      Alert.alert('Error saving', error.message);
      setSaving(false);
      return;
    }
    await refreshKids();
    setSaving(false);
    setEditing(false);
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top + 12 }]}>
        <ActivityIndicator size="large" color="#534AB7" />
      </View>
    );
  }

  // Edit form (name + grad class).
  if (editing) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => setEditing(false)} style={styles.back}>
          <Text style={styles.backText}>← Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Edit kid</Text>
        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Kid's name"
          placeholderTextColor="#888"
          editable={!saving}
          autoFocus
        />
        <Text style={styles.label}>Grad class</Text>
        <TextInput
          style={styles.input}
          value={gradClass}
          onChangeText={setGradClass}
          placeholder="e.g. 2032/2033"
          placeholderTextColor="#888"
          editable={!saving}
        />
        <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving}>
          <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Add-to-team picker (coaching teams + optional jersey).
  if (showAddTeam) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          onPress={() => { setShowAddTeam(false); setSelectedTeamId(null); setJerseyInput(''); }}
          style={styles.back}
        >
          <Text style={styles.backText}>← Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Add to team</Text>
        {coachingTeams.length === 0 ? (
          <Text style={styles.sports}>You don&apos;t coach or admin any teams.</Text>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled">
            {coachingTeams.map(t => {
              const selected = selectedTeamId === t.team_id;
              const already = kidTeams.some(kt => kt.team_id === t.team_id);
              return (
                <TouchableOpacity
                  key={t.team_id}
                  style={[styles.teamRow, selected && styles.teamRowActive]}
                  onPress={() => setSelectedTeamId(t.team_id)}
                >
                  <View>
                    <Text style={styles.teamRowName}>{t.name}</Text>
                    <Text style={styles.teamRowRole}>{t.role}{already ? ' · already added' : ''}</Text>
                  </View>
                  {selected && <Ionicons name="checkmark-circle" size={20} color="#534AB7" />}
                </TouchableOpacity>
              );
            })}
            <Text style={styles.label}>Jersey number (optional)</Text>
            <TextInput
              style={styles.input}
              value={jerseyInput}
              onChangeText={setJerseyInput}
              placeholder="e.g. 32"
              placeholderTextColor="#888"
              editable={!attaching}
            />
            <TouchableOpacity
              style={[styles.saveBtn, (!selectedTeamId || attaching) && styles.saveBtnDisabled]}
              onPress={attachToTeam}
              disabled={!selectedTeamId || attaching}
            >
              <Text style={styles.saveBtnText}>{attaching ? 'Adding…' : 'Add to team'}</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>
    );
  }

  // Wall.
  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.topRow}>
        <TouchableOpacity onPress={goBackOrHome} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setEditing(true)} style={styles.editBtn} hitSlop={8}>
          <Ionicons name="create-outline" size={18} color="#534AB7" />
          <Text style={styles.editText}>Edit</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.kidBody} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {/* Header: tappable avatar (photo or initials) + name + grad + sports */}
      <View style={styles.headerBlock}>
        <TouchableOpacity
          onPress={pickAndUploadPhoto}
          disabled={uploadingPhoto}
          activeOpacity={0.8}
          style={styles.avatarWrap}
        >
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.avatarImage} contentFit="cover" cachePolicy="memory-disk" transition={120} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: teamColor(playerId || name) }]}>
              <Text style={styles.avatarText}>{initials(name)}</Text>
            </View>
          )}
          {uploadingPhoto ? (
            <View style={styles.avatarOverlay}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : (
            <View style={styles.cameraBadge}>
              <Ionicons name="camera" size={14} color="#fff" />
            </View>
          )}
        </TouchableOpacity>
        <Text style={styles.name}>{name}</Text>
        {gradClass ? <Text style={styles.grad}>{gradClass}</Text> : null}
        {/* Teams the kid is on (player_teams), with per-team jersey. */}
        {kidTeams.length > 0 ? (
          <View style={styles.teamChips}>
            {kidTeams.map(t => (
              <TouchableOpacity key={t.team_id} style={styles.teamChip} onLongPress={() => leaveTeam(t)}>
                <Text style={styles.teamChipText}>
                  {t.name}{t.jersey_number ? ` · #${t.jersey_number}` : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <Text style={styles.sports}>No sports yet</Text>
        )}
        <TouchableOpacity style={styles.addTeamBtn} onPress={() => setShowAddTeam(true)}>
          <Ionicons name="add" size={16} color="#534AB7" />
          <Text style={styles.addTeamText}>Add to team</Text>
        </TouchableOpacity>

        {/* Past teams — frozen keepsake cards. Tap to browse the kid's games from
            that team (access survives leaving via game_lineups + parent link). */}
        {pastTeams.length > 0 && (
          <View style={styles.pastBlock}>
            <Text style={styles.pastTitle}>Past teams</Text>
            <View style={styles.pastRow}>
              {pastTeams.map(t => (
                <TouchableOpacity
                  key={t.team_id}
                  style={styles.pastCard}
                  onPress={() => router.push({ pathname: '/team-archive', params: { playerId: playerId!, teamId: t.team_id, teamName: t.name } })}
                >
                  <TeamLogo logoPath={t.logo_path} name={t.name} size={48} />
                  <Text style={styles.pastCardName} numberOfLines={2}>{t.name}</Text>
                  <Text style={styles.pastCardMeta}>View games ›</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </View>

      {/* Guardians — who manages this kid; share the code to add family. */}
      {guardians.length > 0 && (
        <View style={styles.guardiansBlock}>
          <TouchableOpacity style={styles.guardiansCard} onPress={() => setGuardiansOpen(o => !o)} activeOpacity={0.7}>
            <View style={styles.guardiansIcon}><Ionicons name="people" size={18} color="#b9b1e8" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.guardiansCardTitle}>Share with family</Text>
              <Text style={styles.guardiansCardSub} numberOfLines={1}>Invite family with a sign-up code · {guardians.length} of 4</Text>
            </View>
            <Ionicons name={guardiansOpen ? 'chevron-up' : 'chevron-down'} size={18} color="#888" />
          </TouchableOpacity>
          {guardiansOpen && <>
          {guardians.map(g => (
            <View key={g.user_id} style={styles.guardianRow}>
              <Text style={styles.guardianName} numberOfLines={1}>
                {g.name}{g.is_you ? ' (you)' : ''}{g.relationship === 'parent' ? ' · primary' : ''}
              </Text>
              {g.is_you
                ? (g.relationship !== 'parent' && (
                    <TouchableOpacity onPress={() => removeGuardian(g.user_id, g.name, true)} hitSlop={8}>
                      <Text style={styles.gLeave}>Leave</Text>
                    </TouchableOpacity>
                  ))
                : (amPrimary && (
                    <TouchableOpacity onPress={() => removeGuardian(g.user_id, g.name, false)} hitSlop={8}>
                      <Text style={styles.gRemove}>Remove</Text>
                    </TouchableOpacity>
                  ))}
            </View>
          ))}
          {guardianCode && guardians.length < 4 ? (
            <View style={styles.gCodeCard}>
              <View style={styles.gCodeRow}>
                <View>
                  <Text style={styles.gCodeLabel}>Invite code</Text>
                  <Text style={styles.gCodeBig}>{guardianCode}</Text>
                </View>
                <TouchableOpacity style={styles.gShareBtn} onPress={shareGuardianCode}>
                  <Ionicons name="share-outline" size={15} color="#fff" />
                  <Text style={styles.gShareText}>Share</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.gHint}>Share with a co-parent or grandparents so they can see {name || 'your kid'}’s film. Up to 4 guardians.</Text>
              <TouchableOpacity onPress={resetGuardianCode} hitSlop={6}>
                <Text style={styles.gReset}>Reset code</Text>
              </TouchableOpacity>
            </View>
          ) : guardians.length >= 4 ? (
            <Text style={styles.gHint}>Guardian limit reached (4).</Text>
          ) : null}
          </>}
        </View>
      )}

      {/* Filter bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterBar}
        style={styles.filterBarWrap}
      >
        {TABS.map(tab => {
          const active = selectedTab === tab.key;
          return (
            <TouchableOpacity key={tab.key} style={styles.tab} onPress={() => setSelectedTab(tab.key)}>
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab.label}</Text>
              {/* Unseen-count badge slot — render here when wired (count > 0). */}
              {active && <View style={styles.tabUnderline} />}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Content */}
      <View style={[styles.content, ((selectedTab === 'shared' && inbox.length > 0) || (selectedTab === 'wall' && wall.length > 0)) && styles.contentTop]}>
        {selectedTab === 'shared' ? (
          inboxLoading ? (
            <ActivityIndicator size="large" color="#534AB7" />
          ) : inboxError ? (
            <LoadError message={inboxError} onRetry={loadInbox} />
          ) : inbox.length === 0 ? (
            <Text style={styles.empty}>Nothing shared yet</Text>
          ) : (
            <View style={styles.inboxList}>
              {inbox.map(item => {
                const isReel = item.contentType === 'reel';
                const typeLabel = item.contentType.charAt(0).toUpperCase() + item.contentType.slice(1);
                return (
                  <View key={item.shareId}>
                    <ContentCard
                      content={{ id: item.contentId ?? item.shareId, kind: isReel ? 'reel' : 'game', title: item.title, meta: `From ${item.sharedBy === userId ? 'you' : (item.sharedByName ?? 'someone')} · ${new Date(item.createdAt).toLocaleDateString()}`, typeLabel, thumbnailUri: null }}
                      onOpen={() => openShared(item)}
                      onLongPress={() => showContentActions({
                        contentType: item.contentType, contentId: item.contentId, shareId: item.shareId, sharedByUserId: item.sharedBy,
                        canRemove: item.sharedBy === userId,
                        hideFromWallLabel: item.sharedBy && item.sharedBy !== userId ? (name ? `Hide from ${name}’s wall` : 'Hide from this wall') : undefined,
                        onChanged: loadInbox,
                      })}
                      showPlayOnThumb
                      onPlay={() => openShared(item)}
                      note={item.note ? { text: item.note } : undefined}
                    />
                    <TouchableOpacity style={styles.saveWallBtn} onPress={() => putOnWall(item.shareId)}>
                      <Text style={styles.saveWallText}>Put on wall</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )
        ) : selectedTab === 'wall' ? (
          wallLoading ? (
            <ActivityIndicator size="large" color="#534AB7" />
          ) : wallError ? (
            <LoadError message={wallError} onRetry={loadWall} />
          ) : wall.length === 0 ? (
            <Text style={styles.empty}>Nothing on the wall yet</Text>
          ) : (
            <View style={styles.inboxList}>
              {wall.map(item => {
                const isReel = item.contentType === 'reel';
                const typeLabel = item.contentType.charAt(0).toUpperCase() + item.contentType.slice(1);
                return (
                  <ContentCard
                    key={item.shareId}
                    content={{ id: item.contentId ?? item.shareId, kind: isReel ? 'reel' : 'game', title: item.title, meta: new Date(item.createdAt).toLocaleDateString(), typeLabel, thumbnailUri: null }}
                    onOpen={() => openShared(item)}
                    showPlayOnThumb
                    onPlay={() => openShared(item)}
                    note={item.note ? { text: item.note } : undefined}
                    actions={[{ icon: 'trash-outline', label: 'Take off wall', onPress: () => takeOffWall(item.shareId, item.title) }]}
                  />
                );
              })}
            </View>
          )
        ) : (
          <Text style={styles.empty}>Nothing here yet</Text>
        )}
      </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingHorizontal: 20 },
  center: { alignItems: 'center', justifyContent: 'center' },

  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { paddingVertical: 8 },
  backText: { color: '#534AB7', fontSize: 16 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8 },
  editText: { color: '#534AB7', fontSize: 16 },

  headerBlock: { alignItems: 'center', marginTop: 8, marginBottom: 20 },
  avatarWrap: { width: 84, height: 84, marginBottom: 12 },
  avatar: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  avatarImage: { width: 84, height: 84, borderRadius: 42, backgroundColor: '#1a1a1a' },
  avatarText: { color: '#fff', fontSize: 32, fontWeight: '700' },
  avatarOverlay: {
    position: 'absolute', width: 84, height: 84, borderRadius: 42,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
  cameraBadge: {
    position: 'absolute', right: 0, bottom: 0, width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#534AB7', alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#000',
  },
  name: { color: '#fff', fontSize: 26, fontWeight: '700', textAlign: 'center' },
  grad: { color: '#aaa', fontSize: 14, marginTop: 4, textAlign: 'center' },
  sports: { color: '#666', fontSize: 13, marginTop: 8, textAlign: 'center' },
  teamChips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 8 },
  teamChip: { backgroundColor: '#1a1a1a', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#333' },
  teamChipText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  addTeamBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12, paddingVertical: 6 },
  addTeamText: { color: '#534AB7', fontSize: 14, fontWeight: '600' },
  teamRow: { backgroundColor: '#1a1a1a', borderRadius: 8, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#333', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  teamRowActive: { borderColor: '#534AB7', backgroundColor: '#1f1a33' },
  teamRowName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  teamRowRole: { color: '#888', fontSize: 12, textTransform: 'capitalize' },
  saveBtnDisabled: { opacity: 0.5 },

  filterBarWrap: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: '#222' },
  filterBar: { gap: 20, paddingRight: 8 },
  tab: { paddingBottom: 10, alignItems: 'center' },
  tabText: { color: '#888', fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  tabUnderline: { height: 2, backgroundColor: '#534AB7', alignSelf: 'stretch', marginTop: 8 },

  kidBody: { paddingBottom: 40 },
  content: { alignItems: 'center', justifyContent: 'center', minHeight: 220 },
  contentTop: { alignItems: 'stretch', justifyContent: 'flex-start', paddingTop: 16 },
  empty: { color: '#555', fontSize: 15 },
  inboxList: { alignSelf: 'stretch' },
  inboxCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#333' },
  inboxMain: { flex: 1, paddingRight: 10 },
  typeBadgeWrap: { marginBottom: 6 },
  inboxTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  inboxMeta: { color: '#888', fontSize: 12, marginTop: 4 },
  wallDate: { color: '#888', fontSize: 12 },
  removeBtn: { padding: 8, marginLeft: 6 },
  saveWallBtn: { backgroundColor: '#534AB7', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  saveWallText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  badge: { minWidth: 16, height: 16, borderRadius: 8, backgroundColor: '#D85A30', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },

  title: { color: '#fff', fontSize: 28, fontWeight: '700', marginBottom: 24, marginTop: 8 },
  label: { color: '#aaa', fontSize: 13, fontWeight: '600', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: '#1a1a1a', borderRadius: 8, padding: 14, marginBottom: 18, fontSize: 16, borderWidth: 1, borderColor: '#333', color: '#fff' },
  saveBtn: { backgroundColor: '#534AB7', borderRadius: 8, padding: 16, alignItems: 'center', marginTop: 8 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  guardiansBlock: { marginTop: 16, marginBottom: 8, alignSelf: 'stretch' },
  guardiansCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#141414', borderRadius: 12, padding: 12 },
  guardiansIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#2a2540', alignItems: 'center', justifyContent: 'center' },
  guardiansCardTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  guardiansCardSub: { color: '#888', fontSize: 12, marginTop: 1 },
  guardianRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#222' },
  guardianName: { color: '#fff', fontSize: 15, fontWeight: '600', flex: 1 },
  gLeave: { color: '#c0392b', fontWeight: '700', fontSize: 13 },
  gRemove: { color: '#c0392b', fontWeight: '700', fontSize: 13 },
  gCodeCard: { backgroundColor: '#141019', borderRadius: 12, padding: 14, marginTop: 12 },
  gCodeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gCodeLabel: { color: '#8b83e6', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  gCodeBig: { color: '#fff', fontSize: 26, fontWeight: '800', letterSpacing: 4, marginTop: 2 },
  gShareBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#534AB7', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8 },
  gShareText: { color: '#fff', fontWeight: '700' },
  gHint: { color: '#888', fontSize: 12, lineHeight: 16, marginTop: 8 },
  gReset: { color: '#8b83e6', fontWeight: '700', fontSize: 13, marginTop: 10 },
  pastBlock: { marginTop: 20, alignSelf: 'stretch' },
  pastTitle: { color: '#888', fontSize: 13, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 10 },
  pastRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  pastCard: { width: 92, alignItems: 'center', gap: 6 },
  pastCardName: { color: '#ddd', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  pastCardMeta: { color: '#8b83e6', fontSize: 11, fontWeight: '700' },
});

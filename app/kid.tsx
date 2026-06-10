import { useTeamContext } from '@/context';
import { getSignedVideoUrl } from '@/lib/native/video-url';
import { supabase } from '@/supabase';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getFreshToken, SUPABASE_STORAGE_URL } from '@/lib/native/video-upload';
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
  const { refreshKids, userTeams } = useTeamContext();
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
  const [kidTeams, setKidTeams] = useState<{ team_id: string; name: string; jersey_number: string | null }[]>([]);
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [jerseyInput, setJerseyInput] = useState('');
  const [attaching, setAttaching] = useState(false);
  // Inbox ("Shared with you") — player-audience shares targeting this kid.
  const [inbox, setInbox] = useState<{
    shareId: string; contentType: string; contentId: string;
    sharedBy: string | null; createdAt: string; title: string;
    storagePath: string | null; startTime: number | null; endTime: number | null;
  }[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  // Save-to-wall tier picker.
  const [pickerItem, setPickerItem] = useState<typeof inbox[number] | null>(null);
  const [pickerStage, setPickerStage] = useState<'tier' | 'team'>('tier');
  const [posting, setPosting] = useState(false);

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
      .select('team_id, jersey_number, teams ( name )')
      .eq('player_id', playerId);
    const rows = (data || [])
      .filter((r: any) => r.teams)
      .map((r: any) => ({ team_id: r.team_id, name: r.teams.name, jersey_number: r.jersey_number ?? null }));
    setKidTeams(rows);
  }

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
    const { data: rows } = await supabase
      .from('shares')
      .select('id, content_type, content_id, shared_by_user_id, created_at')
      .eq('target_player_id', playerId)
      .eq('audience', 'player')
      .order('created_at', { ascending: false });
    const items = await Promise.all((rows || []).map(async (r: any) => {
      const { data: resolved } = await supabase.rpc('resolve_shared_content', { p_share_id: r.id });
      const c = Array.isArray(resolved) ? resolved[0] : null;
      return {
        shareId: r.id,
        contentType: r.content_type,
        contentId: r.content_id,
        sharedBy: r.shared_by_user_id ?? null,
        createdAt: r.created_at,
        title: c?.title ?? '(content unavailable)',
        storagePath: c?.storage_path ?? null,
        startTime: c?.start_time ?? null,
        endTime: c?.end_time ?? null,
      };
    }));
    setInbox(items);
    setInboxLoading(false);
  }

  // Load the inbox when the "Shared with you" tab is active.
  useEffect(() => {
    if (selectedTab === 'shared') loadInbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTab, playerId]);

  function openShared(item: typeof inbox[number]) {
    if (!item.storagePath) { Alert.alert('Unavailable', 'This content could not be loaded.'); return; }
    router.push({
      pathname: '/shared-viewer',
      params: {
        title: item.title,
        storagePath: item.storagePath,
        startTime: item.startTime != null ? String(item.startTime) : '',
        endTime: item.endTime != null ? String(item.endTime) : '',
      },
    });
  }

  function openSaveToWall(item: typeof inbox[number]) {
    setPickerItem(item);
    setPickerStage('tier');
  }

  // Team tier: 0 → alert, 1 → post directly, >1 → choose. Reuses kidTeams.
  function chooseTeam() {
    if (kidTeams.length === 0) {
      Alert.alert('No teams', `${name || 'This kid'} isn't on a team yet.`);
      return;
    }
    if (kidTeams.length === 1) {
      if (pickerItem) doPost(pickerItem, 'team', kidTeams[0].team_id, kidTeams[0].name);
      return;
    }
    setPickerStage('team');
  }

  // Post to the wall at the chosen audience (+ team for 'team'). Public uses the
  // 4-arg style (no p_team_id); team passes p_team_id. RPC errors are surfaced.
  async function doPost(
    item: typeof inbox[number],
    audience: 'public' | 'team',
    teamId: string | null,
    teamName?: string
  ) {
    if (!playerId) return;
    setPosting(true);
    const params: Record<string, any> = {
      p_content_type: item.contentType,
      p_content_id: item.contentId,
      p_audience: audience,
      p_target_player_id: playerId,
    };
    if (teamId) params.p_team_id = teamId;
    const { error } = await supabase.rpc('post_to_wall', params);
    setPosting(false);
    setPickerItem(null);
    setPickerStage('tier');
    if (error) Alert.alert('Error', error.message);
    else Alert.alert('Saved to wall', audience === 'public' ? 'Posted to public wall.' : `Posted to ${teamName ?? 'team'} wall.`);
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
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setEditing(true)} style={styles.editBtn} hitSlop={8}>
          <Ionicons name="create-outline" size={18} color="#534AB7" />
          <Text style={styles.editText}>Edit</Text>
        </TouchableOpacity>
      </View>

      {/* Header: tappable avatar (photo or initials) + name + grad + sports */}
      <View style={styles.headerBlock}>
        <TouchableOpacity
          onPress={pickAndUploadPhoto}
          disabled={uploadingPhoto}
          activeOpacity={0.8}
          style={styles.avatarWrap}
        >
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.avatarImage} />
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
              <View key={t.team_id} style={styles.teamChip}>
                <Text style={styles.teamChipText}>
                  {t.name}{t.jersey_number ? ` · #${t.jersey_number}` : ''}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.sports}>No sports yet</Text>
        )}
        <TouchableOpacity style={styles.addTeamBtn} onPress={() => setShowAddTeam(true)}>
          <Ionicons name="add" size={16} color="#534AB7" />
          <Text style={styles.addTeamText}>Add to team</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.addTeamBtn}
          onPress={() => router.push({ pathname: '/upload', params: { playerId } })}
        >
          <Ionicons name="cloud-upload-outline" size={16} color="#534AB7" />
          <Text style={styles.addTeamText}>Upload to {name || 'this kid'}</Text>
        </TouchableOpacity>
      </View>

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
      <View style={[styles.content, selectedTab === 'shared' && inbox.length > 0 && styles.contentTop]}>
        {selectedTab === 'shared' ? (
          inboxLoading ? (
            <ActivityIndicator size="large" color="#534AB7" />
          ) : inbox.length === 0 ? (
            <Text style={styles.empty}>Nothing shared yet</Text>
          ) : (
            <ScrollView style={styles.inboxList} contentContainerStyle={{ paddingBottom: 20 }}>
              {inbox.map(item => (
                <View key={item.shareId} style={styles.inboxCard}>
                  <TouchableOpacity style={styles.inboxMain} onPress={() => openShared(item)}>
                    <Text style={styles.inboxTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.inboxMeta}>
                      From {item.sharedBy ? item.sharedBy.slice(0, 8) + '…' : 'unknown'} · {new Date(item.createdAt).toLocaleDateString()}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.saveWallBtn} onPress={() => openSaveToWall(item)}>
                    <Text style={styles.saveWallText}>Save to wall</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )
        ) : (
          <Text style={styles.empty}>Nothing here yet</Text>
        )}
      </View>

      <Modal visible={!!pickerItem} transparent animationType="fade" onRequestClose={() => setPickerItem(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => { if (!posting) setPickerItem(null); }}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            {posting ? (
              <ActivityIndicator size="large" color="#534AB7" />
            ) : pickerStage === 'tier' ? (
              <>
                <Text style={styles.modalTitle}>Save to wall</Text>
                <TouchableOpacity style={styles.modalOption} onPress={() => pickerItem && doPost(pickerItem, 'public', null)}>
                  <Ionicons name="globe-outline" size={18} color="#fff" />
                  <Text style={styles.modalOptionText}>Public</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalOption} onPress={chooseTeam}>
                  <Ionicons name="people-outline" size={18} color="#fff" />
                  <Text style={styles.modalOptionText}>Team</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalCancel} onPress={() => setPickerItem(null)}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.modalTitle}>Choose a team</Text>
                {kidTeams.map(t => (
                  <TouchableOpacity key={t.team_id} style={styles.modalOption} onPress={() => pickerItem && doPost(pickerItem, 'team', t.team_id, t.name)}>
                    <Text style={styles.modalOptionText}>{t.name}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={styles.modalCancel} onPress={() => setPickerStage('tier')}>
                  <Text style={styles.modalCancelText}>← Back</Text>
                </TouchableOpacity>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
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

  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  contentTop: { alignItems: 'stretch', justifyContent: 'flex-start', paddingTop: 16 },
  empty: { color: '#555', fontSize: 15 },
  inboxList: { alignSelf: 'stretch' },
  inboxCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#333' },
  inboxMain: { flex: 1, paddingRight: 10 },
  inboxTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  inboxMeta: { color: '#888', fontSize: 12, marginTop: 4 },
  saveWallBtn: { backgroundColor: '#534AB7', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  saveWallText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#1a1a1a', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 32 },
  modalTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 14, textAlign: 'center' },
  modalOption: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#222', borderRadius: 10, padding: 16, marginBottom: 8 },
  modalOptionText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  modalCancel: { padding: 14, alignItems: 'center', marginTop: 4 },
  modalCancelText: { color: '#888', fontSize: 15 },

  badge: { minWidth: 16, height: 16, borderRadius: 8, backgroundColor: '#D85A30', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },

  title: { color: '#fff', fontSize: 28, fontWeight: '700', marginBottom: 24, marginTop: 8 },
  label: { color: '#aaa', fontSize: 13, fontWeight: '600', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: '#1a1a1a', borderRadius: 8, padding: 14, marginBottom: 18, fontSize: 16, borderWidth: 1, borderColor: '#333', color: '#fff' },
  saveBtn: { backgroundColor: '#534AB7', borderRadius: 8, padding: 16, alignItems: 'center', marginTop: 8 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

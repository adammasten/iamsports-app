import { useTeamContext } from '@/context';
import { getSignedVideoUrl } from '@/lib/native/video-url';
import { supabase } from '@/supabase';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getFreshToken, SUPABASE_STORAGE_URL } from './game';
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
  const { refreshKids } = useTeamContext();
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
        {/* Sports row — placeholder until sports data is wired. */}
        <Text style={styles.sports}>No sports yet</Text>
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
      <View style={styles.content}>
        <Text style={styles.empty}>Nothing here yet</Text>
      </View>
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

  filterBarWrap: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: '#222' },
  filterBar: { gap: 20, paddingRight: 8 },
  tab: { paddingBottom: 10, alignItems: 'center' },
  tabText: { color: '#888', fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  tabUnderline: { height: 2, backgroundColor: '#534AB7', alignSelf: 'stretch', marginTop: 8 },

  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: '#555', fontSize: 15 },

  badge: { minWidth: 16, height: 16, borderRadius: 8, backgroundColor: '#D85A30', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },

  title: { color: '#fff', fontSize: 28, fontWeight: '700', marginBottom: 24, marginTop: 8 },
  label: { color: '#aaa', fontSize: 13, fontWeight: '600', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: '#1a1a1a', borderRadius: 8, padding: 14, marginBottom: 18, fontSize: 16, borderWidth: 1, borderColor: '#333', color: '#fff' },
  saveBtn: { backgroundColor: '#534AB7', borderRadius: 8, padding: 16, alignItems: 'center', marginTop: 8 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

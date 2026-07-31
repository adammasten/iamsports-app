// Pick an image and upload it as a team's logo to the private Videos bucket
// (team-logos/<team_id>/<ts>.jpg), then save the key on teams.logo_path (coach-
// gated by teams_update RLS). Mirrors the kid-photo upload in kid.tsx. Returns
// the new object key, or null if the user cancelled. Throws on failure.
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { getFreshToken, SUPABASE_STORAGE_URL } from '@/lib/native/video-upload';
import { supabase } from '@/supabase';

export async function pickAndUploadTeamLogo(teamId: string): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Allow photo access to set a team logo.');
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.7,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];

  const token = await getFreshToken();
  const dest = `team-logos/${teamId}/${Date.now()}.jpg`;
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
    },
  );
  if (res.status !== 200) {
    throw new Error(`Upload failed: ${res.status} ${(res.body || '').slice(0, 200)}`);
  }
  const { error } = await supabase.from('teams').update({ logo_path: dest }).eq('id', teamId);
  if (error) throw new Error(error.message);
  return dest;
}

import { Alert } from 'react-native';
import { PERMISSIONS, hasPermission, type PermissionKey } from '@/lib/core/permissions';

// UI enforcement for the 8 team permissions. Wrap a team-scoped action:
//
//   if (!(await requirePermission(teamId, 'post_wall'))) return;
//
// Returns true when allowed. When blocked, shows a friendly Alert explaining the
// coach hasn't enabled it, and returns false. Additive + safe: the 6 normal
// permissions default ON and coaches always pass, so this only stops someone a
// coach has explicitly restricted. A null/empty teamId (personal, no team) is
// always allowed.
export async function requirePermission(
  teamId: string | null | undefined,
  key: PermissionKey,
): Promise<boolean> {
  if (await hasPermission(teamId, key)) return true;
  const meta = PERMISSIONS.find(p => p.key === key);
  Alert.alert(
    'Not enabled for you',
    `Your coach hasn’t enabled “${meta?.label ?? 'this'}” for you on this team` +
      (meta ? `, so you can’t ${meta.action} here.` : '.'),
  );
  return false;
}

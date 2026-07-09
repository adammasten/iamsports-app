// ============================================================
// Team permissions — the app-side source of truth for the 8 grid permissions.
// Mirrors the DB engine (has_team_permission): the enum keys, the system
// defaults, and the fallback order (override -> team default -> system default).
// The DB stays the ENFORCEMENT source of truth; this is the client mirror used
// to RENDER the grid and (later) for hybrid app-side checks. Keep the keys and
// defaults in lockstep with migration_team_permissions.sql.
// RN-agnostic -> lives in lib/core.
// ============================================================

export type PermissionKey =
  | 'post_wall' | 'upload_video' | 'tag_videos' | 'send_to_team'
  | 'create_games' | 'build_reels' | 'delete_content' | 'manage_roster';

export type PermissionMeta = {
  key: PermissionKey;
  label: string;        // full name (legend)
  short: string;        // column header (grid is width-constrained)
  description: string;  // one-line, shown to the coach
  action: string;       // lowercase verb phrase for confirm dialogs ("post to the team wall")
  dangerous: boolean;   // granting this warrants a confirm even though it's an ON
  systemDefault: boolean;
};

// Order + defaults mirror the DB enum + has_team_permission's system defaults
// (6 ON; delete_content + manage_roster OFF).
export const PERMISSIONS: PermissionMeta[] = [
  { key: 'post_wall',      label: 'Post to team wall',     short: 'Post',   description: 'Share videos and reels to the team’s wall for everyone to see.',  action: 'post to the team wall',      dangerous: false, systemDefault: true },
  { key: 'upload_video',   label: 'Upload video',          short: 'Upload', description: 'Add video files into the app.',                                   action: 'upload videos',              dangerous: false, systemDefault: true },
  { key: 'tag_videos',     label: 'Tag videos / games',    short: 'Tag',    description: 'Mark plays and moments in a video for highlights and breakdown.', action: 'tag videos and games',       dangerous: false, systemDefault: true },
  { key: 'send_to_team',   label: 'Send / donate to team', short: 'Send',   description: 'Give your footage to the coach’s Film Room to use.',              action: 'send footage to the team',   dangerous: false, systemDefault: true },
  { key: 'create_games',   label: 'Create / donate games', short: 'Games',  description: 'Set up a game (opponent, date) and add videos to it for the team.', action: 'create or donate games',   dangerous: false, systemDefault: true },
  { key: 'build_reels',    label: 'Edit / build reels',    short: 'Reels',  description: 'Combine clips into highlight reels.',                             action: 'edit and build reels',       dangerous: false, systemDefault: true },
  { key: 'delete_content', label: 'Delete content',        short: 'Delete', description: 'Remove videos, games, or reels.',                                 action: 'delete videos, games, or reels', dangerous: true, systemDefault: false },
  { key: 'manage_roster',  label: 'Manage roster',         short: 'Roster', description: 'Add or remove players and coaches, and approve join requests.',   action: 'manage the roster',          dangerous: true,  systemDefault: false },
];

// Fallback resolver — mirrors the DB has_team_permission (minus the coach/admin
// short-circuit, which the caller handles by role). Returns the effective on/off
// for a NON-coach subject given the optional stored values.
//   override   = team_member/player-level stored value (undefined = none)
//   teamDefault = team_permission_defaults stored value (undefined = none)
export function resolvePermission(
  meta: PermissionMeta,
  override: boolean | undefined,
  teamDefault: boolean | undefined,
): boolean {
  if (override !== undefined) return override;
  if (teamDefault !== undefined) return teamDefault;
  return meta.systemDefault;
}

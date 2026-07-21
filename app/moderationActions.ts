import { Alert } from 'react-native';
import { blockUser, reportContent, type ReportReason } from '@/lib/core/moderation';
import { supabase } from '@/supabase';

// Shared long-press action sheet for content shown on a wall (team wall, kid
// wall, coaches' board, shared viewers). Adapts to what the viewer can do:
//   • Report / Block — for ANOTHER user's content (Guideline 1.2).
//   • Remove from this wall — delete the share (own post, or a team coach). RLS
//     enforces; we detect a no-op delete and explain.
//   • Hide from <kid>'s wall — family-hide (hidden_by_family) content someone
//     ELSE posted to your kid's wall, when you can't delete it.

const REASONS: { key: ReportReason; label: string }[] = [
  { key: 'inappropriate', label: 'Inappropriate content' },
  { key: 'harassment', label: 'Harassment or bullying' },
  { key: 'child_safety', label: 'Child safety concern' },
  { key: 'spam', label: 'Spam' },
  { key: 'other', label: 'Other' },
];

type Target = {
  contentType: string;
  contentId: string;
  shareId?: string | null;
  sharedByUserId?: string | null;
  canRemove?: boolean;         // may DELETE this share (own post or team coach) → "Remove from this wall"
  hideFromWallLabel?: string;  // if set, offer a family-hide with this label (e.g. "Hide from Lars's wall")
  onChanged?: () => void;      // called after a successful action so the caller can refresh
};

export async function showContentActions(t: Target) {
  const { data: { user } } = await supabase.auth.getUser();
  const isOwn = !!(t.sharedByUserId && user && t.sharedByUserId === user.id);

  const buttons: any[] = [];
  if (t.canRemove && t.shareId) {
    buttons.push({ text: 'Remove from this wall', style: 'destructive', onPress: () => confirmRemove(t) });
  } else if (t.hideFromWallLabel && t.shareId) {
    buttons.push({ text: t.hideFromWallLabel, style: 'destructive', onPress: () => confirmHide(t) });
  }
  // Report/Block only apply to OTHER people's content.
  if (!isOwn) {
    buttons.push({ text: 'Report this content', onPress: () => promptReason(t) });
    if (t.sharedByUserId) buttons.push({ text: 'Block this person', style: 'destructive', onPress: () => confirmBlock(t) });
  }
  if (buttons.length === 0) return; // your own content with nothing to remove → no menu
  buttons.push({ text: 'Cancel', style: 'cancel' });
  Alert.alert('Options', undefined, buttons);
}

function confirmRemove(t: Target) {
  Alert.alert(
    'Remove from this wall?',
    'This takes it off this wall. It stays in your Film Room.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          if (!t.shareId) return;
          const { data, error } = await supabase.from('shares').delete().eq('id', t.shareId).select('id');
          if (error) { Alert.alert('Couldn’t remove', error.message); return; }
          if (!data || data.length === 0) {
            Alert.alert('Couldn’t remove', 'You can only remove content you posted, or content on a team you coach.');
            return;
          }
          t.onChanged?.();
        },
      },
    ],
  );
}

function confirmHide(t: Target) {
  Alert.alert(
    t.hideFromWallLabel ?? 'Hide from this wall?',
    'This hides it from your family’s view. It doesn’t delete what someone else posted.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Hide',
        style: 'destructive',
        onPress: async () => {
          if (!t.shareId) return;
          const { data, error } = await supabase.from('shares').update({ hidden_by_family: true }).eq('id', t.shareId).select('id');
          if (error) { Alert.alert('Couldn’t hide', error.message); return; }
          if (!data || data.length === 0) { Alert.alert('Couldn’t hide', 'You don’t have permission to hide this.'); return; }
          t.onChanged?.();
        },
      },
    ],
  );
}

function promptReason(t: Target) {
  Alert.alert('Report content', 'Why are you reporting this?', [
    ...REASONS.map(r => ({
      text: r.label,
      onPress: async () => {
        const { error } = await reportContent({
          contentType: t.contentType, contentId: t.contentId, shareId: t.shareId, reason: r.key,
        });
        if (error) { Alert.alert('Couldn’t send report', error); return; }
        Alert.alert('Thanks for the report', 'Our team reviews reports within 24 hours. This content is now hidden from your feed.');
        t.onChanged?.();
      },
    })),
    { text: 'Cancel', style: 'cancel' },
  ]);
}

function confirmBlock(t: Target) {
  Alert.alert(
    'Block this person?',
    'You won’t see their content and they won’t see yours. You can unblock them later.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: async () => {
          if (!t.sharedByUserId) return;
          const { error } = await blockUser(t.sharedByUserId);
          if (error) { Alert.alert('Couldn’t block', error); return; }
          Alert.alert('Blocked', 'You won’t see their content anymore.');
          t.onChanged?.();
        },
      },
    ],
  );
}

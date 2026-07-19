import { Alert } from 'react-native';
import { blockUser, reportContent, type ReportReason } from '@/lib/core/moderation';
import { supabase } from '@/supabase';

// Shared "Report or block" action sheet, opened from a long-press on any piece
// of another user's content (wall feeds, coaches' board, shared viewers). Keeps
// every surface's report/block behaviour identical — Guideline 1.2.

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
  onChanged?: () => void; // called after a successful report/block so the caller can refresh
};

export async function showContentActions(t: Target) {
  // Never offer report/block on the viewer's OWN content — you don't report
  // yourself. On your own posts this is a no-op (delete lives elsewhere).
  const { data: { user } } = await supabase.auth.getUser();
  if (t.sharedByUserId && user && t.sharedByUserId === user.id) return;

  const buttons: any[] = [
    { text: 'Report this content', onPress: () => promptReason(t) },
  ];
  if (t.sharedByUserId) {
    buttons.push({ text: 'Block this person', style: 'destructive', onPress: () => confirmBlock(t) });
  }
  buttons.push({ text: 'Cancel', style: 'cancel' });
  Alert.alert('Report or block', 'Help keep IamSports safe.', buttons);
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

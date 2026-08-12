// Cross-platform confirm dialog. React Native Web does NOT render Alert.alert's
// button dialog, so every "Delete this?" confirm silently did nothing on web.
// This returns a Promise<boolean>: native uses Alert.alert (two buttons), web uses
// the browser's confirm(). Usage:
//   if (await confirm({ title: 'Delete game?', confirmText: 'Delete', destructive: true })) { ...delete... }
import { Alert, Platform } from 'react-native';

export function confirm(opts: {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}): Promise<boolean> {
  const { title, message, confirmText = 'OK', cancelText = 'Cancel', destructive } = opts;

  if (Platform.OS === 'web') {
    const ok = typeof window !== 'undefined' && window.confirm(message ? `${title}\n\n${message}` : title);
    return Promise.resolve(!!ok);
  }

  return new Promise(resolve => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelText, style: 'cancel', onPress: () => resolve(false) },
        { text: confirmText, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

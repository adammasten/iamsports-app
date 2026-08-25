// RN's Alert is a NO-OP on the web app (react-native-web doesn't implement it),
// so any Alert.alert — including button arrays — silently does nothing in the
// browser. These give cross-platform feedback. Use webAlert for messages/errors,
// alertThenGo when a success message must be followed by navigation/an action.
import { Alert, Platform } from 'react-native';

export function webAlert(title: string, message: string) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.alert(message);
    return;
  }
  Alert.alert(title, message);
}

// On web (where Alert's button onPress never fires) the callback runs right after
// window.alert; on native it runs from the OK button so the message is seen first.
export function alertThenGo(title: string, message: string, go: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.alert(message);
    go();
    return;
  }
  Alert.alert(title, message, [{ text: 'OK', onPress: go }]);
}

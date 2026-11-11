/**
 * Alert.alert не работает в браузере (react-native-web), поэтому
 * подтверждения и уведомления сделаны кроссплатформенно.
 */
import { Alert, Platform } from 'react-native';

export function confirmAsync(title: string, message: string, okText = 'Да', destructive = false): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Отмена', style: 'cancel', onPress: () => resolve(false) },
        { text: okText, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export function notify(title: string, message = '') {
  if (Platform.OS === 'web') window.alert(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}

/** Человеческое сообщение из любой ошибки (без стек-трейсов). */
export function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return 'Что-то пошло не так. Попробуйте ещё раз.';
}

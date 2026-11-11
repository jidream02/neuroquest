/**
 * Защищённое хранилище небольших секретов (сессия).
 *  - Android: EncryptedSharedPreferences + Android Keystore
 *  - iOS: Keychain
 *  - Web: SecureStore недоступен → sessionStorage (живёт до закрытия вкладки).
 *    Это осознанное ограничение веб-версии, описано в отчёте.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const isWeb = Platform.OS === 'web';

export async function secureGet(key: string): Promise<string | null> {
  if (isWeb) return globalThis.sessionStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

export async function secureSet(key: string, value: string): Promise<void> {
  if (isWeb) {
    globalThis.sessionStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY, // не попадает в бэкапы iCloud
  });
}

export async function secureDelete(key: string): Promise<void> {
  if (isWeb) {
    globalThis.sessionStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

/**
 * Клиент сервера NeuroQuest API. В приложении НЕТ ключа ИИ — только адрес сервера.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import Storage from 'expo-sqlite/kv-store';
import { z } from 'zod';
import { TurnResponseSchema, type TurnRequest, type TurnResponse } from '../../shared/dmProtocol';

const PORT = 8787;
const URL_KEY = 'nq_server_url';

// ---------- Адрес сервера ----------

let customUrl: string | null = null;

/** Адрес, заданный пользователем в профиле (загружается при старте). */
export async function loadServerUrl(): Promise<void> {
  customUrl = await Storage.getItemAsync(URL_KEY).catch(() => null);
}

export const serverUrlSchema = z
  .string()
  .trim()
  .max(200, 'Слишком длинный адрес')
  .regex(/^https?:\/\/[a-zA-Z0-9.-]+(:\d{1,5})?\/?$/, 'Формат: http://192.168.1.10:8787 или https://example.com');

/** Сохранить свой адрес сервера; пустая строка — вернуть автоопределение. */
export async function setServerUrl(raw: string): Promise<void> {
  if (!raw.trim()) {
    customUrl = null;
    reachCache = null;
    await Storage.removeItemAsync(URL_KEY);
    return;
  }
  const url = serverUrlSchema.parse(raw).replace(/\/+$/, '');
  customUrl = url;
  reachCache = null;
  await Storage.setItemAsync(URL_KEY, url);
}

export const isCustomServerUrl = () => customUrl !== null;

/** Адрес сервера: свой из профиля → EXPO_PUBLIC_API_URL → тот же компьютер, где запущен Expo. */
export function apiBaseUrl(): string {
  if (customUrl) return customUrl;
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  if (Platform.OS === 'web') return `http://${globalThis.location?.hostname ?? 'localhost'}:${PORT}`;
  // В режиме разработки hostUri = «IP-компьютера:8081» — сервер на том же компьютере.
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host) return `http://${host}:${PORT}`;
  return Platform.OS === 'android' ? `http://10.0.2.2:${PORT}` : `http://localhost:${PORT}`;
}

// ---------- Запросы ----------

export class DmApiError extends Error {
  /** true — сервер недоступен (нет сети, выключен, таймаут): можно играть с офлайн-мастером. */
  constructor(message: string, public unreachable = false) {
    super(message);
  }
}

async function request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  // AbortController + setTimeout вместо AbortSignal.timeout — работает и в Hermes (Android/iOS).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(apiBaseUrl() + path, { ...init, signal: controller.signal });
  } catch {
    throw new DmApiError(
      controller.signal.aborted
        ? 'Мастер слишком долго думает. Попробуйте ещё раз.'
        : 'Нет связи с сервером мастера. Проверьте, что сервер запущен.',
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function requestTurn(req: TurnRequest): Promise<TurnResponse> {
  const res = await request(
    '/api/dm/turn',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) },
    60_000,
  );
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    // Ответ не JSON — по адресу отвечает что-то другое, а не наш сервер.
    throw new DmApiError(`Сервер вернул некорректный ответ (${res.status})`, true);
  }
  if (!res.ok) throw new DmApiError(body?.message ?? `Ошибка сервера (${res.status})`, res.status >= 500);
  // Ответ сервера тоже проверяем — на клиент не попадёт ничего вне протокола.
  const parsed = TurnResponseSchema.safeParse(body);
  if (!parsed.success) throw new DmApiError('Мастер ответил в неверном формате, попробуйте ещё раз');
  return parsed.data;
}

// Кэш доступности сервера: при недоступном сервере не ждём таймаут на каждом ходу.
let reachCache: { ok: boolean; at: number; url: string } | null = null;

export async function isServerReachable(): Promise<boolean> {
  const url = apiBaseUrl();
  if (reachCache && reachCache.url === url && Date.now() - reachCache.at < 60_000) return reachCache.ok;
  const ok = (await checkHealth(4000)).ok;
  reachCache = { ok, at: Date.now(), url };
  return ok;
}

export const resetReachability = () => {
  reachCache = null;
};

export async function checkHealth(timeoutMs = 5000): Promise<{ ok: boolean; mode?: string; ai?: boolean }> {
  try {
    const res = await request('/api/health', {}, timeoutMs);
    return (await res.json()) as { ok: boolean; mode?: string; ai?: boolean };
  } catch {
    return { ok: false };
  }
}

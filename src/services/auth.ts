/**
 * Аутентификация (всё локально, на устройстве).
 *  - Пароль → PBKDF2 (60 000 итераций, соль 16 байт). В базе только хэш.
 *  - Защита от перебора: после 5 ошибок аккаунт блокируется, время растёт: 30с, 60с, 2м… до 15м.
 *  - Одинаковое сообщение «неверный логин или пароль» — нельзя узнать, существует ли логин.
 *  - Сессия хранится в SecureStore и истекает при бездействии.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { hashPassword, verifyPassword, PASSWORD_ITERATIONS } from '../lib/crypto';
import * as repo from '../db/repo';
import { secureRandomBytes } from './random';
import { secureDelete, secureGet, secureSet } from './secureStorage';

export const MAX_ATTEMPTS = 5;
const BASE_LOCK_MS = 30_000;
const MAX_LOCK_MS = 15 * 60_000;
export const SESSION_TTL_MS = 30 * 60_000; // сессия живёт 30 минут без активности
const SESSION_KEY = 'nq_session';

export interface Session {
  userId: number;
  username: string;
  expiresAt: number;
}

export class AuthError extends Error {
  constructor(message: string, public lockedUntil?: number) {
    super(message);
  }
}

export function lockDuration(failedAttempts: number): number {
  if (failedAttempts < MAX_ATTEMPTS) return 0;
  return Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** (failedAttempts - MAX_ATTEMPTS));
}

// Хэш-«пустышка»: проверяем пароль даже для несуществующего логина,
// чтобы время ответа не выдавало, есть ли такой пользователь.
let dummyHash: Promise<Awaited<ReturnType<typeof hashPassword>>> | null = null;
const getDummy = () => (dummyHash ??= hashPassword('dummy-password-1', secureRandomBytes));

export async function register(db: SQLiteDatabase, username: string, password: string): Promise<Session> {
  if (await repo.findUserByName(db, username)) throw new AuthError('Этот логин уже занят');
  const pw = await hashPassword(password, secureRandomBytes, PASSWORD_ITERATIONS);
  const id = await repo.createUser(db, username, pw);
  await repo.audit(db, id, 'register');
  return startSession(id, username.trim());
}

export async function login(db: SQLiteDatabase, username: string, password: string): Promise<Session> {
  const user = await repo.findUserByName(db, username);
  if (!user) {
    await verifyPassword(password, await getDummy());
    throw new AuthError('Неверный логин или пароль');
  }

  const now = Date.now();
  if (user.locked_until > now) {
    await repo.audit(db, user.id, 'login_locked');
    throw new AuthError('Слишком много попыток. Аккаунт временно заблокирован.', user.locked_until);
  }

  const ok = await verifyPassword(password, {
    hash: user.password_hash,
    salt: user.password_salt,
    iterations: user.password_iter,
  });

  if (!ok) {
    const failed = user.failed_attempts + 1;
    const lock = lockDuration(failed);
    await repo.setLoginFailures(db, user.id, failed, lock ? now + lock : 0);
    await repo.audit(db, user.id, 'login_fail', `попытка ${failed}`);
    if (lock) throw new AuthError(`Слишком много попыток. Блокировка на ${Math.round(lock / 1000)} с.`, now + lock);
    throw new AuthError(`Неверный логин или пароль (осталось попыток: ${MAX_ATTEMPTS - failed})`);
  }

  await repo.setLoginFailures(db, user.id, 0, 0);
  await repo.audit(db, user.id, 'login_ok');
  return startSession(user.id, user.username);
}

export async function changePassword(db: SQLiteDatabase, userId: number, current: string, next: string) {
  const user = await repo.findUserById(db, userId);
  if (!user) throw new AuthError('Пользователь не найден');
  const ok = await verifyPassword(current, { hash: user.password_hash, salt: user.password_salt, iterations: user.password_iter });
  if (!ok) throw new AuthError('Текущий пароль неверный');
  await repo.setPassword(db, userId, await hashPassword(next, secureRandomBytes));
  await repo.audit(db, userId, 'password_changed');
}

/** Удаление аккаунта требует пароль — защита от случайного/чужого удаления. */
export async function deleteAccount(db: SQLiteDatabase, userId: number, password: string) {
  const user = await repo.findUserById(db, userId);
  if (!user) throw new AuthError('Пользователь не найден');
  const ok = await verifyPassword(password, { hash: user.password_hash, salt: user.password_salt, iterations: user.password_iter });
  if (!ok) throw new AuthError('Неверный пароль');
  await repo.deleteUser(db, userId); // ON DELETE CASCADE удалит героев, кампании, сообщения
  await endSession();
}

// ---------- Сессия ----------

async function startSession(userId: number, username: string): Promise<Session> {
  const s: Session = { userId, username, expiresAt: Date.now() + SESSION_TTL_MS };
  await secureSet(SESSION_KEY, JSON.stringify(s));
  return s;
}

export async function touchSession(s: Session): Promise<Session> {
  return startSession(s.userId, s.username);
}

/** Восстановить сессию после перезапуска; просроченная удаляется. */
export async function loadSession(db: SQLiteDatabase): Promise<Session | null> {
  const raw = await secureGet(SESSION_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Session;
    const user = typeof s.userId === 'number' ? await repo.findUserById(db, s.userId) : null;
    if (!user || s.expiresAt < Date.now()) {
      await endSession();
      return null;
    }
    return touchSession({ ...s, username: user.username });
  } catch {
    await endSession();
    return null;
  }
}

export const endSession = () => secureDelete(SESSION_KEY);

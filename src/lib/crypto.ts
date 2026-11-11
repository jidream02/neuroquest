/**
 * Криптография приложения. Чистый TypeScript (библиотеки @noble), поэтому одинаково
 * работает на Android, iOS, в браузере и в unit-тестах.
 *
 *  - Пароли: PBKDF2-HMAC-SHA256 с солью → в базе хранится только хэш, не пароль.
 *  - Бэкапы: AES-256-GCM, ключ получается из пароля бэкапа через PBKDF2.
 *    GCM даёт и шифрование, и проверку целостности (подделанный файл не расшифруется).
 *
 * Случайные байты передаются снаружи (randomBytes), чтобы модуль не зависел от платформы.
 */
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { bytesToUtf8 } from '@noble/ciphers/utils.js';
import { gcm } from '@noble/ciphers/aes.js';

export type RandomBytes = (n: number) => Uint8Array;

export const PASSWORD_ITERATIONS = 60_000;
export const BACKUP_ITERATIONS = 60_000;
const KEY_LEN = 32;

// ---------- base64 (без зависимостей от atob/Buffer) ----------
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : B64[c & 63];
  }
  return out;
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const n = [0, 1, 2, 3].map((k) => (i + k < clean.length ? B64.indexOf(clean[i + k]) : -1));
    out.push((n[0] << 2) | (n[1] >> 4));
    if (n[2] >= 0) out.push(((n[1] & 15) << 4) | (n[2] >> 2));
    if (n[3] >= 0) out.push(((n[2] & 3) << 6) | n[3]);
  }
  return new Uint8Array(out);
}

export const sha256Hex = (text: string) => bytesToHex(sha256(utf8ToBytes(text)));

/** Сравнение за постоянное время — не даёт подбирать хэш по времени ответа. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- Пароли ----------

export interface PasswordHash {
  hash: string; // hex
  salt: string; // hex
  iterations: number;
}

export async function hashPassword(password: string, randomBytes: RandomBytes, iterations = PASSWORD_ITERATIONS): Promise<PasswordHash> {
  const salt = randomBytes(16);
  const key = await pbkdf2Async(sha256, utf8ToBytes(password), salt, { c: iterations, dkLen: KEY_LEN });
  return { hash: bytesToHex(key), salt: bytesToHex(salt), iterations };
}

export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  const salt = hexToBytes(stored.salt);
  const key = await pbkdf2Async(sha256, utf8ToBytes(password), salt, { c: stored.iterations, dkLen: KEY_LEN });
  return constantTimeEqual(bytesToHex(key), stored.hash);
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// ---------- Шифрование бэкапов ----------

export interface Sealed {
  salt: string; // base64
  iv: string; // base64
  iterations: number;
  data: string; // base64(ciphertext + tag)
}

export async function encryptText(
  plaintext: string,
  password: string,
  aad: string,
  randomBytes: RandomBytes,
  iterations = BACKUP_ITERATIONS,
): Promise<Sealed> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await pbkdf2Async(sha256, utf8ToBytes(password), salt, { c: iterations, dkLen: KEY_LEN });
  const data = gcm(key, iv, utf8ToBytes(aad)).encrypt(utf8ToBytes(plaintext));
  return { salt: toBase64(salt), iv: toBase64(iv), iterations, data: toBase64(data) };
}

export class DecryptError extends Error {}

/** Бросает DecryptError при неверном пароле или изменённом файле (проверка тега GCM). */
export async function decryptText(sealed: Sealed, password: string, aad: string): Promise<string> {
  const key = await pbkdf2Async(sha256, utf8ToBytes(password), fromBase64(sealed.salt), {
    c: sealed.iterations,
    dkLen: KEY_LEN,
  });
  let plain: Uint8Array;
  try {
    plain = gcm(key, fromBase64(sealed.iv), utf8ToBytes(aad)).decrypt(fromBase64(sealed.data));
  } catch {
    throw new DecryptError('Неверный пароль или файл повреждён');
  }
  return bytesToUtf8(plain);
}

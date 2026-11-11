/**
 * Формат файла резервной копии (.nqbak):
 *
 * {
 *   "format": "neuroquest-backup", "version": 1, "createdAt": "...",   ← открытый заголовок
 *   "kdf": "PBKDF2-SHA256", "cipher": "AES-256-GCM",
 *   "salt", "iv", "iterations", "data"                                ← зашифрованное содержимое
 * }
 *
 * Внутри data (после расшифровки): { payload, checksum: sha256(payload) }.
 * Заголовок участвует в шифровании как AAD — его нельзя подменить незаметно.
 *
 * Проверки при восстановлении:
 *   1. файл — корректный JSON нужного формата и версии;
 *   2. пароль верный и файл не изменён (тег AES-GCM);
 *   3. контрольная сумма SHA-256 совпадает;
 *   4. данные проходят схему (типы, диапазоны) и ссылки между таблицами целы.
 */
import { z } from 'zod';
import { decryptText, encryptText, sha256Hex, type RandomBytes } from './crypto';

export const BACKUP_FORMAT = 'neuroquest-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_EXT = '.nqbak';

const ts = z.number().int().nonnegative();

export const BackupPayloadSchema = z.object({
  username: z.string().max(24),
  exportedAt: ts,
  characters: z.array(
    z.object({
      id: z.number().int(),
      name: z.string().min(1).max(40),
      race_id: z.string().max(20),
      class_id: z.string().max(20),
      level: z.number().int().min(1).max(20),
      xp: z.number().int().min(0),
      hp: z.number().int().min(0),
      max_hp: z.number().int().min(1),
      str: z.number().int().min(1).max(30),
      dex: z.number().int().min(1).max(30),
      con: z.number().int().min(1).max(30),
      int: z.number().int().min(1).max(30),
      wis: z.number().int().min(1).max(30),
      cha: z.number().int().min(1).max(30),
      backstory: z.string().max(600),
      created_at: ts,
      updated_at: ts,
    }),
  ).max(500),
  items: z.array(
    z.object({ id: z.number().int(), character_id: z.number().int(), name: z.string().min(1).max(40), qty: z.number().int().min(1).max(999), created_at: ts }),
  ).max(20000),
  campaigns: z.array(
    z.object({
      id: z.number().int(),
      character_id: z.number().int(),
      title: z.string().min(1).max(60),
      setting: z.string().max(400),
      summary: z.string().max(1500),
      status: z.enum(['active', 'dead', 'finished']),
      turns: z.number().int().min(0),
      created_at: ts,
      updated_at: ts,
    }),
  ).max(1000),
  messages: z.array(
    z.object({
      id: z.number().int(),
      campaign_id: z.number().int(),
      role: z.enum(['dm', 'player', 'roll', 'system']),
      content: z.string().max(5000),
      meta: z.string().max(5000).nullable(),
      created_at: ts,
    }),
  ).max(200000),
});
export type BackupPayload = z.infer<typeof BackupPayloadSchema>;

const BackupFileSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.number().int(),
  createdAt: z.string().max(40),
  kdf: z.literal('PBKDF2-SHA256'),
  cipher: z.literal('AES-256-GCM'),
  salt: z.string().max(64),
  iv: z.string().max(64),
  iterations: z.number().int().min(10_000).max(2_000_000),
  data: z.string(),
});

export class BackupError extends Error {}

const aadFor = (h: { format: string; version: number; createdAt: string }) => `${h.format}|${h.version}|${h.createdAt}`;

export function payloadCounts(p: BackupPayload) {
  return { characters: p.characters.length, items: p.items.length, campaigns: p.campaigns.length, messages: p.messages.length };
}

export async function sealBackup(payload: BackupPayload, password: string, randomBytes: RandomBytes): Promise<string> {
  const body = JSON.stringify(payload);
  const inner = JSON.stringify({ payload: body, checksum: sha256Hex(body) });
  const header = { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date(payload.exportedAt).toISOString() };
  const sealed = await encryptText(inner, password, aadFor(header), randomBytes);
  return JSON.stringify({ ...header, kdf: 'PBKDF2-SHA256', cipher: 'AES-256-GCM', ...sealed });
}

export async function openBackup(fileText: string, password: string): Promise<BackupPayload> {
  let raw: unknown;
  try {
    raw = JSON.parse(fileText);
  } catch {
    throw new BackupError('Это не файл резервной копии NeuroQuest');
  }
  const file = BackupFileSchema.safeParse(raw);
  if (!file.success) throw new BackupError('Это не файл резервной копии NeuroQuest или он повреждён');
  if (file.data.version > BACKUP_VERSION) throw new BackupError('Бэкап создан более новой версией приложения');

  // Неверный пароль или изменённый файл → DecryptError (тег GCM не совпал).
  const inner = await decryptText(file.data, password, aadFor(file.data));

  let parsedInner: { payload: string; checksum: string };
  try {
    parsedInner = JSON.parse(inner);
  } catch {
    throw new BackupError('Содержимое бэкапа повреждено');
  }
  if (sha256Hex(parsedInner.payload) !== parsedInner.checksum) {
    throw new BackupError('Контрольная сумма не совпала — бэкап повреждён');
  }
  const payload = BackupPayloadSchema.safeParse(JSON.parse(parsedInner.payload));
  if (!payload.success) throw new BackupError('Данные бэкапа не прошли проверку формата');
  checkReferences(payload.data);
  return payload.data;
}

/** Все ссылки должны вести на записи внутри этого же бэкапа. */
function checkReferences(p: BackupPayload) {
  const chars = new Set(p.characters.map((c) => c.id));
  const camps = new Set(p.campaigns.map((c) => c.id));
  if (chars.size !== p.characters.length || camps.size !== p.campaigns.length) {
    throw new BackupError('В бэкапе повторяются идентификаторы');
  }
  if (p.items.some((i) => !chars.has(i.character_id))) throw new BackupError('Предмет ссылается на несуществующего героя');
  if (p.campaigns.some((c) => !chars.has(c.character_id))) throw new BackupError('Кампания ссылается на несуществующего героя');
  if (p.messages.some((m) => !camps.has(m.campaign_id))) throw new BackupError('Сообщение ссылается на несуществующую кампанию');
}

export function backupFileName(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `neuroquest-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}${BACKUP_EXT}`;
}

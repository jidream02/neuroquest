/**
 * Резервное копирование и восстановление данных пользователя.
 *
 * Backup:  данные пользователя → JSON → SHA-256 → AES-256-GCM (пароль бэкапа) → файл .nqbak
 *          Android/iOS: файл сохраняется в папку приложения (Documents/backups) и его можно «Поделиться».
 *          Web: файл скачивается браузером.
 * Restore: файл → проверка формата → расшифровка (проверка пароля и целостности) → проверка
 *          контрольной суммы и схемы → замена данных ОДНОЙ транзакцией → сверка количества записей.
 *          Если на любом шаге ошибка — текущие данные не меняются.
 */
import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';
import * as repo from '../db/repo';
import {
  BackupError, BACKUP_EXT, backupFileName, openBackup, payloadCounts, sealBackup, type BackupPayload,
} from '../lib/backupFormat';
import { DecryptError } from '../lib/crypto';
import { secureRandomBytes } from './random';

const isWeb = Platform.OS === 'web';

// ---------- Экспорт ----------

export async function exportPayload(db: SQLiteDatabase, userId: number, username: string): Promise<BackupPayload> {
  const characters = await db.getAllAsync<BackupPayload['characters'][number]>(
    `SELECT id, name, race_id, class_id, level, xp, hp, max_hp, str, dex, con, int, wis, cha, backstory, created_at, updated_at
     FROM characters WHERE user_id = ? ORDER BY id`,
    userId,
  );
  const items = await db.getAllAsync<BackupPayload['items'][number]>(
    `SELECT i.id, i.character_id, i.name, i.qty, i.created_at FROM items i
     JOIN characters c ON c.id = i.character_id WHERE c.user_id = ? ORDER BY i.id`,
    userId,
  );
  const campaigns = await db.getAllAsync<BackupPayload['campaigns'][number]>(
    `SELECT id, character_id, title, setting, summary, status, turns, created_at, updated_at
     FROM campaigns WHERE user_id = ? ORDER BY id`,
    userId,
  );
  const messages = await db.getAllAsync<BackupPayload['messages'][number]>(
    `SELECT m.id, m.campaign_id, m.role, m.content, m.meta, m.created_at FROM messages m
     JOIN campaigns c ON c.id = m.campaign_id WHERE c.user_id = ? ORDER BY m.id`,
    userId,
  );
  return { username, exportedAt: Date.now(), characters, items, campaigns, messages };
}

export interface BackupResult {
  fileName: string;
  uri?: string;
  counts: ReturnType<typeof payloadCounts>;
  bytes: number;
}

export async function createBackup(db: SQLiteDatabase, userId: number, username: string, password: string): Promise<BackupResult> {
  const payload = await exportPayload(db, userId, username);
  const text = await sealBackup(payload, password, secureRandomBytes);

  // Проверка корректности: сразу пробуем открыть только что созданный бэкап.
  const check = await openBackup(text, password);
  if (JSON.stringify(payloadCounts(check)) !== JSON.stringify(payloadCounts(payload))) {
    throw new BackupError('Проверка бэкапа не прошла — файл не сохранён');
  }

  const fileName = backupFileName(new Date(payload.exportedAt));
  let uri: string | undefined;
  if (isWeb) {
    downloadOnWeb(fileName, text);
  } else {
    const dir = backupsDir();
    const file = new File(dir, fileName);
    file.create({ overwrite: true });
    await file.write(text);
    uri = file.uri;
  }
  await repo.audit(db, userId, 'backup_created', fileName);
  return { fileName, uri, counts: payloadCounts(payload), bytes: text.length };
}

function downloadOnWeb(fileName: string, text: string) {
  const blob = new Blob([text], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Файлы бэкапов на устройстве (Android/iOS) ----------

function backupsDir(): Directory {
  const dir = new Directory(Paths.document, 'backups');
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export interface LocalBackup {
  name: string;
  uri: string;
  size: number;
  modified: number;
}

export function listLocalBackups(): LocalBackup[] {
  if (isWeb) return [];
  return backupsDir()
    .list()
    .filter((f): f is File => f instanceof File && f.name.endsWith(BACKUP_EXT))
    .map((f) => {
      const info = f.info();
      return { name: f.name, uri: f.uri, size: info.size ?? 0, modified: info.modificationTime ?? 0 };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

export function deleteLocalBackup(uri: string) {
  const f = new File(uri);
  if (f.exists) f.delete();
}

export async function shareBackup(uri: string) {
  if (!(await Sharing.isAvailableAsync())) throw new BackupError('Функция «Поделиться» недоступна на этом устройстве');
  await Sharing.shareAsync(uri, { mimeType: 'application/octet-stream', dialogTitle: 'Резервная копия NeuroQuest' });
}

export const readLocalBackup = (uri: string) => new File(uri).text();

/** Выбрать файл бэкапа с устройства/компьютера. null — пользователь отменил выбор. */
export async function pickBackupFile(): Promise<{ name: string; text: string } | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];
  if ((asset.size ?? 0) > 20 * 1024 * 1024) throw new BackupError('Файл слишком большой для бэкапа');
  const text = isWeb && asset.file ? await asset.file.text() : await new File(asset.uri).text();
  return { name: asset.name, text };
}

// ---------- Восстановление ----------

export interface RestoreResult {
  counts: ReturnType<typeof payloadCounts>;
  from: string;
}

export async function restoreBackup(
  db: SQLiteDatabase,
  userId: number,
  fileText: string,
  password: string,
): Promise<RestoreResult> {
  let payload: BackupPayload;
  try {
    payload = await openBackup(fileText, password);
  } catch (e) {
    await repo.audit(db, userId, 'restore_failed', e instanceof DecryptError ? 'неверный пароль/повреждён' : 'неверный формат');
    throw e;
  }

  await db.withTransactionAsync(async () => {
    // Удаляем текущие данные пользователя (каскадом уйдут предметы и сообщения)…
    await db.runAsync('DELETE FROM campaigns WHERE user_id = ?', userId);
    await db.runAsync('DELETE FROM characters WHERE user_id = ?', userId);

    // …и вставляем данные из бэкапа. ID создаются заново, ссылки пересчитываются.
    const charIds = new Map<number, number>();
    for (const c of payload.characters) {
      const r = await db.runAsync(
        `INSERT INTO characters (user_id, name, race_id, class_id, level, xp, hp, max_hp,
           str, dex, con, int, wis, cha, backstory, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        userId, c.name, c.race_id, c.class_id, c.level, c.xp, Math.min(c.hp, c.max_hp), c.max_hp,
        c.str, c.dex, c.con, c.int, c.wis, c.cha, c.backstory, c.created_at, c.updated_at,
      );
      charIds.set(c.id, r.lastInsertRowId);
    }
    for (const i of payload.items) {
      await db.runAsync(
        'INSERT INTO items (character_id, name, qty, created_at) VALUES (?, ?, ?, ?)',
        charIds.get(i.character_id)!, i.name, i.qty, i.created_at,
      );
    }
    const campIds = new Map<number, number>();
    for (const c of payload.campaigns) {
      const r = await db.runAsync(
        `INSERT INTO campaigns (user_id, character_id, title, setting, summary, status, turns, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        userId, charIds.get(c.character_id)!, c.title, c.setting, c.summary, c.status, c.turns, c.created_at, c.updated_at,
      );
      campIds.set(c.id, r.lastInsertRowId);
    }
    for (const m of payload.messages) {
      await db.runAsync(
        'INSERT INTO messages (campaign_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?)',
        campIds.get(m.campaign_id)!, m.role, m.content, m.meta, m.created_at,
      );
    }

    // Сверка: в базе должно оказаться ровно столько записей, сколько в бэкапе.
    // Если нет — исключение откатит всю транзакцию.
    const after = await repo.countUserData(db, userId);
    const expected = payloadCounts(payload);
    if (JSON.stringify(after) !== JSON.stringify(expected)) {
      throw new BackupError('Проверка после восстановления не прошла — изменения отменены');
    }
  });

  await repo.audit(db, userId, 'backup_restored', `героев ${payload.characters.length}, кампаний ${payload.campaigns.length}`);
  return { counts: payloadCounts(payload), from: new Date(payload.exportedAt).toLocaleString() };
}

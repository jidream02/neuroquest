/**
 * Слой доступа к данным. Правила безопасности:
 *  1. Только параметризованные запросы (?), никакой склейки строк → нет SQL-инъекций.
 *  2. КАЖДЫЙ запрос ограничен user_id текущего пользователя → один пользователь
 *     не может прочитать или изменить данные другого (контроль доступа).
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import type { Ability } from '../../shared/dmProtocol';
import { effectiveAbilities, maxHpFor, type Abilities, type HeroState } from '../lib/rules';
import type { HeroForm } from '../lib/validation';

const now = () => Date.now();

export class NotFoundError extends Error {
  constructor(what = 'Запись') {
    super(`${what} не найдена или нет доступа`);
  }
}

// ======================= Пользователи =======================

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  password_salt: string;
  password_iter: number;
  failed_attempts: number;
  locked_until: number;
  created_at: number;
}

export const findUserByName = (db: SQLiteDatabase, username: string) =>
  db.getFirstAsync<UserRow>('SELECT * FROM users WHERE username = ?', username.trim());

export const findUserById = (db: SQLiteDatabase, id: number) =>
  db.getFirstAsync<UserRow>('SELECT * FROM users WHERE id = ?', id);

export async function createUser(
  db: SQLiteDatabase,
  username: string,
  pw: { hash: string; salt: string; iterations: number },
): Promise<number> {
  const r = await db.runAsync(
    'INSERT INTO users (username, password_hash, password_salt, password_iter, created_at) VALUES (?, ?, ?, ?, ?)',
    username.trim(),
    pw.hash,
    pw.salt,
    pw.iterations,
    now(),
  );
  return r.lastInsertRowId;
}

export const setLoginFailures = (db: SQLiteDatabase, id: number, failed: number, lockedUntil: number) =>
  db.runAsync('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?', failed, lockedUntil, id);

export const setPassword = (db: SQLiteDatabase, id: number, pw: { hash: string; salt: string; iterations: number }) =>
  db.runAsync(
    'UPDATE users SET password_hash = ?, password_salt = ?, password_iter = ? WHERE id = ?',
    pw.hash,
    pw.salt,
    pw.iterations,
    id,
  );

export const deleteUser = (db: SQLiteDatabase, id: number) => db.runAsync('DELETE FROM users WHERE id = ?', id);

// ======================= Аудит =======================

export type AuditEvent =
  | 'register'
  | 'login_ok'
  | 'login_fail'
  | 'login_locked'
  | 'logout'
  | 'auto_lock'
  | 'password_changed'
  | 'backup_created'
  | 'backup_restored'
  | 'restore_failed';

export const audit = (db: SQLiteDatabase, userId: number | null, event: AuditEvent, details = '') =>
  db.runAsync('INSERT INTO audit_log (user_id, event, details, created_at) VALUES (?, ?, ?, ?)', userId, event, details, now());

export interface AuditRow {
  id: number;
  event: AuditEvent;
  details: string;
  created_at: number;
}

export const listAudit = (db: SQLiteDatabase, userId: number, limit = 30) =>
  db.getAllAsync<AuditRow>(
    'SELECT id, event, details, created_at FROM audit_log WHERE user_id = ? ORDER BY id DESC LIMIT ?',
    userId,
    limit,
  );

// ======================= Герои =======================

export interface CharacterRow extends Record<Ability, number> {
  id: number;
  user_id: number;
  name: string;
  race_id: string;
  class_id: string;
  level: number;
  xp: number;
  hp: number;
  max_hp: number;
  backstory: string;
  created_at: number;
  updated_at: number;
}

export const baseAbilities = (c: CharacterRow): Abilities => ({
  str: c.str, dex: c.dex, con: c.con, int: c.int, wis: c.wis, cha: c.cha,
});

export const listCharacters = (db: SQLiteDatabase, userId: number) =>
  db.getAllAsync<CharacterRow>('SELECT * FROM characters WHERE user_id = ? ORDER BY updated_at DESC', userId);

export const getCharacter = (db: SQLiteDatabase, userId: number, id: number) =>
  db.getFirstAsync<CharacterRow>('SELECT * FROM characters WHERE id = ? AND user_id = ?', id, userId);

export async function createCharacter(
  db: SQLiteDatabase,
  userId: number,
  form: HeroForm,
  startItems: { name: string; qty: number }[],
): Promise<number> {
  const eff = effectiveAbilities(form.abilities, form.raceId);
  const maxHp = maxHpFor(form.classId, 1, eff.con);
  const a = form.abilities;
  let id = 0;
  await db.withTransactionAsync(async () => {
    const r = await db.runAsync(
      `INSERT INTO characters (user_id, name, race_id, class_id, level, xp, hp, max_hp,
         str, dex, con, int, wis, cha, backstory, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      userId, form.name, form.raceId, form.classId, maxHp, maxHp,
      a.str, a.dex, a.con, a.int, a.wis, a.cha, form.backstory, now(), now(),
    );
    id = r.lastInsertRowId;
    for (const it of startItems) {
      await db.runAsync('INSERT INTO items (character_id, name, qty, created_at) VALUES (?, ?, ?, ?)', id, it.name, it.qty, now());
    }
  });
  return id;
}

export async function updateCharacter(db: SQLiteDatabase, userId: number, id: number, form: HeroForm): Promise<void> {
  const cur = await getCharacter(db, userId, id);
  if (!cur) throw new NotFoundError('Герой');
  const eff = effectiveAbilities(form.abilities, form.raceId);
  const maxHp = maxHpFor(form.classId, cur.level, eff.con);
  // Текущее HP сдвигается вместе с максимумом, но не выходит за границы.
  const hp = Math.max(0, Math.min(maxHp, cur.hp + (maxHp - cur.max_hp)));
  const a = form.abilities;
  await db.runAsync(
    `UPDATE characters SET name = ?, race_id = ?, class_id = ?, backstory = ?,
       str = ?, dex = ?, con = ?, int = ?, wis = ?, cha = ?, max_hp = ?, hp = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
    form.name, form.raceId, form.classId, form.backstory,
    a.str, a.dex, a.con, a.int, a.wis, a.cha, maxHp, hp, now(), id, userId,
  );
}

export async function deleteCharacter(db: SQLiteDatabase, userId: number, id: number): Promise<void> {
  const r = await db.runAsync('DELETE FROM characters WHERE id = ? AND user_id = ?', id, userId);
  if (r.changes === 0) throw new NotFoundError('Герой');
}

/** Отдых: восстановить HP полностью. */
export const restCharacter = (db: SQLiteDatabase, userId: number, id: number) =>
  db.runAsync('UPDATE characters SET hp = max_hp, updated_at = ? WHERE id = ? AND user_id = ?', now(), id, userId);

/** Сохранить состояние героя после хода (HP, опыт, уровень, инвентарь) одной транзакцией. */
export async function saveHeroState(db: SQLiteDatabase, userId: number, id: number, s: HeroState): Promise<void> {
  const cur = await getCharacter(db, userId, id);
  if (!cur) throw new NotFoundError('Герой');
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'UPDATE characters SET hp = ?, max_hp = ?, xp = ?, level = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      s.hp, s.maxHp, s.xp, s.level, now(), id, userId,
    );
    await db.runAsync('DELETE FROM items WHERE character_id = ?', id);
    for (const it of s.inventory) {
      await db.runAsync('INSERT INTO items (character_id, name, qty, created_at) VALUES (?, ?, ?, ?)', id, it.name, it.qty, now());
    }
  });
}

// ======================= Инвентарь =======================

export interface ItemRow {
  id: number;
  character_id: number;
  name: string;
  qty: number;
  created_at: number;
}

// Владение предметом проверяется через героя: JOIN characters ... AND user_id = ?
export const listItems = (db: SQLiteDatabase, userId: number, characterId: number) =>
  db.getAllAsync<ItemRow>(
    `SELECT i.* FROM items i JOIN characters c ON c.id = i.character_id
     WHERE i.character_id = ? AND c.user_id = ? ORDER BY i.id`,
    characterId,
    userId,
  );

export async function addItem(db: SQLiteDatabase, userId: number, characterId: number, name: string, qty: number) {
  if (!(await getCharacter(db, userId, characterId))) throw new NotFoundError('Герой');
  await db.runAsync('INSERT INTO items (character_id, name, qty, created_at) VALUES (?, ?, ?, ?)', characterId, name, qty, now());
}

export async function updateItem(db: SQLiteDatabase, userId: number, itemId: number, name: string, qty: number) {
  const r = await db.runAsync(
    `UPDATE items SET name = ?, qty = ?
     WHERE id = ? AND character_id IN (SELECT id FROM characters WHERE user_id = ?)`,
    name, qty, itemId, userId,
  );
  if (r.changes === 0) throw new NotFoundError('Предмет');
}

export async function deleteItem(db: SQLiteDatabase, userId: number, itemId: number) {
  const r = await db.runAsync(
    'DELETE FROM items WHERE id = ? AND character_id IN (SELECT id FROM characters WHERE user_id = ?)',
    itemId,
    userId,
  );
  if (r.changes === 0) throw new NotFoundError('Предмет');
}

// ======================= Кампании =======================

export type CampaignStatus = 'active' | 'dead' | 'finished';

export interface CampaignRow {
  id: number;
  user_id: number;
  character_id: number;
  title: string;
  setting: string;
  summary: string;
  status: CampaignStatus;
  turns: number;
  created_at: number;
  updated_at: number;
}

export interface CampaignListRow extends CampaignRow {
  hero_name: string;
  hero_class: string;
  hero_level: number;
}

export const listCampaigns = (db: SQLiteDatabase, userId: number) =>
  db.getAllAsync<CampaignListRow>(
    `SELECT cp.*, ch.name AS hero_name, ch.class_id AS hero_class, ch.level AS hero_level
     FROM campaigns cp JOIN characters ch ON ch.id = cp.character_id
     WHERE cp.user_id = ? ORDER BY cp.updated_at DESC`,
    userId,
  );

export const getCampaign = (db: SQLiteDatabase, userId: number, id: number) =>
  db.getFirstAsync<CampaignRow>('SELECT * FROM campaigns WHERE id = ? AND user_id = ?', id, userId);

export async function createCampaign(
  db: SQLiteDatabase,
  userId: number,
  data: { title: string; setting: string; characterId: number },
): Promise<number> {
  if (!(await getCharacter(db, userId, data.characterId))) throw new NotFoundError('Герой');
  const r = await db.runAsync(
    'INSERT INTO campaigns (user_id, character_id, title, setting, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    userId, data.characterId, data.title, data.setting, now(), now(),
  );
  return r.lastInsertRowId;
}

export async function renameCampaign(db: SQLiteDatabase, userId: number, id: number, title: string, setting: string) {
  const r = await db.runAsync(
    'UPDATE campaigns SET title = ?, setting = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    title, setting, now(), id, userId,
  );
  if (r.changes === 0) throw new NotFoundError('Кампания');
}

export async function deleteCampaign(db: SQLiteDatabase, userId: number, id: number) {
  const r = await db.runAsync('DELETE FROM campaigns WHERE id = ? AND user_id = ?', id, userId);
  if (r.changes === 0) throw new NotFoundError('Кампания');
}

export const updateCampaignProgress = (
  db: SQLiteDatabase,
  userId: number,
  id: number,
  p: { summary: string; status: CampaignStatus },
) =>
  db.runAsync(
    'UPDATE campaigns SET summary = ?, status = ?, turns = turns + 1, updated_at = ? WHERE id = ? AND user_id = ?',
    p.summary, p.status, now(), id, userId,
  );

// ======================= Сообщения =======================

export type MessageRole = 'dm' | 'player' | 'roll' | 'system';

export interface MessageRow {
  id: number;
  campaign_id: number;
  role: MessageRole;
  content: string;
  meta: string | null;
  created_at: number;
}

export const listMessages = (db: SQLiteDatabase, userId: number, campaignId: number) =>
  db.getAllAsync<MessageRow>(
    `SELECT m.* FROM messages m JOIN campaigns c ON c.id = m.campaign_id
     WHERE m.campaign_id = ? AND c.user_id = ? ORDER BY m.id`,
    campaignId,
    userId,
  );

export async function addMessage(
  db: SQLiteDatabase,
  userId: number,
  campaignId: number,
  role: MessageRole,
  content: string,
  meta?: unknown,
): Promise<MessageRow> {
  if (!(await getCampaign(db, userId, campaignId))) throw new NotFoundError('Кампания');
  const createdAt = now();
  const metaJson = meta === undefined ? null : JSON.stringify(meta);
  const r = await db.runAsync(
    'INSERT INTO messages (campaign_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?)',
    campaignId, role, content, metaJson, createdAt,
  );
  return { id: r.lastInsertRowId, campaign_id: campaignId, role, content, meta: metaJson, created_at: createdAt };
}

// ======================= Статистика (для экрана профиля и проверки бэкапа) =======================

export async function countUserData(db: SQLiteDatabase, userId: number) {
  const q = (sql: string) => db.getFirstAsync<{ n: number }>(sql, userId).then((r) => r?.n ?? 0);
  return {
    characters: await q('SELECT COUNT(*) AS n FROM characters WHERE user_id = ?'),
    items: await q('SELECT COUNT(*) AS n FROM items WHERE character_id IN (SELECT id FROM characters WHERE user_id = ?)'),
    campaigns: await q('SELECT COUNT(*) AS n FROM campaigns WHERE user_id = ?'),
    messages: await q('SELECT COUNT(*) AS n FROM messages WHERE campaign_id IN (SELECT id FROM campaigns WHERE user_id = ?)'),
  };
}
export type DataCounts = Awaited<ReturnType<typeof countUserData>>;

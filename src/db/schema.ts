import type { SQLiteDatabase } from 'expo-sqlite';

export const DB_NAME = 'neuroquest.db';

/**
 * Миграции по номеру версии (PRAGMA user_version). Каждая выполняется один раз,
 * поэтому при обновлении приложения данные пользователя не теряются.
 */
const MIGRATIONS: string[] = [
  // v1 — начальная схема
  `
  CREATE TABLE users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash   TEXT    NOT NULL,
    password_salt   TEXT    NOT NULL,
    password_iter   INTEGER NOT NULL,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until    INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL
  );

  CREATE TABLE characters (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    race_id    TEXT    NOT NULL,
    class_id   TEXT    NOT NULL,
    level      INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 20),
    xp         INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
    hp         INTEGER NOT NULL CHECK (hp >= 0),
    max_hp     INTEGER NOT NULL CHECK (max_hp >= 1),
    str INTEGER NOT NULL, dex INTEGER NOT NULL, con INTEGER NOT NULL,
    int INTEGER NOT NULL, wis INTEGER NOT NULL, cha INTEGER NOT NULL,
    backstory  TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_characters_user ON characters(user_id);

  CREATE TABLE items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    name         TEXT    NOT NULL,
    qty          INTEGER NOT NULL DEFAULT 1 CHECK (qty BETWEEN 1 AND 999),
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX idx_items_character ON items(character_id);

  CREATE TABLE campaigns (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    title        TEXT    NOT NULL,
    setting      TEXT    NOT NULL DEFAULT '',
    summary      TEXT    NOT NULL DEFAULT '',
    status       TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dead', 'finished')),
    turns        INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );
  CREATE INDEX idx_campaigns_user ON campaigns(user_id);

  CREATE TABLE messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    role        TEXT    NOT NULL CHECK (role IN ('dm', 'player', 'roll', 'system')),
    content     TEXT    NOT NULL,
    meta        TEXT,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX idx_messages_campaign ON messages(campaign_id);

  CREATE TABLE audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    event      TEXT    NOT NULL,
    details    TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_audit_user ON audit_log(user_id);
  `,
];

export async function migrate(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version];
    await db.withTransactionAsync(async () => {
      await db.execAsync(sql);
    });
    version += 1;
    await db.execAsync(`PRAGMA user_version = ${version}`);
  }
}

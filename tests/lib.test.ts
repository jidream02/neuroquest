import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  constantTimeEqual, decryptText, DecryptError, encryptText, fromBase64, hashPassword, toBase64, verifyPassword,
} from '../src/lib/crypto';
import { abilityCheck, applyEffects, effectiveAbilities, levelForXp, maxHpFor, modifier } from '../src/lib/rules';
import { heroSchema, registerSchema, sanitize, itemSchema } from '../src/lib/validation';
import { BackupError, openBackup, sealBackup, type BackupPayload } from '../src/lib/backupFormat';
import { DmResponseSchema, TurnRequestSchema } from '../shared/dmProtocol';

const rnd = (n: number) => new Uint8Array(randomBytes(n));
const FAST = 1000; // мало итераций — чтобы тесты шли быстро

describe('crypto', () => {
  it('base64 туда-обратно', () => {
    for (const len of [0, 1, 2, 3, 4, 31, 100]) {
      const b = rnd(len);
      expect(fromBase64(toBase64(b))).toEqual(b);
    }
    expect(toBase64(new TextEncoder().encode('Ma'))).toBe('TWE=');
  });

  it('хэш пароля: верный проходит, неверный нет, пароль не хранится', async () => {
    const h = await hashPassword('Secret123', rnd, FAST);
    expect(h.hash).not.toContain('Secret123');
    expect(h.hash).toHaveLength(64);
    expect(await verifyPassword('Secret123', h)).toBe(true);
    expect(await verifyPassword('secret123', h)).toBe(false);
  });

  it('одинаковые пароли дают разные хэши (соль)', async () => {
    const a = await hashPassword('Secret123', rnd, FAST);
    const b = await hashPassword('Secret123', rnd, FAST);
    expect(a.hash).not.toBe(b.hash);
  });

  it('constantTimeEqual', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'ab')).toBe(false);
  });

  it('AES-GCM: расшифровка, неверный пароль, подмена данных и заголовка', async () => {
    const s = await encryptText('привет, мир', 'pass1234', 'hdr', rnd, FAST);
    expect(await decryptText(s, 'pass1234', 'hdr')).toBe('привет, мир');
    await expect(decryptText(s, 'wrong', 'hdr')).rejects.toBeInstanceOf(DecryptError);
    await expect(decryptText(s, 'pass1234', 'other-hdr')).rejects.toBeInstanceOf(DecryptError);
    const bytes = fromBase64(s.data);
    bytes[0] ^= 1;
    await expect(decryptText({ ...s, data: toBase64(bytes) }, 'pass1234', 'hdr')).rejects.toBeInstanceOf(DecryptError);
  });
});

describe('rules', () => {
  it('модификаторы', () => {
    expect(modifier(10)).toBe(0);
    expect(modifier(8)).toBe(-1);
    expect(modifier(18)).toBe(4);
    expect(modifier(3)).toBe(-4);
  });

  it('уровни и HP', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(299)).toBe(1);
    expect(levelForXp(300)).toBe(2);
    expect(maxHpFor('fighter', 1, 14)).toBe(12);
    expect(maxHpFor('fighter', 2, 14)).toBe(12 + 8);
    expect(maxHpFor('wizard', 1, 3)).toBe(2); // 6 - 4
  });

  it('расовый бонус', () => {
    const e = effectiveAbilities({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, 'elf');
    expect(e.dex).toBe(12);
    expect(e.int).toBe(11);
  });

  it('проверка: натуральные 20 и 1', () => {
    const ab = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
    expect(abilityCheck('str', 30, ab, 'wizard', 1, () => 0.99).success).toBe(true); // 20
    expect(abilityCheck('str', 2, ab, 'wizard', 1, () => 0).success).toBe(false); // 1
    const r = abilityCheck('str', 12, ab, 'fighter', 1, () => 0.5); // 11 + 2 (мастерство)
    expect(r.total).toBe(13);
    expect(r.success).toBe(true);
  });

  it('эффекты ИИ ограничиваются', () => {
    const state = { hp: 5, maxHp: 10, xp: 0, level: 1, inventory: [{ name: 'Факел', qty: 2 }] };
    const r = applyEffects(state, { hp: -30, xp: 0, itemsAdd: [], itemsRemove: ['Меч из воздуха', 'факел'] }, 'fighter', 10);
    expect(r.state.hp).toBe(0);
    expect(r.dead).toBe(true);
    expect(r.removed).toEqual(['Факел']);
    expect(r.state.inventory).toEqual([{ name: 'Факел', qty: 1 }]);

    const heal = applyEffects(state, { hp: 30, xp: 0, itemsAdd: [], itemsRemove: [] }, 'fighter', 10);
    expect(heal.state.hp).toBe(10);
  });

  it('повышение уровня', () => {
    const state = { hp: 10, maxHp: 10, xp: 290, level: 1, inventory: [] };
    const r = applyEffects(state, { hp: 0, xp: 20, itemsAdd: [{ name: 'Кольцо', qty: 1 }], itemsRemove: [] }, 'fighter', 10);
    expect(r.leveledUp).toBe(true);
    expect(r.state.level).toBe(2);
    expect(r.state.maxHp).toBe(maxHpFor('fighter', 2, 10));
    expect(r.added).toEqual(['Кольцо']);
  });
});

describe('validation', () => {
  it('sanitize убирает управляющие и невидимые символы', () => {
    expect(sanitize('  Арен​\u0007  ')).toBe('Арен');
  });

  it('регистрация', () => {
    expect(registerSchema.safeParse({ username: 'player1', password: 'abcdefg1', confirm: 'abcdefg1' }).success).toBe(true);
    expect(registerSchema.safeParse({ username: 'player1', password: 'short1', confirm: 'short1' }).success).toBe(false);
    expect(registerSchema.safeParse({ username: 'player1', password: 'abcdefgh', confirm: 'abcdefgh' }).success).toBe(false);
    expect(registerSchema.safeParse({ username: "x' OR 1=1", password: 'abcdefg1', confirm: 'abcdefg1' }).success).toBe(false);
    expect(registerSchema.safeParse({ username: 'player1', password: 'abcdefg1', confirm: 'abcdefg2' }).success).toBe(false);
  });

  it('герой', () => {
    const ok = {
      name: 'Арен', raceId: 'human', classId: 'fighter', backstory: '',
      abilities: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
    };
    expect(heroSchema.safeParse(ok).success).toBe(true);
    expect(heroSchema.safeParse({ ...ok, name: '<script>' }).success).toBe(false);
    expect(heroSchema.safeParse({ ...ok, name: 'Әлихан Ұлы' }).success).toBe(true);
    expect(heroSchema.safeParse({ ...ok, name: "D'Artagnan" }).success).toBe(true);
    expect(heroSchema.safeParse({ ...ok, raceId: 'dragon' }).success).toBe(false);
    expect(heroSchema.safeParse({ ...ok, abilities: { ...ok.abilities, str: 19 } }).success).toBe(false);
    const cheat = { str: 18, dex: 18, con: 18, int: 18, wis: 18, cha: 18 };
    expect(heroSchema.safeParse({ ...ok, abilities: cheat }).success).toBe(false);
  });

  it('предмет', () => {
    expect(itemSchema.safeParse({ name: 'Меч', qty: 1 }).success).toBe(true);
    expect(itemSchema.safeParse({ name: '   ', qty: 1 }).success).toBe(false);
    expect(itemSchema.safeParse({ name: 'Меч', qty: 0 }).success).toBe(false);
    expect(itemSchema.safeParse({ name: 'Меч', qty: 1.5 }).success).toBe(false);
  });
});

describe('протокол ИИ', () => {
  it('ответ ИИ с завышенными числами отклоняется', () => {
    const base = { narration: 'Текст', options: [], check: null, summary: '', gameOver: false };
    expect(DmResponseSchema.safeParse({ ...base, effects: { hp: -5, xp: 10, itemsAdd: [], itemsRemove: [] } }).success).toBe(true);
    expect(DmResponseSchema.safeParse({ ...base, effects: { hp: 0, xp: 99999, itemsAdd: [], itemsRemove: [] } }).success).toBe(false);
    expect(DmResponseSchema.safeParse({ ...base, check: { ability: 'luck', dc: 10, reason: 'x' } }).success).toBe(false);
  });

  it('слишком длинное действие игрока отклоняется', () => {
    const req = {
      campaign: { title: 'Т', setting: '', summary: '' },
      hero: {
        name: 'А', race: 'Человек', className: 'Воин', level: 1, hp: 10, maxHp: 10,
        abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, inventory: [], backstory: '',
      },
      history: [],
      input: { type: 'action', text: 'а'.repeat(301) },
    };
    expect(TurnRequestSchema.safeParse(req).success).toBe(false);
  });
});

describe('бэкап', () => {
  const payload: BackupPayload = {
    username: 'player1',
    exportedAt: Date.UTC(2026, 10, 10),
    characters: [{
      id: 7, name: 'Арен', race_id: 'human', class_id: 'fighter', level: 1, xp: 0, hp: 12, max_hp: 12,
      str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8, backstory: '', created_at: 1, updated_at: 1,
    }],
    items: [{ id: 1, character_id: 7, name: 'Меч', qty: 1, created_at: 1 }],
    campaigns: [{ id: 3, character_id: 7, title: 'Башня', setting: '', summary: '', status: 'active', turns: 0, created_at: 1, updated_at: 1 }],
    messages: [{ id: 1, campaign_id: 3, role: 'dm', content: 'Начало', meta: null, created_at: 1 }],
  };

  it('создание и восстановление', async () => {
    const file = await sealBackup(payload, 'backup123', rnd);
    expect(file).not.toContain('Арен'); // данные не лежат открытым текстом
    expect(await openBackup(file, 'backup123')).toEqual(payload);
  });

  it('неверный пароль', async () => {
    const file = await sealBackup(payload, 'backup123', rnd);
    await expect(openBackup(file, 'nope')).rejects.toBeInstanceOf(DecryptError);
  });

  it('подмена заголовка обнаруживается', async () => {
    const f = JSON.parse(await sealBackup(payload, 'backup123', rnd));
    f.createdAt = '2030-01-01T00:00:00.000Z';
    await expect(openBackup(JSON.stringify(f), 'backup123')).rejects.toBeInstanceOf(DecryptError);
  });

  it('чужой файл', async () => {
    await expect(openBackup('{"hello":1}', 'x')).rejects.toBeInstanceOf(BackupError);
    await expect(openBackup('not json', 'x')).rejects.toBeInstanceOf(BackupError);
  });

  it('битые ссылки отклоняются', async () => {
    const bad = { ...payload, items: [{ ...payload.items[0], character_id: 999 }] };
    const file = await sealBackup(bad, 'backup123', rnd);
    await expect(openBackup(file, 'backup123')).rejects.toThrow('несуществующего героя');
  });
});

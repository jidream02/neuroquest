/**
 * Упрощённые правила D&D 5e. Вся механика считается здесь, в коде,
 * а не ИИ: модель может ошибиться или «подыграть» игроку.
 */
import type { Ability, DmResponse } from '../../shared/dmProtocol';

export const ABILITY_LABELS: Record<Ability, { short: string; full: string }> = {
  str: { short: 'СИЛ', full: 'Сила' },
  dex: { short: 'ЛОВ', full: 'Ловкость' },
  con: { short: 'ТЕЛ', full: 'Телосложение' },
  int: { short: 'ИНТ', full: 'Интеллект' },
  wis: { short: 'МДР', full: 'Мудрость' },
  cha: { short: 'ХАР', full: 'Харизма' },
};

export type Abilities = Record<Ability, number>;

export interface RaceDef {
  id: string;
  name: string;
  emoji: string;
  bonus: Partial<Abilities>;
}

export const RACES: RaceDef[] = [
  { id: 'human', name: 'Человек', emoji: '🧑', bonus: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 } },
  { id: 'elf', name: 'Эльф', emoji: '🧝', bonus: { dex: 2, int: 1 } },
  { id: 'dwarf', name: 'Дварф', emoji: '🧔', bonus: { con: 2, str: 1 } },
  { id: 'halfling', name: 'Полурослик', emoji: '🧒', bonus: { dex: 2, cha: 1 } },
  { id: 'halforc', name: 'Полуорк', emoji: '👹', bonus: { str: 2, con: 1 } },
  { id: 'tiefling', name: 'Тифлинг', emoji: '😈', bonus: { cha: 2, int: 1 } },
];

export interface ClassDef {
  id: string;
  name: string;
  emoji: string;
  hitDie: number;
  primary: Ability;
  startItems: { name: string; qty: number }[];
}

export const CLASSES: ClassDef[] = [
  { id: 'fighter', name: 'Воин', emoji: '⚔️', hitDie: 10, primary: 'str', startItems: [{ name: 'Длинный меч', qty: 1 }, { name: 'Кольчуга', qty: 1 }, { name: 'Зелье лечения', qty: 1 }] },
  { id: 'rogue', name: 'Плут', emoji: '🗡️', hitDie: 8, primary: 'dex', startItems: [{ name: 'Кинжал', qty: 2 }, { name: 'Воровские инструменты', qty: 1 }, { name: 'Плащ с капюшоном', qty: 1 }] },
  { id: 'wizard', name: 'Маг', emoji: '🔮', hitDie: 6, primary: 'int', startItems: [{ name: 'Посох', qty: 1 }, { name: 'Книга заклинаний', qty: 1 }, { name: 'Свиток огня', qty: 2 }] },
  { id: 'cleric', name: 'Жрец', emoji: '✨', hitDie: 8, primary: 'wis', startItems: [{ name: 'Булава', qty: 1 }, { name: 'Святой символ', qty: 1 }, { name: 'Зелье лечения', qty: 2 }] },
  { id: 'ranger', name: 'Следопыт', emoji: '🏹', hitDie: 10, primary: 'dex', startItems: [{ name: 'Длинный лук', qty: 1 }, { name: 'Стрелы', qty: 20 }, { name: 'Охотничий нож', qty: 1 }] },
  { id: 'bard', name: 'Бард', emoji: '🎻', hitDie: 8, primary: 'cha', startItems: [{ name: 'Лютня', qty: 1 }, { name: 'Рапира', qty: 1 }, { name: 'Красивый наряд', qty: 1 }] },
];

export const raceById = (id: string) => RACES.find((r) => r.id === id) ?? RACES[0];
export const classById = (id: string) => CLASSES.find((c) => c.id === id) ?? CLASSES[0];

export const ABILITY_MIN = 3;
export const ABILITY_MAX = 18;
export const MAX_ABILITY_TOTAL = 80; // защита от «все по 18»: сумма базовых характеристик ограничена

export const modifier = (score: number) => Math.floor((score - 10) / 2);
export const formatMod = (m: number) => (m >= 0 ? `+${m}` : `${m}`);

/** Итоговые характеристики = базовые + расовый бонус. */
export function effectiveAbilities(base: Abilities, raceId: string): Abilities {
  const bonus = raceById(raceId).bonus;
  const out = { ...base };
  for (const k of Object.keys(out) as Ability[]) out[k] = base[k] + (bonus[k] ?? 0);
  return out;
}

// ---------- Уровни ----------
export const XP_THRESHOLDS = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000];
export const levelForXp = (xp: number) => {
  let lvl = 1;
  XP_THRESHOLDS.forEach((t, i) => {
    if (xp >= t) lvl = i + 1;
  });
  return lvl;
};
export const proficiencyBonus = (level: number) => 2 + Math.floor((level - 1) / 4);

/** Макс. HP: на 1-м уровне — максимум кости хитов, дальше — среднее значение. Минимум 1 за уровень. */
export function maxHpFor(classId: string, level: number, con: number): number {
  const die = classById(classId).hitDie;
  const conMod = modifier(con);
  const first = Math.max(1, die + conMod);
  const perLevel = Math.max(1, Math.floor(die / 2) + 1 + conMod);
  return first + perLevel * (level - 1);
}

// ---------- Кости ----------
export type Rng = () => number; // [0, 1)
export const rollDie = (sides: number, rng: Rng = Math.random) => Math.floor(rng() * sides) + 1;

/** 4d6, отбросить меньший — классическая генерация характеристики. */
export function roll4d6DropLowest(rng: Rng = Math.random): number {
  const dice = [0, 0, 0, 0].map(() => rollDie(6, rng)).sort((a, b) => a - b);
  return dice[1] + dice[2] + dice[3];
}

export interface CheckResult {
  ability: Ability;
  natural: number;
  modifier: number;
  total: number;
  dc: number;
  success: boolean;
}

/** Проверка характеристики: d20 + модификатор (+ бонус мастерства для основной характеристики класса). */
export function abilityCheck(
  ability: Ability,
  dc: number,
  abilities: Abilities,
  classId: string,
  level: number,
  rng: Rng = Math.random,
): CheckResult {
  const natural = rollDie(20, rng);
  const mod = modifier(abilities[ability]) + (classById(classId).primary === ability ? proficiencyBonus(level) : 0);
  const total = natural + mod;
  // Натуральная 20 — всегда успех, натуральная 1 — всегда провал.
  const success = natural === 20 ? true : natural === 1 ? false : total >= dc;
  return { ability, natural, modifier: mod, total, dc, success };
}

// ---------- Применение решения мастера ----------

export interface HeroState {
  hp: number;
  maxHp: number;
  xp: number;
  level: number;
  inventory: { name: string; qty: number }[];
}

export interface AppliedEffects {
  state: HeroState;
  hpChange: number;
  xpGained: number;
  leveledUp: boolean;
  added: string[];
  removed: string[];
  dead: boolean;
}

const MAX_ITEMS = 40;

/**
 * ИИ лишь ПРЕДЛАГАЕТ изменения. Здесь они проверяются и ограничиваются:
 * HP не уходит ниже 0 и выше максимума, удалить можно только существующий предмет,
 * инвентарь не растёт бесконечно.
 */
export function applyEffects(
  state: HeroState,
  effects: DmResponse['effects'],
  classId: string,
  con: number,
): AppliedEffects {
  const inventory = state.inventory.map((i) => ({ ...i }));
  const removed: string[] = [];
  for (const name of effects.itemsRemove) {
    const idx = inventory.findIndex((i) => i.name.toLowerCase() === name.trim().toLowerCase());
    if (idx === -1) continue; // нельзя потерять то, чего нет
    removed.push(inventory[idx].name);
    if (inventory[idx].qty > 1) inventory[idx].qty -= 1;
    else inventory.splice(idx, 1);
  }
  const added: string[] = [];
  for (const item of effects.itemsAdd) {
    const name = item.name.trim();
    const existing = inventory.find((i) => i.name.toLowerCase() === name.toLowerCase());
    if (existing) existing.qty = Math.min(999, existing.qty + item.qty);
    else if (inventory.length < MAX_ITEMS) inventory.push({ name, qty: item.qty });
    else continue;
    added.push(item.qty > 1 ? `${name} ×${item.qty}` : name);
  }

  const xp = state.xp + Math.max(0, effects.xp);
  const level = Math.max(state.level, levelForXp(xp));
  const leveledUp = level > state.level;
  const maxHp = leveledUp ? maxHpFor(classId, level, con) : state.maxHp;
  // При повышении уровня герой получает прибавку к максимуму HP и к текущему HP.
  const baseHp = leveledUp ? state.hp + (maxHp - state.maxHp) : state.hp;
  const hp = Math.max(0, Math.min(maxHp, baseHp + effects.hp));

  return {
    state: { hp, maxHp, xp, level, inventory },
    hpChange: hp - state.hp,
    xpGained: xp - state.xp,
    leveledUp,
    added,
    removed,
    dead: hp === 0,
  };
}

/**
 * Протокол общения «приложение ⇄ сервер ⇄ ИИ-мастер».
 * Один файл используют и мобильное приложение, и сервер,
 * поэтому формат запросов/ответов проверяется одинаково с обеих сторон.
 */
import { z } from 'zod';

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type Ability = (typeof ABILITIES)[number];
export const AbilitySchema = z.enum(ABILITIES);

// ---------- Запрос от приложения к серверу ----------

const shortText = (max: number) => z.string().trim().min(1).max(max);

export const HeroSnapshotSchema = z.object({
  name: shortText(40),
  race: shortText(30),
  className: shortText(30),
  level: z.number().int().min(1).max(20),
  hp: z.number().int().min(0).max(500),
  maxHp: z.number().int().min(1).max(500),
  abilities: z.object({
    str: z.number().int().min(1).max(30),
    dex: z.number().int().min(1).max(30),
    con: z.number().int().min(1).max(30),
    int: z.number().int().min(1).max(30),
    wis: z.number().int().min(1).max(30),
    cha: z.number().int().min(1).max(30),
  }),
  inventory: z.array(z.object({ name: shortText(40), qty: z.number().int().min(1).max(999) })).max(40),
  backstory: z.string().max(600),
});
export type HeroSnapshot = z.infer<typeof HeroSnapshotSchema>;

export const HistoryEntrySchema = z.object({
  role: z.enum(['dm', 'player', 'roll']),
  text: z.string().max(2000),
});
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

export const TurnInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('action'), text: shortText(300) }),
  z.object({
    type: z.literal('roll'),
    ability: AbilitySchema,
    dc: z.number().int().min(1).max(40),
    natural: z.number().int().min(1).max(20),
    total: z.number().int().min(-10).max(60),
    success: z.boolean(),
  }),
]);
export type TurnInput = z.infer<typeof TurnInputSchema>;

export const TurnRequestSchema = z.object({
  campaign: z.object({
    title: shortText(60),
    setting: z.string().trim().max(400),
    summary: z.string().max(1500),
  }),
  hero: HeroSnapshotSchema,
  history: z.array(HistoryEntrySchema).max(30),
  input: TurnInputSchema,
});
export type TurnRequest = z.infer<typeof TurnRequestSchema>;

// ---------- Ответ ИИ-мастера ----------
// ИИ НЕ доверяем: ответ модели проверяется схемой, числа ограничиваются.

export const DmResponseSchema = z.object({
  narration: z.string().trim().min(1).max(2500),
  options: z.array(z.string().trim().min(1).max(120)).max(4).default([]),
  check: z
    .object({
      ability: AbilitySchema,
      dc: z.number().int().min(5).max(30),
      reason: z.string().trim().min(1).max(160),
    })
    .nullable()
    .default(null),
  effects: z
    .object({
      hp: z.number().int().min(-30).max(30).default(0),
      xp: z.number().int().min(0).max(300).default(0),
      itemsAdd: z.array(z.object({ name: z.string().trim().min(1).max(40), qty: z.number().int().min(1).max(20) })).max(5).default([]),
      itemsRemove: z.array(z.string().trim().min(1).max(40)).max(5).default([]),
    })
    .default({ hp: 0, xp: 0, itemsAdd: [], itemsRemove: [] }),
  summary: z.string().trim().max(1500).default(''),
  gameOver: z.boolean().default(false),
});
export type DmResponse = z.infer<typeof DmResponseSchema>;

export const TurnResponseSchema = z.object({
  dm: DmResponseSchema,
  model: z.string(),
});
export type TurnResponse = z.infer<typeof TurnResponseSchema>;

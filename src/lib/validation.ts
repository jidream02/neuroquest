/**
 * Проверка всего, что вводит пользователь. Каждая форма проходит схему zod
 * до того, как данные попадут в базу или на сервер.
 */
import { z } from 'zod';
import { ABILITY_MAX, ABILITY_MIN, CLASSES, MAX_ABILITY_TOTAL, RACES } from './rules';

// Убираем управляющие символы (кроме переноса строки) — защита от «мусора» и невидимых символов.
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g;
export const sanitize = (s: string) => s.replace(CONTROL, '').replace(/[ \t]+/g, ' ').trim();

const cleanString = (min: number, max: number, label: string) =>
  z
    .string()
    .transform(sanitize)
    .pipe(
      z
        .string()
        .min(min, min === 1 ? `${label}: поле обязательно` : `${label}: минимум ${min} символа`)
        .max(max, `${label}: максимум ${max} символов`),
    );

// ---------- Аккаунт ----------

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Логин: минимум 3 символа')
  .max(24, 'Логин: максимум 24 символа')
  .regex(/^[a-zA-Z0-9_.-]+$/, 'Логин: только латиница, цифры и _ . -');

export const passwordSchema = z
  .string()
  .min(8, 'Пароль: минимум 8 символов')
  .max(64, 'Пароль: максимум 64 символа')
  .regex(/[A-Za-zА-Яа-яЁё]/, 'Пароль должен содержать букву')
  .regex(/\d/, 'Пароль должен содержать цифру');

export const registerSchema = z
  .object({ username: usernameSchema, password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'Пароли не совпадают', path: ['confirm'] })
  .refine((v) => v.password.toLowerCase() !== v.username.toLowerCase(), {
    message: 'Пароль не должен совпадать с логином',
    path: ['password'],
  });

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Введите логин').max(24),
  password: z.string().min(1, 'Введите пароль').max(64),
});

export const changePasswordSchema = z
  .object({ current: z.string().min(1, 'Введите текущий пароль'), next: passwordSchema, confirm: z.string() })
  .refine((v) => v.next === v.confirm, { message: 'Пароли не совпадают', path: ['confirm'] })
  .refine((v) => v.next !== v.current, { message: 'Новый пароль совпадает со старым', path: ['next'] });

// ---------- Герой ----------

// Латиница, кириллица (включая казахские буквы), цифры, пробел, апостроф, дефис.
// Явные диапазоны вместо \p{L} — надёжно работает во всех JS-движках (Hermes, V8).
const NAME_RE = /^[A-Za-z\u0400-\u04FF0-9 '’-]+$/;

const abilityScore = z
  .number({ message: 'Характеристика должна быть числом' })
  .int()
  .min(ABILITY_MIN, `Характеристика: от ${ABILITY_MIN}`)
  .max(ABILITY_MAX, `Характеристика: до ${ABILITY_MAX}`);

export const heroSchema = z
  .object({
    name: cleanString(2, 40, 'Имя').refine((s) => NAME_RE.test(s), 'Имя: только буквы, цифры, пробел, дефис'),
    raceId: z.enum(RACES.map((r) => r.id) as [string, ...string[]], { message: 'Выберите расу' }),
    classId: z.enum(CLASSES.map((c) => c.id) as [string, ...string[]], { message: 'Выберите класс' }),
    backstory: z.string().transform(sanitize).pipe(z.string().max(600, 'Предыстория: максимум 600 символов')),
    abilities: z.object({
      str: abilityScore,
      dex: abilityScore,
      con: abilityScore,
      int: abilityScore,
      wis: abilityScore,
      cha: abilityScore,
    }),
  })
  .refine((v) => Object.values(v.abilities).reduce((a, b) => a + b, 0) <= MAX_ABILITY_TOTAL, {
    message: `Сумма характеристик не больше ${MAX_ABILITY_TOTAL}`,
    path: ['abilities'],
  });
export type HeroForm = z.infer<typeof heroSchema>;

export const itemSchema = z.object({
  name: cleanString(1, 40, 'Предмет'),
  qty: z.number({ message: 'Количество — число' }).int('Количество — целое').min(1, 'Минимум 1').max(999, 'Максимум 999'),
});

// ---------- Кампания и игра ----------

export const campaignSchema = z.object({
  title: cleanString(2, 60, 'Название'),
  setting: z.string().transform(sanitize).pipe(z.string().max(400, 'Описание мира: максимум 400 символов')),
  characterId: z.number({ message: 'Выберите героя' }).int().positive('Выберите героя'),
});

export const actionSchema = cleanString(1, 300, 'Действие');

export const backupPasswordSchema = z.string().min(6, 'Пароль бэкапа: минимум 6 символов').max(64);

/** Первая ошибка схемы по каждому полю — удобно показывать под инпутами. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

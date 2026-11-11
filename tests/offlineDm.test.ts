import { describe, expect, it } from 'vitest';
import { offlineDm } from '../shared/offlineDm';
import { DmResponseSchema, type TurnRequest } from '../shared/dmProtocol';

const base: Omit<TurnRequest, 'input' | 'history'> = {
  campaign: { title: 'Тест', setting: '', summary: '' },
  hero: {
    name: 'Арен', race: 'Человек', className: 'Воин', level: 1, hp: 10, maxHp: 10,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, inventory: [], backstory: '',
  },
};
const roll = (ok: boolean) => ({ role: 'roll' as const, text: `Сила: d20 10 +0 = 10 против СЛ 10 — ${ok ? 'успех' : 'провал'}` });

describe('офлайн-мастер', () => {
  it('ответы проходят ту же схему, что и ответы ИИ', () => {
    const r = offlineDm({ ...base, history: [], input: { type: 'start' } });
    expect(DmResponseSchema.safeParse(r).success).toBe(true);
    expect(r.options.length).toBeGreaterThan(0);
  });

  it('характеристика проверки выбирается по смыслу действия', () => {
    const ask = (text: string) => offlineDm({ ...base, history: [], input: { type: 'action', text } }).check?.ability;
    expect(ask('Атаковать волка мечом')).toBe('str');
    expect(ask('Пытаюсь уговорить стражника')).toBe('cha');
    expect(ask('Изучить руны')).toBe('int');
    expect(ask('Подкрасться к двери')).toBe('dex');
  });

  it('успех двигает сцену, провал — нет и наносит урон', () => {
    const input = { type: 'roll' as const, ability: 'str' as const, dc: 10, natural: 10, total: 10, success: false };
    const fail = offlineDm({ ...base, history: [], input });
    expect(fail.effects.hp).toBeLessThan(0);
    const afterFail = offlineDm({ ...base, history: [roll(false)], input: { type: 'action', text: 'снова' } });
    expect(afterFail.check?.dc).toBe(10); // всё ещё первая сцена
    const afterOk = offlineDm({ ...base, history: [roll(true)], input: { type: 'action', text: 'дальше' } });
    expect(afterOk.check?.dc).toBe(12); // вторая сцена
  });

  it('последняя сцена завершает приключение', () => {
    const history = [roll(true), roll(true), roll(true)];
    const r = offlineDm({ ...base, history, input: { type: 'roll', ability: 'str', dc: 16, natural: 18, total: 18, success: true } });
    expect(r.gameOver).toBe(true);
    expect(r.effects.xp).toBe(150);
  });
});

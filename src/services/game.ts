/**
 * Один ход игры:
 *   1) сохранить действие игрока / результат броска;
 *   2) собрать «снимок» героя и последние события → запрос на сервер;
 *   3) получить ответ мастера (уже проверенный схемой);
 *   4) применить эффекты ПО ПРАВИЛАМ КОДА (HP, опыт, предметы, уровень);
 *   5) сохранить всё в базу.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import type { DmResponse, HistoryEntry, TurnInput, TurnRequest } from '../../shared/dmProtocol';
import * as repo from '../db/repo';
import { ABILITY_LABELS, applyEffects, classById, effectiveAbilities, formatMod, raceById, type CheckResult } from '../lib/rules';
import { DmApiError, isServerReachable, requestTurn, resetReachability } from './dmApi';
import { offlineDm } from '../../shared/offlineDm';

export interface DmMeta {
  options: string[];
  check: DmResponse['check'];
  model?: string;
}

const HISTORY_LIMIT = 12;

export function parseDmMeta(m: repo.MessageRow | undefined): DmMeta | null {
  if (!m || m.role !== 'dm' || !m.meta) return null;
  try {
    return JSON.parse(m.meta) as DmMeta;
  } catch {
    return null;
  }
}

/** Ожидает ли мастер броска: последняя запись — ответ мастера с полем check. */
export function pendingCheck(messages: repo.MessageRow[]): DmResponse['check'] {
  const last = [...messages].reverse().find((m) => m.role !== 'system');
  return parseDmMeta(last)?.check ?? null;
}

export function describeRoll(r: CheckResult): string {
  return `${ABILITY_LABELS[r.ability].full}: d20 ${r.natural} ${formatMod(r.modifier)} = ${r.total} против СЛ ${r.dc} — ${r.success ? 'успех' : 'провал'}`;
}

/** Записать действие игрока (до запроса к мастеру), чтобы оно сохранилось даже при ошибке сети. */
export async function recordPlayerInput(db: SQLiteDatabase, userId: number, campaignId: number, input: TurnInput) {
  if (input.type === 'action') await repo.addMessage(db, userId, campaignId, 'player', input.text);
  if (input.type === 'roll') {
    await repo.addMessage(
      db, userId, campaignId, 'roll',
      describeRoll({ ability: input.ability, natural: input.natural, modifier: input.total - input.natural, total: input.total, dc: input.dc, success: input.success }),
      input,
    );
  }
}

/** Запросить ответ мастера и применить его. Повторный вызов с тем же input = «повторить» после ошибки. */
export async function resolveTurn(db: SQLiteDatabase, userId: number, campaignId: number, input: TurnInput) {
  const campaign = await repo.getCampaign(db, userId, campaignId);
  if (!campaign) throw new repo.NotFoundError('Кампания');
  const hero = await repo.getCharacter(db, userId, campaign.character_id);
  if (!hero) throw new repo.NotFoundError('Герой');
  const items = await repo.listItems(db, userId, hero.id);
  const messages = await repo.listMessages(db, userId, campaignId);

  // Последнее сообщение (текущее действие игрока) уже есть в input — в историю его не дублируем.
  const prior = input.type === 'start' ? messages : messages.slice(0, -1);
  const history: HistoryEntry[] = prior
    .filter((m) => m.role !== 'system')
    .slice(-HISTORY_LIMIT)
    .map((m) => ({ role: m.role as HistoryEntry['role'], text: m.content.slice(0, 2000) }));

  const eff = effectiveAbilities(repo.baseAbilities(hero), hero.race_id);
  const request: TurnRequest = {
    campaign: { title: campaign.title, setting: campaign.setting, summary: campaign.summary.slice(0, 1500) },
    hero: {
      name: hero.name,
      race: raceById(hero.race_id).name,
      className: classById(hero.class_id).name,
      level: hero.level,
      hp: hero.hp,
      maxHp: hero.max_hp,
      abilities: eff,
      inventory: items.slice(0, 40).map((i) => ({ name: i.name, qty: i.qty })),
      backstory: hero.backstory,
    },
    history,
    input,
  };

  let dm: DmResponse;
  let model: string;
  try {
    if (!(await isServerReachable())) throw new DmApiError('Сервер недоступен', true);
    ({ dm, model } = await requestTurn(request));
  } catch (e) {
    // Сервер недоступен (нет сети / выключен) — ход ведёт встроенный офлайн-мастер.
    if (!(e instanceof DmApiError && e.unreachable)) throw e;
    resetReachability();
    dm = offlineDm(request);
    model = 'offline';
  }

  // Эффекты применяет код, а не ИИ: значения ограничены правилами.
  const applied = applyEffects(
    { hp: hero.hp, maxHp: hero.max_hp, xp: hero.xp, level: hero.level, inventory: items.map((i) => ({ name: i.name, qty: i.qty })) },
    dm.effects,
    hero.class_id,
    eff.con,
  );
  await repo.saveHeroState(db, userId, hero.id, applied.state);

  // Если мастер просит бросок, а мы только что его прислали — игнорируем повтор, чтобы не зациклиться.
  const meta: DmMeta = { options: dm.options, check: input.type === 'roll' ? null : dm.check, model };
  await repo.addMessage(db, userId, campaignId, 'dm', dm.narration, meta);

  const notes: string[] = [];
  if (applied.hpChange < 0) notes.push(`💔 ${applied.hpChange} HP`);
  if (applied.hpChange > 0) notes.push(`💚 +${applied.hpChange} HP`);
  if (applied.xpGained > 0) notes.push(`⭐ +${applied.xpGained} XP`);
  if (applied.added.length) notes.push(`🎒 Получено: ${applied.added.join(', ')}`);
  if (applied.removed.length) notes.push(`➖ Потеряно: ${applied.removed.join(', ')}`);
  if (applied.leveledUp) notes.push(`🎉 Новый уровень: ${applied.state.level}! Макс. HP ${applied.state.maxHp}`);
  if (applied.dead) notes.push('☠️ Герой пал…');
  if (notes.length) await repo.addMessage(db, userId, campaignId, 'system', notes.join('   '));

  const status: repo.CampaignStatus = applied.dead ? 'dead' : dm.gameOver ? 'finished' : 'active';
  await repo.updateCampaignProgress(db, userId, campaignId, { summary: dm.summary || campaign.summary, status });
  return { status, applied };
}

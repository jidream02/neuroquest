import type { Ability, DmResponse, TurnRequest } from './dmProtocol';

/**
 * Офлайн-мастер без ИИ. Используется сервером (нет ключа Gemini или ИИ недоступен)
 * и самим приложением, если сервер недоступен — игра работает даже без интернета.
 *
 * Это короткое сценарное приключение «Башня на холме»: сцены идут по порядку,
 * а характеристика проверки выбирается по ключевым словам в действии игрока.
 */

interface Scene {
  intro: string;
  options: string[];
  success: string;
  failure: string;
  loot?: string;
}

const SCENES: Scene[] = [
  {
    intro: 'Тропа к старой башне ведёт через туманный лес. Между деревьями мелькают огоньки, а под ногами хрустят чьи-то кости.',
    options: ['Идти по тропе осторожно', 'Свернуть к огонькам', 'Прислушаться к лесу'],
    success: 'Вы замечаете натянутую между корнями нить — ловушку браконьеров — и спокойно обходите её.',
    failure: 'Нить ловушки дёргает вас за ногу, и вы падаете на камни.',
    loot: 'Моток прочной верёвки',
  },
  {
    intro: 'У подножия башни дремлет огромный волк с ошейником из чёрного железа. На ошейнике висит ключ.',
    options: ['Подкрасться и снять ключ', 'Атаковать волка', 'Попробовать успокоить зверя'],
    success: 'Волк отступает, и ключ с ошейника оказывается у вас в руках.',
    failure: 'Волк вскакивает и успевает цапнуть вас, прежде чем скрыться в чаще.',
    loot: 'Железный ключ',
  },
  {
    intro: 'Дверь башни открыта. Внутри винтовая лестница и стены, исписанные светящимися рунами.',
    options: ['Изучить руны', 'Подняться по лестнице', 'Обыскать первый этаж'],
    success: 'Руны складываются в слова: «Хранитель спит, пока звучит песня». Вы запоминаете подсказку.',
    failure: 'Руна вспыхивает и обжигает вас магическим огнём.',
    loot: 'Свиток с рунами',
  },
  {
    intro: 'На вершине башни каменный голем охраняет сундук. Его глаза медленно загораются красным.',
    options: ['Сразиться с големом', 'Проскользнуть к сундуку', 'Произнести слова с рун'],
    success: 'Голем замирает и рассыпается грудой камней. Сундук ваш!',
    failure: 'Каменный кулак отбрасывает вас к стене.',
    loot: 'Зелье лечения',
  },
];

const KEYWORDS: [Ability, RegExp][] = [
  ['str', /атак|удар|бь|руб|сраж|ломат|толка|подня|сил/i],
  ['dex', /крад|подкра|прыг|увернут|лез|скольз|стрел|ловк|снять|тих/i],
  ['con', /терп|выдерж|бежать долго|задерж/i],
  ['int', /изуч|руны|вспомн|магия|заклин|прочит|анализ/i],
  ['wis', /слуш|осмотр|ищ|обыск|замеч|следы|чувств|успокои/i],
  ['cha', /убеди|угов|обман|договор|проси|споп|песн|произнес|говор/i],
];

const pickAbility = (text: string): Ability => KEYWORDS.find(([, re]) => re.test(text))?.[0] ?? 'dex';

export function offlineDm(req: TurnRequest): DmResponse {
  const { hero, input, history } = req;
  // Номер сцены = сколько проверок уже пройдено УСПЕШНО (после провала сцена повторяется).
  const successes = history.filter((h) => h.role === 'roll' && /успех$/.test(h.text)).length;
  const sceneIdx = Math.min(SCENES.length - 1, successes);
  const scene = SCENES[sceneIdx];
  const next = SCENES[sceneIdx + 1];
  const base: DmResponse = {
    narration: '',
    options: [],
    check: null,
    effects: { hp: 0, xp: 0, itemsAdd: [], itemsRemove: [] },
    summary: `${hero.name} исследует старую башню на холме (офлайн-приключение, сцена ${sceneIdx + 1} из ${SCENES.length}).`,
    gameOver: false,
  };

  if (input.type === 'start') {
    return {
      ...base,
      narration: `${hero.name} получает от старосты деревни просьбу: в заброшенной башне на холме по ночам горит свет, и пропадают люди. ${scene.intro}`,
      options: scene.options,
    };
  }

  if (input.type === 'roll') {
    const last = sceneIdx === SCENES.length - 1;
    if (input.success) {
      return {
        ...base,
        narration: `${input.natural === 20 ? 'Блестяще! ' : ''}${scene.success}${next ? ' ' + next.intro : ' Тайна башни раскрыта — деревня спасена!'}`,
        options: next ? next.options : [],
        effects: { hp: 0, xp: last ? 150 : input.natural === 20 ? 60 : 40, itemsAdd: scene.loot ? [{ name: scene.loot, qty: 1 }] : [], itemsRemove: [] },
        gameOver: last,
      };
    }
    const dmg = input.natural === 1 ? 4 : 2 + (sceneIdx % 2);
    return {
      ...base,
      narration: `${scene.failure} Но вы поднимаетесь и пробуете снова.`,
      options: scene.options,
      effects: { hp: -dmg, xp: 0, itemsAdd: [], itemsRemove: [] },
      gameOver: hero.hp - dmg <= 0,
    };
  }

  const ability = pickAbility(input.text);
  return {
    ...base,
    narration: `«${input.text}». ${hero.name} решается. Исход неочевиден — всё зависит от удачи и умения.`,
    check: { ability, dc: 10 + sceneIdx * 2, reason: 'Опасный момент: проверьте свои силы' },
  };
}

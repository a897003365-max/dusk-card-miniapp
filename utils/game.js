const { FAMILIES, TIERS, CHAPTERS } = require('./content');
const { createAdventureProfile, assertAdventure } = require('./combat');
const { heroes } = require('../assets/battle/manifest');

const STATS = ['heart', 'courage', 'insight'];

function createState() {
  const collection = {};
  FAMILIES.forEach((family) => {
    collection[family.id] = { R: 0, SR: 0, SSR: 0, UR: 0 };
  });
  const team = ['sheep', 'orangecat', 'nav'];
  team.forEach((id) => { collection[id].R = 1; });
  return {
    version: 2,
    tickets: 6,
    drawCount: 0,
    pitySSR: 0,
    pityUR: 0,
    collection,
    team,
    cleared: [],
    endings: {},
    journey: null,
    lastEnding: null,
    adventure: createAdventureProfile()
  };
}

function getFamily(state, id) {
  const family = FAMILIES.find((item) => item.id === id);
  if (!family) throw new Error('没有找到这位伙伴');
  const copies = state.collection[id];
  const variants = TIERS.map((tier) => ({
    tier,
    count: copies[tier],
    image: heroes[id].idle
  }));
  const count = variants.reduce((sum, item) => sum + item.count, 0);
  const tier = TIERS.filter((item) => copies[item] > 0).pop() || 'R';
  const bond = Math.min(3, variants.reduce((sum, item) => sum + Math.max(0, item.count - 1), 0));
  const multiplier = TIERS.indexOf(tier) + 1;
  const stats = {};
  STATS.forEach((stat) => {
    stats[stat] = family.stats[stat] * multiplier + (family.trait === stat ? bond : 0);
  });
  return {
    ...family,
    owned: count > 0,
    tier,
    bond,
    count,
    stats,
    image: heroes[id].idle,
    variants
  };
}

function getTeamStats(state, team = state.team) {
  return team.reduce((stats, id) => {
    const family = getFamily(state, id);
    STATS.forEach((stat) => { stats[stat] += family.stats[stat]; });
    return stats;
  }, { heart: 0, courage: 0, insight: 0 });
}

function randomValue(rng) {
  const value = rng();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error('抽取随机数必须在 0 到 1 之间');
  }
  return value;
}

function draw(state, count, rng = Math.random) {
  if (count !== 1 && count !== 5) throw new Error('每次只能开启 1 个或 5 个盲盒');
  if (typeof rng !== 'function') throw new Error('抽取随机函数无效');
  if (state.tickets < count) throw new Error('邮票不足，完成剧情可以获得邮票');
  const next = { ...state, tickets: state.tickets - count, collection: { ...state.collection } };
  const cards = [];
  for (let index = 0; index < count; index += 1) {
    const roll = randomValue(rng);
    let tier = roll < 0.6 ? 'R' : roll < 0.88 ? 'SR' : roll < 0.98 ? 'SSR' : 'UR';
    if (next.pityUR >= 39) tier = 'UR';
    else if (next.pitySSR >= 9 && tier !== 'UR') tier = 'SSR';
    const family = FAMILIES[Math.floor(randomValue(rng) * FAMILIES.length)];
    const copies = next.collection[family.id];
    const isNewFamily = TIERS.every((item) => copies[item] === 0);
    const isNewVariant = copies[tier] === 0;
    next.collection[family.id] = { ...copies, [tier]: copies[tier] + 1 };
    next.drawCount += 1;
    next.pitySSR = tier === 'SSR' || tier === 'UR' ? 0 : next.pitySSR + 1;
    next.pityUR = tier === 'UR' ? 0 : next.pityUR + 1;
    cards.push({
      id: family.id,
      name: family.name,
      tier,
      image: heroes[family.id].idle,
      isNewFamily,
      isNewVariant,
      duplicate: !isNewVariant
    });
  }
  return { state: next, cards };
}

function saveTeam(state, ids) {
  if (state.journey) throw new Error('请先完成当前旅程，再调整同行伙伴');
  if (state.adventure.active) throw new Error('请先完成或结束当前远行，再调整同行伙伴');
  if (!Array.isArray(ids) || ids.length !== 3 || new Set(ids).size !== 3) {
    throw new Error('请选择 3 位不同的同行伙伴');
  }
  if (ids.some((id) => !getFamily(state, id).owned)) throw new Error('只能邀请已经结识的伙伴');
  return { ...state, team: [...ids] };
}

function startJourney(state, chapterId) {
  if (state.journey) throw new Error('请先完成当前旅程');
  if (state.adventure.active) throw new Error('请先完成或结束当前远行，再开始故事');
  const chapterIndex = CHAPTERS.findIndex((chapter) => chapter.id === chapterId);
  if (chapterIndex < 0) throw new Error('没有找到这封来信');
  if (CHAPTERS.slice(0, chapterIndex).some((chapter) => !state.cleared.includes(chapter.id))) {
    throw new Error('请先完成前面的来信');
  }
  return {
    ...state,
    lastEnding: null,
    journey: {
      chapterId,
      sceneIndex: 0,
      warmth: 0,
      courage: 0,
      pending: null,
      team: [...state.team],
      stats: getTeamStats(state)
    }
  };
}

function choose(state, choiceId) {
  const journey = state.journey;
  if (!journey) throw new Error('请先开启一段旅程');
  if (journey.pending) throw new Error('请先读完这次选择的回信');
  const chapter = CHAPTERS.find((item) => item.id === journey.chapterId);
  const choice = chapter.scenes[journey.sceneIndex].choices.find((item) => item.id === choiceId);
  if (!choice) throw new Error('请选择当前故事中的选项');
  const score = journey.stats[choice.stat];
  const passed = score >= choice.requires;
  const dimension = choice.tone === 'warm' ? 'warmth' : 'courage';
  return {
    ...state,
    journey: {
      ...journey,
      [dimension]: journey[dimension] + (passed ? 2 : 1),
      pending: {
        text: passed ? choice.success : choice.failure,
        passed,
        choiceId,
        stat: choice.stat,
        score,
        requires: choice.requires,
        tone: choice.tone
      }
    }
  };
}

function continueJourney(state) {
  const journey = state.journey;
  if (!journey) throw new Error('当前没有进行中的旅程');
  if (!journey.pending) throw new Error('请先作出本幕的选择');
  const chapter = CHAPTERS.find((item) => item.id === journey.chapterId);
  if (journey.sceneIndex + 1 < chapter.scenes.length) {
    return {
      ...state,
      journey: { ...journey, sceneIndex: journey.sceneIndex + 1, pending: null }
    };
  }
  const tone = journey.warmth >= journey.courage ? 'warm' : 'brave';
  const ending = chapter.endings[tone];
  const firstClear = !state.cleared.includes(chapter.id);
  const tickets = firstClear ? 3 : 1;
  const chapterEndings = state.endings[chapter.id] || [];
  return {
    ...state,
    tickets: state.tickets + tickets,
    cleared: firstClear ? [...state.cleared, chapter.id] : state.cleared,
    endings: {
      ...state.endings,
      [chapter.id]: chapterEndings.includes(tone) ? chapterEndings : [...chapterEndings, tone]
    },
    journey: null,
    lastEnding: {
      chapterId: chapter.id,
      title: ending.title,
      text: ending.text,
      tickets,
      firstClear,
      keepsake: chapter.keepsake,
      tone
    }
  };
}

function assertStoryFields(state) {
  const check = (condition) => {
    if (!condition) throw new Error('存档内容不完整或已损坏，已保留原存档');
  };
  const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const integer = (value) => Number.isSafeInteger(value) && value >= 0;
  const text = (value) => typeof value === 'string' && value.length > 0;
  check(record(state));
  check(['tickets', 'drawCount', 'pitySSR', 'pityUR'].every((key) => integer(state[key])));
  check(state.pitySSR < 10 && state.pityUR < 40);
  check(record(state.collection));
  FAMILIES.forEach(({ id }) => {
    check(record(state.collection[id]));
    check(TIERS.every((tier) => integer(state.collection[id][tier])));
  });
  const validTeam = (ids) => Array.isArray(ids) && ids.length === 3 && new Set(ids).size === 3
    && ids.every((id) => FAMILIES.some((family) => family.id === id) && getFamily(state, id).owned);
  check(validTeam(state.team));
  check(Array.isArray(state.cleared) && state.cleared.length <= CHAPTERS.length);
  check(state.cleared.every((id, index) => CHAPTERS[index].id === id));
  check(record(state.endings) && Object.keys(state.endings).length === state.cleared.length);
  state.cleared.forEach((id) => {
    const endings = state.endings[id];
    check(Array.isArray(endings) && endings.length > 0 && endings.length <= 2);
    check(new Set(endings).size === endings.length && endings.every((tone) => tone === 'warm' || tone === 'brave'));
  });
  if (state.journey !== null) {
    const journey = state.journey;
    check(record(journey));
    const chapterIndex = CHAPTERS.findIndex((chapter) => chapter.id === journey.chapterId);
    check(chapterIndex >= 0 && chapterIndex <= state.cleared.length);
    const chapter = CHAPTERS[chapterIndex];
    check(integer(journey.sceneIndex) && journey.sceneIndex < chapter.scenes.length);
    check(integer(journey.warmth) && integer(journey.courage));
    check(validTeam(journey.team) && journey.team.every((id, index) => id === state.team[index]));
    check(record(journey.stats) && STATS.every((stat) => integer(journey.stats[stat])));
    check(state.lastEnding === null);
    if (journey.pending !== null) {
      const pending = journey.pending;
      check(record(pending));
      const choice = chapter.scenes[journey.sceneIndex].choices.find((item) => item.id === pending.choiceId);
      check(Boolean(choice));
      check(pending.stat === choice.stat && pending.tone === choice.tone && pending.requires === choice.requires);
      check(integer(pending.score) && pending.score === journey.stats[choice.stat]);
      check(pending.passed === (pending.score >= pending.requires) && text(pending.text));
    }
  }
  if (state.lastEnding !== null) {
    const ending = state.lastEnding;
    check(record(ending) && state.journey === null);
    check(state.cleared.includes(ending.chapterId) && state.endings[ending.chapterId].includes(ending.tone));
    check(typeof ending.firstClear === 'boolean' && ending.tickets === (ending.firstClear ? 3 : 1));
    check(text(ending.title) && text(ending.text) && text(ending.keepsake));
  }
  return state;
}

function assertState(state) {
  if (!state || state.version !== 2) throw new Error('存档内容不完整或已损坏，已保留原存档');
  assertStoryFields(state);
  assertAdventure(state.adventure, state);
  return state;
}

function migrateState(saved) {
  if (saved && saved.version === 1) {
    assertStoryFields(saved);
    // v1 没有冒险字段；遇到冲突数据时保留原档，不用默认值抹掉它。
    if (Object.prototype.hasOwnProperty.call(saved, 'adventure')) {
      throw new Error('旧存档包含无法迁移的冒险字段，已保留原存档');
    }
    return assertState({ ...saved, version: 2, adventure: createAdventureProfile() });
  }
  return assertState(saved);
}

module.exports = { createState, getFamily, getTeamStats, draw, saveTeam, startJourney, choose, continueJourney, assertState, migrateState };

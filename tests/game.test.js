const test = require('node:test');
const assert = require('node:assert/strict');
const { FAMILIES, TIERS, CHAPTERS } = require('../utils/content');
const { createState, getFamily, getTeamStats, draw, saveTeam, startJourney, choose, continueJourney, assertState } = require('../utils/game');

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function sequence(values) {
  let index = 0;
  return () => {
    assert.ok(index < values.length, '抽取不应多消耗随机数');
    return values[index++];
  };
}

function familyRoll(id) {
  return (FAMILIES.findIndex((family) => family.id === id) + 0.5) / FAMILIES.length;
}

function finishChapter(state, chapter, tone) {
  let next = startJourney(state, chapter.id);
  chapter.scenes.forEach((scene) => {
    const choice = scene.choices.find((item) => item.tone === tone);
    assert.ok(choice, `${scene.id} 必须包含 ${tone} 方向的选择`);
    next = continueJourney(choose(next, choice.id));
  });
  return next;
}

test('新存档有六张邮票、三位 R 伙伴和独立收藏', () => {
  const state = createState();
  assert.equal(state.version, 2);
  assert.equal(state.tickets, 6);
  assert.deepEqual(state.team, ['sheep', 'orangecat', 'nav']);
  assert.equal(Object.keys(state.collection).length, 22);
  assert.equal(FAMILIES.length, 22);
  assert.equal(Object.values(state.collection).reduce((sum, item) => sum + item.R, 0), 3);
  assert.equal(state.drawCount, 0);
  assert.equal(state.pitySSR, 0);
  assert.equal(state.pityUR, 0);
  assert.equal(state.journey, null);
  assert.equal(state.lastEnding, null);
  state.collection.sheep.R += 1;
  assert.equal(createState().collection.sheep.R, 1);
});

test('最高稀有度提供基础倍率，同款重复才加羁绊且最多三点', () => {
  const state = createState();
  state.collection.sheep = { R: 2, SR: 2, SSR: 1, UR: 1 };
  const family = FAMILIES.find((item) => item.id === 'sheep');
  const card = getFamily(freeze(state), 'sheep');
  assert.equal(card.owned, true);
  assert.equal(card.tier, 'UR');
  assert.equal(card.count, 6);
  assert.equal(card.bond, 2);
  for (const stat of ['heart', 'courage', 'insight']) {
    assert.equal(card.stats[stat], family.stats[stat] * 4 + (stat === family.trait ? 2 : 0));
  }
  assert.equal(card.image, '/assets/partners/sheep.png');
  assert.deepEqual(card.variants.map((item) => item.tier), TIERS);
  const next = createState();
  next.collection.sheep.R = 50;
  assert.equal(getFamily(next, 'sheep').bond, 3);
  const unseen = FAMILIES.find((item) => !next.team.includes(item.id));
  assert.equal(getFamily(next, unseen.id).owned, false);
  assert.equal(getFamily(next, unseen.id).tier, 'R');
  assert.equal(getFamily(next, unseen.id).bond, 0);
  assert.throws(() => getFamily(next, 'missing'), /没有找到/);
});

for (const [roll, tier] of [[0, 'R'], [0.599999, 'R'], [0.6, 'SR'], [0.879999, 'SR'], [0.88, 'SSR'], [0.979999, 'SSR'], [0.98, 'UR'], [0.999999, 'UR']]) {
  test(`抽取概率边界 ${roll} 得到 ${tier}`, () => {
    const state = freeze(createState());
    const result = draw(state, 1, sequence([roll, 0]));
    assert.equal(result.cards[0].tier, tier);
    assert.equal(result.state.tickets, 5);
    assert.equal(result.state.drawCount, 1);
    assert.equal(state.tickets, 6);
  });
}

test('第十抽保证 SSR 以上，SSR 重置十抽计数但保留 UR 计数', () => {
  const state = { ...createState(), tickets: 20, pitySSR: 8, pityUR: 8 };
  const first = draw(freeze(state), 1, () => 0).state;
  assert.equal(first.pitySSR, 9);
  const result = draw(freeze(first), 1, () => 0);
  assert.equal(result.cards[0].tier, 'SSR');
  assert.equal(result.state.pitySSR, 0);
  assert.equal(result.state.pityUR, 10);
});

test('SSR 保底时自然抽到 UR 不会被降级，两个计数都重置', () => {
  const state = { ...createState(), pitySSR: 9, pityUR: 20 };
  const result = draw(freeze(state), 1, sequence([0.99, 0]));
  assert.equal(result.cards[0].tier, 'UR');
  assert.equal(result.state.pitySSR, 0);
  assert.equal(result.state.pityUR, 0);
});

test('第四十抽 UR 保底优先于 SSR，五连内部连续计算保底', () => {
  const state = { ...createState(), pitySSR: 7, pityUR: 37 };
  const result = draw(freeze(state), 5, () => 0);
  assert.deepEqual(result.cards.map((item) => item.tier), ['R', 'R', 'UR', 'R', 'R']);
  assert.equal(result.state.pitySSR, 2);
  assert.equal(result.state.pityUR, 2);
  assert.equal(result.state.tickets, 1);
  assert.equal(result.state.drawCount, 5);
});

test('五连中的 SSR 保底在正确一抽触发', () => {
  const result = draw(freeze({ ...createState(), pitySSR: 7, pityUR: 17 }), 5, () => 0);
  assert.deepEqual(result.cards.map((item) => item.tier), ['R', 'R', 'SSR', 'R', 'R']);
  assert.equal(result.state.pitySSR, 2);
  assert.equal(result.state.pityUR, 22);
});

test('四十次低概率结果会每十抽 SSR，第四十抽 UR', () => {
  let state = { ...createState(), tickets: 40 };
  const tiers = [];
  for (let i = 0; i < 8; i += 1) {
    const result = draw(freeze(state), 5, () => 0);
    state = result.state;
    tiers.push(...result.cards.map((item) => item.tier));
  }
  assert.deepEqual(tiers.filter((tier) => tier !== 'R'), ['SSR', 'SSR', 'SSR', 'UR']);
  assert.equal(tiers[39], 'UR');
  assert.equal(state.tickets, 0);
  assert.equal(state.drawCount, 40);
});

test('家族均匀索引覆盖首尾，五连新伙伴与重复标记逐抽更新', () => {
  const state = createState();
  const unseen = FAMILIES.find((family) => !state.team.includes(family.id));
  const values = [0, familyRoll(unseen.id), 0, familyRoll(unseen.id), 0.7, familyRoll(unseen.id), 0, 0, 0, 0.999999];
  const result = draw(freeze(state), 5, sequence(values));
  assert.equal(result.cards[0].isNewFamily, true);
  assert.equal(result.cards[0].isNewVariant, true);
  assert.equal(result.cards[0].duplicate, false);
  assert.equal(result.cards[1].isNewFamily, false);
  assert.equal(result.cards[1].isNewVariant, false);
  assert.equal(result.cards[1].duplicate, true);
  assert.equal(result.cards[2].isNewFamily, false);
  assert.equal(result.cards[2].isNewVariant, true);
  assert.equal(result.cards[2].duplicate, false);
  assert.equal(result.cards[3].id, FAMILIES[0].id);
  assert.equal(result.cards[4].id, FAMILIES[FAMILIES.length - 1].id);
  assert.equal(result.state.collection[unseen.id].R, 2);
  assert.equal(result.state.collection[unseen.id].SR, 1);
  assert.equal(state.collection[unseen.id].R, 0);
});

test('余额不足、非法数量或随机数拒绝且不改原存档', () => {
  const state = freeze({ ...createState(), tickets: 4 });
  const before = JSON.stringify(state);
  let calls = 0;
  assert.throws(() => draw(state, 5, () => { calls += 1; return 0; }), /邮票不足/);
  assert.equal(calls, 0);
  for (const count of [0, -1, 2, 10, 1.5, '1', NaN]) {
    assert.throws(() => draw(state, count), /只能开启/);
  }
  assert.throws(() => draw(state, 1, null), /随机函数无效/);
  for (const value of [-0.1, 1, Infinity, NaN, '0.5']) {
    assert.throws(() => draw(state, 1, () => value), /随机数必须/);
  }
  assert.equal(JSON.stringify(state), before);
});

test('五连中途随机输入出错不会扣除邮票或写入部分抽取', () => {
  const state = freeze(createState());
  const before = JSON.stringify(state);
  assert.throws(() => draw(state, 5, sequence([0, 0, 0.99, 1])), /随机数必须/);
  assert.equal(JSON.stringify(state), before);
});

test('恰好三位不同的已拥有伙伴才能编队，输入和外部数组不被复用', () => {
  const state = freeze(createState());
  const ids = ['nav', 'sheep', 'orangecat'];
  const next = saveTeam(state, ids);
  assert.deepEqual(next.team, ids);
  ids.pop();
  assert.equal(next.team.length, 3);
  assert.deepEqual(state.team, ['sheep', 'orangecat', 'nav']);
  for (const invalid of [[], ['sheep'], ['sheep', 'sheep', 'nav'], null]) {
    assert.throws(() => saveTeam(state, invalid), /3 位不同/);
  }
  const unseen = FAMILIES.find((family) => !state.team.includes(family.id));
  assert.throws(() => saveTeam(state, ['sheep', 'nav', unseen.id]), /已经结识/);
  assert.throws(() => saveTeam(state, ['sheep', 'nav', 'missing']), /没有找到/);
});

test('队伍属性等于三位伙伴当前属性之和', () => {
  const state = freeze(createState());
  const expected = { heart: 0, courage: 0, insight: 0 };
  state.team.forEach((id) => {
    const family = getFamily(state, id);
    Object.keys(expected).forEach((stat) => { expected[stat] += family.stats[stat]; });
  });
  assert.deepEqual(getTeamStats(state), expected);
  assert.deepEqual(getTeamStats(state, [...state.team].reverse()), expected);
});

test('章节按顺序解锁，旅途中不能换队或另开，开始时清除旧结局', () => {
  const state = freeze({ ...createState(), lastEnding: { title: '旧结局' } });
  assert.equal(CHAPTERS.length, 4);
  assert.throws(() => startJourney(state, 'missing'), /没有找到/);
  for (const chapter of CHAPTERS.slice(1)) {
    assert.throws(() => startJourney(state, chapter.id), /前面的来信/);
  }
  const next = startJourney(state, CHAPTERS[0].id);
  assert.equal(next.lastEnding, null);
  assert.equal(next.journey.sceneIndex, 0);
  assert.deepEqual(next.journey.stats, getTeamStats(state));
  assert.notEqual(next.journey.team, state.team);
  assert.throws(() => saveTeam(next, state.team), /完成当前旅程/);
  assert.throws(() => startJourney(next, CHAPTERS[0].id), /完成当前旅程/);
});

test('选择用出发属性快照，及格含等号，结果按成功失败各自推进', () => {
  const chapter = CHAPTERS[0];
  const choice = chapter.scenes[0].choices[0];
  const started = startJourney(createState(), chapter.id);
  const exact = { ...started, journey: { ...started.journey, stats: { ...started.journey.stats, [choice.stat]: choice.requires } } };
  const passed = choose(freeze(exact), choice.id);
  assert.equal(passed.journey.pending.passed, true);
  assert.equal(passed.journey.pending.text, choice.success);
  assert.equal(passed.journey.pending.score, choice.requires);
  assert.equal(passed.journey.pending.requires, choice.requires);
  assert.equal(passed.journey[choice.tone === 'warm' ? 'warmth' : 'courage'], 2);
  const low = { ...started, journey: { ...started.journey, stats: { ...started.journey.stats, [choice.stat]: choice.requires - 1 } } };
  const failed = choose(freeze(low), choice.id);
  assert.equal(failed.journey.pending.passed, false);
  assert.equal(failed.journey.pending.text, choice.failure);
  assert.equal(failed.journey[choice.tone === 'warm' ? 'warmth' : 'courage'], 1);
  const next = continueJourney(freeze(failed));
  assert.equal(next.journey.sceneIndex, 1);
  assert.equal(next.journey.pending, null);
  assert.equal(failed.journey.sceneIndex, 0);
});

test('旅途中抽到高稀有卡不改变已经确定的属性快照', () => {
  const started = freeze(startJourney(createState(), CHAPTERS[0].id));
  const stats = { ...started.journey.stats };
  const next = draw(started, 1, sequence([0.99, familyRoll('sheep')])).state;
  assert.deepEqual(next.journey.stats, stats);
  assert.notDeepEqual(getTeamStats(next), stats);
});

test('未开旅程、未知选项、重复选项和跳过反馈都明确拒绝', () => {
  const state = freeze(createState());
  assert.throws(() => choose(state, 'a'), /开启一段旅程/);
  assert.throws(() => continueJourney(state), /没有进行中的旅程/);
  const started = freeze(startJourney(state, CHAPTERS[0].id));
  assert.throws(() => choose(started, 'missing'), /当前故事/);
  assert.throws(() => continueJourney(started), /先作出/);
  const selected = freeze(choose(started, CHAPTERS[0].scenes[0].choices[0].id));
  assert.throws(() => choose(selected, CHAPTERS[0].scenes[0].choices[1].id), /先读完/);
});

test('完整四章都可用初始队伍完成，首通各奖励三邮票', () => {
  let state = freeze(createState());
  CHAPTERS.forEach((chapter, index) => {
    assert.equal(chapter.scenes.length, 3);
    state = finishChapter(state, chapter, 'warm');
    assert.equal(state.journey, null);
    assert.equal(state.tickets, 6 + (index + 1) * 3);
    assert.equal(state.lastEnding.firstClear, true);
    assert.equal(state.lastEnding.tickets, 3);
    assert.equal(state.lastEnding.chapterId, chapter.id);
    assert.equal(state.lastEnding.tone, 'warm');
    assert.equal(state.lastEnding.title, chapter.endings.warm.title);
    assert.equal(state.lastEnding.text, chapter.endings.warm.text);
    assert.equal(state.lastEnding.keepsake, chapter.keepsake);
    assert.deepEqual(state.endings[chapter.id], ['warm']);
    freeze(state);
  });
  assert.deepEqual(state.cleared, CHAPTERS.map((chapter) => chapter.id));
  assert.throws(() => continueJourney(state), /没有进行中的旅程/);
});

test('重读奖励一邮票，可收集第二结局，通关和结局均去重', () => {
  const chapter = CHAPTERS[0];
  const warm = freeze(finishChapter(createState(), chapter, 'warm'));
  const brave = freeze(finishChapter(warm, chapter, 'brave'));
  assert.equal(brave.tickets, 10);
  assert.equal(brave.lastEnding.firstClear, false);
  assert.equal(brave.lastEnding.tickets, 1);
  assert.equal(brave.lastEnding.tone, 'brave');
  assert.equal(brave.lastEnding.title, chapter.endings.brave.title);
  assert.deepEqual(brave.cleared, [chapter.id]);
  assert.deepEqual(brave.endings[chapter.id], ['warm', 'brave']);
  const again = finishChapter(brave, chapter, 'brave');
  assert.equal(again.tickets, 11);
  assert.deepEqual(again.endings[chapter.id], ['warm', 'brave']);
  assert.deepEqual(warm.endings[chapter.id], ['warm']);
  assert.throws(() => continueJourney(again), /没有进行中的旅程/);
});

test('结局分数平手时走温柔结局', () => {
  const chapter = CHAPTERS[0];
  let state = startJourney(createState(), chapter.id);
  chapter.scenes.forEach((scene, index) => {
    state = choose(state, scene.choices[0].id);
    if (index === chapter.scenes.length - 1) {
      state = { ...state, journey: { ...state.journey, warmth: 3, courage: 3 } };
    }
    state = continueJourney(freeze(state));
  });
  assert.equal(state.lastEnding.tone, 'warm');
});

test('本地存档边界接受实际游戏每一步并返回原对象', () => {
  let state = freeze(createState());
  assert.equal(assertState(state), state);
  state = draw(state, 5, () => 0).state;
  assert.equal(assertState(freeze(state)), state);
  CHAPTERS.forEach((chapter) => {
    state = startJourney(state, chapter.id);
    assertState(freeze(state));
    chapter.scenes.forEach((scene) => {
      state = choose(state, scene.choices[0].id);
      assertState(freeze(state));
      state = continueJourney(state);
      assertState(freeze(state));
    });
  });
  assertState(freeze(finishChapter(state, CHAPTERS[0], 'brave')));
});

test('损坏数值、收藏、编队和结局存档拒绝，原数据保留', () => {
  const mutations = [
    (state) => { state.version = 99; },
    (state) => { delete state.tickets; },
    (state) => { state.tickets = -1; },
    (state) => { state.drawCount = 0.5; },
    (state) => { state.pitySSR = 10; },
    (state) => { state.pityUR = 40; },
    (state) => { state.tickets = Number.MAX_SAFE_INTEGER + 1; },
    (state) => { state.collection = null; },
    (state) => { delete state.collection.sheep.UR; },
    (state) => { state.collection.sheep.R = '1'; },
    (state) => { state.collection.sheep.R = -1; },
    (state) => { state.team = ['sheep', 'sheep', 'nav']; },
    (state) => { state.team[0] = 'missing'; },
    (state) => { state.collection.sheep.R = 0; },
    (state) => { state.cleared = [CHAPTERS[1].id]; },
    (state) => { state.endings = { missing: ['warm'] }; },
    (state) => { state.lastEnding = { chapterId: 'missing' }; },
    (state) => { delete state.journey; }
  ];
  mutations.forEach((mutate) => {
    const state = createState();
    mutate(state);
    const before = JSON.stringify(state);
    assert.throws(() => assertState(freeze(state)), /存档内容不完整或已损坏/);
    assert.equal(JSON.stringify(state), before);
  });
  for (const value of [null, undefined, [], 1]) {
    assert.throws(() => assertState(value), /存档内容不完整或已损坏/);
  }
});

test('损坏旅程、反馈和通关结局存档在载入时拒绝', () => {
  const chapter = CHAPTERS[0];
  const mutations = [
    (state) => { state.journey.chapterId = 'missing'; },
    (state) => { state.journey.chapterId = CHAPTERS[1].id; },
    (state) => { state.journey.sceneIndex = 3; },
    (state) => { state.journey.warmth = -1; },
    (state) => { state.journey.stats.heart = NaN; },
    (state) => { state.journey.team.reverse(); },
    (state) => { state.journey.pending = {}; },
    (state) => { state.journey.pending.choiceId = 'missing'; },
    (state) => { state.journey.pending.passed = !state.journey.pending.passed; },
    (state) => { state.journey.pending.score += 1; },
    (state) => { state.journey.pending.text = ''; }
  ];
  mutations.forEach((mutate) => {
    const state = choose(startJourney(createState(), chapter.id), chapter.scenes[0].choices[0].id);
    mutate(state);
    assert.throws(() => assertState(freeze(state)), /存档内容不完整或已损坏/);
  });
  const endingMutations = [
    (state) => { state.endings[chapter.id] = ['warm', 'warm']; },
    (state) => { state.endings[chapter.id] = ['missing']; },
    (state) => { state.lastEnding.tickets = 100; },
    (state) => { state.lastEnding.tone = 'brave'; },
    (state) => { state.lastEnding.title = null; }
  ];
  endingMutations.forEach((mutate) => {
    const state = finishChapter(createState(), chapter, 'warm');
    mutate(state);
    assert.throws(() => assertState(freeze(state)), /存档内容不完整或已损坏/);
  });
});

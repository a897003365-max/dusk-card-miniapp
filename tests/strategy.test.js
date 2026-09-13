const test = require('node:test');
const assert = require('node:assert/strict');
const combat = require('../utils/combat');
const game = require('../utils/game');
const { STREET_ENCOUNTERS, ENEMY_BY_ID, REGION_BY_ID, CARDS, CARD_BY_ID } = require('../utils/combat-content');
const clone = value => JSON.parse(JSON.stringify(value));
function start(seed = 42, difficulty = 0) {
  const state = game.createState();
  state.adventure.clears.street = [1, 1, 1];
  return combat.startExpedition(state, 'street', difficulty, seed).state;
}
function act(state, action) {
  const result = combat.applyAction(state, action);
  game.assertState(result.state);
  return result.state;
}
// 单元夹具仅定位已生成的节点；集成基准只使用公开操作。
function at(state, predicate) {
  const next = clone(state), run = next.adventure.active;
  const node = run.nodes.find(predicate); assert.ok(node);
  run.layer = node.index; run.phase = 'map';
  for (const item of run.nodes) { item.visited = item.index < run.layer; item.chosenId = item.visited ? item.options[0].id : null; }
  return act(next, { type: 'chooseNode', nodeId: node.options[0].id });
}
function putHand(state, id, ownerId) {
  const run = state.adventure.active;
  let card = run.deck.find(c => c.cardId === id && c.ownerId === ownerId);
  if (!card) { card = { uid: `card-${run.nextCardId++}`, cardId: id, ownerId, upgraded: false }; run.deck.push(card); }
  run.hand = [card.uid]; run.drawPile = run.deck.filter(c => c.uid !== card.uid).map(c => c.uid); run.discardPile = []; run.removed = []; run.energy = 4;
  return card;
}

test('邮街新局保持九站和单敌教学，随后普通与精英遭遇使用整场预算', () => {
  for (const seed of [42, 12345, 824596]) {
    const state = start(seed), run = state.adventure.active;
    assert.equal(run.nodes.length, 9);
    assert.ok(run.nodes[0].options.every(o => o.enemyIds.length === 1 && !o.encounterId));
    const ordinary = run.nodes.filter(n => n.type === 'battle');
    assert.deepEqual(ordinary.map(n => n.options[0].enemyIds.length), [1, 2, 3, 2]);
    const elite = run.nodes.find(n => n.type === 'elite');
    assert.ok(elite.options.every(o => o.enemyIds.length === 2));
    for (const node of [...ordinary.slice(1), elite]) {
      const battle = at(state, n => n.index === node.index).adventure.active;
      const spec = STREET_ENCOUNTERS[node.options[0].encounterId];
      assert.deepEqual(battle.enemies.map(e => e.maxHp), spec.units.map(u => u.hp));
      assert.ok(spec.units.reduce((sum,u) => sum + u.hp, 0) < spec.units.reduce((sum,u) => sum + ENEMY_BY_ID[u.id].maxHp, 0));
    }
  }
});

test('多敌人主动攻击预算、难度缩放与预览结算完全一致', () => {
  for (const difficulty of [0, 1, 2]) {
    const state = at(start(42, difficulty), n => n.options[0].encounterId === 'street-patrol');
    const before = JSON.stringify(state);
    const forecast = combat.previewAction(state, { type: 'endTurn' });
    const actual = combat.applyAction(state, { type: 'endTurn' });
    assert.deepEqual(forecast.events, actual.events);
    assert.equal(JSON.stringify(state), before);
    game.assertState(actual.state);
    const attack = actual.events.find(e => e.kind === 'enemyAction' && e.intentKind === 'attack');
    assert.equal(attack.intentTargets[0].amount, Math.ceil(6 * .75 * [1, 1.15, 1.3][difficulty]));
  }
});

test('群攻真实命中三目标，击杀小怪不会提前结算整场奖励', () => {
  const state = at(start(), n => n.options[0].encounterId === 'street-swarm');
  const run = state.adventure.active, card = putHand(state, 'street-sweep', run.party[0].id);
  run.enemies[0].hp = 1;
  const outcome = combat.applyAction(state, { type: 'playCard', cardUid: card.uid });
  assert.equal(outcome.events.filter(e => e.kind === 'damage' && e.targetId.startsWith('enemy-')).length, 3);
  assert.equal(outcome.events.filter(e => e.kind === 'defeat').length, 1);
  assert.equal(outcome.state.adventure.active.phase, 'battle');
  assert.equal(outcome.state.adventure.threads, state.adventure.threads);
  game.assertState(outcome.state);
});

test('存档拒绝伪造遭遇和生命预算；旧版单敌路线原样读取并继续', () => {
  const original = start();
  const legacy = clone(original), run = legacy.adventure.active, region = REGION_BY_ID.street;
  for (const node of run.nodes) for (let index = 0; index < node.options.length; index++) {
    const option = node.options[index]; delete option.encounterId;
    if (node.type === 'battle') option.enemyIds = [region.normalIds[(node.index + index) % region.normalIds.length]];
    if (node.type === 'elite') option.enemyIds = [region.eliteIds[index]];
  }
  const serialized = JSON.stringify(legacy);
  game.assertState(legacy);
  assert.equal(JSON.stringify(legacy), serialized);
  const opened = at(legacy, n => n.type === 'elite');
  assert.equal(opened.adventure.active.enemies.length, 1);
  act(opened, { type: 'endTurn' });
  for (const mutate of [
    s => { s.adventure.active.nodes.find(n => n.type === 'elite').options[0].encounterId = 'missing'; },
    s => { s.adventure.active.nodes.find(n => n.type === 'elite').options[0].enemyIds = ['paper-lion']; },
  ]) { const broken = clone(original); mutate(broken); assert.throws(() => game.assertState(broken), /损坏/); }
  const forged = at(start(), n => n.type === 'elite'); forged.adventure.active.enemies[0].maxHp += 1;
  assert.throws(() => game.assertState(forged), /损坏/);
});

function won(seed = 42) {
  const state = at(start(seed), n => n.index === 0), run = state.adventure.active;
  const card = putHand(state, 'strike', run.party[0].id);
  run.enemies[0].hp = 1; run.enemies[0].block = 0;
  return act(state, { type: 'playCard', cardUid: card.uid, targetId: run.enemies[0].id });
}
function openRefitAt(state, source) {
  state = at(state, n => n.type === source);
  return act(state, source === 'camp' ? { type: 'chooseRefit' } : { type: 'chooseEvent', choiceId: 'refit' });
}
function refitAction(state, uid = 'card-1') {
  const run = state.adventure.active, outgoing = run.deck.find(c => c.uid === uid);
  const choice = run.choices.find(c => c.cardId !== outgoing.cardId);
  assert.ok(choice);
  return { type: 'refitCard', choiceId: choice.uid, cardUid: uid, ownerId: run.party[1].id };
}

test('奖励固定三个不重复用途槽、保留战术牌并允许跨职业，不因查看或重开而重抽', () => {
  const roles = new Set();
  for (let seed = 1; seed <= 24; seed++) {
    const state = won(seed), run = state.adventure.active;
    assert.equal(run.phase, 'cardReward');
    assert.deepEqual(run.choices.map(c => c.rewardSlot), ['synergy', 'coverage', 'wildcard']);
    assert.equal(new Set(run.choices.map(c => c.cardId)).size, 3);
    assert.ok(run.choices.some(c => CARD_BY_ID[c.cardId].tactic));
    run.choices.forEach(c => roles.add(CARD_BY_ID[c.cardId].role));
    const before = JSON.stringify(state);
    const view = combat.getAdventureView(state);
    combat.getAdventureView(state);
    assert.deepEqual(combat.getAdventureView(clone(state)), view);
    assert.equal(JSON.stringify(state), before);
    assert.deepEqual(won(seed).adventure.active.choices, run.choices);
  }
  assert.ok(roles.size >= 3, '不能只出现一种职业');
});

test('通用牌归属在领取前可预览，确认后写入；非法归属或专属牌转交会拒绝', () => {
  const state = won(), run = state.adventure.active;
  const card = run.choices.find(c => !CARD_BY_ID[c.cardId].familyId); assert.ok(card);
  const ownerId = run.party.find(m => m.id !== card.ownerId).id;
  const before = JSON.stringify(state);
  const view = combat.getAdventureView(state, { [card.uid]: ownerId });
  const displayed = view.run.choices.find(c => c.uid === card.uid);
  assert.equal(displayed.ownerId, ownerId);
  assert.equal(displayed.ownerOptions.filter(o => o.selected).length, 1);
  assert.equal(JSON.stringify(state), before);
  const chosen = act(state, { type: 'chooseCard', choiceId: card.uid, ownerId });
  assert.equal(chosen.adventure.active.deck.at(-1).ownerId, ownerId);
  assert.equal(chosen.adventure.active.deck.length, 13);
  assert.throws(() => combat.applyAction(state, { type: 'chooseCard', choiceId: card.uid, ownerId: 'outsider' }), /本队/);
  assert.throws(() => combat.applyAction(chosen, { type: 'chooseCard', choiceId: card.uid }), /没有待领取/);
  const dedicated = clone(state);
  dedicated.adventure.active.choices[0].cardId = 'nav-compass';
  dedicated.adventure.active.choices[0].ownerId = 'nav';
  game.assertState(dedicated);
  assert.throws(() => combat.applyAction(dedicated, { type: 'chooseCard', choiceId: dedicated.adventure.active.choices[0].uid, ownerId: 'sheep' }), /专属牌/);
});

test('营地换牌一进一出，六张专属牌受保护，升级不继承且不兼得恢复或星线', () => {
  let state = at(start(), n => n.type === 'camp');
  state.adventure.active.deck[0].upgraded = true;
  state.adventure.active.party[0].hp -= 3;
  const hp = state.adventure.active.party.map(m => m.hp), threads = state.adventure.threads;
  state = act(state, { type: 'chooseRefit' });
  const snapshot = JSON.stringify(state);
  const view = combat.getAdventureView(state).run;
  assert.equal(view.replaceCards.length, 6);
  assert.ok(view.choices.every(c => !CARD_BY_ID[c.cardId].familyId));
  assert.deepEqual(combat.getAdventureView(clone(state)).run.choices, view.choices);
  assert.equal(JSON.stringify(state), snapshot);
  assert.throws(() => combat.applyAction(state, { type: 'chooseRefit' }), /只有营地/);
  assert.throws(() => combat.applyAction(state, { type: 'rest' }), /只有营地/);
  const action = refitAction(state);
  assert.throws(() => combat.applyAction(state, { ...action, cardUid: 'card-3' }), /非专属牌/);
  const next = act(state, action), run = next.adventure.active;
  assert.equal(run.deck.length, 12);
  assert.equal(run.deck[0].uid, 'card-1');
  assert.equal(run.deck[0].upgraded, false);
  assert.equal(run.deck[0].ownerId, run.party[1].id);
  assert.deepEqual(run.party.map(m => m.hp), hp);
  assert.equal(next.adventure.threads, threads);
  assert.equal(run.refits.length, 1);
  assert.throws(() => combat.applyAction(next, action), /没有可用/);
});

test('营地和奇遇各一次，可顺序改造同一通用牌；存档校验拒绝额外次数和伪造来源', () => {
  let state = start();
  const sources = state.adventure.active.nodes.filter(n => ['camp', 'event'].includes(n.type)).map(n => n.type);
  for (const source of sources) { state = openRefitAt(state, source); state = act(state, refitAction(state)); }
  const run = state.adventure.active;
  assert.equal(run.refits.length, 2);
  assert.deepEqual(run.refits.map(r => r.source), sources);
  assert.deepEqual(run.refits[1].before, run.refits[0].after);
  assert.equal(run.deck.length, 12);
  game.assertState(clone(state));
  // 后续正常升级不应被换牌记录误判为篡改。
  state.adventure.active.deck[0].upgraded = true; game.assertState(state);
  for (const mutate of [
    s => s.adventure.active.refits.push(clone(run.refits[0])),
    s => { s.adventure.active.refits[0].source = 'treasure'; },
    s => { s.adventure.active.refits[1].before.cardId = 'nav-compass'; },
    s => { s.adventure.active.refits[1].after.ownerId = 'outsider'; },
    s => { delete s.adventure.active.refits; },
    s => { s.adventure.active.refits = null; }
  ]) { const broken = clone(state); mutate(broken); assert.throws(() => game.assertState(broken), /损坏/); }
});

test('已选择换牌后跳过会消耗节点，不回退重抽；旧版无换牌字段的存档保持可读', () => {
  const old = start(); const before = JSON.stringify(old); game.assertState(old); assert.equal(JSON.stringify(old), before);
  for (const source of ['camp', 'event']) {
    const pending = openRefitAt(old, source), layer = pending.adventure.active.layer;
    const next = act(pending, { type: 'refitCard', choiceId: 'skip' });
    assert.equal(next.adventure.active.layer, layer + 1);
    assert.equal(next.adventure.active.deck.length, 12);
    assert.equal(next.adventure.active.refits, undefined);
    assert.equal(next.adventure.threads, pending.adventure.threads);
    assert.throws(() => combat.applyAction(next, { type: 'chooseNode', nodeId: pending.adventure.active.nodes[layer].chosenId }), /可达/);
  }
});

test('四种构筑提示来自真实卡牌效果；两张回响防护牌能够选择队友', () => {
  const { cardTags, analyzeDeck } = require('../utils/deck-strategy');
  assert.ok(cardTags({ cardId: 'street-sweep' }).includes('area'));
  assert.ok(cardTags({ cardId: 'orangecat-pounce' }).includes('multiHit'));
  const analysis = analyzeDeck(start().adventure.active.deck);
  assert.equal(analysis.builds.length, 4);
  assert.equal(analysis.costs.low + analysis.costs.middle + analysis.costs.high, 12);
  assert.match(analysis.note, /不是.*战力/);
  for (const id of ['nav-compass', 'blanket-quilt']) assert.equal(CARD_BY_ID[id].target, 'ally');
  const state = at(start(), n => n.index === 0), run = state.adventure.active;
  const card = putHand(state, 'nav-compass', 'nav');
  const result = combat.applyAction(state, { type: 'playCard', cardUid: card.uid, targetId: 'sheep' });
  assert.ok(result.events.some(e => e.kind === 'echo' && e.targetId === 'sheep'));
  game.assertState(result.state);
});

test('标记只统计实际增加的生命损失，护盾完全阻挡或溢出不虚增收益', () => {
  for (const [hp, block, gain] of [[20, 0, 2], [20, 30, 0], [1, 0, 0]]) {
    const state = at(start(), n => n.index === 0), run = state.adventure.active;
    const card = putHand(state, 'strike', run.party[0].id);
    run.enemies[0].hp = hp; run.enemies[0].block = block; run.enemies[0].status.mark = 1;
    const before = JSON.stringify(state);
    const action = { type: 'playCard', cardUid: card.uid, targetId: run.enemies[0].id };
    const preview = combat.previewAction(state, action, true), actual = combat.applyAction(state, action);
    assert.deepEqual(preview.events, actual.events); assert.equal(JSON.stringify(state), before);
    assert.equal(actual.state.adventure.active.battleStats.markHpDamage, gain);
    assert.match(preview.impactSummary, hp === 1 ? /本战结束/ : /立即结束的生命损失/);
    game.assertState(actual.state);
  }
});

test('留盾统计只计算跨回合护盾实际挡伤，并在新战斗清零', () => {
  let state = at(start(), n => n.index === 0), run = state.adventure.active;
  run.party[0].block = 10; run.party[0].status.retainBlock = 1;
  // 第一轮纸团攻击6，剩余4被留到下一回合，但还没有兑现留盾挡伤。
  state = act(state, { type: 'endTurn' });
  assert.equal(state.adventure.active.party[0].carriedBlock, 4);
  assert.equal(state.adventure.active.battleStats.retainedBlocked, 0);
  // 单元夹具把下一意图设为公开的攻击，验证实际消费而非生成值。
  state.adventure.active.enemies[0].intentIndex = 0;
  state.adventure.active.party[0].block += 3;
  state = act(state, { type: 'endTurn' });
  assert.equal(state.adventure.active.battleStats.retainedBlocked, 4);
  state = at(state, n => n.options[0].encounterId === 'street-patrol');
  assert.equal(state.adventure.active.battleStats.retainedBlocked, 0);
});

test('战斗统计在存档与重开中保留，老战局仅记录启用后的效果；非法统计拒绝', () => {
  const state = at(start(), n => n.options[0].encounterId === 'street-swarm'), run = state.adventure.active;
  delete run.battleStats;
  const card = putHand(state, 'street-sweep', run.party[0].id);
  let next = act(state, { type: 'playCard', cardUid: card.uid });
  assert.equal(next.adventure.active.battleStats.partial, true);
  assert.equal(next.adventure.active.battleStats.areaTargets, 3);
  const snapshot = JSON.stringify(next); combat.getAdventureView(next); assert.equal(JSON.stringify(next), snapshot);
  assert.deepEqual(combat.getAdventureView(clone(next)).run.battleStatLines, combat.getAdventureView(next).run.battleStatLines);
  next.adventure.active.battleStats.areaTargets = -1;
  assert.throws(() => game.assertState(next), /损坏/);
});

test('回合按钮预估包含本轮存蓄，且新预览不暴露发现或观星的候选', () => {
  const state = at(start(), n => n.index === 0), run = state.adventure.active;
  const view = combat.getAdventureView(state).run;
  const ended = combat.applyAction(state, { type: 'endTurn' }).state;
  assert.equal(view.nextEnergyIfEnd, ended.adventure.active.energy);
  const card = putHand(state, 'quick-sketch', run.party[0].id);
  const preview = combat.previewAction(state, { type: 'playCard', cardUid: card.uid }, true);
  assert.match(preview.impactSummary, /完成发现或观星/);
  assert.ok(!preview.impactSummary.includes('chance-'));
});

test('四个固定种子通过公开操作走完九站，营地与奇遇各完成一次换牌，逐步校验存档', () => {
  const { chooseFromView } = require('./helpers/adventure-policy');
  for (const seed of [42, 12345, 824596, 987654321]) {
    let state = start(seed), replacements = 0, steps = 0;
    while (state.adventure.active && steps++ < 1200) {
      const view = combat.getAdventureView(state).run;
      let action;
      if (view.phase === 'camp') action = { type: 'chooseRefit' };
      else if (view.phase === 'event') action = { type: 'chooseEvent', choiceId: 'refit' };
      else if (['campReplace', 'eventReplace'].includes(view.phase)) {
        // 仅使用公开可见的候选，不用隐藏牌序；选择一进一出且合法的组合。
        const incoming = view.choices[0], outgoing = view.replaceCards.find(c => c.cardId !== incoming.cardId);
        action = { type: 'refitCard', choiceId: incoming.uid, cardUid: outgoing.uid, ownerId: incoming.ownerId };
        replacements += 1;
      } else action = chooseFromView(view, candidate => combat.previewAction(state, candidate));
      const before = JSON.stringify(state);
      const result = combat.applyAction(state, action); game.assertState(result.state);
      assert.equal(JSON.stringify(state), before);
      state = clone(result.state); // 模拟每一步存储后恢复，随机进度、候选与换牌记录必须一致。
    }
    assert.ok(steps < 1200);
    assert.equal(replacements, 2);
    assert.equal(state.adventure.active, null);
    assert.equal(typeof state.adventure.lastResult.win, 'boolean');
  }
});

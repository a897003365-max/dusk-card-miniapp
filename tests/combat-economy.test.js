'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const combat = require('../utils/combat');
const { FAMILIES } = require('../utils/content');
const { CARDS, OPPORTUNITY_CARDS, CARD_BY_ID, ENEMY_BY_ID, REGIONS, BATTLE_RULES, STATUS_RULES } = require('../utils/combat-content');

const clone = value => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function fresh(team = ['sheep', 'orangecat', 'nav']) {
  const collection = {};
  FAMILIES.forEach(({ id }) => { collection[id] = { R: 1, SR: 0, SSR: 0, UR: 0 }; });
  const state = { version: 2, tickets: 6, collection, team, journey: null, adventure: combat.createAdventureProfile() };
  REGIONS.forEach(region => { state.adventure.clears[region.id] = [1, 1, 1]; });
  return state;
}
function battle(team, seed = 42) {
  let state = combat.startExpedition(fresh(team), 'street', 0, seed).state;
  const nodeId = state.adventure.active.nodes[0].options[0].id;
  return combat.applyAction(state, { type: 'chooseNode', nodeId }).state;
}
function allCards(run) { return [...run.deck, ...(run.temporaryCards || [])]; }
function addCard(run, cardId, ownerId) {
  const existing = allCards(run).find(card => card.cardId === cardId && card.ownerId === ownerId);
  if (existing) return existing;
  const card = { uid: `card-${run.nextCardId++}`, cardId, ownerId, upgraded: false };
  run.deck.push(card);
  return card;
}
function focusHand(run, cards) {
  const ids = new Set(cards.map(card => card.uid));
  const removed = new Set(run.removed);
  run.hand = cards.map(card => card.uid);
  run.discardPile = run.discardPile.filter(uid => !ids.has(uid));
  const discard = new Set(run.discardPile);
  run.drawPile = allCards(run).map(card => card.uid).filter(uid => !ids.has(uid) && !removed.has(uid) && !discard.has(uid));
}
function targetFor(run, card, allyId) {
  const target = CARD_BY_ID[card.cardId].target;
  if (target === 'enemy') return run.enemies.find(enemy => enemy.hp > 0).id;
  if (target === 'ally') return allyId || run.party.find(member => member.hp > 0).id;
  return undefined;
}
function play(state, card, allyId) {
  const action = { type: 'playCard', cardUid: card.uid };
  const targetId = targetFor(state.adventure.active, card, allyId);
  if (targetId !== undefined) action.targetId = targetId;
  return combat.applyAction(freeze(state), action);
}

test('存下的蓄能在下回合变成超额能量，4费牌可用完整能量支付', () => {
  for (const definition of CARDS.filter(card => card.cost === 4)) {
    let state = battle();
    state.adventure.active.enemies[0].hp = state.adventure.active.enemies[0].maxHp = 1000;
    state.adventure.active.energy = 1;
    state = combat.applyAction(state, { type: 'endTurn' }).state;
    const run = state.adventure.active;
    const card = addCard(run, definition.id, run.party[0].id);
    focusHand(run, [card]);
    assert.equal(run.charge, 0);
    assert.equal(run.energy, BATTLE_RULES.energyStart + 1);
    const shown = combat.getAdventureView(freeze(state)).run.hand[0];
    assert.equal(shown.cost, 4);
    assert.deepEqual(shown.payment, { energy: 4, charge: 0 });
    const result = play(state, card);
    assert.deepEqual(result.events.find(event => event.kind === 'playCard').payment, { energy: 4, charge: 0 });
    assert.equal(result.state.adventure.active.energy, 0);
    assert.equal(result.state.adventure.active.charge, 0);
  }

  let state = battle();
  state.adventure.active.energy = 0;
  state = combat.applyAction(state, { type: 'endTurn' }).state;
  state.adventure.active.energy = 0;
  state = combat.applyAction(state, { type: 'endTurn' }).state;
  assert.equal(state.adventure.active.turn, 3);
  assert.equal(state.adventure.active.energy, BATTLE_RULES.energyLate);
  assert.equal(combat.getAdventureView(state).run.nextEnergyRefill, BATTLE_RULES.energyLate);
});

test('蓄能不能在当前回合补差，会在下一回合释放且受上限限制', () => {
  const state = battle();
  const run = state.adventure.active;
  const card = addCard(run, 'express-finale', run.party[0].id);
  focusHand(run, [card]);
  run.energy = 1;
  run.charge = 1;
  const unavailable = combat.getAdventureView(freeze(clone(state))).run.hand[0];
  assert.equal(unavailable.playable, false);
  assert.match(unavailable.reason, /还差 3 点.*下回合释放/);
  run.energy = 2;
  run.charge = 2;
  assert.throws(() => play(clone(state), card), /能量不足/);
  run.energy = 0;
  const released = combat.applyAction(state, { type: 'endTurn' }).state;
  assert.equal(released.adventure.active.energy, BATTLE_RULES.energyStart + 2);
  assert.equal(released.adventure.active.charge, 0);
  const result = play(released, card);
  assert.deepEqual(result.events.find(event => event.kind === 'playCard').payment, { energy: 4, charge: 0 });
  assert.equal(result.state.adventure.active.energy, BATTLE_RULES.energyStart - 2);

  const capped = battle();
  capped.adventure.active.energy = 3;
  capped.adventure.active.charge = STATUS_RULES.maxCharge - 1;
  const ended = combat.applyAction(capped, { type: 'endTurn' });
  assert.equal(ended.state.adventure.active.charge, 0);
  assert.equal(ended.state.adventure.active.energy, BATTLE_RULES.energyStart + STATUS_RULES.maxCharge);
  assert.equal(ended.events.filter(event => event.kind === 'chargeBank').length, 1);
  assert.equal(ended.events.find(event => event.kind === 'chargeRelease').amount, STATUS_RULES.maxCharge);
});

test('零费环境牌不增加预算，改签固定付1且不计出牌或触发效果', () => {
  const state = battle();
  const run = state.adventure.active;
  const free = addCard(run, 'folded-corner', run.party[0].id);
  const stuck = addCard(run, 'express-finale', run.party[0].id);
  const replacement = run.deck.find(card => card.cardId === 'strike');
  focusHand(run, [free, stuck]);
  run.drawPile = run.drawPile.filter(uid => uid !== replacement.uid);
  run.drawPile.push(replacement.uid);
  const afterFree = play(state, free).state;
  assert.equal(afterFree.adventure.active.energy, BATTLE_RULES.energyStart);
  assert.equal(afterFree.adventure.active.charge, 0);
  assert.equal(afterFree.adventure.active.plays, 1);

  const hiddenA = clone(afterFree);
  const hiddenB = clone(afterFree);
  const pile = hiddenB.adventure.active.drawPile;
  [pile[pile.length - 1], pile[pile.length - 2]] = [pile[pile.length - 2], pile[pile.length - 1]];
  const tradeAction = { type: 'tradeCard', cardUid: stuck.uid };
  const previewA = combat.previewAction(freeze(hiddenA), tradeAction);
  const previewB = combat.previewAction(freeze(hiddenB), tradeAction);
  assert.deepEqual(previewA, previewB);
  assert.equal(Object.hasOwn(previewA.events.find(event => event.kind === 'tradeCard'), 'replacementUid'), false);
  const actualA = combat.applyAction(hiddenA, tradeAction);
  const actualB = combat.applyAction(hiddenB, tradeAction);
  assert.notEqual(actualA.events.find(event => event.kind === 'tradeCard').replacementUid, actualB.events.find(event => event.kind === 'tradeCard').replacementUid);

  const traded = combat.applyAction(freeze(afterFree), { type: 'tradeCard', cardUid: stuck.uid });
  assert.equal(traded.state.adventure.active.energy, BATTLE_RULES.energyStart - BATTLE_RULES.tradeCost);
  assert.equal(traded.state.adventure.active.charge, 0);
  assert.equal(traded.state.adventure.active.plays, 1);
  assert(traded.state.adventure.active.hand.includes(replacement.uid));
  assert.equal(traded.state.adventure.active.drawPile[0], stuck.uid);
  assert.equal(traded.events.some(event => ['environment', 'damage', 'block', 'thirdPlay'].includes(event.kind)), false);
  assert.deepEqual(traded.events.find(event => event.kind === 'tradeCard').payment, { energy: 1, charge: 0 });

  const blocked = clone(afterFree);
  blocked.adventure.active.drawPile = [];
  blocked.adventure.active.discardPile = [];
  const before = clone(blocked);
  assert.throws(() => combat.applyAction(blocked, { type: 'tradeCard', cardUid: stuck.uid }), /没有其他牌/);
  assert.deepEqual(blocked, before);
});

test('六张机会牌都是一次性实例，结算后不能回到抽弃牌区形成免费循环', () => {
  for (const definition of OPPORTUNITY_CARDS) {
    assert.equal(definition.effects.some(effect => ['discover', 'scout'].includes(effect.kind)), false);
    const state = battle();
    const run = state.adventure.active;
    const card = { uid: `card-${run.nextCardId++}`, cardId: definition.id, ownerId: run.party[0].id, upgraded: false };
    run.temporaryCards.push(card);
    focusHand(run, [card]);
    run.energy = BATTLE_RULES.energyLate;
    const result = play(state, card);
    const next = result.state.adventure.active;
    assert(next.removed.includes(card.uid), definition.id);
    assert.equal(next.hand.includes(card.uid) || next.drawPile.includes(card.uid) || next.discardPile.includes(card.uid), false, definition.id);
    assert.equal(next.pendingChoice, null, definition.id);
    combat.assertAdventure(result.state.adventure, result.state);
  }
});

test('发现候选提交后持久保存，预览不泄漏，临时牌随持有者倒下退场', () => {
  const state = battle();
  const run = state.adventure.active;
  const source = addCard(run, 'quick-sketch', run.party[0].id);
  focusHand(run, [source]);
  const preview = combat.previewAction(freeze(state), { type: 'playCard', cardUid: source.uid });
  assert(preview.allowed);
  for (const card of OPPORTUNITY_CARDS) {
    assert.equal(preview.summary.includes(card.id), false);
    assert.equal(preview.summary.includes(card.name), false);
  }

  const opened = play(state, source).state;
  assert(opened.adventure.active.removed.includes(source.uid));
  const pending = opened.adventure.active.pendingChoice;
  assert.equal(pending.kind, 'discover');
  assert.equal(pending.options.length, 3);
  assert.throws(() => combat.applyAction(opened, { type: 'endTurn' }), /先完成当前/);
  const saved = JSON.parse(JSON.stringify(opened));
  combat.assertAdventure(saved.adventure, saved);
  const beforeView = clone(saved);
  const choiceView = combat.getAdventureView(freeze(saved)).run.pendingChoice;
  assert.deepEqual(saved, beforeView);
  assert.deepEqual(choiceView.options.map(card => card.choiceId), pending.options);

  const choiceId = pending.options[0];
  const chosen = combat.applyAction(saved, { type: 'chooseOpportunity', choiceId }).state;
  const temporary = chosen.adventure.active.temporaryCards.find(card => card.cardId === choiceId);
  assert(temporary && chosen.adventure.active.hand.includes(temporary.uid));
  assert.equal(chosen.adventure.active.deck.some(card => card.uid === temporary.uid), false);
  chosen.adventure.active.party[0].hp = 1;
  chosen.adventure.active.party[0].block = 0;
  chosen.adventure.active.enemies[0].intentIndex = 0;
  const afterAttack = combat.applyAction(chosen, { type: 'endTurn' }).state;
  assert.equal(afterAttack.adventure.active.party[0].hp, 0);
  assert(afterAttack.adventure.active.removed.includes(temporary.uid));
  assert.equal(afterAttack.adventure.active.hand.includes(temporary.uid), false);
  assert.equal(afterAttack.adventure.active.discardPile.includes(temporary.uid), false);
  combat.assertAdventure(afterAttack.adventure, afterAttack);
});

test('观星候选暂离牌区并可重载，选择1张进手且其余回到牌底', () => {
  const state = battle();
  const run = state.adventure.active;
  const source = addCard(run, 'wax-spark', run.party[0].id);
  focusHand(run, [source]);
  const preview = combat.previewAction(freeze(state), { type: 'playCard', cardUid: source.uid });
  assert(preview.allowed);
  assert.equal(preview.summary.includes('card-'), false);
  const opened = play(state, source).state;
  assert(opened.adventure.active.removed.includes(source.uid));
  const pending = opened.adventure.active.pendingChoice;
  assert.equal(pending.kind, 'scout');
  assert.equal(pending.options.length, 3);
  for (const uid of pending.options) assert.equal(['hand', 'drawPile', 'discardPile', 'removed'].some(key => opened.adventure.active[key].includes(uid)), false);
  combat.assertAdventure(opened.adventure, opened);
  const view = combat.getAdventureView(freeze(opened)).run.pendingChoice;
  assert.deepEqual(view.options.map(card => card.choiceId), pending.options);
  const skipped = combat.applyAction(clone(opened), { type: 'chooseOpportunity', choiceId: 'skip' }).state.adventure.active;
  const skippedBottom = skipped.drawPile.slice(0, pending.options.length);
  assert.deepEqual([...skippedBottom].reverse(), pending.options);
  const selected = pending.options[0];
  const next = combat.applyAction(opened, { type: 'chooseOpportunity', choiceId: selected }).state;
  assert(next.adventure.active.hand.includes(selected));
  const remaining = pending.options.slice(1);
  const chosenBottom = next.adventure.active.drawPile.slice(0, remaining.length);
  assert.deepEqual([...chosenBottom].reverse(), remaining);
  combat.assertAdventure(next.adventure, next);
});

test('雨幕和顺风统一进入预览与执行，环境先于虚弱和标记计算', () => {
  for (const [environmentCardId, expected] of [['folded-corner', 4], ['paper-dart', 8]]) {
    let state = battle();
    let run = state.adventure.active;
    const environment = addCard(run, environmentCardId, run.party[0].id);
    focusHand(run, [environment]);
    state = play(state, environment).state;
    run = state.adventure.active;
    const strike = run.deck.find(card => card.cardId === 'strike' && card.ownerId === run.party[0].id);
    focusHand(run, [strike]);
    run.party[0].status.weak = 1;
    run.enemies[0].status.mark = 1;
    const action = { type: 'playCard', cardUid: strike.uid, targetId: run.enemies[0].id };
    const preview = combat.previewAction(freeze(state), action);
    const actual = combat.applyAction(freeze(state), action);
    assert.deepEqual(preview.events, actual.events);
    const environmentBase = expected;
    assert.equal(actual.events.find(event => event.kind === 'damage').amount, Math.floor(environmentBase * 0.75) + 2);
  }
});

test('拦截改写下一次单体攻击目标，全体攻击不被拦截', () => {
  let state = battle();
  let run = state.adventure.active;
  const source = addCard(run, 'sleeve-knot', run.party[0].id);
  focusHand(run, [source]);
  state = play(state, source, run.party[1].id).state;
  let view = combat.getAdventureView(freeze(state)).run;
  assert.equal(view.interceptorId, run.party[1].id);
  assert.equal(view.enemies[0].intentTargets[0].id, run.party[1].id);
  let ended = combat.applyAction(freeze(state), { type: 'endTurn' });
  assert(ended.events.some(event => event.kind === 'interceptConsume'));
  assert.equal(ended.events.find(event => event.kind === 'enemyAction').intentTargets[0].id, run.party[1].id);

  state = battle();
  run = state.adventure.active;
  const allAttack = run.enemies[0];
  allAttack.definitionId = 'postbag-guard';
  allAttack.maxHp = allAttack.hp = 42;
  allAttack.intentIndex = 2;
  const aoeSource = addCard(run, 'sleeve-knot', run.party[0].id);
  focusHand(run, [aoeSource]);
  state = play(state, aoeSource, run.party[1].id).state;
  view = combat.getAdventureView(freeze(state)).run;
  assert.equal(view.enemies[0].intentTargets.length, 3);
  ended = combat.applyAction(freeze(state), { type: 'endTurn' });
  assert.equal(ended.events.some(event => event.kind === 'interceptConsume'), false);
  assert.equal(ended.events.find(event => event.kind === 'enemyAction').intentTargets.length, 3);
  assert.equal(ended.state.adventure.active.interceptorId, null);

  state = battle();
  run = state.adventure.active;
  const front = run.enemies[0];
  front.definitionId = 'paper-ball';
  front.maxHp = front.hp = ENEMY_BY_ID['paper-ball'].maxHp;
  front.intentIndex = 0;
  const lowest = {
    id: `enemy-${run.nextEnemyId++}`, definitionId: 'stamp-moth', hp: ENEMY_BY_ID['stamp-moth'].maxHp,
    maxHp: ENEMY_BY_ID['stamp-moth'].maxHp, block: 0, status: { mark: 0, weak: 0, burn: 0, counter: 0, echo: 0, retainBlock: 0 }, phase: 1, intentIndex: 1
  };
  run.enemies.push(lowest);
  run.party[1].hp = 1;
  const selfGuard = addCard(run, 'sleeve-knot', run.party[0].id);
  focusHand(run, [selfGuard]);
  state = play(state, selfGuard, run.party[0].id).state;
  const unguarded = clone(state);
  unguarded.adventure.active.interceptorId = null;
  const naturalPlans = combat.getAdventureView(freeze(unguarded)).run.enemies;
  assert.equal(naturalPlans[0].intentTargets[0].id, run.party[0].id);
  assert.equal(naturalPlans[1].intentTargets[0].id, run.party[1].id);
  ended = combat.applyAction(freeze(state), { type: 'endTurn' });
  const actions = ended.events.filter(event => event.kind === 'enemyAction');
  const consume = ended.events.filter(event => event.kind === 'interceptConsume');
  assert.equal(consume.length, 1);
  assert.equal(consume[0].targetId, lowest.id);
  assert.equal(actions[0].intentTargets[0].id, run.party[0].id);
  assert.equal(actions[1].intentTargets[0].id, run.party[0].id);
});

test('净化逐类扣层、破盾不算伤害，久战压力由预览与执行共用', () => {
  let state = battle();
  let run = state.adventure.active;
  run.party[0].status = { ...run.party[0].status, burn: 2, weak: 2, mark: 2 };
  const cleanse = addCard(run, 'address-label', run.party[0].id);
  focusHand(run, [cleanse]);
  let result = play(state, cleanse, run.party[0].id);
  assert.deepEqual(result.events.find(event => event.kind === 'cleanse').deltas, { burn: 1, weak: 1, mark: 1 });

  state = battle();
  run = state.adventure.active;
  run.enemies[0].block = 7;
  const breach = addCard(run, 'loose-thread', run.party[0].id);
  focusHand(run, [breach]);
  result = play(state, breach);
  assert.equal(result.events.find(event => event.kind === 'stripBlock').blockDelta, -5);
  assert.equal(result.events.some(event => event.kind === 'damage'), false);

  state = battle();
  run = state.adventure.active;
  const baseline = clone(state);
  baseline.adventure.active.turn = BATTLE_RULES.pressureTurn - 1;
  const baseAmount = combat.getAdventureView(freeze(baseline)).run.enemies[0].intentTargets[0].amount;
  run.turn = BATTLE_RULES.pressureTurn;
  run.energy = 0;
  const before = clone(state);
  const pressureView = combat.getAdventureView(freeze(state)).run;
  assert.deepEqual(state, before);
  assert.equal(pressureView.pressure, 1);
  const previewAmount = pressureView.enemies[0].intentTargets[0].amount;
  assert.equal(previewAmount, baseAmount + 1);
  result = combat.applyAction(freeze(state), { type: 'endTurn' });
  assert.equal(result.events.find(event => event.kind === 'enemyAction').intentTargets[0].amount, previewAmount);
});

test('实际治疗为0不触发治疗被动', () => {
  const state = battle(['soup', 'orangecat', 'nav']);
  const run = state.adventure.active;
  const ladle = run.deck.find(card => card.cardId === 'soup-ladle');
  focusHand(run, [ladle]);
  const result = play(state, ladle, 'soup');
  assert.equal(result.events.find(event => event.kind === 'heal').amount, 0);
  assert.equal(result.events.some(event => event.kind === 'passive' && event.actorId === 'soup'), false);
  assert.equal(result.state.adventure.active.energy, BATTLE_RULES.energyStart - 2);
});


test('回响补刀属于本次卡牌击倒，会触发击倒被动但不会连锁重复', () => {
  const state = battle(['cloudmail', 'sheep', 'nav']);
  const run = state.adventure.active;
  const card = run.deck.find(item => item.ownerId === 'cloudmail' && item.cardId === 'strike');
  focusHand(run, [card]); run.party[0].status.echo = 1;
  run.enemies[0].hp = 8; run.enemies[0].block = 0;
  const result = play(state, card);
  assert.equal(result.events.filter(event => event.kind === 'defeat').length, 1);
  assert.equal(result.events.filter(event => event.kind === 'passive' && event.actorId === 'cloudmail').length, 1);
  assert(result.events.some(event => event.kind === 'draw' && event.actorId === 'cloudmail'));
  assert.equal(result.state.adventure.active.phase, 'cardReward');
});

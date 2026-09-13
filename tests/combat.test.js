const test = require('node:test');
const assert = require('node:assert/strict');
const combat = require('../utils/combat');
const { FAMILIES, TIERS } = require('../utils/content');
const content = require('../utils/combat-content');
const { FIGHTERS, CARDS, CARD_BY_ID, ENEMY_BY_ID, RELICS, REGIONS, BATTLE_RULES } = content;

const clone = value => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function fresh(team = ['sheep', 'orangecat', 'nav']) {
  const collection = {};
  FAMILIES.forEach(({ id }) => { collection[id] = { R: 1, SR: 0, SSR: 0, UR: 0 }; });
  return { version: 2, tickets: 6, collection, team, journey: null, adventure: combat.createAdventureProfile() };
}
function start(team, seed = 42, difficulty = 0, region = 'street') {
  const state = fresh(team);
  REGIONS.forEach(item => { state.adventure.clears[item.id] = [1, 1, 1]; });
  return combat.startExpedition(state, region, difficulty, seed).state;
}
function battle(team, seed = 42, difficulty = 0) {
  const state = start(team, seed, difficulty);
  return act(state, { type: 'chooseNode', nodeId: state.adventure.active.nodes[0].options[0].id });
}
function act(state, action) { return combat.applyAction(state, action).state; }
function putHand(state, cardId, ownerId, upgraded = false) {
  const run = state.adventure.active;
  let card = run.deck.find(item => item.cardId === cardId && item.ownerId === ownerId);
  if (!card) { card = { uid: `card-${run.nextCardId++}`, cardId, ownerId, upgraded }; run.deck.push(card); }
  card.upgraded = upgraded;
  run.hand = [card.uid];
  run.drawPile = run.deck.filter(item => item.uid !== card.uid && !run.removed.includes(item.uid)).map(item => item.uid);
  run.discardPile = [];
  run.energy = 3;
  return card;
}
function targetFor(state, card) {
  const run = state.adventure.active;
  if (CARD_BY_ID[card.cardId].target === 'enemy') return run.enemies.find(enemy => enemy.hp > 0).id;
  if (CARD_BY_ID[card.cardId].target === 'ally') return run.party.find(member => member.hp > 0).id;
  return undefined;
}
function forcedWin(state) {
  let next = clone(state);
  for (let count = 0; count < 8 && next.adventure.active && next.adventure.active.phase === 'battle'; count += 1) {
    const run = next.adventure.active;
    const owner = run.party.find(member => member.hp > 0);
    const card = putHand(next, 'strike', owner.id);
    const enemy = run.enemies.find(item => item.hp > 0);
    enemy.hp = 1; enemy.block = 0;
    next = act(next, { type: 'playCard', cardUid: card.uid, targetId: enemy.id });
  }
  return next;
}
function finishForced(state) {
  let next = clone(state);
  while (next.adventure.active) {
    const view = combat.getAdventureView(next).run;
    if (view.phase === 'map') next = act(next, { type: 'chooseNode', nodeId: view.nodes[view.layer].options[0].id });
    else if (view.phase === 'battle') next = forcedWin(next);
    else if (view.phase === 'cardReward') next = act(next, { type: 'chooseCard', choiceId: 'skip' });
    else if (view.phase === 'relicReward') next = act(next, { type: 'chooseRelic', choiceId: view.choices[0].id });
    else if (view.phase === 'event') next = act(next, { type: 'chooseEvent', choiceId: view.choices[0].id });
    else if (view.phase === 'camp') next = act(next, { type: 'rest' });
    else next = act(next, { type: 'upgradeCard', cardUid: view.choices[0].uid });
    combat.assertAdventure(next.adventure, next);
  }
  return next;
}

function jumpToNode(state, type, option = 0) {
  const run = state.adventure.active;
  run.layer = run.nodes.findIndex(node => node.type === type);
  run.nodes.forEach((node, index) => {
    node.visited = index < run.layer;
    node.chosenId = index < run.layer ? node.options[0].id : null;
  });
  run.phase = 'map';
  return act(state, { type: 'chooseNode', nodeId: run.nodes[run.layer].options[option].id });
}

// 复跑平衡模拟：node --test --test-name-pattern='三支1级R' tests/combat.test.js
// 只使用公开动作的有界策略模拟；不注入手牌、伤害、余额或敌人生命。
function simulateRun(team, seed, tacticId = 'classic') {
  let state = combat.startExpedition(fresh(team), 'street', 0, seed, tacticId).state;
  const battles = [];
  const preferredRelics = ['tea-token', 'paper-lantern', 'glass-star', 'copper-windbell', 'ticket-punch', 'rush-stamp'];
  for (let step = 0; state.adventure.active && step < 1200; step += 1) {
    const run = state.adventure.active;
    const view = combat.getAdventureView(state).run;
    let action;
    if (view.pendingChoice) action = { type: 'chooseOpportunity', choiceId: view.pendingChoice.options[0].choiceId };
    else if (view.phase === 'map') action = { type: 'chooseNode', nodeId: view.nodes[view.layer].options[0].id };
    else if (view.phase === 'battle') {
      const candidates = [];
      for (const card of view.hand.filter(item => item.playable)) {
        const targets = card.target === 'enemy' ? view.enemies.map(item => item.id) : card.target === 'ally' ? view.party.filter(item => !item.down).map(item => item.id) : [undefined];
        for (const targetId of targets) {
          const choice = { type: 'playCard', cardUid: card.uid, targetId };
          const outcome = combat.previewAction(state, choice);
          let score = 0;
          for (const event of outcome.events) {
            const enemy = event.targetId && event.targetId.startsWith('enemy-');
            if (['damage', 'echo'].includes(event.kind) && enemy) score += event.amount;
            if (event.kind === 'burn' && enemy) score += event.amount * 1.6;
            if (event.kind === 'mark' && enemy) score += event.amount * 1.4;
            if (event.kind === 'heal') score += event.amount * 0.6;
            if (event.kind === 'block') {
              const threatened = view.enemies.some(item => item.intentTargets.some(target => target.id === event.targetId && target.hpLoss > 0));
              score += Math.min(event.amount, 12) * (threatened ? 0.45 : 0.05);
            }
            if (event.kind === 'draw') score += event.amount * 1.7;
            if (event.kind === 'energy') score += event.amount * 3;
            if (event.kind === 'echo' && !enemy) score += 2;
            if (event.kind === 'bossPhase') score += 20;
            if (event.kind === 'defeat') score += 10;
          }
          candidates.push({ action: choice, score });
        }
      }
      candidates.sort((a, b) => b.score - a.score);
      if (candidates.length) action = candidates[0].action;
      else action = { type: 'endTurn' };
    } else if (view.phase === 'cardReward') {
      const candidates = view.choices.map(card => ({ card, score: CARD_BY_ID[card.cardId].effects.reduce((sum, item) => sum + (item.kind === 'damage' ? item.amount : item.kind === 'burn' ? item.amount * 2 : 0), 0) / Math.max(1, card.cost) })).sort((a, b) => b.score - a.score);
      action = { type: 'chooseCard', choiceId: candidates[0].score >= 4 ? candidates[0].card.uid : 'skip' };
    } else if (view.phase === 'relicReward') action = { type: 'chooseRelic', choiceId: (view.choices.find(item => preferredRelics.includes(item.id)) || view.choices[0]).id };
    else if (view.phase === 'event') action = { type: 'chooseEvent', choiceId: view.choices[0].id };
    else if (view.phase === 'camp') action = { type: 'rest' };
    else action = { type: 'upgradeCard', cardUid: view.choices[0].uid };
    state = combat.applyAction(state, action).state;
    if (run.phase === 'battle' && (!state.adventure.active || state.adventure.active.phase !== 'battle')) battles.push({ type: run.nodes[run.layer].type, turns: run.turn });
    combat.assertAdventure(state.adventure, state);
  }
  assert.equal(state.adventure.active, null, '策略模拟必须在有限动作内结束');
  return { team, seed, tacticId, win: state.adventure.lastResult.win, battles };
}

test('出发固定三人、12张起始牌和九节点，同种子产生相同路线与首手', () => {
  const state = freeze(fresh());
  const first = combat.startExpedition(state, 'street', 0, 42);
  const second = combat.startExpedition(state, 'street', 0, 42);
  assert.deepEqual(first, second);
  assert.equal(state.adventure.active, null);
  const run = first.state.adventure.active;
  assert.equal(run.deck.length, 12);
  assert.equal(run.nodes.length, 9);
  assert.equal(run.nodes.filter(node => node.type === 'battle').length, 4);
  for (const type of ['elite', 'event', 'camp', 'treasure', 'boss']) assert.equal(run.nodes.filter(node => node.type === type).length, 1);
  const opened = act(freeze(first.state), { type: 'chooseNode', nodeId: run.nodes[0].options[0].id });
  assert.equal(opened.adventure.active.hand.length, 5);
  assert.equal(opened.adventure.active.energy, 3);
  assert.ok(opened.adventure.active.party.every(member => member.block === 3), '战斗开始的羊护盾必须留在首回合');
  combat.assertAdventure(opened.adventure, opened);
});

test('可选起手战术按队伍顺序只替换三张基础攻击，预览使用伙伴真实等级数值', () => {
  const state = fresh();
  state.adventure.levels.sheep = 3;
  state.collection.sheep.SSR = 1;
  const view = combat.getAdventureView(freeze(state));
  assert.deepEqual(view.tactics.map(item => item.id), ['classic', 'relay', 'reserve', 'weather']);
  assert.deepEqual(view.tactics[0].cards, []);
  assert.deepEqual(view.tactics[1].cards.map(card => card.id), ['quick-sketch', 'wind-up-stamp', 'express-finale']);
  assert.deepEqual(view.tactics[1].cards.map(card => card.ownerName), ['羊咩咩团', '橘猫豆包', '领航小鸭']);
  assert.match(view.tactics[1].cards[1].description, /伤害 6/);
  assert.equal(view.tactics[1].cards[2].cost, 4);

  for (const [tacticId, replacements] of [['relay', ['quick-sketch', 'wind-up-stamp', 'express-finale']], ['reserve', ['wax-spark', 'dusk-ledger', 'lantern-storm']], ['weather', ['folded-corner', 'stamped-route', 'express-finale']]]) {
    const begun = combat.startExpedition(freeze(state), 'street', 0, 42, tacticId).state;
    const run = begun.adventure.active;
    assert.equal(run.deck.length, 12);
    assert.equal(run.tacticId, tacticId);
    assert.deepEqual(run.party.map(member => run.deck.find(card => card.ownerId === member.id && replacements.includes(card.cardId)).cardId), replacements);
    assert.equal(run.deck.some(card => card.cardId === 'strike'), false);
    assert.equal(run.deck.filter(card => card.cardId === 'guard').length, 3);
    assert.equal(run.deck.filter(card => CARD_BY_ID[card.cardId].familyId).length, 6);
  }
});

test('区域和难度顺序解锁，主线在途/重复出发/无效seed均拒绝', () => {
  const state = freeze(fresh());
  assert.throws(() => combat.startExpedition(state, 'bridge', 0, 1), /前一区域/);
  assert.throws(() => combat.startExpedition(state, 'street', 1, 1), /前一难度/);
  assert.throws(() => combat.startExpedition(state, 'street', 3, 1), /副本难度/);
  assert.throws(() => combat.startExpedition(state, 'missing', 0, 1), /这片区域/);
  assert.throws(() => combat.startExpedition(state, 'street', 0, 1, 'missing'), /起手战术/);
  for (const seed of [0, -1, 1.5, 0x100000000, '42']) assert.throws(() => combat.startExpedition(state, 'street', 0, seed), /32 位/);
  assert.throws(() => combat.startExpedition({ ...state, journey: {} }, 'street', 0, 1), /当前/);
  assert.throws(() => combat.startExpedition(start(), 'street', 0, 1), /当前/);
});

test('SSR/UR开局仅一次专属牌升级，稀有度数值不超过12%', () => {
  const state = fresh();
  state.collection.sheep.SSR = 1;
  state.collection.nav.UR = 1;
  const begun = combat.startExpedition(freeze(state), 'street', 0, 2).state;
  const view = combat.getAdventureView(begun).run;
  assert.equal(view.phase, 'startingUpgrade');
  assert.equal(view.choices.length, 4);
  assert.ok(view.choices.every(card => CARD_BY_ID[card.cardId].familyId && ['sheep', 'nav'].includes(card.ownerId)));
  assert.throws(() => act(begun, { type: 'chooseNode', nodeId: 'node-0-0' }), /当前节点/);
  const next = act(freeze(begun), { type: 'upgradeCard', cardUid: view.choices[0].uid });
  assert.equal(next.adventure.active.phase, 'map');
  assert.equal(next.adventure.active.layer, 0);
  assert.equal(next.adventure.active.deck.filter(card => card.upgraded).length, 1);
  assert.throws(() => act(next, { type: 'upgradeCard', cardUid: view.choices[1].uid }), /不能升级/);
  for (const member of next.adventure.active.party) assert.ok(member.maxHp / FIGHTERS[member.id].maxHp <= 1.12);
});

test('执行和预览使用同一结算，预览不会消耗RNG或修改存档', () => {
  const state = battle();
  const card = putHand(state, 'orangecat-sidestep', 'orangecat');
  const action = { type: 'playCard', cardUid: card.uid, targetId: state.adventure.active.enemies[0].id };
  const before = clone(state);
  const preview = combat.previewAction(freeze(state), action);
  const result = combat.applyAction(state, action);
  assert.equal(preview.allowed, true);
  assert.deepEqual(preview.events, result.events);
  assert.deepEqual(state, before);
  assert.equal(combat.previewAction(state, { ...action, targetId: 'wrong' }).allowed, false);
  assert.equal(state.adventure.active.rng, before.adventure.active.rng);
});

test('手牌UID和目标实例ID严格校验，同张牌不能重复打出', () => {
  const state = battle();
  const card = putHand(state, 'strike', 'sheep');
  const action = { type: 'playCard', cardUid: card.uid, targetId: state.adventure.active.enemies[0].id };
  assert.throws(() => act(state, { ...action, cardUid: 'strike' }), /不在当前手牌/);
  assert.throws(() => act(state, { ...action, targetId: 'paper-ball' }), /仍在场的敌人/);
  const next = act(freeze(state), action);
  assert.throws(() => act(next, action), /不在当前手牌/);
  assert.equal(next.adventure.active.energy, 2);
  const poor = clone(state); poor.adventure.active.energy = 0;
  assert.throws(() => act(poor, action), /能量不足/);
});

test('74张永久牌基础与升级效果均通过实际resolver', () => {
  const kinds = new Set();
  for (const definition of CARDS) {
    for (const upgraded of [false, true]) {
      const owner = definition.familyId || 'sheep';
      const team = [owner, ...FAMILIES.map(item => item.id).filter(id => id !== owner).slice(0, 2)];
      const state = battle(team);
      const run = state.adventure.active;
      run.enemies[0].hp = run.enemies[0].maxHp = 1000;
      run.party.forEach(member => { member.hp = member.maxHp - 10; });
      const card = putHand(state, definition.id, owner, upgraded);
      if (definition.effects.some(item => item.minPlays)) run.plays = 2;
      if (definition.cost > run.energy) run.energy = definition.cost;
      const action = { type: 'playCard', cardUid: card.uid, targetId: targetFor(state, card) };
      const result = combat.applyAction(freeze(state), action);
      const effects = upgraded ? definition.upgradeEffects : definition.effects;
      for (const item of effects) {
        kinds.add(item.kind);
        assert.ok(result.events.some(event => event.kind === item.kind), `${definition.id} ${upgraded ? '+' : ''} 缺少 ${item.kind} 真实效果`);
      }
      assert.ok(result.state.adventure.active.hand.length <= 8);
      assert.equal(state.adventure.active.hand.length, 1);
    }
  }
  assert.equal(CARDS.length, 74);
  assert.deepEqual(kinds, new Set(CARDS.flatMap(card => card.effects.map(item => item.kind))));
});

test('零费发现先提交消耗并锁定选择，完成选择后才能继续行动', () => {
  const state = battle();
  const sketch = putHand(state, 'quick-sketch', 'sheep');
  const first = combat.applyAction(freeze(state), { type: 'playCard', cardUid: sketch.uid });
  assert(first.events.some(event => event.kind === 'discover'));
  assert(first.state.adventure.active.removed.includes(sketch.uid));
  assert(!first.state.adventure.active.discardPile.includes(sketch.uid));
  assert.throws(() => act(first.state, { type: 'endTurn' }), /先完成当前/);
  const choiceId = first.state.adventure.active.pendingChoice.options[0];
  const chosen = act(freeze(first.state), { type: 'chooseOpportunity', choiceId });
  assert.equal(chosen.adventure.active.pendingChoice, null);
  assert(chosen.adventure.active.hand.some(uid => chosen.adventure.active.temporaryCards.some(card => card.uid === uid && card.cardId === choiceId)));
  combat.assertAdventure(chosen.adventure, chosen);
});

test('未用能量转为蓄能并在下回合变成超额能量，高费牌只支付当前能量', () => {
  let state = battle();
  state.adventure.active.energy = 1;
  state = act(freeze(state), { type: 'endTurn' });
  assert.equal(state.adventure.active.charge, 0);
  assert.equal(state.adventure.active.energy, BATTLE_RULES.energyStart + 1);
  const card = putHand(state, 'express-finale', 'nav');
  state.adventure.active.charge = 2;
  state.adventure.active.energy = 2;
  const view = combat.getAdventureView(state).run;
  assert.equal(view.hand.find(item => item.uid === card.uid).cost, 4);
  assert.equal(view.hand.find(item => item.uid === card.uid).playable, false);
  state.adventure.active.energy = 0;
  state = act(freeze(state), { type: 'endTurn' });
  assert.equal(state.adventure.active.energy, BATTLE_RULES.energyLate + 2);
  const fired = combat.applyAction(freeze(state), { type: 'playCard', cardUid: card.uid, targetId: state.adventure.active.enemies[0].id });
  assert.equal(fired.state.adventure.active.charge, 0);
  assert.equal(fired.state.adventure.active.energy, BATTLE_RULES.energyLate - 2);
  assert.deepEqual(fired.events.find(event => event.kind === 'playCard').payment, { energy: 4, charge: 0 });
});

test('旧活动存档缺少战术与战斗临时字段仍只读兼容，动作后补齐', () => {
  const state = battle();
  delete state.adventure.active.charge;
  delete state.adventure.active.tacticId;
  delete state.adventure.active.environmentId;
  delete state.adventure.active.interceptorId;
  delete state.adventure.active.pendingChoice;
  delete state.adventure.active.temporaryCards;
  assert.equal(combat.assertAdventure(state.adventure, state), state.adventure);
  const view = combat.getAdventureView(freeze(state));
  assert.equal(view.run.charge, 0);
  assert.equal(view.run.tacticName, '稳妥出发');
  const next = act(freeze(state), { type: 'endTurn' });
  assert.equal(next.adventure.active.charge, 0);
  assert.equal(next.adventure.active.tacticId, 'classic');
  assert.equal(next.adventure.active.environmentId, null);
  assert.equal(next.adventure.active.interceptorId, null);
  assert.equal(next.adventure.active.pendingChoice, null);
  assert.deepEqual(next.adventure.active.temporaryCards, []);
});

test('普通战后奖励固定含一张可实际获得的新战术牌', () => {
  const rewarded = forcedWin(battle());
  const choices = rewarded.adventure.active.choices;
  assert.equal(choices.length, 3);
  assert(choices.some(card => CARD_BY_ID[card.cardId].tactic));
  const choice = choices.find(card => CARD_BY_ID[card.cardId].tactic);
  const next = act(freeze(rewarded), { type: 'chooseCard', choiceId: choice.uid });
  assert(next.adventure.active.deck.some(card => card.uid === choice.uid && CARD_BY_ID[card.cardId].tactic));
});

test('标记逐次消耗、虚弱降主动伤害、回响只追加首个伤害效果', () => {
  const state = battle();
  const run = state.adventure.active;
  const enemy = run.enemies[0]; enemy.hp = enemy.maxHp = 100;
  enemy.status.mark = 3;
  run.party[1].status.echo = 1;
  run.party[1].status.weak = 1;
  const card = putHand(state, 'orangecat-pounce', 'orangecat');
  const result = combat.applyAction(freeze(state), { type: 'playCard', cardUid: card.uid, targetId: enemy.id });
  assert.deepEqual(result.events.filter(event => ['damage', 'echo'].includes(event.kind)).map(event => event.amount), [4, 3, 4]);
  assert.equal(result.state.adventure.active.enemies[0].status.mark, 0);
  assert.equal(result.state.adventure.active.party[1].status.echo, 0);
  assert.equal(result.events.filter(event => event.kind === 'passive').length, 1);
});

test('生命变化字段区分直接伤害、回响、灼烧扣血、治疗与状态施加', () => {
  const attacking = battle();
  attacking.adventure.active.party[0].status.echo = 1;
  const strike = putHand(attacking, 'strike', 'sheep');
  const hit = combat.applyAction(freeze(attacking), { type: 'playCard', cardUid: strike.uid, targetId: attacking.adventure.active.enemies[0].id });
  assert.equal(hit.events.find(event => event.kind === 'damage').hpDelta, -6);
  assert.equal(hit.events.find(event => event.kind === 'echo').hpDelta, -3);
  const burning = battle();
  const ink = putHand(burning, 'ink-drop', 'sheep');
  const applied = combat.applyAction(freeze(burning), { type: 'playCard', cardUid: ink.uid, targetId: burning.adventure.active.enemies[0].id });
  assert.equal(Object.hasOwn(applied.events.find(event => event.kind === 'burn'), 'hpDelta'), false);
  const tick = combat.applyAction(applied.state, { type: 'endTurn' });
  assert.equal(tick.events.find(event => event.kind === 'burn').hpDelta, -4);
  const healing = battle(); healing.adventure.active.party[0].hp -= 10;
  const lunch = putHand(healing, 'packed-lunch', 'sheep');
  const healed = combat.applyAction(freeze(healing), { type: 'playCard', cardUid: lunch.uid, targetId: targetFor(healing, lunch) });
  assert.equal(healed.events.find(event => event.kind === 'heal').hpDelta, 6);
  const guarding = battle(); const guard = putHand(guarding, 'guard', 'sheep');
  const shield = combat.applyAction(freeze(guarding), { type: 'playCard', cardUid: guard.uid });
  assert.equal(Object.hasOwn(shield.events.find(event => event.kind === 'block'), 'hpDelta'), false);
  const camp = jumpToNode(start(), 'camp'); camp.adventure.active.party.forEach(member => { member.hp = 1; });
  const rest = combat.applyAction(freeze(camp), { type: 'rest' });
  assert.ok(rest.events.filter(event => event.kind === 'heal').every(event => event.hpDelta === event.amount && event.hpDelta > 0));
});

test('培养档案专属牌和真实牌组共用等级稀有度缩放，被动保持实际固定值', () => {
  let state = fresh(); state.adventure.threads = 100;
  for (let count = 0; count < 4; count += 1) state = combat.levelUp(state, 'sheep').state;
  state.collection.sheep.UR = 1;
  const profile = combat.getAdventureView(freeze(state)).levels.find(item => item.id === 'sheep');
  assert.equal(profile.level, 5);
  assert.equal(profile.tier, 'UR');
  assert.equal(profile.passiveName, FIGHTERS.sheep.passive.name);
  assert.equal(profile.passiveDescription, FIGHTERS.sheep.passive.description);
  assert.match(profile.cards.find(card => card.id === 'sheep-coat').description, /护盾 14/);
  assert.match(profile.cards.find(card => card.id === 'sheep-coat').description, /留盾1回合/);
  assert.equal(profile.cards.find(card => card.id === 'sheep-coat').shortDescription, '14 护盾');
  const begun = combat.startExpedition(state, 'street', 0, 42).state;
  const view = combat.getAdventureView(begun).run;
  for (const card of profile.cards) {
    assert.equal(card.description, view.deck.find(item => item.cardId === card.id).description);
    assert.equal(card.shortDescription, view.deck.find(item => item.cardId === card.id).shortDescription);
    assert.equal(card.upgradeDescription, view.choices.find(item => item.cardId === card.id).upgradeDescription);
  }
  const simple = combat.getAdventureView(start()).run;
  assert.equal(simple.deck.find(card => card.cardId === 'strike').shortDescription, '6 伤害');
  assert.equal(simple.deck.find(card => card.cardId === 'nav-chart').shortDescription, '2 标记');
  assert.equal(simple.deck.find(card => card.cardId === 'sheep-flock').shortDescription, '全队4盾');
  assert.equal(simple.deck.find(card => card.cardId === 'orangecat-pounce').shortDescription, '3×2 伤害');
  const relay = combat.getAdventureView(combat.startExpedition(fresh(), 'street', 0, 42, 'relay').state).run;
  assert.equal(relay.deck.find(card => card.cardId === 'express-finale').shortDescription, '破12·伤22');
});

test('护盾按回合清理，留盾次数消费，反击多次响应且不互相循环', () => {
  const state = battle();
  const run = state.adventure.active;
  run.party[0].block = 20; run.party[0].status.retainBlock = 1; run.party[0].status.counter = 2;
  run.enemies[0].hp = run.enemies[0].maxHp = 100;
  run.enemies[0].status.counter = 100;
  run.enemies.push({ ...clone(run.enemies[0]), id: `enemy-${run.nextEnemyId++}` });
  const result = combat.applyAction(freeze(state), { type: 'endTurn' });
  const next = result.state.adventure.active;
  assert.equal(next.party[0].hp, run.party[0].hp);
  assert.equal(next.party[0].block, 8);
  assert.equal(next.party[0].status.retainBlock, 0);
  assert.equal(next.party[0].status.counter, 0);
  assert.ok(next.enemies.every(enemy => enemy.hp === 98));
  const cleared = act(result.state, { type: 'endTurn' });
  assert.equal(cleared.adventure.active.party[0].block, 0);
});

test('灼烧无视护盾、倒下者卡牌暂退、胜利后25%生命归队', () => {
  const state = battle();
  const run = state.adventure.active;
  run.party[0].hp = 1; run.party[0].block = 100; run.party[0].status.burn = 2;
  run.enemies[0].intentIndex = 1;
  const next = act(freeze(state), { type: 'endTurn' });
  const fallen = next.adventure.active.party[0];
  assert.equal(fallen.hp, 0);
  const ownCards = next.adventure.active.deck.filter(card => card.ownerId === fallen.id).map(card => card.uid);
  assert.ok(ownCards.every(uid => next.adventure.active.removed.includes(uid)));
  assert.ok(ownCards.every(uid => !next.adventure.active.hand.includes(uid) && !next.adventure.active.drawPile.includes(uid) && !next.adventure.active.discardPile.includes(uid)));
  const won = forcedWin(next);
  assert.equal(won.adventure.active.party[0].hp, Math.ceil(fallen.maxHp * 0.25));
  assert.equal(won.adventure.active.party[0].status.burn, 0);
});

test('致命受击仍完成此次反击，有存活队友则胜后以25%生命归队', () => {
  const state = battle();
  state.adventure.active.party[0].hp = 1;
  state.adventure.active.party[0].block = 0;
  state.adventure.active.party[0].status.counter = 8;
  state.adventure.active.enemies[0].hp = 5;
  const won = combat.applyAction(freeze(state), { type: 'endTurn' });
  assert.equal(won.state.adventure.active.phase, 'cardReward');
  assert.equal(won.state.adventure.active.party[0].hp, Math.ceil(FIGHTERS.sheep.maxHp * 0.25));
  assert.ok(won.events.some(event => event.kind === 'damage' && event.actorId === 'sheep'));
});

test('双方最后单位被同次攻击及反击同时击倒时判失败，不领取Boss奖励', () => {
  const tie = jumpToNode(start(), 'boss');
  const run = tie.adventure.active;
  const boss = run.enemies[0];
  boss.phase = 2; boss.maxHp = ENEMY_BY_ID[boss.definitionId].phase2.maxHp; boss.hp = 1; boss.intentIndex = 1;
  run.party[0].hp = 1; run.party[0].block = 0; run.party[0].status.counter = 2;
  run.party.slice(1).forEach(member => { member.hp = 0; });
  run.removed = run.deck.filter(card => card.ownerId !== 'sheep').map(card => card.uid);
  for (const pile of ['hand', 'drawPile', 'discardPile']) run[pile] = run[pile].filter(uid => !run.removed.includes(uid));
  combat.assertAdventure(tie.adventure, tie);
  const lost = act(freeze(tie), { type: 'endTurn' });
  assert.equal(lost.adventure.lastResult.win, false);
  assert.equal(lost.adventure.lastResult.tickets, 0);
  assert.equal(lost.adventure.threads, 0);
  assert.equal(lost.tickets, 6);
});

test('抽牌触及八张上限立即停止，空抽牌堆只洗入当前弃牌且不重复实例', () => {
  const state = battle();
  const card = putHand(state, 'margin-notes', 'sheep');
  const run = state.adventure.active;
  run.hand.push(...run.drawPile.splice(0, 7));
  const capped = combat.applyAction(freeze(state), { type: 'playCard', cardUid: card.uid });
  assert.equal(capped.state.adventure.active.hand.length, 8);
  assert.equal(capped.events.find(event => event.kind === 'draw').amount, 1);
  const empty = battle();
  empty.adventure.active.discardPile = [...empty.adventure.active.drawPile];
  empty.adventure.active.drawPile = [];
  const cycled = combat.applyAction(freeze(empty), { type: 'endTurn' });
  assert.ok(cycled.events.some(event => event.kind === 'shuffle'));
  assert.equal(cycled.state.adventure.active.hand.length, 5);
  combat.assertAdventure(cycled.state.adventure, cycled.state);
});

test('18件遗物每件实际触发，turn/battle限额和被动不链触发生效', () => {
  for (const relic of RELICS) {
    const state = start(['ramen', 'orangecat', 'nav']);
    state.adventure.active.relics = [relic.id];
    let result = combat.applyAction(state, { type: 'chooseNode', nodeId: 'node-0-0' });
    if (!['battleStart', 'turnStart'].includes(relic.trigger)) {
      const next = result.state;
      const run = next.adventure.active;
      run.enemies[0].hp = run.enemies[0].maxHp = relic.trigger === 'kill' ? 1 : 500;
      run.party[0].hp -= 10;
      if (relic.trigger === 'thirdPlay') run.plays = 2;
      const cardId = { guard: 'guard', heal: 'ramen-broth', marked: 'nav-chart' }[relic.trigger] || 'strike';
      const owner = cardId === 'nav-chart' ? 'nav' : 'ramen';
      const card = putHand(next, cardId, owner);
      result = combat.applyAction(next, { type: 'playCard', cardUid: card.uid, targetId: targetFor(next, card) });
    }
    assert.ok(result.events.some(event => event.kind === 'relic' && event.text.includes(relic.name)), relic.id);
  }
  const state = battle(); state.adventure.active.relics = ['night-bookmark'];
  const once = act(state, { type: 'endTurn' });
  const twice = combat.applyAction(once, { type: 'endTurn' });
  assert.equal(twice.events.some(event => event.kind === 'relic' && event.text.includes('夜读书签')), false);
});

test('22位旅伴被动各自真实触发，其他人的出牌不会冒领本人触发', () => {
  for (const fighter of Object.values(FIGHTERS)) {
    const team = [fighter.id, ...FAMILIES.map(item => item.id).filter(id => id !== fighter.id).slice(0, 2)];
    const initial = start(team);
    initial.adventure.active.party.forEach(member => { member.hp -= 5; });
    let result = combat.applyAction(initial, { type: 'chooseNode', nodeId: 'node-0-0' });
    const name = fighter.passive.trigger;
    if (!['battleStart', 'turnStart'].includes(name)) {
      const state = result.state;
      const run = state.adventure.active;
      run.enemies[0].hp = run.enemies[0].maxHp = name === 'kill' ? 1 : 500;
      if (name === 'thirdPlay') run.plays = 2;
      const cardId = { guard: 'guard', heal: 'packed-lunch', marked: 'stamped-route' }[name] || 'strike';
      const card = putHand(state, cardId, fighter.id);
      result = combat.applyAction(state, { type: 'playCard', cardUid: card.uid, targetId: targetFor(state, card) });
    }
    assert.equal(result.events.filter(event => event.kind === 'passive' && event.actorId === fighter.id).length, 1, fighter.id);
    assert.ok(result.events.some(event => event.kind === fighter.passive.kind && event.actorId === fighter.id) || fighter.passive.kind === 'burn' && fighter.passive.trigger === 'kill', fighter.id);
  }
  const state = battle(); const card = putHand(state, 'strike', 'sheep');
  const result = combat.applyAction(state, { type: 'playCard', cardUid: card.uid, targetId: state.adventure.active.enemies[0].id });
  assert.equal(result.events.some(event => event.kind === 'passive' && event.actorId === 'orangecat'), false);
});

test('营地治疗与选牌升级互斥，事件治疗按点数且随机升级可复现', () => {
  const camp = jumpToNode(start(), 'camp');
  camp.adventure.active.party.forEach(member => { member.hp = 1; });
  const rested = act(freeze(camp), { type: 'rest' });
  rested.adventure.active.party.forEach(member => assert.equal(member.hp, 1 + Math.ceil(member.maxHp * 0.35)));
  assert.throws(() => act(rested, { type: 'chooseUpgrade' }), /只有营地/);
  const selecting = act(camp, { type: 'chooseUpgrade' });
  assert.equal(selecting.adventure.active.phase, 'campUpgrade');
  const uid = combat.getAdventureView(selecting).run.choices[0].uid;
  const upgraded = act(freeze(selecting), { type: 'upgradeCard', cardUid: uid });
  assert.equal(upgraded.adventure.active.deck.find(card => card.uid === uid).upgraded, true);
  assert.throws(() => act(upgraded, { type: 'upgradeCard', cardUid: uid }), /不能升级/);
  const event = jumpToNode(start(), 'event');
  event.adventure.active.party.forEach(member => { member.hp = 1; });
  const healed = act(freeze(event), { type: 'chooseEvent', choiceId: 'tea' });
  assert.ok(healed.adventure.active.party.every(member => member.hp === 9));
  const learning = freeze(jumpToNode(start(), 'event', 1));
  const first = combat.applyAction(learning, { type: 'chooseEvent', choiceId: 'learn' });
  assert.deepEqual(first, combat.applyAction(learning, { type: 'chooseEvent', choiceId: 'learn' }));
  assert.equal(first.state.adventure.active.deck.filter(card => card.upgraded).length, 1);
});

test('双阶段切换不结算胜利，敌行动中被反击破甲不跳过第二阶段首意图', () => {
  const state = jumpToNode(start(), 'boss');
  const run = state.adventure.active;
  const boss = run.enemies[0]; boss.hp = 1; boss.intentIndex = 1;
  run.party[0].block = 50; run.party[0].status.counter = 3;
  const result = combat.applyAction(freeze(state), { type: 'endTurn' });
  assert.equal(result.state.adventure.active.phase, 'battle');
  assert.equal(result.state.adventure.active.enemies[0].phase, 2);
  assert.equal(result.state.adventure.active.enemies[0].intentIndex, 0);
  assert.equal(result.state.adventure.threads, 0);
  assert.equal(result.state.tickets, 6);
  assert.ok(result.events.some(event => event.kind === 'bossPhase'));
});

test('召唤最多三个敌人，生成新实例且不能将内容ID作为攻击目标', () => {
  let state = jumpToNode(start(undefined, 42, 0, 'market'), 'boss');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    state.adventure.active.enemies[0].intentIndex = 0;
    state = act(state, { type: 'endTurn' });
    assert.ok(state.adventure.active.enemies.length <= 3);
  }
  const run = state.adventure.active;
  assert.equal(run.enemies.length, 3);
  assert.equal(new Set(run.enemies.map(enemy => enemy.id)).size, 3);
  assert.ok(run.enemies.slice(1).every(enemy => enemy.definitionId === 'lantern-mote'));
  combat.assertAdventure(state.adventure, state);
});

test('三个区域三难度均完整结算，难度奖励倍率与邮票正确', () => {
  let state = fresh();
  for (const region of REGIONS) {
    for (const difficulty of [0, 1, 2]) {
      const tickets = state.tickets;
      state = finishForced(combat.startExpedition(state, region.id, difficulty, 42).state);
      assert.equal(state.adventure.lastResult.win, true);
      assert.equal(state.tickets - tickets, difficulty + 1 + (difficulty === 0 ? 3 : 0));
      assert.equal(state.adventure.clears[region.id][difficulty], 1);
      assert.equal(state.adventure.lastResult.tickets, difficulty + 1 + (difficulty === 0 ? 3 : 0));
    }
  }
});

test('困难护甲与夜行第三回合增伤真实生效，意图展示与伤害一致', () => {
  const state = battle(undefined, 42, 2);
  const run = state.adventure.active;
  run.turn = 3; run.party[0].block = 0;
  const intent = combat.getAdventureView(state).run.enemies[0].intentText;
  assert.match(intent, /10 伤害/);
  assert.match(intent, /2盾/);
  const result = combat.applyAction(freeze(state), { type: 'endTurn' });
  assert.equal(result.events.find(event => event.kind === 'damage' && event.actorId === run.enemies[0].id).amount, 10);
  assert.equal(result.state.adventure.active.enemies[0].block, 2);
});

test('多敌意图按真实endTurn顺序演算，前排倒下后的后续目标与护盾损失一致', () => {
  const state = battle();
  const run = state.adventure.active;
  run.party[0].hp = 1; run.party[0].block = 0;
  run.enemies.push({ ...clone(run.enemies[0]), id: `enemy-${run.nextEnemyId++}` });
  const before = clone(state);
  const view = combat.getAdventureView(freeze(state));
  const executed = combat.applyAction(state, { type: 'endTurn' });
  assert.equal(view.run.enemies[0].intentTargets[0].id, 'sheep');
  assert.equal(view.run.enemies[1].intentTargets[0].id, 'orangecat');
  assert.match(view.run.enemies[1].intentShort, /橘猫豆包/);
  for (const enemy of view.run.enemies) {
    const actual = executed.events.find(event => event.kind === 'enemyAction' && event.actorId === enemy.id);
    assert.deepEqual(enemy.intentTargets, actual.intentTargets);
  }
  assert.deepEqual(state, before);
  const mothState = act(start(), { type: 'chooseNode', nodeId: 'node-0-1' });
  const moth = combat.getAdventureView(mothState).run.enemies[0];
  assert.equal(moth.definitionId, 'stamp-moth');
  assert.equal(moth.intentShort, '羊咩咩团 · 虚弱1回合');
  assert.match(moth.intentText, /虚弱1回合/);
  const weakened = act(mothState, { type: 'endTurn' });
  assert.equal(weakened.adventure.active.party[0].status.weak, 1);
  assert.match(combat.getAdventureView(weakened).run.party[0].statusText, /虚弱1回合/);
});

test('九节点奖励即时入库，双阶段Boss和区域首通票只发一次', () => {
  const begun = combat.startExpedition(fresh(), 'street', 0, 42).state;
  const state = finishForced(begun);
  assert.equal(state.adventure.active, null);
  assert.equal(state.adventure.lastResult.win, true);
  assert.equal(state.adventure.lastResult.nodesCleared, 9);
  assert.equal(state.adventure.clears.street[0], 1);
  assert.equal(state.tickets, 10);
  assert.equal(state.adventure.threads, 46);
  assert.throws(() => act(state, { type: 'endTurn' }), /没有进行中/);
  assert.throws(() => act(state, { type: 'chooseRelic', choiceId: 'blue-thread' }), /没有进行中/);
  const second = finishForced(combat.startExpedition(state, 'street', 0, 42).state);
  assert.equal(second.tickets, 11);
  assert.equal(second.adventure.clears.street[0], 2);
  assert.equal(combat.getAdventureView(second).regions[1].unlocked, true);
  assert.equal(combat.getAdventureView(second).regions[0].difficulties[1].unlocked, true);
});

test('奖励阶段重复领取被拒绝，撤退或失败保留已入库星线', () => {
  const won = forcedWin(battle());
  assert.equal(won.adventure.threads, 4);
  const choiceId = won.adventure.active.choices[0].uid;
  const next = act(freeze(won), { type: 'chooseCard', choiceId });
  assert.equal(next.adventure.active.deck.length, 13);
  assert.throws(() => act(next, { type: 'chooseCard', choiceId }), /没有待领取/);
  const out = act(next, { type: 'abandon' });
  assert.equal(out.adventure.threads, 4);
  assert.equal(out.adventure.lastResult.threads, 4);
  const losing = act(next, { type: 'chooseNode', nodeId: next.adventure.active.nodes[1].options[0].id });
  losing.adventure.active.party.forEach(member => { member.hp = 1; member.status.burn = 5; });
  const failed = act(losing, { type: 'endTurn' });
  assert.equal(failed.adventure.active, null);
  assert.equal(failed.adventure.lastResult.win, false);
  assert.equal(failed.adventure.threads, 4);
});

test('1至10级费用逐级上涨、成长只影响下次出发，满级与在途拒绝', () => {
  let state = fresh(); state.adventure.threads = 1000;
  for (let level = 1; level < 10; level += 1) {
    const before = state.adventure.threads;
    state = combat.levelUp(freeze(state), 'sheep').state;
    assert.equal(state.adventure.levels.sheep, level + 1);
    assert.equal(state.adventure.threads, before - level * 10);
  }
  assert.equal(state.adventure.threads, 550);
  assert.throws(() => combat.levelUp(state, 'sheep'), /10 级/);
  assert.throws(() => combat.levelUp(fresh(), 'sheep'), /星线不足/);
  assert.throws(() => combat.levelUp(start(), 'sheep'), /当前/);
  const next = combat.startExpedition(state, 'street', 0, 1).state;
  assert.equal(next.adventure.active.party[0].maxHp, Math.floor(54 * 1.36));
});

test('存档边界拒绝损坏的实例ID、牌堆重复、非法阶段和主线冲突', () => {
  const mutations = [
    state => { state.adventure.threads = NaN; },
    state => { state.adventure.levels.sheep = 11; },
    state => { state.adventure.active.phase = 'rewardAgain'; },
    state => { state.adventure.active.rng = 0; },
    state => { state.adventure.active.deck[0].uid = 'card-999'; },
    state => { state.adventure.active.hand.push(state.adventure.active.hand[0]); },
    state => { state.adventure.active.enemies[0].id = 'paper-ball'; },
    state => { state.adventure.active.party[0].hp = -1; },
    state => { state.adventure.active.layer = 9; },
    state => { state.journey = {}; }
  ];
  for (const mutate of mutations) {
    const state = battle(); mutate(state);
    assert.throws(() => combat.assertAdventure(state.adventure, state), /冒险存档/);
  }
});

test('三支1级R队伍用真实出牌通关普通首本，每局确有六场战斗', context => {
  const reports = [];
  for (const team of [['sheep', 'orangecat', 'nav'], ['ramen', 'sushi', 'burger'], ['tea', 'sunset', 'moon']]) {
    for (const seed of [42, 12345, 824596]) {
      const report = simulateRun(team, seed);
      assert.equal(report.win, true, `${team.join('/')} seed=${seed} 应可通关普通首本`);
      assert.equal(report.battles.length, 6);
      assert.equal(report.battles.filter(item => item.type === 'boss').length, 1);
      reports.push(report);
    }
  }
  const summary = [0, 3, 6].map(index => {
    const runs = reports.slice(index, index + 3);
    const ordinary = runs.flatMap(run => run.battles.filter(item => item.type === 'battle').map(item => item.turns));
    const bosses = runs.flatMap(run => run.battles.filter(item => item.type === 'boss').map(item => item.turns));
    return { team: runs[0].team.join('/'), wins: `${runs.filter(run => run.win).length}/3`, ordinaryTurns: [Math.min(...ordinary), Math.max(...ordinary)], bossTurns: [Math.min(...bosses), Math.max(...bosses)] };
  });
  context.diagnostic(`真实策略模拟 ${JSON.stringify(summary)}`);
});

test('两套复杂起手战术由初始三位1级R伙伴用公开动作正常通关', context => {
  const reports = [];
  for (const tacticId of ['relay', 'reserve']) {
    for (const seed of [42, 12345, 824596]) {
      const report = simulateRun(['sheep', 'orangecat', 'nav'], seed, tacticId);
      assert.equal(report.win, true, `${tacticId} seed=${seed} 应可正常通关`);
      assert.equal(report.battles.length, 6);
      reports.push(report);
    }
  }
  context.diagnostic(`复杂起手模拟 ${JSON.stringify(reports.map(item => ({ tactic: item.tacticId, seed: item.seed, bossTurns: item.battles.find(battle => battle.type === 'boss').turns })))}`);
});


test('蓄能在胜利后清空，战后奖励与牌组显示原费用', () => {
  const state = battle(); state.adventure.active.charge = 3;
  const won = forcedWin(state);
  assert.equal(won.adventure.active.phase, 'cardReward');
  assert.equal(won.adventure.active.charge, 0);
  // Node 内存只替换奖励卡以覆盖明确的4费牌，不影响模拟器存档。
  won.adventure.active.choices[0].cardId = 'night-shelter';
  won.adventure.active.charge = 3;
  assert.equal(combat.getAdventureView(won).run.choices[0].cost, 4, '非战斗页即使读到残留蓄能也不能展示折扣价');
});


test('战术名称与真实固定起手不符时保留坏档并拒绝继续', () => {
  const state = combat.startExpedition(fresh(), 'street', 0, 42, 'relay').state;
  state.adventure.active.tacticId = 'reserve';
  assert.throws(() => combat.assertAdventure(state.adventure, state), /冒险存档/);
  delete state.adventure.active.tacticId;
  assert.throws(() => combat.assertAdventure(state.adventure, state), /冒险存档/);
});

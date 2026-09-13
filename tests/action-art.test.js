const test = require('node:test');
const assert = require('node:assert/strict');
const actionArt = require('../utils/action-art');
const combat = require('../utils/combat');
const manifest = require('../assets/battle/manifest');
const { FAMILIES } = require('../utils/content');

const clone = value => JSON.parse(JSON.stringify(value));

function freshState(team = ['sheep', 'ticket', 'moon']) {
  const collection = {};
  FAMILIES.forEach(({ id }) => { collection[id] = { R: 1, SR: 0, SSR: 0, UR: 0 }; });
  return { version: 2, tickets: 6, collection, team, journey: null, adventure: combat.createAdventureProfile() };
}

function battle(team = ['sheep', 'ticket', 'moon'], regionId = 'street', nodeType = 'battle') {
  const state = combat.startExpedition(freshState(team), regionId, 0, 42).state;
  const run = state.adventure.active;
  run.layer = run.nodes.findIndex(node => node.type === nodeType);
  assert.notEqual(run.layer, -1, `找不到 ${nodeType} 节点`);
  run.nodes.forEach((node, index) => {
    node.visited = index < run.layer;
    node.chosenId = index < run.layer ? node.options[0].id : null;
  });
  return combat.applyAction(state, { type: 'chooseNode', nodeId: run.nodes[run.layer].options[0].id }).state;
}

function putHand(state, cardId, ownerId) {
  const run = state.adventure.active;
  const card = run.deck.find(item => item.cardId === cardId && item.ownerId === ownerId);
  assert.ok(card, `${ownerId} 的牌组中缺少 ${cardId}`);
  run.hand = [card.uid];
  run.drawPile = run.deck.filter(item => item.uid !== card.uid && !run.removed.includes(item.uid)).map(item => item.uid);
  run.discardPile = [];
  run.energy = 3;
  return card;
}

test('八状态顺序固定，GROUPS 覆盖 22 个旅伴且无重复', () => {
  assert.deepEqual(actionArt.STATES, ['enter', 'attack', 'guard', 'hurt', 'exit', 'control', 'buff', 'debuff']);
  assert.equal(actionArt.LABELS.idle, '');
  actionArt.STATES.forEach(state => assert.ok(actionArt.LABELS[state], `${state} 缺少状态文案`));

  const ids = Object.values(actionArt.GROUPS).flat();
  assert.equal(ids.length, 22);
  assert.equal(new Set(ids).size, 22);
  assert.deepEqual(new Set(ids), new Set(Object.keys(manifest.heroes)));
  ids.forEach(id => assert.equal(actionArt.heroGroup(id), Object.keys(actionArt.GROUPS).find(group => actionArt.GROUPS[group].includes(id))));
});

test('英雄动作路径和三个 Boss 的 phase2 路径都指向自己的素材包', () => {
  assert.equal(actionArt.imageFor({ id: 'sheep' }, 'street', 'attack'), '/package-actors-a/assets/sheep/attack.png');
  assert.equal(actionArt.imageFor({ id: 'sheep' }, 'street', 'idle'), manifest.heroes.sheep.idle);

  for (const [id, regionId] of [['paper-lion', 'street'], ['ink-tide', 'bridge'], ['bell-warden', 'market']]) {
    assert.equal(actionArt.imageFor({ definitionId: id, phase: 1 }, regionId, 'attack'), `/package-${regionId}/assets/actions/${id}/attack.png`);
    assert.equal(actionArt.imageFor({ definitionId: id, phase: 2 }, regionId, 'attack'), `/package-${regionId}/assets/actions/${id}-phase2/attack.png`);
    assert.equal(actionArt.imageFor({ definitionId: id, phase: 2 }, regionId, 'idle'), manifest.enemies[id].phase2);
  }
});

test('真实 resolver 的完全格挡事件即使护盾耗尽仍保持 guard', () => {
  const state = battle();
  const run = state.adventure.active;
  run.enemies[0].intentIndex = 0;
  run.party[0].block = 6;
  const result = combat.applyAction(clone(state), { type: 'endTurn' });
  const impact = result.events.find(event => event.kind === 'damage' && event.targetId === 'sheep');
  assert.ok(impact);
  assert.equal(impact.blocked, 6);
  assert.equal(impact.amount, 0);
  assert.ok(impact.hpDelta <= 0 && impact.hpDelta >= 0);
  const sheep = result.state.adventure.active.party.find(member => member.id === 'sheep');
  assert.equal(sheep.block, 0, '护盾应在完全格挡后耗尽');
  assert.equal(actionArt.choosePose(sheep, result.events, 'impact'), 'guard');
});

test('真实虚弱、灼烧、标记与增益事件映射为持续姿态', () => {
  const weakened = battle();
  const weakCard = putHand(weakened, 'ticket-cut', 'ticket');
  const weakResult = combat.applyAction(clone(weakened), { type: 'playCard', cardUid: weakCard.uid, targetId: weakened.adventure.active.enemies[0].id });
  const weakEnemy = weakResult.state.adventure.active.enemies[0];
  assert.ok(weakResult.events.some(event => event.kind === 'weak'));
  assert.equal(weakEnemy.status.weak, 1);
  assert.equal(actionArt.choosePose(weakEnemy, [], 'idle'), 'control');

  const marked = battle(['sunset', 'ticket', 'moon']);
  const markCard = putHand(marked, 'sunset-glow', 'sunset');
  const markResult = combat.applyAction(clone(marked), { type: 'playCard', cardUid: markCard.uid, targetId: marked.adventure.active.enemies[0].id });
  const markedEnemy = markResult.state.adventure.active.enemies[0];
  assert.ok(markResult.events.some(event => event.kind === 'mark'));
  assert.ok(markResult.events.some(event => event.kind === 'burn'));
  assert.ok(markedEnemy.status.mark > 0 && markedEnemy.status.burn > 0);
  assert.equal(actionArt.choosePose(markedEnemy, [], 'idle'), 'debuff');

  const buffed = battle(['ticket', 'catcafe', 'sunset']);
  const buffCard = putHand(buffed, 'ticket-replay', 'ticket');
  const buffResult = combat.applyAction(clone(buffed), { type: 'playCard', cardUid: buffCard.uid });
  const ticket = buffResult.state.adventure.active.party.find(member => member.id === 'ticket');
  assert.ok(buffResult.events.some(event => event.kind === 'echo' && event.targetId === 'ticket'));
  assert.equal(actionArt.choosePose(ticket, buffResult.events, 'impact'), 'buff');
  assert.equal(actionArt.choosePose(ticket, [], 'idle'), 'buff');
});

test('真实 action、impact、down/defeat 与 bossPhase 事件映射到 attack、hurt、exit、enter', () => {
  const attacking = battle();
  const strike = putHand(attacking, 'strike', 'sheep');
  const targetId = attacking.adventure.active.enemies[0].id;
  const hit = combat.applyAction(clone(attacking), { type: 'playCard', cardUid: strike.uid, targetId });
  const actor = hit.state.adventure.active.party.find(member => member.id === 'sheep');
  const target = hit.state.adventure.active.enemies.find(enemy => enemy.id === targetId);
  assert.equal(actionArt.choosePose(actor, hit.events, 'action'), 'attack');
  assert.equal(actionArt.choosePose(target, hit.events, 'impact'), 'hurt');

  const defeating = battle();
  const lethalStrike = putHand(defeating, 'strike', 'sheep');
  const defeatedId = defeating.adventure.active.enemies[0].id;
  defeating.adventure.active.enemies[0].hp = 1;
  const defeat = combat.applyAction(clone(defeating), { type: 'playCard', cardUid: lethalStrike.uid, targetId: defeatedId });
  const defeated = defeat.state.adventure.active.enemies.find(enemy => enemy.id === defeatedId);
  assert.ok(defeat.events.some(event => event.kind === 'defeat'));
  assert.equal(actionArt.choosePose(defeated, defeat.events, 'impact'), 'exit');

  const bossState = battle(['sheep', 'ticket', 'moon'], 'street', 'boss');
  const bossStrike = putHand(bossState, 'strike', 'sheep');
  const bossId = bossState.adventure.active.enemies[0].id;
  bossState.adventure.active.enemies[0].hp = 1;
  const phase = combat.applyAction(clone(bossState), { type: 'playCard', cardUid: bossStrike.uid, targetId: bossId });
  const boss = phase.state.adventure.active.enemies[0];
  assert.ok(phase.events.some(event => event.kind === 'bossPhase'));
  assert.equal(boss.phase, 2);
  assert.ok(boss.hp > 0);
  assert.equal(actionArt.choosePose(boss, phase.events, 'impact'), 'enter');
  assert.notEqual(actionArt.choosePose(boss, phase.events, 'impact'), 'exit');
});

test('预览复用 resolver 结果但不改状态或 RNG', () => {
  const state = battle();
  const card = putHand(state, 'strike', 'sheep');
  const action = { type: 'playCard', cardUid: card.uid, targetId: state.adventure.active.enemies[0].id };
  const before = clone(state);
  const preview = combat.previewAction(state, action);
  assert.equal(preview.allowed, true);
  assert.deepEqual(state, before);
  assert.equal(state.adventure.active.rng, before.adventure.active.rng);

  const applied = combat.applyAction(clone(state), action);
  assert.deepEqual(preview.events, applied.events);
});

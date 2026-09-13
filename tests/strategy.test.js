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

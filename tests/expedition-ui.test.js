const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const game = require('../utils/game');
const combat = require('../utils/combat');
const { CARD_BY_ID, ENEMY_BY_ID } = require('../utils/combat-content');
const art = require('../assets/battle/manifest');
const { imageFor } = require('../utils/action-art');
const { createAudioMock } = require('./helpers/fake-audio');

const clone = value => JSON.parse(JSON.stringify(value));
const event = (key, value) => ({ currentTarget: { dataset: { [key]: value } } });

// 验证真实页面事件到存档的桥接；不创建节点或伪装原生UI/动画验收。
function harness(saved = game.createState()) {
  let app;
  let capturedPage;
  let nextTimer = 1;
  const timers = new Map();
  const timerDelays = [];
  const writes = [];
  const notices = [];
  const navigation = [];
  const packageRequests = [], pendingLoads = [];
  const controls = { failWrites: false, failLoads: false, deferLoads: false, commits: 0 };
  const math = Object.create(Math);
  math.random = () => 41 / 0xfffffffe;
  const context = vm.createContext({
    Math: math,
    App(definition) { app = definition; },
    Page(definition) { capturedPage = definition; },
    getApp() { return app; },
    setTimeout(callback, delay) { const id = nextTimer++; timerDelays.push(delay); timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    wx: {
      ...createAudioMock(),
      getStorageSync(key) { return key.endsWith('-audio') ? '' : clone(saved); },
      setStorageSync(key, value) {
        assert.equal(key, 'dusk-letter-rpg-v1');
        if (controls.failWrites) throw new Error('storage full');
        writes.push(clone(value));
      },
      getWindowInfo() { return { windowWidth: 390, windowHeight: 680 }; },
      showToast(value) { notices.push(value); },
      switchTab(value) { navigation.push(value.url); },
      navigateTo(value) { navigation.push(value.url); if (value.complete) value.complete(); }
    }
  });
  function load(relative) {
    const filename = path.join(__dirname, '..', relative);
    const module = { exports: {} };
    const execute = vm.runInContext(`(function(require, module, exports) {\n${fs.readFileSync(filename, 'utf8')}\n})`, context, { filename });
    const importer = createRequire(filename);
    importer.async = relative => {
      const group = relative.match(/package-actors-([abc])/)[1];
      packageRequests.push('actors-' + group);
      return new Promise((resolve, reject) => {
        const load = { success: resolve, fail: reject };
        if (controls.deferLoads) pendingLoads.push(load);
        else if (controls.failLoads) reject({ errMsg: 'download failed' });
        else resolve(group);
      });
    };
    execute(importer, module, module.exports);
    return module.exports;
  }
  function mount(page) {
    page.data = clone(page.data);
    page.setData = function (value) { Object.assign(this.data, value); };
    if (page.onLoad) page.onLoad();
    page.onShow();
    return page;
  }
  load('app.js');
  app.onLaunch();
  assert.ok(app.state, app.storageError);
  const commit = app.commit;
  app.commit = function (state) { controls.commits += 1; return commit.call(this, state); };
  const { createPage } = load('utils/expedition-page.js');
  return {
    app, controls, writes, notices, navigation, timers, timerDelays, packageRequests, pendingLoads,
    expedition() { return mount(createPage('street')); },
    hub() { load('pages/adventure/index.js'); return mount(capturedPage); },
    stepMotion() { const first = timers.entries().next().value; if (first) { timers.delete(first[0]); first[1](); } },
    flushMotion() { let steps = 0; while (timers.size) { assert(++steps <= 20, '动作定时器必须有界结束'); this.stepMotion(); } }
  };
}

function started() { return combat.startExpedition(game.createState(), 'street', 0, 42).state; }
function inBattle() { return combat.applyAction(started(), { type: 'chooseNode', nodeId: 'node-0-0' }).state; }
function selectAttack(page) {
  const card = page.data.screen.run.hand.find(item => item.playable && item.target === 'enemy' && CARD_BY_ID[item.cardId].effects.some(effect => effect.kind === 'damage'));
  assert.ok(card, '确定种子的首手应有可测试的攻击牌');
  page.selectCard(event('uid', card.uid));
  page.selectEnemy(event('id', page.data.screen.run.enemies[0].id));
  assert.equal(page.data.screen.preview.allowed, true);
  return card;
}

// 只定位独立事件分支的内存夹具；战斗能力、数值和平衡由combat测试验证。
function atNode(type) {
  const state = started();
  const run = state.adventure.active;
  run.layer = run.nodes.findIndex(node => node.type === type);
  run.nodes.forEach((node, index) => { node.visited = index < run.layer; node.chosenId = index < run.layer ? node.options[0].id : null; });
  return combat.applyAction(state, { type: 'chooseNode', nodeId: run.nodes[run.layer].options[0].id }).state;
}
function wonBattle(initial = inBattle()) {
  let state = clone(initial);
  for (let step = 0; state.adventure.active && state.adventure.active.phase === 'battle' && step < 3; step += 1) {
    const run = state.adventure.active;
    const card = run.deck.find(item => item.cardId === 'strike');
    run.hand = [card.uid];
    run.drawPile = run.deck.filter(item => item.uid !== card.uid).map(item => item.uid);
    run.discardPile = []; run.energy = 3;
    run.enemies[0].hp = 1; run.enemies[0].block = 0;
    state = combat.applyAction(state, { type: 'playCard', cardUid: card.uid, targetId: run.enemies[0].id }).state;
  }
  game.assertState(state);
  return state;
}
function lethalAttackState(initial = inBattle()) {
  const state = clone(initial);
  const run = state.adventure.active;
  const card = run.deck.find(item => item.cardId === 'strike');
  run.hand = [card.uid];
  run.drawPile = run.deck.filter(item => item.uid !== card.uid).map(item => item.uid);
  run.discardPile = []; run.energy = 3;
  // 回执夹具表示最后一敌；新精英遭遇的随从在此已被击败。
  run.enemies.slice(1).forEach(enemy => { enemy.hp = 0; });
  run.enemies[0].hp = 1; run.enemies[0].block = 0;
  return state;
}

test('大厅出发和地图进入正确，选牌选目标不写，确认只提交一次且重复确认不再扣费', async () => {
  const h = harness();
  const hub = h.hub();
  await hub.start();
  assert.equal(h.app.state.adventure.active.seed, 42);
  assert.equal(h.app.state.adventure.active.phase, 'map');
  assert.equal(h.writes.length, 1);
  assert.equal(h.navigation[0], '/package-street/pages/run/index', JSON.stringify({packages:h.packageRequests,notices:h.notices,visible:hub._visible,party:h.app.state.adventure.active.party.map(x=>x.id)}));
  const page = h.expedition();
  page.chooseNode(event('id', 'node-0-0'));
  assert.equal(page.data.screen.run.phase, 'battle');
  assert.equal(h.writes.length, 2);
  const before = clone(h.app.state);
  const card = selectAttack(page);
  const expected = combat.applyAction(before, { type: 'playCard', cardUid: card.uid, targetId: page.data.screen.targetId }).state;
  assert.equal(h.writes.length, 2);
  page.confirmPlay(); page.confirmPlay();
  assert.equal(h.writes.length, 3);
  assert.deepEqual(clone(h.app.state), expected);
  h.flushMotion(); page.confirmPlay();
  assert.equal(h.writes.length, 3);
  assert.equal(page.data.screen.selected, null);
});

test('大厅起手战术选择只改页面，出发保存12张牌与3张替换且远行中不可改选', async () => {
  const h = harness(); const hub = h.hub();
  hub.selectTactic(event('id', 'relay'));
  assert.equal(h.writes.length, 0);
  assert.equal(hub.data.tacticId, 'relay');
  assert.equal(hub.data.selectedTactic.id, 'relay');
  await hub.start();
  const run = h.app.state.adventure.active;
  assert.equal(run.tacticId, 'relay');
  assert.equal(run.deck.length, 12);
  assert.deepEqual(run.deck.filter(card => ['quick-sketch', 'wind-up-stamp', 'express-finale'].includes(card.cardId)).map(card => card.cardId).sort(), ['express-finale', 'quick-sketch', 'wind-up-stamp']);
  assert.equal(h.writes.length, 1);
  hub.selectTactic(event('id', 'reserve'));
  assert.equal(hub.data.tacticId, 'relay');
  assert.equal(h.app.state.adventure.active.tacticId, 'relay');
});

test('大厅起手战术保存失败不启动远行或扣资源', async () => {
  const h = harness(); const hub = h.hub();
  hub.selectTactic(event('id', 'reserve'));
  const before = clone(h.app.state);
  h.controls.failWrites = true;
  await hub.start();
  assert.equal(h.writes.length, 0);
  assert.deepEqual(clone(h.app.state), before);
  assert.equal(h.notices.length, 1);
  assert.match(h.notices[0].title, /storage full/);
});

test('入场图结束后呈现真实持续状态，期间可选牌，后续施招和受击仍只结算一次', () => {
  const h = harness(started());
  const page = h.expedition();
  page.chooseNode(event('id', 'node-0-0'));
  assert.ok(page._fx.some(event => event.kind === 'passive' && event.actorId === 'sheep'));
  const sheep = page.data.screen.run.party.find(member => member.id === 'sheep');
  assert.equal(page.data.screen.busy, false);
  assert.equal(sheep.acting, false);
  assert.equal(sheep.actionState, 'enter');
  assert.equal(sheep.image, imageFor(sheep, 'street', 'enter'));
  assert.equal(sheep.impact, '');
  assert.equal(h.timers.size, 1);
  assert.equal(h.timerDelays.at(-1), 600);
  const saved = clone(h.app.state);
  const uid = page.data.screen.run.hand[0].uid;
  page.selectCard(event('uid', uid));
  assert.equal(page.data.screen.selected.uid, uid, '非busy入场效果不阻塞选牌');
  h.flushMotion();
  const resting = page.data.screen.run.party.find(member => member.id === 'sheep');
  assert.equal(resting.acting, false);
  assert.equal(resting.actionState, 'guard');
  assert.equal(resting.image, imageFor(resting, 'street', 'guard'));
  assert.equal(resting.impact, '');
  assert.equal(page._fx.length, 0);
  assert.equal(page.data.screen.selected.uid, uid);
  assert.equal(h.controls.commits, 1);
  assert.equal(h.writes.length, 1);
  assert.deepEqual(clone(h.app.state), saved);
  page.clearSelection(); selectAttack(page); page.confirmPlay();
  assert.equal(page.data.screen.busy, true);
  assert.equal(h.timers.size, 1);
  assert.equal(h.timerDelays.at(-1), 220);
  const afterCard = clone(h.app.state);
  h.flushMotion();
  assert.equal(page.data.screen.busy, false);
  assert.equal(page._fx.length, 0);
  assert.equal(h.controls.commits, 2);
  assert.equal(h.writes.length, 2);
  assert.deepEqual(clone(h.app.state), afterCard);
});

test('本队动作包加载失败仍可继续已出发远行，且不重复提交', async () => {
  const h = harness(); const hub = h.hub(); h.controls.failLoads = true;
  await hub.start();
  assert.equal(h.writes.length, 1);
  assert(h.app.state.adventure.active);
  assert.deepEqual(h.navigation, ['/package-street/pages/run/index']);
  assert.deepEqual(h.packageRequests.sort(), ['actors-a', 'actors-b']);
  assert.deepEqual(h.notices, [], '动作素材失败不应把继续远行提示为必须联网');
  assert.equal(hub.data.preparing, false);
  const saved = clone(h.app.state);
  h.controls.failLoads = false; await hub.resume();
  assert.deepEqual(h.navigation, ['/package-street/pages/run/index']);
  assert.equal(h.writes.length, 1);
  assert.deepEqual(clone(h.app.state), saved);
});

test('准备动作素材期间切走不在后台强行导航，回来后可接续同一队伍', async () => {
  const h = harness(); const hub = h.hub(); h.controls.deferLoads = true;
  const starting = hub.start(); const saved = clone(h.app.state);
  hub.onHide(); h.pendingLoads.forEach(load => load.success({})); await starting;
  assert.deepEqual(h.navigation, []);
  assert.equal(hub.data.preparing, false);
  assert.deepEqual(clone(h.app.state), saved);
  h.controls.deferLoads = false; hub.onShow(); await hub.resume();
  assert.equal(h.navigation.length, 1);
  assert.equal(h.writes.length, 1);
});

test('八种动作图谱只是图片预览，受控或退场预览不施加效果、不变更选牌与存档', () => {
  const h = harness(inBattle()); const page = h.expedition();
  page.selectAlly(event('id', 'sheep'));
  const before = clone(h.app.state), actual = clone(page.data.screen.inspected);
  for (const pose of ['enter', 'attack', 'guard', 'hurt', 'exit', 'control', 'buff', 'debuff']) {
    page.previewPose(event('pose', pose));
    assert.equal(page.data.screen.inspectedPreview.actionState, pose);
    assert.equal(page.data.screen.inspectedPreview.image, imageFor(actual, 'street', pose));
    assert.deepEqual(clone(page.data.screen.inspected), actual);
  }
  page.previewPose(event('pose', '../../unknown'));
  assert.equal(page.data.screen.previewPose, 'debuff');
  page.showCurrentPose();
  assert.equal(page.data.screen.previewPose, '');
  assert.equal(page.data.screen.inspectedPreview.actionState, actual.actionState);
  page.closeSheet();
  assert.equal(h.writes.length, 0);
  assert.deepEqual(clone(h.app.state), before);
});

test('全队倒下使用真实退场图片，动画结束不改失败回执或资源', () => {
  const state = inBattle();
  state.adventure.active.party.forEach(member => { member.hp = 1; member.status.burn = 2; });
  const h = harness(state); const page = h.expedition(); page.endTurn();
  assert.equal(h.app.state.adventure.active, null);
  assert.equal(h.app.state.adventure.lastResult.win, false);
  assert.equal(page.data.screen.partyExit.length, 0, '逐帧展示不再叠加全队提前退场');
  assert.equal(page.data.screen.run.phase, 'battle');
  const saved = clone(h.app.state);
  let sawExit = false;
  for (let step = 0; h.timers.size && step < 10; step++) {
    h.stepMotion();
    sawExit = sawExit || !!page.data.screen.run?.party.some(member => member.hp === 0 && member.actionState === 'exit');
  }
  assert(sawExit, '命中帧中显示真实倒下伙伴的退场图');
  assert.equal(h.timers.size, 0);
  assert.equal(page.data.screen.partyExit.length, 0);
  assert.equal(page.data.screen.receipt.kind, 'defeat');
  assert.equal(page.data.screen.receipt.actionLabel, '收好回执');
  assert(page.data.screen.receipt.party.every(member => member.down));
  assert.equal(h.writes.length, 1);
  assert.deepEqual(clone(h.app.state), saved);
});

test('卡牌预览、卡组、日志、敌人详情及撤退询问均为只读界面事件', () => {
  const h = harness(inBattle());
  const page = h.expedition();
  const before = clone(h.app.state);
  page.openDeck(); assert.equal(page.data.screen.sheet, 'deck'); page.closeSheet();
  page.openLog(); assert.equal(page.data.screen.sheet, 'log'); page.closeSheet();
  page.selectAlly(event('id', page.data.screen.run.party[0].id));
  assert.equal(page.data.screen.sheet, 'ally');
  assert.ok(page.data.screen.inspected.passiveDescription);
  page.closeSheet();
  const enemyId = page.data.screen.run.enemies[0].id;
  page.selectEnemy(event('id', enemyId));
  assert.equal(page.data.screen.sheet, 'enemy');
  assert.equal(page.data.screen.inspected.id, enemyId);
  assert.equal(typeof page.data.screen.inspected.intentShort, 'string');
  page.closeSheet();
  selectAttack(page); page.openCard();
  assert.equal(page.data.screen.sheet, 'card');
  page.closeSheet(); page.selectCard(event('uid', page.data.screen.selected.uid));
  assert.equal(page.data.screen.selected, null);
  page.askAbandon(); assert.equal(page.data.screen.sheet, 'abandon'); page.closeSheet();
  assert.equal(h.controls.commits, 0);
  assert.equal(h.writes.length, 0);
  assert.deepEqual(clone(h.app.state), before);
});

test('攻击护盾灼烧虚弱和召唤意图拆成目标/效果两行，无行动提示完整保留', () => {
  const cases = [
    { id: 'paper-ball', intent: 0, target: '羊咩咩团', effect: '6伤害' },
    { id: 'paper-ball', intent: 1, target: '自身', effect: '4护盾' },
    { id: 'wax-drop', intent: 0, target: '羊咩咩团', effect: '灼烧2' },
    { id: 'stamp-moth', intent: 0, target: '羊咩咩团', effect: '虚弱1回合' }
  ];
  for (const sample of cases) {
    const state = inBattle();
    const enemy = state.adventure.active.enemies[0];
    enemy.definitionId = sample.id;
    enemy.hp = enemy.maxHp = ENEMY_BY_ID[sample.id].maxHp;
    enemy.intentIndex = sample.intent;
    const h = harness(state);
    const page = h.expedition();
    const shown = page.data.screen.run.enemies[0];
    const original = combat.getAdventureView(h.app.state).run.enemies[0];
    assert.equal(shown.intentTargetLine, sample.target);
    assert.equal(shown.intentEffectLine, sample.effect);
    assert.equal(shown.intentNote, '');
    assert.equal(shown.intentText, original.intentText);
    page.selectEnemy(event('id', shown.id));
    assert.equal(page.data.screen.inspected.intentText, original.intentText);
    assert.equal(h.writes.length, 0);
    assert.deepEqual(clone(h.app.state), state);
  }
  const unlocked = game.createState();
  unlocked.adventure.clears.street[0] = 1;
  unlocked.adventure.clears.bridge[0] = 1;
  let summon = combat.startExpedition(unlocked, 'market', 0, 42).state;
  const run = summon.adventure.active;
  run.layer = 8;
  run.nodes.forEach((node, index) => { node.visited = index < 8; node.chosenId = index < 8 ? node.options[0].id : null; });
  summon = combat.applyAction(summon, { type: 'chooseNode', nodeId: run.nodes[8].options[0].id }).state;
  const summoned = harness(summon).expedition().data.screen.run.enemies[0];
  assert.equal(summoned.intentTargetLine, '召唤');
  assert.equal(summoned.intentEffectLine, ENEMY_BY_ID['lantern-mote'].name);
  const stopped = inBattle();
  stopped.adventure.active.enemies[0].status.burn = stopped.adventure.active.enemies[0].hp;
  const note = harness(stopped).expedition().data.screen.run.enemies[0];
  assert.equal(note.intentEffectLine, '');
  assert.equal(note.intentTargetLine, '');
  assert.equal(note.intentNote, '行动前将被阻止');
  assert.equal(note.intentText, combat.getAdventureView(stopped).run.enemies[0].intentText);
});

test('灼烧与敌人攻击的生命飘字来自实际生命变化，不能显示为治疗', () => {
  const state = inBattle();
  state.adventure.active.party[0].status.burn = 2;
  const h = harness(state);
  const page = h.expedition();
  const beforeHp = h.app.state.adventure.active.party[0].hp;
  page.endTurn();
  assert.equal(page.data.screen.run.party[0].impact, '');
  h.stepMotion();
  const unit = page.data.screen.run.party[0];
  assert.ok(unit.hp < beforeHp);
  assert.match(unit.impact, /^−\d+$/);
  assert.equal(unit.impactTone, 'hurt');
  assert.equal(unit.hitTarget, true);
});

test('敌人仅按实际行动事件前冲或施法，重复结束回合只提交一次且表现不消耗随机数', () => {
  for (const sample of [
    { id: 'paper-ball', intent: 0, motion: 'enemy-strike' },
    { id: 'paper-ball', intent: 1, motion: 'enemy-spell' },
    { id: 'stamp-moth', intent: 0, motion: 'enemy-spell' }
  ]) {
    const state = inBattle();
    const enemy = state.adventure.active.enemies[0];
    enemy.definitionId = sample.id; enemy.intentIndex = sample.intent;
    enemy.hp = enemy.maxHp = ENEMY_BY_ID[sample.id].maxHp;
    const expected = combat.applyAction(state, { type: 'endTurn' }).state;
    const h = harness(state); const page = h.expedition();
    page.endTurn(); page.endTurn();
    assert.equal(page.data.screen.battleEnemies[0].motion, sample.motion);
    assert.equal(h.controls.commits, 1);
    assert.equal(h.timers.size, 1);
    assert.deepEqual(clone(h.app.state), expected);
    h.flushMotion();
    assert.equal(page.data.screen.battleEnemies[0].motion, '');
    assert.equal(h.writes.length, 1);
    assert.deepEqual(clone(h.app.state), expected);
  }
  const burned = inBattle();
  burned.adventure.active.enemies[0].status.burn = burned.adventure.active.enemies[0].hp;
  const stopped = harness(burned); const stoppedPage = stopped.expedition();
  stoppedPage.endTurn();
  assert.equal(stoppedPage.data.screen.battleEnemies[0].motion, '', '行动前被灼烧击败的敌人不播放主动行动');
  assert.equal(stoppedPage._battleTimeline.some(frame => frame.events.some(event => event.kind === 'enemyAction')), false);
  stopped.flushMotion();
  assert.equal(stopped.app.state.adventure.active.phase, 'cardReward');
});

test('击败部分敌人保留原排位至受击阶段结束，不重复结算', () => {
  const state = lethalAttackState();
  const run = state.adventure.active;
  run.enemies.push({ ...clone(run.enemies[0]), id: 'enemy-2', hp: run.enemies[0].maxHp });
  run.nextEnemyId = 3;
  const h = harness(state); const page = h.expedition();
  selectAttack(page); page.confirmPlay(); page.confirmPlay();
  assert.equal(h.app.state.adventure.active.phase, 'battle');
  assert.deepEqual(clone(page.data.screen.run.enemies.map(enemy => enemy.id)), ['enemy-1', 'enemy-2']);
  assert.deepEqual(clone(page.data.screen.battleEnemies.map(enemy => enemy.id)), ['enemy-1', 'enemy-2']);
  h.stepMotion();
  assert.equal(page.data.screen.battleEnemies[0].leaving, true);
  assert.equal(page.data.screen.battleEnemies[0].hp, 0);
  assert.equal(page.data.screen.battleEnemies[0].impactTone, 'hurt');
  assert.equal(page.data.screen.battleEnemies[0].exitMotion, true);
  assert.equal(page.data.screen.enemyExit, false);
  assert.equal(h.timerDelays.at(-1), 700);
  const saved = clone(h.app.state);
  h.flushMotion();
  assert.equal(page._enemyFrame, null);
  assert.deepEqual(clone(page.data.screen.run.enemies.map(enemy => enemy.id)), ['enemy-2']);
  assert.deepEqual(clone(page.data.screen.battleEnemies.map(enemy => enemy.id)), ['enemy-2']);
  assert.equal(h.writes.length, 1);
  assert.deepEqual(clone(h.app.state), saved);
});

test('最后一敌退场时奖励已入库，后台清理后立即领取且不重放退场', () => {
  const h = harness(lethalAttackState()); const page = h.expedition();
  selectAttack(page); page.confirmPlay();
  assert.equal(h.app.state.adventure.active.phase, 'cardReward');
  assert.equal(h.app.state.adventure.threads, 4);
  assert.equal(page.data.screen.view.run.phase, 'cardReward');
  assert.equal(page.data.screen.run.phase, 'battle');
  assert.equal(page.data.screen.battleEnemies[0].exitMotion, false);
  h.stepMotion();
  assert.equal(page.data.screen.battleEnemies[0].exitMotion, true);
  assert.equal(page.data.screen.battleEnemies[0].leaving, true);
  assert.equal(h.writes.length, 1);
  const saved = clone(h.app.state);
  page.onHide();
  assert.equal(page._enemyFrame, null);
  assert.equal(h.timers.size, 0);
  page.onShow(); h.flushMotion();
  assert.equal(page.data.screen.run.phase, 'cardReward');
  assert.equal(page.data.screen.enemyExit, false);
  assert.equal(page.data.screen.battleFx.length, 0);
  assert.equal(page.data.screen.receipt.kind, 'battle-win');
  assert.equal(page.data.screen.receipt.rewardAmount, 4, '同一页面后台恢复保留已提交事件的真实单场金额');
  assert.equal(page.data.screen.receipt.threads, 4);
  assert.deepEqual(clone(h.app.state), saved);
  page.skipCard();
  assert.equal(h.writes.length, 1, '未确认回执不能越过战利品门槛');
  page.continueReceipt();
  assert.equal(page.data.screen.receipt, null);
  page.skipCard();
  assert.equal(h.app.state.adventure.active.phase, 'map');
  assert.equal(h.writes.length, 2);
});

test('普通与精英胜利回执等待玩家确认，并只展示真实战斗收益', () => {
  for (const [initial, kind, reward] of [[lethalAttackState(), 'battle-win', 4], [lethalAttackState(atNode('elite')), 'elite-win', 8]]) {
    const h = harness(initial); const page = h.expedition();
    selectAttack(page); page.confirmPlay();
    assert.equal(page.data.screen.receipt, null, '末击动作完成前不盖住命中读数');
    h.flushMotion();
    assert.equal(page.data.screen.receipt.kind, kind);
    assert.equal(page.data.screen.receipt.rewardAmount, reward);
    assert.equal(page.data.screen.receipt.turn, initial.adventure.active.turn);
    assert.equal(page.data.screen.receipt.party.length, initial.adventure.active.party.length);
    assert.equal(h.app.audio.getStatus().lastEffect, 'victory');
    assert.equal(h.writes.length, 1);
    page.continueReceipt();
    assert.equal(page.data.screen.receipt, null);
    assert.equal(h.writes.length, 1, '确认只开放已保存的战利品，不重复提交收益');
  }
});

test('Boss行动完整经过800蓄势、1200命中读数与300间歇，读数结束前不会换帧', () => {
  const h = harness(atNode('boss')); const page = h.expedition();
  page.endTurn();
  assert.equal(page.data.screen.activeFrame.timingKind, 'boss');
  assert.equal(page.data.screen.turnAction.phaseLabel, '蓄势');
  assert.equal(h.timerDelays.at(-1), 800);
  h.stepMotion();
  assert.equal(page.data.screen.beat, 'impact');
  assert.equal(page.data.screen.turnAction.phaseLabel, '命中读数');
  assert.equal(h.timerDelays.at(-1), 1200);
  const frameId = page.data.screen.activeFrame.id;
  h.stepMotion();
  assert.equal(page.data.screen.beat, 'gap');
  assert.equal(page.data.screen.activeFrame.id, frameId);
  assert.equal(page.data.screen.turnAction.phaseLabel, '间歇');
  assert.equal(h.timerDelays.at(-1), 300);
});

test('Boss切阶段显示新阶段出场图，最终击败才退场且邮票奖励不等待动画', () => {
  const first = harness(lethalAttackState(atNode('boss'))); const firstPage = first.expedition();
  selectAttack(firstPage); firstPage.confirmPlay();
  const boss = firstPage.data.screen.battleEnemies[0];
  assert.equal(boss.phase, 1, 'action阶段保留首阶段轮廓');
  first.stepMotion();
  const phasedBoss = firstPage.data.screen.battleEnemies[0];
  assert.equal(phasedBoss.phase, 2);
  assert.equal(phasedBoss.image, imageFor(phasedBoss, 'street', 'enter'));
  assert.equal(phasedBoss.actionState, 'enter');
  assert.equal(Boolean(phasedBoss.leaving), false);
  assert.equal(firstPage._enemyFrame, null);
  assert.equal(firstPage.data.screen.enemyExit, false);
  assert.equal(first.app.state.adventure.active.phase, 'battle');
  assert.equal(first.app.state.adventure.threads, 0);
  const final = harness(lethalAttackState(first.app.state)); const finalPage = final.expedition();
  const beforeTickets = final.app.state.tickets;
  selectAttack(finalPage); finalPage.confirmPlay();
  assert.equal(final.app.state.adventure.active, null);
  assert.equal(final.app.state.adventure.lastResult.win, true);
  assert.equal(final.app.state.tickets, beforeTickets + 4);
  assert.equal(final.app.state.adventure.threads, 12);
  assert.equal(finalPage.data.screen.run.phase, 'battle');
  final.stepMotion();
  assert.equal(finalPage.data.screen.battleEnemies[0].image, imageFor(finalPage.data.screen.battleEnemies[0], 'street', 'exit'));
  finalPage.closeResult();
  assert.equal(final.writes.length, 1);
  final.flushMotion();
  assert.equal(finalPage.data.screen.receipt.kind, 'final-win');
  assert.equal(finalPage.data.screen.receipt.rewardAmount, 12);
  assert.equal(finalPage.data.screen.receipt.tickets, 4);
  assert.equal(final.app.audio.getStatus().lastEffect, 'victory');
  const saved = clone(final.app.state);
  finalPage.onUnload();
  assert.equal(finalPage._enemyFrame, null);
  assert.equal(final.timers.size, 0);
  const reopened = final.expedition();
  assert.equal(reopened.data.screen.enemyExit, false);
  assert.equal(reopened.data.screen.receipt.kind, 'final-win');
  assert.equal(reopened.data.screen.receipt.rewardAmount, 0, '旧回执没有本次事件时不虚构单战金额');
  assert.equal(reopened.data.screen.receipt.party.length, 0, '旧结果没有队伍快照时不冒用当前编队');
  assert.deepEqual(clone(final.app.state), saved);
  reopened.continueReceipt();
  assert.equal(final.writes.length, 2);
  assert.equal(final.app.state.tickets, beforeTickets + 4);
});

test('动画期间切走页面取消计时器，重新显示不重算或重放已结算行动', () => {
  const h = harness(inBattle());
  const page = h.expedition();
  selectAttack(page); page.confirmPlay();
  assert.equal(h.writes.length, 1);
  assert.equal(page.data.screen.busy, true);
  assert.equal(h.timers.size, 1);
  const saved = clone(h.app.state);
  page.onHide();
  assert.equal(h.timers.size, 0);
  page.onShow(); h.flushMotion(); page.confirmPlay();
  assert.equal(page.data.screen.busy, false);
  assert.equal(h.writes.length, 1);
  assert.deepEqual(clone(h.app.state), saved);
  page.onUnload();
  assert.equal(h.timers.size, 0);
});

test('致命出牌保存失败时不改资源与战局，也不显示成功退场', () => {
  const h = harness(lethalAttackState());
  const page = h.expedition();
  selectAttack(page);
  const before = clone(h.app.state);
  const soundsBefore = h.app.audio.getStatus().effectStarts;
  h.controls.failWrites = true;
  page.confirmPlay();
  assert.equal(h.controls.commits, 1);
  assert.equal(h.writes.length, 0);
  assert.equal(h.app.audio.getStatus().effectStarts, soundsBefore, '保存失败不得播放攻击或奖励音');
  assert.deepEqual(clone(h.app.state), before);
  assert.equal(h.timers.size, 0);
  assert.equal(page._busy, false);
  assert.equal(page._enemyFrame, null);
  assert.equal(page.data.screen.enemyExit, false);
  assert.equal(page.data.screen.run.phase, 'battle');
  assert.equal(page.data.screen.battleEnemies[0].hp, 1);
  assert.equal(h.notices.length, 1);
  assert.match(h.notices[0].title, /storage full/);
});

test('出牌声在保存后播放，后台取消尚未发生的命中音', () => {
  const h = harness(inBattle());
  const page = h.expedition();
  selectAttack(page);
  const before = h.app.audio.getStatus().effectStarts;
  page.confirmPlay();
  assert.equal(h.writes.length, 1);
  assert.equal(h.app.audio.getStatus().effectStarts, before + 1);
  assert.equal(h.app.audio.getStatus().lastEffect, 'attack');
  page.onHide(); h.app.onHide(); h.flushMotion();
  assert.equal(h.app.audio.getStatus().effectStarts, before + 1);
  h.app.onShow(); page.onShow(); h.flushMotion();
  assert.equal(h.app.audio.getStatus().effectStarts, before + 1, '回来不补播上次命中声');
  assert.equal(h.writes.length, 1);
});

test('首领战选择首领音乐，战后选牌和城镇恢复对应场景且不改进度', () => {
  for (const [state, scene] of [[atNode('boss'), 'boss'], [wonBattle(), 'street'], [game.createState(), 'town']]) {
    const h = harness(state);
    const page = h.expedition();
    page.refresh(); page.refresh();
    assert.equal(h.app.audio.getStatus().scene, scene);
    assert.deepEqual(clone(h.app.state), state);
    assert.equal(h.writes.length, 0);
  }
});

test('状态说明从记录打开可切全部机制，返回与关闭不改存档或选牌', () => {
  const h = harness(inBattle()); const page = h.expedition();
  const card = page.data.screen.run.hand[0]; page.selectCard(event('uid', card.uid));
  const before = clone(h.app.state);
  page.openLog(); page.openStatusGuide();
  assert.equal(page.data.screen.sheet, 'statuses');
  assert.equal(page.data.screen.statusTabs.length, 18);
  for (const id of ['charge', 'exhaust', 'retain', 'sequence', 'echo', 'mark', 'weak', 'burn', 'counter', 'retainBlock']) {
    page.selectStatusGuide(event('id', id));
    assert.equal(page.data.screen.statusHelp.id, id);
    assert(page.data.screen.statusHelp.rules.length >= 3);
    assert(page.data.screen.statusHelp.example);
  }
  page.selectStatusGuide(event('id', '__proto__'));
  assert.equal(page.data.screen.statusHelp.id, 'retainBlock');
  page.backFromStatusGuide();
  assert.equal(page.data.screen.sheet, 'log');
  assert.equal(page.data.screen.selected.uid, card.uid);
  page.closeSheet();
  assert.equal(page.data.screen.sheet, '');
  assert.deepEqual(clone(h.app.state), before);
  assert.equal(h.writes.length, 0);
});

test('单位详情进入状态说明会展示真实当前值，返回仍是原单位', () => {
  const state = inBattle(); state.adventure.active.party[0].status.echo = 2;
  const h = harness(state); const page = h.expedition();
  page.selectAlly(event('id', 'sheep')); page.openStatusGuide();
  assert.equal(page.data.screen.statusHelp.id, 'echo');
  assert.equal(page.data.screen.statusOwner.value, 2);
  page.selectStatusGuide(event('id', 'weak'));
  assert.equal(page.data.screen.statusOwner.value, 0);
  page.backFromStatusGuide();
  assert.equal(page.data.screen.sheet, 'ally');
  assert.equal(page.data.screen.inspected.id, 'sheep');
  assert.equal(h.writes.length, 0);
  assert.deepEqual(clone(h.app.state), state);
});

test('高稀有开局升级和营地升级/休息事件正确映射到公开动作', () => {
  const high = game.createState(); high.collection.sheep.SSR = 1;
  const h = harness(high); h.hub().start();
  const page = h.expedition();
  assert.equal(page.data.screen.run.phase, 'startingUpgrade');
  page.upgradeCard(event('uid', page.data.screen.run.choices[0].uid));
  assert.equal(page.data.screen.run.phase, 'map');
  assert.equal(h.app.state.adventure.active.deck.filter(card => card.upgraded).length, 1);
  assert.equal(h.writes.length, 2);
  const camp = harness(atNode('camp')); const campPage = camp.expedition();
  campPage.showUpgrade();
  assert.equal(campPage.data.screen.run.phase, 'campUpgrade');
  const uid = campPage.data.screen.run.choices[0].uid;
  campPage.upgradeCard(event('uid', uid));
  assert.equal(campPage.data.screen.run.phase, 'map');
  assert.equal(camp.app.state.adventure.active.deck.find(card => card.uid === uid).upgraded, true);
  assert.equal(camp.writes.length, 2);
  const resting = atNode('camp'); resting.adventure.active.party.forEach(member => { member.hp = 1; });
  const rest = harness(resting); rest.expedition().rest();
  assert.equal(rest.writes.length, 1);
  assert.equal(rest.app.state.adventure.active.phase, 'map');
  assert.ok(rest.app.state.adventure.active.party.every(member => member.hp > 1));
});

test('卡牌领取/跳过、遗物领取和奇遇选择使用正确ID，重复领取不重复结算', () => {
  const won = wonBattle();
  const card = harness(won); const cardPage = card.expedition();
  const uid = cardPage.data.screen.run.choices[0].uid;
  cardPage.continueReceipt();
  cardPage.chooseCard(event('uid', uid)); cardPage.chooseCard(event('uid', uid));
  assert.equal(card.writes.length, 1);
  assert.equal(card.app.state.adventure.active.deck.length, 13);
  assert.equal(card.app.state.adventure.threads, won.adventure.threads);
  const skipped = harness(won); const skippedPage = skipped.expedition(); skippedPage.continueReceipt(); skippedPage.skipCard();
  assert.equal(skipped.writes.length, 1);
  assert.equal(skipped.app.state.adventure.active.deck.length, 12);
  const treasure = harness(atNode('treasure')); const treasurePage = treasure.expedition();
  const before = treasure.app.state.adventure.threads;
  const id = treasurePage.data.screen.run.choices[0].id;
  assert.equal(treasurePage.data.screen.receipt, null, '宝箱遗物不是精英胜利回执');
  treasurePage.chooseRelic(event('id', id)); treasurePage.chooseRelic(event('id', id));
  assert.equal(treasure.writes.length, 1);
  assert.ok(treasure.app.state.adventure.active.relics.includes(id));
  assert.equal(treasure.app.state.adventure.threads, before);
  const encounter = harness(atNode('event')); const encounterPage = encounter.expedition();
  const choice = encounterPage.data.screen.run.choices[0];
  encounterPage.chooseEvent(event('id', choice.id));
  assert.equal(encounter.writes.length, 1);
  assert.equal(encounter.app.state.adventure.active.phase, 'map');
  assert.equal(encounter.app.state.adventure.threads, choice.threads);
});

test('关闭已胜利的结算只清除回执，重复关闭不再获得星线或Boss邮票', () => {
  const completed = wonBattle(atNode('boss'));
  assert.equal(completed.adventure.lastResult.win, true);
  const h = harness(completed);
  const page = h.expedition();
  const { tickets } = h.app.state;
  const { threads, clears } = clone(h.app.state.adventure);
  assert.equal(page.data.screen.receipt.kind, 'final-win');
  page.continueReceipt(); page.closeResult();
  assert.equal(h.app.state.adventure.lastResult, null);
  assert.equal(h.app.state.adventure.active, null);
  assert.equal(h.app.state.tickets, tickets);
  assert.equal(h.app.state.adventure.threads, threads);
  assert.deepEqual(clone(h.app.state.adventure.clears), clears);
  assert.ok(h.navigation.every(url => url === '/pages/adventure/index'));
});

test('蓄能HUD和连锁说明读取共享战局，不把全队资源误显示成个人状态', () => {
  const saved = combat.applyAction(combat.startExpedition(game.createState(), 'street', 0, 42, 'relay').state, { type: 'chooseNode', nodeId: 'node-0-0' }).state;
  saved.adventure.active.charge = 2; saved.adventure.active.plays = 2;
  const h = harness(saved), page = h.expedition(), before = clone(h.app.state);
  page.openTacticGuide();
  assert.equal(page.data.screen.statusHelp.id, 'charge');
  assert.match(page.data.screen.tacticStatus, /2\s*\/\s*3/);
  assert.equal(page.data.screen.run.plays, 2);
  page.selectStatusGuide(event('id', 'sequence'));
  assert.match(page.data.screen.tacticStatus, /下一张是第 3 张/);
  page.closeSheet(); page.selectAlly(event('id', 'sheep')); page.openStatusGuide();
  for (const id of ['charge', 'sequence', 'retain', 'exhaust']) {
    page.selectStatusGuide(event('id', id));
    assert.equal(page.data.screen.statusOwner, null);
    assert.match(page.data.screen.statusRuleNote, /蓄能属于全队/);
  }
  assert.deepEqual(clone(h.app.state), before);
  assert.equal(h.writes.length, 0);
});

function economyBattle(tactic, cardId) {
  const started = combat.startExpedition(game.createState(), 'street', 0, 42, tactic).state;
  const state = combat.applyAction(started, { type: 'chooseNode', nodeId: 'node-0-0' }).state;
  const run = state.adventure.active, card = run.deck.find(item => item.cardId === cardId);
  run.hand = [card.uid]; run.drawPile = run.deck.filter(item => item.uid !== card.uid).map(item => item.uid); run.discardPile = []; run.removed = [];
  return state;
}

test('发现与观星候选持久化，返回重开仍相同，选择只提交一次且不自动打出', () => {
  for (const [tactic, cardId, kind] of [['relay', 'quick-sketch', 'discover'], ['reserve', 'wax-spark', 'scout']]) {
    const h = harness(economyBattle(tactic, cardId)), page = h.expedition();
    page.selectCard(event('uid', page.data.screen.run.hand[0].uid)); page.confirmPlay();
    assert.equal(h.writes.length, 1);
    assert.equal(h.app.state.adventure.active.pendingChoice.kind, kind);
    h.flushMotion();
    assert.equal(page.data.screen.run.pendingChoice.options.length, 3);
    const choices = clone(page.data.screen.run.pendingChoice.options);
    page.goHub();
    const reopened = harness(clone(h.app.state)), resumed = reopened.expedition();
    assert.deepEqual(clone(resumed.data.screen.run.pendingChoice.options), choices);
    const energy = resumed.data.screen.run.energy, charge = resumed.data.screen.run.charge;
    const choice = choices[0]; resumed.chooseOpportunity(event('id', choice.choiceId)); resumed.chooseOpportunity(event('id', choice.choiceId));
    assert.equal(reopened.writes.length, 1);
    assert.equal(resumed.data.screen.run.pendingChoice, null);
    assert.equal(resumed.data.screen.run.energy, energy); assert.equal(resumed.data.screen.run.charge, charge);
    assert(resumed.data.screen.run.hand.some(card => card.cardId === choice.cardId));
    assert.equal(resumed.data.screen.run.temporaryCards.length, kind === 'discover' ? 1 : 0);
  }
});

test('发现卡保存失败不展示候选、不消耗原牌；改签付费但不触发连锁', () => {
  const h = harness(economyBattle('relay', 'quick-sketch')), page = h.expedition();
  const before = clone(h.app.state); h.controls.failWrites = true;
  page.selectCard(event('uid', page.data.screen.run.hand[0].uid)); page.confirmPlay();
  assert.deepEqual(clone(h.app.state), before); assert.equal(page.data.screen.run.pendingChoice, null);
  assert.equal(h.writes.length, 0);
  h.controls.failWrites = false;
  page.openCard(); const uid = page.data.screen.selected.uid; page.tradeSelected();
  assert.equal(h.writes.length, 1);
  assert.equal(h.app.state.adventure.active.plays, 0);
  assert.equal(h.app.state.adventure.active.energy, 2);
  assert(!h.app.state.adventure.active.hand.includes(uid));
  assert.equal(h.app.state.adventure.active.drawPile[0], uid);
  assert.equal(page.data.screen.sheet, '');
});

test('环境从真实出牌进入HUD与说明，回合结束按规则消退', () => {
  const h = harness(economyBattle('weather', 'folded-corner')), page = h.expedition();
  page.selectCard(event('uid', page.data.screen.run.hand[0].uid)); page.confirmPlay(); h.flushMotion();
  assert.equal(page.data.screen.run.environmentId, 'rain');
  assert.match(page.data.screen.run.conditionLabel, /雨幕/);
  page.openTacticGuide(); assert.equal(page.data.screen.statusHelp.id, 'environment');
  assert.match(page.data.screen.tacticStatus, /-2/); page.closeSheet();
  page.endTurn(); h.flushMotion(); assert.equal(page.data.screen.run.environmentId, null);
});

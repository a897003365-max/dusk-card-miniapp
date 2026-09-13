"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const combat = require('../utils/combat');
const { createState } = require('../utils/game');
const {
  TIMINGS,
  intentMeta,
  buildBattleTimeline,
  impactForUnit,
  buildBattleFx,
  buildFramePresentation,
  applyEventsToUnits,
} = require("../utils/battle-feedback");

const units = {
  party: [
    { id: "sheep", name: "羊咩咩团", hp: 20, maxHp: 20, block: 0, status: {} },
    { id: "orangecat", name: "橘猫豆包", hp: 20, maxHp: 20, block: 0, status: {} },
  ],
  enemies: [
    { id: "enemy-1", definitionId: "paper-ball", rank: "normal", hp: 20, maxHp: 20, block: 0, phase: 1, status: {} },
    { id: "enemy-2", definitionId: "paper-ball", rank: "normal", hp: 20, maxHp: 20, block: 0, phase: 1, status: {} },
  ],
  points: {
    "enemy-1": { x: 100, y: 60 },
    "enemy-2": { x: 130, y: 60 },
    sheep: { x: 180, y: 240 },
    orangecat: { x: 300, y: 240 },
  },
};

test("battle timeline按enemyAction顺序逐敌分帧，前置DOT归system", () => {
  const events = [
    { kind: "burn", actorId: null, targetId: "enemy-1", amount: 2, hpDelta: -2 },
    { kind: "enemyAction", actorId: "enemy-1", intentKind: "attack", intentName: "扑击", intentTargets: [{ id: "sheep", name: "羊咩咩团", amount: 3 }] },
    { kind: "damage", actorId: "enemy-1", targetId: "sheep", hpDelta: -3, amount: 3 },
    { kind: "enemyAction", actorId: "enemy-2", intentKind: "attack", intentName: "冲撞", intentTargets: [{ id: "orangecat", name: "橘猫豆包", amount: 4 }] },
    { kind: "damage", actorId: "enemy-2", targetId: "orangecat", hpDelta: -4, amount: 4 },
  ];
  const frames = buildBattleTimeline(events, "endTurn", units);
  assert.equal(frames.length, 3);
  assert.equal(frames[0].actorKind, "system");
  assert.equal(frames[0].actionMs, TIMINGS.prelude.actionMs);
  assert.equal(frames[0].impactMs, TIMINGS.prelude.impactMs);
  assert.deepEqual(frames.slice(1).map(frame => frame.actorId), ["enemy-1", "enemy-2"]);
  assert.deepEqual(frames.slice(1).map(frame => frame.events[0].kind), ["enemyAction", "enemyAction"]);
});

test("蓄能在新回合以独立系统帧明确显示为额外能量", () => {
  const frames = buildBattleTimeline([
    { kind: 'chargeRelease', actorId: null, targetId: null, amount: 1, presentation: 'turn-start' },
    { kind: 'draw', actorId: null, targetId: null, amount: 5, presentation: 'turn-start' },
  ], 'endTurn', units);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].actorKind, 'system');
  assert.equal(frames[0].actionLabel, '蓄能释放');
  assert.equal(frames[0].impactMs, TIMINGS.prelude.impactMs);
});

test("playCard帧识别为player并使用220/700时序", () => {
  const frames = buildBattleTimeline([
    { kind: "playCard", actorId: "sheep", targetId: "enemy-1", text: "重击" },
    { kind: "damage", actorId: "sheep", targetId: "enemy-1", hpDelta: -5, amount: 5 },
  ], "playCard", units);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].actorKind, "player");
  assert.equal(frames[0].actionMs, TIMINGS.player.actionMs);
  assert.equal(frames[0].impactMs, TIMINGS.player.impactMs);
  assert.equal(frames[0].gapMs, 0);
});

test("Boss帧使用800蓄势、1200命中读数和300间歇，普通敌人不被拖慢", () => {
  const bossUnits = {
    ...units,
    enemies: [{ ...units.enemies[0], definitionId: "paper-lion", rank: "boss" }]
  };
  const action = { kind: "enemyAction", actorId: "enemy-1", intentKind: "attack", intentName: "纸刃", intentTargets: [{ id: "sheep", name: "羊咩咩团", amount: 6 }] };
  const boss = buildBattleTimeline([action, { kind: "damage", actorId: "enemy-1", targetId: "sheep", hpDelta: -6, amount: 6 }], "endTurn", bossUnits)[0];
  assert.deepEqual([boss.actionMs, boss.impactMs, boss.gapMs, boss.timingKind], [800, 1200, 300, "boss"]);
  const ordinary = buildBattleTimeline([action, { kind: "damage", actorId: "enemy-1", targetId: "sheep", hpDelta: -6, amount: 6 }], "endTurn", units)[0];
  assert.deepEqual([ordinary.actionMs, ordinary.impactMs, ordinary.gapMs], [360, 700, 0]);
});

test("全体卡只剩一个目标仍保留all目标模式", () => {
  const frames = buildBattleTimeline([
    { kind: "playCard", actorId: "sheep", targetId: null, targetKind: "allEnemies", targetIds: ["enemy-1"], text: "全体出牌" },
    { kind: "damage", actorId: "sheep", targetId: "enemy-1", hpDelta: -3, amount: 3 },
  ], "playCard", units);
  assert.equal(frames[0].targetMode, "all");
  assert.deepEqual(frames[0].targetIds, ["enemy-1"]);
  const fx = buildBattleFx(frames[0], "action", { ...units, points: units.points });
  assert.equal(fx.length, 1);
  assert.equal(fx[0].range, "all");
});

test("单体卡附带自疗只把敌人锁为攻击目标", () => {
  const frames = buildBattleTimeline([
    { kind: "playCard", actorId: "sheep", targetId: "enemy-1", targetKind: "enemy", targetIds: ["enemy-1"], text: "单体出牌" },
    { kind: "damage", actorId: "sheep", targetId: "enemy-1", hpDelta: -3, amount: 3 },
    { kind: "heal", actorId: "sheep", targetId: "sheep", hpDelta: 2, amount: 2 },
  ], "playCard", units);
  assert.equal(frames[0].targetMode, "single");
  assert.deepEqual(frames[0].targetIds, ["enemy-1"]);
});

test("显式intentAll=false不被旧的全体文字误判为全体", () => {
  const enemy = { id: "enemy-1", intentText: "全体潮汐冲击", intentShort: "全队 · 3伤害" };
  const action = { intentKind: "attack", intentName: "冲击", intentAll: false, intentTargets: [{ id: "sheep", name: "羊咩咩团", amount: 3 }] };
  const meta = intentMeta(enemy, action);
  assert.equal(meta.intentAll, false);
  assert.equal(meta.intentScope, "单体");
  assert.equal(meta.intentTargetLabel, "羊咩咩团");
});

test("impactForUnit分开掉血、治疗、格挡和护盾，不把纯格挡当掉血", () => {
  const feedback = impactForUnit([
    { kind: "damage", targetId: "sheep", hpDelta: 0, blocked: 5 },
    { kind: "block", targetId: "sheep", amount: 3 },
    { kind: "heal", targetId: "sheep", hpDelta: 4 },
  ], "sheep");
  assert.equal(feedback.damage, 0);
  assert.equal(feedback.heal, 4);
  assert.equal(feedback.blocked, 5);
  assert.equal(feedback.shield, 3);
  assert.equal(feedback.guarded, true);
  assert.equal(feedback.impactTone, "heal");
  assert.equal(feedback.lines.some(line => line.kind === "damage"), false);
});

test("enemyAction格挡事件把自身护盾写入展示快照", () => {
  const result = applyEventsToUnits([{ ...units.enemies[0] }], [
    { kind: "enemyAction", actorId: "enemy-1", intentKind: "block", amount: 6, intentTargets: [] },
  ], units.enemies);
  assert.equal(result[0].block, 6);
});

test("enemyAction攻击清除旧护盾并只保留行动前armor", () => {
  const result = applyEventsToUnits([{ ...units.enemies[0], block: 9 }], [
    { kind: "enemyAction", actorId: "enemy-1", intentKind: "attack", armor: 2, intentTargets: [] },
  ], units.enemies);
  assert.equal(result[0].block, 2);
});

test("单体和全体战斗特效只绘制声明的目标范围", () => {
  const single = buildBattleFx({
    id: "enemy-1-0-enemy-1", actorId: "enemy-1", actorKind: "enemy", intentKind: "attack", intentAll: false,
    intentTargetIds: ["sheep"], targetIds: ["sheep"], events: [], theme: { id: "paper", actionClass: "light-cast", impactClass: "light-hit" },
  }, "action", units);
  assert.deepEqual(single.map(item => item.targetId), ["sheep"]);
  assert.equal(single.some(item => item.range === "all"), false);
  const all = buildBattleFx({
    id: "enemy-1-0-enemy-1", actorId: "enemy-1", actorKind: "enemy", intentKind: "attack", intentAll: true,
    intentTargetIds: ["sheep"], targetIds: ["sheep", "orangecat"], events: [], theme: { id: "paper", actionClass: "light-cast", impactClass: "light-hit" },
  }, "action", units);
  assert.equal(all.length, 1);
  assert.equal(all[0].range, "all");
});

test("Boss phase帧不提前复制后续最终生命和状态", () => {
  const previous = { party: [], enemies: [{ ...units.enemies[0], id: "boss-1", definitionId: "paper-lion", phase: 1, hp: 1, maxHp: 10, status: { mark: 0 } }] };
  const final = { party: [], enemies: [{ ...previous.enemies[0], phase: 2, hp: 12, maxHp: 20, status: { mark: 3 } }] };
  const frames = [{ index: 0, events: [{ kind: "bossPhase", targetId: "boss-1", amount: 20, hpDelta: 0 }] }];
  const presentation = buildFramePresentation(0, "impact", frames, previous, final);
  const shown = presentation.enemies[0];
  assert.equal(shown.phase, 2);
  assert.equal(shown.hp, 20);
  assert.notEqual(shown.hp, final.enemies[0].hp);
  assert.notEqual(shown.status.mark, final.enemies[0].status.mark);
  assert.equal(buildFramePresentation(0, "gap", frames, previous, final).enemies[0].phase, 2, "间歇阶段保留已读出的命中结果");
});

test('真实规则中下一敌人的灼烧与新回合抽牌独立归属，事件顺序不变', () => {
  const started = combat.startExpedition(createState(), 'street', 0, 42).state;
  const state = combat.applyAction(started, { type: 'chooseNode', nodeId: started.adventure.active.nodes[0].options[0].id }).state;
  // 仅 Node 内存构造双敌局面，用真实 resolver 验证每敌灼烧的边界。
  state.adventure.active.enemies.push({ ...JSON.parse(JSON.stringify(state.adventure.active.enemies[0])), id: 'enemy-2' });
  state.adventure.active.nextEnemyId = 3;
  state.adventure.active.enemies[1].status.burn = 2;
  const previous = { party: state.adventure.active.party, enemies: state.adventure.active.enemies };
  const before = JSON.stringify(state);
  const result = combat.applyAction(state, { type: 'endTurn' });
  const frames = buildBattleTimeline(result.events, 'endTurn', previous);
  const burned = frames.find(frame => frame.events.some(event => event.kind === 'burn' && event.targetId === 'enemy-2' && event.hpDelta < 0));
  assert.equal(burned.actorKind, 'system');
  assert.equal(burned.theme.id, 'paper');
  const drew = frames.find(frame => frame.events.some(event => event.kind === 'draw'));
  assert.equal(drew.actorKind, 'system');
  assert.equal(drew.actionLabel, '蓄能释放');
  assert(frames.filter(frame => frame.actorKind === 'enemy').every(frame => frame.events.every(event => !event.presentation)));
  assert.deepEqual(frames.flatMap(frame => frame.events), result.events);
  assert.equal(JSON.stringify(state), before);
});

test('敌人在行动前被灼烧全部击败，掉血和胜利始终归系统帧', () => {
  const started = combat.startExpedition(createState(), 'street', 0, 42).state;
  const state = combat.applyAction(started, { type: 'chooseNode', nodeId: started.adventure.active.nodes[0].options[0].id }).state;
  state.adventure.active.enemies.forEach(enemy => { enemy.hp = 1; enemy.status.burn = 2; });
  const result = combat.applyAction(state, { type: 'endTurn' });
  const frames = buildBattleTimeline(result.events, 'endTurn', { party: state.adventure.active.party, enemies: state.adventure.active.enemies });
  assert.equal(result.state.adventure.active.phase, 'cardReward');
  assert(frames.every(frame => frame.actorKind === 'system'));
  assert.deepEqual(frames.flatMap(frame => frame.events), result.events);
});

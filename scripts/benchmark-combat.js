#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const game = require('../utils/game');
const combat = require('../utils/combat');
const { FAMILIES } = require('../utils/content');
const { STARTING_TACTICS } = require('../utils/combat-content');
const { chooseFromView } = require('../tests/helpers/adventure-policy');

const BASE_SEEDS = [42, 12345, 824596, 987654321, 31415926, 27182818, 16180339, 8675309];
const LIMITATIONS = [
  '策略只读取公开视图与当前动作预览，不读取抽牌堆顺序、动作后的状态或未来随机数。',
  '三种权重是可重复的启发式策略，不代表最优玩家，也不用于单凭胜率证明玩法成熟度。',
  '实验固定R稀有度、等级、队伍、区域和种子；没有覆盖所有组队、升级路线、难度词缀与真人决策。',
  '区域解锁和预期等级属于开局前声明的实验条件；战斗开始后不注入手牌、生命、资源或伤害。'
];

function parseArgs(argv) {
  const options = { out: '' };
  for (const arg of argv) {
    if (arg === '--help') options.help = true;
    else if (arg.startsWith('--out=')) options.out = arg.slice('--out='.length);
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

function seeds(count) {
  const values = BASE_SEEDS.slice(0, count);
  let value = 0x6d2b79f5;
  while (values.length < count) {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    if (value && !values.includes(value)) values.push(value);
  }
  return values;
}

function experimentalState(team, level, regionId) {
  const state = game.createState();
  for (const family of FAMILIES) state.collection[family.id] = { R: 0, SR: 0, SSR: 0, UR: 0 };
  state.team = [...team];
  for (const id of team) {
    state.collection[id].R = 1;
    state.adventure.levels[id] = level;
  }
  if (regionId === 'bridge' || regionId === 'market') state.adventure.clears.street[0] = 1;
  if (regionId === 'market') state.adventure.clears.bridge[0] = 1;
  game.assertState(state);
  return state;
}

function newMetrics(config, seed) {
  return {
    seed, config: { label: config.label, team: [...config.team], style: config.style, tacticId: config.tacticId, regionId: config.regionId, level: config.level },
    win: false, nodesCleared: 0, actions: 0, policyPurityChecks: 0,
    battles: [], fourCost: { offers: 0, reachable: 0, plays: 0, energyPaid: 0 },
    trade: { count: 0, energyPaid: 0 }, wastedEnergy: 0, chargeLostAtBattleEnd: 0, chargeReleased: 0,
    chargeOverflowEvents: 0, zeroCostNonDamagePlays: 0, environmentPlays: 0, interceptPlays: 0,
    usefulCleanses: 0, pressure: { turns: 0, battles: 0, max: 0 }, downs: 0
  };
}

function runOne(config, seed) {
  let state = combat.startExpedition(experimentalState(config.team, config.level, config.regionId), config.regionId, 0, seed, config.tacticId).state;
  const metrics = newMetrics(config, seed);
  const fourOffers = new Set();
  const fourReachable = new Set();
  const pressureBattles = new Set();
  let activeBattle = null;

  for (let step = 0; step < 1200 && state.adventure.active; step += 1) {
    const view = combat.getAdventureView(state).run;
    if (view.phase === 'battle') {
      if (!activeBattle || activeBattle.layer !== view.layer) activeBattle = { layer: view.layer, type: view.nodes[view.layer].type, turns: view.turn };
      activeBattle.turns = Math.max(activeBattle.turns, view.turn);
      for (const card of view.hand.filter(item => item.cost === 4)) {
        const key = `${view.layer}:${view.turn}:${card.uid}`;
        fourOffers.add(key);
        if (card.playable) fourReachable.add(key);
      }
    }

    const beforePolicy = JSON.stringify(state);
    const action = chooseFromView(view, candidate => combat.previewAction(state, candidate), config.style);
    if (JSON.stringify(state) !== beforePolicy) throw new Error(`策略修改了输入状态：${config.label} seed=${seed}`);
    if (!action) throw new Error(`策略没有给出动作：${config.label} seed=${seed}`);
    metrics.policyPurityChecks += 1;

    const chosenCard = view.phase === 'battle' && action.type === 'playCard' ? view.hand.find(card => card.uid === action.cardUid) : null;
    if (view.phase === 'battle' && action.type === 'endTurn') {
      metrics.wastedEnergy += Math.max(0, view.energy - view.bankAtEnd);
      if (view.pressure > 0) {
        metrics.pressure.turns += 1;
        metrics.pressure.max = Math.max(metrics.pressure.max, view.pressure);
        pressureBattles.add(view.layer);
      }
    }

    const result = combat.applyAction(state, action);
    combat.assertAdventure(result.state.adventure, result.state);
    metrics.actions += 1;
    metrics.downs += result.events.filter(event => event.kind === 'down').length;
    metrics.chargeOverflowEvents += result.events.filter(event => event.kind === 'charge' && event.amount === 0).length;
    metrics.chargeReleased += result.events.filter(event => event.kind === 'chargeRelease').reduce((sum, event) => sum + event.amount, 0);

    if (chosenCard && chosenCard.cost === 4) {
      const played = result.events.find(event => event.kind === 'playCard' && event.actorId === chosenCard.ownerId);
      if (played) {
        metrics.fourCost.plays += 1;
        metrics.fourCost.energyPaid += played.payment.energy;
      }
    }
    if (chosenCard && chosenCard.cost === 0) {
      const enemyIds = new Set(view.enemies.map(enemy => enemy.id));
      const dealtDamage = result.events.some(event => event.hpDelta < 0 && enemyIds.has(event.targetId));
      if (!dealtDamage) metrics.zeroCostNonDamagePlays += 1;
    }
    if (chosenCard && result.events.some(event => event.kind === 'environment')) metrics.environmentPlays += 1;
    if (chosenCard && result.events.some(event => event.kind === 'intercept')) metrics.interceptPlays += 1;
    metrics.usefulCleanses += result.events.filter(event => event.kind === 'cleanse' && event.amount > 0).length;
    if (action.type === 'tradeCard') {
      const traded = result.events.find(event => event.kind === 'tradeCard');
      metrics.trade.count += 1;
      metrics.trade.energyPaid += traded.payment.energy;
    }

    const afterView = result.state.adventure.active ? combat.getAdventureView(result.state).run : null;
    if (activeBattle && (!afterView || afterView.phase !== 'battle' || afterView.layer !== activeBattle.layer)) {
      metrics.battles.push(activeBattle);
      const chargeBeforeClear = result.events.reduce((amount, event) => {
        if (event.kind === 'charge' || event.kind === 'chargeBank') return amount + event.amount;
        return amount;
      }, view.charge);
      metrics.chargeLostAtBattleEnd += Math.max(0, chargeBeforeClear);
      activeBattle = null;
    }
    state = result.state;
  }

  if (state.adventure.active) throw new Error(`动作超过上限：${config.label} seed=${seed}`);
  metrics.fourCost.offers = fourOffers.size;
  metrics.fourCost.reachable = fourReachable.size;
  metrics.pressure.battles = pressureBattles.size;
  metrics.win = Boolean(state.adventure.lastResult && state.adventure.lastResult.win);
  metrics.nodesCleared = state.adventure.lastResult ? state.adventure.lastResult.nodesCleared : 0;
  return metrics;
}

function rounded(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function numericSummary(values) {
  if (!values.length) return { count: 0, average: 0, min: 0, max: 0 };
  return { count: values.length, average: rounded(values.reduce((sum, value) => sum + value, 0) / values.length), min: Math.min(...values), max: Math.max(...values) };
}

function summarize(runs) {
  const turns = {};
  for (const type of ['battle', 'elite', 'boss']) turns[type] = numericSummary(runs.flatMap(run => run.battles.filter(battle => battle.type === type).map(battle => battle.turns)));
  const total = path => runs.reduce((sum, run) => sum + path(run), 0);
  const offers = total(run => run.fourCost.offers);
  const reachable = total(run => run.fourCost.reachable);
  return {
    runs: runs.length,
    wins: total(run => run.win ? 1 : 0),
    winRate: rounded(total(run => run.win ? 1 : 0) / runs.length),
    nodesCleared: numericSummary(runs.map(run => run.nodesCleared)),
    battleTurns: turns,
    fourCost: {
      offers, reachable, reachability: offers ? rounded(reachable / offers) : 0,
      plays: total(run => run.fourCost.plays), energyPaid: total(run => run.fourCost.energyPaid)
    },
    trade: { count: total(run => run.trade.count), energyPaid: total(run => run.trade.energyPaid) },
    resource: {
      wastedEnergy: total(run => run.wastedEnergy), averageWastedEnergy: rounded(total(run => run.wastedEnergy) / runs.length),
      chargeLostAtBattleEnd: total(run => run.chargeLostAtBattleEnd), chargeReleased: total(run => run.chargeReleased), chargeOverflowEvents: total(run => run.chargeOverflowEvents)
    },
    zeroCostNonDamagePlays: total(run => run.zeroCostNonDamagePlays),
    environmentPlays: total(run => run.environmentPlays),
    interceptPlays: total(run => run.interceptPlays),
    usefulCleanses: total(run => run.usefulCleanses),
    pressure: { turns: total(run => run.pressure.turns), battles: total(run => run.pressure.battles), max: Math.max(0, ...runs.map(run => run.pressure.max)) },
    downs: total(run => run.downs),
    failures: runs.filter(run => !run.win).map(run => ({ seed: run.seed, nodesCleared: run.nodesCleared }))
  };
}

function configurations() {
  const initial = ['sheep', 'orangecat', 'nav'];
  const tacticSeeds = seeds(20);
  const teamSeeds = seeds(10);
  const regionSeeds = seeds(8);
  return [
    ...STARTING_TACTICS.map(tactic => ({ group: '初始三人四起手', label: `tactic:${tactic.id}`, team: initial, style: 'balanced', tacticId: tactic.id, regionId: 'street', level: 1, seeds: tacticSeeds })),
    { group: '队伍与策略', label: 'team:balanced', team: initial, style: 'balanced', tacticId: 'classic', regionId: 'street', level: 1, seeds: teamSeeds },
    { group: '队伍与策略', label: 'team:guard', team: ['ramen', 'tea', 'doudou'], style: 'guard', tacticId: 'classic', regionId: 'street', level: 1, seeds: teamSeeds },
    { group: '队伍与策略', label: 'team:status', team: ['sunset', 'moon', 'hydrangea'], style: 'status', tacticId: 'classic', regionId: 'street', level: 1, seeds: teamSeeds },
    { group: '防护对照', label: 'guard:same:balanced', team: ['ramen', 'tea', 'doudou'], style: 'balanced', tacticId: 'classic', regionId: 'street', level: 1, seeds: teamSeeds },
    { group: '防护对照', label: 'guard:mixed:balanced', team: ['ramen', 'sushi', 'burger'], style: 'balanced', tacticId: 'classic', regionId: 'street', level: 1, seeds: teamSeeds },
    ...STARTING_TACTICS.filter(tactic => tactic.id !== 'classic').map(tactic => ({ group: '夜市构筑对照', label: `market:L3:${tactic.id}`, team: initial, style: 'balanced', tacticId: tactic.id, regionId: 'market', level: 3, seeds: regionSeeds })),
    { group: '夜市构筑对照', label: 'market:L3:status-team', team: ['sunset', 'moon', 'hydrangea'], style: 'status', tacticId: 'classic', regionId: 'market', level: 3, seeds: regionSeeds },
    { group: '三地区预期等级', label: 'region:street:L1', team: initial, style: 'balanced', tacticId: 'classic', regionId: 'street', level: 1, seeds: regionSeeds },
    { group: '三地区预期等级', label: 'region:bridge:L2', team: initial, style: 'balanced', tacticId: 'classic', regionId: 'bridge', level: 2, seeds: regionSeeds },
    { group: '三地区预期等级', label: 'region:market:L3', team: initial, style: 'balanced', tacticId: 'classic', regionId: 'market', level: 3, seeds: regionSeeds }
  ];
}

function printSummary(experiments, elapsedMs) {
  console.log(`公开信息战斗基准：${experiments.reduce((sum, item) => sum + item.summary.runs, 0)} 局，${rounded(elapsedMs / 1000)} 秒`);
  for (const experiment of experiments) {
    const summary = experiment.summary;
    const turnText = ['battle', 'elite', 'boss'].map(type => `${type} ${summary.battleTurns[type].average}`).join(' / ');
    console.log(`${experiment.label.padEnd(22)} 胜 ${summary.wins}/${summary.runs} | 回合 ${turnText} | 4费 ${summary.fourCost.plays}次(持有回合中可支付${Math.round(summary.fourCost.reachability * 100)}%, 支付E${summary.fourCost.energyPaid}) | 死手改签 ${summary.trade.count} | 释蓄${summary.resource.chargeReleased}/浪费E${summary.resource.wastedEnergy}/战后余蓄${summary.resource.chargeLostAtBattleEnd} | 0费非伤 ${summary.zeroCostNonDamagePlays} | 压力回合 ${summary.pressure.turns}`);
  }
  console.log('限制：' + LIMITATIONS.join(' '));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('用法：node scripts/benchmark-combat.js [--out=/path/report.json]');
    return;
  }
  const startedAt = Date.now();
  const experiments = configurations().map(config => {
    const runs = config.seeds.map(seed => runOne(config, seed));
    const publicConfig = { group: config.group, label: config.label, team: config.team, style: config.style, tacticId: config.tacticId, regionId: config.regionId, level: config.level, seeds: [...config.seeds] };
    return { ...publicConfig, summary: summarize(runs), runs };
  });
  const report = {
    contract: 'public-view-current-action-preview-v1',
    initialConditions: { rarity: 'R', difficulty: 'normal', midRunInjection: false, tacticSeedsPerVariant: 20, teamSeedsPerStrategy: 10, regionSeedsPerLevel: 8 },
    metricDefinitions: {
      battleTurns: '每场战斗实际到达的最高回合数，按普通、精英、首领分类。',
      fourCostOffers: '同一张4费牌在同一战斗回合出现计一次；reachable表示该回合至少一次公开显示可支付。',
      trade: '策略仅在回合开始没有达到出牌阈值且有能量高于可存上限时执行的改签。',
      wastedEnergy: '结束回合时无法转为蓄能的剩余能量。',
      chargeReleased: '回合开始时由蓄能转化为额外能量的总点数。',
      chargeLostAtBattleEnd: '战斗结束按规则清空、尚未来得及释放的蓄能。',
      zeroCostNonDamagePlays: '实际打出且未造成敌方即时生命损失的0费牌。',
      pressure: '在久战压力大于0时结束的回合数、涉及战斗数和最大层数。'
    },
    experiments,
    limitations: LIMITATIONS,
    elapsedMs: Date.now() - startedAt
  };
  printSummary(experiments, report.elapsedMs);
  if (options.out) {
    const outputPath = path.resolve(options.out);
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
    console.log(`JSON：${outputPath}`);
  }
}

if (require.main === module) main();

module.exports = { experimentalState, runOne, summarize };

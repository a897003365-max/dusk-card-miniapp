#!/usr/bin/env node
'use strict';

// 固定输入的回归实验，不把启发式策略当作真人胜率或最优打法。
const fs = require('fs');
const path = require('path');
const { runOne, summarize } = require('./benchmark-combat');
const SEEDS = [42, 12345, 824596, 987654321];
const BUILDS = [
  { label: '标记多段', team: ['sheep', 'orangecat', 'nav'], style: 'balanced', tacticId: 'classic' },
  { label: '留盾反击', team: ['ramen', 'tea', 'doudou'], style: 'guard', tacticId: 'classic' },
  { label: '蓄能终结', team: ['soup', 'cloudmail', 'nav'], style: 'balanced', tacticId: 'relay' },
  { label: '灼烧控场', team: ['sunset', 'moon', 'hydrangea'], style: 'status', tacticId: 'classic' }
];
function main(argv) {
  const options = { out: '', baseline: '' };
  for (const arg of argv) {
    if (arg.startsWith('--out=')) options.out = arg.slice(6);
    else if (arg.startsWith('--baseline=')) options.baseline = arg.slice(11);
    else throw new Error(`未知参数：${arg}`);
  }
  const baseline = options.baseline ? require(path.resolve(options.baseline, 'scripts/benchmark-combat.js')) : null;
  const report = {
    contract: 'public-view-current-action-preview-v1', seeds: SEEDS,
    conditions: { rarity: 'R', level: 1, regionId: 'street', difficulties: [0, 1, 2], midRunInjection: false },
    limitations: [
      '每种构筑每个难度仅四个固定种子，不是真人胜率，也不是调参目标。',
      '基线脚本原本仅支持普通难度，因此前后对照只覆盖普通难度；新版本另测三个难度。',
      '两侧沿用原有公开信息贪心决策；策略支持新换牌阶段，但不会主动选择换牌，不用于证明换牌收益。',
      '四个名称表示代表性队伍与起手方向，不意味着局内一定抽齐所有组件。',
      '奖励利用以本局卡牌UID去重计数；不等同于每一张牌的单独因果价值。'
    ], experiments: []
  };
  for (const build of BUILDS) {
    for (const difficulty of [0, 1, 2]) {
      const config = { ...build, regionId: 'street', level: 1, difficulty };
      const runs = SEEDS.map(seed => runOne(config, seed));
      const previous = baseline && difficulty === 0 ? SEEDS.map(seed => baseline.runOne(config, seed)) : null;
      const experiment = { config, summary: summarize(runs), runs, baseline: previous ? { summary: baseline.summarize(previous), runs: previous } : null };
      report.experiments.push(experiment);
      console.log(`${build.label} 难度${difficulty}: ${experiment.summary.wins}/${runs.length}，Boss平均回合 ${experiment.summary.battleTurns.boss.average}` + (previous ? `；基线 ${experiment.baseline.summary.wins}/${previous.length}` : ''));
    }
  }
  if (options.out) { const target = path.resolve(options.out); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n'); }
  return report;
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { console.error(error.stack); process.exitCode = 1; } }
module.exports = { main, BUILDS, SEEDS };

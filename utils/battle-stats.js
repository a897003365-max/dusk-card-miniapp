// 只记录已结算的数值，不参与战斗计算；旧战局启用统计后标为不完整。
const LABELS = {
  markHpDamage: '标记额外生命伤害', counterHpDamage: '反击实际伤害', burnHpDamage: '灼烧实际伤害',
  retainedBlocked: '留盾实际挡伤', chargeReleased: '蓄能释放', areaTargets: '群体牌累计作用目标',
  phaseBurnCleared: '转阶段清除的灼烧层数'
};
const KEYS = Object.keys(LABELS);
function freshStats(partial = false) { return { partial, ...Object.fromEntries(KEYS.map(key => [key, 0])) }; }
function addStat(run, key, amount) {
  if (!amount) return;
  if (!run.battleStats) run.battleStats = freshStats(true);
  run.battleStats[key] += amount;
}
function statLines(stats) { return stats ? KEYS.filter(key => stats[key] > 0).map(key => ({ key, label: LABELS[key], value: stats[key] })) : []; }
module.exports = { KEYS, freshStats, addStat, statLines };

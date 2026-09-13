'use strict';

const { CARDS, CARD_BY_ID } = require('./combat-content');

const TAG_NAMES = {
  mark: '标记', multiHit: '多段攻击', area: '群体处理', burn: '灼烧', weak: '虚弱',
  singleGuard: '单体保护', partyGuard: '全队保护', counter: '反击', retainBlock: '留盾',
  draw: '抽牌', scout: '观星', retain: '保留', charge: '蓄能', cleanse: '净化', finish: '高费输出'
};
const REWARD_SLOTS = ['synergy', 'coverage', 'wildcard'];
const SLOT_NAMES = { synergy: '构筑候选', coverage: '功能候选', wildcard: '跨方向候选' };

// 标签从真实效果推导，不维护第二份卡牌数值或不透明战力分。
function cardTags(card) {
  const definition = CARD_BY_ID[card.cardId || card.id];
  const effects = card.upgraded ? definition.upgradeEffects : definition.effects;
  const tags = new Set();
  for (const effect of effects) {
    const target = effect.target || definition.target;
    if (TAG_NAMES[effect.kind]) tags.add(effect.kind);
    if (['damage', 'burn', 'weak', 'mark'].includes(effect.kind) && ['allEnemies', 'enemies'].includes(target)) tags.add('area');
    if (['block', 'heal', 'intercept'].includes(effect.kind)) tags.add(['allAllies', 'party'].includes(target) ? 'partyGuard' : 'singleGuard');
  }
  if (effects.filter(effect => effect.kind === 'damage').length >= 2) tags.add('multiHit');
  if (definition.retain) tags.add('retain');
  if (definition.cost >= 3 && effects.some(effect => ['damage', 'burn'].includes(effect.kind))) tags.add('finish');
  return [...tags];
}

function analyzeDeck(deck, party = []) {
  const counts = Object.fromEntries(Object.keys(TAG_NAMES).map(tag => [tag, 0]));
  const costs = { low: 0, middle: 0, high: 0 };
  for (const card of deck) {
    const cost = CARD_BY_ID[card.cardId].cost;
    costs[cost <= 1 ? 'low' : cost === 2 ? 'middle' : 'high'] += 1;
    for (const tag of cardTags(card)) counts[tag] += 1;
  }
  const builds = [
    { id: 'mark', name: '标记多段', text: `标记来源 ${counts.mark} 张 · 多段攻击 ${counts.multiHit} 张`, guide: '先标记，再用多段攻击逐次兑现。', weakness: '缺一半组件时容易空转。' },
    { id: 'guard', name: '留盾反击', text: `留盾 ${counts.retainBlock} 张 · 反击 ${counts.counter} 张`, guide: '观察受击目标，保护队友并用反击找终结窗口。', weakness: '敌人不主动攻击时仍需主动输出。' },
    { id: 'charge', name: '蓄能终结', text: `蓄能 ${counts.charge} 张 · 高费输出 ${counts.finish} 张 · 保留 ${counts.retain} 张`, guide: '这一轮准备，下一轮把额外能量换成完整组合。', weakness: '准备期间需要保护，蓄能不能当回合支付。' },
    { id: 'burn', name: '灼烧控场', text: `灼烧 ${counts.burn} 张 · 虚弱 ${counts.weak} 张`, guide: '叠灼烧，再用控制和保护争取兑现时间。', weakness: 'Boss转阶段会清状态；不要只堆状态。' }
  ];
  const hints = [];
  if (counts.mark && !counts.multiHit) hints.push('已有标记来源，但缺少多段攻击；单段攻击仍可消耗标记。');
  if (counts.multiHit && !counts.mark) hints.push('已有多段攻击，标记来源可以提高每段收益。');
  if (!counts.area) hints.push('缺少群体处理牌，面对多个敌人时更依赖逐一集火。');
  if (costs.high >= 4 && counts.charge + counts.draw + counts.scout < 3) hints.push('高费牌较多，留意蓄能与整理手牌是否跟得上。');
  if (!counts.partyGuard) hints.push('全队保护较少，留意敌人的群体攻击。');
  return {
    total: deck.length, costs, counts, builds, hints,
    tags: Object.entries(counts).map(([id, count]) => ({ id, name: TAG_NAMES[id], count })),
    ownership: party.map(member => ({ id: member.id, count: deck.filter(card => card.ownerId === member.id).length })),
    note: '按牌的张数统计，不是伤害、状态层数或战力评分。被动和遗物另行生效。'
  };
}

function weightedPick(pool, weight, random) {
  const weights = pool.map(card => Math.max(1, weight(card)));
  let remaining = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) { remaining -= weights[i]; if (remaining < 0) return pool[i]; }
  return pool[pool.length - 1];
}

function rewardCandidates(run, random, genericOnly = false) {
  const pool = CARDS.filter(card => !['strike', 'guard'].includes(card.id)
    && (!card.familyId || !genericOnly && run.party.some(member => member.id === card.familyId)));
  const { counts } = analyzeDeck(run.deck);
  const node = run.nodes[run.layer], option = node.options.find(item => item.id === node.chosenId);
  const partners = { mark: 'multiHit', multiHit: 'mark', counter: 'retainBlock', retainBlock: 'counter', charge: 'finish', finish: 'charge', burn: 'weak', weak: 'burn' };
  const selected = [];
  for (const slot of REWARD_SLOTS) {
    const remaining = pool.filter(card => !selected.some(item => item.card.id === card.id));
    // 保留原有的至少一张战术牌，但不再用职业硬过滤整组奖励。
    const choices = slot === 'wildcard' && !selected.some(item => item.card.tactic) ? remaining.filter(card => card.tactic) : remaining;
    const card = weightedPick(choices, definition => {
      const tags = cardTags(definition);
      if (slot === 'synergy') return 2 + (definition.role === option.role ? 1 : 0)
        + tags.reduce((sum, tag) => sum + Math.min(3, counts[partners[tag]] || 0), 0);
      if (slot === 'coverage') return 2 + tags.reduce((sum, tag) => sum + (counts[tag] === 0 ? 3 : counts[tag] < 2 ? 1 : 0), 0);
      return 2 + (definition.role !== option.role ? 2 : 0);
    }, random);
    selected.push({ card, slot });
  }
  return selected;
}

function rewardReason(card, slot, deck) {
  const tags = cardTags(card);
  const uses = tags.map(tag => TAG_NAMES[tag]).join(' / ') || '直接输出';
  const counts = analyzeDeck(deck).counts;
  if (tags.includes('mark') && counts.multiHit) return `提供${uses}；牌组已有 ${counts.multiHit} 张多段攻击。`;
  if (tags.includes('multiHit') && counts.mark) return `提供${uses}；牌组已有 ${counts.mark} 张标记来源。`;
  return `${SLOT_NAMES[slot] || '奖励候选'}：${uses}。结合敌人和牌组选择，也可跳过。`;
}

module.exports = { TAG_NAMES, REWARD_SLOTS, SLOT_NAMES, cardTags, analyzeDeck, rewardCandidates, rewardReason };

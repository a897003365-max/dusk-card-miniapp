const combat = require('../../utils/combat');
const { CARD_BY_ID, ENVIRONMENTS } = require('../../utils/combat-content');

const STYLES = {
  balanced: { damage: 1, burn: 1.05, mark: 1, weak: 0.9, block: 1, heal: 1, cleanse: 1, intercept: 1, resource: 1, risk: 1, cost: 0.2, role: { guard: 0.2, combo: 0.3, echo: 0.25 }, playFloor: 0.35 },
  guard: { damage: 0.72, burn: 0.75, mark: 0.65, weak: 1.15, block: 1.45, heal: 1.35, cleanse: 1.2, intercept: 1.35, resource: 0.9, risk: 1.45, cost: 0.18, role: { guard: 1, combo: 0, echo: 0.2 }, playFloor: 0.2 },
  status: { damage: 0.8, burn: 1.55, mark: 1.45, weak: 1.3, block: 0.72, heal: 0.78, cleanse: 0.85, intercept: 0.75, resource: 1.15, risk: 0.9, cost: 0.18, role: { guard: 0, combo: 0.25, echo: 1 }, playFloor: 0.2 }
};

const RELIC_BONUSES = {
  balanced: ['ticket-punch', 'paper-lantern', 'glass-star', 'copper-windbell', 'rush-stamp'],
  guard: ['tea-token', 'warm-handkerchief', 'blue-thread', 'brass-buckle', 'bamboo-rib'],
  status: ['dry-inkstone', 'paper-lantern', 'folded-map', 'glass-star', 'wooden-whistle']
};

function styleWeights(style) {
  if (!STYLES[style]) throw new Error(`未知冒险策略：${style}`);
  return STYLES[style];
}

function effectsFor(card) {
  const definition = CARD_BY_ID[card.cardId || card.id];
  return definition ? (card.upgraded ? definition.upgradeEffects : definition.effects) : [];
}

function targetCount(effect, definition, view) {
  const target = effect.target || definition.target;
  if (['allEnemies', 'enemies'].includes(target)) return Math.max(1, view.enemies.length);
  if (['allAllies', 'party'].includes(target)) return Math.max(1, view.party.filter(member => !member.down).length);
  return 1;
}

function threatModel(view) {
  const byTarget = new Map();
  const attacks = [];
  for (const enemy of view.enemies) {
    if (enemy.intentKind !== 'attack') continue;
    const entry = { enemyId: enemy.id, all: enemy.intentAll, targets: enemy.intentTargets || [] };
    attacks.push(entry);
    for (const target of entry.targets) {
      const loss = target.hpLoss || 0;
      byTarget.set(target.id, (byTarget.get(target.id) || 0) + loss);
    }
  }
  const totalLoss = [...byTarget.values()].reduce((sum, amount) => sum + amount, 0);
  const lethalTargets = view.party.filter(member => !member.down && (byTarget.get(member.id) || 0) >= member.hp).length;
  return { attacks, byTarget, totalLoss, lethalTargets };
}

function missingHealth(view, targetId) {
  const members = targetId ? view.party.filter(member => member.id === targetId) : view.party.filter(member => !member.down);
  return members.reduce((sum, member) => sum + member.maxHp - member.hp, 0);
}

function negativeStatus(view, targetId) {
  const members = targetId ? view.party.filter(member => member.id === targetId) : view.party.filter(member => !member.down);
  return members.reduce((sum, member) => sum + ['burn', 'weak', 'mark'].reduce((status, key) => status + (member.status[key] || 0), 0), 0);
}

function directHitCount(card, view) {
  const definition = CARD_BY_ID[card.cardId || card.id];
  if (!definition) return 0;
  let hits = effectsFor(card).reduce((sum, effect) => sum + (effect.kind === 'damage' ? targetCount(effect, definition, view) : 0), 0);
  const owner = view.party.find(member => member.id === card.ownerId);
  if (hits && owner && owner.status.echo > 0) hits += 1;
  return hits;
}

function remainingAttackHits(view, excludedUid, remainingBudget) {
  const cards = view.hand.filter(card => card.uid !== excludedUid && card.cost <= remainingBudget && directHitCount(card, view) > 0)
    .map(card => ({ card, hits: directHitCount(card, view), efficiency: directHitCount(card, view) / Math.max(0.5, card.cost) }))
    .sort((a, b) => b.efficiency - a.efficiency || a.card.cost - b.card.cost);
  let budget = remainingBudget;
  let hits = 0;
  for (const item of cards) {
    if (item.card.cost > budget) continue;
    budget -= item.card.cost;
    hits += item.hits;
  }
  return hits;
}

function environmentScore(environmentId, card, view, weights) {
  const modifiers = Object.fromEntries(Object.values(ENVIRONMENTS).map(item => [item.id, item.damageModifier]));
  const next = modifiers[environmentId] || 0;
  const current = modifiers[view.environmentId] || 0;
  if (environmentId === view.environmentId) return -2;
  const remainingBudget = Math.max(0, view.availableBudget - card.cost);
  const outgoingHits = remainingAttackHits(view, card.uid, remainingBudget);
  const outgoingDelta = outgoingHits * (next - current) * weights.damage;
  let incomingDelta = 0;
  for (const enemy of view.enemies) {
    if (enemy.intentKind !== 'attack') continue;
    for (const target of enemy.intentTargets || []) {
      const member = view.party.find(item => item.id === target.id);
      if (!member) continue;
      const newAmount = Math.max(0, target.amount + next - current);
      const newLoss = Math.min(member.hp, Math.max(0, newAmount - member.block));
      incomingDelta += ((target.hpLoss || 0) - newLoss) * weights.risk;
    }
  }
  return outgoingDelta + incomingDelta;
}

function lossRisk(member, amount) {
  if (!member || amount <= 0) return 0;
  const lethal = amount >= member.hp ? member.maxHp * 0.8 : 0;
  return amount + lethal + amount / Math.max(1, member.hp) * 5;
}

function interceptScore(targetId, events, view, weights) {
  if (view.interceptorId) return -3;
  const threat = threatModel(view);
  const attack = threat.attacks.find(item => !item.all && item.targets.length === 1 && item.targets[0].id !== targetId);
  if (!attack) return -2;
  const originalTarget = view.party.find(member => member.id === attack.targets[0].id);
  const interceptor = view.party.find(member => member.id === targetId && !member.down);
  if (!originalTarget || !interceptor) return -3;
  const addedBlock = events.filter(event => event.kind === 'block' && event.targetId === targetId).reduce((sum, event) => sum + event.amount, 0);
  const redirectedLoss = Math.min(interceptor.hp, Math.max(0, attack.targets[0].amount - interceptor.block - addedBlock));
  return (lossRisk(originalTarget, attack.targets[0].hpLoss || 0) - lossRisk(interceptor, redirectedLoss)) * weights.intercept;
}

function scorePreview(events, card, targetId, view, weights) {
  const enemyIds = new Set(view.enemies.map(enemy => enemy.id));
  const threats = threatModel(view);
  let score = -(card.cost || 0) * weights.cost;
  let useful = 0;
  for (const event of events) {
    const enemyTarget = enemyIds.has(event.targetId);
    if (['damage', 'echo'].includes(event.kind) && event.hpDelta < 0 && enemyTarget) { score += event.amount * weights.damage; useful += event.amount; }
    else if (event.kind === 'burn' && enemyTarget && event.hpDelta === undefined) { score += event.amount * weights.burn; useful += event.amount; }
    else if (event.kind === 'mark' && enemyTarget) { score += Math.min(event.amount, Math.max(1, remainingAttackHits(view, card.uid, Math.max(0, view.availableBudget - card.cost)))) * 2 * weights.mark; useful += event.amount; }
    else if (event.kind === 'weak' && enemyTarget) {
      const enemy = view.enemies.find(item => item.id === event.targetId);
      const attack = enemy && enemy.intentKind === 'attack' ? enemy.intentTargets.reduce((sum, item) => sum + item.amount, 0) : 4;
      score += Math.min(attack * 0.25, 5) * event.amount * weights.weak; useful += event.amount;
    }
    else if (event.kind === 'heal' && event.amount > 0) { score += event.amount * weights.heal; useful += event.amount; }
    else if (event.kind === 'block' && !enemyTarget) {
      const threatened = threats.byTarget.get(event.targetId) || 0;
      const effective = Math.min(event.amount, threatened);
      score += (effective + (event.amount - effective) * 0.08) * weights.block; useful += effective;
    }
    else if (event.kind === 'cleanse' && event.amount > 0) { score += event.amount * 2.2 * weights.cleanse; useful += event.amount; }
    else if (event.kind === 'stripBlock' && event.amount > 0) { score += event.amount * 0.65 * weights.damage; useful += event.amount; }
    else if (event.kind === 'draw' && event.amount > 0) { score += event.amount * 2.1 * weights.resource; useful += event.amount; }
    else if (['energy', 'charge'].includes(event.kind) && event.amount > 0) { score += event.amount * 2.6 * weights.resource; useful += event.amount; }
    else if (event.kind === 'counter' && event.amount > 0) {
      const incoming = threats.attacks.reduce((sum, attack) => sum + attack.targets.filter(target => target.id === event.targetId).length, 0);
      score += event.amount * Math.max(0.25, incoming) * weights.block; useful += incoming;
    }
    else if (event.kind === 'echo' && event.hpDelta === undefined && event.amount > 0) { score += event.amount * 3 * weights.resource; useful += event.amount; }
    else if (event.kind === 'retainBlock' && event.amount > 0) { score += event.amount * 1.5 * weights.block; useful += event.amount; }
    else if (event.kind === 'discover') { score += 4.5 * weights.resource; useful += 1; }
    else if (event.kind === 'scout') { score += 3.5 * weights.resource; useful += 1; }
    if (event.kind === 'defeat') score += 14;
    if (event.kind === 'bossPhase') score += 2; // 转阶段仍保留敌人，不能按消灭一名攻击者计收益。
  }
  for (const event of events.filter(item => item.kind === 'environment')) {
    const environment = effectsFor(card).find(effect => effect.kind === 'environment');
    const value = environmentScore(environment && environment.environmentId, card, view, weights);
    score += value;
    if (value > 0) useful += 1;
  }
  if (events.some(event => event.kind === 'intercept')) {
    const value = interceptScore(targetId, events, view, weights);
    score += value;
    if (value > 0) useful += 1;
  }
  if (!useful) score -= 2.5;
  return score;
}

function cardPotential(card, view, weights) {
  const definition = CARD_BY_ID[card.cardId || card.id];
  if (!definition) return -100;
  const threats = threatModel(view);
  const effects = effectsFor(card);
  let score = (weights.role[definition.role] || 0) - definition.cost * weights.cost;
  for (const effect of effects) {
    const count = targetCount(effect, definition, view);
    if (effect.kind === 'damage') score += effect.amount * count * weights.damage;
    else if (effect.kind === 'burn') score += effect.amount * count * weights.burn;
    else if (effect.kind === 'mark') score += effect.amount * Math.min(2, Math.max(1, count)) * weights.mark;
    else if (effect.kind === 'weak') score += effect.amount * 3 * count * weights.weak;
    else if (effect.kind === 'block') score += Math.min(effect.amount * count, threats.totalLoss || effect.amount * 0.15) * weights.block;
    else if (effect.kind === 'heal') score += Math.min(effect.amount * count, missingHealth(view)) * weights.heal;
    else if (effect.kind === 'cleanse') score += Math.min(effect.amount * count, negativeStatus(view)) * 2 * weights.cleanse;
    else if (effect.kind === 'stripBlock') score += Math.min(effect.amount * count, view.enemies.reduce((sum, enemy) => sum + enemy.block, 0)) * 0.7 * weights.damage;
    else if (effect.kind === 'counter') score += effect.amount * Math.max(0.3, threats.attacks.length) * weights.block;
    else if (effect.kind === 'echo') score += effect.amount * 3 * weights.resource;
    else if (['draw', 'energy', 'charge'].includes(effect.kind)) score += effect.amount * 2.4 * weights.resource;
    else if (['discover', 'scout'].includes(effect.kind)) score += 4 * weights.resource;
    else if (effect.kind === 'environment') score += environmentScore(effect.environmentId, card, view, weights);
    else if (effect.kind === 'intercept') score += Math.max(0, threats.totalLoss * 0.35) * weights.intercept;
  }
  if (definition.retain && definition.cost >= 3) score += 1;
  return score;
}

function choosePending(view, weights) {
  const pending = view.pendingChoice;
  const ranked = pending.options.map(card => ({ card, score: cardPotential(card, view, weights) }))
    .sort((a, b) => b.score - a.score || String(a.card.choiceId).localeCompare(String(b.card.choiceId)));
  if (!ranked.length || ranked[0].score < 0) return { type: 'chooseOpportunity', choiceId: 'skip' };
  return { type: 'chooseOpportunity', choiceId: ranked[0].card.choiceId };
}

function targetsFor(card, view) {
  if (card.target === 'enemy') return view.enemies.map(enemy => enemy.id);
  if (card.target === 'ally') return view.party.filter(member => !member.down).map(member => member.id);
  return [undefined];
}

function battleAction(view, preview, weights) {
  if (view.pendingChoice) return choosePending(view, weights);
  const candidates = [];
  for (const card of view.hand.filter(item => item.playable)) {
    for (const targetId of targetsFor(card, view)) {
      const action = { type: 'playCard', cardUid: card.uid };
      if (targetId !== undefined) action.targetId = targetId;
      const result = preview(action);
      if (result && result.allowed) candidates.push({ action, card, score: scorePreview(result.events || [], card, targetId, view, weights) });
    }
  }
  candidates.sort((a, b) => b.score - a.score || String(a.action.cardUid).localeCompare(String(b.action.cardUid)) || String(a.action.targetId || '').localeCompare(String(b.action.targetId || '')));
  const best = candidates[0];
  if (best && best.score >= weights.playFloor) return best.action;

  const tradeable = view.hand.filter(card => card.canTrade).map(card => ({ card, score: cardPotential(card, view, weights) }))
    .sort((a, b) => a.score - b.score || b.card.cost - a.card.cost);
  const canSpendOnTrade = view.plays === 0 && view.energy === view.energyRefill && view.energy > view.bankAtEnd;
  if (tradeable.length && canSpendOnTrade && (!best || best.score < weights.playFloor)) return { type: 'tradeCard', cardUid: tradeable[0].card.uid };
  return { type: 'endTurn' };
}

function chooseMap(view, weights) {
  const node = view.nodes[view.layer];
  const ranked = node.options.map(option => ({ option, score: weights.role[option.role] || 0 }))
    .sort((a, b) => b.score - a.score || a.option.id.localeCompare(b.option.id));
  return { type: 'chooseNode', nodeId: ranked[0].option.id };
}

function chooseReward(view, weights) {
  const ranked = view.choices.map(card => ({ card, score: cardPotential(card, view, weights) }))
    .sort((a, b) => b.score - a.score || String(a.card.uid).localeCompare(String(b.card.uid)));
  const best = ranked[0];
  return { type: 'chooseCard', choiceId: best && best.score >= 3 ? best.card.uid : 'skip' };
}

function chooseRelic(view, style, weights) {
  const preferred = RELIC_BONUSES[style];
  const ranked = view.choices.map(relic => {
    let score = preferred.includes(relic.id) ? 5 - preferred.indexOf(relic.id) * 0.25 : 0;
    if (relic.kind === 'damage') score += 2 * weights.damage;
    if (['block', 'heal', 'counter', 'retainBlock'].includes(relic.kind)) score += 2 * weights.block;
    if (['burn', 'mark', 'weak', 'echo'].includes(relic.kind)) score += 2 * weights.mark;
    if (['draw', 'charge'].includes(relic.kind)) score += 2 * weights.resource;
    return { relic, score };
  }).sort((a, b) => b.score - a.score || a.relic.id.localeCompare(b.relic.id));
  return { type: 'chooseRelic', choiceId: ranked[0].relic.id };
}

function chooseEvent(view) {
  const missing = missingHealth(view);
  const ranked = view.choices.map(choice => ({ choice, score: Math.min(missing, choice.heal || 0) + (choice.threads || 0) * 0.7 + (choice.upgrade ? 7 : 0) }))
    .sort((a, b) => b.score - a.score || a.choice.id.localeCompare(b.choice.id));
  return { type: 'chooseEvent', choiceId: ranked[0].choice.id };
}

function chooseUpgrade(view, weights) {
  const ranked = view.choices.map(card => {
    const upgraded = { ...card, upgraded: true };
    return { card, score: cardPotential(upgraded, view, weights) - cardPotential({ ...card, upgraded: false }, view, weights) };
  }).sort((a, b) => b.score - a.score || String(a.card.uid).localeCompare(String(b.card.uid)));
  return { type: 'upgradeCard', cardUid: ranked[0].card.uid };
}

// 纯公开策略入口：只接收装饰后的公开视图，以及当前动作的公开预览函数。
function chooseFromView(view, previewActionCallback, style = 'balanced') {
  if (!view) return null;
  if (typeof previewActionCallback !== 'function') throw new Error('需要公开动作预览函数');
  const weights = styleWeights(style);
  switch (view.phase) {
    case 'map': return chooseMap(view, weights);
    case 'battle': return battleAction(view, previewActionCallback, weights);
    case 'cardReward': return chooseReward(view, weights);
    case 'relicReward': return chooseRelic(view, style, weights);
    case 'event': return chooseEvent(view);
    case 'camp': {
      const missing = missingHealth(view);
      const ratio = missing / Math.max(1, view.party.reduce((sum, member) => sum + member.maxHp, 0));
      return ratio >= (style === 'guard' ? 0.16 : 0.25) ? { type: 'rest' } : { type: 'chooseUpgrade' };
    }
    case 'startingUpgrade': case 'campUpgrade': return chooseUpgrade(view, weights);
    default: throw new Error(`选择策略不支持当前阶段：${view.phase}`);
  }
}

// 兼容原生脚本的包装器。options 可传字符串风格或 { style }。
function chooseAction(state, options = {}) {
  const style = typeof options === 'string' ? options : options.style || 'balanced';
  const view = combat.getAdventureView(state).run;
  return chooseFromView(view, action => combat.previewAction(state, action), style);
}

module.exports = { chooseAction, chooseFromView };

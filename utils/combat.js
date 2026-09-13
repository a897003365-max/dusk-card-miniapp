const { FAMILIES, TIERS } = require('./content');
const { heroes } = require('../assets/battle/manifest');
const { FIGHTERS, CARDS, OPPORTUNITY_CARDS, STARTING_TACTICS, RELICS, ENEMIES, REGIONS, DIFFICULTIES, CARD_BY_ID, RELIC_BY_ID, ENEMY_BY_ID, REGION_BY_ID, STATUS_RULES, BATTLE_RULES, ENVIRONMENTS, STREET_ENCOUNTERS, STREET_BATTLE_PATH } = require('./combat-content');

const { analyzeDeck, rewardCandidates, rewardReason, REWARD_SLOTS, SLOT_NAMES } = require('./deck-strategy');

const { KEYS: STAT_KEYS, freshStats, addStat, statLines } = require('./battle-stats');

const PHASES = ['startingUpgrade', 'map', 'battle', 'cardReward', 'relicReward', 'event', 'camp', 'campUpgrade', 'campReplace', 'eventReplace'];
const STATUS_KEYS = ['mark', 'weak', 'burn', 'counter', 'echo', 'retainBlock'];
const EFFECT_LABELS = { damage: '伤害', block: '护盾', heal: '治疗', draw: '抽牌', energy: '能量', charge: '蓄能', mark: '标记', weak: '虚弱', burn: '灼烧', counter: '反击', echo: '回响次数', retainBlock: '留盾', cleanse: '净化', stripBlock: '破盾', intercept: '拦截', discover: '发现', scout: '观星', environment: '环境' };
const ROLE_NAMES = { guard: '守护', combo: '连携', echo: '回响' };
const NODE_NAMES = { battle: '交锋', elite: '精英', event: '奇遇', camp: '营地', treasure: '宝箱', boss: '首领' };
const ROUTES = [
  ['battle', 'battle', 'event', 'battle', 'camp', 'elite', 'treasure', 'battle', 'boss'],
  ['battle', 'event', 'battle', 'elite', 'camp', 'battle', 'treasure', 'battle', 'boss'],
  ['battle', 'battle', 'treasure', 'event', 'battle', 'camp', 'elite', 'battle', 'boss']
];
const clone = value => JSON.parse(JSON.stringify(value));
const alive = unit => unit.hp > 0;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const familyName = id => FAMILIES.find(item => item.id === id).name;
const ownedTier = (state, id) => TIERS.filter(tier => state.collection[id] && state.collection[id][tier] > 0).pop();
const difficultyOf = run => DIFFICULTIES.find(item => item.id === run.difficulty);
const freshStatus = () => ({ mark: 0, weak: 0, burn: 0, counter: 0, echo: 0, retainBlock: 0 });
const permanentCardIds = new Set(CARDS.map(item => item.id));
const opportunityCardIds = new Set(OPPORTUNITY_CARDS.map(item => item.id));

function runCards(run) { return [...run.deck, ...(run.temporaryCards || [])]; }
function findCard(run, uid) { return runCards(run).find(item => item.uid === uid); }
function availableBudget(run) { return run.energy; }
function paymentFor(run, cost) {
  return { energy: cost, charge: 0 };
}
function paymentText(payment) {
  return payment.energy ? `${payment.energy} 能量` : '0 费';
}
function ensureRunFields(run) {
  if (run.charge === undefined) run.charge = 0;
  if (run.tacticId === undefined) run.tacticId = 'classic';
  if (run.environmentId === undefined) run.environmentId = null;
  if (run.interceptorId === undefined) run.interceptorId = null;
  if (run.pendingChoice === undefined) run.pendingChoice = null;
  if (run.temporaryCards === undefined) run.temporaryCards = [];
}

function requireThat(condition, message) { if (!condition) throw new Error(message); }

function createAdventureProfile() {
  const levels = {};
  const clears = {};
  FAMILIES.forEach(item => { levels[item.id] = 1; });
  REGIONS.forEach(item => { clears[item.id] = [0, 0, 0]; });
  return { threads: 0, levels, clears, active: null, lastResult: null };
}

function scaled(base, member) {
  const leveled = Math.floor(base * (1 + (member.level - 1) * 0.04));
  return Math.floor(leveled * (1 + TIERS.indexOf(member.tier) * 0.04));
}

function cardEffectAmount(effect, owner) {
  return ['damage', 'block', 'heal', 'counter'].includes(effect.kind) ? scaled(effect.amount, owner) : effect.amount;
}

function random(run) {
  let value = run.rng;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  run.rng = value >>> 0;
  return run.rng / 4294967296;
}

function pick(run, values) { return values[Math.floor(random(run) * values.length)]; }
function shuffled(run, values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random(run) * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function logEvent(events, kind, actorId, targetId, amount, text) {
  const event = { kind, actorId: actorId || null, targetId: targetId || null, amount: amount || 0, text };
  events.push(event);
  return event;
}

function regionUnlocked(profile, regionIndex) {
  return regionIndex === 0 || profile.clears[REGIONS[regionIndex - 1].id][0] > 0;
}

function difficultyUnlocked(profile, regionId, difficulty) {
  return difficulty === 0 || profile.clears[regionId][difficulty - 1] > 0;
}

function newCard(run, cardId, ownerId) {
  return { uid: `card-${run.nextCardId++}`, cardId, ownerId, upgraded: false };
}

function makeNodes(run) {
  const region = REGION_BY_ID[run.regionId];
  const route = pick(run, ROUTES);
  let ordinaryIndex = -1;
  return route.map((type, index) => {
    if (type === 'battle') ordinaryIndex += 1;
    const count = type === 'boss' || type === 'camp' ? 1 : 2;
    const options = Array.from({ length: count }, (_, option) => {
      const role = ['guard', 'combo', 'echo'][(index + option) % 3];
      let enemyIds = [];
      if (type === 'battle') enemyIds = [region.normalIds[(index + option) % region.normalIds.length]];
      if (type === 'elite') enemyIds = [region.eliteIds[option % region.eliteIds.length]];
      if (type === 'boss') enemyIds = [region.bossId];
      const eventId = type === 'event' ? region.events[option % region.events.length].id : null;
      const encounterId = run.regionId === 'street' && type === 'battle' && ordinaryIndex > 0 ? STREET_BATTLE_PATH[ordinaryIndex - 1][option]
        : run.regionId === 'street' && type === 'elite' ? ['street-guard', 'street-press'][option] : null;
      if (encounterId) {
        const encounter = STREET_ENCOUNTERS[encounterId];
        return { id: `node-${index}-${option}`, encounterId, name: encounter.name,
          description: encounter.description, role, enemyIds: encounter.units.map(unit => unit.id), eventId };
      }
      const name = enemyIds.length ? ENEMY_BY_ID[enemyIds[0]].name : type === 'event' ? region.events.find(item => item.id === eventId).title : NODE_NAMES[type];
      return { id: `node-${index}-${option}`, name, description: type === 'battle' ? '胜利后三选一：构筑、功能与跨方向候选' : type === 'elite' ? '战胜精英，挑选一件遗物' : type === 'boss' ? '击破两个阶段，完成本次远行' : type === 'camp' ? run.regionId === 'street' ? '恢复、升级或替换一张非专属牌，三选一' : '恢复全队生命，或升级一张牌' : type === 'treasure' ? '带走星线，挑选一件遗物' : '作出选择，决定这次收获', role, enemyIds, eventId };
    });
    return { index, type, label: NODE_NAMES[type], options, visited: false, chosenId: null };
  });
}

function startExpedition(state, regionId, difficulty, seed, tacticId = 'classic') {
  requireThat(!state.journey && !state.adventure.active, '请先完成当前的故事或远行');
  const regionIndex = REGIONS.findIndex(item => item.id === regionId);
  requireThat(regionIndex >= 0, '没有找到这片区域');
  requireThat(DIFFICULTIES.some(item => item.id === difficulty), '请选择有效的副本难度');
  requireThat(regionUnlocked(state.adventure, regionIndex), '请先通关前一区域的普通难度');
  requireThat(difficultyUnlocked(state.adventure, regionId, difficulty), '请先通关本区域的前一难度');
  requireThat(Number.isInteger(seed) && seed > 0 && seed <= 0xffffffff, '远行种子必须是非零 32 位整数');
  const tactic = STARTING_TACTICS.find(item => item.id === tacticId);
  requireThat(tactic, '请选择有效的起手战术');
  requireThat(Array.isArray(state.team) && state.team.length === 3 && new Set(state.team).size === 3 && state.team.every(id => FIGHTERS[id] && ownedTier(state, id)), '请选择三位已经结识的不同旅伴');
  const next = clone(state);
  const party = state.team.map(id => {
    const member = { id, tier: ownedTier(state, id), level: state.adventure.levels[id], role: FIGHTERS[id].role };
    member.maxHp = scaled(FIGHTERS[id].maxHp, member);
    return { ...member, hp: member.maxHp, block: 0, status: freshStatus(), usedTurn: {}, usedBattle: {} };
  });
  const run = {
    id: `${regionId}-${difficulty}-${seed}`, regionId, difficulty, seed, rng: seed, phase: 'map', layer: 0, nodes: [], party,
    tacticId, deck: [], temporaryCards: [], drawPile: [], hand: [], discardPile: [], removed: [], enemies: [], energy: 0, charge: 0, turn: 0, plays: 0,
    environmentId: null, interceptorId: null, pendingChoice: null,
    nextCardId: 1, nextEnemyId: 1, relics: [], relicUsedTurn: {}, relicUsedBattle: {}, choices: [], log: [], threadsEarned: 0, ticketsEarned: 0
  };
  party.forEach((member, index) => {
    [tactic.cards[index] || 'strike', 'guard', ...FIGHTERS[member.id].cards].forEach(id => run.deck.push(newCard(run, id, member.id)));
  });
  run.nodes = makeNodes(run);
  if (party.some(member => TIERS.indexOf(member.tier) >= 2)) run.phase = 'startingUpgrade';
  next.adventure.active = run;
  next.adventure.lastResult = null;
  const events = [];
  logEvent(events, 'expedition', null, null, 0, `三位旅伴出发前往${REGION_BY_ID[regionId].name}`);
  run.log = events;
  return { state: next, events };
}

function getTargets(run, target, actor, targetId) {
  switch (target) {
    case 'self': return actor && alive(actor) ? [actor] : [];
    case 'party': case 'allAllies': return run.party.filter(alive);
    case 'enemies': case 'allEnemies': return run.enemies.filter(alive);
    case 'enemy': {
      const selected = run.enemies.find(item => item.id === targetId);
      return selected ? alive(selected) ? [selected] : [] : run.enemies.filter(alive).slice(0, 1);
    }
    case 'ally': return run.party.filter(item => item.id === targetId && alive(item));
    default: throw new Error('卡牌目标类型无效');
  }
}

function removeDownedCards(run, member, events) {
  const ids = runCards(run).filter(card => card.ownerId === member.id).map(card => card.uid);
  for (const key of ['drawPile', 'hand', 'discardPile']) run[key] = run[key].filter(uid => !ids.includes(uid));
  run.removed = [...new Set([...run.removed, ...ids])];
  member.block = 0; member.carriedBlock = 0;
  logEvent(events, 'down', member.id, member.id, 0, `${familyName(member.id)}暂时倒下，所属卡牌本场退场`);
}

function damage(run, actor, target, base, events, { direct = true, enemyAttack = false, echo = false, applyWeak = true, counter = false } = {}) {
  if (!target || !alive(target)) return { killed: false, amount: 0, blocked: 0, hpLoss: 0 };
  let amount = Math.max(0, base);
  if (direct && run.environmentId) amount = Math.max(0, amount + ENVIRONMENTS[run.environmentId].damageModifier);
  if (direct && applyWeak && actor && actor.status.weak > 0) amount = Math.floor(amount * STATUS_RULES.weakMultiplier);
  const unmarkedAmount = amount, originalHp = target.hp, originalBlock = target.block;
  const marked = direct && target.status.mark > 0;
  if (marked) { amount += STATUS_RULES.markBonus; target.status.mark -= 1; }
  const blocked = direct ? Math.min(target.block, amount) : 0;
  const retainedBlocked = Math.min(target.carriedBlock || 0, blocked);
  if (target.carriedBlock !== undefined) target.carriedBlock -= retainedBlocked;
  target.block -= blocked;
  const lost = Math.min(target.hp, amount - blocked);
  target.hp -= lost;
  const targetName = target.definitionId ? ENEMY_BY_ID[target.definitionId].name : familyName(target.id);
  const impact = logEvent(events, echo ? 'echo' : direct ? 'damage' : 'burn', actor && actor.id, target.id, lost, `${targetName}${blocked ? `的护盾挡下 ${blocked}，` : ''}受到 ${lost} 点伤害`);
  impact.hpDelta = -lost;
  if (target.definitionId) {
    const markHpGain = marked ? lost - Math.min(originalHp, Math.max(0, unmarkedAmount - originalBlock)) : 0;
    if (markHpGain) { impact.markHpGain = markHpGain; addStat(run, 'markHpDamage', markHpGain); }
    if (!direct) addStat(run, 'burnHpDamage', lost);
    if (counter) { impact.counterDamage = lost; addStat(run, 'counterHpDamage', lost); }
  } else if (retainedBlocked) {
    impact.retainedBlocked = retainedBlocked; addStat(run, 'retainedBlocked', retainedBlocked);
  }
  if (blocked > 0) impact.blocked = blocked;
  let killed = target.hp === 0;
  if (killed && target.definitionId) {
    const definition = ENEMY_BY_ID[target.definitionId];
    if (definition.phase2 && target.phase === 1) {
      const phaseBurnCleared = target.status.burn;
      addStat(run, 'phaseBurnCleared', phaseBurnCleared);
      target.phase = 2;
      target.maxHp = Math.ceil(definition.phase2.maxHp * difficultyOf(run).hpMultiplier);
      target.hp = target.maxHp;
      target.block = 0;
      target.status = freshStatus();
      target.intentIndex = 0;
      killed = false;
      const phaseEvent = logEvent(events, 'bossPhase', target.id, target.id, target.hp, `${definition.name}进入第二阶段，清除护盾和全部状态`);
      phaseEvent.burnCleared = phaseBurnCleared;
    } else logEvent(events, 'defeat', actor && actor.id, target.id, 0, `${definition.name}被击败了`);
  } else if (killed) removeDownedCards(run, target, events);
  if (enemyAttack && target.status.counter > 0 && actor && alive(actor)) {
    damage(run, target, actor, target.status.counter, events, { direct: true, applyWeak: false, counter: true });
  }
  return { killed, amount, blocked, hpLoss: lost };
}

function drawCards(run, amount, events, actorId) {
  let count = 0;
  while (count < amount && run.hand.length < 8) {
    if (!run.drawPile.length) {
      if (!run.discardPile.length) break;
      run.drawPile = shuffled(run, run.discardPile);
      run.discardPile = [];
      logEvent(events, 'shuffle', actorId, null, run.drawPile.length, '弃牌重新洗入抽牌堆');
    }
    run.hand.push(run.drawPile.pop());
    count += 1;
  }
  if (count) logEvent(events, 'draw', actorId, null, count, `抽取 ${count} 张牌`);
}

function openPendingChoice(run, kind, amount, actor, events) {
  requireThat(!run.pendingChoice, '请先完成当前选择');
  let options;
  if (kind === 'discover') {
    options = shuffled(run, OPPORTUNITY_CARDS.map(item => item.id)).slice(0, amount);
  } else {
    options = [];
    while (options.length < amount) {
      if (!run.drawPile.length) {
        if (!run.discardPile.length) break;
        run.drawPile = shuffled(run, run.discardPile);
        run.discardPile = [];
        logEvent(events, 'shuffle', actor.id, null, run.drawPile.length, '弃牌重新洗入抽牌堆');
      }
      options.push(run.drawPile.pop());
    }
  }
  requireThat(options.length > 0, kind === 'discover' ? '当前没有可发现的机会牌' : '当前没有可观星的牌');
  run.pendingChoice = { kind, ownerId: actor.id, options };
  logEvent(events, kind, actor.id, null, options.length, kind === 'discover' ? '发现了新的临时机会，请选择一张' : `查看牌堆顶的 ${options.length} 张牌，请选择一张`);
}

function effect(run, descriptor, actor, cardTarget, targetId, events, facts, scale = true) {
  const { kind } = descriptor;
  const amount = scale && actor && !actor.definitionId ? cardEffectAmount(descriptor, actor) : descriptor.amount;
  if (kind === 'draw') { drawCards(run, amount, events, actor && actor.id); return; }
  if (kind === 'energy') { run.energy += amount; logEvent(events, 'energy', actor && actor.id, null, amount, `获得 ${amount} 点能量`); return; }
  if (kind === 'charge') {
    const gained = Math.min(amount, STATUS_RULES.maxCharge - run.charge);
    run.charge += gained;
    logEvent(events, 'charge', actor && actor.id, null, gained, `获得 ${gained} 层蓄能，下回合额外获得能量；现有 ${run.charge}/${STATUS_RULES.maxCharge}`);
    return;
  }
  if (kind === 'environment') {
    requireThat(ENVIRONMENTS[descriptor.environmentId], '战斗环境类型无效');
    run.environmentId = descriptor.environmentId;
    logEvent(events, 'environment', actor && actor.id, null, amount, `本轮环境变为${ENVIRONMENTS[descriptor.environmentId].name}`);
    return;
  }
  if (kind === 'discover' || kind === 'scout') { openPendingChoice(run, kind, amount, actor, events); return; }
  const targets = getTargets(run, descriptor.target || cardTarget, actor, targetId);
  targets.forEach(target => {
    const name = target.definitionId ? ENEMY_BY_ID[target.definitionId].name : familyName(target.id);
    if (kind === 'damage') {
      if (damage(run, actor, target, amount, events).killed) facts.kills += 1;
      facts.attack = true;
    } else if (kind === 'block') {
      target.block += amount;
      facts.guard = true;
      logEvent(events, 'block', actor && actor.id, target.id, amount, `${name}获得 ${amount} 点护盾`);
    } else if (kind === 'heal') {
      const healed = Math.min(target.maxHp - target.hp, amount);
      target.hp += healed;
      if (healed > 0) facts.heal = true;
      const recovery = logEvent(events, 'heal', actor && actor.id, target.id, healed, `${name}恢复 ${healed} 点生命`);
      recovery.hpDelta = healed;
    } else if (kind === 'cleanse') {
      const deltas = {};
      let removed = 0;
      for (const key of ['burn', 'weak', 'mark']) {
        deltas[key] = Math.min(target.status[key], amount);
        target.status[key] -= deltas[key];
        removed += deltas[key];
      }
      const event = logEvent(events, 'cleanse', actor && actor.id, target.id, removed, `${name}净化了 ${removed} 层负面状态`);
      event.deltas = deltas;
    } else if (kind === 'stripBlock') {
      const removed = Math.min(target.block, amount);
      target.block -= removed;
      if (target.carriedBlock !== undefined) target.carriedBlock = Math.max(0, target.carriedBlock - removed);
      const event = logEvent(events, 'stripBlock', actor && actor.id, target.id, removed, `${name}失去 ${removed} 点护盾`);
      event.blockDelta = -removed;
    } else if (kind === 'intercept') {
      requireThat(!target.definitionId && alive(target), '只能让仍在场的旅伴拦截');
      run.interceptorId = target.id;
      logEvent(events, 'intercept', actor && actor.id, target.id, amount, `${name}将拦截下一次敌方单体攻击`);
    } else {
      requireThat(STATUS_KEYS.includes(kind), '卡牌效果类型无效');
      target.status[kind] += amount;
      if (kind === 'mark') facts.marked = true;
      const label = { mark: '标记', weak: '虚弱', burn: '灼烧', counter: '反击', echo: '回响', retainBlock: '留盾' }[kind];
      logEvent(events, kind, actor && actor.id, target.id, amount, `${name}获得 ${amount} ${label}`);
    }
  });
}

function trigger(run, name, actor, targetId, events) {
  const members = ['battleStart', 'turnStart', 'thirdPlay'].includes(name) ? run.party.filter(alive) : actor && alive(actor) ? [actor] : [];
  members.forEach(member => {
    const passive = FIGHTERS[member.id].passive;
    if (passive.trigger !== name) return;
    const uses = passive.frequency === 'battle' ? member.usedBattle : member.usedTurn;
    if (uses[name]) return;
    uses[name] = true;
    logEvent(events, 'passive', member.id, targetId, 0, `${familyName(member.id)} · ${passive.name}`);
    effect(run, passive, member, passive.target, targetId, events, { kills: 0 }, false);
  });
  const relicActor = actor && alive(actor) ? actor : run.party.find(alive);
  if (!relicActor) return;
  run.relics.forEach(id => {
    const relic = RELIC_BY_ID[id];
    if (relic.trigger !== name) return;
    const uses = relic.frequency === 'battle' ? run.relicUsedBattle : run.relicUsedTurn;
    if (uses[id]) return;
    uses[id] = true;
    logEvent(events, 'relic', relicActor.id, targetId, 0, `遗物 · ${relic.name}`);
    effect(run, relic, relicActor, relic.target, targetId, events, { kills: 0 }, false);
  });
}

function bank(state, amount, events) {
  const run = state.adventure.active;
  const earned = Math.round(amount * difficultyOf(run).rewardMultiplier);
  state.adventure.threads += earned;
  run.threadsEarned += earned;
  if (earned) logEvent(events, 'reward', null, null, earned, `${earned} 星线已收入行囊`);
}

function completeNode(run) {
  run.nodes[run.layer].visited = true;
  run.layer += 1;
  run.phase = 'map';
  run.choices = [];
}

function finish(state, win, reason, events) {
  const run = state.adventure.active;
  state.adventure.lastResult = {
    win, reason, regionId: run.regionId, regionName: REGION_BY_ID[run.regionId].name,
    difficultyName: difficultyOf(run).name, nodesCleared: run.layer, threads: run.threadsEarned, tickets: run.ticketsEarned
  };
  if (run.battleStats) state.adventure.lastResult.battleStats = clone(run.battleStats);
  logEvent(events, 'finish', null, null, 0, reason);
  state.adventure.active = null;
}

function cardRewards(run, genericOnly = false) {
  run.choices = rewardCandidates(run, () => random(run), genericOnly).map(({ card, slot }) => {
    const owner = card.familyId ? run.party.find(member => member.id === card.familyId) : run.party.find(member => member.role === card.role) || run.party[0];
    return { ...newCard(run, card.id, owner.id), rewardSlot: slot };
  });
}

function refitCandidates(run) { return run.deck.filter(card => !CARD_BY_ID[card.cardId].familyId); }
function openRefit(run, source, events) {
  const refits = run.refits || [];
  requireThat(run.regionId === 'street' && refits.length < 2 && !refits.some(item => item.source === source), '本局这次改造机会已经使用');
  requireThat(refitCandidates(run).length > 0, '没有可替换的非专属牌');
  run.phase = `${source}Replace`;
  cardRewards(run, true);
  logEvent(events, 'notice', null, null, 0, '已选择换牌机会；放弃本节点其他收益。替换一进一出，不保留原牌升级。');
}
function rewardOwner(run, card, ownerId) {
  const id = ownerId === undefined ? card.ownerId : ownerId;
  requireThat(run.party.some(member => member.id === id), '请选择本队旅伴作为卡牌归属');
  requireThat(!CARD_BY_ID[card.cardId].familyId || CARD_BY_ID[card.cardId].familyId === id, '专属牌只能交给对应旅伴');
  return id;
}
function refitCard(run, action, events) {
  requireThat(['campReplace', 'eventReplace'].includes(run.phase), '当前没有可用的换牌机会');
  if (action.choiceId === 'skip') { completeNode(run); return; }
  const choice = run.choices.find(card => card.uid === action.choiceId);
  const original = refitCandidates(run).find(card => card.uid === action.cardUid);
  requireThat(choice && original && !CARD_BY_ID[choice.cardId].familyId, '请选择一张候选通用牌和一张要替换的非专属牌');
  const ownerId = rewardOwner(run, choice, action.ownerId);
  requireThat(original.cardId !== choice.cardId || original.ownerId !== ownerId, '不能用相同归属的同一张牌替换自己');
  const record = { source: run.phase === 'campReplace' ? 'camp' : 'event', nodeIndex: run.layer, cardUid: original.uid,
    before: { cardId: original.cardId, ownerId: original.ownerId }, after: { cardId: choice.cardId, ownerId } };
  run.refits = [...(run.refits || []), record];
  const previousName = CARD_BY_ID[original.cardId].name;
  original.cardId = choice.cardId; original.ownerId = ownerId; original.upgraded = false;
  logEvent(events, 'refit', ownerId, null, 1, `${previousName}替换为${CARD_BY_ID[choice.cardId].name}，交给${familyName(ownerId)}；牌组张数不变`);
  completeNode(run);
}

function relicRewards(run) {
  const node = run.nodes[run.layer];
  const role = node.options.find(item => item.id === node.chosenId).role;
  const kinds = { guard: ['block', 'heal', 'counter', 'retainBlock'], combo: ['damage', 'energy', 'draw'], echo: ['mark', 'weak', 'burn', 'echo'] }[role];
  const pool = RELICS.filter(item => !run.relics.includes(item.id));
  const preferred = pool.filter(item => kinds.includes(item.kind));
  run.choices = shuffled(run, preferred.length >= 3 ? preferred : pool).slice(0, 3).map(item => item.id);
}

function battleOutcome(state, events) {
  const run = state.adventure.active;
  if (!run.party.some(alive)) { finish(state, false, '旅伴们暂时无法继续，已带回获得的星线', events); return true; }
  if (run.enemies.some(alive)) return false;
  run.charge = 0;
  run.environmentId = null;
  run.interceptorId = null;
  run.pendingChoice = null;
  const temporaryIds = new Set((run.temporaryCards || []).map(card => card.uid));
  for (const key of ['drawPile', 'hand', 'discardPile', 'removed']) run[key] = run[key].filter(uid => !temporaryIds.has(uid));
  run.temporaryCards = [];
  run.party.filter(member => !alive(member)).forEach(member => {
    member.hp = Math.max(1, Math.ceil(member.maxHp * 0.25));
    const recovery = logEvent(events, 'revive', member.id, member.id, member.hp, `${familyName(member.id)}恢复四分之一生命，重新归队`);
    recovery.hpDelta = member.hp;
  });
  run.party.forEach(member => { member.block = 0; member.carriedBlock = 0; member.status = freshStatus(); });
  const type = run.nodes[run.layer].type;
  bank(state, type === 'boss' ? 12 : type === 'elite' ? 8 : 4, events);
  if (type === 'boss') {
    const first = state.adventure.clears[run.regionId].every(count => count === 0);
    run.ticketsEarned = run.difficulty + 1 + (first ? 3 : 0);
    state.tickets += run.ticketsEarned;
    state.adventure.clears[run.regionId][run.difficulty] += 1;
    completeNode(run);
    finish(state, true, '首领的两道迷雾都已散去，这次远行顺利送达', events);
  } else if (type === 'elite') {
    run.phase = 'relicReward';
    relicRewards(run);
  } else {
    run.phase = 'cardReward';
    cardRewards(run);
  }
  return true;
}

function encounterUnit(enemy) {
  return enemy.encounterId ? STREET_ENCOUNTERS[enemy.encounterId].units[enemy.encounterSlot] : null;
}
function spawnEnemy(run, definitionId, encounterId, encounterSlot) {
  const definition = ENEMY_BY_ID[definitionId];
  const slot = encounterId ? STREET_ENCOUNTERS[encounterId].units[encounterSlot] : null;
  const maxHp = Math.ceil((slot ? slot.hp : definition.maxHp) * difficultyOf(run).hpMultiplier);
  return { id: `enemy-${run.nextEnemyId++}`, definitionId, hp: maxHp, maxHp, block: 0, status: freshStatus(), phase: 1, intentIndex: 0,
    ...(slot ? { encounterId, encounterSlot } : {}) };
}

function beginTurn(state, events) {
  const run = state.adventure.active;
  const firstTurn = run.turn === 0;
  run.turn += 1;
  const baseEnergy = run.turn >= BATTLE_RULES.energyGrowthTurn ? BATTLE_RULES.energyLate : BATTLE_RULES.energyStart;
  const releasedCharge = run.charge;
  run.energy = baseEnergy + releasedCharge;
  run.charge = 0;
  addStat(run, 'chargeReleased', releasedCharge);
  if (releasedCharge) logEvent(events, 'chargeRelease', null, null, releasedCharge, `蓄能释放，本回合额外获得 ${releasedCharge} 点能量`);
  run.environmentId = null;
  run.interceptorId = null;
  run.plays = 0;
  run.relicUsedTurn = {};
  run.party.filter(alive).forEach(member => {
    member.usedTurn = {};
    if (!firstTurn) {
      member.status.counter = 0;
      if (member.status.retainBlock > 0) { member.status.retainBlock -= 1; member.carriedBlock = member.block; }
      else { member.block = 0; member.carriedBlock = 0; }
    }
    if (member.status.burn > 0) {
      damage(run, null, member, member.status.burn, events, { direct: false });
      member.status.burn -= 1;
    }
  });
  if (battleOutcome(state, events)) return;
  drawCards(run, 5, events);
  trigger(run, 'turnStart', null, null, events);
  battleOutcome(state, events);
}

function startBattle(state, option, events) {
  const run = state.adventure.active;
  run.phase = 'battle';
  run.battleStats = freshStats();
  run.turn = 0;
  run.plays = 0;
  run.energy = BATTLE_RULES.energyStart;
  run.charge = 0;
  run.environmentId = null;
  run.interceptorId = null;
  run.pendingChoice = null;
  run.temporaryCards = [];
  run.relicUsedTurn = {};
  run.relicUsedBattle = {};
  run.party.forEach(member => { member.block = 0; member.carriedBlock = 0; member.status = freshStatus(); member.usedTurn = {}; member.usedBattle = {}; });
  run.enemies = option.enemyIds.map((id, index) => spawnEnemy(run, id, option.encounterId, index));
  run.hand = [];
  run.discardPile = [];
  run.removed = [];
  run.drawPile = shuffled(run, run.deck.map(card => card.uid));
  trigger(run, 'battleStart', null, null, events);
  if (!battleOutcome(state, events)) beginTurn(state, events);
}

function getPattern(enemy) {
  const definition = ENEMY_BY_ID[enemy.definitionId];
  const patterns = enemy.phase === 2 ? definition.phase2.patterns : definition.patterns;
  return patterns[enemy.intentIndex % patterns.length];
}

function enemyTargets(run, pattern, events, enemy) {
  const party = run.party.filter(alive);
  if (pattern.target === 'all') return party;
  const natural = pattern.target === 'lowest' ? [...party].sort((a, b) => a.hp - b.hp).slice(0, 1) : party.slice(0, 1);
  const interceptor = run.interceptorId && party.find(item => item.id === run.interceptorId);
  if (pattern.kind === 'attack' && interceptor && natural[0] && natural[0].id !== interceptor.id) {
    run.interceptorId = null;
    logEvent(events, 'interceptConsume', interceptor.id, enemy && enemy.id, 1, `${familyName(interceptor.id)}拦下了这次单体攻击`);
    return [interceptor];
  }
  return natural;
}

function enemyAmount(run, pattern, enemy) {
  const slot = encounterUnit(enemy);
  let amount = Math.ceil(pattern.amount * (slot ? slot.attackPercent / 100 : 1) * difficultyOf(run).damageMultiplier);
  if (difficultyOf(run).affixes.some(item => item.id === 'fury') && run.turn % 3 === 0 && pattern.kind === 'attack') amount += 2;
  if (pattern.kind === 'attack') amount += pressureForTurn(run.turn);
  return amount;
}

function pressureForTurn(turn) {
  return turn >= BATTLE_RULES.pressureTurn ? 1 + Math.floor((turn - BATTLE_RULES.pressureTurn) / BATTLE_RULES.pressureStep) : 0;
}

function endTurn(state, events) {
  const run = state.adventure.active;
  const banked = Math.min(BATTLE_RULES.bankLimit, run.energy, STATUS_RULES.maxCharge - run.charge);
  if (banked > 0) {
    run.energy -= banked;
    run.charge += banked;
    logEvent(events, 'chargeBank', null, null, banked, `将 ${banked} 点未用能量存为蓄能，下回合额外获得 ${banked} 点能量`);
  }
  run.energy = 0;
  const retained = run.hand.filter(uid => CARD_BY_ID[findCard(run, uid).cardId].retain);
  run.discardPile.push(...run.hand.filter(uid => !retained.includes(uid)));
  run.hand = retained;
  run.party.forEach(member => { member.status.weak = Math.max(0, member.status.weak - 1); });
  for (const enemy of [...run.enemies]) {
    if (!alive(enemy)) continue;
    enemy.block = 0;
    const statusStart = events.length;
    if (enemy.status.burn > 0) {
      damage(run, null, enemy, enemy.status.burn, events, { direct: false });
      enemy.status.burn = Math.max(0, enemy.status.burn - 1);
    }
    const statusEndedBattle = battleOutcome(state, events);
    for (let index = statusStart; index < events.length; index++) events[index].presentation = 'status-tick';
    if (statusEndedBattle) return;
    if (!alive(enemy)) continue;
    if (difficultyOf(run).affixes.some(item => item.id === 'armor')) enemy.block += 2;
    const actionPhase = enemy.phase;
    const pattern = getPattern(enemy);
    const actionEvent = logEvent(events, 'enemyAction', enemy.id, null, 0, `${ENEMY_BY_ID[enemy.definitionId].name} · ${pattern.name}`);
    actionEvent.intentKind = pattern.kind;
    actionEvent.intentName = pattern.name;
    actionEvent.intentTargets = [];
    actionEvent.intentAll = pattern.target === 'all';
    actionEvent.armor = difficultyOf(run).affixes.some(item => item.id === 'armor') ? 2 : 0;
    if (pattern.kind === 'block') {
      enemy.block += pattern.amount;
      actionEvent.amount = enemy.block;
    }
    else if (pattern.kind === 'summon') {
      run.enemies = run.enemies.filter(alive);
      if (run.enemies.length < 3) {
        const summoned = spawnEnemy(run, pattern.summonId);
        run.enemies.push(summoned);
        actionEvent.summonName = ENEMY_BY_ID[pattern.summonId].name;
        logEvent(events, 'summon', enemy.id, summoned.id, 0, `${ENEMY_BY_ID[pattern.summonId].name}加入战斗`);
      }
    } else {
      const targets = enemyTargets(run, pattern, events, enemy);
      for (const target of targets) {
        if (!alive(enemy) || !alive(target)) continue;
        if (pattern.kind === 'attack') {
          const outcome = damage(run, enemy, target, enemyAmount(run, pattern, enemy), events, { enemyAttack: true });
          actionEvent.intentTargets.push({ id: target.id, name: familyName(target.id), ...outcome });
        }
        else {
          target.status[pattern.kind] += pattern.amount;
          actionEvent.intentTargets.push({ id: target.id, name: familyName(target.id), amount: pattern.amount });
          logEvent(events, pattern.kind, enemy.id, target.id, pattern.amount, `${familyName(target.id)}受到 ${pattern.amount} ${pattern.kind === 'burn' ? '灼烧' : '虚弱'}`);
        }
      }
    }
    if (enemy.phase === actionPhase) enemy.intentIndex += 1;
    enemy.status.weak = Math.max(0, enemy.status.weak - 1);
    if (battleOutcome(state, events)) return;
  }
  const turnStart = events.length;
  beginTurn(state, events);
  for (let index = turnStart; index < events.length; index++) events[index].presentation = 'turn-start';
}

function validateCardTarget(run, card, targetId) {
  const definition = CARD_BY_ID[card.cardId];
  if (definition.target === 'enemy') requireThat(run.enemies.some(item => item.id === targetId && alive(item)), '请选择仍在场的敌人');
  if (definition.target === 'ally') requireThat(run.party.some(item => item.id === targetId && alive(item)), '请选择仍在场的旅伴');
  if (definition.target === 'self' && targetId) requireThat(targetId === card.ownerId, '这张牌只能用于出牌者自己');
  if (['allEnemies', 'allAllies'].includes(definition.target) && targetId) requireThat(false, '群体卡牌不需要单独选择目标');
}

function playCard(state, action, events) {
  const run = state.adventure.active;
  const card = findCard(run, action.cardUid);
  requireThat(card && run.hand.includes(card.uid), '这张牌不在当前手牌中');
  const owner = run.party.find(item => item.id === card.ownerId);
  requireThat(owner && alive(owner), '这位旅伴暂时无法出牌');
  const definition = CARD_BY_ID[card.cardId];
  const payment = paymentFor(run, definition.cost);
  requireThat(payment.energy <= run.energy, `本回合能量不足，还差 ${payment.energy - run.energy} 点；蓄能会在下回合转为额外能量`);
  validateCardTarget(run, card, action.targetId);
  run.energy -= payment.energy;
  run.hand = run.hand.filter(uid => uid !== card.uid);
  (definition.exhaust ? run.removed : run.discardPile).push(card.uid);
  run.plays += 1;
  const cardAction = logEvent(events, 'playCard', owner.id, action.targetId, definition.cost, `${familyName(owner.id)}使用${definition.name}${card.upgraded ? '＋' : ''}`);
  cardAction.cardUid = card.uid;
  cardAction.cardId = card.cardId;
  cardAction.payment = payment;
  cardAction.paymentText = paymentText(payment);
  cardAction.targetKind = definition.target;
  cardAction.targetIds = getTargets(run, definition.target, owner, action.targetId).map(target => target.id);
  const facts = { kills: 0 };
  const effects = card.upgraded ? definition.upgradeEffects : definition.effects;
  const areaTargets = new Set();
  let echoReady = owner.status.echo > 0;
  effects.forEach(descriptor => {
    if (descriptor.minPlays && run.plays < descriptor.minPlays) return;
    if (['damage', 'burn', 'mark', 'weak'].includes(descriptor.kind) && ['allEnemies', 'enemies'].includes(descriptor.target || definition.target)) {
      run.enemies.filter(alive).forEach(enemy => areaTargets.add(enemy.id));
    }
    effect(run, descriptor, owner, definition.target, action.targetId, events, facts);
    if (descriptor.kind === 'damage' && echoReady) {
      echoReady = false;
      owner.status.echo -= 1;
      const targets = getTargets(run, descriptor.target || definition.target, owner, action.targetId);
      const amount = Math.ceil(scaled(descriptor.amount, owner) * STATUS_RULES.echoMultiplier);
      targets.forEach(target => { if (damage(run, owner, target, amount, events, { echo: true }).killed) facts.kills += 1; });
    }
  });
  cardAction.areaTargets = areaTargets.size;
  addStat(run, 'areaTargets', areaTargets.size);
  ['attack', 'guard', 'heal', 'marked'].forEach(name => { if (facts[name]) trigger(run, name, owner, action.targetId, events); });
  if (facts.kills) trigger(run, 'kill', owner, action.targetId, events);
  if (run.plays === 3) trigger(run, 'thirdPlay', owner, action.targetId, events);
  battleOutcome(state, events);
}

function upgradeCandidates(run) {
  return run.deck.filter(card => !card.upgraded && (run.phase !== 'startingUpgrade' || CARD_BY_ID[card.cardId].familyId && TIERS.indexOf(run.party.find(member => member.id === card.ownerId).tier) >= 2));
}

function healParty(run, value, events, fraction = false) {
  run.party.filter(alive).forEach(member => {
    const amount = Math.min(member.maxHp - member.hp, fraction ? Math.ceil(member.maxHp * value) : value);
    member.hp += amount;
    const recovery = logEvent(events, 'heal', member.id, member.id, amount, `${familyName(member.id)}恢复 ${amount} 点生命`);
    recovery.hpDelta = amount;
  });
}

function chooseOpportunity(run, action, events) {
  const pending = run.pendingChoice;
  requireThat(pending, '当前没有待选择的机会');
  requireThat(action.choiceId === 'skip' || pending.options.includes(action.choiceId), '请选择当前候选牌，或跳过');
  if (pending.kind === 'discover') {
    if (action.choiceId !== 'skip') {
      requireThat(run.hand.length < 8, '手牌已满，只能跳过本次发现');
      const owner = run.party.find(member => member.id === pending.ownerId);
      requireThat(owner && alive(owner), '发现机会的旅伴已经倒下，只能跳过');
      const card = newCard(run, action.choiceId, pending.ownerId);
      run.temporaryCards.push(card);
      run.hand.push(card.uid);
      logEvent(events, 'opportunityChoice', pending.ownerId, null, 1, `选择了临时牌${CARD_BY_ID[card.cardId].name}`);
    } else logEvent(events, 'opportunityChoice', pending.ownerId, null, 0, '放弃了本次临时机会');
  } else {
    const selected = action.choiceId === 'skip' ? null : findCard(run, action.choiceId);
    if (selected) requireThat(run.hand.length < 8, '手牌已满，只能跳过本次观星');
    const unselected = pending.options.filter(uid => uid !== action.choiceId);
    run.drawPile.unshift(...unselected.slice().reverse());
    if (selected) {
      run.hand.push(selected.uid);
      logEvent(events, 'opportunityChoice', pending.ownerId, null, 1, `观星选择了${CARD_BY_ID[selected.cardId].name}`);
    } else logEvent(events, 'opportunityChoice', pending.ownerId, null, 0, '把观星候选放回牌堆底');
  }
  run.pendingChoice = null;
}

function tradeCard(run, action, events) {
  const card = findCard(run, action.cardUid);
  requireThat(card && run.hand.includes(card.uid), '这张牌不在当前手牌中');
  const owner = run.party.find(member => member.id === card.ownerId);
  requireThat(owner && alive(owner), '这位旅伴暂时无法改签');
  requireThat(run.drawPile.length > 0 || run.discardPile.length > 0, '没有其他牌可以换入手牌');
  const payment = paymentFor(run, BATTLE_RULES.tradeCost);
  requireThat(payment.energy <= run.energy, '本回合能量不足，蓄能会在下回合转为额外能量，无法改签');
  if (!run.drawPile.length) {
    run.drawPile = shuffled(run, run.discardPile);
    run.discardPile = [];
    logEvent(events, 'shuffle', owner.id, null, run.drawPile.length, '弃牌重新洗入抽牌堆');
  }
  const replacementUid = run.drawPile.pop();
  const replacement = findCard(run, replacementUid);
  requireThat(replacement, '没有找到改签换入的牌');
  run.energy -= payment.energy;
  run.hand = run.hand.filter(uid => uid !== card.uid);
  run.hand.push(replacementUid);
  run.drawPile.unshift(card.uid);
  const event = logEvent(events, 'tradeCard', owner.id, null, BATTLE_RULES.tradeCost, `花费${paymentText(payment)}改签，换入${CARD_BY_ID[replacement.cardId].name}`);
  event.payment = payment;
  event.paymentText = paymentText(payment);
  event.cardUid = card.uid;
  event.replacementUid = replacementUid;
}

function resolve(state, action, events) {
  const run = state.adventure.active;
  requireThat(run, '当前没有进行中的远行');
  ensureRunFields(run);
  requireThat(object(action) && typeof action.type === 'string', '请选择有效的冒险操作');
  if (action.type === 'abandon') { finish(state, false, '旅伴们返回邮局，已获得的星线全部保留', events); return; }
  if (run.pendingChoice) {
    requireThat(action.type === 'chooseOpportunity', '请先完成当前的牌面选择');
    chooseOpportunity(run, action, events);
    return;
  }
  if (action.type === 'chooseNode') {
    requireThat(run.phase === 'map', '请先完成当前节点');
    const node = run.nodes[run.layer];
    const option = node.options.find(item => item.id === action.nodeId);
    requireThat(option && !node.chosenId, '请选择当前可达的路线');
    node.chosenId = option.id;
    if (['battle', 'elite', 'boss'].includes(node.type)) startBattle(state, option, events);
    else if (node.type === 'treasure') { bank(state, 8, events); run.phase = 'relicReward'; relicRewards(run); }
    else { run.phase = node.type; }
  } else if (action.type === 'playCard') {
    requireThat(run.phase === 'battle', '现在没有可以出牌的战斗');
    playCard(state, action, events);
  } else if (action.type === 'tradeCard') {
    requireThat(run.phase === 'battle', '现在没有可以改签的战斗');
    tradeCard(run, action, events);
  } else if (action.type === 'chooseOpportunity') {
    throw new Error('当前没有待选择的机会');
  } else if (action.type === 'endTurn') {
    requireThat(run.phase === 'battle', '现在没有可以结束的回合');
    endTurn(state, events);
  } else if (action.type === 'chooseCard') {
    requireThat(run.phase === 'cardReward', '当前没有待领取的卡牌');
    const card = run.choices.find(item => item.uid === action.choiceId);
    requireThat(action.choiceId === 'skip' || card, '请选择奖励中的卡牌，或跳过');
    if (card) {
      requireThat(run.deck.length < 16, '牌组已满，请跳过本次加牌');
      run.deck.push({ ...card, ownerId: rewardOwner(run, card, action.ownerId) });
    }
    completeNode(run);
  } else if (action.type === 'chooseRelic') {
    requireThat(run.phase === 'relicReward', '当前没有待领取的遗物');
    requireThat(run.choices.includes(action.choiceId) && !run.relics.includes(action.choiceId), '请选择奖励中的遗物');
    run.relics.push(action.choiceId);
    completeNode(run);
  } else if (action.type === 'chooseEvent') {
    requireThat(run.phase === 'event', '当前没有待处理的奇遇');
    const node = run.nodes[run.layer];
    const option = node.options.find(item => item.id === node.chosenId);
    const encounter = REGION_BY_ID[run.regionId].events.find(item => item.id === option.eventId);
    const choice = encounter.choices.find(item => item.id === action.choiceId);
    requireThat(choice, '请选择当前奇遇中的选项');
    if (choice.replace) { openRefit(run, 'event', events); return; }
    if (choice.heal) healParty(run, choice.heal, events);
    if (choice.threads) bank(state, choice.threads, events);
    if (choice.upgrade && upgradeCandidates(run).length) {
      const card = pick(run, upgradeCandidates(run));
      card.upgraded = true;
      logEvent(events, 'upgrade', card.ownerId, null, 0, `${CARD_BY_ID[card.cardId].name}升级了`);
    } else if (choice.upgrade) logEvent(events, 'notice', null, null, 0, '本局所有卡牌均已升级，本次没有可升级的卡牌');
    completeNode(run);
  } else if (action.type === 'rest') {
    requireThat(run.phase === 'camp', '只有营地可以休息');
    healParty(run, 0.35, events, true);
    completeNode(run);
  } else if (action.type === 'chooseRefit') {
    requireThat(run.phase === 'camp', '只有营地可以选择换牌');
    openRefit(run, 'camp', events);
  } else if (action.type === 'refitCard') {
    refitCard(run, action, events);
  } else if (action.type === 'chooseUpgrade') {
    requireThat(run.phase === 'camp', '只有营地可以选择升级');
    requireThat(upgradeCandidates(run).length > 0, '所有卡牌都已经升级，可选择休息');
    run.phase = 'campUpgrade';
  } else if (action.type === 'upgradeCard') {
    requireThat(['campUpgrade', 'startingUpgrade'].includes(run.phase), '当前不能升级卡牌');
    const card = upgradeCandidates(run).find(item => item.uid === action.cardUid);
    requireThat(card, '请选择一张尚未升级的可选卡牌');
    card.upgraded = true;
    logEvent(events, 'upgrade', card.ownerId, null, 0, `${CARD_BY_ID[card.cardId].name}升级了`);
    if (run.phase === 'startingUpgrade') run.phase = 'map';
    else completeNode(run);
  } else throw new Error('未知的冒险操作');
}

function applyAction(state, action) {
  const next = clone(state);
  const events = [];
  resolve(next, action, events);
  if (next.adventure.active) next.adventure.active.log = [...next.adventure.active.log, ...events].slice(-40);
  return { state: next, events };
}

function incomingLoss(state) {
  const run = state.adventure.active;
  if (!run || run.phase !== 'battle' || run.pendingChoice) return null;
  const events = applyAction(state, { type: 'endTurn' }).events;
  return run.party.map(member => ({ id: member.id, name: familyName(member.id),
    loss: events.filter(event => event.targetId === member.id && event.hpDelta < 0).reduce((sum, event) => sum - event.hpDelta, 0) }));
}
function actionImpact(state, result) {
  const run = result.state.adventure.active;
  const events = result.events;
  const damage = events.filter(event => event.targetId && event.targetId.startsWith('enemy-') && event.hpDelta < 0).reduce((sum, event) => sum - event.hpDelta, 0);
  const before = incomingLoss(state), after = incomingLoss(result.state);
  const kills = events.filter(event => event.kind === 'defeat').length;
  const phases = events.filter(event => event.kind === 'bossPhase').length;
  const lines = [`本次实际伤害 ${damage}${kills ? ` · 击败 ${kills} 名敌人` : ''}${phases ? ' · Boss转阶段清状态' : ''}`];
  if (!run || run.phase !== 'battle') lines.push('本战结束，不再承受本轮敌方行动。');
  else if (run.pendingChoice) lines.push('先完成发现或观星选择，再更新回合风险。');
  else {
    lines.push(`出牌后剩 ${run.energy} 能量；立即结束预计下回合 ${nextTurnEnergy(run)} 能量。`);
    if (before && after) lines.push('立即结束的生命损失：' + after.map(member => `${member.name} ${before.find(item => item.id === member.id).loss}→${member.loss}`).join(' / ') + '（含状态伤害，不抵消治疗）。');
  }
  return lines.join('\n');
}
function nextTurnEnergy(run) {
  const banked = Math.min(BATTLE_RULES.bankLimit, run.energy, STATUS_RULES.maxCharge - (run.charge || 0));
  return (run.turn + 1 >= BATTLE_RULES.energyGrowthTurn ? BATTLE_RULES.energyLate : BATTLE_RULES.energyStart) + (run.charge || 0) + banked;
}
function previewAction(state, action, withImpact = false) {
  try {
    const result = applyAction(state, action);
    const events = action && action.type === 'tradeCard' ? result.events.map(event => {
      if (event.kind !== 'tradeCard') return event;
      const { replacementUid, ...visible } = event;
      return { ...visible, text: `花费${event.paymentText}改签，换入一张牌` };
    }) : result.events;
    return { allowed: true, reason: '', events, ...(withImpact && action.type === 'playCard' ? { impactSummary: actionImpact(state, result) } : {}), summary: events.map(item => item.text).join('；') || '确认后继续前行' };
  } catch (error) {
    return { allowed: false, reason: error.message, events: [], summary: error.message };
  }
}

function levelUp(state, familyId) {
  requireThat(FIGHTERS[familyId] && ownedTier(state, familyId), '只能培养已经结识的旅伴');
  requireThat(!state.journey && !state.adventure.active, '请先完成当前的故事或远行，再培养旅伴');
  const level = state.adventure.levels[familyId];
  requireThat(level < 10, '这位旅伴已经达到 10 级');
  const cost = level * 10;
  requireThat(state.adventure.threads >= cost, `星线不足，本次培养需要 ${cost} 星线`);
  const next = clone(state);
  next.adventure.threads -= cost;
  next.adventure.levels[familyId] += 1;
  const events = [];
  logEvent(events, 'levelUp', familyId, familyId, level + 1, `${familyName(familyId)}成长到 ${level + 1} 级`);
  return { state: next, events };
}

function statusText(unit) {
  const labels = { mark: '标记', weak: '虚弱', burn: '灼烧', counter: '反击', echo: '回响', retainBlock: '留盾' };
  return STATUS_KEYS.filter(key => unit.status[key] > 0).map(key => key === 'weak' || key === 'retainBlock'
    ? `${labels[key]}${unit.status[key]}回合` : `${labels[key]} ${unit.status[key]}`).join(' · ');
}

function memberView(member) {
  return { ...member, name: familyName(member.id), passiveName: FIGHTERS[member.id].passive.name, passiveDescription: FIGHTERS[member.id].passive.description, statusText: statusText(member), down: !alive(member), image: heroes[member.id].idle, roleName: ROLE_NAMES[member.role] };
}

function cardDescription(definition, card, owner) {
  const effects = card.upgraded ? definition.upgradeEffects : definition.effects;
  const targetNames = { self: '自身', enemy: '目标敌人', ally: '目标旅伴', party: '全队', allAllies: '全队', enemies: '所有敌人', allEnemies: '所有敌人' };
  const descriptions = effects.map(item => {
    const amount = cardEffectAmount(item, owner);
    const target = ['draw', 'energy', 'charge', 'discover', 'scout', 'environment'].includes(item.kind) ? '' : `${targetNames[item.target || definition.target]} `;
    const condition = item.minPlays ? `第${item.minPlays}张或之后：` : '';
    if (item.kind === 'environment') return `${condition}本轮环境变为${ENVIRONMENTS[item.environmentId].name}`;
    if (item.kind === 'discover') return `${condition}发现 ${amount} 张临时机会牌并选择 1 张`;
    if (item.kind === 'scout') return `${condition}观星牌堆顶 ${amount} 张并选择 1 张`;
    if (item.kind === 'intercept') return `${condition}${target}拦截下一次敌方单体攻击`;
    if (item.kind === 'weak' || item.kind === 'retainBlock') return `${condition}${target}${EFFECT_LABELS[item.kind]}${amount}回合`;
    return `${condition}${target}${EFFECT_LABELS[item.kind]} ${amount}`;
  });
  if (definition.retain) descriptions.push('回合结束保留');
  if (definition.exhaust) descriptions.push('打出后本战消耗');
  return descriptions.join('；');
}

function shortCardDescription(definition, card, owner) {
  const effects = card.upgraded ? definition.upgradeEffects : definition.effects;
  const first = effects[0];
  const amount = cardEffectAmount(first, owner);
  if (first.kind === 'stripBlock' && effects[1]?.kind === 'damage') return `破${amount}·伤${cardEffectAmount(effects[1], owner)}`;
  const scope = first.target || definition.target;
  const compactLabel = { damage: '伤', block: '盾', heal: '疗', burn: '灼', mark: '标', weak: '弱' }[first.kind];
  if (compactLabel && ['allAllies', 'party', 'allEnemies', 'enemies'].includes(scope)) return `${['allAllies', 'party'].includes(scope) ? '全队' : '全敌'}${amount}${compactLabel}`;
  const hits = effects.filter(item => item.kind === 'damage' && item.amount === first.amount && !item.minPlays).length;
  if (first.kind === 'damage' && hits > 1) return `${amount}×${hits} 伤害`;
  if (first.kind === 'draw') return `抽 ${amount} 张`;
  if (first.kind === 'charge') return `${amount} 层蓄能`;
  if (first.kind === 'weak') return `虚弱${amount}回合`;
  if (first.kind === 'echo') return `${amount} 次回响`;
  if (first.kind === 'retainBlock') return `留盾${amount}回合`;
  if (first.kind === 'environment') return ENVIRONMENTS[first.environmentId].name;
  if (first.kind === 'discover') return `发现 ${amount} 选 1`;
  if (first.kind === 'scout') return `观星 ${amount} 选 1`;
  if (first.kind === 'intercept') return '拦截单体攻击';
  return `${amount} ${EFFECT_LABELS[first.kind]}`;
}

function cardView(run, card, choice = false) {
  const definition = CARD_BY_ID[card.cardId];
  const owner = run.party.find(item => item.id === card.ownerId);
  const payment = paymentFor(run, definition.cost);
  const shortage = Math.max(0, definition.cost - availableBudget(run));
  const reserveHint = run.charge ? '；已有蓄能会在下回合释放' : '';
  const reason = choice ? '' : run.phase !== 'battle' ? '当前不在战斗中' : run.pendingChoice ? '请先完成当前选择' : !alive(owner) ? '出牌者已倒下' : !run.hand.includes(card.uid) ? '不在手牌中' : shortage ? `能量不足，还差 ${shortage} 点${reserveHint}` : '';
  const tradePayment = paymentFor(run, BATTLE_RULES.tradeCost);
  const canTrade = !choice && run.phase === 'battle' && !run.pendingChoice && alive(owner) && run.hand.includes(card.uid)
    && tradePayment.energy <= run.energy && (run.drawPile.length > 0 || run.discardPile.length > 0);
  return { ...card, choiceId: card.uid || card.cardId, ownerName: familyName(card.ownerId), name: `${definition.name}${card.upgraded ? '＋' : ''}`, cost: definition.cost, target: definition.target,
    description: cardDescription(definition, card, owner), shortDescription: shortCardDescription(definition, card, owner), flavor: card.upgraded ? definition.upgradeDescription : definition.description,
    role: definition.role, exhaust: Boolean(definition.exhaust), retain: Boolean(definition.retain), temporary: opportunityCardIds.has(card.cardId), payment, paymentText: paymentText(payment), availableBudget: availableBudget(run),
    playable: !choice && !reason, reason, canTrade, tradePayment, tradePaymentText: paymentText(tradePayment) };
}

function intentView(enemy, plannedEvents) {
  const action = plannedEvents.find(item => item.kind === 'enemyAction' && item.actorId === enemy.id);
  if (!action) return { intentText: '按当前局面，本回合将在它行动前结束或将其击败', intentShort: '行动前将被阻止', intentTarget: '', intentTargets: [], intentKind: 'none', intentAll: false, intentName: '' };
  const names = action.intentTargets.map(item => item.name).join('、');
  const targetLabel = action.intentAll ? '全队' : names;
  const amounts = [...new Set(action.intentTargets.map(item => item.amount))].join('/');
  let text = action.intentName;
  let short = '';
  if (action.intentKind === 'attack') {
    text += `：${action.intentTargets.map(item => `${item.name} ${item.amount} 伤害（护盾抵挡 ${item.blocked}，失去 ${item.hpLoss} 生命）`).join('、')}`;
    short = `${targetLabel} · ${amounts}伤害`;
  } else if (action.intentKind === 'block') {
    text += `：自身总计获得 ${action.amount} 护盾`;
    short = `自身 · ${action.amount}护盾`;
  } else if (action.intentKind === 'summon') {
    text += `：${action.summonName ? `召唤${action.summonName}` : '敌方位置已满，不能召唤'}`;
    short = action.summonName ? `召唤 · ${action.summonName}` : '召唤位置已满';
  } else if (action.intentKind === 'burn') {
    text += `：${names} 获得 ${amounts} 灼烧`;
    short = `${targetLabel} · 灼烧${amounts}`;
  } else {
    text += `：${names} 虚弱${amounts}回合`;
    short = `${targetLabel} · 虚弱${amounts}回合`;
  }
  if (action.armor) text += ' · 行动前＋2盾';
  return { intentText: text, intentShort: short, intentTarget: names, intentTargets: clone(action.intentTargets), intentKind: action.intentKind, intentAll: action.intentAll, intentName: action.intentName };
}

function plannedEnemyEvents(state) {
  let previewState = state;
  const run = state.adventure.active;
  if (run && run.pendingChoice) previewState = applyAction(state, { type: 'chooseOpportunity', choiceId: 'skip' }).state;
  return previewAction(previewState, { type: 'endTurn' }).events;
}

function getAdventureView(state, rewardOwners = {}) {
  const profile = state.adventure;
  const levels = FAMILIES.map(family => {
    const tier = ownedTier(state, family.id) || 'R';
    const level = profile.levels[family.id];
    const owned = Boolean(ownedTier(state, family.id));
    const cost = level < 10 ? level * 10 : 0;
    const reason = !owned ? '尚未结识' : state.journey || profile.active ? '旅途中不能培养' : level === 10 ? '已达到满级' : profile.threads < cost ? '星线不足' : '';
    const fighter = FIGHTERS[family.id];
    const cards = fighter.cards.map(id => {
      const definition = CARD_BY_ID[id];
      return { id, name: definition.name, cost: definition.cost, target: definition.target, role: definition.role,
        description: cardDescription(definition, { upgraded: false }, { tier, level }),
        shortDescription: shortCardDescription(definition, { upgraded: false }, { tier, level }),
        upgradeDescription: cardDescription(definition, { upgraded: true }, { tier, level }) };
    });
    return { id: family.id, name: family.name, tier, level, cost, owned, canUpgrade: !reason, reason, role: fighter.role, roleName: ROLE_NAMES[fighter.role], maxHp: scaled(fighter.maxHp, { tier, level }), nextMaxHp: scaled(fighter.maxHp, { tier, level: Math.min(10, level + 1) }), levelBonus: (level - 1) * 4, image: heroes[family.id].idle, passiveName: fighter.passive.name, passiveDescription: fighter.passive.description, cards };
  });
  const regions = REGIONS.map((region, index) => ({ ...clone(region), unlocked: regionUnlocked(profile, index), difficulties: DIFFICULTIES.map(item => ({ ...clone(item), unlocked: regionUnlocked(profile, index) && difficultyUnlocked(profile, region.id, item.id), clears: profile.clears[region.id][item.id] })) }));
  const tactics = STARTING_TACTICS.map(tactic => ({
    ...clone(tactic),
    cards: tactic.cards.map((id, index) => {
      const definition = CARD_BY_ID[id];
      const owner = levels.find(item => item.id === state.team[index]);
      return { id, name: definition.name, cost: definition.cost, ownerName: owner.name, description: cardDescription(definition, { upgraded: false }, owner) };
    })
  }));
  let runView = null;
  const run = profile.active;
  if (run) {
    const enemyPlan = run.phase === 'battle' ? plannedEnemyEvents(state) : [];
    let event = null;
    let choices = [];
    if (['cardReward', 'campReplace', 'eventReplace'].includes(run.phase)) choices = run.choices.map(card => ({
      ...cardView(run, { ...card, ownerId: rewardOwner(run, card, rewardOwners[card.uid]) }, true), rewardLabel: SLOT_NAMES[card.rewardSlot] || '奖励候选',
      rewardReason: rewardReason(card, card.rewardSlot, run.deck),
      ownerOptions: run.party.filter(member => !CARD_BY_ID[card.cardId].familyId || CARD_BY_ID[card.cardId].familyId === member.id).map(member => ({ id: member.id, name: familyName(member.id), selected: member.id === (rewardOwners[card.uid] || card.ownerId) }))
    }));
    if (run.phase === 'relicReward') choices = run.choices.map(id => ({ id, ...RELIC_BY_ID[id] }));
    if (['campUpgrade', 'startingUpgrade'].includes(run.phase)) choices = upgradeCandidates(run).map(card => ({ ...cardView(run, card), upgradeDescription: cardDescription(CARD_BY_ID[card.cardId], { ...card, upgraded: true }, run.party.find(member => member.id === card.ownerId)) }));
    if (run.phase === 'event') {
      const node = run.nodes[run.layer];
      const option = node.options.find(item => item.id === node.chosenId);
      const encounter = REGION_BY_ID[run.regionId].events.find(item => item.id === option.eventId);
      event = { title: encounter.title, text: encounter.text };
      choices = encounter.choices.map(choice => ({ ...choice, description: `${choice.description}${choice.threads ? ` · 实得 ${Math.round(choice.threads * difficultyOf(run).rewardMultiplier)} 星线` : ''}` }));
    }
    const hints = { startingUpgrade: '高稀有旅伴带来一次开局专属牌升级，请选择一张', map: '选择本层一条路线继续', battle: '点击卡牌，再选择目标；伤害以确认预览为准', cardReward: '选择一张牌加入本局牌组，也可以跳过', relicReward: '选择一件遗物，本局持续生效', event: '作出选择后立即结算', camp: '全队恢复 35% 最大生命，或升级一张牌', campUpgrade: '选择一张牌升级，本次机会只使用一次' };
    runView = {
      id: run.id, tacticName: (STARTING_TACTICS.find(item => item.id === (run.tacticId || 'classic')) || STARTING_TACTICS[0]).name,
      regionId: run.regionId, regionName: REGION_BY_ID[run.regionId].name, difficulty: run.difficulty, difficultyName: difficultyOf(run).name,
      phase: run.phase, layer: run.layer, progress: Math.round(run.layer / 9 * 100), nodes: run.nodes.map(node => ({ ...clone(node), current: node.index === run.layer })),
      battleStats: run.battleStats ? clone(run.battleStats) : null, battleStatLines: statLines(run.battleStats),
      deckAnalysis: analyzeDeck(run.deck, run.party), refitsUsed: (run.refits || []).length,
      canRefit: run.regionId === 'street' && !(run.refits || []).some(item => item.source === 'camp'),
      replaceCards: ['campReplace', 'eventReplace'].includes(run.phase) ? refitCandidates(run).map(card => cardView(run, card, true)) : [],
      party: run.party.map(memberView), hand: run.hand.map(uid => cardView(run, findCard(run, uid))),
      enemies: run.enemies.filter(alive).map((enemy, index) => ({ ...clone(enemy), actionOrder: index + 1, phaseWarning: ENEMY_BY_ID[enemy.definitionId].phase2 && enemy.phase === 1 ? '转阶段清除全部状态和护盾' : '', name: ENEMY_BY_ID[enemy.definitionId].name, rank: ENEMY_BY_ID[enemy.definitionId].rank, statusText: statusText(enemy), ...intentView(enemy, enemyPlan) })),
      energy: run.energy, charge: run.charge || 0, maxCharge: STATUS_RULES.maxCharge, availableBudget: availableBudget(run),
      energyRefill: run.turn >= BATTLE_RULES.energyGrowthTurn ? BATTLE_RULES.energyLate : BATTLE_RULES.energyStart,
      nextEnergyIfEnd: nextTurnEnergy(run),
      nextEnergyRefill: (run.turn + 1 >= BATTLE_RULES.energyGrowthTurn ? BATTLE_RULES.energyLate : BATTLE_RULES.energyStart) + (run.charge || 0),
      bankAtEnd: Math.min(BATTLE_RULES.bankLimit, run.energy, STATUS_RULES.maxCharge - (run.charge || 0)),
      environmentId: run.environmentId || null, environmentName: run.environmentId ? ENVIRONMENTS[run.environmentId].name : '',
      interceptorId: run.interceptorId || null, interceptorName: run.interceptorId ? familyName(run.interceptorId) : '', pressure: pressureForTurn(run.turn),
      pendingChoice: run.pendingChoice ? { kind: run.pendingChoice.kind, ownerId: run.pendingChoice.ownerId, ownerName: familyName(run.pendingChoice.ownerId),
        options: run.pendingChoice.options.map(choiceId => {
          const card = run.pendingChoice.kind === 'discover' ? { cardId: choiceId, ownerId: run.pendingChoice.ownerId, upgraded: false } : findCard(run, choiceId);
          return { ...cardView(run, card, true), choiceId };
        }) } : null,
      turn: run.turn, plays: run.plays, drawCount: run.drawPile.length, discardCount: run.discardPile.length, removedCount: run.removed.length, deck: run.deck.map(card => cardView(run, card)), temporaryCards: (run.temporaryCards || []).map(card => cardView(run, card)),
      relics: run.relics.map(id => ({ ...RELIC_BY_ID[id] })), choices, event, log: clone(run.log), threadsEarned: run.threadsEarned, hint: ['campReplace', 'eventReplace'].includes(run.phase) ? '先选新牌和归属，再选换出的非专属牌；一进一出，原牌升级不继承' : run.phase === 'camp' && run.regionId === 'street' ? '休息、升级或替换非专属牌，三选一' : hints[run.phase]
    };
  }
  return { regions, threads: profile.threads, party: state.team.map(id => levels.find(item => item.id === id)), levels, tactics, run: runView, result: clone(profile.lastResult) };
}

function assertAdventure(profile, state) {
  const check = condition => requireThat(condition, '冒险存档内容不完整或已损坏，已保留原存档');
  check(object(profile) && integer(profile.threads) && object(profile.levels) && object(profile.clears));
  FAMILIES.forEach(item => check(integer(profile.levels[item.id]) && profile.levels[item.id] >= 1 && profile.levels[item.id] <= 10));
  REGIONS.forEach(item => check(Array.isArray(profile.clears[item.id]) && profile.clears[item.id].length === 3 && profile.clears[item.id].every(integer)));
  REGIONS.forEach((item, index) => {
    check(!profile.clears[item.id][1] || profile.clears[item.id][0] > 0);
    check(!profile.clears[item.id][2] || profile.clears[item.id][1] > 0);
    check(!profile.clears[item.id].some(Boolean) || regionUnlocked(profile, index));
  });
  const checkStats = stats => {
    check(object(stats) && typeof stats.partial === 'boolean' && STAT_KEYS.every(key => integer(stats[key])));
  };
  const checkResult = result => {
    check(object(result) && typeof result.win === 'boolean' && REGION_BY_ID[result.regionId] && typeof result.reason === 'string');
    check(result.regionName === REGION_BY_ID[result.regionId].name && DIFFICULTIES.some(item => item.name === result.difficultyName));
    check(integer(result.nodesCleared) && result.nodesCleared <= 9 && integer(result.threads) && integer(result.tickets));
    check(!result.win || result.nodesCleared === 9);
    if (result.battleStats !== undefined) checkStats(result.battleStats);
  };
  if (profile.lastResult !== null) checkResult(profile.lastResult);
  if (profile.active === null) return profile;
  const run = profile.active;
  check(!state.journey && profile.lastResult === null && object(run) && PHASES.includes(run.phase));
  check(REGION_BY_ID[run.regionId] && DIFFICULTIES.some(item => item.id === run.difficulty));
  check(regionUnlocked(profile, REGIONS.findIndex(item => item.id === run.regionId)) && difficultyUnlocked(profile, run.regionId, run.difficulty));
  check(typeof run.id === 'string' && integer(run.seed) && run.seed > 0 && run.seed <= 0xffffffff && integer(run.rng) && run.rng > 0 && run.rng <= 0xffffffff);
  check(integer(run.layer) && run.layer < 9 && integer(run.energy) && (run.charge === undefined || integer(run.charge) && run.charge <= STATUS_RULES.maxCharge) && integer(run.turn) && integer(run.plays));
  if (run.battleStats !== undefined) checkStats(run.battleStats);
  check(run.tacticId === undefined || STARTING_TACTICS.some(item => item.id === run.tacticId));
  check(run.environmentId === undefined || run.environmentId === null || Boolean(ENVIRONMENTS[run.environmentId]));
  check(run.pendingChoice === undefined || run.pendingChoice === null || object(run.pendingChoice));
  check(run.temporaryCards === undefined || Array.isArray(run.temporaryCards));
  check(integer(run.nextCardId) && run.nextCardId > 0 && integer(run.nextEnemyId) && run.nextEnemyId > 0 && integer(run.threadsEarned) && run.threadsEarned <= profile.threads && run.ticketsEarned === 0);
  check(Array.isArray(run.party) && run.party.length === 3 && new Set(run.party.map(item => item.id)).size === 3);
  check(run.interceptorId === undefined || run.interceptorId === null || run.party.some(member => member.id === run.interceptorId && alive(member)));
  const checkUnit = unit => {
    check(object(unit) && integer(unit.hp) && integer(unit.maxHp) && unit.maxHp > 0 && unit.hp <= unit.maxHp && integer(unit.block));
    check(unit.carriedBlock === undefined || integer(unit.carriedBlock) && unit.carriedBlock <= unit.block);
    check(object(unit.status) && STATUS_KEYS.every(key => integer(unit.status[key])));
  };
  run.party.forEach(member => {
    check(FIGHTERS[member.id] && ownedTier(state, member.id) && state.team.includes(member.id) && TIERS.includes(member.tier) && state.collection[member.id][member.tier] > 0);
    check(integer(member.level) && member.level >= 1 && member.level <= 10 && member.role === FIGHTERS[member.id].role);
    check(member.level === profile.levels[member.id] && member.maxHp === scaled(FIGHTERS[member.id].maxHp, member) && object(member.usedTurn) && object(member.usedBattle));
    check(Object.values(member.usedTurn).every(value => typeof value === 'boolean') && Object.values(member.usedBattle).every(value => typeof value === 'boolean'));
    checkUnit(member);
  });
  check(Array.isArray(run.nodes) && run.nodes.length === 9);
  run.nodes.forEach((node, index) => {
    check(object(node) && node.index === index && NODE_NAMES[node.type] && Array.isArray(node.options) && node.options.length >= 1 && node.options.length <= 2);
    check(typeof node.visited === 'boolean' && node.visited === (index < run.layer));
    check(node.chosenId === null || node.options.some(option => option.id === node.chosenId));
    check(index < run.layer ? Boolean(node.chosenId) : index > run.layer ? node.chosenId === null : true);
    node.options.forEach((option, choiceIndex) => {
      check(option.id === `node-${index}-${choiceIndex}` && ROLE_NAMES[option.role] && typeof option.name === 'string' && typeof option.description === 'string');
      check(Array.isArray(option.enemyIds) && option.enemyIds.every(id => ENEMY_BY_ID[id] && ENEMY_BY_ID[id].regionId === run.regionId));
      if (option.encounterId !== undefined) {
        const encounter = STREET_ENCOUNTERS[option.encounterId];
        check(run.regionId === 'street' && encounter && encounter.rank === (node.type === 'battle' ? 'normal' : node.type));
        check(node.type === 'elite' || node.type === 'battle' && index > 0);
        check(JSON.stringify(option.enemyIds) === JSON.stringify(encounter.units.map(unit => unit.id)));
      } else if (['battle', 'elite', 'boss'].includes(node.type)) check(option.enemyIds.length === 1 && ENEMY_BY_ID[option.enemyIds[0]].rank === (node.type === 'battle' ? 'normal' : node.type));
      else check(option.enemyIds.length === 0);
      if (node.type === 'event') check(REGION_BY_ID[run.regionId].events.some(item => item.id === option.eventId));
    });
  });
  check(ROUTES.some(route => route.every((type, index) => run.nodes[index].type === type)));
  check(['map', 'startingUpgrade'].includes(run.phase) ? run.nodes[run.layer].chosenId === null : Boolean(run.nodes[run.layer].chosenId));
  const phaseNodes = { battle: ['battle', 'elite', 'boss'], cardReward: ['battle'], relicReward: ['elite', 'treasure'], event: ['event'], camp: ['camp'], campUpgrade: ['camp'], campReplace: ['camp'], eventReplace: ['event'] };
  if (phaseNodes[run.phase]) check(phaseNodes[run.phase].includes(run.nodes[run.layer].type));
  check(Array.isArray(run.deck) && run.deck.length >= 12 && run.deck.length <= 16 && new Set(run.deck.map(card => card.uid)).size === run.deck.length);
  const checkCard = card => {
    check(object(card) && /^card-[1-9]\d*$/.test(card.uid) && Number(card.uid.slice(5)) < run.nextCardId && CARD_BY_ID[card.cardId]);
    check(run.party.some(member => member.id === card.ownerId) && typeof card.upgraded === 'boolean');
    check(!CARD_BY_ID[card.cardId].familyId || CARD_BY_ID[card.cardId].familyId === card.ownerId);
    check(card.rewardSlot === undefined || REWARD_SLOTS.includes(card.rewardSlot));
  };
  run.deck.forEach(card => { checkCard(card); check(permanentCardIds.has(card.cardId)); });
  const temporaryCards = run.temporaryCards || [];
  temporaryCards.forEach(card => { checkCard(card); check(opportunityCardIds.has(card.cardId) && card.upgraded === false && CARD_BY_ID[card.cardId].exhaust); });
  check(new Set([...run.deck, ...temporaryCards].map(card => card.uid)).size === run.deck.length + temporaryCards.length);
  const startingTactic = STARTING_TACTICS.find(item => item.id === (run.tacticId || 'classic'));
  const expectedCards = new Map();
  run.party.forEach((member, index) => {
    [startingTactic.cards[index] || 'strike', 'guard', ...FIGHTERS[member.id].cards].forEach((cardId, offset) => {
      expectedCards.set(`card-${index * 4 + offset + 1}`, { cardId, ownerId: member.id });
    });
  });
  const refits = run.refits || [];
  check(run.refits === undefined || Array.isArray(run.refits));
  check(refits.length <= 2 && refits.every(object));
  check(new Set(refits.map(item => item.source)).size === refits.length);
  let previousRefitNode = -1;
  for (const item of refits) {
    check(object(item) && run.regionId === 'street' && ['camp', 'event'].includes(item.source));
    check(integer(item.nodeIndex) && item.nodeIndex > previousRefitNode && item.nodeIndex < run.layer && run.nodes[item.nodeIndex].type === item.source);
    previousRefitNode = item.nodeIndex;
    check(run.deck.some(card => card.uid === item.cardUid));
    for (const value of [item.before, item.after]) check(object(value) && permanentCardIds.has(value.cardId) && !CARD_BY_ID[value.cardId].familyId && run.party.some(member => member.id === value.ownerId));
    const expected = expectedCards.get(item.cardUid);
    check(!expected || expected.cardId === item.before.cardId && expected.ownerId === item.before.ownerId);
    expectedCards.set(item.cardUid, item.after);
  }
  for (const [uid, expected] of expectedCards) {
    const card = run.deck.find(item => item.uid === uid);
    check(card && card.cardId === expected.cardId && card.ownerId === expected.ownerId);
  }
  if (['campReplace', 'eventReplace'].includes(run.phase)) {
    const source = run.phase === 'campReplace' ? 'camp' : 'event';
    check(run.regionId === 'street' && refits.length < 2 && !refits.some(item => item.source === source));
  }
  const allCards = runCards(run);
  for (const key of ['hand', 'drawPile', 'discardPile', 'removed']) check(Array.isArray(run[key]) && run[key].every(uid => allCards.some(card => card.uid === uid)));
  const piles = [...run.hand, ...run.drawPile, ...run.discardPile, ...run.removed];
  check(new Set(piles).size === piles.length && run.hand.length <= 8);
  const pending = run.pendingChoice || null;
  let pendingCardUids = [];
  if (pending) {
    check(run.phase === 'battle' && ['discover', 'scout'].includes(pending.kind) && run.party.some(member => member.id === pending.ownerId && alive(member)));
    check(Array.isArray(pending.options) && pending.options.length >= 1 && pending.options.length <= 3 && new Set(pending.options).size === pending.options.length);
    if (pending.kind === 'discover') check(pending.options.every(id => opportunityCardIds.has(id)));
    else {
      check(pending.options.every(uid => allCards.some(card => card.uid === uid) && !piles.includes(uid)));
      pendingCardUids = pending.options;
    }
  }
  if (run.phase === 'battle') {
    check(piles.length + pendingCardUids.length === allCards.length && run.party.some(alive));
    allCards.forEach(card => {
      const ownerDown = !alive(run.party.find(member => member.id === card.ownerId));
      const removed = run.removed.includes(card.uid);
      check(!ownerDown || removed);
      check(!removed || ownerDown || CARD_BY_ID[card.cardId].exhaust);
    });
  } else check(temporaryCards.length === 0 && !pending);
  check(Array.isArray(run.enemies) && run.enemies.filter(alive).length <= 3 && new Set(run.enemies.map(enemy => enemy.id)).size === run.enemies.length);
  run.enemies.forEach(enemy => {
    check(ENEMY_BY_ID[enemy.definitionId] && /^enemy-[1-9]\d*$/.test(enemy.id) && Number(enemy.id.slice(6)) < run.nextEnemyId && integer(enemy.intentIndex));
    check(enemy.phase === 1 || enemy.phase === 2 && ENEMY_BY_ID[enemy.definitionId].phase2);
    const definition = ENEMY_BY_ID[enemy.definitionId];
    if (enemy.encounterId !== undefined) {
      const encounter = STREET_ENCOUNTERS[enemy.encounterId];
      check(run.regionId === 'street' && encounter && integer(enemy.encounterSlot));
      const unit = encounter.units[enemy.encounterSlot];
      check(unit && unit.id === enemy.definitionId && enemy.phase === 1);
      check(run.nodes.some(node => node.chosenId && node.options.some(option => option.id === node.chosenId && option.encounterId === enemy.encounterId)));
    } else check(enemy.encounterSlot === undefined);
    const slot = encounterUnit(enemy);
    check(definition.regionId === run.regionId && enemy.maxHp === Math.ceil((slot ? slot.hp : enemy.phase === 2 ? definition.phase2.maxHp : definition.maxHp) * difficultyOf(run).hpMultiplier));
    checkUnit(enemy);
  });
  if (run.phase === 'battle') check(run.enemies.some(alive));
  check(Array.isArray(run.relics) && new Set(run.relics).size === run.relics.length && run.relics.every(id => RELIC_BY_ID[id]));
  check(object(run.relicUsedTurn) && object(run.relicUsedBattle) && Array.isArray(run.choices) && Array.isArray(run.log));
  check(Object.values(run.relicUsedTurn).every(value => typeof value === 'boolean') && Object.values(run.relicUsedBattle).every(value => typeof value === 'boolean'));
  if (['cardReward', 'campReplace', 'eventReplace'].includes(run.phase)) {
    check(run.choices.length === 3 && new Set(run.choices.map(card => card.uid)).size === 3);
    if (run.phase !== 'cardReward') check(run.choices.every(card => CARD_BY_ID[card.cardId] && !CARD_BY_ID[card.cardId].familyId));
    run.choices.forEach(card => { checkCard(card); check(permanentCardIds.has(card.cardId) && !run.deck.some(item => item.uid === card.uid)); });
  }
  if (run.phase === 'relicReward') check(run.choices.length === 3 && new Set(run.choices).size === 3 && run.choices.every(id => RELIC_BY_ID[id] && !run.relics.includes(id)));
  if (run.phase === 'startingUpgrade') check(run.layer === 0 && upgradeCandidates(run).length > 0);
  return profile;
}

module.exports = { createAdventureProfile, assertAdventure, startExpedition, applyAction, previewAction, levelUp, getAdventureView };

const { FAMILIES, TIERS } = require('./content');
const { FIGHTERS, CARDS, RELICS, ENEMIES, REGIONS, DIFFICULTIES, CARD_BY_ID, RELIC_BY_ID, ENEMY_BY_ID, REGION_BY_ID } = require('./combat-content');

const PHASES = ['startingUpgrade', 'map', 'battle', 'cardReward', 'relicReward', 'event', 'camp', 'campUpgrade'];
const STATUS_KEYS = ['mark', 'weak', 'burn', 'counter', 'echo', 'retainBlock'];
const EFFECT_LABELS = { damage: '伤害', block: '护盾', heal: '治疗', draw: '抽牌', energy: '能量', mark: '标记', weak: '虚弱', burn: '灼烧', counter: '反击', echo: '回响次数', retainBlock: '留盾' };
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
  return route.map((type, index) => {
    const count = type === 'boss' || type === 'camp' ? 1 : 2;
    const options = Array.from({ length: count }, (_, option) => {
      const role = ['guard', 'combo', 'echo'][(index + option) % 3];
      let enemyIds = [];
      if (type === 'battle') enemyIds = [region.normalIds[(index + option) % region.normalIds.length]];
      if (type === 'elite') enemyIds = [region.eliteIds[option % region.eliteIds.length]];
      if (type === 'boss') enemyIds = [region.bossId];
      const eventId = type === 'event' ? region.events[option % region.events.length].id : null;
      const name = enemyIds.length ? ENEMY_BY_ID[enemyIds[0]].name : type === 'event' ? region.events.find(item => item.id === eventId).title : NODE_NAMES[type];
      return { id: `node-${index}-${option}`, name, description: type === 'battle' ? `胜利后可选择${ROLE_NAMES[role]}方向的新牌` : type === 'elite' ? '战胜精英，挑选一件遗物' : type === 'boss' ? '击破两个阶段，完成本次远行' : type === 'camp' ? '恢复全队生命，或升级一张牌' : type === 'treasure' ? '带走星线，挑选一件遗物' : '作出选择，决定这次收获', role, enemyIds, eventId };
    });
    return { index, type, label: NODE_NAMES[type], options, visited: false, chosenId: null };
  });
}

function startExpedition(state, regionId, difficulty, seed) {
  requireThat(!state.journey && !state.adventure.active, '请先完成当前的故事或远行');
  const regionIndex = REGIONS.findIndex(item => item.id === regionId);
  requireThat(regionIndex >= 0, '没有找到这片区域');
  requireThat(DIFFICULTIES.some(item => item.id === difficulty), '请选择有效的副本难度');
  requireThat(regionUnlocked(state.adventure, regionIndex), '请先通关前一区域的普通难度');
  requireThat(difficultyUnlocked(state.adventure, regionId, difficulty), '请先通关本区域的前一难度');
  requireThat(Number.isInteger(seed) && seed > 0 && seed <= 0xffffffff, '远行种子必须是非零 32 位整数');
  requireThat(Array.isArray(state.team) && state.team.length === 3 && new Set(state.team).size === 3 && state.team.every(id => FIGHTERS[id] && ownedTier(state, id)), '请选择三位已经结识的不同旅伴');
  const next = clone(state);
  const party = state.team.map(id => {
    const member = { id, tier: ownedTier(state, id), level: state.adventure.levels[id], role: FIGHTERS[id].role };
    member.maxHp = scaled(FIGHTERS[id].maxHp, member);
    return { ...member, hp: member.maxHp, block: 0, status: freshStatus(), usedTurn: {}, usedBattle: {} };
  });
  const run = {
    id: `${regionId}-${difficulty}-${seed}`, regionId, difficulty, seed, rng: seed, phase: 'map', layer: 0, nodes: [], party,
    deck: [], drawPile: [], hand: [], discardPile: [], removed: [], enemies: [], energy: 0, turn: 0, plays: 0,
    nextCardId: 1, nextEnemyId: 1, relics: [], relicUsedTurn: {}, relicUsedBattle: {}, choices: [], log: [], threadsEarned: 0, ticketsEarned: 0
  };
  party.forEach(member => {
    ['strike', 'guard', ...FIGHTERS[member.id].cards].forEach(id => run.deck.push(newCard(run, id, member.id)));
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
  const ids = run.deck.filter(card => card.ownerId === member.id).map(card => card.uid);
  for (const key of ['drawPile', 'hand', 'discardPile']) run[key] = run[key].filter(uid => !ids.includes(uid));
  run.removed = [...new Set([...run.removed, ...ids])];
  member.block = 0;
  logEvent(events, 'down', member.id, member.id, 0, `${familyName(member.id)}暂时倒下，所属卡牌本场退场`);
}

function damage(run, actor, target, base, events, { direct = true, enemyAttack = false, echo = false, applyWeak = true } = {}) {
  if (!target || !alive(target)) return { killed: false, amount: 0, blocked: 0, hpLoss: 0 };
  let amount = Math.max(0, base);
  if (direct && applyWeak && actor && actor.status.weak > 0) amount = Math.floor(amount * 0.75);
  if (direct && target.status.mark > 0) { amount += 2; target.status.mark -= 1; }
  const blocked = direct ? Math.min(target.block, amount) : 0;
  target.block -= blocked;
  const lost = Math.min(target.hp, amount - blocked);
  target.hp -= lost;
  const targetName = target.definitionId ? ENEMY_BY_ID[target.definitionId].name : familyName(target.id);
  const impact = logEvent(events, echo ? 'echo' : direct ? 'damage' : 'burn', actor && actor.id, target.id, lost, `${targetName}${blocked ? `的护盾挡下 ${blocked}，` : ''}受到 ${lost} 点伤害`);
  impact.hpDelta = -lost;
  let killed = target.hp === 0;
  if (killed && target.definitionId) {
    const definition = ENEMY_BY_ID[target.definitionId];
    if (definition.phase2 && target.phase === 1) {
      target.phase = 2;
      target.maxHp = Math.ceil(definition.phase2.maxHp * difficultyOf(run).hpMultiplier);
      target.hp = target.maxHp;
      target.block = 0;
      target.status = freshStatus();
      target.intentIndex = 0;
      killed = false;
      logEvent(events, 'bossPhase', target.id, target.id, target.hp, `${definition.name}进入第二阶段`);
    } else logEvent(events, 'defeat', actor && actor.id, target.id, 0, `${definition.name}被击败了`);
  } else if (killed) removeDownedCards(run, target, events);
  if (enemyAttack && target.status.counter > 0 && actor && alive(actor)) {
    damage(run, target, actor, target.status.counter, events, { direct: true, applyWeak: false });
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

function effect(run, descriptor, actor, cardTarget, targetId, events, facts, scale = true) {
  const { kind } = descriptor;
  const amount = scale && actor && !actor.definitionId ? cardEffectAmount(descriptor, actor) : descriptor.amount;
  if (kind === 'draw') { drawCards(run, amount, events, actor && actor.id); return; }
  if (kind === 'energy') { run.energy += amount; logEvent(events, 'energy', actor && actor.id, null, amount, `获得 ${amount} 点能量`); return; }
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
      facts.heal = true;
      const recovery = logEvent(events, 'heal', actor && actor.id, target.id, healed, `${name}恢复 ${healed} 点生命`);
      recovery.hpDelta = healed;
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
  logEvent(events, 'finish', null, null, 0, reason);
  state.adventure.active = null;
}

function cardRewards(run) {
  const node = run.nodes[run.layer];
  const option = node.options.find(item => item.id === node.chosenId);
  const pool = CARDS.filter(card => !['strike', 'guard'].includes(card.id) && (!card.familyId || run.party.some(member => member.id === card.familyId)));
  const preferred = pool.filter(card => card.role === option.role);
  const candidates = shuffled(run, preferred.length >= 3 ? preferred : pool).slice(0, 3);
  run.choices = candidates.map(card => {
    const owner = card.familyId ? run.party.find(member => member.id === card.familyId) : run.party.find(member => member.role === card.role) || run.party[0];
    return newCard(run, card.id, owner.id);
  });
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
  run.party.filter(member => !alive(member)).forEach(member => {
    member.hp = Math.max(1, Math.ceil(member.maxHp * 0.25));
    const recovery = logEvent(events, 'revive', member.id, member.id, member.hp, `${familyName(member.id)}恢复四分之一生命，重新归队`);
    recovery.hpDelta = member.hp;
  });
  run.party.forEach(member => { member.block = 0; member.status = freshStatus(); });
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

function spawnEnemy(run, definitionId) {
  const definition = ENEMY_BY_ID[definitionId];
  const maxHp = Math.ceil(definition.maxHp * difficultyOf(run).hpMultiplier);
  return { id: `enemy-${run.nextEnemyId++}`, definitionId, hp: maxHp, maxHp, block: 0, status: freshStatus(), phase: 1, intentIndex: 0 };
}

function beginTurn(state, events) {
  const run = state.adventure.active;
  const firstTurn = run.turn === 0;
  run.turn += 1;
  if (!firstTurn) run.energy = 3;
  run.plays = 0;
  run.relicUsedTurn = {};
  run.party.filter(alive).forEach(member => {
    member.usedTurn = {};
    if (!firstTurn) {
      member.status.counter = 0;
      if (member.status.retainBlock > 0) member.status.retainBlock -= 1;
      else member.block = 0;
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
  run.turn = 0;
  run.plays = 0;
  run.energy = 3;
  run.relicUsedTurn = {};
  run.relicUsedBattle = {};
  run.party.forEach(member => { member.block = 0; member.status = freshStatus(); member.usedTurn = {}; member.usedBattle = {}; });
  run.enemies = option.enemyIds.map(id => spawnEnemy(run, id));
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

function enemyTargets(run, pattern) {
  const party = run.party.filter(alive);
  if (pattern.target === 'all') return party;
  if (pattern.target === 'lowest') return [...party].sort((a, b) => a.hp - b.hp).slice(0, 1);
  return party.slice(0, 1);
}

function enemyAmount(run, pattern) {
  let amount = Math.ceil(pattern.amount * difficultyOf(run).damageMultiplier);
  if (difficultyOf(run).affixes.some(item => item.id === 'fury') && run.turn % 3 === 0 && pattern.kind === 'attack') amount += 2;
  return amount;
}

function endTurn(state, events) {
  const run = state.adventure.active;
  run.discardPile.push(...run.hand);
  run.hand = [];
  run.party.forEach(member => { member.status.weak = Math.max(0, member.status.weak - 1); });
  for (const enemy of [...run.enemies]) {
    if (!alive(enemy)) continue;
    enemy.block = 0;
    if (enemy.status.burn > 0) {
      damage(run, null, enemy, enemy.status.burn, events, { direct: false });
      enemy.status.burn = Math.max(0, enemy.status.burn - 1);
    }
    if (battleOutcome(state, events)) return;
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
      const targets = enemyTargets(run, pattern);
      for (const target of targets) {
        if (!alive(enemy) || !alive(target)) continue;
        if (pattern.kind === 'attack') {
          const outcome = damage(run, enemy, target, enemyAmount(run, pattern), events, { enemyAttack: true });
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
  beginTurn(state, events);
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
  const card = run.deck.find(item => item.uid === action.cardUid);
  requireThat(card && run.hand.includes(card.uid), '这张牌不在当前手牌中');
  const owner = run.party.find(item => item.id === card.ownerId);
  requireThat(owner && alive(owner), '这位旅伴暂时无法出牌');
  const definition = CARD_BY_ID[card.cardId];
  requireThat(run.energy >= definition.cost, '本回合能量不足');
  validateCardTarget(run, card, action.targetId);
  run.energy -= definition.cost;
  run.hand = run.hand.filter(uid => uid !== card.uid);
  run.discardPile.push(card.uid);
  run.plays += 1;
  logEvent(events, 'playCard', owner.id, action.targetId, definition.cost, `${familyName(owner.id)}使用${definition.name}${card.upgraded ? '＋' : ''}`);
  const facts = { kills: 0 };
  const effects = card.upgraded ? definition.upgradeEffects : definition.effects;
  let echoReady = owner.status.echo > 0;
  effects.forEach(descriptor => {
    effect(run, descriptor, owner, definition.target, action.targetId, events, facts);
    if (descriptor.kind === 'damage' && echoReady) {
      echoReady = false;
      owner.status.echo -= 1;
      const targets = getTargets(run, descriptor.target || definition.target, owner, action.targetId);
      const amount = Math.ceil(scaled(descriptor.amount, owner) * 0.5);
      targets.forEach(target => { damage(run, owner, target, amount, events, { echo: true }); });
    }
  });
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

function resolve(state, action, events) {
  const run = state.adventure.active;
  requireThat(run, '当前没有进行中的远行');
  requireThat(object(action) && typeof action.type === 'string', '请选择有效的冒险操作');
  if (action.type === 'abandon') { finish(state, false, '旅伴们返回邮局，已获得的星线全部保留', events); return; }
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
  } else if (action.type === 'endTurn') {
    requireThat(run.phase === 'battle', '现在没有可以结束的回合');
    endTurn(state, events);
  } else if (action.type === 'chooseCard') {
    requireThat(run.phase === 'cardReward', '当前没有待领取的卡牌');
    const card = run.choices.find(item => item.uid === action.choiceId);
    requireThat(action.choiceId === 'skip' || card, '请选择奖励中的卡牌，或跳过');
    if (card) run.deck.push(card);
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

function previewAction(state, action) {
  try {
    const result = applyAction(state, action);
    return { allowed: true, reason: '', events: result.events, summary: result.events.map(item => item.text).join('；') || '确认后继续前行' };
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
  return { ...member, name: familyName(member.id), passiveName: FIGHTERS[member.id].passive.name, passiveDescription: FIGHTERS[member.id].passive.description, statusText: statusText(member), down: !alive(member), image: `/assets/prizes/${member.id}/${member.tier}.png`, actionImage: `/assets/prizes/${member.id}/${member.tier}.png`, roleName: ROLE_NAMES[member.role] };
}

function cardDescription(definition, card, owner) {
  const effects = card.upgraded ? definition.upgradeEffects : definition.effects;
  const targetNames = { self: '自身', enemy: '目标敌人', ally: '目标旅伴', party: '全队', allAllies: '全队', enemies: '所有敌人', allEnemies: '所有敌人' };
  return effects.map(item => {
    const amount = cardEffectAmount(item, owner);
    const target = ['draw', 'energy'].includes(item.kind) ? '' : `${targetNames[item.target || definition.target]} `;
    if (item.kind === 'weak' || item.kind === 'retainBlock') return `${target}${EFFECT_LABELS[item.kind]}${amount}回合`;
    return `${target}${EFFECT_LABELS[item.kind]} ${amount}`;
  }).join('；');
}

function shortCardDescription(definition, card, owner) {
  const first = (card.upgraded ? definition.upgradeEffects : definition.effects)[0];
  const amount = cardEffectAmount(first, owner);
  if (first.kind === 'draw') return `抽 ${amount} 张`;
  if (first.kind === 'weak') return `虚弱${amount}回合`;
  if (first.kind === 'echo') return `${amount} 次回响`;
  if (first.kind === 'retainBlock') return `留盾${amount}回合`;
  return `${amount} ${EFFECT_LABELS[first.kind]}`;
}

function cardView(run, card) {
  const definition = CARD_BY_ID[card.cardId];
  const owner = run.party.find(item => item.id === card.ownerId);
  const reason = run.phase !== 'battle' ? '当前不在战斗中' : !alive(owner) ? '出牌者已倒下' : !run.hand.includes(card.uid) ? '不在手牌中' : run.energy < definition.cost ? '能量不足' : '';
  return { ...card, choiceId: card.uid, ownerName: familyName(card.ownerId), name: `${definition.name}${card.upgraded ? '＋' : ''}`, cost: definition.cost, target: definition.target, description: cardDescription(definition, card, owner), shortDescription: shortCardDescription(definition, card, owner), flavor: card.upgraded ? definition.upgradeDescription : definition.description, role: definition.role, playable: !reason, reason };
}

function intentView(enemy, plannedEvents) {
  const action = plannedEvents.find(item => item.kind === 'enemyAction' && item.actorId === enemy.id);
  if (!action) return { intentText: '按当前局面，本回合将在它行动前结束或将其击败', intentShort: '行动前将被阻止', intentTarget: '', intentTargets: [] };
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
  return { intentText: text, intentShort: short, intentTarget: names, intentTargets: clone(action.intentTargets) };
}

function getAdventureView(state) {
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
    return { id: family.id, name: family.name, tier, level, cost, owned, canUpgrade: !reason, reason, role: fighter.role, roleName: ROLE_NAMES[fighter.role], maxHp: scaled(fighter.maxHp, { tier, level }), nextMaxHp: scaled(fighter.maxHp, { tier, level: Math.min(10, level + 1) }), levelBonus: (level - 1) * 4, image: `/assets/prizes/${family.id}/${tier}.png`, passiveName: fighter.passive.name, passiveDescription: fighter.passive.description, cards };
  });
  const regions = REGIONS.map((region, index) => ({ ...clone(region), unlocked: regionUnlocked(profile, index), difficulties: DIFFICULTIES.map(item => ({ ...clone(item), unlocked: regionUnlocked(profile, index) && difficultyUnlocked(profile, region.id, item.id), clears: profile.clears[region.id][item.id] })) }));
  let runView = null;
  const run = profile.active;
  if (run) {
    const plannedEnemyEvents = run.phase === 'battle' ? previewAction(state, { type: 'endTurn' }).events : [];
    let event = null;
    let choices = [];
    if (run.phase === 'cardReward') choices = run.choices.map(card => cardView(run, card));
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
      id: run.id, regionId: run.regionId, regionName: REGION_BY_ID[run.regionId].name, difficulty: run.difficulty, difficultyName: difficultyOf(run).name,
      phase: run.phase, layer: run.layer, progress: Math.round(run.layer / 9 * 100), nodes: run.nodes.map(node => ({ ...clone(node), current: node.index === run.layer })),
      party: run.party.map(memberView), hand: run.hand.map(uid => cardView(run, run.deck.find(card => card.uid === uid))),
      enemies: run.enemies.filter(alive).map(enemy => ({ ...clone(enemy), name: ENEMY_BY_ID[enemy.definitionId].name, rank: ENEMY_BY_ID[enemy.definitionId].rank, statusText: statusText(enemy), ...intentView(enemy, plannedEnemyEvents) })),
      energy: run.energy, turn: run.turn, drawCount: run.drawPile.length, discardCount: run.discardPile.length, deck: run.deck.map(card => cardView(run, card)),
      relics: run.relics.map(id => ({ ...RELIC_BY_ID[id] })), choices, event, log: clone(run.log), threadsEarned: run.threadsEarned, hint: hints[run.phase]
    };
  }
  return { regions, threads: profile.threads, party: state.team.map(id => levels.find(item => item.id === id)), levels, run: runView, result: clone(profile.lastResult) };
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
  const checkResult = result => {
    check(object(result) && typeof result.win === 'boolean' && REGION_BY_ID[result.regionId] && typeof result.reason === 'string');
    check(result.regionName === REGION_BY_ID[result.regionId].name && DIFFICULTIES.some(item => item.name === result.difficultyName));
    check(integer(result.nodesCleared) && result.nodesCleared <= 9 && integer(result.threads) && integer(result.tickets));
    check(!result.win || result.nodesCleared === 9);
  };
  if (profile.lastResult !== null) checkResult(profile.lastResult);
  if (profile.active === null) return profile;
  const run = profile.active;
  check(!state.journey && profile.lastResult === null && object(run) && PHASES.includes(run.phase));
  check(REGION_BY_ID[run.regionId] && DIFFICULTIES.some(item => item.id === run.difficulty));
  check(regionUnlocked(profile, REGIONS.findIndex(item => item.id === run.regionId)) && difficultyUnlocked(profile, run.regionId, run.difficulty));
  check(typeof run.id === 'string' && integer(run.seed) && run.seed > 0 && run.seed <= 0xffffffff && integer(run.rng) && run.rng > 0 && run.rng <= 0xffffffff);
  check(integer(run.layer) && run.layer < 9 && integer(run.energy) && integer(run.turn) && integer(run.plays));
  check(integer(run.nextCardId) && run.nextCardId > 0 && integer(run.nextEnemyId) && run.nextEnemyId > 0 && integer(run.threadsEarned) && run.threadsEarned <= profile.threads && run.ticketsEarned === 0);
  check(Array.isArray(run.party) && run.party.length === 3 && new Set(run.party.map(item => item.id)).size === 3);
  const checkUnit = unit => {
    check(object(unit) && integer(unit.hp) && integer(unit.maxHp) && unit.maxHp > 0 && unit.hp <= unit.maxHp && integer(unit.block));
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
      if (['battle', 'elite', 'boss'].includes(node.type)) check(option.enemyIds.length === 1 && ENEMY_BY_ID[option.enemyIds[0]].rank === (node.type === 'battle' ? 'normal' : node.type));
      else check(option.enemyIds.length === 0);
      if (node.type === 'event') check(REGION_BY_ID[run.regionId].events.some(item => item.id === option.eventId));
    });
  });
  check(ROUTES.some(route => route.every((type, index) => run.nodes[index].type === type)));
  check(['map', 'startingUpgrade'].includes(run.phase) ? run.nodes[run.layer].chosenId === null : Boolean(run.nodes[run.layer].chosenId));
  const phaseNodes = { battle: ['battle', 'elite', 'boss'], cardReward: ['battle'], relicReward: ['elite', 'treasure'], event: ['event'], camp: ['camp'], campUpgrade: ['camp'] };
  if (phaseNodes[run.phase]) check(phaseNodes[run.phase].includes(run.nodes[run.layer].type));
  check(Array.isArray(run.deck) && run.deck.length >= 12 && run.deck.length <= 16 && new Set(run.deck.map(card => card.uid)).size === run.deck.length);
  const checkCard = card => {
    check(object(card) && /^card-[1-9]\d*$/.test(card.uid) && Number(card.uid.slice(5)) < run.nextCardId && CARD_BY_ID[card.cardId]);
    check(run.party.some(member => member.id === card.ownerId) && typeof card.upgraded === 'boolean');
    check(!CARD_BY_ID[card.cardId].familyId || CARD_BY_ID[card.cardId].familyId === card.ownerId);
  };
  run.deck.forEach(checkCard);
  for (const key of ['hand', 'drawPile', 'discardPile', 'removed']) check(Array.isArray(run[key]) && run[key].every(uid => run.deck.some(card => card.uid === uid)));
  const piles = [...run.hand, ...run.drawPile, ...run.discardPile, ...run.removed];
  check(new Set(piles).size === piles.length && run.hand.length <= 8);
  if (run.phase === 'battle') {
    check(piles.length === run.deck.length && run.party.some(alive));
    run.deck.forEach(card => check(run.removed.includes(card.uid) === !alive(run.party.find(member => member.id === card.ownerId))));
  }
  check(Array.isArray(run.enemies) && run.enemies.filter(alive).length <= 3 && new Set(run.enemies.map(enemy => enemy.id)).size === run.enemies.length);
  run.enemies.forEach(enemy => {
    check(ENEMY_BY_ID[enemy.definitionId] && /^enemy-[1-9]\d*$/.test(enemy.id) && Number(enemy.id.slice(6)) < run.nextEnemyId && integer(enemy.intentIndex));
    check(enemy.phase === 1 || enemy.phase === 2 && ENEMY_BY_ID[enemy.definitionId].phase2);
    const definition = ENEMY_BY_ID[enemy.definitionId];
    check(definition.regionId === run.regionId && enemy.maxHp === Math.ceil((enemy.phase === 2 ? definition.phase2.maxHp : definition.maxHp) * difficultyOf(run).hpMultiplier));
    checkUnit(enemy);
  });
  if (run.phase === 'battle') check(run.enemies.some(alive));
  check(Array.isArray(run.relics) && new Set(run.relics).size === run.relics.length && run.relics.every(id => RELIC_BY_ID[id]));
  check(object(run.relicUsedTurn) && object(run.relicUsedBattle) && Array.isArray(run.choices) && Array.isArray(run.log));
  check(Object.values(run.relicUsedTurn).every(value => typeof value === 'boolean') && Object.values(run.relicUsedBattle).every(value => typeof value === 'boolean'));
  if (run.phase === 'cardReward') {
    check(run.choices.length === 3 && new Set(run.choices.map(card => card.uid)).size === 3);
    run.choices.forEach(card => { checkCard(card); check(!run.deck.some(item => item.uid === card.uid)); });
  }
  if (run.phase === 'relicReward') check(run.choices.length === 3 && new Set(run.choices).size === 3 && run.choices.every(id => RELIC_BY_ID[id] && !run.relics.includes(id)));
  if (run.phase === 'startingUpgrade') check(run.layer === 0 && upgradeCandidates(run).length > 0);
  return profile;
}

module.exports = { createAdventureProfile, assertAdventure, startExpedition, applyAction, previewAction, levelUp, getAdventureView };

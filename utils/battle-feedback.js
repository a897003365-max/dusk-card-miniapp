// 战斗反馈只整理已经由 combat resolver 结算的事件。
// 这里不改写存档，也不计算新的伤害；页面可以安全地把返回值当成纯展示快照。

const TIMINGS = {
  player: { actionMs: 220, impactMs: 700, gapMs: 0 },
  enemy: { actionMs: 360, impactMs: 700, gapMs: 0 },
  boss: { actionMs: 800, impactMs: 1200, gapMs: 300 },
  prelude: { actionMs: 0, impactMs: 650, gapMs: 0 }
};

const BOSS_THEMES = {
  'paper-lion': { id: 'paper-lion', label: '纸刃', actionLabel: '纸刃', impactLabel: '纸风', actionClass: 'paper-blade', impactClass: 'paper-burst' },
  'ink-tide': { id: 'ink-tide', label: '墨击', actionLabel: '墨击', impactLabel: '墨浪', actionClass: 'ink-wave', impactClass: 'ink-splash' },
  'bell-warden': { id: 'bell-warden', label: '铃环', actionLabel: '铃环', impactLabel: '音浪', actionClass: 'bell-ring', impactClass: 'bell-pulse' }
};

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function findUnit(units, id) {
  return [...(units && units.party || []), ...(units && units.enemies || [])].find(unit => unit && unit.id === id) || null;
}

function unitKind(unit, units) {
  if (!unit) return 'system';
  if ((units && units.enemies || []).some(item => item.id === unit.id)) return 'enemy';
  if ((units && units.party || []).some(item => item.id === unit.id)) return 'player';
  return unit.definitionId ? 'enemy' : 'player';
}

function themeForUnit(unit) {
  if (unit && BOSS_THEMES[unit.definitionId]) return BOSS_THEMES[unit.definitionId];
  return { id: 'paper', label: '纸响', actionLabel: '纸响', impactLabel: '轻击', actionClass: 'light-cast', impactClass: 'light-hit' };
}

function slotPercent(index, count) {
  if (index < 0 || !count) return 50;
  return ((index + 0.5) / count) * 100;
}

function eventTargetIds(events) {
  return [...new Set((events || []).map(event => event && (event.targetId || (event.kind === 'enemyAction' && event.intentKind === 'block' ? event.actorId : null))).filter(Boolean))];
}

function intentMeta(enemy, action) {
  const source = action || enemy || {};
  const targets = Array.isArray(source.intentTargets) ? source.intentTargets : [];
  const names = targets.map(target => target.name).filter(Boolean);
  const all = typeof source.intentAll === 'boolean' ? source.intentAll : (!action && (/^(全队|全体)/.test(enemy.intentShort || '') || /(?:全队|全体)/.test(enemy.intentText || '')));
  const kind = source.intentKind || '';
  const self = kind === 'block' || kind === 'summon' || (!action && /^(自身|召唤)/.test(enemy.intentShort || ''));
  const targetLabel = self ? '自身' : all ? '全队' : names.join('、');
  const scope = self ? '自身' : all ? '全体' : targets.length > 1 ? '多目标' : '单体';
  return {
    intentAll: all,
    intentKind: kind,
    intentName: source.intentName || '',
    intentTargets: clone(targets),
    intentTargetIds: targets.map(target => target.id).filter(Boolean),
    intentTargetLabel: targetLabel,
    intentScope: scope,
    intentScopeLabel: self ? '自身' : `${scope} · ${targetLabel || '无目标'}`
  };
}

function timingFor(actorKind, actor) {
  if (actorKind === 'player') return TIMINGS.player;
  if (actorKind === 'enemy' && actor && (actor.rank === 'boss' || BOSS_THEMES[actor.definitionId])) return TIMINGS.boss;
  return TIMINGS.enemy;
}

function makeFrame(events, actionType, units, actionEvent, index, prelude = false) {
  const list = events || [];
  const action = actionEvent || list.find(event => event.kind === 'enemyAction') || null;
  const enemyAction = action && action.kind === 'enemyAction' ? action : null;
  const actor = prelude ? null : enemyAction ? findUnit(units, enemyAction.actorId) : findUnit(units, list.find(event => event.actorId)?.actorId);
  const actorKind = prelude ? 'system' : enemyAction ? 'enemy' : actor ? unitKind(actor, units) : 'system';
  const timing = prelude ? list.some(event => event.hpDelta || event.kind === 'chargeRelease') ? TIMINGS.prelude : { actionMs: 0, impactMs: 300, gapMs: 0 } : timingFor(actorKind, actor);
  const intent = actorKind === 'enemy' ? intentMeta(actor, enemyAction) : { intentAll: false, intentKind: '', intentName: '', intentTargets: [], intentTargetIds: [], intentTargetLabel: '', intentScope: '单体', intentScopeLabel: '' };
  const theme = themeForUnit(actor);
  const actionLabel = enemyAction ? enemyAction.intentName || enemyAction.text || '敌人行动' : prelude ? list.some(event => event.kind === 'burn' && event.hpDelta < 0) ? '灼烧结算' : list.some(event => event.kind === 'chargeRelease') ? '蓄能释放' : list.some(event => event.kind === 'draw') ? '补充手牌' : '持续效果' : actorKind === 'player' ? list.find(event => event.kind === 'playCard')?.text || '伙伴出牌' : '战斗反馈';
  const cardAction = action && action.kind === 'playCard' ? action : null;
  const cardAll = cardAction && ['allEnemies', 'allAllies', 'party'].includes(cardAction.targetKind);
  const targetIds = cardAction && Array.isArray(cardAction.targetIds) ? clone(cardAction.targetIds) : intent.intentTargetIds.length ? intent.intentTargetIds : eventTargetIds(list);
  return {
    id: `${actionType || 'battle'}-${index}-${action ? action.actorId : actorKind}`,
    index,
    actionType,
    actorId: action ? action.actorId : actor && actor.id || null,
    actorKind,
    actorDefinitionId: actor && actor.definitionId || '',
    actionEvent: clone(action),
    events: clone(list),
    eventKinds: [...new Set(list.map(event => event.kind))],
    actionLabel,
    actionMs: timing.actionMs,
    impactMs: timing.impactMs,
    gapMs: timing.gapMs,
    timingKind: timing === TIMINGS.boss ? 'boss' : actorKind,
    intentAll: intent.intentAll,
    intentKind: intent.intentKind,
    intentName: intent.intentName,
    intentTargets: intent.intentTargets,
    intentTargetIds: intent.intentTargetIds,
    intentTargetLabel: intent.intentTargetLabel,
    intentScope: intent.intentScope,
    intentScopeLabel: cardAction ? cardAll ? '全体' : cardAction.targetKind === 'self' ? '自身' : '单体' : intent.intentScopeLabel,
    targetIds,
    targetMode: intent.intentAll || cardAll ? 'all' : targetIds.length > 1 ? 'multi' : targetIds.length === 1 ? 'single' : 'none',
    theme: clone(theme),
    prelude
  };
}

// 规则显式标记持续伤害和新回合边界，避免把下一名敌人的灼烧归给上一攻击者。
function buildBattleTimeline(events, actionType, units = {}) {
  const list = Array.isArray(events) ? events : [];
  if (!list.length) return [];
  if (actionType !== 'endTurn') return [makeFrame(list, actionType, units, list.find(event => event.kind === 'playCard'), 0)];
  const segments = [];
  const leading = [];
  let segment;
  for (const event of list) {
    if (!segment && event.kind === 'chargeBank') { leading.push(event); continue; }
    const independent = event.presentation || (event.kind === 'burn' && event.actorId == null && event.hpDelta < 0 ? 'status-tick' : null);
    const type = event.kind === 'enemyAction' ? 'enemy' : independent;
    if (!segment || event.kind === 'enemyAction' || type && type !== segment.type) {
      segment = { type: type || 'system', action: event.kind === 'enemyAction' ? event : null, events: segments.length ? [] : leading.splice(0) };
      segments.push(segment);
    }
    segment.events.push(event);
  }
  if (!segments.length && leading.length) segments.push({ type: 'system', action: null, events: leading });
  return segments.map((segment, index) => makeFrame(segment.events, actionType, units, segment.action, index, segment.type !== 'enemy'));
}

function impactForUnit(events, id) {
  const lines = [];
  let damage = 0;
  let heal = 0;
  let blocked = 0;
  let shield = 0;
  (events || []).forEach(event => {
    const targetId = event && (event.targetId || (event.kind === 'enemyAction' && event.intentKind === 'block' ? event.actorId : null));
    if (!event || targetId !== id) return;
    if (event.hpDelta < 0) {
      damage += Math.abs(event.hpDelta);
      lines.push({ tone: 'hurt', text: `−${Math.abs(event.hpDelta)}`, kind: 'damage' });
    } else if (event.hpDelta > 0) {
      heal += event.hpDelta;
      lines.push({ tone: 'heal', text: `+${event.hpDelta}`, kind: 'heal' });
    }
    if (event.blocked > 0) {
      blocked += event.blocked;
      lines.push({ tone: 'shield', text: `盾−${event.blocked}`, kind: 'blocked' });
    }
    if (event.kind === 'stripBlock' && event.amount > 0) lines.push({ tone: 'shield', text: `破盾−${event.amount}`, kind: 'break' });
    if (event.kind === 'block' && event.amount > 0) {
      shield += event.amount;
      lines.push({ tone: 'shield', text: `盾+${event.amount}`, kind: 'shield' });
    }
    if (event.kind === 'enemyAction' && event.intentKind === 'block' && event.amount > 0) {
      shield += event.amount;
      lines.push({ tone: 'shield', text: `盾+${event.amount}`, kind: 'shield' });
    }
  });
  if (!damage && blocked > 0) lines.unshift({ tone: 'shield', text: '格挡', kind: 'guarded' });
  const primary = lines.find(line => line.kind === 'damage') || lines.find(line => line.kind === 'heal') || lines.find(line => line.kind === 'guarded') || lines.find(line => line.kind === 'blocked') || lines.find(line => line.kind === 'shield') || lines.find(line => line.kind === 'break');
  return {
    lines: lines.map((line, index) => ({ ...line, key: index })),
    impact: primary ? primary.text : '',
    impactTone: primary ? primary.tone : '',
    damage,
    heal,
    blocked,
    shield,
    hit: damage > 0,
    guarded: !damage && blocked > 0
  };
}

function indexesForTarget(id, units = {}) {
  const enemyIndex = (units.enemies || []).findIndex(unit => unit.id === id);
  if (enemyIndex >= 0) return { side: 'enemy', index: enemyIndex, count: (units.enemies || []).length };
  const partyIndex = (units.party || []).findIndex(unit => unit.id === id);
  if (partyIndex >= 0) return { side: 'party', index: partyIndex, count: (units.party || []).length };
  return { side: 'unknown', index: -1, count: 0 };
}

function rayStyle(sourceId, targetId, units) {
  const sourcePoint = units.points && units.points[sourceId];
  const targetPoint = units.points && units.points[targetId];
  if (!sourcePoint || !targetPoint) return '';
  const dx = targetPoint.x - sourcePoint.x;
  const dy = targetPoint.y - sourcePoint.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  return `left:${sourcePoint.x}px;top:${sourcePoint.y}px;width:${Math.max(4, length)}px;transform:rotate(${angle}deg);`;
}

function pointStyle(id, units) {
  const point = units.points && units.points[id];
  return point ? `left:${point.x}px;top:${point.y}px;` : '';
}

function buildBattleFx(frame, phase, units = {}) {
  if (!frame) return [];
  const targets = phase === 'action' ? frame.targetIds : eventTargetIds(frame.events);
  const sourceId = frame.actorId;
  const actor = findUnit(units, sourceId);
  const theme = frame.theme || themeForUnit(actor);
  const effects = [];
  const validTargets = targets.filter(id => findUnit(units, id));
  if (phase === 'action' && frame.actorKind === 'enemy' && frame.intentKind && frame.intentKind !== 'block' && frame.intentKind !== 'summon') {
    if (frame.intentAll) effects.push({ key: `${frame.id}-wave`, className: `battle-fx fx-action fx-group ${theme.actionClass}`, range: 'all', label: theme.actionLabel || theme.label });
    else validTargets.forEach((id, index) => {
      const style = rayStyle(sourceId, id, units);
      if (style) effects.push({ key: `${frame.id}-ray-${id}-${index}`, className: `battle-fx fx-action fx-single ${theme.actionClass}`, range: 'single', targetId: id, style, label: theme.actionLabel || theme.label });
    });
  } else if (phase === 'action' && frame.actorKind === 'enemy' && (frame.intentKind === 'block' || frame.intentKind === 'summon')) {
    const style = pointStyle(sourceId, units);
    if (style) effects.push({ key: `${frame.id}-self-cast`, className: `battle-fx fx-self ${theme.actionClass}`, range: 'self', style, label: frame.intentKind === 'block' ? '护盾' : '召唤' });
  } else if (phase === 'action' && frame.actorKind === 'player') {
    if (frame.targetMode === 'all') {
      const enemySide = validTargets.every(id => indexesForTarget(id, units).side === 'enemy');
      effects.push({ key: `${frame.id}-player-wave`, className: 'battle-fx fx-action fx-group player-cast', range: 'all', label: '出牌', style: `top:${enemySide ? 6 : 60}%;height:32%;` });
    }
    else validTargets.forEach((id, index) => {
      const style = rayStyle(sourceId, id, units);
      if (style) effects.push({ key: `${frame.id}-player-ray-${id}-${index}`, className: 'battle-fx fx-action fx-single player-cast', range: 'single', targetId: id, style, label: '出牌' });
    });
  }
  if (phase === 'impact') {
    validTargets.forEach((id, index) => {
      const feedback = impactForUnit(frame.events, id);
      if (!feedback.lines.length && !frame.intentKind) return;
      const target = indexesForTarget(id, units);
      const style = pointStyle(id, units);
      if (style) effects.push({ key: `${frame.id}-impact-${id}-${index}`, className: `battle-fx fx-impact fx-target ${theme.impactClass}`, range: 'single', targetId: id, targetPercent: slotPercent(target.index, target.count), targetSide: target.side, style, feedback });
    });
    if (frame.intentAll && validTargets.length) effects.unshift({ key: `${frame.id}-impact-wave`, className: `battle-fx fx-impact fx-group-impact ${theme.impactClass}`, range: 'all', label: theme.impactLabel || theme.label });
  }
  return effects;
}

function applyEventsToUnits(baseUnits, events, finalUnits = []) {
  const result = clone(baseUnits || []);
  const byId = new Map(result.map(unit => [unit.id, unit]));
  (events || []).forEach(event => {
    if (!event) return;
    const targetId = event.targetId || (event.kind === 'enemyAction' ? event.actorId : null);
    if (!targetId) return;
    let unit = byId.get(targetId);
    if (!unit) {
      const final = (finalUnits || []).find(item => item.id === targetId);
      if (!final) return;
      unit = clone(final);
      result.push(unit);
      byId.set(unit.id, unit);
    }
    if (typeof event.hpDelta === 'number') unit.hp = Math.max(0, Math.min(unit.maxHp, unit.hp + event.hpDelta));
    if (event.kind === 'stripBlock') unit.block = Math.max(0, unit.block - event.amount);
    if (event.blocked > 0) unit.block = Math.max(0, unit.block - event.blocked);
    if (event.kind === 'block' && event.amount > 0) unit.block += event.amount;
    if (event.kind === 'bossPhase') {
      unit.phase = 2;
      unit.maxHp = event.amount || unit.maxHp;
      unit.hp = unit.maxHp;
      unit.block = 0;
      if (unit.status) Object.keys(unit.status).forEach(key => { unit.status[key] = 0; });
      unit.down = false;
    }
    if (event.kind === 'enemyAction') {
      unit.block = Math.max(0, event.intentKind === 'block' ? event.amount || 0 : event.armor || 0);
    }
    if (event.kind === 'defeat' || event.kind === 'down') { unit.hp = 0; unit.down = event.kind === 'down'; }
    if (event.kind === 'revive') { unit.hp = Math.max(unit.hp, event.hpDelta || event.amount || 0); unit.down = false; }
  });
  return result;
}

function buildFramePresentation(frameIndex, phase, timeline, previous, final) {
  const frames = timeline || [];
  const prefix = frames.slice(0, frameIndex).flatMap(item => item.events || []);
  const active = frames[frameIndex];
  const through = ['impact', 'gap'].includes(phase) && active ? prefix.concat(active.events || []) : prefix;
  return {
    party: applyEventsToUnits(previous && previous.party, through, final && final.party),
    enemies: applyEventsToUnits(previous && previous.enemies, through, final && final.enemies),
    events: active ? active.events || [] : [],
    frame: active || null
  };
}

module.exports = {
  TIMINGS,
  BOSS_THEMES,
  clone,
  themeForUnit,
  intentMeta,
  buildBattleTimeline,
  impactForUnit,
  buildBattleFx,
  buildFramePresentation,
  applyEventsToUnits
};

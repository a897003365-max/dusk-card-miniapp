const art = require('../assets/battle/manifest');

const STATES = ['enter', 'attack', 'guard', 'hurt', 'exit', 'control', 'buff', 'debuff'];
const LABELS = { idle: '', enter: '出场', attack: '施招', guard: '防御', hurt: '受伤', exit: '退场', control: '受制 · 虚弱', buff: '获得增益', debuff: '受到减益' };
const BOSSES = ['paper-lion', 'ink-tide', 'bell-warden'];
const GROUPS = {
  a: ['sheep', 'ramen', 'sunset', 'ticket', 'catcafe', 'moon', 'nav', 'tea'],
  b: ['sushi', 'pear', 'burger', 'badminton', 'bomb', 'orangecat', 'doudou'],
  c: ['hydrangea', 'pearlamp', 'cloudmail', 'firefly', 'soup', 'blanket', 'seedling']
};
function heroGroup(id) { return Object.keys(GROUPS).find(group => GROUPS[group].includes(id)) || ''; }

function restingPose(unit) {
  if (unit.down || unit.hp <= 0 || unit.leaving) return 'exit';
  const status = unit.status || {};
  if (status.weak > 0) return 'control';
  if (status.burn > 0 || status.mark > 0) return 'debuff';
  if (unit.block > 0) return 'guard';
  if (status.counter > 0 || status.echo > 0 || status.retainBlock > 0) return 'buff';
  return 'idle';
}

// 图片只解释已结算的事件与状态，不再计算伤害，也不添加控制规则。
function choosePose(unit, events, beat) {
  if (unit.down || unit.hp <= 0 || unit.leaving) return 'exit';
  const received = events.filter(event => event.targetId === unit.id);
  if (beat === 'enter' || received.some(event => event.kind === 'bossPhase' || event.kind === 'summon')) return 'enter';
  if (beat === 'action') {
    const actions = events.filter(event => event.actorId === unit.id);
    const enemyAction = actions.find(event => event.kind === 'enemyAction');
    if (enemyAction) return enemyAction.intentKind === 'block' ? 'guard' : 'attack';
    if (actions.some(event => event.kind === 'playCard')) {
      if (actions.some(event => ['damage', 'mark', 'weak', 'burn', 'stripBlock'].includes(event.kind) || event.kind === 'echo' && event.hpDelta < 0)) return 'attack';
      if (actions.some(event => ['block', 'counter', 'retainBlock'].includes(event.kind))) return 'guard';
      return 'buff';
    }
    if (received.some(event => event.blocked > 0)) return 'guard';
  }
  if (beat === 'impact') {
    if (received.some(event => event.hpDelta < 0)) return 'hurt';
    if (received.some(event => event.blocked > 0)) return 'guard';
    if (received.some(event => event.kind === 'weak')) return 'control';
    if (received.some(event => event.kind === 'burn' || event.kind === 'mark' || event.kind === 'stripBlock')) return 'debuff';
    if (received.some(event => event.kind === 'block')) return 'guard';
    if (received.some(event => event.hpDelta > 0 || ['counter', 'echo', 'retainBlock', 'energy', 'chargeRelease', 'cleanse', 'intercept'].includes(event.kind))) return 'buff';
  }
  return restingPose(unit);
}

function imageFor(unit, regionId, state) {
  const id = unit.definitionId || unit.id;
  const supported = !!art.heroes[id] || BOSSES.includes(id);
  if (supported && state !== 'idle') {
    const key = unit.definitionId && unit.phase > 1 ? id + '-phase2' : id;
    if (art.heroes[id]) return `/package-actors-${heroGroup(id)}/assets/${id}/${state}.png`;
    return `/package-${regionId}/assets/actions/${key}/${state}.png`;
  }
  return unit.definitionId ? art.enemies[id][unit.phase > 1 ? 'phase2' : 'idle'] : art.heroes[id].idle;
}

function unitArt(unit, regionId, events, beat) {
  const actionState = choosePose(unit, events, beat);
  return { image: imageFor(unit, regionId, actionState), baseImage: imageFor(unit, regionId, 'idle'), actionGroup: heroGroup(unit.id), hasActionArt: !!art.heroes[unit.id] || BOSSES.includes(unit.definitionId), actionState, actionLabel: LABELS[actionState] };
}

module.exports = { STATES, LABELS, BOSSES, GROUPS, heroGroup, choosePose, imageFor, unitArt };

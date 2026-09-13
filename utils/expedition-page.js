const combat = require('./combat');
const { STATUS_GUIDE, getStatusHelp } = require('./status-help');
const art = require('../assets/battle/manifest');
const { unitArt, STATES, LABELS, imageFor, heroGroup } = require('./action-art');
const { CARD_BY_ID, ENEMY_BY_ID, ENVIRONMENTS } = require('./combat-content');
const {
  clone,
  buildBattleTimeline,
  buildBattleFx,
  buildFramePresentation,
  applyEventsToUnits,
  impactForUnit,
  intentMeta,
  themeForUnit
} = require('./battle-feedback');
const statusLabels = { mark: '标', weak: '弱', burn: '灼', counter: '反', echo: '响', retainBlock: '留' };
function audioCall(method, ...args) {
  try { const audio = getApp().audio; if (audio && typeof audio[method] === 'function') audio[method](...args); }
  catch (error) { console.warn(`[audio-${method}]`, error); }
}
function sceneForView(view, fallbackRegion) {
  const run = view && view.run;
  if (!run) return 'town';
  if (run.phase === 'battle' && run.enemies.some(enemy => enemy.rank === 'boss')) return 'boss';
  return run.regionId || fallbackRegion;
}
function playActionAudio(action, result) {
  const events = result.events || [];
  if (action.type === 'playCard' || action.type === 'endTurn') return;
  if (action.type === 'tradeCard' || action.type === 'chooseOpportunity') return audioCall('playEffect', 'shuffle');
  if (action.type === 'chooseCard') return audioCall('playEffect', action.choiceId === 'skip' ? 'select' : 'reward');
  if (action.type === 'upgradeCard') return audioCall('playEffect', 'reward');
  if (action.type === 'chooseRelic') return audioCall('playEffect', 'chest');
  if (action.type === 'rest') return audioCall('playEffect', 'heal');
  if (action.type === 'abandon') return audioCall('playEffect', 'defeat');
  if (action.type === 'chooseNode') {
    const run = result.state.adventure.active;
    if (run && run.phase === 'relicReward') audioCall('playEffect', 'chest');
    else if (run && run.phase === 'battle' && run.enemies.some(enemy => ENEMY_BY_ID[enemy.definitionId] && ENEMY_BY_ID[enemy.definitionId].rank === 'boss')) audioCall('playEffect', 'phase');
    else if (run && run.phase === 'battle') audioCall('playEffect', 'shuffle');
    else if (events.some(event => event.kind === 'shuffle')) audioCall('playEffect', 'shuffle');
    return;
  }
  if (action.type === 'chooseEvent') {
    if (events.some(event => event.kind === 'upgrade')) return audioCall('playEffect', 'reward');
    if (events.some(event => event.kind === 'heal')) return audioCall('playEffect', 'heal');
    if (events.some(event => event.kind === 'reward')) return audioCall('playEffect', 'reward');
  }
}
function statusBadges(unit) {
  return Object.keys(statusLabels).filter(key => unit.status[key] > 0).map(key => ({ key, text: statusLabels[key] + unit.status[key] }));
}
function impactFeedback(events, id) {
  const feedback = impactForUnit(events, id);
  return { ...feedback, impactEntries: feedback.lines };
}
function intentLines(enemy) {
  const meta = intentMeta(enemy);
  const label = enemy.intentShort || enemy.intentText || '';
  const separator = label.indexOf(' · ');
  if (separator < 0) return { ...meta, intentTargetLine: '', intentEffectLine: '', intentNote: label };
  return { ...meta, intentTargetLine: label.slice(0, separator), intentEffectLine: label.slice(separator + 3), intentNote: '' };
}
function actionIntentLines(enemy, action) {
  const meta = intentMeta(enemy, action);
  const amounts = [...new Set((action.intentTargets || []).map(target => target.amount).filter(amount => amount != null))].join('/');
  const targetLine = action.intentKind === 'block' ? '自身' : action.intentKind === 'summon' ? '召唤' : meta.intentTargetLabel;
  let effectLine = action.intentName || '行动';
  if (action.intentKind === 'attack') effectLine = `${amounts || 0}伤害`;
  else if (action.intentKind === 'block') effectLine = `${action.amount || 0}护盾`;
  else if (action.intentKind === 'burn') effectLine = `灼烧${amounts || 0}`;
  else if (action.intentKind === 'weak') effectLine = `虚弱${amounts || 0}回合`;
  else if (action.intentKind === 'summon') effectLine = action.summonName || '召唤';
  return { ...meta, intentTargetLine: targetLine || '', intentEffectLine: effectLine, intentNote: '' };
}

function cardArt(card, regionId) {
  const definition = CARD_BY_ID[card.cardId];
  const effects = card.upgraded ? definition.upgradeEffects : definition.effects;
  const state = effects.some(effect => ['damage', 'mark', 'burn', 'weak', 'stripBlock'].includes(effect.kind)) ? 'attack'
    : effects.some(effect => ['block', 'counter', 'retainBlock'].includes(effect.kind)) ? 'guard' : 'buff';
  const member = { id: card.ownerId };
  const portrait = { id: card.ownerId, actionGroup: heroGroup(card.ownerId), baseImage: art.heroes[card.ownerId].idle, actionState: state, image: imageFor(member, regionId, state) };
  return { ...card, image: portrait.image, portrait };
}
function enemyArt(enemy, events, regionId, beat) {
  const action = events.find(event => event.kind === 'enemyAction' && event.actorId === enemy.id);
  const theme = themeForUnit(enemy);
  const feedback = impactFeedback(beat === 'impact' ? events : [], enemy.id);
  const displayedIntent = action && (beat === 'action' || beat === 'impact') ? actionIntentLines(enemy, action) : intentLines(enemy);
  return { ...enemy,
    ...unitArt(enemy, regionId, events, beat),
    statusBadges: statusBadges(enemy).slice(0, 2),
    exitMotion: !!enemy.leaving && beat === 'impact',
    motion: action && beat === 'action' ? (action.intentKind === 'attack' ? 'enemy-strike' : 'enemy-spell') : '',
    themeId: theme.id, themeLabel: theme.label,
    ...displayedIntent, ...feedback
  };
}

function findActor(id, run, previous) {
  if (!id) return null;
  return [...(run && run.party || []), ...(run && run.enemies || []), ...(previous && previous.party || []), ...(previous && previous.enemies || [])].find(unit => unit && unit.id === id) || null;
}

function receiptParty(party) {
  return (party || []).map(member => ({
    id: member.id,
    name: member.name,
    hp: member.hp,
    maxHp: member.maxHp,
    down: member.hp <= 0 || !!member.down,
    baseImage: member.baseImage || member.image || ''
  }));
}

function currentNodeType(run) {
  const node = run && run.nodes && run.nodes[run.layer];
  return node && node.type || '';
}

// 回执只映射已经提交的战局；普通奖励页与精英奖励页由节点类型区分，避免把宝箱当作战胜精英。
function buildBattleReceipt(view, battleRun, events) {
  if (!view) return null;
  const result = view.result;
  if (result) {
    const party = battleRun ? receiptParty(applyEventsToUnits(battleRun.party, events || []))
      : receiptParty(result.battleSummary && result.battleSummary.party);
    const turn = battleRun && battleRun.turn || result.battleSummary && result.battleSummary.turn || 0;
    const rewardAmount = (events || []).filter(event => event && event.kind === 'reward').reduce((sum, event) => sum + (event.amount || 0), 0);
    return {
      visible: true,
      key: `result:${result.regionId}:${result.win ? 'win' : 'loss'}:${result.nodesCleared}:${result.threads}:${result.tickets}`,
      kind: result.win ? 'final-win' : 'defeat',
      postmark: result.win ? '全程送达' : '旅伴归队',
      title: result.win ? '这封远行已经送达' : '这次先回到灯下',
      reason: result.reason,
      regionName: result.regionName,
      difficultyName: result.difficultyName,
      station: `${result.nodesCleared} / 9 站`,
      turn,
      party,
      threads: result.threads,
      tickets: result.tickets,
      rewardAmount,
      actionLabel: '收好回执',
      final: true
    };
  }
  const run = view.run;
  if (!run || !['cardReward', 'relicReward'].includes(run.phase)) return null;
  const nodeType = currentNodeType(run);
  if (nodeType !== 'battle' && nodeType !== 'elite') return null;
  const rewardAmount = (events || []).filter(event => event && event.kind === 'reward').reduce((sum, event) => sum + (event.amount || 0), 0);
  return {
    visible: true,
    key: `reward:${run.id}:${run.layer}:${nodeType}`,
    kind: nodeType === 'elite' ? 'elite-win' : 'battle-win',
    postmark: nodeType === 'elite' ? '要件收妥' : '本站收妥',
    title: nodeType === 'elite' ? '精英守关已经通过' : '这一站已经通过',
    reason: nodeType === 'elite' ? '旧物战利品已经备好。' : '新招战利品已经备好。',
    regionName: run.regionName,
    difficultyName: run.difficultyName,
    station: `第 ${run.layer + 1} / 9 站`,
    turn: run.turn || 0,
    party: receiptParty(run.party),
    threads: run.threadsEarned,
    tickets: 0,
    rewardAmount,
    actionLabel: '查看战利品',
    final: false
  };
}

function createPage(regionId) {
  return {
    data: { screen: { error: '', regionId, view: null } },
    onLoad() {
      this._selection = { cardUid: '', targetId: '' };
      this._sheet = '';
      this._previewPose = '';
      this._busy = false;
      this._fx = [];
      this._beat = '';
      this._enemyFrame = null;
      this._partyFrame = null;
      this._battleTimeline = [];
      this._frameIndex = -1;
      this._framePhase = '';
      this._timelineToken = 0;
      this._statusId = 'echo';
      this._statusReturnSheet = '';
      this._previousBattle = { party: [], enemies: [] };
      this._previousRun = null;
      this._battleGeometry = null;
      this._pendingReceipt = null;
      this._receiptAcknowledged = '';
      this._receiptSoundPlayed = false;
    },
    onShow() { this.refresh(); },
    onHide() { audioCall('stopEffects'); this.clearMotion(); this.refresh(); },
    onUnload() { audioCall('stopEffects'); this.clearMotion(); },
    clearMotion() {
      clearTimeout(this._motion);
      this._motion = null;
      this._timelineToken += 1;
      this._busy = false;
      this._fx = [];
      this._beat = '';
      this._enemyFrame = null;
      this._partyFrame = null;
      this._battleTimeline = [];
      this._frameIndex = -1;
      this._framePhase = '';
      this._previousRun = null;
      this._battleGeometry = null;
    },
    refresh() {
      const app = getApp();
      if (!app.state) return this.setData({ screen: { error: app.storageError, regionId } });
      const view = combat.getAdventureView(app.state);
      const committedRun = view.run;
      const animating = !!(this._busy && this._battleTimeline.length && this._previousRun);
      const run = animating ? clone(this._previousRun) : committedRun;
      audioCall('setScene', sceneForView({ ...view, run: run || committedRun }, regionId));
      const { windowWidth, windowHeight } = wx.getWindowInfo();
      const frame = this._battleTimeline[this._frameIndex] || null;
      const framePhase = this._framePhase || this._beat;
      const frameEvents = frame ? frame.events : this._fx;
      const finalUnits = committedRun ? { party: committedRun.party, enemies: committedRun.enemies } : { party: [], enemies: [] };
      const presentation = frame ? buildFramePresentation(this._frameIndex, framePhase, this._battleTimeline, this._previousBattle, finalUnits) : null;
      const shownParty = new Map((presentation ? presentation.party : []).map(unit => [unit.id, unit]));
      const shownEnemies = new Map((presentation ? presentation.enemies : []).map(unit => [unit.id, unit]));
      const feedbackUnits = {
        party: [...(this._previousBattle.party || []), ...(finalUnits.party || [])].filter((unit, index, list) => list.findIndex(item => item.id === unit.id) === index),
        enemies: [...(this._previousBattle.enemies || []), ...(finalUnits.enemies || [])].filter((unit, index, list) => list.findIndex(item => item.id === unit.id) === index),
        points: this._battleGeometry ? this._battleGeometry.points : {},
        arena: this._battleGeometry ? this._battleGeometry.arena : null
      };
      const activeTargetIds = frame ? (framePhase === 'action' ? frame.targetIds : frameEvents.map(event => event.targetId).filter(Boolean)) : [];
      let selected = null, preview = null;
      if (run) {
        run.hand = run.hand.map(card => cardArt(card, regionId));
        run.deck = run.deck.map(card => cardArt(card, regionId));
        run.temporaryCards = run.temporaryCards.map(card => cardArt(card, regionId));
        if (run.pendingChoice) run.pendingChoice.options = run.pendingChoice.options.map(card => cardArt(card, regionId));
        run.environmentName = run.environmentId ? ENVIRONMENTS[run.environmentId].name : '';
        run.conditionLabel = [run.environmentName, run.interceptorId ? '护卫' : '', run.pressure ? '压力+' + run.pressure : ''].filter(Boolean).join(' · ') || '战场平静';
        if (['cardReward', 'campUpgrade', 'startingUpgrade'].includes(run.phase)) run.choices = run.choices.map(card => cardArt(card, regionId));
        run.log = run.log.map((event, key) => ({ ...event, key }));
        run.party = run.party.map(member => {
          const shown = shownParty.get(member.id);
          const display = shown ? { ...member, hp: shown.hp, block: shown.block, down: shown.down } : member;
          const impact = impactFeedback(this._beat === 'impact' ? frameEvents : [], member.id);
          return { ...display,
          ...unitArt(display, regionId, frameEvents, this._beat),
          statusBadges: [...(run.interceptorId === member.id ? [{ key: 'intercept', text: '护卫' }] : []), ...statusBadges(display)].slice(0, 2),
          acting: this._beat === 'action' && frame && frame.actorId === member.id,
          activeTarget: activeTargetIds.includes(member.id),
          hitTarget: impact.hit,
          ...impact
        }; });
        run.enemies = run.enemies.map(enemy => {
          const shown = shownEnemies.get(enemy.id);
          const display = shown ? { ...enemy, hp: shown.hp, block: shown.block, phase: shown.phase, maxHp: shown.maxHp } : enemy;
          const decorated = enemyArt(display, frameEvents, regionId, this._beat);
          return { ...decorated, activeTarget: activeTargetIds.includes(enemy.id), hitTarget: decorated.hit };
        });
        if (animating && presentation) {
          const displayedIds = new Set(run.enemies.map(enemy => enemy.id));
          const summoned = presentation.enemies.filter(enemy => !displayedIds.has(enemy.id)).map(enemy => {
            const decorated = enemyArt(enemy, frameEvents, regionId, this._beat);
            return { ...decorated, activeTarget: activeTargetIds.includes(enemy.id), hitTarget: decorated.hit };
          });
          run.enemies = run.enemies.concat(summoned);
        }
        selected = run.hand.find(card => card.uid === this._selection.cardUid) || null;
        if (selected) preview = combat.previewAction(app.state, { type: 'playCard', cardUid: selected.uid, targetId: this._selection.targetId });
      }
      const finalAliveEnemies = committedRun ? committedRun.enemies : [];
      const aliveEnemies = animating
        ? (this._enemyFrame ? (run ? run.enemies.filter(enemy => finalAliveEnemies.some(alive => alive.id === enemy.id)) : []) : (run ? run.enemies : []))
        : (run ? run.enemies : []);
      const departing = (this._enemyFrame || []).filter(enemy => this._fx.some(event => event.kind === 'defeat' && event.targetId === enemy.id) && !finalAliveEnemies.some(alive => alive.id === enemy.id)).map(enemy => {
        const shown = shownEnemies.get(enemy.id);
        const leavingNow = this._beat === 'impact' && frameEvents.some(event => event.kind === 'defeat' && event.targetId === enemy.id);
        const display = { ...enemy, ...(shown || {}), hp: shown ? shown.hp : 0, leaving: leavingNow,
          phase: shown && shown.phase || (this._fx.some(event => event.kind === 'bossPhase' && event.targetId === enemy.id) ? 2 : enemy.phase) };
        return { ...enemyArt(display, frameEvents, regionId, this._beat), hp: display.hp, block: 0, statusBadges: [], leaving: leavingNow,
          activeTarget: activeTargetIds.includes(enemy.id), hitTarget: display.hitTarget };
      });
      // 只保留一次已提交击败事件之前的敌人排位，奖励与真实战斗状态不等待画面。
      const battleEnemies = this._enemyFrame ? this._enemyFrame.map(enemy => aliveEnemies.find(alive => alive.id === enemy.id) || departing.find(gone => gone.id === enemy.id)).filter(Boolean)
        .concat(aliveEnemies.filter(enemy => !this._enemyFrame.some(previous => previous.id === enemy.id))) : aliveEnemies;
      const inspected = run ? (this._sheet === 'ally' ? run.party : run.enemies).find(unit => unit.id === this._inspected) || null : null;
      const inspectedPreview = inspected && this._previewPose ? { ...inspected, image: imageFor(inspected, regionId, this._previewPose), actionState: this._previewPose, actionLabel: LABELS[this._previewPose] } : inspected;
      const partyExit = (animating ? [] : this._partyFrame || []).map(member => ({ ...member, ...unitArt({ ...member, hp: 0, down: true }, regionId, this._fx, this._beat) }));
      const battleFx = frame && run && run.phase === 'battle' ? buildBattleFx(frame, framePhase, feedbackUnits) : [];
      const actionActor = frame && findActor(frame.actorId, run, this._previousBattle);
      const turnAction = frame ? {
        kind: frame.actorKind,
        actor: actionActor ? actionActor.name : frame.actorKind === 'player' ? '旅伴' : '战场',
        skill: frame.actionLabel,
        scope: frame.intentScopeLabel || '',
        theme: frame.theme ? frame.theme.label : '',
        phaseLabel: framePhase === 'gap' ? '间歇' : framePhase === 'impact' ? '命中读数' : frame.timingKind === 'boss' ? '蓄势' : '施招'
      } : null;
      const statusHelp = this._sheet === 'statuses' ? getStatusHelp(this._statusId) : null;
      const statusOwner = statusHelp && statusLabels[this._statusId] && run && ['ally', 'enemy'].includes(this._statusReturnSheet)
        ? (this._statusReturnSheet === 'ally' ? run.party : run.enemies).find(unit => unit.id === this._inspected) : null;
      const receiptCandidate = this._pendingReceipt || buildBattleReceipt(view);
      const receipt = !this._busy && receiptCandidate && receiptCandidate.key !== this._receiptAcknowledged ? receiptCandidate : null;
      this.setData({ screen: { view, run, selected, preview, inspected, inspectedPreview, previewPose: this._previewPose, poseChoices: STATES.map(id => ({ id, label: LABELS[id] })), busy: this._busy, beat: this._beat, partyExit,
        battleEnemies, enemyExit: departing.length > 0 && (!run || run.phase !== 'battle'),
        battleFx, turnAction, receipt, activeFrame: frame ? { id: frame.id, index: frame.index, phase: framePhase, actionMs: frame.actionMs, impactMs: frame.impactMs, gapMs: frame.gapMs, timingKind: frame.timingKind } : null,
        statusHelp, statusRuleNote: statusHelp && statusLabels[this._statusId] ? '同类状态会叠加。战斗结束后旅伴状态清空；Boss 转阶段只清除自身状态。' : '蓄能属于全队；消耗和保留属于卡牌。新一场战斗会重置蓄能、出牌次数与本战暂离区。',
        tacticStatus: !statusHelp || !run ? '' : this._statusId === 'charge' ? `当前能量 ${run.energy}，蓄能 ${run.charge}/${run.maxCharge} 会在下回合变成额外能量。下回合补 ${run.nextEnergyRefill} 能量；现在结束可存 ${run.bankAtEnd} 蓄能。` : this._statusId === 'sequence' ? `本回合已出 ${run.plays} 张牌，下一张是第 ${run.plays + 1} 张` : this._statusId === 'environment' ? (run.environmentId ? `当前${run.environmentName}：双方每段直接伤害 ${ENVIRONMENTS[run.environmentId].damageModifier > 0 ? '+' : ''}${ENVIRONMENTS[run.environmentId].damageModifier}，下一己方回合开始结束。` : '当前没有环境。') : this._statusId === 'intercept' ? (run.interceptorName ? `当前由${run.interceptorName}承担下一次敌方单体主动攻击。` : '当前没有护卫。') : this._statusId === 'pressure' ? `当前久战加伤 +${run.pressure}，已计入敌人意图。` : '',
        statusTabs: statusHelp ? STATUS_GUIDE.map(item => ({ id: item.id, name: item.tab })) : [],
        statusOwner: statusOwner ? { name: statusOwner.name, value: statusOwner.status[this._statusId] || 0 } : null,
        statusReturnLabel: this._statusReturnSheet === 'ally' ? '返回伙伴详情' : this._statusReturnSheet === 'enemy' ? '返回敌人详情' : this._statusReturnSheet === 'card' ? '返回卡牌详情' : '返回旅途记录',
        sheet: this._sheet, targetId: this._selection.targetId, regionId,
        art: art.scenes[regionId] || {}, compact: windowHeight < 620,
        cardWidth: Math.max(48, Math.floor((windowWidth - 56) / 5))
      } });
    },
    perform(action) {
      if (this._busy || this.data.screen.receipt) return;
      try {
        const previousRun = this.data.screen.run ? clone(this.data.screen.run) : null;
        const previousEnemies = previousRun ? clone(previousRun.enemies) : [];
        const previousParty = previousRun ? clone(previousRun.party) : [];
        const result = combat.applyAction(getApp().state, action);
        getApp().commit(result.state);
        const battleAudio = ['playCard', 'endTurn'].includes(action.type) ? { events: result.events || [], outcome: result.state.adventure.active ? null : result.state.adventure.lastResult } : null;
        playActionAudio(action, result);
        this._selection = { cardUid: '', targetId: '' };
        this._sheet = '';
        this._fx = result.events || [];
        this._enemyFrame = this._fx.some(event => event.kind === 'defeat') ? previousEnemies : null;
        this._partyFrame = !result.state.adventure.active && result.state.adventure.lastResult && !result.state.adventure.lastResult.win ? previousParty : null;
        this._busy = ['playCard', 'endTurn'].includes(action.type);
        this._previousBattle = { party: previousParty, enemies: previousEnemies };
        this._previousRun = this._busy && previousRun && previousRun.phase === 'battle' ? previousRun : null;
        this._battleGeometry = null;
        this._battleTimeline = this._busy ? buildBattleTimeline(this._fx, action.type, this._previousBattle) : [];
        const committedView = combat.getAdventureView(result.state);
        this._pendingReceipt = this._busy ? buildBattleReceipt(committedView, previousRun, this._fx) : null;
        if (this._pendingReceipt) this._receiptSoundPlayed = false;
        this._frameIndex = this._battleTimeline.length ? 0 : -1;
        this._framePhase = this._battleTimeline.length ? 'action' : '';
        const entering = action.type === 'chooseNode' && result.state.adventure.active && result.state.adventure.active.phase === 'battle';
        this._beat = entering ? 'enter' : this._busy ? 'action' : this._partyFrame ? 'impact' : '';
        this.refresh();
        clearTimeout(this._motion);
        this._timelineToken += 1;
        const token = this._timelineToken;
        if (this._busy && this._battleTimeline.length) {
          this.prepareBattleGeometry(token, battleAudio);
        } else if (this._busy) {
          this._motion = setTimeout(() => { if (token === this._timelineToken) { this.clearMotion(); this.refresh(); } }, 700);
        } else if (entering || this._fx.length) this._motion = setTimeout(() => { this.clearMotion(); this.refresh(); }, entering ? 600 : 420);
      } catch (error) { this._busy = false; wx.showToast({ title: error.message || '这次行动未能保存', icon: 'none' }); }
    },
    prepareBattleGeometry(token, battleAudio) {
      if (token !== this._timelineToken || !this._busy) return;
      if (!wx.createSelectorQuery || !this._previousRun) return this.runBattleTimeline(token, battleAudio);
      try {
        const query = wx.createSelectorQuery();
        query.select('.battle-stage').boundingClientRect();
        query.selectAll('.enemy-unit .unit-art').boundingClientRect();
        query.selectAll('.ally-unit .unit-art').boundingClientRect();
        query.exec(rows => {
          if (token !== this._timelineToken || !this._busy) return;
          const arena = rows && rows[0];
          const enemies = rows && rows[1] || [];
          const party = rows && rows[2] || [];
          if (!arena || !arena.width || !arena.height) return this.runBattleTimeline(token, battleAudio);
          const points = {};
          const currentEnemies = this.data.screen.battleEnemies || this._previousBattle.enemies || [];
          const currentParty = this.data.screen.run && this.data.screen.run.party || this._previousBattle.party || [];
          enemies.forEach((rect, index) => {
            const unit = currentEnemies[index];
            if (unit && rect && rect.width) points[unit.id] = { x: rect.left - arena.left + rect.width / 2, y: rect.top - arena.top + rect.height / 2, side: 'enemy' };
          });
          party.forEach((rect, index) => {
            const unit = currentParty[index];
            if (unit && rect && rect.width) points[unit.id] = { x: rect.left - arena.left + rect.width / 2, y: rect.top - arena.top + rect.height / 2, side: 'party' };
          });
          this._battleGeometry = { arena: { width: arena.width, height: arena.height }, points };
          this.refresh();
          this.runBattleTimeline(token, battleAudio);
        });
      } catch (error) {
        this._battleGeometry = null;
        this.runBattleTimeline(token, battleAudio);
      }
    },
    runBattleTimeline(token, battleAudio) {
      if (token !== this._timelineToken || !this._busy) return;
      const frame = this._battleTimeline[this._frameIndex];
      if (!frame) return this.finishBattleTimeline(token);
      this._framePhase = 'action';
      this._beat = 'action';
      this.refresh();
      if (frame.actionMs && battleAudio) audioCall('playBattle', frame.events, 'action', null);
      this._motion = setTimeout(() => {
        if (token !== this._timelineToken || !this._busy) return;
        this._framePhase = 'impact';
        this._beat = 'impact';
        this.refresh();
        if (battleAudio) {
          const receiptEvents = this._pendingReceipt ? frame.events.filter(event => !['reward', 'finish'].includes(event.kind)) : frame.events;
          audioCall('playBattle', receiptEvents, 'impact', this._pendingReceipt ? null : this._frameIndex === this._battleTimeline.length - 1 ? battleAudio.outcome : null);
        }
        this._motion = setTimeout(() => {
          if (token !== this._timelineToken || !this._busy) return;
          const advance = () => {
            if (token !== this._timelineToken || !this._busy) return;
            this._frameIndex += 1;
            if (this._frameIndex >= this._battleTimeline.length) return this.finishBattleTimeline(token);
            this.runBattleTimeline(token, battleAudio);
          };
          if (!frame.gapMs) return advance();
          this._framePhase = 'gap';
          this._beat = 'gap';
          this.refresh();
          this._motion = setTimeout(advance, frame.gapMs);
        }, frame.impactMs);
      }, frame.actionMs);
    },
    finishBattleTimeline(token) {
      if (token !== this._timelineToken) return;
      this.clearMotion();
      this.refresh();
      if (this._pendingReceipt && !this._receiptSoundPlayed) {
        this._receiptSoundPlayed = true;
        audioCall('playEffect', this._pendingReceipt.kind === 'defeat' ? 'defeat' : 'victory');
      }
    },
    chooseNode(event) { this.perform({ type: 'chooseNode', nodeId: event.currentTarget.dataset.id }); },
    selectCard(event) { if (this._busy) return; const uid = event.currentTarget.dataset.uid; this._selection = { cardUid: this._selection.cardUid === uid ? '' : uid, targetId: '' }; this.refresh(); },
    selectEnemy(event) {
      if (this._busy) return;
      this._previewPose = '';
      if (this._selection.cardUid) { this._selection.targetId = event.currentTarget.dataset.id; this.refresh(); }
      else { this._inspected = event.currentTarget.dataset.id; this._sheet = 'enemy'; this.refresh(); }
    },
    selectAlly(event) {
      if (this._busy) return;
      this._previewPose = '';
      if (this._selection.cardUid) this._selection.targetId = event.currentTarget.dataset.id;
      else { this._inspected = event.currentTarget.dataset.id; this._sheet = 'ally'; }
      this.refresh();
    },
    clearSelection() { this._selection = { cardUid: '', targetId: '' }; this.refresh(); },
    confirmPlay() { if (this.screenPreviewAllowed()) this.perform({ type: 'playCard', cardUid: this._selection.cardUid, targetId: this._selection.targetId }); },
    screenPreviewAllowed() { return this.data.screen.preview && this.data.screen.preview.allowed; },
    endTurn() { this.perform({ type: 'endTurn' }); },
    tradeSelected() { if (this.data.screen.selected && this.data.screen.selected.canTrade) this.perform({ type: 'tradeCard', cardUid: this.data.screen.selected.uid }); },
    chooseOpportunity(event) { this.perform({ type: 'chooseOpportunity', choiceId: event.currentTarget.dataset.id }); },
    skipOpportunity() { this.perform({ type: 'chooseOpportunity', choiceId: 'skip' }); },
    chooseCard(event) { this.perform({ type: 'chooseCard', choiceId: event.currentTarget.dataset.uid }); },
    skipCard() { this.perform({ type: 'chooseCard', choiceId: 'skip' }); },
    chooseRelic(event) { this.perform({ type: 'chooseRelic', choiceId: event.currentTarget.dataset.id }); },
    chooseEvent(event) { this.perform({ type: 'chooseEvent', choiceId: event.currentTarget.dataset.id }); },
    rest() { this.perform({ type: 'rest' }); },
    showUpgrade() { this.perform({ type: 'chooseUpgrade' }); },
    upgradeCard(event) { this.perform({ type: 'upgradeCard', cardUid: event.currentTarget.dataset.uid }); },
    openDeck() { this._sheet = 'deck'; this.refresh(); },
    openLog() { this._sheet = 'log'; this.refresh(); },
    openTacticGuide() {
      if (this._busy) return;
      const run = this.data.screen.run;
      this._statusReturnSheet = 'log'; this._statusId = run.environmentId ? 'environment' : run.interceptorId ? 'intercept' : run.pressure ? 'pressure' : 'charge'; this._sheet = 'statuses'; this.refresh();
    },
    openStatusGuide() {
      this._statusReturnSheet = ['log', 'ally', 'enemy', 'card'].includes(this._sheet) ? this._sheet : 'log';
      const owner = ['ally', 'enemy'].includes(this._statusReturnSheet) ? this.data.screen.inspected : null;
      const active = owner && STATUS_GUIDE.find(item => owner.status[item.id] > 0);
      const selected = this._statusReturnSheet === 'card' && this.data.screen.selected;
      const card = selected && CARD_BY_ID[selected.cardId];
      const cardStatus = card && (selected.upgraded ? card.upgradeEffects : card.effects).find(effect => STATUS_GUIDE.some(item => item.id === effect.kind));
      this._statusId = active ? active.id : cardStatus ? cardStatus.kind : card && card.exhaust ? 'exhaust' : card && card.retain ? 'retain' : card && card.effects.some(effect => effect.minPlays) ? 'sequence' : 'echo';
      this._sheet = 'statuses'; this.refresh();
    },
    selectStatusGuide(event) {
      const id = event.currentTarget.dataset.id;
      if (this._sheet === 'statuses' && STATUS_GUIDE.some(item => item.id === id)) { this._statusId = id; this.refresh(); }
    },
    backFromStatusGuide() { if (this._sheet === 'statuses') { this._sheet = this._statusReturnSheet || 'log'; this._statusReturnSheet = ''; this.refresh(); } },
    openCard() { if (this._selection.cardUid) { this._sheet = 'card'; this.refresh(); } },
    askAbandon() { this._sheet = 'abandon'; this.refresh(); },
    abandon() { if (this._sheet === 'abandon') this.perform({ type: 'abandon' }); },
    previewPose(event) { const pose = event.currentTarget.dataset.pose; if (STATES.includes(pose) && this.data.screen.inspected && this.data.screen.inspected.hasActionArt) { this._previewPose = pose; this.refresh(); } },
    showCurrentPose() { this._previewPose = ''; this.refresh(); },
    onActionImageError(event) { console.error('action-art-error', event.detail); wx.showToast({ title: '动作图片未能加载', icon: 'none' }); },
    closeSheet() { this._sheet = ''; this._previewPose = ''; this.refresh(); },
    continueReceipt() {
      const receipt = this.data.screen.receipt;
      if (!receipt || this._busy) return;
      if (receipt.final) return this.closeResult();
      this._receiptAcknowledged = receipt.key;
      this._pendingReceipt = null;
      this.refresh();
    },
    goHub() { audioCall('stopEffects'); this.clearMotion(); wx.switchTab({ url: '/pages/adventure/index' }); },
    closeResult() {
      if (this._busy) return;
      const app = getApp();
      try { app.commit({ ...app.state, adventure: { ...app.state.adventure, lastResult: null } }); this.goHub(); }
      catch (error) { wx.showToast({ title: error.message, icon: 'none' }); }
    },
    noop() {}
  };
}
module.exports = { createPage };

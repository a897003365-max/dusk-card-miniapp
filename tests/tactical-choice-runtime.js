// 隔离副本原生验收：自然抽到战术牌后，仅通过可见节点验证观星、环境或护卫。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const combat = require('../utils/combat');
const { createHarness } = require('./helpers/native-adventure');

assert(process.argv.includes('--allow-progress'), '需要明确授权隔离副本实玩');
const modes = ['scout', 'environment', 'intercept'].filter(mode => process.argv.includes(`--${mode}`));
assert.equal(modes.length, 1, '请且仅请选择 --scout、--environment 或 --intercept');
const mode = modes[0];
const project = path.resolve(process.argv[2] || '.');
const out = fs.mkdtempSync(path.join(os.tmpdir(), `dusk-tactical-${mode}-`));
const report = {
  mode, project, out, checks: [], shots: [], actions: [], status: 'running',
  prerequisites: [
    'prepare-acceptance 生成的隔离副本，允许保留历史通关、材料与养成',
    '当前没有未完成远行或进行中的主线来信',
    '从黄昏邮街普通难度正常出发',
    '不注入存档、手牌、牌序、生命、资源或 RNG',
  ],
};
const h = createHarness({ project, report, out });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
console.log(`mode: ${mode}`);
console.log(`prerequisites: ${report.prerequisites.join('；')}`);

async function settle() {
  await h.evaluate(() => new Promise((resolve, reject) => {
    const deadline = Date.now() + 16000;
    function sample() {
      if (!getCurrentPages().slice(-1)[0].data.screen?.busy) return resolve(true);
      if (Date.now() >= deadline) return reject(new Error('战斗表现未在16秒内结束'));
      setTimeout(sample, 100);
    }
    sample();
  }));
}

async function tapAction(action) {
  if (action.type === 'chooseNode') return h.tap(`.route-option[data-id="${action.nodeId}"]`, '.exp-scroll');
  if (action.type === 'endTurn') { await h.tap('.end-turn'); return settle(); }
  if (action.type === 'chooseOpportunity') {
    return action.choiceId === 'skip'
      ? h.tap('.opportunity-skip')
      : h.tap(`.opportunity-take[data-id="${action.choiceId}"]`, '.opportunity-scroll');
  }
  if (action.type === 'upgradeCard') return h.tap(`.upgrade-card[data-uid="${action.cardUid}"]`, '.exp-scroll');
  if (action.type === 'playCard') {
    await h.tap(`.hand-card[data-uid="${action.cardUid}"]`, '.hand-scroll', true);
    if (action.targetId) await h.tap(`${action.targetId.startsWith('enemy-') ? '.enemy-unit' : '.ally-unit'}[data-id="${action.targetId}"]`);
    h.check('当前真实目标预览允许确认', (await h.data('screen.preview')).allowed);
    await h.tap('.confirm-play');
    return settle();
  }
  throw new Error(`未映射原生动作 ${action.type}`);
}

async function applyVisible(action, label) {
  const before = await h.state();
  const expected = combat.applyAction(before, action);
  await tapAction(action);
  const actual = await h.state();
  h.check(`${label}与源引擎结算完全一致`, same(actual, expected.state));
  report.actions.push({ label, action, events: expected.events });
  return actual;
}

async function startBattle(tacticId) {
  const initial = await h.state();
  h.check('实际 KEY 属于指定隔离副本', await h.evaluate(() => getApp().storageKey) === h.marker.storageKey);
  h.check('验收开始时没有未完成远行', !initial.adventure.active);
  h.check('验收前没有进行中的主线来信', !initial.journey);
  await h.call('automation_navigate', ['--action', 'switchTab', '--url', '/pages/adventure/index']);
  await h.tap(`.tactic-tab[data-id="${tacticId}"]`);
  h.check('战术选择仅改变出发界面', await h.data('tacticId') === tacticId && same(initial, await h.state()));
  await h.tap('.start-run');
  const started = await h.state();
  let run = started.adventure.active;
  report.observedStart = { team: started.team, tiers: run.party.map(member => member.tier), regionId: run.regionId, difficulty: run.difficulty, tacticId: run.tacticId };
  h.check('真实出发使用指定战术、当前三位旅伴和12张起手牌', run.tacticId === tacticId && run.deck.length === 12 && run.party.length === 3);
  h.check('真实入口为黄昏邮街普通难度', run.regionId === 'street' && run.difficulty === 0);
  if (run.phase === 'startingUpgrade') {
    const choices = (await h.data('screen.run')).choices;
    h.check('养成资料触发的开局升级提供真实可选牌', choices.length > 0);
    await applyVisible({ type: 'upgradeCard', cardUid: choices[0].uid }, '通过可见节点完成开局升级');
    run = (await h.state()).adventure.active;
  }
  h.check('完成可能存在的开局升级后进入路线图', run.phase === 'map');
  const screen = await h.data('screen.run');
  const action = { type: 'chooseNode', nodeId: screen.nodes[screen.layer].options[0].id };
  const battle = await applyVisible(action, '选择公开的首个普通战斗节点');
  h.check('路线点击后进入真实战斗', battle.adventure.active.phase === 'battle');
  return battle;
}

async function findNaturalCard(cardId, maxEndTurns = 4) {
  for (let ended = 0; ended <= maxEndTurns; ended += 1) {
    const screen = await h.data('screen.run');
    const card = screen.hand.find(item => item.cardId === cardId);
    if (card) {
      report.cardArrival = { cardId, turn: screen.turn, endedTurns: ended };
      return card;
    }
    if (ended === maxEndTurns) break;
    const state = await applyVisible({ type: 'endTurn' }, `自然结束第${screen.turn}回合继续抽牌`);
    assert.equal(state.adventure.active?.phase, 'battle', `${cardId}出现前战斗已经结束`);
  }
  return null;
}

async function inspectCardRule(card, statusId) {
  const before = await h.state();
  await h.tap(`.hand-card[data-uid="${card.uid}"]`, '.hand-scroll', true);
  await h.tap('.card-detail-link');
  await h.tap('.status-help-link', '.dialog-scroll');
  h.check(`卡牌详情直达${statusId}说明`, (await h.data('screen.statusHelp')).id === statusId);
  await h.call('automation_element_action', ['--action', 'scrollTo', '--selector', '.dialog-scroll', '--x', '0', '--y', '99999']);
  const footer = await h.geometry('.status-guide-footer', '.dialog-scroll');
  h.check(`${statusId}说明末尾完整可读`, footer.rect.bottom <= footer.container.bottom + 1);
  await h.shot(`${statusId}-guide`);
  await h.tap('.status-guide-back');
  h.check('说明返回原卡牌详情', await h.data('screen.sheet') === 'card');
  await h.tap('.close');
  h.check('查看说明和滚动没有改变存档或 RNG', same(before, await h.state()));
}

function intentSignature(run) {
  return run.enemies.map(enemy => ({
    id: enemy.id, intentKind: enemy.intentKind, intentAll: enemy.intentAll,
    intentText: enemy.intentText, intentShort: enemy.intentShort, intentTargets: enemy.intentTargets,
  }));
}

async function runScout() {
  await startBattle('reserve');
  const card = await findNaturalCard('wax-spark');
  h.check('最多自然结束4回合后抽到观星牌', !!card);
  await inspectCardRule(card, 'scout');

  const beforePlay = await h.state();
  const energyBefore = beforePlay.adventure.active.energy;
  h.check('0费观星的实际确认预览可用', (await h.data('screen.preview')).allowed);
  await h.tap('.confirm-play');
  await settle();
  const pending = await h.state();
  const pendingScreen = await h.data('screen.run');
  h.check('真实出牌自然产生3张公开观星候选', pending.adventure.active.pendingChoice?.kind === 'scout' && pending.adventure.active.pendingChoice.options.length === 3);
  h.check('观星不扣能量且源牌本战移出循环', pending.adventure.active.energy === energyBefore && pending.adventure.active.removed.includes(card.uid));
  h.check('界面候选顺序与已公开存档一致', same(pendingScreen.pendingChoice.options.map(item => item.choiceId), pending.adventure.active.pendingChoice.options));
  await h.shot('scout-choice');
  await h.call('automation_element_action', ['--action', 'scrollTo', '--selector', '.opportunity-scroll', '--x', '0', '--y', '99999']);
  const last = await h.geometry('.opportunity-take:last-child', '.opportunity-scroll');
  h.check('最后一个观星选择按钮可滚动看到且至少44px', last.rect.height >= 44 && last.rect.bottom <= last.container.bottom + 1);

  const choiceIds = pending.adventure.active.pendingChoice.options.slice();
  await h.tap('.opportunity-later');
  await h.tap('.resume-run');
  h.check('离开再续玩不改变候选、资源、牌区或 RNG', same(pending, await h.state()));
  h.check('续玩后候选顺序仍逐字相同', same(choiceIds, (await h.data('screen.run')).pendingChoice.options.map(item => item.choiceId)));

  const choice = { type: 'chooseOpportunity', choiceId: choiceIds[0] };
  await tapAction(choice);
  const actual = await h.state();
  // 候选已由真实点击公开并完成选择后，才调用源引擎重放，避免测试提前读取未来候选。
  const expectedPending = combat.applyAction(beforePlay, { type: 'playCard', cardUid: card.uid });
  h.check('公开候选后回放源牌结算完全一致', same(expectedPending.state, pending));
  const expectedChoice = combat.applyAction(pending, choice);
  h.check('选择候选与源引擎结算完全一致', same(expectedChoice.state, actual));
  report.actions.push({ label: '选择公开观星候选', action: choice, events: expectedChoice.events });
  const run = actual.adventure.active;
  const remaining = choiceIds.slice(1);
  h.check('选中原牌进入手牌且不复制实例', run.hand.includes(choice.choiceId) && !run.drawPile.includes(choice.choiceId) && !run.discardPile.includes(choice.choiceId));
  h.check('其余候选按展示顺序位于牌堆底', same(run.drawPile.slice(0, remaining.length).reverse(), remaining));
  await h.shot('scout-selected');
}

async function inspectEnvironmentRule() {
  const before = await h.state();
  await h.tap('.tactic-hud');
  h.check('当前场面按钮直达环境说明', (await h.data('screen.statusHelp')).id === 'environment');
  await h.call('automation_element_action', ['--action', 'scrollTo', '--selector', '.dialog-scroll', '--x', '0', '--y', '99999']);
  const footer = await h.geometry('.status-guide-footer', '.dialog-scroll');
  h.check('环境说明末尾完整可读', footer.rect.bottom <= footer.container.bottom + 1);
  await h.shot('environment-guide');
  await h.tap('.status-guide-back');
  await h.tap('.close');
  h.check('查看环境说明没有改变存档或 RNG', same(before, await h.state()));
}

async function runEnvironment() {
  await startBattle('weather');
  const card = await findNaturalCard('folded-corner');
  h.check('最多自然结束4回合后抽到雨幕牌', !!card);
  const before = await h.state();
  const beforeScreen = await h.data('screen.run');
  const expected = combat.applyAction(before, { type: 'playCard', cardUid: card.uid });
  await tapAction({ type: 'playCard', cardUid: card.uid });
  const actual = await h.state();
  const screen = await h.data('screen.run');
  const expectedScreen = combat.getAdventureView(expected.state).run;
  h.check('0费雨幕与源引擎结算完全一致且不扣能量', same(actual, expected.state) && actual.adventure.active.energy === before.adventure.active.energy);
  h.check('真实战场进入雨幕且敌意图和源引擎同步', actual.adventure.active.environmentId === 'rain' && screen.environmentId === 'rain' && same(intentSignature(screen), intentSignature(expectedScreen)));
  const attackBefore = beforeScreen.enemies.find(enemy => enemy.intentKind === 'attack');
  const attackAfter = attackBefore && screen.enemies.find(enemy => enemy.id === attackBefore.id);
  report.environmentIntent = { before: intentSignature(beforeScreen), during: intentSignature(screen), attackModifierObserved: !!attackAfter };
  if (attackAfter) h.check('当前敌方直接攻击预览逐段降低2点', attackAfter.intentTargets.every((target, index) => target.amount === Math.max(0, attackBefore.intentTargets[index].amount - 2)));
  await h.shot('rain-active');
  await inspectEnvironmentRule();

  const ended = await applyVisible({ type: 'endTurn' }, '雨幕中的敌方行动和下回合开始');
  const clearedScreen = await h.data('screen.run');
  h.check('雨幕在下个己方回合开始清空', ended.adventure.active.environmentId === null && clearedScreen.environmentId === null);
  h.check('环境清空后的敌意图仍与源引擎同步', same(intentSignature(clearedScreen), intentSignature(combat.getAdventureView(ended).run)));
  report.environmentIntent.afterClear = intentSignature(clearedScreen);
  await h.shot('rain-cleared');
}

async function runIntercept() {
  await startBattle('relay');
  const card = await findNaturalCard('quick-sketch');
  if (!card) return { skip: '最多自然结束4回合仍未抽到发现牌' };
  const publicRun = await h.data('screen.run');
  const enemy = publicRun.enemies.find(item => item.intentKind === 'attack' && !item.intentAll && item.intentTargets.length === 1);
  if (!enemy) return { skip: '发现牌到手时，当前公开敌意图不是单体攻击' };

  const beforeDiscover = await h.state();
  await tapAction({ type: 'playCard', cardUid: card.uid });
  const pending = await h.state();
  const options = pending.adventure.active.pendingChoice?.options || [];
  if (!options.includes('chance-intercept')) {
    const skip = { type: 'chooseOpportunity', choiceId: 'skip' };
    await tapAction(skip);
    const actual = await h.state();
    const expectedPending = combat.applyAction(beforeDiscover, { type: 'playCard', cardUid: card.uid });
    const expectedSkip = combat.applyAction(pending, skip);
    h.check('自然候选公开后源牌与放弃结算均一致', same(expectedPending.state, pending) && same(expectedSkip.state, actual));
    return { skip: `本次自然发现候选为 ${options.join('、')}，没有护卫机会牌` };
  }

  const choose = { type: 'chooseOpportunity', choiceId: 'chance-intercept' };
  await tapAction(choose);
  const chosen = await h.state();
  const expectedPending = combat.applyAction(beforeDiscover, { type: 'playCard', cardUid: card.uid });
  h.check('公开候选后发现源牌结算完全一致', same(expectedPending.state, pending));
  h.check('自然选择护卫机会牌与源引擎一致', same(combat.applyAction(pending, choose).state, chosen));
  const chosenScreen = await h.data('screen.run');
  const temporary = chosenScreen.hand.find(item => item.cardId === 'chance-intercept');
  const naturalTargetId = enemy.intentTargets[0].id;
  const interceptor = chosenScreen.party.find(member => !member.down && member.id !== naturalTargetId);
  if (!temporary || !interceptor) return { skip: '候选已选择，但当前没有可用于改向的存活队友' };

  const play = { type: 'playCard', cardUid: temporary.uid, targetId: interceptor.id };
  const guarded = await applyVisible(play, '将护卫机会牌打给非原目标队友');
  const guardedScreen = await h.data('screen.run');
  h.check('单体敌意图在界面和源引擎中同步改向', guarded.adventure.active.interceptorId === interceptor.id && same(intentSignature(guardedScreen), intentSignature(combat.getAdventureView(guarded).run)) && guardedScreen.enemies.some(item => item.intentTargets.some(target => target.id === interceptor.id)));
  await h.shot('intercept-active');
  const beforeEnd = await h.state();
  const expectedEnd = combat.applyAction(beforeEnd, { type: 'endTurn' });
  await tapAction({ type: 'endTurn' });
  const ended = await h.state();
  h.check('敌方单体攻击触发一次护卫并与源引擎一致', same(expectedEnd.state, ended) && expectedEnd.events.some(event => event.kind === 'interceptConsume'));
  await h.shot('intercept-consumed');
  return null;
}

(async () => {
  try {
    report.width = await h.evaluate(() => wx.getWindowInfo().windowWidth);
    const outcome = mode === 'scout' ? await runScout() : mode === 'environment' ? await runEnvironment() : await runIntercept();
    report.console = await h.inspectConsole();
    h.check('本次原生验收控制台 error 为空', !report.console);
    if (outcome?.skip) {
      report.status = 'skip';
      report.skipReason = outcome.skip;
      console.log(`skip: ${outcome.skip}`);
    } else report.status = 'pass';
  } catch (error) {
    report.status = 'fail'; report.error = error.stack; process.exitCode = 1; console.error(error.message);
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`${report.status}: ${out}`);
  }
})();

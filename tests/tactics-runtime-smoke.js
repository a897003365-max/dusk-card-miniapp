// 隔离副本实玩：策略只读取公开预览，全部行动由原生节点点击完成。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const combat = require('../utils/combat');
const { CARD_BY_ID } = require('../utils/combat-content');
const { chooseAction } = require('./helpers/adventure-policy');
const { createHarness } = require('./helpers/native-adventure');
const project = path.resolve(process.argv[2] || '.');
assert(process.argv.includes('--allow-progress'), '需要明确授权隔离副本实玩');
const tacticId = process.argv.find(arg => arg.startsWith('--tactic='))?.split('=')[1] || 'relay';
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-tactics-runtime-'));
const report = { out, project, tacticId, checks: [], shots: [], actions: [], receipts: [], status: 'running' };
const h = createHarness({ project, report, out });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function settle() {
  await h.evaluate(() => new Promise((resolve, reject) => {
    const deadline = Date.now() + 16000;
    function check() {
      if (!getCurrentPages().slice(-1)[0].data.screen?.busy) return resolve(true);
      if (Date.now() >= deadline) return reject(new Error('战斗表现未在16秒内结束'));
      setTimeout(check, 100);
    }
    check();
  }));
}
async function perform(action) {
  if (action.type === 'chooseNode') return h.tap(`.route-option[data-id="${action.nodeId}"]`, '.exp-scroll');
  if (action.type === 'playCard') {
    await h.tap(`.hand-card[data-uid="${action.cardUid}"]`, '.hand-scroll', true);
    if (action.targetId) await h.tap(`${action.targetId.startsWith('enemy-') ? '.enemy-unit' : '.ally-unit'}[data-id="${action.targetId}"]`);
    h.check('原生目标预览允许确认', (await h.data('screen.preview')).allowed);
    return h.tap('.confirm-play');
  }
  if (action.type === 'chooseOpportunity') return action.choiceId === 'skip' ? h.tap('.opportunity-skip') : h.tap(`.opportunity-take[data-id="${action.choiceId}"]`, '.opportunity-scroll');
  if (action.type === 'tradeCard') {
    await h.tap(`.hand-card[data-uid="${action.cardUid}"]`, '.hand-scroll', true);
    await h.tap('.card-detail-link'); return h.tap('.trade-selected', '.dialog-scroll');
  }
  if (action.type === 'endTurn') return h.tap('.end-turn');
  if (action.type === 'chooseCard') return action.choiceId === 'skip' ? h.tap('.skip-card', '.exp-scroll') : h.tap(`.take-card[data-uid="${action.choiceId}"]`, '.exp-scroll');
  if (action.type === 'chooseRelic') return h.tap(`.take-relic[data-id="${action.choiceId}"]`, '.exp-scroll');
  if (action.type === 'chooseEvent') return h.tap(`.event-choice[data-id="${action.choiceId}"]`, '.exp-scroll');
  if (action.type === 'rest') return h.tap('.camp-rest', '.exp-scroll');
  if (action.type === 'chooseUpgrade') return h.tap('.camp-upgrade', '.exp-scroll');
  if (action.type === 'upgradeCard') return h.tap(`.upgrade-card[data-uid="${action.cardUid}"]`, '.exp-scroll');
  throw Error(`未映射实际点击 ${action.type}`);
}
async function inspectReceipt(saved) {
  const receipt = await h.data('screen.receipt');
  if (!receipt || !receipt.visible) return;
  report.receipts.push(receipt);
  const name = `receipt-${report.receipts.length}`;
  await h.shot(name);
  const button = receipt.final ? '.finish-run' : '.receipt-continue';
  const g = await h.geometry(button);
  h.check('回执确认按钮完整可见且不小于44px', g.rect && g.rect.height >= 44 && g.rect.bottom <= g.viewport.height + 1);
  //截图与节点读回已跨过演出时长，面板仍需用户确认。
  h.check('回执持续保留且展示期间不重复结算', (await h.data('screen.receipt')).visible === true && same(saved, await h.state()));
  if (!saved.adventure.active) return;
  if (process.argv.includes('--one-battle') && process.argv.includes('--leave-receipt')) return true;
  await h.tap('.receipt-continue');
  h.check('查看战利品只关闭回执、不再次发奖', (await h.data('screen.receipt')).visible !== true && same(saved, await h.state()));
  if (process.argv.includes('--one-battle')) return true;
}
(async () => {
  try {
    h.check('实际KEY属于指定隔离副本', await h.evaluate(() => getApp().storageKey) === h.marker.storageKey);
    let saved = await h.state();
    await h.call('automation_navigate', ['--action', 'switchTab', '--url', '/pages/adventure/index']);
    if (saved.adventure.active) {
      assert(process.argv.includes('--resume'), '已有远行须明确--resume');
      await h.tap('.resume-run');
    } else {
      for (const id of ['classic', 'relay', 'reserve', 'weather', tacticId]) {
        await h.tap(`.tactic-tab[data-id="${id}"]`);
        h.check(`战术${id}只更改待出发方案`, await h.data('tacticId') === id && same(saved, await h.state()));
      }
      await h.shot('tactics-before-start');
      await h.tap('.start-run');
      saved = await h.state();
      h.check('选中打法成为12张固定起手快照', saved.adventure.active.tacticId === tacticId && saved.adventure.active.deck.length === 12);
    }
    const seen = new Set();
    for (let index = 0; index < 240; index++) {
      await settle();
      saved = await h.state();
      const stop = await inspectReceipt(saved);
      const run = saved.adventure.active;
      if (!run || stop) break;
      if (run.pendingChoice && process.argv.includes('--stop-at-choice')) { report.stop = run.pendingChoice.kind; await h.shot('pending-choice'); break; }
      const boss = run.phase === 'battle' && combat.getAdventureView(saved).run.enemies.find(enemy => enemy.rank === 'boss');
      if (run.phase === 'battle' && process.argv.includes('--stop-at-battle')) { report.stop = 'battle'; await h.shot('battle-arrival'); break; }
      if (boss && process.argv.includes('--stop-at-boss')) { report.stop = 'boss'; await h.shot('boss-arrival'); break; }
      const key = `${run.layer}-${run.phase}`;
      if (!seen.has(key)) { seen.add(key); await h.shot(key); console.log(`→ ${key}`); }
      let action = process.argv.includes('--defeat') && run.phase === 'battle' && !run.pendingChoice ? { type: 'endTurn' } : chooseAction(saved);
      const expected = combat.applyAction(saved, action);
      const card = action.type === 'playCard' ? [...run.deck, ...(run.temporaryCards || [])].find(item => item.uid === action.cardUid) : null;
      const definition = card && CARD_BY_ID[card.cardId];
      const viewCard = card && combat.getAdventureView(saved).run.hand.find(item => item.uid === card.uid);
      await perform(action);
      const actual = await h.state();
      h.check('真实点击与共享规则预览及RNG完全一致', same(expected.state, actual));
      report.actions.push({ layer: run.layer, turn: run.turn, action, cardId: card?.cardId, printedCost: definition?.cost, payment: viewCard?.payment, chargeBefore: run.charge, chargeAfter: actual.adventure.active?.charge, events: expected.events });
      if (definition?.tactic) await h.shot(`tactic-${index}-${card.cardId}`);
    }
    report.final = await h.state();
    assert(!report.final.adventure.active || report.stop || process.argv.includes('--one-battle') && report.receipts.length, '实玩达到动作上限但尚未完成指定闭环');
    if (!report.final.adventure.active) h.check(process.argv.includes('--defeat') ? '明确的失败流程正常结算' : '正常实玩完成首领通关', report.final.adventure.lastResult.win === !process.argv.includes('--defeat'));
    report.console = await h.inspectConsole();
    h.check('本次原生运行控制台error为空', !report.console);
    report.status = report.stop ? 'pass-in-progress' : 'pass';
  } catch (error) { report.status = 'fail'; report.error = error.stack; process.exitCode = 1; console.error(error.message); }
  finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(`${report.status}: ${out}`); }
})();

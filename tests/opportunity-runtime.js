// 从正常实玩留下的发现选择继续。所有修改仅通过可见按钮；不注入存档或牌序。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const combat = require('../utils/combat');
const { createHarness } = require('./helpers/native-adventure');
assert(process.argv.includes('--allow-progress'), '需要授权隔离实玩');
const project = path.resolve(process.argv[2] || '.');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-opportunity-native-'));
const report = { project, out, checks: [], shots: [], status: 'running' };
const h = createHarness({ project, out, report });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function settle() {
  await h.evaluate(() => new Promise((resolve, reject) => {
    const deadline = Date.now() + 16000;
    function sample() {
      if (!getCurrentPages().slice(-1)[0].data.screen?.busy) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('表现未按时结束'));
      setTimeout(sample, 100);
    }
    sample();
  }));
}
async function play(card, targetId) {
  await h.tap(`.hand-card[data-uid="${card.uid}"]`, '.hand-scroll', true);
  if (targetId) await h.tap(`.enemy-unit[data-id="${targetId}"]`);
  await h.tap('.confirm-play'); await settle();
}
(async () => {
  try {
    h.check('实际为隔离存档KEY', await h.evaluate(() => getApp().storageKey) === h.marker.storageKey);
    await h.call('automation_navigate', ['--action', 'switchTab', '--url', '/pages/adventure/index']); await h.tap('.resume-run');
    const before = await h.state();
    const pending = before.adventure.active.pendingChoice;
    h.check('真实实玩已产生发现候选', pending?.kind === 'discover');
    h.check('当前自然候选含0费补给牌，符合本用例前置条件', pending.options.includes('chance-charge'));
    await h.shot('choice-top');
    await h.call('automation_element_action', ['--action', 'scrollTo', '--selector', '.opportunity-scroll', '--x', '0', '--y', '99999']);
    const last = await h.geometry('.opportunity-take:last-child', '.opportunity-scroll');
    h.check('最后一个候选可完整滚动且触控高度44px', last.rect.height >= 44 && last.rect.bottom <= last.container.bottom + 1);
    await h.shot('choice-bottom');
    await h.tap('.opportunity-later'); await h.tap('.resume-run');
    h.check('离开再续玩不改变候选、RNG、资源或战斗', same(before, await h.state()));
    await h.tap('.opportunity-take[data-id="chance-charge"]', '.opportunity-scroll');
    let saved = await h.state();
    h.check('选择免费但未自动发动，生成独立临时实例', !saved.adventure.active.pendingChoice && saved.adventure.active.energy === before.adventure.active.energy && saved.adventure.active.charge === before.adventure.active.charge && saved.adventure.active.temporaryCards.length === 1);
    let view = await h.data('screen.run');
    const temporary = view.hand.find(card => card.cardId === 'chance-charge');
    const expectedTemp = combat.applyAction(saved, { type: 'playCard', cardUid: temporary.uid });
    await play(temporary);
    h.check('临时补给实际按共享规则结算一次', same(expectedTemp.state, await h.state()));
    saved = await h.state();
    h.check('0费机会已消耗且不进入抽弃牌循环', saved.adventure.active.removed.includes(temporary.uid) && !saved.adventure.active.drawPile.includes(temporary.uid) && !saved.adventure.active.discardPile.includes(temporary.uid));
    await h.shot('temporary-played');
    const expectedEnd = combat.applyAction(saved, { type: 'endTurn' });
    await h.tap('.end-turn'); await settle(); saved = await h.state();
    h.check('真实跨回合补给与保存状态一致', same(saved, expectedEnd.state));
    h.check('第3回合起基础4能量加蓄能，变成5点超额能量', saved.adventure.active.turn >= 3 && saved.adventure.active.energy === 5 && saved.adventure.active.charge === 0);
    view = await h.data('screen.run');
    const high = view.hand.find(card => card.cost === 4);
    const trading = view.hand.find(card => card.uid !== high?.uid && card.canTrade);
    h.check('真实手牌保留了4费核心并可改签其他牌', !!high && !!trading);
    const expectedTrade = combat.applyAction(saved, { type: 'tradeCard', cardUid: trading.uid });
    await h.tap(`.hand-card[data-uid="${trading.uid}"]`, '.hand-scroll', true); await h.tap('.card-detail-link'); await h.shot('trade-detail');
    await h.tap('.trade-selected', '.dialog-scroll'); saved = await h.state();
    h.check('改签扣1能量，不计连锁，原牌置底', same(saved, expectedTrade.state) && saved.adventure.active.energy === 4 && saved.adventure.active.plays === 0 && saved.adventure.active.drawPile[0] === trading.uid);
    view = await h.data('screen.run');
    const finisher = view.hand.find(card => card.uid === high.uid), targetId = view.enemies[0].id;
    h.check('4费牌使用释放后的超额能量支付，卡面价格仍为4', finisher.cost === 4 && finisher.payment.energy === 4 && finisher.payment.charge === 0 && finisher.playable);
    const expected = combat.applyAction(saved, { type: 'playCard', cardUid: finisher.uid, targetId });
    await h.tap(`.hand-card[data-uid="${finisher.uid}"]`, '.hand-scroll', true); await h.tap(`.enemy-unit[data-id="${targetId}"]`);
    const preview = await h.data('screen.preview');
    h.check('实际确认预览明示4点当前能量支付', preview.allowed && preview.events.some(event => event.kind === 'playCard' && event.payment?.energy === 4 && event.payment?.charge === 0));
    await h.shot('four-cost-payment-preview');
    await h.tap('.confirm-play'); await settle(); saved = await h.state();
    h.check('高费牌实际结算和规则预览完全一致', same(saved, expected.state));
    h.check('胜利清除本战临时牌，保留远行牌组和已入库奖励', saved.adventure.active.phase === 'cardReward' && saved.adventure.active.temporaryCards.length === 0 && saved.adventure.active.deck.length === 12 && saved.adventure.threads === before.adventure.threads + 4);
    await h.shot('economy-battle-receipt');
    report.final = saved; report.console = await h.inspectConsole(); h.check('现场console error为空', !report.console);
    report.status = 'pass';
  } catch (error) { report.status = 'fail'; report.error = error.stack; process.exitCode = 1; console.error(error.message); }
  finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(`${report.status}: ${out}`); }
})();

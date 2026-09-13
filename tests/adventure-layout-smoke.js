// 在已授权隔离副本中检查真实节点；不写 fixture、不调用页面方法代替点击。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHarness } = require('./helpers/native-adventure');
const project = path.resolve(process.argv[2] || '.');
const width = Number(process.argv.find(value => /^--width=/.test(value))?.split('=')[1] || 390);
const region = process.argv.includes('--bridge') ? 'bridge' : process.argv.includes('--market') ? 'market' : 'street';
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-adventure-layout-'));
const report = { project, width, out, checks: [], shots: [], interactions: [], status: 'running' };
const { call, evaluate, state, data, check, shot, geometry, tap, inspectConsole, marker } = createHarness({ project, report, out });

async function inspectScroll(selector, lastSelector, name) {
  await call('automation_element_action', ['--action', 'scrollTo', '--selector', selector, '--x', '0', '--y', '99999']);
  const g = await geometry(lastSelector, selector);
  check(name, g.rect && g.rect.bottom <= g.container.bottom + 2 && g.rect.bottom <= g.viewport.height + 2);
}

(async () => {
  try {
    check('隔离运行存档与副本一致', await evaluate(function () { return getApp().storageKey; }) === marker.storageKey);
    check('实际模拟器宽度正确', await evaluate(function () { return wx.getWindowInfo().windowWidth; }) === width);
    let saved = await state();
    if (process.argv.includes('--train')) {
      assert(process.argv.includes('--allow-progress') && !saved.adventure.active, '培养只允许明确授权且没有在途副本');
      await call('automation_navigate', ['--action', 'switchTab', '--url', '/pages/collection/index']);
      for (const id of saved.team) {
        const before = await state();
        await tap(`.party-member[data-id="${id}"]`);
        await tap('.train-partner', '.detail-scroll');
        const after = await state();
        check(`真实培养 ${id} 只扣本次费用`, after.adventure.levels[id] === before.adventure.levels[id] + 1 && after.adventure.threads === before.adventure.threads - before.adventure.levels[id] * 10);
        await shot(`train-${id}`);
        await inspectScroll('.detail-scroll', '.bond-note', `${id} 详情末尾可完整滚动`);
        await tap('.close');
      }
    }
    await call('automation_navigate', ['--action', 'switchTab', '--url', '/pages/adventure/index']);
    saved = await state();
    if (!saved.adventure.active) {
      assert(process.argv.includes('--allow-progress'), '开始一局需要 --allow-progress');
      await tap(`.region-tab[data-id="${region}"]`);
      await shot('hub');
      await tap('.start-run');
      saved = await state();
    } else await tap('.resume-run');
    if (saved.adventure.active.phase === 'map') {
      assert(process.argv.includes('--allow-progress'), '进入节点需要 --allow-progress');
      await shot('route');
      const run = saved.adventure.active;
      await tap(`.route-option[data-id="${run.nodes[run.layer].options[0].id}"]`, '.exp-scroll');
    }
    saved = await state();
    assert(saved.adventure.active.phase === 'battle', '详情检查从真实战斗开始');
    const before = JSON.stringify(saved);
    await shot('battle');
    const intentLayout = await evaluate(function () {
      return new Promise(resolve => {
        const q = wx.createSelectorQuery();
        q.selectAll('.intent-effect').fields({ rect: true, size: true, computedStyle: ['white-space', 'line-height'] });
        q.selectAll('.intent-note').boundingClientRect();
        q.selectAll('.intent-bubble').boundingClientRect();
        q.select('.battle-stage').boundingClientRect();
        q.exec(rows => resolve({ effects: rows[0], notes: rows[1], bubbles: rows[2], stage: rows[3] }));
      });
    });
    report.intentLayout = intentLayout;
    check('短效果实际单行呈现或使用完整自然换行提示', intentLayout.effects.length
      ? intentLayout.effects.every(row => row['white-space'] === 'nowrap' && row.height <= parseFloat(row['line-height']) + 1)
      : intentLayout.notes.length > 0);
    check('意图气泡没有超出战场裁切边界', intentLayout.bubbles.length > 0 && intentLayout.bubbles.every(row => row.top >= intentLayout.stage.top && row.bottom <= intentLayout.stage.bottom));
    await tap('.deck-link');
    check('完整牌组与存档张数一致', (await data('screen.run.deck')).length === saved.adventure.active.deck.length);
    await inspectScroll('.dialog-scroll', '.deck-item:last-child', '牌组最后一张可完整滚动');
    await shot('deck-bottom');
    await tap('.close');
    await tap(`.ally-unit[data-id="${saved.team[0]}"]`);
    check('伙伴详情包含战斗被动与状态', await data('screen.sheet') === 'ally' && !!(await data('screen.inspected')).passiveDescription);
    await shot('ally-detail');
    await tap('.close');
    const enemy = (await data('screen.run.enemies'))[0];
    await tap(`.enemy-unit[data-id="${enemy.id}"]`);
    check('敌人详情完整显示实际意图', (await data('screen.inspected')).intentText === enemy.intentText);
    await shot('enemy-detail');
    await tap('.close');
    const cards = await data('screen.run.hand');
    check('每张手牌直接显示当前效果摘要', cards.every(item => item.shortDescription));
    const card = cards.find(item => item.playable && item.target === 'enemy') || cards[0];
    await tap(`.hand-card[data-uid="${card.uid}"]`, '.hand-scroll', true);
    await tap('.card-detail-link');
    check('卡牌完整效果可读', await data('screen.sheet') === 'card' && !!(await data('screen.selected')).description);
    await shot('card-detail');
    await tap('.close');
    if (card.target === 'enemy') await tap(`.enemy-unit[data-id="${enemy.id}"]`);
    else if (card.target === 'ally') await tap(`.ally-unit[data-id="${saved.team[0]}"]`);
    const footer = await geometry('.confirm-play');
    check('出牌确认完整可见且至少44px', footer.rect.bottom <= footer.viewport.height + 2 && footer.rect.height >= 43.5 && footer.rect.left >= 0 && footer.rect.right <= footer.viewport.width);
    await shot('target-preview');
    await tap(`.hand-card[data-uid="${card.uid}"]`, '.hand-scroll', true);
    check('再次点同一张牌取消选择', await evaluate(function () { return JSON.stringify(getCurrentPages().slice(-1)[0].data.screen.selected); }) === 'null');
    await tap('.exp-log');
    check('日志正常打开', await data('screen.sheet') === 'log');
    await shot('log');
    await tap('.close');
    check('详情、滚动、目标预览及取消完全不改存档', JSON.stringify(await state()) === before);
    await tap('.hub-back'); await tap('.resume-run');
    check('回城续玩保留全部战斗数据', JSON.stringify(await state()) === before);
    report.console = await inspectConsole();
    check('应用控制台异常为空', !report.console);
    report.status = 'pass';
  } catch (error) { report.status = 'fail'; report.error = error.message; process.exitCode = 1; console.error(error.message); }
  finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(`布局 ${report.status}: ${out}`); }
})();

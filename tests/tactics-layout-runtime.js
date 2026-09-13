// 只读布局和说明验收；不注入存档、不主动出牌，确认最终回执须额外明确参数。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHarness } = require('./helpers/native-adventure');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-tactics-layout-'));
const project = path.resolve(process.argv[2] || '.');
const width = Number(process.argv.find(arg => arg.startsWith('--width='))?.split('=')[1] || 390);
const report = { out, project, width, checks: [], shots: [], status: 'running' };
const h = createHarness({ project, out, report });
(async () => {
  try {
    h.check('目标为独立验收命名空间', await h.evaluate(() => getApp().storageKey) === h.marker.storageKey);
    h.check('原生视口宽度符合验收目标', await h.evaluate(() => wx.getWindowInfo().windowWidth) === width);
    const before = JSON.stringify(await h.state());
    const saved = JSON.parse(before);
    const route = await h.evaluate(() => getCurrentPages().slice(-1)[0].route);
    if (!route.startsWith('package-')) {
      if (saved.adventure.active) {
        await h.call('automation_navigate', ['--action', 'switchTab', '--url', '/pages/adventure/index']);
        await h.tap('.resume-run');
      } else if (saved.adventure.lastResult) {
        await h.call('automation_navigate', ['--action', 'navigateTo', '--url', '/package-' + saved.adventure.lastResult.regionId + '/pages/run/index']);
      }
    }
    const receipt = await h.data('screen.receipt');
    if (receipt.visible) {
      await h.shot('receipt-top');
      const rects = await h.evaluate(() => new Promise(resolve => {
        const q = wx.createSelectorQuery();
        ['.receipt-title', '.receipt-postmark', '.receipt-paper', '.receipt-actions'].forEach(selector => q.select(selector).boundingClientRect());
        q.exec(resolve);
      }));
      report.receiptRects = rects;
      h.check('邮戳与结算标题没有重叠', rects[0].top >= rects[1].bottom - 1);
      await h.call('automation_element_action', ['--action', 'scrollTo', '--selector', '.receipt-scroll', '--x', '0', '--y', '99999']);
      const reward = await h.geometry('.receipt-yield', '.receipt-scroll');
      h.check('回执收获行可完整滚动看到', reward.rect.bottom <= reward.container.bottom + 1);
      const button = await h.geometry(receipt.final ? '.finish-run' : '.receipt-continue');
      h.check('回执确认固定在视口内且至少44px', button.rect.height >= 44 && button.rect.bottom <= button.viewport.height + 1 && button.rect.left >= 0 && button.rect.right <= width);
      await h.shot('receipt-bottom');
    } else {
      const run = await h.data('screen.run');
      h.check('说明检查处于真实战斗', run.phase === 'battle');
      const hud = await h.geometry('.tactic-hud');
      const toolbar = await h.geometry('.battle-toolbar');
      h.check('蓄能按钮完整收在44px工具条内', hud.rect.height >= 44 && hud.rect.height <= 45 && hud.rect.top >= toolbar.rect.top - 1 && hud.rect.bottom <= toolbar.rect.bottom + 1);
      await h.shot('battle-hud');
      if (width === 320) {
        const cards = await h.evaluate(() => new Promise(resolve => {
          const q = wx.createSelectorQuery();
          ['.hand-card', '.card-cost', '.card-role-icon', '.hand-owner'].forEach(selector => q.selectAll(selector).boundingClientRect());
          q.exec(resolve);
        }));
        report.compactCards = cards;
        h.check('小屏费用和伤害摘要分行呈现', cards[1].length > 0 && cards[2].every((rect, index) => rect.top >= cards[1][index].bottom));
        h.check('小屏卡牌持有者未被底边裁切', cards[3].length > 0 && cards[3].every((rect, index) => rect.bottom <= cards[0][index].bottom + 1));
      }
      await h.tap('.tactic-hud');
      h.check('点击HUD直达当前场面或补给规则', ['charge', 'environment', 'intercept', 'pressure'].includes((await h.data('screen.statusHelp')).id));
      for (const id of ['charge', 'environment', 'intercept', 'discover', 'scout', 'trade', 'pressure', 'sequence']) {
        await h.tap(`.status-tab[data-id="${id}"]`, '.status-tab-scroll', true);
        h.check(`${id}详细说明由真实点击切换`, (await h.data('screen.statusHelp')).id === id);
        await h.call('automation_element_action', ['--action', 'scrollTo', '--selector', '.dialog-scroll', '--x', '0', '--y', '99999']);
        const last = await h.geometry('.status-guide-footer', '.dialog-scroll');
        h.check(`${id}末尾说明完整可读`, last.rect.bottom <= last.container.bottom + 1);
        await h.shot(`guide-${id}`);
      }
      await h.tap('.status-guide-back');
      h.check('状态说明返回原生旅途记录', await h.data('screen.sheet') === 'log');
      await h.tap('.close');
      await h.tap('.deck-link');
      await h.call('automation_element_action', ['--action', 'scrollTo', '--selector', '.dialog-scroll', '--x', '0', '--y', '99999']);
      await h.shot('deck-bottom');
      await h.tap('.close');
    }
    h.check('查看说明、滚动与关闭未改变存档或RNG', JSON.stringify(await h.state()) === before);
    report.console = await h.inspectConsole();
    h.check('本次布局现场console error为空', !report.console);
    report.status = 'pass';
  } catch (error) { report.status = 'fail'; report.error = error.stack; process.exitCode = 1; console.error(error.message); }
  finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(`${report.status}: ${out}`); }
})();

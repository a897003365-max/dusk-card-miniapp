const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { createHarness } = require('./helpers/native-adventure');
const { earnPostage } = require('./helpers/earn-postage');
const project = path.resolve(process.argv[2] || '.');
assert(process.argv.includes('--allow-progress'), '五封实玩需要隔离验收授权');
const width = Number(process.argv.find(arg => arg.startsWith('--width='))?.split('=')[1] || 320);
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-five-runtime-'));
const report = { project, width, out, checks: [], shots: [], interactions: [], chapters: [], seen: [], status: 'running' };
const h = createHarness({ project, report, out });
const pageData = async () => JSON.parse(await h.evaluate(function () { return JSON.stringify(getCurrentPages().slice(-1)[0].data); }));

(async () => {
  try {
    h.check('五封测试只使用隔离存档', await h.evaluate(function () { return getApp().storageKey; }) === h.marker.storageKey);
    h.check('实测宽度正确', await h.evaluate(function () { return wx.getWindowInfo().windowWidth; }) === width);
    await h.call('automation_navigate', ['--action', 'switchTab', '--url', '/pages/home/index']);
    assert(!(await pageData()).resultOpen, '先正常结束当前揭晓');
    for (let attempt = 0; (await h.state()).tickets < 5 && attempt < 5; attempt += 1) report.chapters.push(await earnPostage(h));
    const before = await h.state();
    assert(before.tickets >= 5, '真实剧情收益仍不足五票');
    await h.tap('.draw-five');
    const banked = await h.state();
    const batch = await pageData();
    h.check('五封仅扣五票并入库五张', banked.tickets === before.tickets - 5 && banked.drawCount === before.drawCount + 5 && batch.results.length === 5);
    const pairs = await h.evaluate(function () {
      return new Promise(resolve => { const q = wx.createSelectorQuery(); q.selectAll('.result-card').boundingClientRect(); q.selectAll('.sealed-letter').boundingClientRect(); q.exec(resolve); });
    });
    h.check('五个信封均不超出对应卡片宽度', pairs[0].length === 5 && pairs[1].every((r, i) => r.left >= pairs[0][i].left - 1 && r.right <= pairs[0][i].right + 1));
    await h.shot(`${width}-five-sealed`);
    // 直接点第二列，回归此前在此位置发现的溢出。
    await h.tap('.sealed-letter[data-serial="1"]', '.result-scroll');
    const seen = new Set();
    for (let step = 0; step < 5; step += 1) {
      await h.call('automation_element_action', ['--action', 'size', '--selector', '.summon-next', '--wait-for-selector', '.summon-next']);
      const active = (await pageData()).activeReveal;
      h.check('当前揭晓对应原五封且未重复', active && !seen.has(active.serial) && batch.results[active.serial].id === active.id && batch.results[active.serial].tier === active.tier);
      seen.add(active.serial); report.seen.push({ serial: active.serial, tier: active.tier, id: active.id });
      await h.shot(`${width}-five-reveal-${step + 1}`);
      await h.tap('.summon-next');
      h.check('逐封和下一封均不重复扣票或改收藏', JSON.stringify(await h.state()) === JSON.stringify(banked));
    }
    const summary = await pageData();
    h.check('下一封最终返回完整五张汇总', seen.size === 5 && summary.activeReveal === null && summary.revealedCount === 5);
    await h.call('automation_element_action', ['--action', 'scrollTo', '--selector', '.result-scroll', '--x', '0', '--y', '99999']);
    const last = await h.geometry('.result-card:last-child', '.result-scroll');
    h.check('最后一张结果可以完整滚动进入视野', last.rect.top >= last.container.top - 1 && last.rect.bottom <= last.container.bottom + 1);
    await h.shot(`${width}-five-summary-bottom`);
    await h.tap('.close');
    h.check('关闭仍保留全部五封收益', JSON.stringify(await h.state()) === JSON.stringify(banked));
    report.final = { drawCount: banked.drawCount, tickets: banked.tickets };
    report.console = await h.inspectConsole();
    h.check('应用控制台异常为空', !report.console);
    report.status = 'pass';
  } catch (error) { report.status = 'fail'; report.error = error.message; process.exitCode = 1; console.error(error.message); }
  finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(`五封实测 ${report.status}: ${out}`); }
})();

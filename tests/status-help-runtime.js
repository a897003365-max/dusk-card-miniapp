// 仅通过真实按钮读取状态说明，不推进战斗、不写存档。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHarness } = require('./helpers/native-adventure');
const project = path.resolve(process.argv[2] || '.');
const width = Number(process.argv.find(arg => arg.startsWith('--width='))?.slice(8) || 320);
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-status-help-'));
const report = { project, width, out, checks: [], shots: [], entries: [], status: 'running' };
const h = createHarness({ project, report, out });

(async () => {
  try {
    await h.data('error');
    h.check('说明验收使用隔离存档', await h.evaluate(function () { return getApp().storageKey; }) === h.marker.storageKey);
    h.check('实际宽度正确', await h.evaluate(function () { return wx.getWindowInfo().windowWidth; }) === width);
    const before = JSON.stringify(await h.state());
    await h.call('automation_navigate', ['--action', 'switchTab', '--url', '/pages/adventure/index']);
    await h.tap('.resume-run');
    await h.call('automation_element_action', ['--action', 'size', '--selector', '.exp-log', '--wait-for-selector', '.exp-log']);
    await h.tap('.exp-log'); await h.tap('.status-help-link', '.dialog-scroll');
    h.check('记录入口默认展示回响', (await h.data('screen.statusHelp')).id === 'echo');
    for (const id of ['echo', 'mark', 'weak', 'burn', 'counter', 'retainBlock']) {
      await h.tap(`.status-tab[data-id="${id}"]`, '.status-tab-scroll', true);
      const item = await h.data('screen.statusHelp');
      h.check(id + ' 详细规则和例子完整', item.id === id && item.rules.length >= 3 && item.example && item.tip);
      const tabs = await h.geometry('.status-guide-name', '.dialog-scroll');
      h.check(id + ' 切换后正文自动回到规则标题', tabs.rect.top >= tabs.container.top - 2 && tabs.rect.bottom <= tabs.container.bottom + 2);
      if (['echo', 'mark', 'weak'].includes(id)) await h.shot(id + '-top');
      await h.call('automation_element_action', ['--action', 'scrollTo', '--selector', '.dialog-scroll', '--x', '0', '--y', '99999']);
      const last = await h.geometry('.status-guide-footer', '.dialog-scroll');
      h.check(id + ' 最后一段可完整滚动', last.rect.bottom <= last.container.bottom + 2 && last.rect.bottom <= last.viewport.height + 2);
      report.entries.push({ id, item, footer: last.rect });
    }
    await h.shot('guide-bottom');
    await h.tap('.status-guide-back'); h.check('底部按钮返回原记录', await h.data('screen.sheet') === 'log');
    await h.tap('.close');
    const party = await h.data('screen.run.party');
    await h.tap(`.ally-unit[data-id="${party[0].id}"]`);
    await h.tap('.status-help-link', '.dialog-scroll');
    const owner = await h.data('screen.statusOwner');
    h.check('伙伴详情显示对应单位当前状态', owner.name === party[0].name && typeof owner.value === 'number');
    await h.shot('unit-context');
    await h.tap('.status-guide-back'); h.check('返回原伙伴详情', await h.data('screen.sheet') === 'ally');
    await h.tap('.close');
    h.check('说明浏览完全不改战斗、资源和随机进度', JSON.stringify(await h.state()) === before);
    report.console = await h.inspectConsole();
    h.check('原生控制台无 error', !report.console);
    report.status = 'pass';
  } catch (error) { report.status = 'fail'; report.error = error.message; process.exitCode = 1; console.error(error.message); }
  finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(`状态说明 ${report.status}: ${out}`); }
})();

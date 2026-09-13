// 快速操作使用真实CLI点击；不通过setData或业务方法伪造演出阶段。
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { createHarness } = require('./helpers/native-adventure');
const { startWindowRecording } = require('./helpers/record-window');
const project = path.resolve(process.argv[2] || '.');
assert(process.argv.includes('--allow-progress'), '需要授权隔离抽取');
const windowId = Number(process.argv.find(arg => arg.startsWith('--record-window='))?.split('=')[1] || 0);
const selectedMode = process.argv.find(arg => arg.startsWith('--mode='))?.split('=')[1];
const modes = selectedMode ? [selectedMode] : ['skip', 'hide'];
assert(modes.every(mode => ['skip', 'hide'].includes(mode)), '无效快速操作模式');
if (windowId) assert(Number.isInteger(windowId) && windowId > 0, '录像需要真实窗口ID');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-summon-controls-'));
const report = { project, out, checks: [], shots: [], interactions: [], videos: [], recordingRequested: !!windowId, status: 'running' };
const h = createHarness({ project, report, out });
const title = JSON.parse(fs.readFileSync(path.join(project, 'project.config.json'), 'utf8')).projectname;
async function pageData() { return JSON.parse(await h.evaluate(function () { return JSON.stringify(getCurrentPages().slice(-1)[0].data); })); }

(async () => {
  try {
    h.check('快速操作仅作用于隔离存档', await h.evaluate(function () { return getApp().storageKey; }) === h.marker.storageKey);
    await h.call('automation_navigate', ['--action', 'switchTab', '--url', '/pages/home/index']);
    assert((await h.state()).tickets >= modes.length, '需要足够的正常获得邮票');
    assert(!(await pageData()).resultOpen, '请先完成或正常关闭已在查看的抽取');
    for (const mode of modes) {
      const before = await h.state();
      await h.tap('.draw-one');
      const banked = await h.state();
      h.check('快速操作前已正常完成一次抽取', banked.tickets === before.tickets - 1 && banked.drawCount === before.drawCount + 1);
      let recording;
      await h.tap('.sealed-letter[data-serial="0"]', '.result-scroll', false, windowId ? async () => {
        recording = await startWindowRecording({ windowId, title, file: path.join(out, mode + '.mov') });
      } : undefined);
      if (mode === 'skip') {
        // 整个按钮生命周期最短820ms；直接点击已出现的跳过按钮，避免先读节点拖过时机。
        await h.call('automation_element_action', ['--action', 'tap', '--selector', '.summon-skip'], { burst: true });
        const displayed = await h.evaluate(function () {
          return new Promise(resolve => {
            const q = wx.createSelectorQuery();
            q.select('.summon-reveal').fields({ rect: true, computedStyle: ['animation-name', 'opacity', 'transform'] });
            q.exec(rows => resolve({ phase: getCurrentPages().slice(-1)[0].data.revealPhase, hero: rows[0] }));
          });
        }, [], { burst: true });
        h.check('点击跳过立即稳定，不再播放入场动画', displayed.phase === 'settled' && displayed.hero && displayed.hero['animation-name'] === 'none' && displayed.hero.opacity === '1' && displayed.hero.transform === 'none');
        report.skipStyle = displayed;
      } else {
        await h.call('automation_navigate', ['--action', 'switchTab', '--url', '/pages/collection/index'], { burst: true });
        await h.call('automation_navigate', ['--action', 'switchTab', '--url', '/pages/home/index']);
        const after = await pageData();
        h.check('切走再返回保留已揭卡且不重播', after.activeReveal === null && after.revealPhase === 'idle' && after.revealedCount === 1 && after.resultOpen === true);
      }
      if (recording) report.videos.push({ mode, file: recording.file, info: await recording.done });
      h.check('跳过或切后台没有额外结算', JSON.stringify(await h.state()) === JSON.stringify(banked));
      await h.shot(mode + '-after');
      await h.tap(mode === 'skip' ? '.summon-close' : '.close');
      h.check('关闭后全部永久结果保留', JSON.stringify(await h.state()) === JSON.stringify(banked));
    }
    report.console = await h.inspectConsole();
    h.check('应用异常为空', !report.console);
    report.status = 'pass';
  } catch (error) { report.status = 'fail'; report.error = error.message; process.exitCode = 1; console.error(error.message); }
  finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(`快速操作 ${report.status}: ${out}`); }
})();

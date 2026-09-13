// 已打开验收副本内只读解码全部动作 PNG，不注入角色、状态或余额。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHarness } = require('./helpers/native-adventure');
const { STATES, GROUPS, BOSSES } = require('../utils/action-art');
const { ENEMY_BY_ID } = require('../utils/combat-content');
const project = path.resolve(process.argv[2] || '.');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-action-decode-'));
const report = { project, out, checks: [], decoded: [], status: 'running' };
const h = createHarness({ project, out, report });
const sources = Object.entries(GROUPS).flatMap(([group, ids]) => ids.flatMap(id => STATES.map(state => `/package-actors-${group}/assets/${id}/${state}.png`)))
  .concat(BOSSES.flatMap(id => ['', '-phase2'].flatMap(suffix => STATES.map(state => `/package-${ENEMY_BY_ID[id].regionId}/assets/actions/${id + suffix}/${state}.png`))));
(async () => {
  try {
    h.check('运行存档属于隔离副本', await h.evaluate(function () { return getApp().storageKey; }) === h.marker.storageKey);
    const before = JSON.stringify(await h.state());
    for (let i = 0; i < sources.length; i += 32) {
      report.decoded.push(...await h.evaluate(function (batch) {
        return Promise.all(batch.map(src => new Promise(resolve => wx.getImageInfo({ src,
          success: info => resolve({ src, width: info.width, height: info.height }),
          fail: error => resolve({ src, error: error.errMsg }) }))));
      }, [sources.slice(i, i + 32)]));
    }
    h.check('224张动作PNG在模拟器解码成功', report.decoded.length === 224 && report.decoded.every(image => !image.error && image.width > 0 && image.height > 0 && Math.max(image.width, image.height) <= 256));
    h.check('解码不改变存档和随机数进度', JSON.stringify(await h.state()) === before);
    await h.inspectConsole();
    h.check('现场控制台error筛选为空', !report.console);
    report.status = 'pass';
  } catch (error) { report.status = 'fail'; report.error = error.message; process.exitCode = 1; console.error(error.message); }
  finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(`动作解码 ${report.status}: ${out}`); }
})();

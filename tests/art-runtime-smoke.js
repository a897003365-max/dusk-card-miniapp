// 主页面美术只读验收：真实导航/滚动/开关详情，不抽取、不修改玩家存档。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const art = require('../assets/battle/manifest');
const { createHarness } = require('./helpers/native-adventure');
const project = path.resolve(process.argv[2] || '.');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-art-surfaces-'));
const width = Number(process.argv.find(arg => arg.startsWith('--width='))?.split('=')[1] || 390);
const report = { project, width, out, checks: [], shots: [], interactions: [], status: 'running' };
const h = createHarness({ project, out, report });
async function decodeImages(sources) {
  return h.evaluate(function (sources) {
    return Promise.all(sources.map(src => new Promise(resolve => wx.getImageInfo({ src,
      success: info => resolve({ src, width: info.width, height: info.height }),
      fail: error => resolve({ src, error: error.errMsg }) }))));
  }, [sources]);
}
(async () => {
  try {
    h.check('只读美术检查使用隔离存档', await h.evaluate(function () { return getApp().storageKey; }) === h.marker.storageKey);
    h.check('真实设备宽度正确', await h.evaluate(function () { return wx.getWindowInfo().windowWidth; }) === width);
    const before = JSON.stringify(await h.state());
    await h.call('automation_navigate', ['--action', 'switchTab', '--url', '/pages/adventure/index']);
    report.covers = [];
    for (const id of Object.keys(art.scenes)) {
      await h.tap(`.region-tab[data-id="${id}"]`);
      const src = await h.data('selected.image');
      const [info] = await decodeImages([src]);
      h.check(`${id}大厅封面由主包提供且原生解码成功`, src === art.scenes[id].cover && src.startsWith('/assets/scenes/') && info.width === 320 && info.height === 320 && !info.error);
      report.covers.push({ id, ...info });
      await h.shot(`region-${id}-cover`);
    }
    await h.call('automation_navigate', ['--action', 'switchTab', '--url', '/pages/home/index']);
    const showcase = await h.data('showcase');
    h.check('首页三张展示邮卡使用新角色', ['moon', 'orangecat', 'cloudmail'].every(id => showcase[id] === art.heroes[id].idle));
    await h.shot('home-new-art');
    await h.call('automation_navigate', ['--action', 'switchTab', '--url', '/pages/collection/index']);
    const families = await h.data('families');
    h.check('图鉴22位全部使用正式纸灵清单', families.length === 22 && families.every(item => item.image === art.heroes[item.id].idle));
    report.decoded = await decodeImages(families.map(item => item.image));
    h.check('22张角色在原生运行时实际解码成功', report.decoded.every(item => item.width > 0 && item.height > 0 && !item.error));
    await h.shot('collection-top');
    await h.tap('.family-card[data-id="seedling"]');
    h.check('末位伙伴档案真实打开', (await h.data('detail')).id === 'seedling');
    for (const tier of ['R', 'SR', 'SSR', 'UR']) {
      await h.tap(`.variant[data-tier="${tier}"]`, '.detail-scroll');
      h.check(`${tier}信印切换保持同一伙伴身份`, await h.data('previewTier') === tier && await h.data('previewImage') === art.heroes.seedling.idle);
    }
    await h.shot('seedling-archive');
    await h.tap('.close');
    await h.shot('collection-bottom');
    await h.call('automation_navigate', ['--action', 'switchTab', '--url', '/pages/story/index']);
    const chapters = await h.data('chapters');
    h.check('四章导览角色使用新清单', chapters.length === 4 && chapters.every(chapter => chapter.guideImage === art.heroes[chapter.guide].idle));
    await h.shot('story-top');
    await h.call('automation_viewport_action', ['--action', 'pageScrollTo', '--scroll-top', '99999']);
    await h.shot('story-bottom');
    h.check('页面查看与信印切换不修改存档', JSON.stringify(await h.state()) === before);
    const saved = await h.state();
    if (saved.adventure.active) {
      await h.call('automation_navigate', ['--action', 'switchTab', '--url', '/pages/adventure/index']);
      await h.tap('.resume-run');
      h.check('回到在途副本仍保留全部状态', JSON.stringify(await h.state()) === before);
    }
    report.console = await h.inspectConsole();
    h.check('应用与图片加载异常过滤为空', !report.console);
    report.status = 'pass';
  } catch (error) { report.status = 'fail'; report.error = error.message; process.exitCode = 1; console.error(error.message); }
  finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(`美术页面 ${report.status}: ${out}`); }
})();

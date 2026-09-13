// 只从真实已拥有的形态打开玩家可用的重温入口；不注入卡牌、余额或演出状态。
// --observe-motion 额外采样真实CSS运动，可与 --tier/--family/--record-window 组合。
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { createHarness } = require('./helpers/native-adventure');
const { startWindowRecording } = require('./helpers/record-window');
const project = path.resolve(process.argv[2] || '.');
const width = Number(process.argv.find(arg => arg.startsWith('--width='))?.split('=')[1] || 390);
const windowId = Number(process.argv.find(arg => arg.startsWith('--record-window='))?.split('=')[1] || 0);
const selectedTier = process.argv.find(arg => arg.startsWith('--tier='))?.split('=')[1];
const selectedFamily = process.argv.find(arg => arg.startsWith('--family='))?.split('=')[1];
const observeMotion = process.argv.includes('--observe-motion');
const tiers = selectedTier ? [selectedTier] : ['R', 'SR', 'SSR', 'UR'];
assert(tiers.every(tier => ['R', 'SR', 'SSR', 'UR'].includes(tier)), '无效稀有度');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-summon-replay-'));
const report = { project, width, out, selectedFamily, checks: [], shots: [], interactions: [], videos: [], motion: [], motionRequested: observeMotion, recordingRequested: !!windowId, status: 'running' };
const h = createHarness({ project, report, out });
const battleArt = observeMotion ? require(path.join(project, 'assets/battle/manifest')) : null;
const title = JSON.parse(fs.readFileSync(path.join(project, 'project.config.json'), 'utf8')).projectname;
async function pageData() { return JSON.parse(await h.evaluate(function () { return JSON.stringify(getCurrentPages().slice(-1)[0].data); })); }
async function collection() { return h.call('automation_navigate', ['--action', 'switchTab', '--url', '/pages/collection/index']); }

// 一次只读evaluate覆盖真实点击前后，不调用页面方法、不写页面数据或存档。
function startMotionObservation(tier) {
  return h.evaluate(async function (tier) {
    const selectors = ['.summon-reveal', '.summon-character', ...({
      R: ['.summon-particle'], SR: ['.ring-outer', '.ring-inner'], SSR: ['.summon-compass'],
      UR: ['.summon-eclipse', '.orbit-east', '.orbit-west']
    })[tier]];
    const samples = [], counts = {}, end = Date.now() + 6500;
    let settledSamples = 0;
    while (Date.now() < end) {
      const page = getCurrentPages().slice(-1)[0];
      const nodes = await new Promise(resolve => {
        const q = wx.createSelectorQuery();
        selectors.forEach(selector => q.select(selector).fields({ computedStyle: ['animation-name', 'transform', 'opacity'], properties: ['src'] }));
        q.exec(rows => resolve(rows.map((node, index) => ({ selector: selectors[index], exists: !!node, ...(node || {}) }))));
      });
      const data = page ? page.data : {}, active = data.activeReveal;
      const phase = active ? data.revealPhase : page && page.route === 'pages/collection/index' ? 'collection' : '';
      if (phase && (counts[phase] || 0) < (phase === 'collection' ? 1 : 4)) {
        samples.push({ time: Date.now(), route: page ? page.route : '', revealPhase: data.revealPhase || null, replayMode: !!data.replayMode,
          activeReveal: active ? { id: active.id, tier: active.tier, image: active.image } : null, nodes });
        counts[phase] = (counts[phase] || 0) + 1;
      }
      settledSamples = active && data.revealPhase === 'settled' ? settledSamples + 1 : 0;
      if (settledSamples >= 3) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return samples;
  }, [tier], { burst: true }).then(samples => ({ samples }), error => ({ error: error.message }));
}

function checkMotion(tier, id, observed) {
  const expectedImage = battleArt.heroes[id].idle;
  const entry = { tier, id, expectedImage, ...observed, file: path.join(out, `${width}-${tier}-motion.json`) };
  report.motion.push(entry);
  fs.writeFileSync(entry.file, JSON.stringify(entry, null, 2));
  if (observed.error) throw Error(observed.error);
  const samples = observed.samples.filter(sample => sample.activeReveal && sample.activeReveal.id === id && sample.activeReveal.tier === tier);
  entry.phases = [...new Set(samples.map(sample => sample.revealPhase))];
  const expected = [['.summon-reveal', 'companionArrive'], ...({
    R: [['.summon-particle', 'paperGather']],
    SR: [['.ring-outer', 'petalOpen'], ['.ring-inner', 'petalOpen']],
    SSR: [['.summon-compass', 'compassOpen']],
    UR: [['.summon-eclipse', 'eclipseGather'], ['.orbit-east', 'eclipseOrbit'], ['.orbit-west', 'eclipseOrbit']]
  })[tier]];
  entry.animations = expected.map(([selector, animation]) => {
    const nodes = samples.flatMap(sample => sample.nodes.filter(node => node.selector === selector && node['animation-name'] === animation));
    const transforms = [...new Set(nodes.map(node => node.transform).filter(value => value !== undefined && value !== ''))];
    const opacities = [...new Set(nodes.map(node => node.opacity).filter(value => value !== undefined && value !== ''))];
    return { selector, animation, samples: nodes.length, transforms, opacities, moved: transforms.length > 1 || opacities.length > 1 };
  });
  fs.writeFileSync(entry.file, JSON.stringify(entry, null, 2));
  h.check(`${tier} 只读采样在真实重温点击前已开启`, observed.samples.length > 0 && observed.samples[0].route === 'pages/collection/index' && !observed.samples[0].activeReveal);
  h.check(`${tier} 实际经历charge→burst→arrive→settled`, JSON.stringify(entry.phases) === JSON.stringify(['charge', 'burst', 'arrive', 'settled']));
  entry.animations.forEach(animation => h.check(`${tier} ${animation.selector}播放${animation.animation}且实际发生运动`, animation.moved));
  const characters = samples.flatMap(sample => sample.nodes.filter(node => node.selector === '.summon-character' && node.exists));
  h.check(`${tier} 运动中与停留时均使用新纸灵src`, battleArt.heroes[id].source === 'original-paper-courier' && characters.length > 0
    && samples.every(sample => sample.replayMode && sample.activeReveal.image === expectedImage)
    && characters.every(node => typeof node.src === 'string' && node.src.includes(expectedImage))
    && ['arrive', 'settled'].every(phase => samples.some(sample => sample.revealPhase === phase && sample.nodes.some(node => node.selector === '.summon-character' && node.exists))));
}

(async () => {
  try {
    h.check('重温验收使用隔离存档', await h.evaluate(function () { return getApp().storageKey; }) === h.marker.storageKey);
    h.check('模拟器宽度真实匹配', await h.evaluate(function () { return wx.getWindowInfo().windowWidth; }) === width);
    const before = await h.state();
    await collection();
    for (const tier of tiers) {
      const owned = Object.keys(before.collection).filter(id => before.collection[id][tier] > 0);
      assert(owned.length, `${tier} 尚无实际拥有的形态，不能伪造预览`);
      if (selectedFamily) assert(owned.includes(selectedFamily), `${selectedFamily}/${tier} 尚未拥有，不能伪造重温`);
      const id = selectedFamily || (tier === 'R' ? owned.find(key => ['SR', 'SSR', 'UR'].some(t => before.collection[key][t] > 0)) || owned[0] : owned[0]);
      await h.tap(`.family-card[data-id="${id}"]`);
      await h.tap(`.variant[data-tier="${tier}"]`, '.detail-scroll');
      let recording, observing;
      await h.tap('.replay-appearance', '.detail-scroll', false, windowId || observeMotion ? async () => {
        if (observeMotion) await h.waitForCapacity(2);
        if (windowId) recording = await startWindowRecording({ windowId, title, file: path.join(out, `${width}-${tier}-replay.mov`) });
        if (observeMotion) {
          observing = startMotionObservation(tier);
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      } : undefined);
      if (recording) report.videos.push({ tier, file: recording.file, info: await recording.done });
      if (observing) checkMotion(tier, id, await observing);
      await h.call('automation_element_action', ['--action', 'size', '--selector', '.summon-next', '--wait-for-selector', '.summon-next']);
      const data = await pageData();
      h.check(`${tier} 重温的是实际已拥有形态`, data.replayMode && data.activeReveal.id === id && data.activeReveal.tier === tier && data.revealPhase === 'settled');
      const rects = await h.evaluate(function () {
        return new Promise(resolve => { const q = wx.createSelectorQuery(); ['.summon-close', '.summon-next', '.summon-name', '.summon-character'].forEach(s => q.select(s).boundingClientRect()); q.selectViewport().boundingClientRect(); q.exec(resolve); });
      });
      const viewport = rects.pop();
      h.check(`${tier} 名字/角色/操作完整可见`, rects.every(r => r && r.top >= 0 && r.bottom <= viewport.height + 1 && r.left >= 0 && r.right <= viewport.width + 1));
      h.check(`${tier} 两个主要操作至少44px`, rects.slice(0, 2).every(r => r.width >= 44 && r.height >= 44));
      await h.shot(`${width}-${tier}-replay`);
      await h.tap('.summon-next');
      const returned = await pageData();
      h.check(`${tier} 回到原伙伴与原形态`, returned.detail.id === id && returned.previewTier === tier);
      h.check(`${tier} 重温全程不改存档或消耗资源`, JSON.stringify(await h.state()) === JSON.stringify(before));
      await h.tap('.close');
    }
    const unavailableId = Object.keys(before.collection).find(id => before.collection[id].UR === 0);
    await h.tap(`.family-card[data-id="${unavailableId}"]`);
    await h.tap('.variant[data-tier="UR"]', '.detail-scroll');
    const unavailable = await pageData();
    const queried = await h.call('automation_page_action', ['--action', 'querySelectorAll', '--selector', '.replay-appearance']);
    h.check('未拥有形态没有重温入口', unavailable.previewOwned === false && queried.elements.length === 0);
    await h.shot(`${width}-unowned-no-replay`);
    await h.tap('.close');
    h.check('全部查看结束仍保留原存档', JSON.stringify(await h.state()) === JSON.stringify(before));
    report.console = await h.inspectConsole();
    h.check('应用异常为空', !report.console);
    // 开发者工具基础库错误单独留证，不把页面脚本过滤结果称为整个控制台无错误。
    report.sdkConsole = await h.call('get_simulator_console', ['--command', "grep -E 'appServiceSDKScriptError|appid missing'"]);
    report.status = 'pass';
  } catch (error) { report.status = 'fail'; report.error = error.message; process.exitCode = 1; console.error(error.message); }
  finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(`收藏重温 ${report.status}: ${out}`); }
})();

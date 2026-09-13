// 只通过可见按钮控制音频和真实战斗；只读播放器状态，不注入存档或替换 wx API。
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { createHarness } = require('./helpers/native-adventure');
const { chooseAction } = require('./helpers/adventure-policy');
const { MUSIC, EFFECTS } = require('../utils/audio-catalog');
const project = path.resolve(process.argv[2] || '.');
const region = process.argv.find(arg => arg.startsWith('--region='))?.split('=')[1] || '';
const draw = process.argv.includes('--draw');
const keepRun = process.argv.includes('--keep-run');
const controlsObserved = process.argv.includes('--controls-observed');
assert(!region || ['street', 'bridge', 'market'].includes(region));
if (region || draw) assert(process.argv.includes('--allow-progress'), '仅在获准隔离副本实玩');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-audio-native-'));
const report = { project, out, region, checks: [], shots: [], samples: [], status: 'running' };
const h = createHarness({ project, report, out });
const musicButton = '.sound-panel >>> .music-toggle';
const effectsButton = '.sound-panel >>> .effects-toggle';
const snapshot = () => h.evaluate(function () { return getApp().audio.getStatus(); });
async function sample(label) { const value = await snapshot(); report.samples.push({ label, ...value }); return value; }
async function playing(scene) {
  const value = await h.evaluate(async function () {
    const before = getApp().audio.getStatus();
    await new Promise(resolve => setTimeout(resolve, 1600));
    return { before, after: getApp().audio.getStatus() };
  });
  report.samples.push({ label: 'playing-' + scene, ...value });
  h.check(scene + ' 实际触发播放回调且播放时间前进', value.after.scene === scene && value.after.musicPlaying && value.after.musicTime > 0 && value.after.musicTime !== value.before.musicTime);
  h.check(scene + ' 没有播放器错误', !value.after.lastError);
}
async function tab(id) {
  await h.call('automation_navigate', ['--action', 'switchTab', '--url', '/pages/' + id + '/index']);
  await h.call('automation_element_action', ['--action', 'size', '--selector', musicButton, '--wait-for-selector', musicButton]);
  const geometry = await h.evaluate(function () {
    return new Promise(resolve => wx.createSelectorQuery().selectAll('.sound-panel >>> .sound-toggle')
      .fields({ rect: true, size: true }).exec(rows => resolve({ width: wx.getWindowInfo().windowWidth, buttons: rows[0] })));
  });
  report.controls = report.controls || [];
  report.controls.push({ page: id, ...geometry });
  h.check(id + ' 声音按钮至少44px且无横向溢出', geometry.buttons.length === 3 && geometry.buttons.every(button => button.width >= 44 && button.height >= 44 && button.left >= 0 && button.right <= geometry.width));
}
async function toggle(kind, enabled) {
  if ((await snapshot())[kind] !== enabled) await h.tap(kind === 'music' ? musicButton : effectsButton);
  h.check(kind + ' 按钮切换生效', (await snapshot())[kind] === enabled);
}

(async () => {
  try {
    await h.data('error');
    h.check('音频验收使用独立存档', await h.evaluate(function () { return getApp().storageKey; }) === h.marker.storageKey);
    const before = JSON.stringify(await h.state());
    await tab('adventure');
    if (!controlsObserved) { await toggle('music', true); await toggle('effects', true); }
    else h.check('真实界面已开启音乐和音效', (await snapshot()).music && (await snapshot()).effects);
    await playing('town'); await h.shot('town-controls');
    for (const id of ['home', 'collection', 'story']) {
      await tab(id); await playing(id === 'story' ? 'letter' : 'town');
      await h.shot(id + '-controls');
    }
    if (!controlsObserved) {
      await toggle('music', false);
      h.check('关闭音乐停止当前播放', !(await snapshot()).musicPlaying);
      await toggle('effects', false);
      const stored = await h.evaluate(function () { return wx.getStorageSync(getApp().storageKey + '-audio'); });
      h.check('两个开关已单独持久化', stored.music === false && stored.effects === false);
    }
    h.check('页面切换与声音设置不改游戏存档或随机进度', JSON.stringify(await h.state()) === before);
    if (!controlsObserved) { await toggle('music', true); await toggle('effects', true); }
    if (draw) {
      await tab('home'); const start = await sample('before-draw');
      const tickets = (await h.state()).tickets;
      await h.tap('.draw-one');
      const after = await sample('after-draw');
      h.check('一封来信真实结算且播放启封音', (await h.state()).tickets === tickets - 1 && after.effectStarts > start.effectStarts);
      await h.shot('draw-with-sound');
      // 关闭揭晓只保留已结算结果。
      await h.tap('.close');
    }
    if (process.argv.includes('--probe-assets')) {
      if (!controlsObserved) await toggle('music', false);
      // 此段独立检查原生解码，不冒充实际游戏已发生首领战或稀有抽取。
      for (const name of ['street', 'bridge', 'market']) {
        await h.call('automation_navigate', ['--action', 'navigateTo', '--url', '/package-' + name + '/pages/run/index']);
        await h.call('automation_element_action', ['--action', 'size', '--selector', '.expedition', '--wait-for-selector', '.expedition']);
        await tab('home');
      }
      const sources = [...Object.values(MUSIC).map(item => item.src), ...Object.values(EFFECTS)];
      report.assetProbe = await h.evaluate(async function (sources) {
        const results = [];
        for (const src of sources) {
          results.push(await new Promise(resolve => {
            const context = wx.createInnerAudioContext();
            let played = false, settled = false;
            const finish = error => {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              const result = { src, played, duration: context.duration, currentTime: context.currentTime, error };
              context.stop(); context.destroy(); resolve(result);
            };
            const timeout = setTimeout(() => finish('timeout'), 3500);
            context.volume = 0.12; context.src = src;
            context.onPlay(() => { played = true; setTimeout(() => finish(null), 400); });
            context.onEnded(() => finish(null));
            context.onError(error => finish(error.errMsg || String(error)));
            context.play();
          }));
        }
        return results;
      }, [sources]);
      h.check('22个本地音频全部通过原生播放与解码探针', report.assetProbe.length === 22 && report.assetProbe.every(item => item.played && item.duration > 0 && !item.error));
      if (!controlsObserved) await toggle('music', true);
    }
    if (region) {
      await tab('adventure'); let saved = await h.state();
      if (saved.adventure.active) {
        h.check('只续玩本次选择的邮路', saved.adventure.active.regionId === region);
        await h.tap('.resume-run');
      } else {
        await h.tap(`.region-tab[data-id="${region}"]`); await h.tap('.start-run');
      }
      await h.call('automation_element_action', ['--action', 'size', '--selector', '.expedition', '--wait-for-selector', '.expedition']);
      saved = await h.state();
      h.check('通过正常入口创建远行', saved.adventure.active.regionId === region);
      await playing(region);
      if (saved.adventure.active.phase === 'map') {
        const choice = chooseAction(saved);
        assert.equal(choice.type, 'chooseNode');
        await h.tap(`.route-option[data-id="${choice.nodeId}"]`, '.exp-scroll');
      }
      h.check('进入真实战斗', (await h.state()).adventure.active.phase === 'battle');
      await h.tap('.exp-log');
      if (!controlsObserved) { await toggle('effects', false); await toggle('effects', true); }
      await h.shot(region + '-battle-sound-controls'); await h.tap('.close');
      const action = chooseAction(await h.state());
      assert.equal(action.type, 'playCard');
      await h.tap(`.hand-card[data-uid="${action.cardUid}"]`, '.hand-scroll', true);
      if (action.targetId) await h.tap(`${action.targetId.startsWith('enemy-') ? '.enemy-unit' : '.ally-unit'}[data-id="${action.targetId}"]`);
      const beforePlay = await sample('before-card');
      await h.tap('.confirm-play');
      const afterPlay = await sample('after-card');
      h.check('确认出牌后实际播放战斗音效', afterPlay.effectStarts > beforePlay.effectStarts);
      await h.tap('.end-turn'); await sample('after-enemy-turn');
      await h.shot(region + '-after-turn');
      if (!keepRun) {
        await h.tap('.exp-log'); await h.tap('.abandon-from-log', '.dialog-scroll');
        await h.tap('.confirm-abandon');
        const result = await sample('after-abandon');
        h.check('主动结束远行有结束音效且恢复城镇音乐', result.lastEffect === 'defeat' && result.scene === 'town');
        await h.tap('.finish-run');
      }
    }
    const last = await sample('final');
    h.check('整个流程最多三个播放器实例', last.contexts <= 3);
    h.check('没有音频加载或播放错误', !last.lastError);
    report.console = await h.inspectConsole();
    h.check('控制台 error 筛选为空', !report.console);
    report.status = 'pass';
  } catch (error) { report.status = 'fail'; report.error = error.message; process.exitCode = 1; console.error(error.message); }
  finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log('音频原生验收 ' + report.status + ': ' + out); }
})();

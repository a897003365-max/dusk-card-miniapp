// 只使用已有真实解锁的隔离存档；Node 预测仅用于比较，模拟器只通过公开按钮提交。
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHarness } = require('./helpers/native-adventure');
const { applyAction, previewAction } = require('../utils/combat');
const project = path.resolve(process.argv[2] || '.');
assert(process.argv.includes('--allow-progress'), '必须授权隔离副本实玩');
const width = Number(process.argv.find(x => x.startsWith('--width='))?.split('=')[1] || 390);
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-region-actions-'));
const report = { project, out, width, checks: [], shots: [], interactions: [], regions: [], status: 'running' };
const h = createHarness({ project, out, report });

async function observeRetreat() {
  const g = await h.geometry('.confirm-abandon');
  h.check('结束远行确认完整可见且至少44px', g.rect.width >= 44 && g.rect.height >= 44 && g.rect.top >= 0 && g.rect.bottom <= g.viewport.height);
  report.interactions.push({ selector: '.confirm-abandon', rect: g.rect, viewport: g.viewport });
  await h.waitForCapacity(2);
  const observing = h.evaluate(async function () {
    const samples = [], deadline = Date.now() + 8000;
    let started = 0;
    while (Date.now() < deadline && (!started || Date.now() - started < 800)) {
      const screen = getCurrentPages().slice(-1)[0].data.screen;
      if (screen.partyExit.length && !started) started = Date.now();
      if (screen.partyExit.length && samples.length < 6) {
        const nodes = await new Promise(resolve => {
          const q = wx.createSelectorQuery();
          q.selectAll('.party-exit-stage >>> .action-image').fields({ dataset: true, properties: ['src'] });
          q.selectAll('.party-exit-stage .unit-art').fields({ computedStyle: ['animation-name', 'transform', 'opacity'] });
          q.exec(resolve);
        });
        const saved = wx.getStorageSync(getApp().storageKey);
        samples.push({ beat: screen.beat, images: nodes[0], motion: nodes[1], stored: { active: !!saved.adventure.active, threads: saved.adventure.threads, tickets: saved.tickets } });
      }
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    return samples;
  }, [], { burst: true }).then(value => ({ value }), error => ({ error: error.message }));
  await new Promise(resolve => setTimeout(resolve, 250));
  await h.call('automation_element_action', ['--action', 'tap', '--selector', '.confirm-abandon', '--wait-for-selector', '.confirm-abandon'], { burst: true });
  const observed = await observing;
  if (observed.error) throw Error(observed.error);
  return observed.value;
}

(async () => {
  try {
    h.check('运行存档属于隔离副本', await h.evaluate(function () { return getApp().storageKey; }) === h.marker.storageKey);
    h.check('实际模拟器宽度一致', await h.evaluate(function () { return wx.getWindowInfo().windowWidth; }) === width);
    for (const region of (process.argv.includes('--market-only') ? ['market'] : ['bridge', 'market'])) {
      await h.call('automation_navigate', ['--action', 'switchTab', '--url', '/pages/adventure/index']);
      const regions = await h.data('view.regions');
      h.check(`${region}由既有真实进度解锁`, regions.find(x => x.id === region).unlocked);
      const before = await h.state();
      if (before.adventure.active) {
        const run = before.adventure.active;
        assert(process.argv.includes('--resume') && run.regionId === region && run.phase === 'battle' && run.layer === 0 && run.turn === 1 && run.plays === 0, '仅允许接续还未出牌的首场验收，不重放已提交动作');
        await h.tap('.resume-run');
      } else {
        await h.tap(`.region-tab[data-id="${region}"]`);
        await h.tap('.difficulty-tab[data-id="0"]');
        await h.tap('.start-run');
        const run = (await h.state()).adventure.active;
        h.check(`${region}从正常地图开始`, run.regionId === region && run.phase === 'map');
        await h.tap(`.route-option[data-id="${run.nodes[0].options[0].id}"]`, '.exp-scroll');
      }
      await h.call('automation_element_action', ['--action', 'size', '--selector', '.expedition', '--wait-for-selector', '.expedition']);
      h.check(`${region}真实打开对应战斗页面`, await h.evaluate(function () { return getCurrentPages().slice(-1)[0].route; }) === `package-${region}/pages/run/index`);
      await h.shot(`${region}-battle`);
      const party = await h.data('screen.run.party');
      const hand = await h.data('screen.run.hand');
      const images = await h.evaluate(function () { return new Promise(resolve => wx.createSelectorQuery().selectAll('.ally-unit >>> .action-image').fields({ dataset: true, properties: ['src'] }).exec(rows => resolve(rows[0]))); });
      h.check(`${region}三位伙伴实际使用对应动作图片`, images.length === 3 && images.every(image => party.some(unit => unit.id === image.dataset.actor && unit.image === image.src)));
      const saved = await h.state(), targetId = saved.adventure.active.enemies[0].id;
      const card = hand.find(card => {
        if (!card.playable || card.target !== 'enemy') return false;
        const preview = previewAction(saved, { type: 'playCard', cardUid: card.uid, targetId });
        return preview.allowed && preview.events.some(event => event.hpDelta < 0) && !preview.events.some(event => ['reward', 'finish'].includes(event.kind));
      });
      assert(card, '没有可用的非致命攻击牌，不能注入牌或血量');
      const action = { type: 'playCard', cardUid: card.uid, targetId };
      const expected = applyAction(saved, action).state;
      await h.tap(`.hand-card[data-uid="${card.uid}"]`, '.hand-scroll', true);
      await h.tap(`.enemy-unit[data-id="${targetId}"]`);
      h.check(`${region}选牌和目标预览允许操作`, (await h.data('screen.preview')).allowed);
      await h.shot(`${region}-target-preview`);
      await h.tap('.confirm-play');
      assert.deepStrictEqual(await h.state(), expected, '实际出牌必须只提交预测的这一项动作');
      await h.tap('.exp-log');
      await h.tap('.abandon-from-log', '.dialog-scroll');
      h.check(`${region}战斗内公开入口先显示确认`, await h.data('screen.sheet') === 'abandon');
      await h.shot(`${region}-retreat-confirm`);
      const samples = await observeRetreat();
      h.check(`${region}三位伙伴实际显示退场PNG`, samples.some(sample => sample.images.length === 3 && sample.images.every(image => image.dataset.state === 'exit' && image.src.endsWith('/exit.png'))));
      const transforms = samples.flatMap(sample => sample.motion.filter(node => node['animation-name'] === 'actionExit').map(node => node.transform));
      h.check(`${region}退场有连续变换`, new Set(transforms).size > 1);
      h.check(`${region}退场动画期间已完成持久化`, samples.some(sample => !sample.stored.active && sample.stored.threads === before.adventure.threads && sample.stored.tickets === before.tickets));
      const after = await h.state();
      h.check(`${region}主动结束保留永久收获`, !after.adventure.active && after.adventure.lastResult.win === false && after.adventure.threads === before.adventure.threads && after.tickets === before.tickets && JSON.stringify(after.collection) === JSON.stringify(before.collection));
      report.regions.push({ region, images, card: card.name, samples, result: after.adventure.lastResult });
      await h.shot(`${region}-retreat-result`);
      await h.tap('.finish-run');
    }
    await h.inspectConsole();
    h.check('现场error筛选为空', !report.console);
    report.status = 'pass';
  } catch (error) { report.status = 'fail'; report.error = error.message; process.exitCode = 1; console.error(error.message); }
  finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(`地区动作 ${report.status}: ${out}`); }
})();

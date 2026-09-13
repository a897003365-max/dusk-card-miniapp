// 在正常游戏中赚邮票、抽卡和揭晓。禁止注入卡牌/余额、mock RNG或调用页面业务方法。
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { startWindowRecording, RECORDER_PATH } = require('./helpers/record-window');
const { createHarness } = require('./helpers/native-adventure');
const { earnPostage } = require('./helpers/earn-postage');
const project = path.resolve(process.argv[2] || '.');
assert(process.argv.includes('--allow-progress'), '真实抽取仅允许已授权隔离验收');
const width = Number(process.argv.find(arg => arg.startsWith('--width='))?.split('=')[1] || 390);
const allTiers = process.argv.includes('--all-tiers');
const recordWindow = Number(process.argv.find(arg => arg.startsWith('--record-window='))?.split('=')[1] || 0);
if (recordWindow) assert(Number.isInteger(recordWindow) && fs.existsSync(RECORDER_PATH), '需要已编译的单窗口录制器及真实窗口ID');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-summon-runtime-'));
const report = { project, width, out, status: 'running', checks: [], shots: [], interactions: [], frames: [], videos: [], tiers: [], draws: [], chapters: [] };
const h = createHarness({ project, report, out });
const seen = new Set();
const filmed = new Set();
const covered = () => seen.size === 4 && (!recordWindow || filmed.size === 4);
const state = h.state;
async function pageData() { return JSON.parse(await h.evaluate(function () { return JSON.stringify(getCurrentPages().slice(-1)[0].data); })); }
async function tab(name) { return h.call('automation_navigate', ['--action', 'switchTab', '--url', `/pages/${name}/index`]); }
async function waitFor(selector) { return h.call('automation_element_action', ['--action', 'size', '--selector', selector, '--wait-for-selector', selector]); }


async function captureFrames(tier, totalMs) {
  const start = Date.now();
  let index = 0;
  do {
    const file = path.join(out, `${width}-${tier}-frame-${index}.jpg`);
    await h.call('simulator_screenshot', ['--path', file, '--quality', '85'], { burst: true });
    report.frames.push({ tier, index, elapsedSinceTapReturn: Date.now() - start, file });
    index += 1;
  } while (Date.now() - start < totalMs && index < 10);
}

async function inspectHero() {
  await waitFor('.summon-next');
  const data = await pageData();
  const active = data.activeReveal;
  h.check('自动演出最终稳定在settled且当前张只揭一次', data.revealPhase === 'settled' && active.revealed && data.results.filter(card => card.revealed).length === data.revealedCount);
  const nodes = await h.evaluate(function () {
    return new Promise(resolve => {
      const q = wx.createSelectorQuery();
      ['.summon-overlay', '.summon-close', '.summon-next', '.summon-name', '.summon-character'].forEach(selector => q.select(selector).boundingClientRect());
      q.selectAll('.summon-ring').boundingClientRect(); q.selectAll('.summon-orbit').boundingClientRect();
      q.selectViewport().boundingClientRect(); q.exec(resolve);
    });
  });
  const [overlay, close, next, name, character, rings, orbits, viewport] = nodes;
  h.check('角色/名字和操作都完整可见', [close, next, name, character].every(rect => rect && rect.top >= 0 && rect.bottom <= viewport.height + 1 && rect.left >= 0 && rect.right <= viewport.width + 1));
  h.check('关闭固定右侧，主操作满宽且至少44px', close.height >= 44 && close.width === 44 && close.right >= viewport.width - 20 && next.height >= 44 && next.width >= viewport.width - 40);
  h.check('每档具有真实的不同图层结构', rings.length === (active.tier === 'R' ? 0 : 2) && orbits.length === (active.tier === 'UR' ? 2 : 0));
  await h.shot(`${width}-${active.tier}-settled`);
  report.tiers.push({ tier: active.tier, familyId: active.id, name: active.name, profile: active.profile, layout: { overlay, close, next, name, character } });
  seen.add(active.tier);
}

async function earnTicket() { report.chapters.push(await earnPostage(h)); }

(async () => {
  try {
    h.check('真实运行隔离命名空间', await h.evaluate(function () { return getApp().storageKey; }) === h.marker.storageKey);
    h.check('真实模拟器宽度与验收参数一致', await h.evaluate(function () { return wx.getWindowInfo().windowWidth; }) === width);
    await tab('home');
    let data = await pageData();
    if (data.activeReveal) { await inspectHero(); await h.tap('.summon-close'); }
    else if (data.resultOpen) await h.tap('.close');
    const first = await state();
    h.check('验收不从冒险在途状态开始', !first.adventure.active);
    await h.shot(`${width}-home`);
    for (let batch = 0; batch < 45; batch += 1) {
      let before = await state();
      if (allTiers && covered()) break;
      if (before.tickets === 0) { await earnTicket(); before = await state(); }
      const count = before.tickets >= 5 ? 5 : 1;
      await h.tap(count === 5 ? '.draw-five' : '.draw-one');
      const banked = await state();
      data = await pageData();
      h.check('抽取只扣实际票数并一次入库', banked.tickets === before.tickets - count && banked.drawCount === before.drawCount + count && data.results.length === count);
      for (const card of data.results) {
        const copies = data.results.filter(item => item.id === card.id && item.tier === card.tier).length;
        h.check('抽中的每个伙伴已经持久保存', banked.collection[card.id][card.tier] === before.collection[card.id][card.tier] + copies);
      }
      report.draws.push({ count, drawCount: banked.drawCount, cards: data.results.map(card => ({ id: card.id, tier: card.tier })) });
      for (const card of data.results) {
        const newTier = !seen.has(card.tier) || recordWindow && !filmed.has(card.tier);
        let recording;
        await h.tap(`.sealed-letter[data-serial="${card.serial}"]`, '.result-scroll', false,
          newTier && recordWindow ? async () => { recording = await startWindowRecording({ windowId: recordWindow, title: JSON.parse(fs.readFileSync(path.join(project, 'project.config.json'), 'utf8')).projectname, file: path.join(out, `${width}-${card.tier}-native.mov`) }); } : undefined);
        if (newTier) {
          const { getRevealProfile } = require('../utils/summon');
          const p = getRevealProfile(card.tier);
          if (recording) {
            const info = await recording.done;
            report.videos.push({ tier: card.tier, file: recording.file, info }); filmed.add(card.tier);
          } else await captureFrames(card.tier, p.chargeMs + p.burstMs + p.arriveMs);
          await inspectHero();
        } else await waitFor('.summon-next');
        await h.tap('.summon-back');
        h.check('揭晓不改随机数进度/保底/余额/收藏', JSON.stringify(await state()) === JSON.stringify(banked));
      }
      data = await pageData();
      h.check('全部结果可返回汇总且没有重复计数', data.revealedCount === count && data.results.every(card => card.revealed));
      await h.shot(`${width}-batch-${batch}-summary`);
      await h.tap('.close');
      h.check('关闭汇总不重复发奖', JSON.stringify(await state()) === JSON.stringify(banked));
      console.log(`实际已验档位：${[...seen].join('/')}，累计抽取 ${banked.drawCount}`);
      if (!allTiers) break;
    }
    if (allTiers) h.check('四个稀有度均来自实际抽取并原生演出', covered());
    report.console = await h.inspectConsole();
    h.check('应用控制台异常为空', !report.console);
    report.final = { seen: [...seen], drawCount: (await state()).drawCount };
    report.status = 'pass';
  } catch (error) { report.status = 'fail'; report.error = error.message; process.exitCode = 1; console.error(error.message); }
  finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(`抽卡原生 ${report.status}: ${out}`); }
})();

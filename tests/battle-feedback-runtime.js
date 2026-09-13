// 实际点击结束回合并读取原生节点；只在已正常打到 Boss 的隔离副本执行。
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { createHarness } = require('./helpers/native-adventure');
const { startWindowRecording } = require('./helpers/record-window');
const combat = require('../utils/combat');
const { buildBattleTimeline } = require('../utils/battle-feedback');
const project = path.resolve(process.argv[2] || '.');
assert(process.argv.includes('--allow-progress'), '需要隔离实玩授权');
const windowId = Number(process.argv.find(arg => arg.startsWith('--window-id='))?.split('=')[1]);
const title = process.argv.find(arg => arg.startsWith('--window-title='))?.slice('--window-title='.length);
assert(windowId && title, '必须绑定已观察到的开发者工具窗口进行录制');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-boss-feedback-'));
const report = { project, out, checks: [], shots: [], rounds: [], status: 'running' };
const h = createHarness({ project, out, report });

async function watchTurn() {
  return h.evaluate(async function () {
    let busySeen = false;
    const samples = [], counts = {}, lastSample = {}, deadline = Date.now() + 11000;
    while (Date.now() < deadline) {
      const s = getCurrentPages().slice(-1)[0].data.screen;
      if (s.busy) busySeen = true;
      if (busySeen && !s.busy) break;
      if (s.busy && s.activeFrame) {
        const key = s.activeFrame.id + ':' + s.activeFrame.phase;
        const spacing = (s.activeFrame.phase === 'impact' ? s.activeFrame.impactMs : s.activeFrame.actionMs) / 3;
        if ((counts[key] || 0) < 3 && (!lastSample[key] || Date.now() - lastSample[key] >= spacing)) {
          lastSample[key] = Date.now();
          const nodes = await new Promise(resolve => {
            const q = wx.createSelectorQuery();
            q.selectAll('.ally-unit.active-target').fields({ rect: true, size: true, dataset: true });
            q.selectAll('.ally-unit .impact-line').fields({ rect: true, size: true, computedStyle: ['font-size', 'color', 'opacity'] });
            q.selectAll('.battle-fx').fields({ rect: true, size: true, computedStyle: ['opacity', 'transform', 'animation-name'] });
            q.exec(resolve);
          });
          samples.push({ at: Date.now(), frame: s.activeFrame, action: s.turnAction, fx: (s.battleFx || []).map(fx => ({ className: fx.className, range: fx.range, targetId: fx.targetId, style: fx.style })),
            party: (s.run?.party || []).map(unit => ({ id: unit.id, hp: unit.hp, block: unit.block, down: unit.down, actionState: unit.actionState, impactEntries: unit.impactEntries, activeTarget: unit.activeTarget })),
            stored: getApp().state.adventure.active ? { turn: getApp().state.adventure.active.turn, party: getApp().state.adventure.active.party.map(unit => ({ id: unit.id, hp: unit.hp })) } : null,
            nodes });
          counts[key] = (counts[key] || 0) + 1;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 45));
    }
    return { busySeen, samples, idle: !getCurrentPages().slice(-1)[0].data.screen.busy };
  }, [], { burst: true });
}

(async () => {
  try {
    await h.data('error');
    h.check('只操作指定隔离存档', await h.evaluate(function () { return getApp().storageKey; }) === h.marker.storageKey);
    await h.call('automation_navigate', ['--action', 'switchTab', '--url', '/pages/adventure/index']);
    await h.tap('.resume-run');
    await h.call('automation_element_action', ['--action', 'size', '--selector', '.end-turn', '--wait-for-selector', '.end-turn']);
    const initial = await h.state();
    h.check('真实进度已到首领战', initial.adventure.active?.phase === 'battle' && initial.adventure.active.enemies.some(enemy => ['paper-lion', 'ink-tide', 'bell-warden'].includes(enemy.definitionId)));
    report.width = await h.evaluate(function () { return wx.getWindowInfo().windowWidth; });
    const scopes = new Set();
    await h.shot('boss-before');
    for (let index = 0; index < 5 && !(scopes.has('single') && scopes.has('all')); index++) {
      const before = await h.state();
      assert(before.adventure.active, '已结算本局，停止测试');
      const view = await h.data('screen.run');
      const expected = combat.applyAction(before, { type: 'endTurn' });
      const timeline = buildBattleTimeline(expected.events, 'endTurn', { party: view.party, enemies: view.enemies });
      const round = { index, beforeTurn: before.adventure.active.turn, timeline, video: path.join(out, `round-${index}.mov`) };
      const geometry = await h.geometry('.end-turn');
      h.check('结束回合按钮完整可见且至少44px', geometry.rect.width >= 44 && geometry.rect.height >= 44 && geometry.rect.top >= 0 && geometry.rect.bottom <= geometry.viewport.height);
      await h.waitForCapacity(3);
      const recording = await startWindowRecording({ windowId, title, file: round.video, duration: 8 });
      round.recordingStartedAt = Date.now();
      const observing = watchTurn();
      await new Promise(resolve => setTimeout(resolve, 180));
      round.tapAt = Date.now();
      await h.call('automation_element_action', ['--action', 'tap', '--selector', '.end-turn'], { burst: true });
      round.observed = await observing;
      round.recording = await recording.done;
      report.rounds.push(round);
      h.check('每次回合真实状态与规则结算一致', JSON.stringify(await h.state()) === JSON.stringify(expected.state));
      h.check('动作展示有界结束', round.observed.busySeen && round.observed.idle);
      for (const frame of timeline.filter(item => item.actorKind === 'enemy' && item.intentKind === 'attack')) {
        const actionSamples = round.observed.samples.filter(sample => sample.frame.id === frame.id && sample.frame.phase === 'action');
        const impacts = round.observed.samples.filter(sample => sample.frame.id === frame.id && sample.frame.phase === 'impact');
        h.check('敌人独立施招与命中阶段均可观察', actionSamples.length > 0 && impacts.length > 0);
        if (frame.timingKind === 'boss') {
          const gaps = round.observed.samples.filter(sample => sample.frame.id === frame.id && sample.frame.phase === 'gap');
          h.check('Boss蓄势800ms、命中读数1200ms、间歇300ms均真实运行', frame.actionMs === 800 && frame.impactMs === 1200 && frame.gapMs === 300 && gaps.length > 0);
          h.check('Boss命中数字在后半段仍有可见停留', impacts.length >= 2 && impacts.at(-1).at - impacts[0].at >= 600);
        }
        const targets = frame.intentTargetIds.slice().sort();
        h.check('高亮范围与真实行动目标相符', actionSamples.some(sample => JSON.stringify(sample.party.filter(unit => unit.activeTarget).map(unit => unit.id).sort()) === JSON.stringify(targets)));
        h.check('原生特效节点可见', impacts.some(sample => sample.nodes[2].some(node => node.width > 0 && node.height > 0 && Number(node.opacity) > 0)));
        for (const id of targets) {
          const loss = frame.events.filter(event => event.targetId === id && event.hpDelta < 0).reduce((sum, event) => sum - event.hpDelta, 0);
          if (loss) h.check(id + ' 红色掉血数字与真实损失相等', impacts.some(sample => (sample.party.find(unit => unit.id === id)?.impactEntries || []).filter(entry => entry.tone === 'hurt').reduce((sum, entry) => sum + Number(entry.text.replace('−', '')), 0) === loss));
        }
        h.check('原生伤害文字大小清楚', impacts.some(sample => sample.nodes[1].some(node => parseFloat(node['font-size']) >= 18)));
        scopes.add(frame.intentAll ? 'all' : 'single');
      }
      await h.shot('after-round-' + index);
    }
    h.check('实际首领同时覆盖单体与群体攻击', scopes.has('single') && scopes.has('all'));
    report.console = await h.inspectConsole();
    h.check('原生控制台 error 筛选为空', !report.console);
    report.status = 'pass';
  } catch (error) { report.status = 'fail'; report.error = error.message; process.exitCode = 1; console.error(error.message); }
  finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(`Boss反馈 ${report.status}: ${out}`); }
})();

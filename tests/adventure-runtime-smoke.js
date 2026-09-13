// 真实UI驱动，只读策略建议动作，禁止通过setData/引擎调用改写模拟器战斗。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chooseAction } = require('./helpers/adventure-policy');
const { createHarness } = require('./helpers/native-adventure');
const { ENEMY_BY_ID } = require('../utils/combat-content');
const battleArt = require('../assets/battle/manifest');
const { imageFor } = require('../utils/action-art');
const { previewAction } = require('../utils/combat');

const project = path.resolve(process.argv[2] || '.');
const region = process.argv.includes('--bridge') ? 'bridge' : process.argv.includes('--market') ? 'market' : 'street';
const singleBattle = process.argv.includes('--one-battle');
const stopAtBoss = process.argv.includes('--stop-at-boss');
const stopAtPhase2 = process.argv.includes('--stop-at-phase2');
assert(!(singleBattle && process.argv.includes('--defeat')), '首场胜利检查不能与失败检查组合');
assert(!(stopAtBoss && stopAtPhase2), '停在首领战与停在第二阶段不能同时使用');
assert(process.argv.includes('--allow-progress'), '需要明确授权隔离实玩');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-adventure-cli-'));
const report = { project, region, out, scope: stopAtPhase2 ? 'stop-at-phase2' : stopAtBoss ? 'stop-at-boss' : singleBattle ? 'one-battle' : 'full-run', checks: [], interactions: [], shots: [], actions: [], enemyArt: [], motion: [], status: 'running', artStatus: battleArt.style };
const { call, evaluate, state, data, check, shot, geometry, tap, waitForCapacity, inspectConsole, marker } = createHarness({ project, report, out });
async function observeTap(selector, expected, expectedThreads) {
  const actionMs = 220;
  const impactMs = 420;
  const g = await geometry(selector);
  check('动效观察的真实按钮完整可见且至少44px', g.rect.width >= 44 && g.rect.height >= 44 && g.rect.top >= 0 && g.rect.bottom <= g.viewport.height && g.rect.left >= 0 && g.rect.right <= g.viewport.width);
  report.interactions.push({ selector, rect: g.rect, viewport: g.viewport });
  await waitForCapacity(2);
  const observing = evaluate(async function (actionDuration, impactDuration) {
    const samples = [];
    const sampleCounts = {};
    const signatures = {};
    const beatSamples = {};
    let actionSeenAt = 0;
    let storedExit = null;
    let storedExitSampled = false;
    let enemyExitSampled = false;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && (!actionSeenAt || Date.now() - actionSeenAt < actionDuration + impactDuration + 500)) {
      const screen = getCurrentPages().slice(-1)[0].data.screen;
      if (!actionSeenAt && (screen.busy || screen.enemyExit)) actionSeenAt = Date.now();
      if (screen.enemyExit && !storedExit) {
        const saved = wx.getStorageSync(getApp().storageKey);
        storedExit = { threads: saved.adventure.threads, phase: saved.adventure.active ? saved.adventure.active.phase : 'finished' };
      }
      const rawNodes = await new Promise(resolve => {
        const q = wx.createSelectorQuery();
        ['.enemy-motion', '.enemy-hit', '.enemy-leaving'].forEach(selector => q.selectAll(selector).fields({ properties: ['src'], computedStyle: ['animation-name', 'transform', 'opacity'] }));
        q.exec(rows => resolve([].concat.apply([], rows)));
      });
      const beat = screen.beat || '';
      const nodes = rawNodes.filter(node => {
        const animation = node['animation-name'];
        if (!animation || animation === 'none') return false;
        const key = `${beat}:${animation}`;
        const signature = `${key}:${node.transform}:${node.opacity}`;
        if (signatures[signature] || (sampleCounts[key] || 0) >= 4) return false;
        signatures[signature] = true;
        sampleCounts[key] = (sampleCounts[key] || 0) + 1;
        return true;
      });
      const shouldSampleExit = screen.enemyExit && !enemyExitSampled;
      const shouldSampleStored = storedExit && !storedExitSampled;
      if (nodes.length || shouldSampleExit || shouldSampleStored || (beatSamples[beat] || 0) < 4) {
        beatSamples[beat] = (beatSamples[beat] || 0) + 1;
        samples.push({ time: Date.now(), beat, enemyExit: screen.enemyExit, phase: screen.run ? screen.run.phase : 'finished', threads: getApp().state.adventure.threads, storedExit, nodes, rawNodeCount: rawNodes.length, rawAnimationNames: rawNodes.map(node => node['animation-name']) });
        if (shouldSampleExit) enemyExitSampled = true;
        if (shouldSampleStored) storedExitSampled = true;
      }
      await new Promise(resolve => setTimeout(resolve, 35));
    }
    return samples;
  }, [actionMs, impactMs], { burst: true }).then(value => ({ value }), error => ({ error: error.message }));
  await new Promise(resolve => setTimeout(resolve, 250));
  await call('automation_element_action', ['--action', 'tap', '--selector', selector, '--wait-for-selector', selector], { burst: true });
  const observed = await observing;
  if (observed.error) throw Error(observed.error);
  report.motion.push({ expected, expectedThreads, samples: observed.value });
  const transforms = observed.value.flatMap(sample => sample.nodes.filter(node => node['animation-name'] === expected).map(node => node.transform));
  check(`真实节点播放${expected}并发生变换`, new Set(transforms).size > 1 && transforms.some(value => value && value !== 'none'));
  if (expected === 'actionEnter') check('首领转阶段节点使用第二阶段出场PNG', observed.value.some(sample => sample.nodes.some(node => node.src && node.src.includes('-phase2/enter.png'))));
  const exits = observed.value.filter(sample => sample.enemyExit);
  if (exits.length) check('退场尚在播放时结算已真实写入存储', exits.some(sample => sample.storedExit && sample.storedExit.phase !== 'battle' && sample.storedExit.threads === expectedThreads && sample.storedExit.threads === sample.threads));
}
async function doAction(action, watchedMotion, expectedThreads) {
  if (action.type === 'chooseNode') return tap(`.route-option[data-id="${action.nodeId}"]`, '.exp-scroll');
  if (action.type === 'playCard') {
    await tap(`.hand-card[data-uid="${action.cardUid}"]`, '.hand-scroll', true);
    if (action.targetId) await tap(`${action.targetId.startsWith('enemy-') ? '.enemy-unit' : '.ally-unit'}[data-id="${action.targetId}"]`);
    const preview = await data('screen.preview');
    check('实际页面预览允许所选动作', preview.allowed);
    return watchedMotion ? observeTap('.confirm-play', watchedMotion, expectedThreads) : tap('.confirm-play');
  }
  if (action.type === 'chooseOpportunity') return action.choiceId === 'skip' ? tap('.opportunity-skip') : tap(`.opportunity-take[data-id="${action.choiceId}"]`, '.opportunity-scroll');
  if (action.type === 'tradeCard') { await tap(`.hand-card[data-uid="${action.cardUid}"]`, '.hand-scroll', true); await tap('.card-detail-link'); return tap('.trade-selected', '.dialog-scroll'); }
  if (action.type === 'endTurn') return watchedMotion ? observeTap('.end-turn', watchedMotion, expectedThreads) : tap('.end-turn');
  if (action.type === 'chooseCard') return action.choiceId === 'skip' ? tap('.skip-card', '.exp-scroll') : tap(`.take-card[data-uid="${action.choiceId}"]`, '.exp-scroll');
  if (action.type === 'chooseRelic') return tap(`.take-relic[data-id="${action.choiceId}"]`, '.exp-scroll');
  if (action.type === 'chooseEvent') return tap(`.event-choice[data-id="${action.choiceId}"]`, '.exp-scroll');
  if (action.type === 'rest') return tap('.camp-rest', '.exp-scroll');
  if (action.type === 'chooseUpgrade') return tap('.camp-upgrade', '.exp-scroll');
  if (action.type === 'upgradeCard') return tap(`.upgrade-card[data-uid="${action.cardUid}"]`, '.exp-scroll');
  throw new Error(`未映射动作 ${action.type}`);
}

async function runAdventureRuntime() {
  try {
    check('实际运行的是隔离存档命名空间', await evaluate(function () { return getApp().storageKey; }) === marker.storageKey);
    let saved = await state();
    const permanentBefore = { threads: saved.adventure.threads, tickets: saved.tickets, collection: JSON.stringify(saved.collection) };
    check('v2真实新存档完整', saved.version === 2 && saved.adventure && saved.team.length === 3);
    if (saved.adventure.active) {
      assert(process.argv.includes('--resume'), '存在未结束远行，需明确--resume继续');
      await call('automation_navigate', ['--action', 'switchTab', '--url', '/pages/adventure/index']);
      await tap('.resume-run');
    } else {
      await call('automation_navigate', ['--action', 'switchTab', '--url', '/pages/adventure/index']);
      await tap(`.region-tab[data-id="${region}"]`);
      await shot('01-hub');
      await tap('.start-run');
    }
    saved = await state();
    check('真实开始远行并固定三人快照', saved.adventure.active.regionId === region && saved.adventure.active.party.length === 3);
    const seen = new Set();
    const watched = new Set();
    let resumed = false;
    for (let i = 0; i < 260; i++) {
      await evaluate(async function () {
        const deadline = Date.now() + 16000;
        while (getCurrentPages().slice(-1)[0].data.screen.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
        if (getCurrentPages().slice(-1)[0].data.screen.busy) throw Error('战斗演出超时');
      });
      const receipt = await data('screen.receipt');
      if (receipt.visible && !receipt.final) await tap('.receipt-continue');
      saved = await state();
      const run = saved.adventure.active;
      if (!run) break;
      const boss = run.enemies.find(enemy => enemy.hp > 0 && ENEMY_BY_ID[enemy.definitionId].rank === 'boss');
      const stage = boss ? `-boss-${boss.phase}` : '';
      const key = `${run.layer}-${run.phase}${stage}`;
      if (!seen.has(key)) {
        seen.add(key); await shot(`node-${run.layer + 1}-${run.phase}${stage}`);
        if (run.phase === 'battle') {
          const enemies = await data('screen.run.enemies');
          const nodes = await evaluate(function () {
            return new Promise(resolve => wx.createSelectorQuery().selectAll('.battle-stage .enemy-unit .unit-art').fields({ properties: ['src'] }).exec(rows => resolve(rows[0])));
          });
          check('本场实际敌人节点使用对应阶段立绘', enemies.length === nodes.length && enemies.every((enemy, index) => {
            const expected = imageFor(enemy, region, enemy.actionState);
            return enemy.image === expected && nodes[index].src.includes(expected);
          }));
          report.enemyArt.push({ layer: run.layer, bossPhase: boss ? boss.phase : null, enemies: enemies.map(enemy => ({ id: enemy.id, definitionId: enemy.definitionId, phase: enemy.phase, actionState: enemy.actionState, image: enemy.image })), nodes });
        }
        console.log(`→ 第${run.layer + 1}站 ${run.phase}`);
      }
      if (run.phase === 'battle' && boss && (stopAtBoss || stopAtPhase2 && boss.phase > 1)) {
        const stopReason = stopAtPhase2 ? 'boss-phase2' : 'boss-battle';
        check(stopReason === 'boss-phase2' ? '真实进入首领第二阶段后停住' : '真实进入首领战后停住', true);
        report.scope = stopReason;
        report.result = { inProgress: true, stopReason, layer: run.layer, phase: run.phase, bossId: boss.definitionId, bossPhase: boss.phase, turn: run.turn };
        await inspectConsole();
        check('首领停点现场控制台error筛选为空', !report.console);
        report.status = 'pass-in-progress';
        return;
      }
      if (singleBattle && run.phase === 'cardReward' && report.actions.some(item => item.phase === 'battle')) break;
      if (!resumed && run.phase === 'battle' && run.turn >= 2) {
        const before = JSON.stringify(run);
        await tap('.hub-back'); await tap('.resume-run');
        check('返回邮局再继续不重抽手牌、不重置生命或RNG', JSON.stringify((await state()).adventure.active) === before);
        resumed = true;
      }
      const action = run.phase === 'battle' && !run.pendingChoice && process.argv.includes('--defeat') ? { type: 'endTurn' }
        : run.phase === 'camp' && process.argv.includes('--camp-upgrade') ? { type: 'chooseUpgrade' } : chooseAction(saved);
      const events = run.phase === 'battle' ? previewAction(saved, action).events : [];
      const enemyIds = new Set(run.enemies.map(enemy => enemy.id));
      const animations = events.some(event => event.kind === 'bossPhase') ? ['actionEnter']
        : events.some(event => event.kind === 'defeat' && enemyIds.has(event.targetId)) ? ['enemyFold']
        : events.some(event => event.kind === 'enemyAction') ? events.filter(event => event.kind === 'enemyAction').map(event => event.intentKind === 'attack' ? 'enemyStrike' : 'enemySpell')
        : events.some(event => event.hpDelta < 0 && enemyIds.has(event.targetId)) ? ['enemyHit'] : [];
      const watchedMotion = animations.find(name => !watched.has(name));
      const expectedThreads = saved.adventure.threads + events.filter(event => event.kind === 'reward').reduce((sum, event) => sum + event.amount, 0);
      await doAction(action, watchedMotion, expectedThreads);
      if (watchedMotion) watched.add(watchedMotion);
      const after = await state();
      check('页面实际动作已改变正确的持久状态', JSON.stringify(after.adventure.active) !== JSON.stringify(run));
      report.actions.push({ layer: run.layer, phase: run.phase, action, turn: run.turn });
    }
    saved = await state();
    if (singleBattle) {
      check('通过实际出牌打赢一场普通战并进入选牌', saved.adventure.active && saved.adventure.active.phase === 'cardReward' && report.actions.some(item => item.action.type === 'playCard'));
      check('首场星线已入库且永久伙伴保留', saved.adventure.threads > permanentBefore.threads && JSON.stringify(saved.collection) === permanentBefore.collection);
      report.result = { phase: saved.adventure.active.phase, layer: saved.adventure.active.layer, threadsGained: saved.adventure.threads - permanentBefore.threads, tickets: saved.tickets };
      await shot('first-battle-reward');
      report.console = await inspectConsole();
      check('首场运行时应用异常过滤为空', !report.console);
      report.status = 'pass';
      return;
    }
    check('远行在有界步数内实际结算', !saved.adventure.active && !!saved.adventure.lastResult);
    report.result = saved.adventure.lastResult;
    if (report.result.win) check('通关实玩经过首领第二阶段立绘', report.enemyArt.some(item => item.bossPhase === 2));
    if (process.argv.includes('--defeat')) check('实际不出牌被击败并正常归队', report.result.win === false);
    check('永久伙伴与此前已入库资源保留', JSON.stringify(saved.collection) === permanentBefore.collection && saved.adventure.threads >= permanentBefore.threads && saved.tickets >= permanentBefore.tickets);
    await shot('final-result');
    check('结算回执来自真实存档', (await data('screen.view.result')).nodesCleared === report.result.nodesCleared);
    const tickets = saved.tickets, threads = saved.adventure.threads;
    await tap('.finish-run');
    saved = await state();
    check('关闭回执不重复发资源', saved.tickets === tickets && saved.adventure.threads === threads);
    report.console = await inspectConsole();
    check('运行时应用异常过滤为空', !report.console);
    report.status = 'pass';
  } catch (error) { report.status = 'fail'; report.error = error.message; console.error(error.message); process.exitCode = 1; }
  finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(`CLI ${report.status}: ${out}`); }
}

if (require.main === module) {
  runAdventureRuntime();
}

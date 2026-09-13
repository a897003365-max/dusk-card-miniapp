// 隔离副本实玩：不注入卡牌、资源或随机数，只通过实际结束回合验证存能变成下回合超额能量。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const combat = require('../utils/combat');
const { createHarness } = require('./helpers/native-adventure');

assert(process.argv.includes('--allow-progress'), '需要明确授权隔离副本实玩');
const project = path.resolve(process.argv[2] || '.');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-charge-release-'));
const report = { project, out, checks: [], shots: [], status: 'running' };
const h = createHarness({ project, report, out });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

async function settle() {
  await h.evaluate(() => new Promise((resolve, reject) => {
    const deadline = Date.now() + 16000;
    function check() {
      if (!getCurrentPages().slice(-1)[0].data.screen?.busy) return resolve();
      if (Date.now() >= deadline) return reject(new Error('战斗表现未在16秒内结束'));
      setTimeout(check, 100);
    }
    check();
  }));
}

async function endTurn(label) {
  const before = await h.state();
  const expected = combat.applyAction(before, { type: 'endTurn' });
  await h.tap('.end-turn');
  await settle();
  const actual = await h.state();
  h.check(`${label}与共享规则结算一致`, same(actual, expected.state));
  report.actions = [...(report.actions || []), { label, events: expected.events }];
  return { before, expected, actual };
}

(async () => {
  try {
    h.check('实际KEY属于指定隔离副本', await h.evaluate(() => getApp().storageKey) === h.marker.storageKey);
    const initial = await h.state();
    h.check('从无进行中远行开始', !initial.adventure.active && !initial.journey);
    await h.call('automation_navigate', ['--action', 'switchTab', '--url', '/pages/adventure/index']);
    await h.tap('.tactic-tab[data-id="classic"]');
    await h.tap('.start-run');
    const route = await h.data('screen.run');
    const nodeId = route.nodes[route.layer].options[0].id;
    const beforeRoute = await h.state();
    const expectedRoute = combat.applyAction(beforeRoute, { type: 'chooseNode', nodeId });
    await h.tap(`.route-option[data-id="${nodeId}"]`, '.exp-scroll');
    h.check('实际选路进入第一场战斗', same(await h.state(), expectedRoute.state));
    let screen = await h.data('screen.run');
    h.check('第1回合基础能量为3', screen.turn === 1 && screen.energy === 3 && screen.energyRefill === 3);

    const first = await endTurn('第1回合保留1点能量');
    screen = await h.data('screen.run');
    h.check('存下1点后第2回合显示4/3超额能量', first.expected.events.some(event => event.kind === 'chargeBank' && event.amount === 1) && first.expected.events.some(event => event.kind === 'chargeRelease' && event.amount === 1) && screen.turn === 2 && screen.energy === 4 && screen.energyRefill === 3 && screen.charge === 0);
    await h.shot('turn-2-four-over-three');

    const second = await endTurn('第2回合再次保留1点能量');
    screen = await h.data('screen.run');
    h.check('存下1点后第3回合显示5/4超额能量', second.expected.events.some(event => event.kind === 'chargeRelease' && event.amount === 1) && screen.turn === 3 && screen.energy === 5 && screen.energyRefill === 4 && screen.charge === 0);
    await h.shot('turn-3-five-over-four');

    await h.tap('.tactic-hud');
    h.check('补给说明明确蓄能在下回合转为额外能量', (await h.data('screen.statusHelp')).id === 'charge' && (await h.data('screen.statusHelp')).rules.some(item => item.includes('新回合开始时，全部蓄能会变成额外能量')));
    await h.shot('charge-guide');
    await h.tap('.status-guide-back');
    await h.tap('.exp-log');
    await h.tap('.abandon-from-log', '.dialog-scroll');
    const beforeAbandon = await h.state();
    const expectedAbandon = combat.applyAction(beforeAbandon, { type: 'abandon' });
    await h.tap('.confirm-abandon');
    h.check('隔离实玩结束且已入库收益保持', same(await h.state(), expectedAbandon.state));
    report.console = await h.inspectConsole();
    h.check('本次原生运行控制台error为空', !report.console);
    report.status = 'pass';
  } catch (error) {
    report.status = 'fail'; report.error = error.stack; process.exitCode = 1; console.error(error.message);
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`${report.status}: ${out}`);
  }
})();

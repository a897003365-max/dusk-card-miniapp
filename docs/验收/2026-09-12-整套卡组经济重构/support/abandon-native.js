// 仅用于用户已授权的同一个隔离验收副本，以实际确认按钮结束单项实玩。
const fs = require('fs'), os = require('os'), path = require('path');
const source = '/Users/maizi/AI-Jobs/Projects/dusk-card-miniapp';
const { createHarness } = require(source + '/tests/helpers/native-adventure');
const combat = require(source + '/utils/combat');
const project = process.argv[2], out = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-withdraw-native-'));
const report = { project, out, checks: [], shots: [], status: 'running' }, h = createHarness({ project, out, report });
(async () => {
  try {
    const before = await h.state(); report.before = before; h.check('只结束当前隔离实玩', !!before.adventure.active);
    if (process.argv.includes('--require-intercept')) {
      report.interceptLog = before.adventure.active.log.filter(event => event.kind === 'interceptConsume');
      h.check('原生存档已记录一次护卫结算且护卫已消耗', report.interceptLog.length === 1 && before.adventure.active.interceptorId === null);
    }
    const expected = combat.applyAction(before, { type: 'abandon' }).state;
    await h.tap('.exp-log'); await h.tap('.abandon-from-log', '.dialog-scroll');
    await h.shot('withdraw-confirm'); await h.tap('.confirm-abandon');
    const actual = await h.state(); h.check('真实结束远行和源规则一致且保留已入库收益', JSON.stringify(actual) === JSON.stringify(expected) && actual.tickets === before.tickets && actual.adventure.threads === before.adventure.threads);
    await h.shot('withdraw-receipt'); await h.tap('.finish-run');
    const final = await h.state(); report.final = final; h.check('收好回执仅清除结果', !final.adventure.active && !final.adventure.lastResult && final.tickets === before.tickets && final.adventure.threads === before.adventure.threads);
    report.console = await h.inspectConsole(); h.check('现场console error为空', !report.console); report.status = 'pass';
  } catch (error) { report.status = 'fail'; report.error = error.stack; process.exitCode = 1; console.error(error.message); }
  finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(report.status + ': ' + out); }
})();

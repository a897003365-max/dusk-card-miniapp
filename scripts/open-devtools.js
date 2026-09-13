// 打开本地开发窗口并接通自动化；不上传、不预览到手机、不改存档。
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const project = process.argv[2] ? path.resolve(process.argv[2]) : root;
const config = JSON.parse(fs.readFileSync(path.join(project, 'project.config.json'), 'utf8'));
const emptyArgs = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-devtools-init-')), 'args.json');
fs.writeFileSync(emptyArgs, '[]');
const cli = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const ide = '/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide';
function callIde(args) {
  const output = execFileSync(ide, ['-c', 'Codex', ...args, '--project', project], { encoding: 'utf8', timeout: 45000 });
  const response = JSON.parse(output);
  if (!response.ok || response.result && response.result.success === false) throw new Error(response.message || output);
  console.log(`${args[0]}：通过`);
  return response.result;
}
// 本机旧 auto 开窗遗漏 AppID；正常开窗后启动 Agent 自动化服务。
callIde(['project_import']);
execFileSync(cli, ['open', '--project', project], { stdio: 'inherit', timeout: 60000 });
let agentOutput;
try {
  agentOutput = execFileSync(cli, ['agent', 'start', '--project', project], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
} catch (error) {
  const detail = [error.stdout, error.stderr].filter(Boolean).join('\n').trim();
  throw new Error(`自动化服务启动失败：${detail || error.message}`);
}
let started;
try { started = JSON.parse(agentOutput); }
catch (error) { throw new Error(`自动化服务返回无效结果：${agentOutput.trim() || error.message}`); }
if (started.status !== 'ok') throw Error('自动化服务未就绪：' + JSON.stringify(started));
callIde(['automation_page_action', '--action', 'getData', '--data-path', 'error']);
const account = callIde(['automation_evaluate', '--fn-source', 'function(){return wx.getAccountInfoSync().miniProgram.appId;}', '--args-file', emptyArgs]);
if (!account.result || account.result.result !== config.appid) throw Error('运行时 AppID 与项目配置不一致，初始化未完成；请关闭此项目窗口后重新打开。');
console.log(`已打开并核验 AppID：${project}`);

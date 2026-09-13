// 只复制应用代码；验收副本从正常初始状态启动，不复制或注入存档。
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
const args = process.argv.slice(2);
const appids = args;
assert(appids.length <= 1 && !appids.some(arg => arg.startsWith('--')), '用法：prepare-acceptance.js [AppID]');
if (appids[0]) config.appid = appids[0];
assert(config.appid !== 'touristappid', '先由用户指定可用的独立测试 AppID');
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-card-acceptance-'));

const entriesToCopy = ['app.js', 'app.json', 'app.wxss', 'sitemap.json', 'project.config.json', 'utils', 'pages', 'assets', 'templates', 'components'];
for (const pkg of appConfig.subPackages || []) {
  if (pkg && pkg.root) entriesToCopy.push(pkg.root);
}

for (const file of entriesToCopy) {
  const source = path.join(root, file);
  if (!fs.existsSync(source)) continue;
  fs.cpSync(path.join(root, file), path.join(project, file), { recursive: true });
}
const storageKey = `dusk-letter-rpg-v1-${path.basename(project)}`;
const appPath = path.join(project, 'app.js');
fs.writeFileSync(appPath, fs.readFileSync(appPath, 'utf8').replace("'dusk-letter-rpg-v1'", JSON.stringify(storageKey)));
const artStyle = require(path.join(root, 'assets/battle/manifest')).style;
config.projectname = '晚霞来信-纸灵验收-' + path.basename(project).split('-').pop();
fs.writeFileSync(path.join(project, 'project.config.json'), JSON.stringify(config, null, 2));
fs.writeFileSync(path.join(project, '.acceptance.json'), JSON.stringify({ source: root, storageKey, artStyle }));
console.log(JSON.stringify({ project, storageKey, artStyle }, null, 2));

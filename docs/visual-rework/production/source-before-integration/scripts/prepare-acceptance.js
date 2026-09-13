// 只复制应用代码；验收副本从正常初始状态启动，不复制或注入存档。
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
const args = process.argv.slice(2);
const artPilot = args.includes('--art-pilot');
const appids = args.filter(arg => arg !== '--art-pilot');
assert(appids.length <= 1 && !appids.some(arg => arg.startsWith('--')), '用法：prepare-acceptance.js [AppID] [--art-pilot]');
if (appids[0]) config.appid = appids[0];
assert(config.appid !== 'touristappid', '先由用户指定可用的独立测试 AppID');
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-card-acceptance-'));

const entriesToCopy = ['app.js', 'app.json', 'app.wxss', 'sitemap.json', 'project.config.json', 'utils', 'pages', 'assets', 'templates'];
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
config.projectname = '晚霞来信-隔离验收';
if (artPilot) {
  const assets = path.join(root, 'docs/visual-rework/pilots/runtime');
  const battleArt = JSON.parse(JSON.stringify(require(path.join(root, 'assets/battle/manifest'))));
  for (const id of ['sheep', 'orangecat', 'nav']) {
    fs.copyFileSync(path.join(assets, id + '.png'), path.join(project, 'assets/prizes', id, 'R.png'));
    fs.copyFileSync(path.join(assets, id + '-cast.png'), path.join(project, 'assets/battle', id + '-cast.png'));
    battleArt.heroes[id].source = 'paper-courier-pilot';
    battleArt.heroes[id].cast = '/assets/battle/' + id + '-cast.png';
  }
  const stagePath = 'package-street/assets/pilot';
  fs.mkdirSync(path.join(project, stagePath), { recursive: true });
  const scene = { background: 'street-back.jpg', middle: 'street-middle.png', front: 'street-front.png' };
  for (const file of [...Object.values(scene), 'paper-ball.png', 'stamp-moth.png']) {
    fs.copyFileSync(path.join(assets, file), path.join(project, stagePath, file));
  }
  battleArt.scenes.street = Object.fromEntries(Object.entries(scene).map(([key, file]) => [key, '/' + stagePath + '/' + file]));
  for (const id of ['paper-ball', 'stamp-moth']) battleArt.enemies[id] = { idle: '/' + stagePath + '/' + id + '.png' };
  fs.writeFileSync(path.join(project, 'assets/battle/manifest.js'), 'module.exports = ' + JSON.stringify(battleArt, null, 2) + ';\n');
  config.projectname = '晚霞来信-纸灵样板-' + path.basename(project).split('-').pop();
}
fs.writeFileSync(path.join(project, 'project.config.json'), JSON.stringify(config, null, 2));
fs.writeFileSync(path.join(project, '.acceptance.json'), JSON.stringify({ source: root, storageKey, artPilot }));
console.log(JSON.stringify({ project, storageKey, artPilot }, null, 2));

// 从已接入的战场背景派生主包封面；运行前先同步完整场景。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { scenes } = require('../assets/battle/manifest');
const root = path.resolve(__dirname, '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-cover-art-'));
const entries = Object.entries(scenes);
entries.forEach(([, scene]) => fs.accessSync(path.join(root, scene.background.slice(1))));
const report = entries.map(([id, scene]) => {
  const source = path.join(root, scene.background.slice(1));
  const resized = path.join(out, id + '.png');
  const file = path.join(out, path.basename(scene.cover));
  execFileSync('/usr/bin/sips', ['-Z', '320', '-s', 'format', 'png', source, '--out', resized]);
  execFileSync('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '50', resized, '--out', file]);
  return { id, source, file, width: 320, height: 320, bytes: fs.statSync(file).size };
});
if (report.reduce((sum, item) => sum + item.bytes, 0) > 70000) throw Error('三个主包封面超过70KB，需复核画质与主包预算');
const destination = path.join(root, 'docs/visual-rework/production/cover-runtime');
fs.mkdirSync(destination, { recursive: true });
report.forEach(item => fs.copyFileSync(item.file, path.join(destination, path.basename(item.file))));
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log('封面派生完成：' + out);

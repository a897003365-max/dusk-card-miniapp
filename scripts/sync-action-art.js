const fs = require('node:fs');
const path = require('node:path');
const { FAMILIES } = require('../utils/content');
const { ENEMY_BY_ID } = require('../utils/combat-content');
const { BOSSES, STATES, heroGroup } = require('../utils/action-art');
const root = path.resolve(__dirname, '..');
const catalog = [...FAMILIES.map(x => x.id), ...BOSSES.flatMap(id => [id, id + '-phase2'])];
const selected = process.argv.slice(2);
const ids = selected.length ? [...new Set(selected)] : catalog;
const files = ids.flatMap(id => {
  if (!catalog.includes(id)) throw Error('未知动作身份 ' + id);
  const group = heroGroup(id), boss = ENEMY_BY_ID[id.replace(/-phase2$/, '')];
  const directory = group ? `package-actors-${group}/assets/${id}` : `package-${boss.regionId}/assets/actions/${id}`;
  return STATES.map(state => ({ id, state, source: path.join(root, 'docs/combat-motion/runtime', id, state + '.png'), destination: path.join(root, directory, state + '.png') }));
});
files.forEach(file => fs.accessSync(file.source));
files.forEach(file => { fs.mkdirSync(path.dirname(file.destination), { recursive: true }); fs.copyFileSync(file.source, file.destination); });
console.log(JSON.stringify({ identities: ids.length, frames: files.length, bytes: files.reduce((sum, file) => sum + fs.statSync(file.destination).size, 0) }));

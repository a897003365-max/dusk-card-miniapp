const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const routes = [...app.pages, ...(app.subPackages || []).flatMap(pack =>
  pack.pages.map(page => `${pack.root}/${page}`))];
const files = ['app.wxss', 'templates/expedition.wxss', 'pages/home/summon.wxss', ...routes.map(route => `${route}.wxss`)];
function collectComponents(directory) {
  if (!fs.existsSync(path.join(root, directory))) return;
  for (const item of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const file = `${directory}/${item.name}`;
    if (item.isDirectory()) collectComponents(file);
    else if (file.endsWith('.wxss')) files.push(file);
  }
}
['components', ...(app.subPackages || []).map(pack => pack.root + '/components')].forEach(collectComponents);

for (const file of files) {
  const css = fs.readFileSync(path.join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // 只检查选择器，避免把注释和 calc 乘法识别成通配选择器。
  for (const match of css.matchAll(/([^{}]+)\{/g)) {
    const selector = match[1].trim();
    assert(!/(^|[\s,>+~])\*(?=[\s.#[:>,+~]|$)/.test(selector), `${file} 禁止通配选择器：${selector}`);
  }
}
console.log(`✓ ${files.length} 份实际 WXSS 无通配选择器`);

if (process.argv.includes('--native')) {
  const compiler = '/Applications/wechatwebdevtools.app/Contents/Resources/app.asar.unpacked/node_modules/wcc-exec/wcsc';
  assert(fs.existsSync(compiler), '未找到微信开发者工具原生 WXSS 编译器');
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-wxss-probe-'));
  try {
    const invalid = path.join(probe, 'invalid.wxss');
    fs.writeFileSync(invalid, '.page *, .page *::before { animation: none !important; }');
    const rejected = spawnSync(compiler, ['-lc', invalid], { encoding: 'utf8' });
    assert.ifError(rejected.error);
    assert.notEqual(rejected.status, 0, '原生编译器必须拦截已知非法通配选择器');
    assert.match(rejected.stderr, /unexpected token.*\*/, '失败必须来自通配选择器，而非启动或路径错误');
    const compiled = spawnSync(compiler, ['-lc', ...files], {
      cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024
    });
    assert.ifError(compiled.error);
    assert.equal(compiled.status, 0, compiled.stderr || '原生 WXSS 编译失败');
    assert(compiled.stdout.length > 0, '原生编译必须生成实际产物');
    console.log(`✓ 已知非法写法被拦截；${files.length} 份实际 WXSS 原生编译通过`);
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
}

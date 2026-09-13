const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseArgs } = require('node:util');
const crypto = require('node:crypto');
const { STATES, BOSSES } = require('../utils/action-art');
const { FAMILIES } = require('../utils/content');
const { cleanKeyEdges, inspectRaw } = require('./build-partner-art');

const root = path.resolve(__dirname, '..');
const base = path.join(root, 'docs/combat-motion');
const ffmpeg = '/opt/homebrew/bin/ffmpeg';
const run = (cmd, args) => execFileSync(cmd, args, { maxBuffer: 80 * 1024 * 1024 });
const { values, positionals } = parseArgs({ allowPositionals: true, options: { size: { type: 'string', default: '256' }, colors: { type: 'string', default: '128' } } });
const size = Number(values.size), colors = Number(values.colors);
if (!Number.isInteger(size) || size < 96 || size > 384 || !Number.isInteger(colors) || colors < 32 || colors > 256) throw Error('size需96–384，colors需32–256');
const catalog = [...FAMILIES.map(x => x.id), ...BOSSES.flatMap(id => [id, id + '-phase2'])];
const ids = positionals.length ? [...new Set(positionals)] : catalog;
ids.forEach(id => { if (!catalog.includes(id)) throw Error('未知角色 '+id); fs.accessSync(path.join(base, 'masters', id + '-sheet.png')); });
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-action-art-'));
const report = { size, colors, out, actors: [], frames: [] };

// 生图的间距不总是均匀。只沿透明像素分隔，不用直线切断武器或特效。
function transparentSeam(raw, width, height, horizontal, center, radius, rowBoundary, wantedRow) {
  const length = horizontal ? width : height;
  const cross = horizontal ? height : width;
  const lo = Math.max(1, Math.floor(center - radius)), hi = Math.min(cross - 2, Math.ceil(center + radius));
  const count = hi - lo + 1, back = new Int8Array(length * count);
  let previous = new Float64Array(count), next = new Float64Array(count);
  function blocked(step, pos) {
    const x = horizontal ? step : pos, y = horizontal ? pos : step;
    if (rowBoundary && (y <= rowBoundary[x] ? 0 : 1) !== wantedRow) return false;
    return raw[(y * width + x) * 4 + 3] > 0;
  }
  for (let j = 0; j < count; j++) previous[j] = blocked(0, lo + j) ? Infinity : Math.abs(lo + j - center) * .001;
  for (let step = 1; step < length; step++) {
    next.fill(Infinity);
    for (let j = 0; j < count; j++) {
      if (blocked(step, lo + j)) continue;
      let best = previous[j], move = 0;
      for (const delta of [-1, 1]) {
        const k = j + delta;
        if (k >= 0 && k < count && previous[k] + .01 < best) { best = previous[k] + .01; move = delta; }
      }
      next[j] = best + Math.abs(lo + j - center) * .001;
      back[step * count + j] = move;
    }
    [previous, next] = [next, previous];
  }
  let end = 0;
  for (let j = 1; j < count; j++) if (previous[j] < previous[end]) end = j;
  if (!Number.isFinite(previous[end])) throw Error('动作之间没有连续透明分隔，请用imagegen重排有交叠的母稿');
  const seam = new Int32Array(length);
  for (let step = length - 1; step >= 0; step--) { seam[step] = lo + end; end += back[step * count + end]; }
  return seam;
}

for (const id of ids) {
  const source = path.join(base, 'masters', id + '-sheet.png');
  const snapshot = path.join(out, id + '-source.png'), sourceBytes = fs.readFileSync(source);
  fs.writeFileSync(snapshot, sourceBytes);
  const sourceHash = crypto.createHash('sha256').update(sourceBytes).digest('hex');
  const info = JSON.parse(run('/opt/homebrew/bin/ffprobe', ['-v', 'quiet', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', snapshot])).streams[0];
  const { width, height } = info;
  let raw = run(ffmpeg, ['-v', 'error', '-i', snapshot, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
  const keyed = raw[3] > 0 && raw[0] > raw[1] + 100 && raw[2] > raw[1] + 100;
  let cleanup = null;
  if (keyed) {
    raw = run(ffmpeg, ['-v', 'error', '-i', snapshot, '-vf', 'colorkey=0xFF00FF:0.20:0,format=rgba', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
    cleanup = cleanKeyEdges(raw, width, height);
  }
  report.actors.push({ id, source, sourceHash, width, height, keyed, cleanup });
  const directory = path.join(out, id);
  fs.mkdirSync(directory);
  const horizontal = transparentSeam(raw, width, height, true, height / 2, height * .18);
  const vertical = [0, 1].map(row => [1, 2, 3].map(col => transparentSeam(raw, width, height, false, width * col / 4, width * .095, horizontal, row)));
  const owners = new Int8Array(width * height).fill(-1);
  let foregroundPixels = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!raw[(y * width + x) * 4 + 3]) continue;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) throw Error(id + '前景触及整张母稿边缘，需要补全后再派生');
    const row = y <= horizontal[x] ? 0 : 1;
    const col = vertical[row].filter(seam => x > seam[y]).length;
    owners[y * width + x] = row * 4 + col; foregroundPixels++;
  }
  fs.writeFileSync(path.join(directory, 'seams.json'), JSON.stringify({ horizontal: [...horizontal], vertical: vertical.map(row => row.map(seam => [...seam])), foregroundPixels }));
  let assignedPixels = 0;
  for (let index = 0; index < STATES.length; index++) {
    const state = STATES[index], w = width, h = height, frame = Buffer.alloc(raw.length);
    for (let pixel = 0; pixel < owners.length; pixel++) if (owners[pixel] === index) { raw.copy(frame, pixel * 4, pixel * 4, pixel * 4 + 4); assignedPixels++; }
    const inspected = inspectRaw(frame, w, h);
    const b = inspected.bounds, padding = Math.max(4, Math.ceil(Math.max(b.width, b.height) * 0.05));
    const cw = b.width + padding * 2, ch = b.height + padding * 2, cropped = Buffer.alloc(cw * ch * 4);
    for (let line = 0; line < b.height; line++) frame.copy(cropped, ((line + padding) * cw + padding) * 4, ((b.y + line) * w + b.x) * 4, ((b.y + line) * w + b.x + b.width) * 4);
    const rgba = path.join(directory, state + '.rgba'), master = path.join(directory, state + '-master.png'), resized = path.join(directory, state + '-resized.png'), file = path.join(directory, state + '.png');
    fs.writeFileSync(rgba, cropped);
    run(ffmpeg, ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${cw}x${ch}`, '-i', rgba, '-frames:v', '1', '-y', master]);
    run('/usr/bin/sips', ['-Z', String(size), master, '--out', resized]);
    run('/opt/homebrew/bin/pngquant', [String(colors), '--quality=0-95', '--speed', '1', '--strip', '--force', '--output', file, resized]);
    report.frames.push({ id, state, master, file, contentBounds: b, bytes: fs.statSync(file).size });
  }
  if (assignedPixels !== foregroundPixels) throw Error(id + '分隔像素计数不一致');
  report.actors.at(-1).foregroundPixels = foregroundPixels;
  report.actors.at(-1).assignedPixels = assignedPixels;
  if (crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex') !== sourceHash) throw Error(id + '母稿在派生期间更新，请等待本稿完成后重新派生');
}
// 全部所选身份通过才接入生产派生目录，错误时不覆盖已验证帧。
for (const item of report.frames) {
  const masterDir = path.join(base, 'frames', item.id), runtimeDir = path.join(base, 'runtime', item.id);
  fs.mkdirSync(masterDir, { recursive: true }); fs.mkdirSync(runtimeDir, { recursive: true });
  fs.copyFileSync(item.master, path.join(masterDir, item.state + '.png'));
  fs.copyFileSync(item.file, path.join(runtimeDir, item.state + '.png'));
}
report.bytes = report.frames.reduce((sum, item) => sum + item.bytes, 0);
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ out, actors: ids.length, frames: report.frames.length, bytes: report.bytes }));

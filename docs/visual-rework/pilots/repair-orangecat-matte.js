// 本张图的局部修复记录：目视核实肩部和尾纹区域全为身体，恢复被 Vision 误判的深灰折面。
// 只用于这两张 1536×1024 母稿，不是通用抠图算法。运行输出一个新的 v5 母稿。
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const ffmpeg = '/opt/homebrew/bin/ffmpeg';
const original = path.join(__dirname, 'paper-orangecat-v1-opaque.png');
const matte = path.join(__dirname, 'paper-orangecat-v3-transparent.png');
const output = path.join(__dirname, 'paper-orangecat-v5-transparent.png');
const width = 1536, height = 1024;
const regions = [{ x: 990, y: 380, width: 145, height: 130 }, { x: 190, y: 276, width: 28, height: 34 }];
assert(!fs.existsSync(output), '保留已有结果，不覆盖母稿');
function decode(file) {
  const pixels = execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', file,
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-frames:v', '1', 'pipe:1'], { maxBuffer: 16 * 1024 * 1024 });
  assert.equal(pixels.length, width * height * 4);
  return pixels;
}
const source = decode(original), before = decode(matte), repaired = Buffer.from(before);
let restoredPixels = 0;
for (const region of regions) for (let y = region.y; y < region.y + region.height; y++) {
  for (let x = region.x; x < region.x + region.width; x++) {
    const p = (y * width + x) * 4;
    if (before[p + 3] < 255) {
      assert.equal(source[p + 3], 255);
      source.copy(repaired, p, p, p + 4);
      restoredPixels++;
    }
  }
}
assert(restoredPixels > 0, '必须实际修复错误透明像素');
execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pixel_format', 'rgba',
  '-video_size', `${width}x${height}`, '-i', 'pipe:0', '-frames:v', '1', output], { input: repaired });
const after = decode(output);
assert(after.equals(repaired), 'PNG 编码必须逐字节保留修复后的 RGBA');
let outsideChanged = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (regions.some(region => x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height)) continue;
    const p = (y * width + x) * 4;
    if (!after.subarray(p, p + 4).equals(before.subarray(p, p + 4))) outsideChanged++;
  }
}
assert.equal(outsideChanged, 0);
console.log(JSON.stringify({ status: 'pass', original, matte, output, regions, restoredPixels, outsideChanged }, null, 2));

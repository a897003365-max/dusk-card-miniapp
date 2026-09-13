// 两地区场景派生。叠加层保留完整画布与物件位置，不使用角色的内容裁切。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { run, cleanKeyEdges, inspectRaw, KEY_FILTER } = require('./build-partner-art');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'docs/visual-rework/production/scenes');
const target = path.join(root, 'docs/visual-rework/production/scene-runtime');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-scene-art-'));
const report = { status: 'building', outputs: [] };
const ffmpeg = '/opt/homebrew/bin/ffmpeg';
const jobs = ['bridge', 'market'].flatMap(region => ['back', 'middle', 'front'].map(layer => ({ region, layer,
  input: path.join(source, `${region}-${layer === 'back' ? 'back-master' : layer + '-key'}.png`) })));
try {
  jobs.forEach(job => fs.accessSync(job.input));
  const checker = path.join(temp, 'check-alpha');
  run('/usr/bin/xcrun', ['swiftc', '-O', path.join(__dirname, 'check-sprite-alpha.swift'), '-o', checker]);
  for (const job of jobs) {
    const stem = `${job.region}-${job.layer}`;
    const resized = path.join(temp, stem + '-resized.png');
    const output = path.join(temp, stem + (job.layer === 'back' ? '.jpg' : '.png'));
    if (job.layer === 'back') {
      run('/usr/bin/sips', ['-Z', '1024', job.input, '--out', resized]);
      run('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', resized, '--out', output]);
      report.outputs.push({ ...job, output, bytes: fs.statSync(output).size, format: 'JPEG-1024' });
    } else {
      const header = fs.readFileSync(job.input);
      const width = header.readUInt32BE(16), height = header.readUInt32BE(20);
      const pixels = run(ffmpeg, ['-v', 'error', '-i', job.input, '-vf', KEY_FILTER, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']);
      const edgeCleanup = cleanKeyEdges(pixels, width, height);
      const sourceAlpha = inspectRaw(pixels, width, height);
      const rgba = path.join(temp, stem + '-rgba.png');
      run(ffmpeg, ['-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${width}x${height}`, '-i', 'pipe:0', '-frames:v', '1', rgba], { input: pixels });
      run('/usr/bin/sips', ['-Z', '1024', rgba, '--out', resized]);
      run('/opt/homebrew/bin/pngquant', ['--quality=0-95', '--speed', '1', '--strip', '--output', output, resized]);
      const alpha = JSON.parse(run(checker, [output], { encoding: 'utf8' }));
      if (alpha.status !== 'pass') throw Error(`${stem} 没有合格的透明层`);
      report.outputs.push({ ...job, output, bytes: fs.statSync(output).size, sourceAlpha, edgeCleanup, alpha: alpha.files[0] });
    }
  }
  fs.mkdirSync(target, { recursive: true });
  for (const item of report.outputs) fs.copyFileSync(item.output, path.join(target, path.basename(item.output)));
  report.status = 'pass';
} catch (error) { report.status = 'fail'; report.error = error.message; process.exitCode = 1; }
fs.writeFileSync(path.join(temp, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ status: report.status, report: path.join(temp, 'report.json'), outputs: report.outputs.map(({ region, layer, bytes }) => ({ region, layer, bytes })) }));

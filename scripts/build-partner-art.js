"use strict";

// 本机派生图：node scripts/build-partner-art.js [家族ID ...] [--idle-size=384] [--cast-size=224]
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { parseArgs } = require("node:util");
const { FAMILIES } = require("../utils/content");
const { ENEMIES } = require("../utils/combat-content");

const ROOT = path.resolve(__dirname, "..");
const ART = path.join(ROOT, "docs/visual-rework");
const FFMPEG = "/opt/homebrew/bin/ffmpeg";
const PNGQUANT = "/opt/homebrew/bin/pngquant";
const PILOTS = {
  sheep: "paper-sheep-v5-transparent.png",
  orangecat: "paper-orangecat-v5-transparent.png",
  nav: "paper-nav-v3-transparent.png",
};
const KEY_FILTER = "colorkey=0xFF00FF:0.20:0,format=rgba";

function run(command, args, options = {}) {
  return execFileSync(command, args, { maxBuffer: 256 * 1024 * 1024, ...options });
}

// 仅用于禁止洋红主体的新母稿；每轮按旧 alpha 判断，最多向边缘内清理两层。
function cleanKeyEdges(pixels, width, height) {
  const rounds = [];
  for (let round = 0; round < 2; round += 1) {
    const alpha = Uint8Array.from({ length: width * height }, (_, i) => pixels[i * 4 + 3]);
    let removed = 0;
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const index = y * width + x, offset = index * 4;
      if (!alpha[index]) continue;
      const r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2];
      if (Math.min(r, b) <= g + 70 || Math.min(r, b) <= 100 || Math.abs(r - b) >= 90) continue;
      const touchesTransparent = (x > 0 && alpha[index - 1] === 0)
        || (x + 1 < width && alpha[index + 1] === 0)
        || (y > 0 && alpha[index - width] === 0)
        || (y + 1 < height && alpha[index + width] === 0);
      if (touchesTransparent) { pixels.fill(0, offset, offset + 4); removed += 1; }
    }
    rounds.push(removed);
    if (removed === 0) break;
  }
  return { rounds, removedPixels: rounds.reduce((sum, count) => sum + count, 0) };
}

function inspectRaw(pixels, width, height) {
  if (pixels.length !== width * height * 4) throw new Error("RGBA 字节数与源图尺寸不符");
  let minX = width, minY = height, maxX = -1, maxY = -1, transparentPixels = 0;
  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    if (pixels[offset + 3] === 0) {
      pixels.fill(0, offset, offset + 3); // 仅归零完全透明像素的 RGB，不改变可见主体颜色。
      transparentPixels += 1;
      continue;
    }
    const x = i % width, y = Math.floor(i / width);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (maxX < 0 || transparentPixels === 0) throw new Error("抠图后全透明或没有真实透明背景");
  const bounds = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  const touchesCanvasEdge = minX === 0 || minY === 0 || maxX === width - 1 || maxY === height - 1;
  return { width, height, transparentPixels, bounds, touchesCanvasEdge };
}

// 本批已目视定位的漏勺/绳孔键色，按归一化后的相对区域局部清理。
// 更换对应母稿后应复核这些区域，不能扩大为全图去色。
function cleanKnownHoles(pixels, width, height, job) {
  const regions = {
    "ramen-idle": [[109 / 195, 228 / 384, 130 / 195, 245 / 384]],
    "firefly-idle": [[151 / 272, 190 / 384, 176 / 272, 208 / 384]],
    "soup-idle": [[46 / 368, 231 / 384, 53 / 368, 235 / 384]],
    "market-usher-enemy": [[150 / 285, 287 / 384, 154 / 285, 291 / 384]],
    "twine-sprite-enemy": [[324 / 369, 92 / 384, 332 / 369, 103 / 384]],
    "rain-knot-enemy": [[315 / 384, 137 / 376, 319 / 384, 142 / 376], [334 / 384, 140 / 376, 339 / 384, 145 / 376]],
    "paper-lion-enemy": [[335 / 384, 66 / 344, 340 / 384, 71 / 344]],
    "paper-lion-phase2-enemy": [[170 / 384, 44 / 327, 184 / 384, 55 / 327]],
    "bell-warden-enemy": [[256 / 384, 96 / 379, 261 / 384, 102 / 379]],
    "bell-warden-phase2-enemy": [[242 / 384, 91 / 331, 248 / 384, 97 / 331]],
  };
  const boxes = regions[`${job.id}-${job.pose}`] || [];
  let removed = 0;
  for (const box of boxes) {
    for (let y = Math.floor(box[1] * height); y < Math.ceil(box[3] * height); y++) {
      for (let x = Math.floor(box[0] * width); x < Math.ceil(box[2] * width); x++) {
        const p = (y * width + x) * 4, r = pixels[p], g = pixels[p + 1], b = pixels[p + 2];
        if (pixels[p + 3] && r > g + 25 && b > g + 25 && Math.min(r, b) > 70) {
          pixels.fill(0, p, p + 4); removed++;
        }
      }
    }
  }
  return removed;
}

function checkPNG(checker, file) {
  const result = JSON.parse(run(checker, [file], { encoding: "utf8" }));
  const alpha = result.files[0];
  if (result.status !== "pass" || alpha.touchesCanvasEdge) {
    throw new Error(`产物 alpha 或画布边界检查失败：${file}`);
  }
  return { path: file, bytes: fs.statSync(file).size, ...alpha };
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { "idle-size": { type: "string", default: "384" }, "cast-size": { type: "string", default: "224" }, "enemy-size": { type: "string", default: "384" }, enemies: { type: "boolean" }, help: { type: "boolean" } },
  });
  if (values.help) {
    console.log("用法：node scripts/build-partner-art.js [家族ID ...] [--idle-size=384] [--cast-size=224] [--enemies --enemy-size=384]\n省略ID处理全部伙伴或敌人/首领阶段；尺寸为最长边。仅重建production派生图片。报告写系统临时目录。");
    return;
  }
  const sizes = { idle: Number(values["idle-size"]), cast: Number(values["cast-size"]), enemy: Number(values["enemy-size"]) };
  if (Object.values(sizes).some((size) => !Number.isSafeInteger(size) || size < 32 || size > 2048)) {
    throw new Error("--idle-size / --cast-size 必须为 32 至 2048 的整数像素");
  }
  const catalog = values.enemies ? ENEMIES.flatMap(enemy => enemy.phase2 ? [enemy, { ...enemy, id: enemy.id + "-phase2" }] : [enemy]) : FAMILIES;
  const ids = positionals.length ? [...new Set(positionals)] : catalog.map(({ id }) => id);
  const invalid = ids.filter((id) => !catalog.some((entry) => entry.id === id));
  if (invalid.length) throw new Error(`未知素材ID：${invalid.join(", ")}`);
  const enemyPilots = { "paper-ball": "paper-ball-v3-transparent.png", "stamp-moth": "stamp-moth-v2-transparent.png" };
  const jobs = values.enemies ? ids.map(id => ({
    id, pose: "enemy", keyed: !enemyPilots[id],
    source: enemyPilots[id] ? path.join(ART, "pilots", enemyPilots[id]) : path.join(ART, "production/enemy-masters", `${id}-key.png`)
  })) : ids.flatMap((id) => ["idle", "cast"].map((pose) => ({
    id, pose,
    keyed: !Object.hasOwn(PILOTS, id),
    source: Object.hasOwn(PILOTS, id)
      ? path.join(ART, "pilots", pose === "idle" ? PILOTS[id] : `paper-${id}-cast-keyed.png`)
      : path.join(ART, "production/masters", `${id}-${pose}-key.png`),
  })));
  // 全部输入验证完毕才开始派生；缺稿直接退出，不混入旧图。
  const missing = jobs.filter(({ source }) => !fs.existsSync(source) || !fs.statSync(source).isFile());
  if (missing.length) throw new Error(`缺少母稿，未开始派生：\n${missing.map(({ source }) => source).join("\n")}`);
  [FFMPEG, PNGQUANT, "/usr/bin/sips", "/usr/bin/xcrun"].forEach((tool) => fs.accessSync(tool, fs.constants.X_OK));

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "dusk-partner-art-"));
  const reportPath = path.join(temporary, "report.json");
  const report = { status: "building", createdAt: new Date().toISOString(), kind: values.enemies ? "enemy" : "partner", ids, sizes, keyFilter: KEY_FILTER, padding: "内容宽高各5%，四边分别留白，向上取整", outputs: [] };
  const staged = [];
  console.log(`报告：${reportPath}`);
  try {
    const checker = path.join(temporary, "check-sprite-alpha");
    run("/usr/bin/xcrun", ["swiftc", "-O", path.join(__dirname, "check-sprite-alpha.swift"), "-o", checker]);
    for (const job of jobs) {
      const sourcePNG = fs.readFileSync(job.source);
      if (!sourcePNG.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || sourcePNG.length < 24) {
        throw new Error(`母稿不是有效 PNG：${job.source}`);
      }
      const width = sourcePNG.readUInt32BE(16), height = sourcePNG.readUInt32BE(20);
      const stem = values.enemies ? job.id : `${job.id}-${job.pose}`;
      const raw = path.join(temporary, `${stem}.rgba`);
      run(FFMPEG, ["-v", "error", "-nostdin", "-i", job.source, "-vf", job.keyed ? KEY_FILTER : "format=rgba", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", raw]);
      const pixels = fs.readFileSync(raw);
      const edgeCleanup = job.keyed ? cleanKeyEdges(pixels, width, height) : null;
      const sourceAlpha = inspectRaw(pixels, width, height);
      if (sourceAlpha.touchesCanvasEdge) throw new Error(`母稿可见内容触边，需先复核原图是否被裁切：${job.source}`);
      const b = sourceAlpha.bounds;
      const paddingX = Math.ceil(b.width * 0.05), paddingY = Math.ceil(b.height * 0.05);
      const outWidth = b.width + paddingX * 2, outHeight = b.height + paddingY * 2;
      const cropped = Buffer.alloc(outWidth * outHeight * 4);
      for (let y = 0; y < b.height; y += 1) {
        const start = ((b.y + y) * width + b.x) * 4;
        pixels.copy(cropped, ((y + paddingY) * outWidth + paddingX) * 4, start, start + b.width * 4);
      }
      const keyHolePixels = cleanKnownHoles(cropped, outWidth, outHeight, job);
      const rgba = path.join(temporary, `${stem}-rgba.png`);
      const resized = path.join(temporary, `${stem}-resized.png`);
      const runtime = path.join(temporary, `${stem}-runtime.png`);
      const croppedRaw = path.join(temporary, `${stem}-cropped.rgba`);
      fs.writeFileSync(croppedRaw, cropped);
      run(FFMPEG, ["-v", "error", "-nostdin", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", `${outWidth}x${outHeight}`, "-i", croppedRaw, "-frames:v", "1", rgba]);
      run("/usr/bin/sips", ["-Z", String(sizes[job.pose]), rgba, "--out", resized]);
      run(PNGQUANT, ["--quality=0-95", "--speed", "1", "--strip", "--output", runtime, resized]);
      const rgbaCheck = checkPNG(checker, rgba), runtimeCheck = checkPNG(checker, runtime);
      const rgbaTarget = path.join(ART, values.enemies ? "production/enemy-rgba" : "production/rgba", `${stem}.png`);
      const runtimeTarget = path.join(ART, values.enemies ? "production/enemy-runtime" : "production/runtime", `${job.id}${job.pose === "cast" ? "-cast" : ""}.png`);
      staged.push({ source: rgba, target: rgbaTarget }, { source: runtime, target: runtimeTarget });
      report.outputs.push({ ...job, sourceBytes: sourcePNG.length, sourceAlpha, paddingX, paddingY, edgeCleanup, keyHolePixels, rgba: { ...rgbaCheck, path: rgbaTarget, stagedPath: rgba }, runtime: { ...runtimeCheck, path: runtimeTarget, stagedPath: runtime } });
      console.log(`${stem}：${runtimeCheck.width}×${runtimeCheck.height}，${runtimeCheck.bytes} bytes，清理洋红边 ${edgeCleanup ? edgeCleanup.removedPixels : 0} 像素，alpha与边界通过`);
    }
    // 所选产物全部通过后才替换派生文件，每个文件以同目录 rename 原子替换。
    for (const { source, target } of staged) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const pending = `${target}.${process.pid}.tmp`;
      fs.copyFileSync(source, pending);
      fs.renameSync(pending, target);
    }
    report.status = "pass";
    report.runtimeBytes = report.outputs.reduce((sum, item) => sum + item.runtime.bytes, 0);
  } catch (error) {
    report.status = "fail";
    report.error = error.message;
    throw error;
  } finally {
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(`完成 ${ids.length} 位；运行图 ${report.runtimeBytes} bytes。报告：${reportPath}`);
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { run, cleanKeyEdges, inspectRaw, KEY_FILTER };

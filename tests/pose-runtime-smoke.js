"use strict";

// 真实UI驱动：gallery-only只读公开动作图谱；默认额外只完成一次真实出牌并采样动作节点。
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHarness } = require("./helpers/native-adventure");
const { FAMILY_IDS, STATES, closeOpenSheet, inspectGallery } = require("./helpers/action-gallery");
const { imageFor } = require("../utils/action-art");

const project = path.resolve(process.argv[2] || ".");
const galleryOnly = process.argv.includes("--gallery-only");
const family = process.argv.find(arg => arg.startsWith("--family="))?.split("=")[1] || "";
const width = Number(process.argv.find(arg => arg.startsWith("--width="))?.split("=")[1] || 390);
assert(!family || family === "all" || FAMILY_IDS.includes(family), `姿态观察仅接受22位伙伴或all：${family}`);
if (!galleryOnly) assert(process.argv.includes("--allow-progress"), "出牌观察需要明确授权隔离实玩");

const out = fs.mkdtempSync(path.join(os.tmpdir(), "dusk-pose-runtime-"));
const report = { project, out, family, width, galleryOnly, checks: [], interactions: [], shots: [], gallery: [], samples: [], status: "running" };
const h = createHarness({ project, report, out });

async function observePlay(selector, actionDuration, impactDuration) {
  const geometry = await h.geometry(selector);
  h.check("动作观察的真实按钮完整可见且至少44px", geometry.rect.width >= 44 && geometry.rect.height >= 44 && geometry.rect.top >= 0 && geometry.rect.bottom <= geometry.viewport.height && geometry.rect.left >= 0 && geometry.rect.right <= geometry.viewport.width);
  report.interactions.push({ selector, rect: geometry.rect, viewport: geometry.viewport });
  await h.waitForCapacity(2);
  const observing = h.evaluate(async function (actionMs, impactMs) {
    const samples = [];
    const sampleCounts = {};
    let busySeen = false;
    let busyStart = 0;
    const waitDeadline = Date.now() + 8000;
    const normalize = (node, kind) => ({
      kind,
      src: node && node.src ? node.src : "",
      width: node && (node.width || (node.rect && node.rect.width)) || 0,
      height: node && (node.height || (node.rect && node.rect.height)) || 0,
      animationName: node && node["animation-name"] || "",
      transform: node && node.transform || "none",
      opacity: node && node.opacity,
    });
    const readNodes = () => new Promise(resolve => {
      const query = wx.createSelectorQuery();
      query.selectAll(".ally-unit >>> .action-image").fields({ rect: true, size: true, properties: ["src"], computedStyle: ["animation-name", "transform", "opacity"] });
      query.selectAll(".ally-unit .unit-art").fields({ rect: true, size: true, properties: ["src"], computedStyle: ["animation-name", "transform", "opacity"] });
      query.selectAll(".enemy-unit .unit-art").fields({ rect: true, size: true, properties: ["src"], computedStyle: ["animation-name", "transform", "opacity"] });
      query.exec(rows => resolve([
        ...(rows[0] || []).map(node => normalize(node, "ally-image")),
        ...(rows[1] || []).map(node => normalize(node, "ally-art")),
        ...(rows[2] || []).map(node => normalize(node, "enemy-art")),
      ]));
    });
    while (!busySeen && Date.now() < waitDeadline) {
      const screen = getCurrentPages().slice(-1)[0].data.screen;
      if (screen.busy) { busySeen = true; busyStart = Date.now(); break; }
      await new Promise(resolve => setTimeout(resolve, 35));
    }
    if (!busySeen) return { busySeen: false, samples };
    const deadline = busyStart + actionMs + impactMs + 500;
    while (Date.now() < deadline) {
      const page = getCurrentPages().slice(-1)[0];
      const screen = page.data.screen;
      const beat = screen.beat || "";
      const nodes = await readNodes();
      const candidates = nodes.filter(node => node.src || (node.animationName && node.animationName !== "none"));
      const used = sampleCounts[beat] || 0;
      if (beat && candidates.length && used < 4) {
        samples.push({
          time: Date.now(),
          beat,
          busy: screen.busy,
          party: screen.run ? screen.run.party.map(unit => ({ id: unit.id, image: unit.image, actionState: unit.actionState, acting: unit.acting })) : [],
          nodes: candidates,
        });
        sampleCounts[beat] = used + 1;
      }
      await new Promise(resolve => setTimeout(resolve, 35));
    }
    return { busySeen: true, busyStart, samples, sampleCounts };
  }, [actionDuration, impactDuration], { burst: true }).then(value => ({ value }), error => ({ error: error.message }));
  await new Promise(resolve => setTimeout(resolve, 250));
  await h.call("automation_element_action", ["--action", "tap", "--selector", selector, "--wait-for-selector", selector], { burst: true });
  const observed = await observing;
  if (observed.error) throw new Error(observed.error);
  return observed.value;
}

(async () => {
  try {
    h.check("只在纸灵美术验收副本执行", h.marker.artStyle === "paper-courier");
    h.check("运行存档与副本命名空间一致", await h.evaluate(function () { return getApp().storageKey; }) === h.marker.storageKey);
    h.check("实际模拟器宽度正确", await h.evaluate(function () { return wx.getWindowInfo().windowWidth; }) === width);
    const before = await h.state();
    assert(before.adventure.active && before.adventure.active.phase === "battle", "需要已经进入真实战斗");
    await closeOpenSheet(h);
    await h.call("automation_navigate", ["--action", "switchTab", "--url", "/pages/adventure/index"]);
    await h.tap(".resume-run");
    assert(await h.data("screen.run"), "继续远行后没有真实战斗页面");

    await inspectGallery(h, { family, region: (await h.data("screen.regionId")) || before.adventure.active.regionId, report });
    await h.shot("after-gallery");
    if (galleryOnly) {
      report.console = await h.inspectConsole();
      h.check("图谱只读检查后控制台没有脚本或图片加载异常", !report.console);
      report.status = "pass";
    } else {
      const cards = await h.data("screen.run.hand");
      const eligible = cards.filter(card => card.playable && (family && family !== "all" ? card.ownerId === family : !card.description.includes("伤害") && ["self", "ally", "party", "allAllies"].includes(card.target)));
      const card = eligible.find(item => !item.description.includes("伤害")) || eligible[0];
      assert(card, "当前没有指定伙伴可用的观察牌，不强行注入或推进回合");
      const expectedActionImage = card.portrait && card.portrait.image ? card.portrait.image : imageFor({ id: card.ownerId }, before.adventure.active.regionId, card.portrait && card.portrait.actionState || "attack");
      report.card = { uid: card.uid, name: card.name, ownerId: card.ownerId, cost: card.cost, expectedActionImage };
      await h.tap(`.hand-card[data-uid="${card.uid}"]`, ".hand-scroll", true);
      if (card.target === "ally") await h.tap(`.ally-unit[data-id="${card.ownerId}"]`);
      if (card.target === "enemy") {
        const enemies = await h.data("screen.run.enemies");
        const target = enemies.filter(enemy => enemy.hp > 0).sort((a, b) => b.hp - a.hp)[0];
        assert(target, "没有可选目标");
        await h.tap(`.enemy-unit[data-id="${target.id}"]`);
        report.targetId = target.id;
      }
      const preview = await h.data("screen.preview");
      h.check("实际预览允许出牌", preview.allowed);
      report.preview = preview;
      assert(!preview.events.some(event => ["reward", "finish"].includes(event.kind)), "观察牌会结束战斗，保留选择不实际出牌");
      const beforePlay = await h.state();
      const observed = await observePlay(".confirm-play", 220, 420);
      report.samples = observed.samples;
      h.check("真实动作进入busy观察窗", observed.busySeen);
      const afterPlay = await h.state();
      assert(afterPlay.adventure.active && afterPlay.adventure.active.phase === "battle", "实际动作应继续留在本场战斗");
      report.after = { plays: afterPlay.adventure.active.plays, energy: afterPlay.adventure.active.energy, threads: afterPlay.adventure.threads, tickets: afterPlay.tickets };
      h.check("只完成一次真实出牌", afterPlay.adventure.active.plays === beforePlay.adventure.active.plays + 1);
      h.check("没有改变永久伙伴或已入库资源", JSON.stringify(afterPlay.collection) === JSON.stringify(before.collection) && afterPlay.adventure.threads === before.adventure.threads && afterPlay.tickets === before.tickets);
      h.check("运行时节点切换到当前施法者的动作图片", report.samples.some(sample => sample.nodes.some(node => node.src === expectedActionImage)));
      const animated = report.samples.flatMap(sample => sample.nodes.filter(node => node.kind === "ally-art" && node.animationName && node.animationName !== "none").map(node => node.transform));
      h.check("实际动作节点出现animation transform变化", new Set(animated).size > 1 && animated.some(value => value && value !== "none"));
      const resting = await h.data("screen.run.party");
      h.check("观察结束后恢复结算后的正常姿态", resting.every(unit => !unit.acting && (unit.actionState === "idle" || STATES.includes(unit.actionState))));
      await h.shot("after-cast");
      report.console = await h.inspectConsole();
      h.check("页面脚本与图片加载异常过滤为空", !report.console);
      report.status = "pass";
    }
  } catch (error) { report.status = "fail"; report.error = error.message; process.exitCode = 1; console.error(error.message); }
  finally { fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2)); console.log(`姿态观察 ${report.status}: ${out}`); }
})();

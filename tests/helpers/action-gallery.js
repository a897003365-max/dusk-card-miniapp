"use strict";

const assert = require("assert");
const { STATES, GROUPS, BOSSES, imageFor } = require("../../utils/action-art");

const FAMILY_IDS = Object.values(GROUPS).flat();

async function inspectPreviewImage(h) {
  return h.evaluate(function () {
    return new Promise(resolve => {
      const query = wx.createSelectorQuery();
      query.select(".inspected-action-image").fields({ rect: true, size: true, properties: ["src"] });
      query.select(".inspected-action-image >>> .action-image").fields({ rect: true, size: true, properties: ["src"] });
      query.exec(rows => resolve(rows.filter(Boolean).map(item => ({
        src: item.src || "",
        width: item.width || (item.rect && item.rect.width) || 0,
        height: item.height || (item.rect && item.rect.height) || 0,
        rect: item.rect || null,
      }))));
    });
  });
}

async function closeOpenSheet(h) {
  const sheet = await h.evaluate(function () {
    const page = getCurrentPages().slice(-1)[0];
    return page && page.data && page.data.screen ? page.data.screen.sheet || "" : "";
  });
  if (sheet) await h.tap(".close");
}

async function inspectUnit(h, { id, kind, region, report }) {
  await closeOpenSheet(h);
  await h.tap(`.${kind}-unit[data-id="${id}"]`);
  const sheet = await h.data("screen.sheet");
  const inspected = await h.data("screen.inspected");
  h.check(`${kind} ${id}打开只读详情`, sheet === kind && inspected && inspected.id === id);
  assert(inspected && inspected.hasActionArt, `${kind} ${id}没有动作图谱`);

  const choices = await h.data("screen.poseChoices");
  h.check(`${kind} ${id}公开展示8个姿态按钮`, JSON.stringify(choices.map(item => item.id)) === JSON.stringify(STATES));
  const targetReport = { id, kind, poses: [], evidenceShots: [] };

  for (const pose of STATES) {
    await h.tap(`.pose-choice[data-pose="${pose}"]`, ".dialog-scroll");
    const preview = await h.data("screen.inspectedPreview");
    const nodes = await inspectPreviewImage(h);
    const expected = imageFor(inspected, region, pose);
    const actual = nodes.find(node => node.src) || null;
    const validNode = actual && actual.src === expected && actual.width >= 44 && actual.height >= 44;
    h.check(`${kind} ${id} ${pose}预览与实际图片节点一致`, preview && preview.actionState === pose && preview.image === expected && validNode);
    targetReport.poses.push({
      pose,
      inspectedPreview: preview ? { actionState: preview.actionState, image: preview.image, label: preview.actionLabel } : null,
      actualImage: actual,
      nodes,
    });
    if (pose === "attack" || pose === "control") {
      const shotName = `gallery-${kind}-${id}-${pose}`;
      await h.shot(shotName);
      targetReport.evidenceShots.push(shotName);
    }
  }

  await h.tap(".pose-current", ".dialog-scroll");
  const current = await h.data("screen.inspectedPreview");
  h.check(`${kind} ${id}当前姿态恢复而不硬断言idle`, current && current.actionState === inspected.actionState && current.image === inspected.image);
  targetReport.currentPose = current ? { actionState: current.actionState, image: current.image } : null;
  await h.tap(".close");
  h.check(`${kind} ${id}关闭动作图谱`, (await h.data("screen.sheet")) === "");
  report.gallery.push(targetReport);
}

async function inspectGallery(h, { family, region, report }) {
  const before = await h.state();
  const beforeStorage = await h.evaluate(function () {
    return JSON.stringify(wx.getStorageSync(getApp().storageKey));
  });
  const party = await h.data("screen.run.party");
  const enemies = await h.data("screen.run.enemies");
  const ally = family && family !== "all"
    ? party.find(unit => (unit.definitionId || unit.id) === family)
    : party.find(unit => unit.hasActionArt);
  const boss = enemies.find(enemy => enemy.rank === "boss" && (enemy.hasActionArt || BOSSES.includes(enemy.definitionId)))
    || enemies.find(enemy => enemy.hasActionArt || BOSSES.includes(enemy.definitionId));
  assert(ally, family && family !== "all" ? `当前队伍没有 ${family}，不注入或替换伙伴` : "当前队伍没有可查看动作图谱的伙伴");
  report.galleryScope = boss ? "ally+boss" : "ally-only-no-boss";
  report.galleryBossSkipped = !boss;
  await inspectUnit(h, { id: ally.id, kind: "ally", region, report });
  if (boss) await inspectUnit(h, { id: boss.id, kind: "enemy", region, report });
  const after = await h.state();
  const afterStorage = await h.evaluate(function () {
    return JSON.stringify(wx.getStorageSync(getApp().storageKey));
  });
  h.check("动作图谱不改变内存存档或RNG", JSON.stringify(after) === JSON.stringify(before));
  h.check("动作图谱不改变持久化存档或RNG", afterStorage === beforeStorage);
  report.galleryBefore = before;
  report.galleryAfter = after;
  report.galleryStorageUnchanged = afterStorage === beforeStorage;
}

module.exports = { FAMILY_IDS, STATES, closeOpenSheet, inspectGallery, inspectPreviewImage };

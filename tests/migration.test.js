"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const game = require("../utils/game");
const combat = require("../utils/combat");
const { FAMILIES, TIERS, CHAPTERS } = require("../utils/content");

const KEY = "dusk-letter-rpg-v1";
const BACKUP_KEY = KEY + "-pre-adventure-v2";
const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const clone = value => JSON.parse(JSON.stringify(value));

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function asLegacy(state = game.createState()) {
  const saved = clone(state);
  saved.version = 1;
  delete saved.adventure;
  return saved;
}

function finishChapter(state, chapterId) {
  let next = game.startJourney(state, chapterId);
  for (let i = 0; i < 3; i += 1) next = game.continueJourney(game.choose(next, "a"));
  return next;
}

function richLegacyJourney() {
  let state = game.createState();
  FAMILIES.forEach((family, index) => {
    TIERS.forEach((tier, tierIndex) => { state.collection[family.id][tier] = index + tierIndex + 1; });
  });
  state = game.saveTeam(state, ["tea", "moon", "ramen"]);
  state = finishChapter(state, "letter");
  state = finishChapter(state, "station");
  state = game.startJourney(state, "garden");
  state = game.continueJourney(game.choose(state, "a"));
  state = game.choose(state, "b");
  state.tickets = 127;
  state.drawCount = 481;
  state.pitySSR = 9;
  state.pityUR = 39;
  state.legacyNote = { text: "保留旧版本的额外记录" };
  return asLegacy(state);
}

function launch(saved, { failAt = null, failAfterWrite = false, key = KEY, source = appSource } = {}) {
  const store = new Map([[key, clone(saved)]]);
  const calls = [];
  let app;
  vm.runInNewContext(source, {
    require(name) {
      if (name === "./utils/audio") return require("../utils/audio");
      assert.equal(name, "./utils/game");
      return game;
    },
    App(definition) { app = definition; },
    wx: {
      getStorageSync(storageKey) {
        if (storageKey === key + '-audio') return '';
        assert.equal(storageKey, key);
        return store.has(storageKey) ? clone(store.get(storageKey)) : "";
      },
      setStorageSync(storageKey, value) {
        calls.push({ key: storageKey, value: clone(value) });
        if (storageKey === failAt && !failAfterWrite) throw new Error("disk unavailable");
        store.set(storageKey, clone(value));
        if (storageKey === failAt) throw new Error("write result unavailable");
      }
    }
  }, { filename: "app.js" });
  app.onLaunch();
  return { app, store, calls };
}

test("新存档是v2，冒险默认数据完整且各次创建互不共享", () => {
  const first = game.createState();
  const second = game.createState();
  assert.equal(first.version, 2);
  assert.deepEqual(first.adventure, combat.createAdventureProfile());
  assert.equal(first.adventure.threads, 0);
  assert.equal(first.adventure.active, null);
  assert.equal(first.adventure.lastResult, null);
  assert.deepEqual(Object.keys(first.adventure.levels).sort(), FAMILIES.map(item => item.id).sort());
  first.adventure.levels.sheep = 5;
  first.adventure.clears.street[0] = 1;
  assert.equal(second.adventure.levels.sheep, 1);
  assert.deepEqual(second.adventure.clears.street, [0, 0, 0]);
  assert.equal(game.assertState(second), second);
});

test("合法v1完整迁移收藏、保底、途中剧情快照和额外字段，不修改原对象", () => {
  const saved = freeze(richLegacyJourney());
  const before = JSON.stringify(saved);
  const next = game.migrateState(saved);
  assert.notEqual(next, saved);
  assert.equal(next.version, 2);
  assert.deepEqual(asLegacy(next), saved);
  assert.equal(next.tickets, 127);
  assert.equal(next.pitySSR, 9);
  assert.equal(next.pityUR, 39);
  assert.equal(next.journey.chapterId, "garden");
  assert.equal(next.journey.sceneIndex, 1);
  assert.equal(next.journey.pending.choiceId, "b");
  assert.deepEqual(next.adventure, combat.createAdventureProfile());
  assert.equal(JSON.stringify(saved), before);
  assert.equal(game.assertState(next), next);
  const continued = game.continueJourney(next);
  assert.equal(continued.journey.sceneIndex, 2);
  assert.equal(continued.journey.pending, null);
  assert.equal(JSON.stringify(saved), before);
});

test("v1未关闭的章节结局及奖励原样保留，迁移不重复发放邮票", () => {
  const completed = finishChapter(game.createState(), CHAPTERS[0].id);
  const saved = freeze(asLegacy(completed));
  const next = game.migrateState(saved);
  assert.deepEqual(next.lastEnding, saved.lastEnding);
  assert.deepEqual(next.endings, saved.endings);
  assert.equal(next.tickets, saved.tickets);
  assert.throws(() => game.continueJourney(next), /没有进行中的旅程/);
});

test("v2迁移接口返回原对象，已有冒险等级、星线和进度不重建", () => {
  const state = game.createState();
  state.adventure.threads = 35;
  state.adventure.levels.sheep = 3;
  state.adventure.clears.street = [2, 1, 0];
  const active = combat.startExpedition(state, "bridge", 0, 12345).state;
  const before = JSON.stringify(active);
  assert.equal(game.migrateState(freeze(active)), active);
  assert.equal(JSON.stringify(active), before);
  const { app, calls } = launch(active);
  assert.deepEqual(clone(app.state), active);
  assert.deepEqual(calls, []);
});

test("迁移必须先保存完整v1备份，再写同一个主KEY，全部成功才开放状态", () => {
  const saved = richLegacyJourney();
  const { app, store, calls } = launch(saved);
  assert.equal(app.storageError, "");
  assert.equal(app.state.version, 2);
  assert.deepEqual(calls.map(call => call.key), [BACKUP_KEY, KEY]);
  assert.deepEqual(store.get(BACKUP_KEY), saved);
  assert.deepEqual(asLegacy(store.get(KEY)), saved);
  assert.deepEqual(clone(app.state), store.get(KEY));
});

test("备份失败时不尝试主写、不开新档，原收藏与进度保持不动", () => {
  const saved = richLegacyJourney();
  const { app, store, calls } = launch(saved, { failAt: BACKUP_KEY });
  assert.equal(app.state, null);
  assert.match(app.storageError, /备份失败.*已保留原存档/);
  assert.deepEqual(calls.map(call => call.key), [BACKUP_KEY]);
  assert.deepEqual(store.get(KEY), saved);
  assert.equal(store.has(BACKUP_KEY), false);
  assert.throws(() => app.commit(game.createState()), /备份失败/);
  assert.equal(calls.length, 1);
});

test("主写失败时保留原主档和完整备份，state保持null并阻止后续提交", () => {
  const saved = richLegacyJourney();
  const { app, store, calls } = launch(saved, { failAt: KEY });
  assert.equal(app.state, null);
  assert.match(app.storageError, /升级保存失败.*已保留升级前备份/);
  assert.deepEqual(store.get(KEY), saved);
  assert.deepEqual(store.get(BACKUP_KEY), saved);
  assert.deepEqual(calls.map(call => call.key), [BACKUP_KEY, KEY]);
  assert.throws(() => app.commit(game.createState()), /升级保存失败/);
  assert.equal(calls.length, 2);
});

test("主写结果不确定也不开放内存状态，原始v1仍能从备份取回", () => {
  const saved = richLegacyJourney();
  const { app, store, calls } = launch(saved, { failAt: KEY, failAfterWrite: true });
  assert.equal(app.state, null);
  assert.match(app.storageError, /升级保存失败/);
  assert.deepEqual(store.get(BACKUP_KEY), saved);
  assert.equal(store.get(KEY).version, 2);
  assert.equal(calls.length, 2);
  const reopened = launch(store.get(KEY));
  assert.equal(reopened.app.state.version, 2);
  assert.deepEqual(reopened.calls, []);
});

test("坏v1、未知版本和冲突冒险字段不迁移，备份与主档都不覆盖", () => {
  const badCollection = asLegacy();
  delete badCollection.collection.sheep.SR;
  const badPity = asLegacy();
  badPity.pityUR = 40;
  const badJourney = richLegacyJourney();
  badJourney.journey.pending.score += 1;
  const conflict = { ...asLegacy(), adventure: { threads: 99 } };
  const unknown = { ...asLegacy(), version: 99 };
  for (const saved of [badCollection, badPity, badJourney, conflict, unknown, null, false, 0]) {
    const before = JSON.stringify(saved);
    assert.throws(() => game.migrateState(freeze(saved)), /已保留原存档/);
    const { app, store, calls } = launch(saved);
    assert.equal(app.state, null);
    assert.match(app.storageError, /已保留/);
    assert.deepEqual(calls, []);
    assert.deepEqual(store.get(KEY), saved);
    assert.equal(JSON.stringify(saved), before);
  }
});

test("损坏v2冒险字段不得以默认值修复覆盖", () => {
  const mutations = [
    state => { delete state.adventure; },
    state => { state.adventure = null; },
    state => { state.adventure.threads = -1; },
    state => { state.adventure.levels.sheep = 0; },
    state => { state.adventure.clears.street = [0]; },
    state => { state.adventure.active = {}; },
  ];
  for (const mutate of mutations) {
    const saved = game.createState();
    mutate(saved);
    assert.throws(() => game.migrateState(freeze(saved)), /已保留原存档/);
    const { app, store, calls } = launch(saved);
    assert.equal(app.state, null);
    assert.deepEqual(calls, []);
    assert.deepEqual(store.get(KEY), saved);
  }
});

test("隔离副本只替换主KEY，迁移备份KEY随之派生而不写真实存档", () => {
  const key = KEY + "-migration-test";
  const source = appSource.replace("'dusk-letter-rpg-v1'", JSON.stringify(key));
  const saved = asLegacy();
  const { app, store, calls } = launch(saved, { key, source });
  assert.equal(app.state.version, 2);
  assert.deepEqual(calls.map(call => call.key), [key + "-pre-adventure-v2", key]);
  assert.equal(store.has(KEY), false);
  assert.equal(store.has(BACKUP_KEY), false);
});

test("主线和副本双向互斥，远行中禁止换队，结束远行后恢复原玩法", () => {
  const state = game.createState();
  const expedition = freeze(combat.startExpedition(state, "street", 0, 24680).state);
  const before = JSON.stringify(expedition);
  assert.throws(() => game.startJourney(expedition, "letter"), /当前远行/);
  assert.throws(() => game.saveTeam(expedition, ["nav", "sheep", "orangecat"]), /当前远行/);
  assert.equal(JSON.stringify(expedition), before);
  const story = freeze(game.startJourney(state, "letter"));
  assert.throws(() => combat.startExpedition(story, "street", 0, 13579), /当前的故事或远行/);
  const invalidBoth = { ...expedition, journey: story.journey };
  assert.throws(() => game.assertState(invalidBoth), /已保留原存档/);
  const ended = combat.applyAction(expedition, { type: "abandon" }).state;
  assert.equal(ended.adventure.active, null);
  const started = game.startJourney(ended, "letter");
  assert.equal(started.journey.chapterId, "letter");
  assert.equal(game.assertState(started), started);
});

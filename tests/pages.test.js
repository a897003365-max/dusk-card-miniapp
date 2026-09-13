const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const game = require('../utils/game');
const { FAMILIES, CHAPTERS } = require('../utils/content');
const { getRevealProfile } = require('../utils/summon');
const { createAudioMock } = require('./helpers/fake-audio');

const clone = value => JSON.parse(JSON.stringify(value));
const event = (key, value) => ({ currentTarget: { dataset: { [key]: value } } });

// 只验证页面事件与实际存档之间的边界，不模拟节点、布局或原生 UI 验收。
function loadPage(name, { saved = game.createState(), writeError = null, navigationError = null } = {}) {
  let app;
  let page;
  const writes = [];
  const notices = [];
  const navigation = [];
  const calls = { commit: 0 };
  const timers = new Map();
  let now = 0;
  let nextTimer = 1;
  const context = vm.createContext({
    App(definition) { app = definition; },
    Page(definition) { page = definition; },
    getApp() { return app; },
    setTimeout(callback, delay) { const id = nextTimer++; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    wx: {
      ...createAudioMock(),
      getStorageSync(key) { return key.endsWith('-audio') ? '' : clone(saved); },
      setStorageSync(key, value) {
        assert.equal(key, 'dusk-letter-rpg-v1');
        if (writeError) throw writeError;
        writes.push(clone(value));
      },
      showToast(value) { notices.push(value); },
      switchTab(options) {
        navigation.push(options.url);
        if (navigationError && options.fail) options.fail({ errMsg: navigationError.message });
      }
    }
  });
  function execute(relative) {
    const filename = path.join(__dirname, '..', relative);
    vm.runInContext(`(function(require) {\n${fs.readFileSync(filename, 'utf8')}\n})`, context, { filename })(createRequire(filename));
  }
  execute('app.js');
  app.onLaunch();
  const commit = app.commit;
  app.commit = function (state) {
    calls.commit += 1;
    return commit.call(this, state);
  };
  function openPage(pageName) {
    execute(`pages/${pageName}/index.js`);
    page.data = clone(page.data);
    page.setData = function (value) { Object.assign(this.data, value); };
    if (page.onLoad) page.onLoad();
    page.onShow();
    return page;
  }
  openPage(name);
  function advance(milliseconds) {
    const target = now + milliseconds;
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, timer] = next;
      now = timer.at;
      timers.delete(id);
      timer.callback();
    }
    now = target;
  }
  return { app, page, writes, notices, calls, timers, advance, navigation, openPage };
}

test('首页单封抽取真实扣票并仅提交一次，结果打开时重复抽取不结算', () => {
  const { app, page, writes, calls } = loadPage('home');
  page.openLetter(event('count', 1));
  assert.equal(calls.commit, 1);
  assert.equal(writes.length, 1);
  assert.equal(app.state.tickets, 5);
  assert.equal(app.state.drawCount, 1);
  assert.equal(page.data.resultOpen, true);
  assert.equal(page.data.revealedCount, 0);
  assert.equal(page.data.results.length, 1);
  assert.equal(page.data.results[0].revealed, false);
  assert.deepEqual(writes[0], clone(app.state));
  page.openLetter(event('count', 5));
  assert.equal(calls.commit, 1);
  assert.equal(writes.length, 1);
  assert.equal(page.data.results.length, 1);
});

test('分级演出依次经过蓄光/绽放/到达/停留，到达才揭晓且无额外存档', () => {
  const { app, page, writes, calls, advance, timers } = loadPage('home');
  page.openLetter(event('count', 5));
  const saved = clone(app.state);
  assert.equal(app.state.tickets, 1);
  assert.equal(app.state.drawCount, 5);
  assert.equal(page.data.results.length, 5);
  assert.ok(page.data.results.every(card => !card.revealed));
  page.revealLetter(event('serial', 2));
  const profile = page.data.activeReveal.profile;
  assert.equal(page.data.revealPhase, 'charge');
  assert.equal(page.data.revealedCount, 0);
  advance(profile.chargeMs);
  assert.equal(page.data.revealPhase, 'burst');
  assert.equal(page.data.revealedCount, 0);
  advance(profile.burstMs);
  assert.equal(page.data.revealPhase, 'arrive');
  assert.equal(page.data.revealedCount, 1);
  assert.equal(page.data.results[2].revealed, true);
  assert.equal(page.data.results[0].revealed, false);
  advance(profile.arriveMs);
  assert.equal(page.data.revealPhase, 'settled');
  assert.equal(page.data.revealedCount, 1);
  page.revealAll();
  assert.equal(page.data.revealedCount, 5);
  assert.ok(page.data.results.every(card => card.revealed));
  assert.equal(page.data.activeReveal, null);
  assert.equal(timers.size, 0);
  assert.equal(calls.commit, 1);
  assert.equal(writes.length, 1);
  assert.deepEqual(clone(app.state), saved);
});

test('重复点击不能覆盖当前演出，跳过只揭一次，下一封和全部拆开不重复结算', () => {
  const { app, page, writes, calls, timers, advance } = loadPage('home');
  page.openLetter(event('count', 5));
  const saved = clone(app.state);
  page.revealLetter(event('serial', 0));
  page.revealLetter(event('serial', 0));
  page.revealLetter(event('serial', 1));
  for (const serial of [-1, 1.5, 99, 'missing']) page.revealLetter(event('serial', serial));
  assert.equal(page.data.activeReveal.serial, 0);
  assert.equal(page.data.revealedCount, 0);
  page.skipReveal(); page.skipReveal();
  assert.equal(page.data.revealPhase, 'settled');
  assert.equal(timers.size, 0);
  assert.equal(page.data.revealedCount, 1);
  assert.equal(page.data.results.filter(card => card.revealed).length, 1);
  page.nextReveal();
  assert.equal(page.data.activeReveal.serial, 1);
  assert.equal(page.data.revealPhase, 'charge');
  page.revealAll();
  page.revealAll();
  page.revealLetter(event('serial', 0));
  advance(4000);
  assert.equal(page.data.revealedCount, 5);
  assert.equal(page.data.activeReveal, null);
  assert.equal(timers.size, 0);
  assert.equal(calls.commit, 1);
  assert.equal(writes.length, 1);
  assert.deepEqual(clone(app.state), saved);
});

test('未拆即关闭仍保留已入库伙伴，下一批来信重置揭晓状态', () => {
  const { app, page, writes, calls } = loadPage('home');
  page.openLetter(event('count', 1));
  const saved = clone(app.state);
  page.closeResult();
  page.revealLetter(event('serial', 0));
  page.revealAll();
  assert.equal(page.data.resultOpen, false);
  assert.equal(page.data.revealedCount, 0);
  assert.deepEqual(clone(app.state), saved);
  assert.equal(calls.commit, 1);
  page.openLetter(event('count', 5));
  assert.equal(page.data.revealedCount, 0);
  assert.equal(page.data.results.length, 5);
  assert.ok(page.data.results.every(card => !card.revealed));
  assert.equal(app.state.tickets, 0);
  assert.equal(app.state.drawCount, 6);
  page.goCollection();
  assert.equal(page.data.resultOpen, false);
  assert.equal(calls.commit, 2);
  assert.equal(writes.length, 2);
});

test('抽取保存失败时不消费邮票、不打开揭晓，也不留下抽取结果', () => {
  const { app, page, writes, notices, calls, timers } = loadPage('home', { writeError: new Error('storage full') });
  const saved = clone(app.state);
  page.openLetter(event('count', 1));
  assert.equal(calls.commit, 1);
  assert.equal(writes.length, 0);
  assert.deepEqual(clone(app.state), saved);
  assert.equal(page.data.resultOpen, false);
  assert.equal(page.data.results.length, 0);
  assert.equal(page.data.revealedCount, 0);
  assert.equal(page.data.activeReveal, null);
  assert.equal(page.data.revealPhase, 'idle');
  assert.equal(timers.size, 0);
  assert.equal(notices.length, 1);
  assert.match(notices[0].title, /storage full/);
});

test('四档演出确定生成且总时长不超过三秒，粒子光线不消耗抽卡随机数', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'utils', 'summon.js'), 'utf8');
  const module = { exports: {} };
  const math = Object.create(Math);
  math.random = () => { throw new Error('演出不应调用随机数'); };
  vm.runInNewContext(source, { module, Math: math });
  const durations = [];
  for (const tier of ['R', 'SR', 'SSR', 'UR']) {
    const first = module.exports.getRevealProfile(tier);
    assert.deepEqual(clone(first), getRevealProfile(tier));
    assert.equal(first.tier, tier);
    const duration = first.chargeMs + first.burstMs + first.arriveMs;
    durations.push(duration);
    assert.ok(duration > 0 && duration <= 3000);
    assert.ok(first.particles.length >= 10);
    assert.ok(first.particles.every(item => Number.isFinite(item.angle) && item.distance > 0 && item.size > 0 && item.delay >= 0));
    assert.ok(first.rays.every(item => item.length > 0 && item.width > 0));
  }
  assert.ok(durations.every((duration, index) => index === 0 || duration > durations[index - 1]));
  assert.throws(() => getRevealProfile('missing'), /稀有度/);
});

test('关闭/后台/卸载取消演出并保留当前伙伴，回来不重播或多计数', () => {
  for (const method of ['dismissReveal', 'closeResult', 'goCollection', 'onHide', 'onUnload']) {
    const { app, page, writes, timers, advance } = loadPage('home');
    page.openLetter(event('count', 5));
    const saved = clone(app.state);
    page.revealLetter(event('serial', 0));
    page[method]();
    assert.equal(page.data.activeReveal, null, method);
    assert.equal(page.data.revealPhase, 'idle', method);
    assert.equal(page.data.results[0].revealed, true, method);
    assert.equal(page.data.revealedCount, 1, method);
    assert.equal(timers.size, 0, method);
    page.onShow(); advance(4000);
    assert.equal(page.data.revealedCount, 1, method);
    assert.equal(page.data.activeReveal, null, method);
    assert.equal(writes.length, 1, method);
    assert.deepEqual(clone(app.state), saved, method);
  }
});

test('已取消的旧计时回调不能揭晓下一批同编号来信，最后一封之后返回列表', () => {
  const { app, page, writes, timers } = loadPage('home');
  page.openLetter(event('count', 1)); page.revealLetter(event('serial', 0));
  const staleCallbacks = [...timers.values()].map(timer => timer.callback);
  page.closeResult();
  page.openLetter(event('count', 5)); page.revealLetter(event('serial', 0));
  const saved = clone(app.state);
  staleCallbacks.forEach(callback => callback());
  assert.equal(page.data.revealPhase, 'charge');
  assert.equal(page.data.revealedCount, 0);
  for (let index = 0; index < 5; index += 1) { page.skipReveal(); page.nextReveal(); }
  assert.equal(page.data.revealedCount, 5);
  assert.equal(page.data.activeReveal, null);
  assert.equal(page.data.revealPhase, 'idle');
  assert.equal(timers.size, 0);
  assert.equal(writes.length, 2);
  assert.deepEqual(clone(app.state), saved);
});

test('已拥有形态零邮票也能重温，请求只消费一次且返回恢复当前详情形态', () => {
  let roll = 0;
  let saved = game.draw(game.createState(), 5, () => roll++ % 2 === 0 ? 0.7 : 0).state;
  saved = game.draw(saved, 1, () => 0).state;
  assert.equal(saved.tickets, 0);
  const h = loadPage('collection', { saved });
  const collection = h.page;
  collection.openDetail(event('id', 'sheep'));
  assert.equal(collection.data.previewTier, 'SR');
  collection.previewVariant(event('tier', 'R'));
  collection.replayAppearance();
  assert.deepEqual(clone(h.app.replayRequest), { id: 'sheep', tier: 'R' });
  assert.equal(h.navigation.at(-1), '/pages/home/index');
  const home = h.openPage('home');
  assert.equal(h.app.replayRequest, null);
  assert.equal(home.data.replayMode, true);
  assert.equal(home.data.activeReveal.id, 'sheep');
  assert.equal(home.data.activeReveal.tier, 'R');
  assert.equal(home.data.revealPhase, 'charge');
  const token = home._revealToken;
  home.onShow();
  assert.equal(home._revealToken, token);
  assert.equal(h.timers.size, 3);
  home.skipReveal(); home.nextReveal();
  assert.equal(h.navigation.at(-1), '/pages/collection/index');
  collection.onShow();
  assert.equal(collection.data.detail.id, 'sheep');
  assert.equal(collection.data.previewTier, 'R');
  assert.equal(collection._replayReturn, null);
  collection.onShow();
  assert.equal(collection.data.detail, null, '临时返回标记只恢复一次，正常进入仍关闭详情');
  assert.equal(h.calls.commit, 0);
  assert.equal(h.writes.length, 0);
  assert.deepEqual(clone(h.app.state), saved);
});

test('收藏端和首页都重新核验形态所有权，未拥有或失效请求不导航、不写存档', () => {
  for (const [id, tier] of [['sheep', 'SSR'], ['ramen', 'R']]) {
    const h = loadPage('collection');
    h.page.openDetail(event('id', id));
    h.page.previewVariant(event('tier', tier));
    h.page.data.previewOwned = true;
    h.page.replayAppearance();
    assert.equal(h.app.replayRequest, undefined);
    assert.equal(h.navigation.length, 0);
    assert.equal(h.writes.length, 0);
    assert.match(h.notices[0].title, /拥有/);
    h.app.replayRequest = { id, tier };
    const home = h.openPage('home');
    assert.equal(h.app.replayRequest, null);
    assert.equal(home.data.replayMode, false);
    assert.equal(home.data.resultOpen, false);
    assert.equal(home.data.activeReveal, null);
    assert.equal(h.timers.size, 0);
    assert.equal(h.calls.commit, 0);
    assert.deepEqual(clone(h.app.state), game.createState());
  }
});

test('重温导航失败清除请求和返回标记，保留当前详情且不消费资源', () => {
  const h = loadPage('collection', { navigationError: new Error('navigation failed') });
  h.page.openDetail(event('id', 'sheep'));
  h.page.replayAppearance();
  assert.equal(h.app.replayRequest, null);
  assert.equal(h.page._replayReturn, null);
  assert.equal(h.page.data.detail.id, 'sheep');
  assert.equal(h.notices.length, 1);
  assert.match(h.notices[0].title, /暂时无法/);
  assert.equal(h.writes.length, 0);
  assert.equal(h.calls.commit, 0);
});

test('重温返回/X/下一封回收藏，切换其他tab或后台仅关闭UI且不会拉回', () => {
  for (const method of ['backFromReveal', 'exitReveal', 'nextReveal', 'onHide', 'onUnload']) {
    const h = loadPage('home');
    const { page } = h;
    h.app.replayRequest = { id: 'sheep', tier: 'R' };
    page.onShow();
    if (method === 'onHide') page.goStory();
    page[method]();
    assert.equal(page.data.resultOpen, false, method);
    assert.equal(page.data.replayMode, false, method);
    assert.equal(page.data.activeReveal, null, method);
    assert.equal(h.timers.size, 0, method);
    const navigations = [...h.navigation];
    page.onShow(); h.advance(4000);
    assert.deepEqual(h.navigation, navigations, method);
    assert.equal(page.data.activeReveal, null, method);
    if (method === 'onHide') assert.deepEqual(h.navigation, ['/pages/story/index']);
    else if (method === 'onUnload') assert.equal(h.navigation.length, 0);
    else assert.deepEqual(h.navigation, ['/pages/collection/index']);
    assert.equal(h.writes.length, 0, method);
    assert.equal(h.calls.commit, 0, method);
    assert.deepEqual(clone(h.app.state), game.createState(), method);
  }
  const h = loadPage('home');
  h.app.replayRequest = { id: 'sheep', tier: 'R' }; h.page.onShow();
  h.page.closeResult();
  assert.equal(h.navigation.length, 0, 'closeResult只清UI，不导航');
  h.page.openLetter(event('count', 1));
  assert.equal(h.page.data.replayMode, false);
  assert.equal(h.app.state.tickets, 5);
  assert.equal(h.calls.commit, 1);
  h.page.revealLetter(event('serial', 0)); h.page.backFromReveal();
  assert.equal(h.page.data.resultOpen, true, '普通演出返回信封列表');
  h.page.exitReveal();
  assert.equal(h.page.data.resultOpen, false, '普通演出X关闭结果');
  assert.equal(h.navigation.length, 0);
});

test('编队开始选择和取消仅改变面板，不换队也不写入存档', () => {
  const initial = game.createState();
  const index = FAMILIES.findIndex(family => !initial.team.includes(family.id));
  const saved = game.draw(initial, 1, () => (index + 0.5) / FAMILIES.length).state;
  const { app, page, writes, calls } = loadPage('collection', { saved });
  page.openDetail(event('id', FAMILIES[index].id));
  assert.equal(page.data.detail.owned, true);
  assert.equal(page.data.detail.inTeam, false);
  page.beginReplace();
  assert.equal(page.data.replacing, true);
  page.cancelReplace();
  assert.equal(page.data.replacing, false);
  assert.equal(page.data.detail.id, FAMILIES[index].id);
  assert.equal(calls.commit, 0);
  assert.equal(writes.length, 0);
  assert.deepEqual(clone(app.state), saved);
});

test('回看和关闭已收集结局不开始重读、不领奖、不写入存档', () => {
  const chapter = CHAPTERS[0];
  let saved = game.startJourney(game.createState(), chapter.id);
  for (const scene of chapter.scenes) {
    const choice = scene.choices.find(item => item.tone === 'warm');
    saved = game.continueJourney(game.choose(saved, choice.id));
  }
  const { app, page, writes, calls } = loadPage('story', { saved });
  page.openArchive(event('id', chapter.id));
  assert.equal(page.data.archive.title, chapter.title);
  assert.equal(page.data.archive.letters.length, 1);
  assert.equal(page.data.archive.letters[0].text, chapter.endings.warm.text);
  page.closeArchive();
  assert.equal(page.data.archive, null);
  assert.equal(calls.commit, 0);
  assert.equal(writes.length, 0);
  assert.deepEqual(clone(app.state), saved);
});

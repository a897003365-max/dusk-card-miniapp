const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const game = require('../utils/game');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const fresh = game.createState;

function launch({ saved = '', readError = null, writeError = null } = {}) {
  let app;
  const writes = [];
  vm.runInNewContext(source, {
    require(name) {
      if (name === './utils/audio') return require('../utils/audio');
      assert.equal(name, './utils/game');
      return game;
    },
    App(definition) { app = definition; },
    wx: {
      getStorageSync(key) {
        if (key === 'dusk-letter-rpg-v1-audio') return '';
        assert.equal(key, 'dusk-letter-rpg-v1');
        if (readError) throw readError;
        return clone(saved);
      },
      setStorageSync(key, value) {
        assert.equal(key, 'dusk-letter-rpg-v1');
        if (writeError) throw writeError;
        writes.push(clone(value));
      }
    }
  }, { filename: 'app.js' });
  app.onLaunch();
  return { app, writes };
}

test('新旅途正常保存到独立存档，再提交画面状态', () => {
  const { app, writes } = launch();
  assert.deepEqual(clone(app.state), fresh());
  const next = fresh();
  next.tickets = 5;
  next.collection.sheep.R += 1;
  app.commit(next);
  assert.deepEqual(writes, [next]);
  assert.equal(app.state, next);
});

test('已有合法存档直接读取，不在启动时重写', () => {
  const saved = fresh();
  saved.tickets = 12;
  saved.collection.sheep.R = 2;
  const { app, writes } = launch({ saved });
  assert.deepEqual(clone(app.state), saved);
  assert.equal(writes.length, 0);
});

test('重开小程序保留当前回信，继续后正确保存下一幕', () => {
  const saved = game.choose(game.startJourney(fresh(), 'letter'), 'a');
  const { app, writes } = launch({ saved });
  assert.deepEqual(clone(app.state), saved);
  assert.equal(writes.length, 0);
  const next = game.continueJourney(app.state);
  app.commit(next);
  assert.equal(app.state.journey.sceneIndex, 1);
  assert.equal(app.state.journey.pending, null);
  assert.deepEqual(writes, [next]);
});

test('写入失败时原状态不提交，资源与奖励不变化', () => {
  const { app, writes } = launch({ writeError: new Error('storage full') });
  const before = app.state;
  const next = fresh();
  next.tickets = 5;
  next.collection.sheep.R += 1;
  assert.throws(() => app.commit(next), /storage full/);
  assert.equal(app.state, before);
  assert.deepEqual(clone(app.state), fresh());
  assert.equal(writes.length, 0);
});

test('无法识别的存档版本禁止新建覆盖，并保留原记录', () => {
  const saved = { ...fresh(), version: 99 };
  const original = clone(saved);
  const { app, writes } = launch({ saved });
  assert.equal(app.state, null);
  assert.match(app.storageError, /已保留/);
  assert.throws(() => app.commit(fresh()), /已保留/);
  assert.deepEqual(saved, original);
  assert.equal(writes.length, 0);
});

test('损坏存档内容保持只读，禁止静默新建或提交覆盖', () => {
  const missingTickets = fresh();
  delete missingTickets.tickets;
  const missingCollection = fresh();
  delete missingCollection.collection.sheep;
  const brokenJourney = game.startJourney(fresh(), 'letter');
  brokenJourney.journey.chapterId = 'missing';
  for (const saved of [missingTickets, missingCollection, brokenJourney, false, 0, null]) {
    const original = clone(saved);
    const { app, writes } = launch({ saved });
    assert.equal(app.state, null);
    assert.match(app.storageError, /已保留/);
    assert.throws(() => app.commit(fresh()), /已保留/);
    assert.deepEqual(saved, original);
    assert.equal(writes.length, 0);
  }
});

test('读取存档失败时不覆盖存档', () => {
  const { app, writes } = launch({ readError: new Error('read unavailable') });
  assert.equal(app.state, null);
  assert.throws(() => app.commit(fresh()), /read unavailable/);
  assert.equal(writes.length, 0);
});

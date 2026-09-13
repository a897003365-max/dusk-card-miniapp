const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createAudio } = require('../utils/audio');
const { createAudioMock } = require('./helpers/fake-audio');

function mount(options = {}) {
  const sdk = createAudioMock(options), timers = new Map(), writes = [], toasts = [];
  sdk.getStorageSync = () => '';
  sdk.setStorageSync = (key, value) => writes.push({ key, value });
  const audio = createAudio(sdk, 'isolated-audio');
  let definition, serial = 0;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../components/sound-controls/index.js'), 'utf8'), {
    Component(value) { definition = value; }, getApp: () => ({ audio }),
    wx: { showToast(value) { toasts.push(value); } }, console,
    setTimeout(fn) { const id = ++serial; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  const component = { ...definition.methods, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } };
  definition.lifetimes.attached.call(component);
  return { component, definition, audio, sdk, timers, writes, toasts };
}

test('试听能听到的结论不由开关假定，等待实际onPlay并不写入游戏或声音偏好', () => {
  const h = mount({ deferPlay: true });
  h.component.testSound();
  assert(h.component.data.testing);
  assert.equal(h.writes.length, 0);
  h.sdk.contexts[0].emit('play');
  assert.equal(h.component.data.testing, false);
  assert.match(h.component.data.soundMessage, /试听已播放/);
  assert.equal(h.timers.size, 0);
  assert.equal(h.writes.length, 0);
});

test('开启音效主动给试听反馈，关掉后试听按钮不会播放', () => {
  const h = mount();
  h.component.toggleEffects();
  assert.equal(h.component.data.effects, false);
  h.component.testSound();
  assert.equal(h.audio.getStatus().effectStarts, 0);
  h.component.toggleEffects();
  assert.equal(h.component.data.effects, true);
  assert.equal(h.audio.getStatus().effectStarts, 1);
  assert.equal(h.audio.getStatus().lastEffect, 'reward');
  assert(h.writes.every(write => write.key === 'isolated-audio'));
});

test('试听超时明确显示未收到回调，隐藏后迟到反馈不再改界面', () => {
  const h = mount({ deferPlay: true });
  h.component.testSound();
  const timer = [...h.timers.values()][0]; timer();
  assert.equal(h.component.data.testing, false);
  assert.match(h.component.data.soundMessage, /尚未收到播放回调/);
  h.definition.pageLifetimes.hide.call(h.component);
  const before = JSON.stringify(h.component.data);
  h.sdk.contexts[0].emit('play');
  assert.equal(JSON.stringify(h.component.data), before);
  h.definition.pageLifetimes.show.call(h.component);
  assert.equal(h.component.data.soundMessage, '');
});

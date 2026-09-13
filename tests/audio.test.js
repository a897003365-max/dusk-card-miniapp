const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createAudio, battleCue, MUSIC_VOLUME, EFFECT_VOLUME } = require('../utils/audio');
const { MUSIC, EFFECTS } = require('../utils/audio-catalog');
const { createAudioMock } = require('./helpers/fake-audio');
const { createState } = require('../utils/game');
const combat = require('../utils/combat');

function setup(saved, options) {
  const sdk = createAudioMock(options);
  const writes = [];
  sdk.getStorageSync = key => { assert.equal(key, 'test-save-audio'); return saved; };
  sdk.setStorageSync = (key, value) => writes.push({ key, value });
  return { sdk, writes, audio: createAudio(sdk, 'test-save-audio') };
}

test('声音默认安静起步，设置只写独立声音键，同一场景刷新不会重播', () => {
  const { sdk, writes, audio } = setup();
  audio.setScene('town');
  assert.deepEqual(audio.getSettings(), { music: false, effects: true });
  assert.equal(audio.getStatus().contexts, 0);
  assert.equal(writes.length, 0);
  audio.setEnabled('music', true);
  assert.equal(audio.getStatus().musicPlaying, true);
  const started = audio.getStatus().musicStarts;
  audio.setScene('town'); audio.resume(); audio.setScene('town');
  assert.equal(audio.getStatus().musicStarts, started);
  audio.setScene('letter');
  assert.equal(audio.getStatus().musicSrc, MUSIC.letter.src);
  assert.equal(audio.getStatus().contexts, 1);
  assert.deepEqual(writes, [{ key: 'test-save-audio', value: { music: true, effects: true } }]);
  assert.equal(sdk.contexts[0].volume, MUSIC_VOLUME);
  assert.equal(sdk.contexts[0].loop, true);
  assert.equal(sdk.contexts[0].obeyMuteSwitch, false);
  assert.equal(sdk.options[0].obeyMuteSwitch, false);
  assert.equal(sdk.options[0].speakerOn, true);
  assert.equal(sdk.contexts[0].driver.useWebAudioImplement, false);
});

test('效果音最多双声部，音乐和音效能分别关闭', () => {
  const { sdk, audio } = setup({ music: true, effects: true });
  audio.setScene('street');
  for (let i = 0; i < 40; i++) audio.playEffect(i % 2 ? 'attack' : 'hit');
  assert.equal(audio.getStatus().contexts, 3);
  assert.equal(sdk.contexts[1].volume, EFFECT_VOLUME);
  assert.equal(audio.getStatus().effectStarts, 40);
  audio.setEnabled('effects', false);
  audio.playEffect('victory');
  assert.equal(audio.getStatus().effectStarts, 40);
  assert.equal(audio.getStatus().musicPlaying, true);
  audio.setEnabled('music', false);
  assert.equal(audio.getStatus().musicPlaying, false);
  audio.setEnabled('effects', true);
  audio.playEffect('select');
  assert.equal(audio.getStatus().effectStarts, 41);
});

test('模拟器跳过不支持的混音设置接口，音乐仍可正常播放', () => {
  const { sdk, audio } = setup({ music: true, effects: true });
  sdk.getDeviceInfo = () => ({ platform: 'devtools' });
  sdk.setInnerAudioOption = () => { throw Error('unsupported in devtools'); };
  audio.setScene('town');
  assert.equal(audio.getStatus().musicPlaying, true);
  assert.equal(audio.getStatus().lastError, null);
});

test('手机首次播放等待媒体配置完成，配置期间隐藏不得补播声音', () => {
  const { sdk, audio } = setup({ music: true, effects: true }, { deferOptions: true });
  audio.setScene('town');
  const results = [];
  audio.preview(result => results.push(result));
  assert.equal(sdk.options.length, 1);
  assert.equal(audio.getStatus().readyState, 'loading');
  assert(sdk.contexts.every(context => context.playCount === 0));
  audio.suspend(); sdk.options[0].success();
  assert(sdk.contexts.every(context => context.playCount === 0));
  assert(results[0].cancelled);
  audio.resume();
  assert.equal(sdk.contexts[0].playCount, 1);
  assert.equal(audio.getStatus().effectStarts, 0);
});

test('试听仅在原生播放回调后报成功，媒体配置失败可由主动试听重试', t => {
  t.mock.method(console, 'warn', () => {});
  const { sdk, audio } = setup(undefined, { deferOptions: true, deferPlay: true });
  const results = [];
  audio.preview(result => results.push(result));
  sdk.options[0].fail({ errMsg: 'audio session unavailable' });
  assert.equal(results[0].ok, false);
  audio.playEffect('hit');
  assert.equal(sdk.options.length, 1, '战斗不自动重试配置');
  audio.preview(result => results.push(result));
  assert.equal(sdk.options.length, 2);
  sdk.options[1].success();
  assert.equal(results.length, 1, 'play调用本身不等于播放成功');
  sdk.contexts[0].emit('play');
  assert.equal(results[1].ok, true);
  assert.equal(audio.getStatus().lastError, null);
});

test('通话中断后仅前台恢复音乐，后台接到中断结束不发声', () => {
  const { sdk, audio } = setup({ music: true, effects: true });
  audio.setScene('street'); audio.playEffect('attack');
  sdk.interrupt('begin');
  assert(!audio.getStatus().musicPlaying);
  const sounds = audio.getStatus().effectStarts;
  audio.playEffect('hit');
  assert.equal(audio.getStatus().effectStarts, sounds);
  audio.suspend(); sdk.interrupt('end');
  assert(!audio.getStatus().musicPlaying);
  audio.resume();
  assert(audio.getStatus().musicPlaying);
  assert.equal(audio.getStatus().effectStarts, sounds);
  sdk.contexts[0].pause();
  audio.setScene('street');
  assert(audio.getStatus().musicPlaying, '同场景刷新可恢复意外暂停的音乐');
});

test('切后台及延迟播放回调不能重新发声，回前台只恢复当前音乐', () => {
  const { sdk, audio } = setup({ music: true, effects: true }, { deferPlay: true });
  audio.setScene('bridge'); audio.playEffect('attack');
  audio.suspend();
  const counts = sdk.contexts.map(context => context.stopCount);
  sdk.contexts.forEach(context => context.emit('play'));
  assert.equal(audio.getStatus().musicPlaying, false);
  assert.equal(audio.getStatus().effectStarts, 0);
  sdk.contexts.forEach((context, i) => assert(context.stopCount > counts[i]));
  audio.setScene('market'); audio.playEffect('hit');
  assert.equal(audio.getStatus().scene, 'market');
  audio.resume(); sdk.contexts[0].emit('play');
  assert.equal(audio.getStatus().musicSrc, MUSIC.market.src);
  assert.equal(audio.getStatus().musicPlaying, true);
  assert.equal(audio.getStatus().effectStarts, 0);
  audio.destroy();
  assert.equal(audio.getStatus().contexts, 0);
});

test('声音设置保存失败仍立即静音，播放器错误不会阻止游戏调用', t => {
  t.mock.method(console, 'warn', () => {});
  const { sdk, audio } = setup({ music: true, effects: true });
  audio.setScene('boss'); audio.playEffect('phase');
  sdk.setStorageSync = () => { throw Error('disk full'); };
  assert.equal(audio.setEnabled('music', false), false);
  assert.equal(audio.setEnabled('effects', false), false);
  assert.deepEqual(audio.getSettings(), { music: false, effects: false });
  assert.equal(audio.getStatus().musicPlaying, false);
  sdk.contexts[0].emit('error', { errMsg: 'audio decode failed' });
  assert.equal(audio.getStatus().lastError.message, 'audio decode failed');
  assert.doesNotThrow(() => {
    audio.setEnabled('effects', true);
    sdk.createInnerAudioContext = () => { throw Error('audio unavailable'); };
    audio.playEffect('heal');
  });
  assert.equal(audio.getStatus().lastError.message, 'audio unavailable');
});

test('真实战斗事件驱动攻防声音，预览及声音选择不推进存档或随机数', () => {
  let state = combat.startExpedition(createState(), 'street', 0, 42).state;
  state = combat.applyAction(state, { type: 'chooseNode', nodeId: state.adventure.active.nodes[0].options[0].id }).state;
  const before = JSON.stringify(state);
  const view = combat.getAdventureView(state).run;
  const card = view.hand.find(item => item.playable && item.target === 'enemy');
  assert(card);
  const action = { type: 'playCard', cardUid: card.uid, targetId: view.enemies[0].id };
  const preview = combat.previewAction(state, action);
  const result = combat.applyAction(state, action);
  assert.equal(battleCue(preview.events, 'action'), battleCue(result.events, 'action'));
  assert.equal(battleCue(result.events, 'action'), 'attack');
  assert.equal(battleCue(result.events, 'impact'), 'hit');
  assert.equal(JSON.stringify(state), before);
  assert.equal(battleCue([{ kind: 'damage', hpDelta: 0, blocked: 9 }], 'impact'), 'guard');
  assert.equal(battleCue([{ kind: 'damage', hpDelta: -10 }, { kind: 'bossPhase' }], 'impact'), 'phase');
  assert.equal(battleCue([{ kind: 'down' }, { kind: 'finish' }], 'impact', { win: true }), 'victory');
  assert.equal(battleCue([{ kind: 'finish' }], 'impact', { win: false }), 'defeat');
  assert.equal(battleCue([{ kind: 'reward' }, { kind: 'draw' }], 'impact'), 'victory');
  assert.equal(battleCue([{ kind: 'chargeRelease', amount: 1 }], 'impact'), 'buff');
});

test('全部场景与事件音频均有本地资源，母稿不进入运行包', () => {
  const root = path.resolve(__dirname, '..');
  const paths = [...Object.values(MUSIC).map(item => item.src), ...Object.values(EFFECTS)];
  assert.equal(paths.length, 22);
  assert.equal(new Set(paths).size, 22);
  for (const src of paths) {
    assert(src.startsWith('/') && src.endsWith('.mp3') && !src.includes('..'));
    const bytes = fs.statSync(path.join(root, src)).size;
    assert(bytes > 300 && bytes < 140 * 1024, src);
  }
  const mainBytes = paths.filter(src => src.startsWith('/assets/')).reduce((total, src) => total + fs.statSync(path.join(root, src)).size, 0);
  assert(mainBytes <= 250 * 1024);
  assert(require('../project.config.json').packOptions.ignore.some(item => item.type === 'folder' && item.value === 'docs'));
});

const { MUSIC, EFFECTS } = require('./audio-catalog');

const DEFAULTS = { music: false, effects: true };
const MUSIC_VOLUME = 0.32;
const EFFECT_VOLUME = 0.75;

// 每个节拍只选一种主要反馈，防止群体攻击或连击叠出过大的音量。
function battleCue(events, beat, outcome) {
  const has = kind => events.some(event => event.kind === kind);
  if (beat === 'action') {
    if (events.some(event => event.kind === 'enemyAction' && event.intentKind === 'attack')) return 'attack';
    if (has('playCard')) return has('damage') ? 'attack' : 'card';
    if (events.some(event => event.kind === 'enemyAction' && event.intentKind === 'block')) return 'guard';
    if (has('enemyAction')) return 'debuff';
  }
  if (beat === 'impact') {
    if (has('finish') && outcome) return outcome.win ? 'victory' : 'defeat';
    if (has('reward')) return 'victory';
    if (has('bossPhase')) return 'phase';
    if (events.some(event => event.hpDelta < 0)) return 'hit';
    if (events.some(event => event.hpDelta > 0)) return 'heal';
    if (events.some(event => event.blocked > 0) || has('block')) return 'guard';
    if (has('weak') || has('burn') || has('mark') || has('stripBlock')) return 'debuff';
    if (has('counter') || has('echo') || has('retainBlock') || has('energy') || has('charge') || has('chargeRelease') || has('cleanse') || has('intercept') || has('environment')) return 'buff';
    if (has('draw') || has('shuffle')) return 'shuffle';
  }
  return '';
}

function createAudio(platform, preferenceKey) {
  let settings = { ...DEFAULTS };
  let foreground = true, interrupted = false;
  let scene = '', music = null, musicRequested = false, musicPending = false, musicPlaying = false;
  let nextVoice = 0, musicStarts = 0, effectStarts = 0, lastEffect = '';
  let readyState = 'idle', lastError = null;
  const voices = [];

  function fail(channel, error) {
    lastError = { channel, message: error.errMsg || error.message || String(error) };
    console.warn('game-audio-error', lastError);
  }
  function attempt(channel, action) {
    try { return action(); }
    catch (error) { fail(channel, error); return null; }
  }
  function notify(voice, result) {
    const callback = voice.callback;
    voice.callback = null;
    if (callback) attempt('preview-feedback', () => callback(result));
  }
  try {
    const saved = platform.getStorageSync(preferenceKey);
    if (saved && typeof saved === 'object') settings = { music: saved.music === true, effects: saved.effects !== false };
  } catch (error) { fail('settings-read', error); }

  function context(channel) {
    // setInnerAudioOption 不兼容 WebAudio 驱动，手机短音也统一使用原生播放器。
    const value = platform.createInnerAudioContext({ useWebAudioImplement: false });
    value.autoplay = false;
    value.obeyMuteSwitch = false;
    value.volume = channel === 'music' ? MUSIC_VOLUME : EFFECT_VOLUME;
    return value;
  }
  function stopMusic() {
    musicRequested = false; musicPending = false; musicPlaying = false;
    if (music) attempt('music-stop', () => music.stop());
  }
  function stopEffects() {
    voices.forEach(voice => {
      voice.active = false; voice.pending = false;
      attempt('effect-stop', () => voice.context.stop());
      notify(voice, { ok: false, cancelled: true, message: '播放已停止' });
    });
  }
  function playReadyMusic() {
    if (readyState !== 'ready' || !foreground || interrupted || !settings.music || !music || !musicPending) return;
    musicPending = false;
    try { music.play(); }
    catch (error) { musicRequested = false; fail('music', error); }
  }
  function playReadyVoice(voice) {
    if (readyState !== 'ready' || !foreground || interrupted || !settings.effects || !voice.active || !voice.pending) return;
    voice.pending = false;
    try { voice.context.play(); }
    catch (error) { voice.active = false; fail('effect:' + voice.id, error); notify(voice, { ok: false, message: lastError.message }); }
  }
  function preparationFailed(error) {
    readyState = 'failed';
    fail('audio-option', error);
    musicRequested = false; musicPending = false;
    voices.forEach(voice => { voice.active = false; voice.pending = false; notify(voice, { ok: false, message: lastError.message }); });
  }
  function prepareAudio() {
    if (readyState === 'ready') return true;
    if (readyState === 'loading' || readyState === 'failed') return false;
    // 模拟器不支持此配置；真实设备先成功设置媒体播放，再开始声音，避免首声仍被静音。
    if (platform.getDeviceInfo().platform === 'devtools') { readyState = 'ready'; return true; }
    readyState = 'loading';
    try {
      platform.setInnerAudioOption({ obeyMuteSwitch: false, speakerOn: true, mixWithOther: false,
        success() {
          readyState = 'ready';
          if (lastError && lastError.channel === 'audio-option') lastError = null;
          playReadyMusic(); voices.forEach(playReadyVoice);
        },
        fail: preparationFailed
      });
    } catch (error) { preparationFailed(error); }
    return false;
  }
  function startMusic() {
    if (!foreground || interrupted || !settings.music || !MUSIC[scene] || musicRequested) return;
    attempt('music', () => {
      if (!music) {
        music = context('music'); music.loop = true;
        music.onPlay(() => {
          if (!foreground || interrupted || !settings.music || !musicRequested) { stopMusic(); return; }
          musicPlaying = true; musicStarts += 1;
        });
        music.onPause(() => { musicPlaying = false; musicRequested = false; });
        music.onStop(() => { musicPlaying = false; });
        music.onError(error => { musicPlaying = false; musicRequested = false; fail('music', error); });
      }
      if (music.src !== MUSIC[scene].src) { stopMusic(); music.src = MUSIC[scene].src; }
      musicRequested = true; musicPending = true;
      if (prepareAudio()) playReadyMusic();
    });
  }
  function playEffect(id, callback) {
    if (!foreground || interrupted || !settings.effects || !EFFECTS[id]) {
      if (callback) callback({ ok: false, message: !settings.effects ? '请先开启音效' : '声音暂时不可播放' });
      return;
    }
    try {
      const index = nextVoice++ % 2;
      if (!voices[index]) {
        const voice = { context: context('effect'), active: false, pending: false, id: '', callback: null };
        voice.context.loop = false;
        voice.context.onPlay(() => {
          if (!foreground || interrupted || !settings.effects || !voice.active) { attempt('effect-stop', () => voice.context.stop()); return; }
          effectStarts += 1; lastEffect = voice.id;
          notify(voice, { ok: true, id: voice.id });
        });
        voice.context.onEnded(() => { voice.active = false; });
        voice.context.onError(error => { voice.active = false; fail('effect:' + voice.id, error); notify(voice, { ok: false, message: lastError.message }); });
        voices[index] = voice;
      }
      const voice = voices[index];
      notify(voice, { ok: false, cancelled: true, message: '试听已被新音效替换' });
      voice.active = false; voice.context.stop();
      voice.context.src = EFFECTS[id]; voice.id = id; voice.callback = callback;
      voice.active = true; voice.pending = true;
      if (readyState === 'failed') { voice.active = false; voice.pending = false; notify(voice, { ok: false, message: lastError.message }); }
      else if (prepareAudio()) playReadyVoice(voice);
    } catch (error) { fail('effect:' + id, error); if (callback) callback({ ok: false, message: lastError.message }); }
  }
  function interruptionBegin() { interrupted = true; stopMusic(); stopEffects(); }
  function interruptionEnd() { interrupted = false; startMusic(); }
  if (platform.onAudioInterruptionBegin) platform.onAudioInterruptionBegin(interruptionBegin);
  if (platform.onAudioInterruptionEnd) platform.onAudioInterruptionEnd(interruptionEnd);

  return {
    setScene(id) {
      if (!MUSIC[id]) return;
      if (scene !== id) { stopMusic(); scene = id; }
      startMusic();
    },
    playEffect,
    preview(callback) {
      // 仅用户主动试听允许重试失败的系统音频配置，不在战斗事件中自动重试。
      if (readyState === 'failed') readyState = 'idle';
      playEffect('reward', callback);
    },
    playBattle(events, beat, outcome) { const cue = battleCue(events, beat, outcome); if (cue) playEffect(cue); },
    stopEffects,
    getSettings() { return { ...settings }; },
    setEnabled(kind, enabled) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, kind) || typeof enabled !== 'boolean') throw Error('无效声音设置');
      settings = { ...settings, [kind]: enabled };
      if (kind === 'music') { if (enabled) startMusic(); else stopMusic(); }
      else if (!enabled) stopEffects();
      try { platform.setStorageSync(preferenceKey, { ...settings }); return true; }
      catch (error) { fail('settings-save', error); return false; }
    },
    suspend() { foreground = false; stopMusic(); stopEffects(); },
    resume() { foreground = true; startMusic(); },
    destroy() {
      foreground = false; stopMusic(); stopEffects();
      if (platform.offAudioInterruptionBegin) platform.offAudioInterruptionBegin(interruptionBegin);
      if (platform.offAudioInterruptionEnd) platform.offAudioInterruptionEnd(interruptionEnd);
      if (music) attempt('music-destroy', () => music.destroy());
      voices.forEach(voice => attempt('effect-destroy', () => voice.context.destroy()));
      music = null; voices.length = 0;
    },
    getStatus() {
      return { ...settings, foreground, interrupted, readyState, scene, musicSrc: music ? music.src : '', musicPlaying,
        musicTime: music ? music.currentTime : 0, musicStarts, effectStarts, lastEffect,
        contexts: voices.filter(Boolean).length + (music ? 1 : 0), lastError: lastError && { ...lastError } };
    }
  };
}

module.exports = { createAudio, battleCue, DEFAULTS, MUSIC_VOLUME, EFFECT_VOLUME };

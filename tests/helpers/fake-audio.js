// 测试用 SDK：默认同步触发真实接口形状的回调，deferPlay 模拟后台后迟到的事件。
function createAudioMock({ deferPlay = false, deferOptions = false } = {}) {
  const contexts = [], options = [];
  const interruptions = {};
  return {
    contexts, options,
    getDeviceInfo() { return { platform: 'test' }; },
    setInnerAudioOption(value) { options.push(value); if (!deferOptions && value.success) value.success(); },
    onAudioInterruptionBegin(fn) { interruptions.begin = fn; },
    onAudioInterruptionEnd(fn) { interruptions.end = fn; },
    offAudioInterruptionBegin() { delete interruptions.begin; },
    offAudioInterruptionEnd() { delete interruptions.end; },
    interrupt(phase) { if (interruptions[phase]) interruptions[phase](); },
    createInnerAudioContext(driver) {
      const handlers = {};
      const context = {
        driver, src: '', currentTime: 0, paused: true, playCount: 0, stopCount: 0, destroyed: false,
        emit(name, value) { if (handlers[name]) handlers[name](value); },
        onPlay(fn) { handlers.play = fn; },
        onPause(fn) { handlers.pause = fn; },
        onStop(fn) { handlers.stop = fn; },
        onError(fn) { handlers.error = fn; },
        onEnded(fn) { handlers.ended = fn; },
        play() { this.playCount++; this.paused = false; if (!deferPlay) this.emit('play'); },
        pause() { this.paused = true; this.emit('pause'); },
        stop() { this.stopCount++; this.paused = true; this.currentTime = 0; this.emit('stop'); },
        destroy() { this.destroyed = true; this.paused = true; }
      };
      contexts.push(context);
      return context;
    }
  };
}
module.exports = { createAudioMock };

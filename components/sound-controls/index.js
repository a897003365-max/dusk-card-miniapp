Component({
  data: { music: false, effects: true, testing: false, soundMessage: '' },
  lifetimes: {
    attached() { this._visible = true; this.syncSettings(); },
    detached() { this.stopListening(); }
  },
  pageLifetimes: {
    show() { this._visible = true; this.syncSettings(); },
    hide() { this.stopListening(); }
  },
  methods: {
    syncSettings() {
      const audio = getApp().audio;
      if (!audio) return;
      try { this.setData({ ...audio.getSettings(), testing: false, soundMessage: '' }); }
      catch (error) { console.warn('[audio-settings]', error); }
    },
    toggleMusic() { this.toggle('music'); },
    toggleEffects() { this.toggle('effects'); },
    stopListening() {
      this._visible = false;
      clearTimeout(this._soundTimer);
      this._soundTimer = null;
    },
    testSound() {
      const audio = getApp().audio;
      if (!audio || this.data.testing || !this.data.effects) return;
      this.setData({ testing: true, soundMessage: '正在准备试听…' });
      this._soundTimer = setTimeout(() => {
        if (this._visible) this.setData({ testing: false, soundMessage: '尚未收到播放回调，请检查微信版本并重新打开小程序' });
      }, 3500);
      audio.preview(result => {
        clearTimeout(this._soundTimer); this._soundTimer = null;
        if (!this._visible) return;
        this.setData({ testing: false, soundMessage: result.ok ? '试听已播放，声音跟随手机媒体音量' : result.cancelled ? '试听已停止' : '试听失败：' + result.message });
      });
    },
    toggle(kind) {
      const audio = getApp().audio;
      if (!audio) return;
      try {
        clearTimeout(this._soundTimer); this._soundTimer = null;
        this.setData({ testing: false, soundMessage: '' });
        const saved = audio.setEnabled(kind, !this.data[kind]);
        this.setData(audio.getSettings());
        if (saved === false) wx.showToast({ title: '本次已生效，声音设置暂未保存', icon: 'none' });
        if (kind === 'effects' && this.data.effects) this.testSound();
      } catch (error) {
        wx.showToast({ title: error.message || '声音设置未能保存', icon: 'none' });
      }
    }
  }
});

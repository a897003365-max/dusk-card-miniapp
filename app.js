const { createState, migrateState } = require('./utils/game');
const { createAudio } = require('./utils/audio');
const KEY = 'dusk-letter-rpg-v1';
const BACKUP_KEY = KEY + '-pre-adventure-v2';

App({
  storageKey: KEY,
  audio: null,
  onError(message) { console.error('[app-error]', message); },
  onLaunch() {
    this.state = null;
    this.storageError = '';
    try { this.audio = createAudio(wx, KEY + '-audio'); }
    catch (error) { console.warn('[audio-init]', error); this.audio = null; }
    try {
      const saved = wx.getStorageSync(KEY);
      const next = saved === '' ? createState() : migrateState(saved);
      if (saved !== '' && saved.version === 1) {
        try {
          wx.setStorageSync(BACKUP_KEY, saved);
        } catch (error) {
          throw new Error('旧存档备份失败，已保留原存档，暂未开启冒险。' + (error.message || '请检查本地存储后重新打开。'));
        }
        try {
          wx.setStorageSync(KEY, next);
        } catch (error) {
          throw new Error('冒险存档升级保存失败，已保留升级前备份，暂未开启冒险。' + (error.message || '请检查本地存储后重新打开。'));
        }
      }
      this.state = next;
    } catch (error) {
      this.storageError = error.message || '暂时无法读取旅途记录，请重新打开小程序。';
    }
  },
  onShow() { try { if (this.audio) this.audio.resume(); } catch (error) { console.warn('[audio-resume]', error); } },
  onHide() { try { if (this.audio) this.audio.suspend(); } catch (error) { console.warn('[audio-suspend]', error); } },
  commit(next) {
    if (!this.state) throw new Error(this.storageError);
    // 先保存再更新画面；存储失败时邮票与奖励均不结算。
    wx.setStorageSync(KEY, next);
    this.state = next;
  }
});

const game = require('../../utils/game');
const { FAMILIES, CHAPTERS } = require('../../utils/content');
const { getRevealProfile } = require('../../utils/summon');
const { heroes } = require('../../assets/battle/manifest');

function audioEffect(id) {
  try { const audio = getApp().audio; if (audio) audio.playEffect(id); }
  catch (error) { console.warn('[audio-effect]', id, error); }
}
function stopAudio() {
  try { const audio = getApp().audio; if (audio) audio.stopEffects(); }
  catch (error) { console.warn('[audio-stop]', error); }
}

Page({
  data: { showcase: { moon: heroes.moon.idle, orangecat: heroes.orangecat.idle, cloudmail: heroes.cloudmail.idle }, error: '', tickets: 0, owned: 3, pitySSR: 0, pityUR: 0, rulesOpen: false, results: [], resultOpen: false, revealedCount: 0, activeReveal: null, revealPhase: 'idle', replayMode: false },
  onLoad() { this._revealTimers = []; this._revealToken = 0; },
  onShow() {
    try { const audio = getApp().audio; if (audio) audio.setScene('town'); }
    catch (error) { console.warn('[audio-scene]', error); }
    this.refresh();
    const app = getApp();
    const request = app.replayRequest;
    if (!request) return;
    app.replayRequest = null;
    try {
      if (!app.state) throw new Error(app.storageError || '暂时无法读取旅伴记录');
      const family = game.getFamily(app.state, request.id);
      const variant = family.variants.find(item => item.tier === request.tier);
      if (!variant || variant.count <= 0) throw new Error('还没有拥有这枚信印，暂时不能重温');
      this.dismissReveal();
      this.setData({ results: [{ id: family.id, name: family.name, tier: variant.tier, image: variant.image,
        isNewFamily: false, isNewVariant: false, duplicate: false, serial: 0, revealed: false }],
      revealedCount: 0, resultOpen: true, replayMode: true });
      this.revealLetter({ currentTarget: { dataset: { serial: 0 } } });
    } catch (error) { wx.showToast({ title: error.message, icon: 'none' }); }
  },
  onHide() { if (this.data.replayMode) this.closeResult(); else this.dismissReveal(); stopAudio(); },
  onUnload() { if (this.data.replayMode) this.closeResult(); else this.dismissReveal(); stopAudio(); },
  refresh() {
    const app = getApp();
    if (!app.state) return this.setData({ error: app.storageError });
    const state = app.state;
    const chapter = CHAPTERS.find(item => item.id === (state.journey && state.journey.chapterId)) || CHAPTERS[state.cleared.length] || CHAPTERS[0];
    this.setData({ error: '', tickets: state.tickets, pitySSR: state.pitySSR, pityUR: state.pityUR,
      owned: FAMILIES.filter(item => game.getFamily(state, item.id).owned).length,
      chapterTitle: chapter.title,
      journeyLabel: state.journey ? '继续送信' : state.cleared.length === CHAPTERS.length ? '重访晚霞' : '启程送信'
    });
  },
  openLetter(event) {
    if (this.data.resultOpen || this.drawing) return;
    this.drawing = true;
    try {
      const result = game.draw(getApp().state, Number(event.currentTarget.dataset.count));
      getApp().commit(result.state);
      audioEffect('summon');
      this.clearRevealTimers();
      this.setData({ results: result.cards.map((card, serial) => ({ ...card, serial, revealed: false })), revealedCount: 0, resultOpen: true, activeReveal: null, revealPhase: 'idle', replayMode: false });
      this.refresh();
    } catch (error) { wx.showToast({ title: error.message || '未能保存，请稍后再试', icon: 'none' }); }
    finally { this.drawing = false; }
  },
  revealLetter(event) {
    const serial = Number(event.currentTarget.dataset.serial);
    const card = this.data.results[serial];
    if (!this.data.resultOpen || this.data.activeReveal || !Number.isInteger(serial) || !card || card.revealed) return;
    this.clearRevealTimers();
    const profile = getRevealProfile(card.tier);
    const token = this._revealToken;
    this.setData({ activeReveal: { ...card, profile, effectPlayed: false }, revealPhase: 'charge' });
    const phases = [
      { name: 'burst', at: profile.chargeMs },
      { name: 'arrive', at: profile.chargeMs + profile.burstMs },
      { name: 'settled', at: profile.chargeMs + profile.burstMs + profile.arriveMs }
    ];
    this._revealTimers = phases.map(phase => setTimeout(() => {
      if (token !== this._revealToken || !this.data.resultOpen || !this.data.activeReveal || this.data.activeReveal.serial !== serial) return;
      this.showRevealPhase(phase.name);
    }, phase.at));
  },
  clearRevealTimers() {
    this._revealTimers.forEach(timer => clearTimeout(timer));
    this._revealTimers = [];
    this._revealToken += 1;
  },
  showRevealPhase(phase, playSound = false) {
    const active = this.data.activeReveal;
    if (!active) return;
    const patch = { revealPhase: phase };
    if (phase === 'arrive' || phase === 'settled') {
      const results = this.data.results.map(card => card.serial === active.serial ? { ...card, revealed: true } : card);
      patch.results = results;
      patch.revealedCount = results.filter(card => card.revealed).length;
      const shouldPlay = !active.effectPlayed && (phase === 'arrive' || playSound);
      if (shouldPlay) audioEffect(['SSR', 'UR'].includes(active.tier) ? 'rare' : 'reward');
      patch.activeReveal = { ...active, revealed: true, effectPlayed: active.effectPlayed || shouldPlay };
    }
    this.setData(patch);
  },
  skipReveal() {
    if (!this.data.activeReveal) return;
    this.clearRevealTimers();
    this.showRevealPhase('settled', true);
  },
  dismissReveal() {
    this.clearRevealTimers();
    if (this.data.activeReveal) this.showRevealPhase('settled');
    this.setData({ activeReveal: null, revealPhase: 'idle' });
  },
  nextReveal() {
    if (this.data.replayMode) { this.goCollection(); return; }
    this.dismissReveal();
    const next = this.data.results.find(card => !card.revealed);
    if (this.data.resultOpen && next) this.revealLetter({ currentTarget: { dataset: { serial: next.serial } } });
  },
  revealAll() {
    this.clearRevealTimers();
    if (!this.data.resultOpen) return;
    const pending = this.data.results.filter(card => !card.revealed);
    audioEffect(pending.some(card => ['SSR', 'UR'].includes(card.tier)) ? 'rare' : 'reward');
    this.setData({ results: this.data.results.map(card => ({ ...card, revealed: true })), revealedCount: this.data.results.length, activeReveal: null, revealPhase: 'idle' });
  },
  backFromReveal() { if (this.data.replayMode) this.goCollection(); else this.dismissReveal(); },
  exitReveal() { if (this.data.replayMode) this.goCollection(); else this.closeResult(); },
  closeResult() { stopAudio(); this.dismissReveal(); this.setData({ resultOpen: false, replayMode: false }); },
  toggleRules() { this.setData({ rulesOpen: !this.data.rulesOpen }); },
  goStory() { wx.switchTab({ url: '/pages/story/index' }); },
  goCollection() { this.closeResult(); wx.switchTab({ url: '/pages/collection/index' }); },
  noop() {}
});

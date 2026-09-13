const game = require('../../utils/game');
const { FAMILIES, TIER_META } = require('../../utils/content');
const combat = require('../../utils/combat');
const STAT_NAMES = { heart: '爱心', courage: '勇气', insight: '灵感' };
function audioEffect(id) {
  try { const audio = getApp().audio; if (audio) audio.playEffect(id); }
  catch (error) { console.warn('[audio-effect]', id, error); }
}
function stopAudio() {
  try { const audio = getApp().audio; if (audio) audio.stopEffects(); }
  catch (error) { console.warn('[audio-stop]', error); }
}
Page({
  data: { error: '', filter: 'all', families: [], team: [], detail: null, replacing: false },
  onShow() {
    try { const audio = getApp().audio; if (audio) audio.setScene('town'); }
    catch (error) { console.warn('[audio-scene]', error); }
    const returning = this._replayReturn;
    this._replayReturn = null;
    this.setData({ detail: null, replacing: false });
    this.refresh();
    if (returning && getApp().state) {
      this.showFamily(returning.id);
      this.previewVariant({ currentTarget: { dataset: { tier: returning.tier } } });
    }
  },
  onHide() { stopAudio(); },
  onUnload() { stopAudio(); },
  refresh() {
    const app = getApp();
    if (!app.state) return this.setData({ error: app.storageError });
    const state = app.state;
    const all = FAMILIES.map((family, index) => ({ ...game.getFamily(state, family.id), number: String(index + 1).padStart(2, '0'), inTeam: state.team.includes(family.id) }));
    const adventure = combat.getAdventureView(state);
    this.setData({ families: this.data.filter === 'owned' ? all.filter(item => item.owned) : all,
      owned: all.filter(item => item.owned).length, variantsOwned: all.reduce((sum, family) => sum + family.variants.filter(item => item.count > 0).length, 0),
      team: state.team.map(id => game.getFamily(state, id)), stats: game.getTeamStats(state), journeyActive: !!(state.journey || state.adventure.active),
      threads: adventure.threads, battleLevels: adventure.levels });
  },
  setFilter(event) { this.setData({ filter: event.currentTarget.dataset.filter }); this.refresh(); },
  openDetail(event) {
    audioEffect('select');
    this.showFamily(event.currentTarget.dataset.id);
  },
  showFamily(id) {
    const detail = game.getFamily(getApp().state, id);
    detail.traitName = STAT_NAMES[detail.trait];
    detail.inTeam = getApp().state.team.includes(detail.id);
    detail.tierName = TIER_META[detail.tier].name;
    detail.combat = this.data.battleLevels.find(item => item.id === id);
    detail.passive = { name: detail.combat.passiveName, description: detail.combat.passiveDescription };
    detail.cards = detail.combat.cards;
    this.setData({ detail, previewImage: detail.image, previewTier: detail.tier, previewOwned: detail.owned, replacing: false });
  },
  previewVariant(event) {
    const variant = this.data.detail.variants.find(item => item.tier === event.currentTarget.dataset.tier);
    audioEffect('select');
    this.setData({ previewTier: variant.tier, previewImage: variant.image, previewOwned: variant.count > 0 });
  },
  replayAppearance() {
    const app = getApp();
    try {
      if (!this.data.detail) throw new Error('请先选择一位旅伴');
      const family = game.getFamily(app.state, this.data.detail.id);
      const variant = family.variants.find(item => item.tier === this.data.previewTier);
      if (!variant || variant.count <= 0) throw new Error('拥有这枚信印后，就能重温 Ta 的登场');
      const request = { id: family.id, tier: variant.tier };
      app.replayRequest = request;
      this._replayReturn = request;
      wx.switchTab({ url: '/pages/home/index', fail: () => {
        if (app.replayRequest === request) app.replayRequest = null;
        if (this._replayReturn === request) this._replayReturn = null;
        wx.showToast({ title: '暂时无法打开登场回忆，请稍后再试', icon: 'none' });
      } });
    } catch (error) { wx.showToast({ title: error.message, icon: 'none' }); }
  },
  closeDetail() { this.setData({ detail: null, replacing: false }); },
  beginReplace() { this.setData({ replacing: true }); },
  cancelReplace() { this.setData({ replacing: false }); },
  trainPartner() {
    const id = this.data.detail.id;
      try { const result = combat.levelUp(getApp().state, id); getApp().commit(result.state); audioEffect('reward'); this.refresh(); this.showFamily(id); wx.showToast({ title: '伙伴成长了', icon: 'success' }); }
    catch (error) { wx.showToast({ title: error.message, icon: 'none' }); }
  },
  replace(event) {
    try {
      const team = getApp().state.team.map(id => id === event.currentTarget.dataset.id ? this.data.detail.id : id);
      getApp().commit(game.saveTeam(getApp().state, team));
      audioEffect('select');
      this.refresh(); this.closeDetail();
      wx.showToast({ title: '新旅伴已加入', icon: 'success' });
    } catch (error) { wx.showToast({ title: error.message, icon: 'none' }); }
  },
  goHome() { wx.switchTab({ url: '/pages/home/index' }); },
  noop() {}
});

const combat = require('../../utils/combat');
const art = require('../../assets/battle/manifest');
const { loadActionPacks } = require('../../utils/action-avatar');
function audioEffect(id) {
  try { const audio = getApp().audio; if (audio) audio.playEffect(id); }
  catch (error) { console.warn('[audio-effect]', id, error); }
}
function stopAudio() {
  try { const audio = getApp().audio; if (audio) audio.stopEffects(); }
  catch (error) { console.warn('[audio-stop]', error); }
}
const actionLoaders = {
  a: () => require.async('../../package-actors-a/index.js'),
  b: () => require.async('../../package-actors-b/index.js'),
  c: () => require.async('../../package-actors-c/index.js')
};
Page({
  data: { error: '', view: null, selectedRegion: 'street', difficulty: 0, tacticId: 'classic', selected: null, preparing: false },
  onShow() {
    this._visible = true; this._starting = false; this._navigating = false;
    try { const audio = getApp().audio; if (audio) audio.setScene('town'); }
    catch (error) { console.warn('[audio-scene]', error); }
    this.refresh();
  },
  onHide() { this._visible = false; stopAudio(); },
  onUnload() { stopAudio(); },
  refresh() {
    const app = getApp();
    if (!app.state) return this.setData({ error: app.storageError });
    const view = combat.getAdventureView(app.state);
    view.regions = view.regions.map(region => ({ ...region, image: art.scenes[region.id].cover }));
    view.party = view.party.map(member => ({ ...member, image: art.heroes[member.id].idle }));
    const selected = view.regions.find(region => region.id === this.data.selectedRegion);
    const selectedTactic = view.tactics.find(tactic => tactic.id === this.data.tacticId) || view.tactics[0];
    this.setData({ error: '', view, selected, selectedTactic, storyActive: !!app.state.journey, partyNames: view.party.map(member => member.name).join(' · '),
      currentDifficulty: selected.difficulties.find(item => item.id === this.data.difficulty),
      completion: view.regions.reduce((sum, region) => sum + region.difficulties.filter(item => item.clears > 0).length, 0)
    });
  },
  selectRegion(event) { audioEffect('select'); this.setData({ selectedRegion: event.currentTarget.dataset.id, difficulty: 0 }); this.refresh(); },
  selectDifficulty(event) { audioEffect('select'); this.setData({ difficulty: Number(event.currentTarget.dataset.id) }); this.refresh(); },
  selectTactic(event) {
    if (this.data.view.run || this._starting || !this.data.view.tactics.some(item => item.id === event.currentTarget.dataset.id)) return;
    audioEffect('select'); this.setData({ tacticId: event.currentTarget.dataset.id }); this.refresh();
  },
  start() {
    if (this._starting) return;
    try {
      this._starting = true;
      const result = combat.startExpedition(getApp().state, this.data.selectedRegion, this.data.difficulty, Math.floor(Math.random() * 0xfffffffe) + 1, this.data.tacticId);
      getApp().commit(result.state);
      return this.resume();
    } catch (error) { this._starting = false; wx.showToast({ title: error.message, icon: 'none' }); }
  },
  async resume() {
    const run = getApp().state.adventure.active;
    if (!run || this._loading || this._navigating) return;
    this._loading = true; this.setData({ preparing: true }); this.refresh();
    try {
      await loadActionPacks(actionLoaders, run.party);
    } catch (error) {
      // 动作图是增强表现；分包暂不可用时使用主包待机肖像，不能阻断已保存的远行。
      console.warn('action-pack-load-fallback', error);
    }
    try {
      if (!this._visible || !getApp().state.adventure.active || getApp().state.adventure.active.id !== run.id) return;
      this._navigating = true;
      wx.navigateTo({ url: `/package-${run.regionId}/pages/run/index`, fail: () => { this._navigating = false; wx.showToast({ title: '暂时无法进入，远行已保存', icon: 'none' }); } });
    } catch (error) {
      console.error('adventure-navigation-error', error);
      this._navigating = false;
      wx.showToast({ title: '暂时无法进入，远行已保存', icon: 'none' });
    }
    finally { this._loading = false; this._starting = false; this.setData({ preparing: false }); this.refresh(); }
  },
  goStory() { wx.switchTab({ url: '/pages/story/index' }); },
  goCollection() { wx.switchTab({ url: '/pages/collection/index' }); },
  dismissResult() {
    const app = getApp();
    try { app.commit({ ...app.state, adventure: { ...app.state.adventure, lastResult: null } }); this.refresh(); }
    catch (error) { wx.showToast({ title: error.message, icon: 'none' }); }
  }
});

const combat = require('./combat');
const art = require('../assets/battle/manifest');
const statusLabels = { mark: '标', weak: '弱', burn: '灼', counter: '反', echo: '响', retainBlock: '留' };
function statusBadges(unit) {
  return Object.keys(statusLabels).filter(key => unit.status[key] > 0).map(key => ({ key, text: statusLabels[key] + unit.status[key] }));
}
function impactFeedback(events, id) {
  const affected = events.filter(event => event.targetId === id);
  const hpDelta = affected.reduce((sum, event) => sum + (event.hpDelta || 0), 0);
  if (hpDelta) return { impact: `${hpDelta < 0 ? '−' : '+'}${Math.abs(hpDelta)}`, impactTone: hpDelta < 0 ? 'hurt' : 'heal' };
  const shield = affected.filter(event => event.kind === 'block').reduce((sum, event) => sum + event.amount, 0);
  return { impact: shield ? `⬡+${shield}` : '', impactTone: 'shield' };
}
function intentLines(enemy) {
  const label = enemy.intentShort || enemy.intentText;
  const separator = label.indexOf(' · ');
  if (separator < 0) return { intentTargetLine: '', intentEffectLine: '', intentNote: label };
  return { intentTargetLine: label.slice(0, separator), intentEffectLine: label.slice(separator + 3), intentNote: '' };
}

function createPage(regionId) {
  return {
    data: { screen: { error: '', regionId, view: null } },
    onLoad() { this._selection = { cardUid: '', targetId: '' }; this._sheet = ''; this._busy = false; this._fx = []; },
    onShow() { this.refresh(); },
    onHide() { this.clearMotion(); },
    onUnload() { this.clearMotion(); },
    clearMotion() { clearTimeout(this._motion); this._busy = false; this._fx = []; },
    refresh() {
      const app = getApp();
      if (!app.state) return this.setData({ screen: { error: app.storageError, regionId } });
      const view = combat.getAdventureView(app.state);
      const run = view.run;
      const { windowWidth, windowHeight } = wx.getWindowInfo();
      let selected = null, preview = null;
      if (run) {
        run.log = run.log.map((event, key) => ({ ...event, key }));
        run.party = run.party.map(member => ({ ...member,
          image: art.heroes[member.id] ? art.heroes[member.id][this._fx.some(event => event.actorId === member.id) ? 'cast' : 'idle'] : member.image,
          statusBadges: statusBadges(member).slice(0, 2),
          acting: this._fx.some(event => event.actorId === member.id),
          ...impactFeedback(this._fx, member.id)
        }));
        run.enemies = run.enemies.map(enemy => ({ ...enemy,
          image: art.enemies[enemy.definitionId] ? art.enemies[enemy.definitionId].idle : '',
          statusBadges: statusBadges(enemy).slice(0, 2),
          ...intentLines(enemy),
          ...impactFeedback(this._fx, enemy.id)
        }));
        selected = run.hand.find(card => card.uid === this._selection.cardUid) || null;
        if (selected) preview = combat.previewAction(app.state, { type: 'playCard', cardUid: selected.uid, targetId: this._selection.targetId });
      }
      const inspected = run ? (this._sheet === 'ally' ? run.party : run.enemies).find(unit => unit.id === this._inspected) || null : null;
      this.setData({ screen: { view, run, selected, preview, inspected, busy: this._busy,
        sheet: this._sheet, targetId: this._selection.targetId, regionId,
        art: art.scenes[regionId] || {}, compact: windowHeight < 620,
        cardWidth: Math.max(48, Math.floor((windowWidth - 56) / 5))
      } });
    },
    perform(action) {
      if (this._busy) return;
      try {
        const result = combat.applyAction(getApp().state, action);
        getApp().commit(result.state);
        this._selection = { cardUid: '', targetId: '' };
        this._sheet = '';
        this._fx = result.events || [];
        this._busy = ['playCard', 'endTurn'].includes(action.type);
        this.refresh();
        clearTimeout(this._motion);
        if (this._busy || this._fx.length) this._motion = setTimeout(() => { this._busy = false; this._fx = []; this.refresh(); }, 320);
      } catch (error) { this._busy = false; wx.showToast({ title: error.message || '这次行动未能保存', icon: 'none' }); }
    },
    chooseNode(event) { this.perform({ type: 'chooseNode', nodeId: event.currentTarget.dataset.id }); },
    selectCard(event) { if (this._busy) return; const uid = event.currentTarget.dataset.uid; this._selection = { cardUid: this._selection.cardUid === uid ? '' : uid, targetId: '' }; this.refresh(); },
    selectEnemy(event) {
      if (this._busy) return;
      if (this._selection.cardUid) { this._selection.targetId = event.currentTarget.dataset.id; this.refresh(); }
      else { this._inspected = event.currentTarget.dataset.id; this._sheet = 'enemy'; this.refresh(); }
    },
    selectAlly(event) {
      if (this._busy) return;
      if (this._selection.cardUid) this._selection.targetId = event.currentTarget.dataset.id;
      else { this._inspected = event.currentTarget.dataset.id; this._sheet = 'ally'; }
      this.refresh();
    },
    clearSelection() { this._selection = { cardUid: '', targetId: '' }; this.refresh(); },
    confirmPlay() { if (this.screenPreviewAllowed()) this.perform({ type: 'playCard', cardUid: this._selection.cardUid, targetId: this._selection.targetId }); },
    screenPreviewAllowed() { return this.data.screen.preview && this.data.screen.preview.allowed; },
    endTurn() { this.perform({ type: 'endTurn' }); },
    chooseCard(event) { this.perform({ type: 'chooseCard', choiceId: event.currentTarget.dataset.uid }); },
    skipCard() { this.perform({ type: 'chooseCard', choiceId: 'skip' }); },
    chooseRelic(event) { this.perform({ type: 'chooseRelic', choiceId: event.currentTarget.dataset.id }); },
    chooseEvent(event) { this.perform({ type: 'chooseEvent', choiceId: event.currentTarget.dataset.id }); },
    rest() { this.perform({ type: 'rest' }); },
    showUpgrade() { this.perform({ type: 'chooseUpgrade' }); },
    upgradeCard(event) { this.perform({ type: 'upgradeCard', cardUid: event.currentTarget.dataset.uid }); },
    openDeck() { this._sheet = 'deck'; this.refresh(); },
    openLog() { this._sheet = 'log'; this.refresh(); },
    openCard() { if (this._selection.cardUid) { this._sheet = 'card'; this.refresh(); } },
    askAbandon() { this._sheet = 'abandon'; this.refresh(); },
    abandon() { if (this._sheet === 'abandon') this.perform({ type: 'abandon' }); },
    closeSheet() { this._sheet = ''; this.refresh(); },
    goHub() { wx.switchTab({ url: '/pages/adventure/index' }); },
    closeResult() {
      const app = getApp();
      try { app.commit({ ...app.state, adventure: { ...app.state.adventure, lastResult: null } }); this.goHub(); }
      catch (error) { wx.showToast({ title: error.message, icon: 'none' }); }
    },
    noop() {}
  };
}
module.exports = { createPage };

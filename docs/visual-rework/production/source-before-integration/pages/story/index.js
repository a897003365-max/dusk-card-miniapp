const game = require('../../utils/game');
const { CHAPTERS } = require('../../utils/content');
const STAT_NAMES = { heart: '爱心', courage: '勇气', insight: '灵感' };
Page({
  data: { error: '', chapters: [], journey: null, ending: null, archive: null, helpOpen: false },
  onShow() { this.refresh(); },
  refresh() {
    const app = getApp();
    if (!app.state) return this.setData({ error: app.storageError });
    const state = app.state;
    const chapters = CHAPTERS.map((chapter, index) => ({ ...chapter,
      number: String(index + 1).padStart(2, '0'), unlocked: index === 0 || state.cleared.includes(CHAPTERS[index - 1].id),
      cleared: state.cleared.includes(chapter.id), endingCount: (state.endings[chapter.id] || []).length,
      guideImage: `/assets/prizes/${chapter.guide}/SR.png`
    }));
    const journey = state.journey;
    const chapter = journey ? CHAPTERS.find(item => item.id === journey.chapterId) : null;
    const scene = journey ? chapter.scenes[journey.sceneIndex] : null;
    const choices = scene ? scene.choices.map(choice => ({ ...choice, statName: STAT_NAMES[choice.stat], score: journey.stats[choice.stat], passed: journey.stats[choice.stat] >= choice.requires })) : [];
    this.setData({ chapters, journey, chapter, scene, choices, progress: journey ? (journey.sceneIndex + 1) / chapter.scenes.length * 100 : 0,
      pendingStatName: journey && journey.pending ? STAT_NAMES[journey.pending.stat] : '',
      team: (journey ? journey.team : state.team).map(id => game.getFamily(state, id)),
      ending: state.lastEnding, completed: state.cleared.length,
      collectedEndings: Object.values(state.endings).reduce((sum, items) => sum + items.length, 0),
      keepsakes: CHAPTERS.filter(item => state.cleared.includes(item.id)).map(item => ({ name: item.keepsake, title: item.title }))
    });
  },
  act(operation) {
    try {
      getApp().commit(operation(getApp().state));
      this.refresh();
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    } catch (error) { wx.showToast({ title: error.message || '未能保存旅途，请稍后再试', icon: 'none' }); }
  },
  start(event) { this.act(state => game.startJourney(state, event.currentTarget.dataset.id)); },
  choose(event) { this.act(state => game.choose(state, event.currentTarget.dataset.id)); },
  nextScene() { this.act(state => game.continueJourney(state)); },
  dismissEnding() { this.act(state => ({ ...state, lastEnding: null })); },
  openArchive(event) {
    const chapter = CHAPTERS.find(item => item.id === event.currentTarget.dataset.id);
    const owned = getApp().state.endings[chapter.id] || [];
    this.setData({ archive: { title: chapter.title, letters: owned.map(tone => ({ ...chapter.endings[tone], tone })) } });
  },
  closeArchive() { this.setData({ archive: null }); },
  toggleHelp() { this.setData({ helpOpen: !this.data.helpOpen }); },
  noop() {}
});

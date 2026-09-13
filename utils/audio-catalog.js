const MUSIC = Object.freeze({
  town: { src: '/assets/audio/town.mp3' },
  letter: { src: '/assets/audio/letter.mp3' },
  boss: { src: '/assets/audio/boss.mp3' },
  street: { src: '/package-street/assets/audio/theme.mp3' },
  bridge: { src: '/package-bridge/assets/audio/theme.mp3' },
  market: { src: '/package-market/assets/audio/theme.mp3' },
});

const EFFECTS = Object.freeze({
  select: '/assets/audio/sfx/select.mp3',
  card: '/assets/audio/sfx/card.mp3',
  attack: '/assets/audio/sfx/attack.mp3',
  hit: '/assets/audio/sfx/hit.mp3',
  guard: '/assets/audio/sfx/guard.mp3',
  heal: '/assets/audio/sfx/heal.mp3',
  buff: '/assets/audio/sfx/buff.mp3',
  debuff: '/assets/audio/sfx/debuff.mp3',
  shuffle: '/assets/audio/sfx/shuffle.mp3',
  summon: '/assets/audio/sfx/summon.mp3',
  rare: '/assets/audio/sfx/rare.mp3',
  reward: '/assets/audio/sfx/reward.mp3',
  chest: '/assets/audio/sfx/chest.mp3',
  victory: '/assets/audio/sfx/victory.mp3',
  defeat: '/assets/audio/sfx/defeat.mp3',
  phase: '/assets/audio/sfx/phase.mp3',
});

module.exports = { MUSIC, EFFECTS };

const PROFILES = {
  R: { name: '纸页轻响', kicker: 'A SMALL HELLO', color: '#9fbdce', secondary: '#e0eff5', chargeMs: 280, burstMs: 180, arriveMs: 360, particleCount: 10, rayCount: 0, reach: 68 },
  SR: { name: '双层花信', kicker: 'A WARM BLOOM', color: '#a8d9bc', secondary: '#e5f5cf', chargeMs: 440, burstMs: 280, arriveMs: 460, particleCount: 16, rayCount: 8, reach: 100 },
  SSR: { name: '星环回信', kicker: 'A STELLAR ENCOUNTER', color: '#c8b5ff', secondary: '#f0d8ff', chargeMs: 620, burstMs: 380, arriveMs: 560, particleCount: 24, rayCount: 14, reach: 132 },
  UR: { name: '日蚀来客', kicker: 'AN ECLIPSE, A PROMISE', color: '#f4c36b', secondary: '#94dded', chargeMs: 850, burstMs: 500, arriveMs: 800, particleCount: 32, rayCount: 20, reach: 160 }
};

// 纯表现数据：角度为deg，距离/尺寸为rpx，延迟为ms；不参与抽取随机数。
function getRevealProfile(tier) {
  const source = PROFILES[tier];
  if (!source) throw new Error('没有找到这个稀有度的揭晓演出');
  const { particleCount, rayCount, reach, ...profile } = source;
  return {
    tier, ...profile,
    particles: Array.from({ length: particleCount }, (_, id) => ({
      id, angle: (id * 137.5) % 360, distance: reach + (id * 17) % 58,
      delay: (id % 6) * 24, size: 5 + (id * 3) % 8
    })),
    rays: Array.from({ length: rayCount }, (_, id) => ({
      id, angle: id * 360 / rayCount, length: reach + 40 + (id % 3) * 18,
      width: 3 + id % 3, delay: (id % 5) * 20, opacity: 0.2 + (id % 4) * 0.1
    }))
  };
}

module.exports = { getRevealProfile };

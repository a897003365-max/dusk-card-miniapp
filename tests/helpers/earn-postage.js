// 通过真实剧情按钮获得邮票；不直接改存档或调用游戏业务函数。
const assert = require('assert');

async function earnPostage(h) {
  await h.call('automation_navigate', ['--action', 'switchTab', '--url', '/pages/story/index']);
  const before = await h.state();
  assert(!before.adventure.active, '赚票前不得有冒险在途');
  const pageData = async () => JSON.parse(await h.evaluate(function () { return JSON.stringify(getCurrentPages().slice(-1)[0].data); }));
  if (before.lastEnding) await h.tap('.keep-ending');
  if (!before.journey) {
    const data = await pageData();
    const chapter = data.chapters.find(item => item.unlocked && !item.cleared) || data.chapters[0];
    await h.tap(`.chapter-start[data-id="${chapter.id}"]`);
  }
  for (let step = 0; step < 8; step += 1) {
    const saved = await h.state();
    if (!saved.journey) break;
    if (saved.journey.pending) await h.tap('.continue-story');
    else {
      const data = await pageData();
      await h.tap(`.choice-button[data-id="${data.choices[0].id}"]`);
    }
  }
  const after = await h.state();
  h.check('仅靠真实完成章节获得邮票', !after.journey && after.tickets > before.tickets);
  await h.tap('.keep-ending');
  await h.call('automation_navigate', ['--action', 'switchTab', '--url', '/pages/home/index']);
  return { before: before.tickets, after: after.tickets, cleared: after.cleared };
}

module.exports = { earnPostage };

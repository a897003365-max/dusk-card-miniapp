// 需用户批准6次抽取与四章推进；仅接受 prepare-acceptance.js 创建的临时副本。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const exec = require('util').promisify(execFile);
const root = path.resolve(__dirname, '..');
const project = path.resolve(process.argv[2] || '.');
assert(process.argv.includes('--allow-progress'), '需先获准，再传 --allow-progress');
assert(project.startsWith(path.join(os.tmpdir(), 'dusk-card-acceptance-')), '只允许系统临时目录内的独立副本');
const marker = JSON.parse(fs.readFileSync(path.join(project, '.acceptance.json'), 'utf8'));
assert(marker.source === root && fs.readFileSync(path.join(project, 'app.js'), 'utf8').includes(marker.storageKey));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-card-evidence-'));
const cli = '/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide';
const report = { project, out, checks: [], screenshots: [], status: 'running' };
report.mode = process.argv.includes('--final-layout') ? 'final-layout' : process.argv.includes('--narrow') ? 'narrow' : process.argv.includes('--from-collection') ? 'collection-and-story' : 'full';
let lastCallAt = 0;
async function call(tool, flags = []) {
  // 开发者工具同 AppID 限 60 次/分钟；验收串行运行，留出调用余量。
  const pause = Math.max(0, 1300 - (Date.now() - lastCallAt));
  if (pause) await new Promise(resolve => setTimeout(resolve, pause));
  lastCallAt = Date.now();
  let stdout;
  try { ({ stdout } = await exec(cli, ['-c', 'Codex', tool, '--project', project, ...flags], { timeout: 35000, maxBuffer: 4 * 1024 * 1024 })); }
  catch (error) { throw new Error(error.stdout || error.stderr || error.message); }
  const response = JSON.parse(stdout);
  if (!response.ok || response.result && response.result.success === false) throw new Error(JSON.stringify(response));
  return response.result;
}
function check(name, pass) { report.checks.push({ name, pass: !!pass }); assert(pass, name); console.log(`✓ ${name}`); }
async function data(key) { return (await call('automation_page_action', ['--action', 'getData', '--data-path', key])).data; }
async function evaluate(fn, args = []) { return (await call('automation_evaluate', ['--fn-source', `function(){ return (${fn.toString()})(...${JSON.stringify(args)}); }`])).result.result; }
async function tap(selector) {
  let measured = await geometry([selector]);
  let rect = measured.rects[0];
  assert(rect, `缺少点击目标 ${selector}`);
  if (rect.top < 0 || rect.bottom > measured.info.windowHeight) {
    await scroll(Math.max(0, measured.scrollTop + rect.top - measured.info.windowHeight / 3));
    measured = await geometry([selector]); rect = measured.rects[0];
  }
  assert(rect.top >= -1 && rect.bottom <= measured.info.windowHeight + 1 && rect.left >= -1 && rect.right <= measured.info.windowWidth + 1, `点击目标必须完整可见：${selector}`);
  assert(rect.width >= 43.5 && rect.height >= 43.5, `点击目标需达到44px：${selector} ${rect.width}×${rect.height}`);
  (report.interactions || (report.interactions = [])).push({ selector, rect, width: measured.info.windowWidth, height: measured.info.windowHeight });
  await call('automation_element_action', ['--action', 'tap', '--selector', selector, '--wait-for-selector', selector]);
}
async function tab(page) { await call('automation_navigate', ['--action', 'switchTab', '--url', `/pages/${page}/index`]); }
async function scroll(y) { await call('automation_viewport_action', ['--action', 'pageScrollTo', '--scroll-top', String(y)]); }
async function shot(name) { const result = await call('simulator_screenshot', ['--path', path.join(out, `${name}.jpg`)]); report.screenshots.push({ name, ...result }); }
// 以 JSON 传回只读快照，不把 App 对象引用作为验收结果。
async function state() { return JSON.parse(await evaluate(function () { return JSON.stringify(getApp().state); })); }
async function geometry(selectors) {
  return evaluate(function (selectors) {
    return new Promise(resolve => {
      const q = wx.createSelectorQuery();
      const specs = selectors.map(selector => {
        const attr = selector.match(/\[data-([\w-]+)="([^"]+)"\]/);
        return { selector: selector.replace(/\[data-[^\]]+\]/, '').replace(/:last-child$/, ''), attr: attr && attr[1], value: attr && attr[2], last: selector.endsWith(':last-child') };
      });
      // 原生 SelectorQuery 不支持属性选择器；按真实节点 dataset 匹配同一个目标。
      specs.forEach(spec => q.selectAll(spec.selector).fields({ rect: true, size: true, dataset: true }));
      q.selectViewport().scrollOffset();
      q.exec(rows => {
        const offset = rows.pop();
        const rects = rows.map((items, i) => specs[i].attr ? items.find(item => String(item.dataset[specs[i].attr]) === specs[i].value) : specs[i].last ? items[items.length - 1] : items[0]);
        resolve({ rects, info: wx.getWindowInfo(), scrollTop: offset.scrollTop });
      });
    });
  }, [selectors]);
}
async function dialogVisible(name) {
  const measured = await geometry(['.dialog', '.dialog-scroll', '.close', '.dialog-footer']);
  const [dialog, region, close, footer] = measured.rects;
  check(`${name} 内容有实际高度，关闭与页脚在屏内`, dialog.top >= 0 && dialog.bottom <= measured.info.windowHeight + 1 && region.height > 100 && close.width <= 45 && footer.bottom <= measured.info.windowHeight + 1);
  (report.dialogs || (report.dialogs = [])).push({ name, ...measured });
}
async function nodeCount(selector) { return (await call('automation_page_action', ['--action', 'querySelectorAll', '--selector', selector])).elements.length; }
async function checkConsole() {
  report.console = await call('get_simulator_console', ['--command', 'grep -i error']);
  if (report.console) report.fullConsole = await call('get_simulator_console', ['--command', 'grep -n .']);
  check('控制台error查询为空，含SDK错误检查', !report.console);
}
async function finalLayout() {
  const initial = await state();
  assert(initial.cleared.length === 4, '最终布局复验使用已完成主线的隔离存档');
  await scroll(0);
  const cover = await geometry(['.envelope', '.office-footer']);
  const width = cover.info.windowWidth;
  check(`${width}px 首页信封不遮住形态说明`, cover.rects[0].bottom <= cover.rects[1].top);
  await shot(`final-${width}-home`);
  await tab('collection'); await tap('.filter[data-filter="owned"]');
  const family = (await data('families')).find(item => !initial.team.includes(item.id));
  assert(family, '本轮已抽到可换队伙伴');
  await tap(`.family-card[data-id="${family.id}"]`); await tap('.invite-partner');
  const rows = await geometry(['.detail-scroll', '.replace-member', '.replace-member:last-child']);
  check(`${width}px 换队三位候选无需滚动即可完整看见`, rows.rects[1].top >= rows.rects[0].top && rows.rects[2].bottom <= rows.rects[0].bottom);
  await shot(`final-${width}-replace`); await tap('.cancel-replace'); await tap('.close');
  await tab('story');
  const journey = (await state()).journey;
  if (!journey) await tap(`.chapter-start[data-id="${(await data('chapters'))[0].id}"]`);
  else if (journey.pending) await tap('.continue-story');
  await scroll(0); await shot(`final-${width}-story`); await scroll(10000);
  const prose = await geometry(['.scene-text', '.reader-party', '.reader-actions']);
  check(`${width}px 完整正文和队伍属性可读`, prose.rects[0].bottom <= prose.rects[2].top && prose.rects[1].bottom <= prose.rects[2].top);
  await shot(`final-${width}-story-bottom`);
  const choice = (await data('choices'))[0]; await tap(`.choice-button[data-id="${choice.id}"]`); await scroll(10000);
  const outcome = await geometry(['.outcome-text', '.reader-actions', '.continue-story']);
  check(`${width}px 结果末句可读，继续按钮满宽且至少44px`, outcome.rects[0].bottom <= outcome.rects[1].top && outcome.rects[2].width >= width - 48 && outcome.rects[2].height >= 44);
  await shot(`final-${width}-outcome-bottom`);
  for (let i = 0; i < 3 && (await state()).journey; i++) {
    if (!(await state()).journey.pending) await tap(`.choice-button[data-id="${(await data('choices'))[0].id}"]`);
    await tap('.continue-story');
  }
  check('布局复验只产生正常重访奖励，不消费邮票', (await state()).tickets === initial.tickets + 1 && (await state()).cleared.length === 4 && (await state()).journey === null);
  await tap('.keep-ending');
}
async function narrowScreen() {
  const before = await state();
  assert(before.cleared.length === 4 && before.tickets >= 6, '窄屏复验接在完整四章验收之后');
  await scroll(0);
  const hero = await geometry(['.envelope', '.post-office']);
  check('当前是320px窄屏模拟器', hero.info.windowWidth === 320);
  check('窄屏首屏有完整的启封入口', hero.rects[0].bottom <= hero.info.windowHeight && hero.rects[0].height >= 44);
  await shot('narrow-01-home');
  await tap('.envelope'); await dialogVisible('窄屏单封'); await shot('narrow-02-sealed');
  await tap('.sealed-letter[data-serial="0"]'); await shot('narrow-03-single'); await tap('.close');
  await tap('.draw-five'); await dialogVisible('窄屏五封'); await tap('.reveal-all');
  await call('automation_element_action', ['--action', 'scrollTo', '--selector', '.result-scroll', '--x', '0', '--y', '1000']);
  const last = await geometry(['.result-scroll', '.result-card:last-child']);
  check('窄屏五封最后卡片完整可读', last.rects[1].top >= last.rects[0].top - 1 && last.rects[1].bottom <= last.rects[0].bottom + 1);
  await shot('narrow-04-five-bottom'); await tap('.view-partners');
  await scroll(0); await tap('.filter[data-filter="all"]');
  const filters = await geometry(['.section-title', '.filters']);
  check('窄屏收藏标题单行，筛选无横向越界', filters.rects[0].height < 35 && filters.rects[1].right <= 320);
  await shot('narrow-05-collection');
  const owned = (await data('families')).filter(item => item.owned);
  const candidate = owned.find(item => !before.team.includes(item.id));
  await tap(`.family-card[data-id="${candidate ? candidate.id : owned[0].id}"]`);
  await dialogVisible('窄屏详情'); await tap('.variant[data-tier="UR"]'); await shot('narrow-06-detail');
  if (candidate) { await tap('.invite-partner'); await shot('narrow-07-replace'); await tap('.cancel-replace'); }
  await tap('.close'); await tab('story'); await scroll(0);
  const chapter = (await data('chapters'))[0];
  const tone = before.endings[chapter.id][0] === 'warm' ? 'brave' : 'warm';
  await tap(`.chapter-start[data-id="${chapter.id}"]`);
  for (let i = 0; i < 3; i++) {
    const choices = await data('choices');
    const choice = choices.find(item => item.tone === tone);
    const buttons = await geometry(['.choice-button', '.choice-button:last-child']);
    check(`窄屏第${i + 1}幕两个选择都在屏内`, buttons.rects[0].top >= 0 && buttons.rects[1].bottom <= buttons.info.windowHeight);
    if (!i) {
      await shot('narrow-08-story'); await scroll(10000);
      const reading = await geometry(['.scene-text', '.reader-party', '.reader-actions']);
      check('正文末句与队伍属性都能滚到操作条上方', reading.rects[0].bottom <= reading.rects[2].top && reading.rects[1].bottom <= reading.rects[2].top);
      await shot('narrow-08-story-bottom');
    }
    await tap(`.choice-button[data-id="${choice.id}"]`);
    if (!i) await shot('narrow-09-outcome');
    await tap('.continue-story');
  }
  const after = await state();
  check('窄屏重访只奖励1邮票，并收集另一封回信', after.tickets === before.tickets - 6 + 1 && after.endings[chapter.id].length === 2);
  await dialogVisible('窄屏结局'); await shot('narrow-10-ending'); await tap('.keep-ending');
  await tap(`.archive-link[data-id="${chapter.id}"]`);
  check('两封已收藏回信真实可查看', await nodeCount('.archived-letter') === 2);
  await call('automation_element_action', ['--action', 'scrollTo', '--selector', '.archive-scroll', '--x', '0', '--y', '1000']);
  const letters = await geometry(['.archive-scroll', '.archived-letter:last-child']);
  check('窄屏长回信可读到底', letters.rects[1].bottom <= letters.rects[0].bottom + 1);
  await shot('narrow-11-archive-bottom'); await tap('.archive-close');
}
(async () => {
  try {
    // 项目须已由 CLI 打开并进入自动化；测试过程不重新编译，避免打断已就绪桥接。
    await tab('home');
    await call('automation_page_action', ['--action', 'getData', '--data-path', 'tickets', '--wait-for-selector', '.draw-one']);
    if (process.argv.includes('--final-layout')) { await finalLayout(); await checkConsole(); report.status = 'pass'; return; }
    if (process.argv.includes('--narrow')) { await narrowScreen(); await checkConsole(); report.status = 'pass'; return; }
    if (process.argv.includes('--from-collection')) {
      const checkpoint = await state();
      assert(checkpoint.drawCount === 6 && checkpoint.tickets === 0 && !checkpoint.journey && checkpoint.cleared.length === 0, '只允许从六封已完成、剧情未开始的检查点继续');
      await tab('collection');
    } else {
    check('副本从正常初始状态开始', (await state()).tickets === 6 && (await state()).drawCount === 0);
    check('信匣真实渲染三个展示卡面', await nodeCount('.stamp-card') === 3);
    const imageInfo = await evaluate(function () { return new Promise((resolve, reject) => wx.getImageInfo({ src: '/assets/prizes/cloudmail/UR.png', success: resolve, fail: reject })); });
    check('本地公仔图片真实加载', imageInfo.width === 128 && imageInfo.height === 128);
    report.homeGeometry = await geometry(['.post-office', '.draw-one', '.draw-five']);
    check('首页主视觉无横向溢出', report.homeGeometry.rects[0].left >= 0 && report.homeGeometry.rects[0].right <= report.homeGeometry.info.windowWidth);
    await shot('01-home');
    await scroll(600); await tap('.rules-toggle');
    check('概率与邮票规则可展开', await data('rulesOpen') === true && await nodeCount('.rule-line') === 4);
    await scroll(1000); await shot('02-rules'); await tap('.rules-toggle');
    check('规则可关闭', await data('rulesOpen') === false);
    await scroll(400); await tap('.draw-one');
    check('一次抽取扣一邮票并新增一张收藏', (await state()).tickets === 5 && (await state()).drawCount === 1 && await nodeCount('.result-card') === 1);
    check('收到的是可亲手开启的封蜡信', await data('revealedCount') === 0 && await nodeCount('.sealed-letter') === 1);
    await dialogVisible('单封揭晓'); await shot('03-sealed-letter');
    await tap('.sealed-letter[data-serial="0"]');
    check('启封只揭晓，不重复扣票', await data('revealedCount') === 1 && (await state()).tickets === 5 && (await state()).drawCount === 1);
    await shot('03-single-reveal'); await tap('.close');
    check('揭晓可关闭', await data('resultOpen') === false);
    await tap('.draw-five');
    check('五封逐次结算并真实显示五张卡', (await state()).tickets === 0 && (await state()).drawCount === 6 && await nodeCount('.result-card') === 5);
    await dialogVisible('五封揭晓');
    await tap('.sealed-letter[data-serial="0"]');
    check('五封可以逐封启封', await data('revealedCount') === 1);
    await tap('.reveal-all');
    check('全部拆开显示五张公仔且不重复消费', await data('revealedCount') === 5 && await nodeCount('.result-art') === 5 && (await state()).drawCount === 6);
    await shot('04-five-reveal');
    await call('automation_element_action', ['--action', 'scrollTo', '--selector', '.result-scroll', '--x', '0', '--y', '1000']);
    const lastCard = await geometry(['.result-scroll', '.result-card:last-child']);
    check('最后一张卡能滚到完整可见', lastCard.rects[1].top >= lastCard.rects[0].top - 1 && lastCard.rects[1].bottom <= lastCard.rects[0].bottom + 1);
    await shot('05-five-scroll'); await tap('.view-partners');
    }
    check('收藏册真实显示22位角色', await nodeCount('.family-card') === 22);
    await tap('.filter[data-filter="owned"]');
    const owned = await data('families');
    check('已相遇筛选只显示拥有的伙伴', owned.every(item => item.owned) && await nodeCount('.family-card') === owned.length);
    await shot('06-collection');
    await tap('.family-card[data-id="sheep"]');
    await tap('.variant[data-tier="UR"]');
    check('详情形态切换实际生效', await data('previewTier') === 'UR');
    await dialogVisible('旅伴详情');
    await shot('07-partner-detail'); await tap('.close');
    const initialTeam = (await state()).team;
    const recruit = owned.find(item => !initialTeam.includes(item.id));
    if (recruit) {
      await tap(`.family-card[data-id="${recruit.id}"]`); await tap('.invite-partner');
      const candidate = await geometry(['.detail-scroll', '.replace-member']);
      check('邀请后下一步替换人选立即可见', candidate.rects[1].top >= candidate.rects[0].top - 1 && candidate.rects[1].bottom <= candidate.rects[0].bottom + 1);
      await shot('07-recruit');
      await tap(`.replace-member[data-id="${initialTeam[0]}"]`);
      check('真实邀请新旅伴替换队员，队伍仍为三人', (await state()).team.length === 3 && (await state()).team.includes(recruit.id));
    } else report.recruitNote = '随机六封未获得队伍外伙伴，运行时换队未覆盖；纯函数测试已覆盖。';
    await tab('story');
    check('主线4章真实渲染且只有第一章解锁', await nodeCount('.chapter-card') === 4 && (await data('chapters')).filter(item => item.unlocked).length === 1);
    await shot('08-story-map');
    const chapters = await data('chapters');
    for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex++) {
      const chapter = chapters[chapterIndex];
      await scroll(chapterIndex * 300); await tap(`.chapter-start[data-id="${chapter.id}"]`);
      check(`${chapter.title} 可启程`, (await data('journey')).chapterId === chapter.id && await nodeCount('.choice-button') === 2);
      const actions = await geometry(['.choice-button', '.choice-button:last-child', '.reader-actions']);
      check(`${chapter.title} 两个选择首屏都完整可见`, actions.rects[0].top >= 0 && actions.rects[1].bottom <= actions.info.windowHeight);
      if (!chapterIndex) await shot('09-story-scene');
      for (let sceneIndex = 0; sceneIndex < 3; sceneIndex++) {
        const choices = await data('choices');
        const choice = choices[(chapterIndex + sceneIndex) % 2];
        await scroll(650); await tap(`.choice-button[data-id="${choice.id}"]`);
        const journey = await data('journey');
        check(`${chapter.title} 第${sceneIndex + 1}幕选择与实际能力一致`, journey.pending.choiceId === choice.id && journey.pending.passed === choice.passed && await nodeCount('.outcome') === 1);
        if (!chapterIndex && !sceneIndex) {
          await shot('10-choice-outcome');
          await call('automation_navigate', ['--action', 'reLaunch', '--url', '/pages/story/index']);
          check('页面重开保留尚未翻页的选择', (await data('journey')).pending.choiceId === choice.id);
        }
        await scroll(600); await tap('.continue-story');
      }
      const saved = await state();
      check(`${chapter.title} 首次结算仅奖励3邮票`, saved.tickets === (chapterIndex + 1) * 3 && saved.cleared.length === chapterIndex + 1 && saved.journey === null);
      check(`${chapter.title} 回信实际显示`, await nodeCount('.ending-title') === 1 && (await data('ending')).chapterId === chapter.id);
      await dialogVisible(`${chapter.title}回信`);
      await shot(`11-ending-${chapterIndex + 1}`);
      await tap('.keep-ending');
      check(`${chapter.title} 收好回信不重复发奖励`, (await state()).tickets === (chapterIndex + 1) * 3);
    }
    await scroll(0); await shot('12-complete');
    await tap(`.archive-link[data-id="${chapters[0].id}"]`);
    check('历史回信可只读重看', await nodeCount('.archived-letter') === 1);
    await shot('13-archive'); await tap('.archive-close');
    check('看历史回信不改变邮票或通关', (await state()).tickets === 12 && (await state()).cleared.length === 4);
    await tab('home');
    check('回到信匣同步剧情邮票', await data('tickets') === 12);
    await checkConsole();
    report.status = 'pass';
  } catch (error) { report.status = 'fail'; report.error = error.message; console.error(error.message); process.exitCode = 1; }
  finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(`验收${report.status}；证据 ${out}`); }
})();

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const exec = require('util').promisify(require('child_process').execFile);

const cli = '/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide';
const root = path.resolve(__dirname, '../..');

function createHarness({ project, report, out }) {
  const acceptanceProject = path.resolve(project || '.');
  assert(acceptanceProject.startsWith(path.join(os.tmpdir(), 'dusk-card-acceptance-')), '仅允许验收临时副本');
  const marker = JSON.parse(fs.readFileSync(path.join(acceptanceProject, '.acceptance.json'), 'utf8'));
  assert(marker.source === root, '副本来源不匹配');
  // 当前 CLI 缺省 args 时不会回复 evaluate；使用不可变的空参数文件。
  const evaluateArgs = path.join(out, 'evaluate-args.json');
  fs.writeFileSync(evaluateArgs, '[]');

  let last = 0;
  let recentCalls = [];
  async function waitForCapacity(count) {
    assert(Number.isInteger(count) && count > 0 && count <= 48);
    const now = Date.now();
    recentCalls = recentCalls.filter(time => now - time < 60000);
    const overflow = recentCalls.length + count - 48;
    if (overflow > 0) await new Promise(resolve => setTimeout(resolve, Math.max(0, recentCalls[overflow - 1] + 60001 - now)));
  }

  async function call(name, args = [], { burst = false } = {}) {
    const now = Date.now();
    recentCalls = recentCalls.filter(time => now - time < 60000);
    // 短动画允许连续截图，但每分钟最多48次，给工具的60次上限留余量。
    const quotaWait = recentCalls.length >= 48 ? recentCalls[0] + 60000 - now : 0;
    const pause = Math.max(0, burst ? 0 : 1350 - (now - last), quotaWait);
    if (pause) await new Promise(resolve => setTimeout(resolve, pause));
    last = Date.now();
    recentCalls = recentCalls.filter(time => last - time < 60000);
    recentCalls.push(last);

    let stdout;
    try {
      ({ stdout } = await exec(cli, ['-c', 'Codex', name, '--project', acceptanceProject, ...args], {
        timeout: 35000,
        maxBuffer: 4 * 1024 * 1024,
      }));
    } catch (error) {
      throw new Error(error.stdout || error.stderr || error.message);
    }

    if (name === 'get_simulator_console') {
      const kind = args.includes('grep -i error') ? 'errors' : 'full';
      fs.writeFileSync(path.join(out, `console-${kind}-raw.json`), stdout);
    }
    let response;
    try { response = JSON.parse(stdout); }
    catch (error) { fs.writeFileSync(path.join(out, `${name}-invalid-json.txt`), stdout); throw error; }
    if (!response.ok || (response.result && response.result.success === false)) {
      throw new Error(JSON.stringify(response));
    }

    return response.result;
  }

  async function evaluate(fn, args = [], options) {
    return (await call('automation_evaluate', ['--fn-source', `function(){return (${fn.toString()})(...${JSON.stringify(args)});}`, '--args-file', evaluateArgs], options)).result.result;
  }

  async function state() {
    return JSON.parse(await evaluate(function () {
      return JSON.stringify(getApp().state);
    }));
  }

  async function inspectConsole() {
    report.console = await call('get_simulator_console', ['--command', 'grep -i error']);
    if (report.console) report.fullConsole = await call('get_simulator_console', ['--command', 'grep -n .']);
    return report.console;
  }

  async function data(key) {
    return (await call('automation_page_action', ['--action', 'getData', '--data-path', key])).data;
  }

  function check(name, pass) {
    report.checks.push({ name, pass: !!pass });
    assert(pass, name);
    console.log(`✓ ${name}`);
  }

  async function shot(name) {
    const result = await call('simulator_screenshot', ['--path', path.join(out, name + '.jpg')]);
    report.shots.push({ name, ...result });
  }

  async function geometry(selector, container) {
    return evaluate(function (selector, container) {
      return new Promise(resolve => {
        const attr = selector.match(/\[data-([\w-]+)="([^"]+)"\]/);
        const lastChild = selector.endsWith(':last-child');
        const base = selector.replace(/\[data-[^\]]+\]/, '').replace(/:last-child$/, '');
        const q = wx.createSelectorQuery();
        q.selectAll(base).fields({ rect: true, size: true, dataset: true });
        if (container) {
          q.select(container).boundingClientRect();
          q.select(container).scrollOffset();
        } else {
          q.selectViewport().scrollOffset();
        }
        q.selectViewport().boundingClientRect();
        q.exec(rows => {
          const rect = attr ? rows[0].find(item => String(item.dataset[attr[1]]) === attr[2]) : rows[0][lastChild ? rows[0].length - 1 : 0];
          const info = wx.getWindowInfo(), viewport = rows[rows.length - 1];
          const route = getCurrentPages().slice(-1)[0].route;
          const bottomInset = route.startsWith('package-') && info.safeArea ? info.screenHeight - info.safeArea.bottom : 0;
          // getWindowInfo保留tab页高度；当前非tab页使用渲染层实测viewport高度。
          resolve({
            rect,
            container: container ? rows[1] : null,
            offset: rows[container ? 2 : 1],
            info,
            viewport: { width: viewport.width, height: viewport.height - bottomInset },
          });
        });
      });
    }, [selector, container || '']);
  }

  async function tap(selector, container, horizontal = false, beforeTap) {
    let g = await geometry(selector, container);
    assert(g.rect, `缺少节点 ${selector}`);
    const bounds = g.container || { top: 0, bottom: g.viewport.height, left: 0, right: g.viewport.width };

    if (g.rect.top < bounds.top || g.rect.bottom > bounds.bottom || horizontal && (g.rect.left < bounds.left || g.rect.right > bounds.right)) {
      if (container) {
        const x = horizontal ? Math.max(0, g.offset.scrollLeft + g.rect.left - bounds.left - 6) : 0;
        const y = horizontal ? 0 : Math.max(0, g.offset.scrollTop + g.rect.top - bounds.top - 8);
        await call('automation_element_action', ['--action', 'scrollTo', '--selector', container, '--x', String(x), '--y', String(y)]);
      } else {
        await call('automation_viewport_action', ['--action', 'pageScrollTo', '--scroll-top', String(Math.max(0, g.offset.scrollTop + g.rect.top - 80))]);
      }
      g = await geometry(selector, container);
    }

    const clip = g.container || { top: 0, bottom: g.viewport.height, left: 0, right: g.viewport.width };
    if (Number.isFinite(report.width)) assert.equal(g.viewport.width, report.width, '实际视口宽度在验收期间发生变化');
    assert(g.rect.top >= Math.max(0, clip.top) - 2 && g.rect.bottom <= Math.min(g.viewport.height, clip.bottom) + 2 && g.rect.left >= Math.max(0, clip.left) - 2 && g.rect.right <= Math.min(g.viewport.width, clip.right) + 2, `目标未完整可见 ${selector}: ${JSON.stringify(g.rect)}`);
    assert(g.rect.width >= 43.5 && g.rect.height >= 43.5, `目标不足44px ${selector}: ${g.rect.width}×${g.rect.height}`);

    report.interactions = report.interactions || [];
    report.interactions.push({ selector, rect: g.rect, viewport: g.viewport });

    if (beforeTap) { await waitForCapacity(1); await beforeTap(); }

    await call('automation_element_action', ['--action', 'tap', '--selector', selector, '--wait-for-selector', selector]);
  }

  return { call, evaluate, state, data, check, shot, geometry, tap, waitForCapacity, inspectConsole, marker, project: acceptanceProject };
}

module.exports = { createHarness, root };

const { spawn } = require('child_process');
const RECORDER_PATH = '/tmp/dusk-window-recorder';

async function startWindowRecording({ windowId, title, file, duration = 8 }) {
  const child = spawn(RECORDER_PATH, ['--window-id', String(windowId), '--title', title, '--duration', String(duration), '--output', file]);
  let ready = false, stderr = '', buffer = '', finishEvent = null, resolveStart, rejectStart, resolveDone, rejectDone;
  const started = new Promise((resolve, reject) => { resolveStart = resolve; rejectStart = reject; });
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  done.catch(() => {});
  child.stdout.on('data', chunk => {
    buffer += chunk.toString();
    const lines = buffer.split('\n'); buffer = lines.pop();
    for (const line of lines) {
      let event; try { event = JSON.parse(line); } catch (_) { continue; }
      if (event.event === 'started') { ready = true; resolveStart(); }
      if (event.event === 'finished') finishEvent = event;
    }
  });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  child.on('error', error => { rejectStart(error); rejectDone(error); });
  child.on('close', code => {
    if (code !== 0 || !ready) { const error = new Error(stderr || `窗口录制失败 ${code}`); rejectStart(error); rejectDone(error); }
    else resolveDone(finishEvent);
  });
  await started;
  return { done, file };
}

module.exports = { startWindowRecording, RECORDER_PATH };

// Run after npm run build. Uses only a temporary Chrome profile and MockTrainer.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const root = resolve('dist');
const artifactRoot = resolve(process.env.TDH_BROWSER_ARTIFACTS || 'artifacts/browser');
await mkdir(artifactRoot, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'ride-recovery-ui-'));
const server = createServer(async (req, res) => {
  if (req.url === '/__telemetry') { res.writeHead(204).end(); return; }
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + '/')) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(file);
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp' })[extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolveListen, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolveListen);
});
const origin = `http://127.0.0.1:${server.address().port}`;
let chrome;
let socket;
let send;
let sessionId;
const sourceManifestHash = await readFile('SOURCE-MANIFEST.json').then(data => createHash('sha256').update(data).digest('hex')).catch(() => null);
const steps = [];
const pause = ms => new Promise(r => setTimeout(r, ms));

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}

async function waitFor(check, description) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await pause(100);
  }
  throw new Error(`Timed out: ${description}`);
}

async function startBrowser() {
  chrome = spawn(process.env.CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome'), [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--enable-unsafe-swiftshader', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { detached: true });
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    const timeout = setTimeout(() => reject(new Error('Chrome startup timeout')), 15000);
    let output = '';
    chrome.stderr.on('data', chunk => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolveEndpoint(match[1]); }
    });
    chrome.once('error', reject);
    chrome.once('exit', code => { clearTimeout(timeout); reject(new Error(`Chrome exited ${code}: ${output}`)); });
  });
  socket = new WebSocket(endpoint);
  await new Promise((r, reject) => { socket.addEventListener('open', r, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  send = (method, params = {}, targetSession) => new Promise((resolveCall, reject) => {
    const callId = ++id;
    const timeout = setTimeout(() => { pending.delete(callId); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
    pending.set(callId, [resolveCall, reject, timeout]);
    socket.send(JSON.stringify({ id: callId, method, params, sessionId: targetSession }));
  });
  socket.addEventListener('close', () => {
    for (const [, reject, timeout] of pending.values()) {
      clearTimeout(timeout);
      reject(new Error('Test browser closed'));
    }
    pending.clear();
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (pending.has(message.id)) {
      const [resolveCall, reject, timeout] = pending.get(message.id);
      clearTimeout(timeout);
      pending.delete(message.id);
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolveCall(message.result);
    }
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params;
      const local = request.url.startsWith(origin + '/');
      void send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', local ? { requestId } : { requestId, errorReason: 'BlockedByClient' }, message.sessionId).catch(() => {});
    }
  });
  const target = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }));
  await send('Page.enable', {}, sessionId);
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('tour_de_home_ride_view', 'map');" }, sessionId);
  await send('Page.navigate', { url: origin }, sessionId);
}

async function stopBrowser(signal = 'SIGKILL') {
  socket?.close();
  if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
    const exited = new Promise(r => chrome.once('exit', r));
    // Chrome owns this dedicated process group; include its renderer children
    // so a deliberate crash does not leave them holding the profile or pipes.
    process.kill(-chrome.pid, signal);
    await exited;
  }
  chrome?.stdout?.destroy();
  chrome?.stderr?.destroy();
}

async function click(pattern, scope = 'document') {
  const button = await waitFor(() => evaluate(`(() => {
    const container = ${scope};
    const button = container && [...container.querySelectorAll('button')].find(b => !b.disabled && ${pattern}.test(b.textContent.trim()));
    if (!button) return null;
    button.scrollIntoView({block:'center'});
    const r = button.getBoundingClientRect();
    if (document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') !== button) return null;
    return {x:r.x + r.width / 2, y:r.y + r.height / 2};
  })()`), `button ${pattern}`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...button, button: 'left', clickCount: 1 }, sessionId);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...button, button: 'left', clickCount: 1 }, sessionId);
}

function snapshot() {
  return evaluate(`new Promise((resolve, reject) => {
    const request = indexedDB.open('keyval-store');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('keyval', 'readonly');
      const store = tx.objectStore('keyval');
      const keys = store.getAllKeys();
      const values = store.getAll();
      tx.oncomplete = () => {
        const entries = keys.result.map((key, i) => [key, values.result[i]]);
        const active = 'tour_de_home_active_ride_journal';
        db.close();
        resolve({ header: entries.find(([key]) => key === active)?.[1],
          samples: entries.filter(([key]) => String(key).startsWith(active + ':sample:')).sort((a,b) => Number(a[0].split(':').at(-1)) - Number(b[0].split(':').at(-1))).map(([,value]) => value),
          history: entries.filter(([key]) => String(key).startsWith('tour_de_home_completed_')).map(([,value]) => value),
          activeKeys: entries.filter(([key]) => String(key).startsWith(active)).length });
      };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  })`);
}

const recoveryScope = "document.querySelector('[aria-labelledby=crash-recovery-title]')";
async function awaitRecovery(minimum) {
  await waitFor(() => evaluate(`!!${recoveryScope}`), 'recovery dialog');
  const stored = await snapshot();
  assert.ok(stored.samples.length >= minimum);
  const text = await evaluate(`${recoveryScope}.textContent`);
  assert.ok(text.includes(`${stored.samples.length} samples`));
  return stored;
}

try {
  await startBrowser();
  await click('/^Demo Selected Route$/');
  await waitFor(async () => (await snapshot()).samples.length >= 3, 'three committed samples');
  const beforeStop = await snapshot();
  await stopBrowser('SIGKILL');
  await startBrowser();
  const recovered = await awaitRecovery(beforeStop.samples.length);
  assert.deepEqual(recovered.samples.slice(0, beforeStop.samples.length), beforeStop.samples);
  assert.equal(recovered.header.id, beforeStop.header.id);
  steps.push({ step: 'forced browser SIGKILL and restart', acknowledgedSamples: beforeStop.samples.length, recoveredSamples: recovered.samples.length, lost: 0 });

  await send('Page.reload', {}, sessionId);
  await pause(300);
  const reloaded = await awaitRecovery(recovered.samples.length);
  assert.deepEqual(reloaded.samples, recovered.samples);
  steps.push({ step: 'page reload', recoveredSamples: reloaded.samples.length, lost: 0 });
  await click('/^Resume /', recoveryScope);
  await click('/^Connect Trainer$/');
  await click('/Launch Mock Simulator/');
  await waitFor(() => evaluate("!document.querySelector('[aria-labelledby=connect-trainer-title]') && document.body.textContent.includes('Simulator')"), 'mock trainer connected and dialog closed');
  await click('/^Resume$/');
  await waitFor(async () => (await snapshot()).samples.length >= recovered.samples.length + 2, 'resumed samples');
  await click('/^Pause \\(Space\\)$/');
  const paused = await snapshot();
  await click('/^Finish$/');
  await waitFor(() => evaluate("!!document.querySelector('[aria-labelledby=ride-summary-title]')"), 'ride summary');
  const finished = await snapshot();
  assert.equal(finished.activeKeys, 0);
  assert.equal(finished.history.length, 1);
  assert.equal(finished.history[0].id, beforeStop.header.id);
  assert.ok(finished.history[0].samples.length >= paused.samples.length);
  assert.deepEqual(finished.history[0].samples.slice(0, recovered.samples.length), recovered.samples);
  assert.ok(finished.history[0].activeTimerSeconds >= paused.header.activeTimerSeconds);
  steps.push({ step: 'resume using MockTrainer and finish', completedSamples: finished.history[0].samples.length, retainedPrefixSamples: recovered.samples.length, activeKeysRemaining: 0, historyRecords: 1 });
  await send('Page.reload', {}, sessionId);
  await waitFor(() => evaluate("[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Demo Selected Route')"), 'home after finish');
  assert.equal(await evaluate(`!!${recoveryScope}`), false);
  steps.push({ step: 'reload after finish', recoveryPrompt: false });

  const report = { sourceManifestHash, sourceRevision: sourceManifestHash ? null : execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceDirty: sourceManifestHash ? false : Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()), measuredAt: new Date().toISOString(), browser: await send('Browser.getVersion'), transport: 'MockTrainer only; external browser requests blocked', steps };
  await writeFile(join(artifactRoot, 'ride-recovery.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ completedSteps: steps, visibleText: await evaluate('document.body.innerText').catch(() => null), storage: await snapshot().catch(() => null) }, null, 2));
  throw error;
} finally {
  await stopBrowser();
  server.close();
  server.closeAllConnections();
  await rm(profile, { recursive: true, force: true });
}

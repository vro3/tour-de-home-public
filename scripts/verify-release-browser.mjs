// Run after npm run build. Uses a temporary Chrome profile, MockTrainer, and a synthetic FTMS treadmill.
import assert from 'node:assert/strict';
import { makeFitActivity } from '../tests/fixtures/fitActivity.mjs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const root = resolve('dist');
const basePath = '/tour-de-home/';
const artifactRoot = resolve(process.env.TDH_BROWSER_ARTIFACTS || 'artifacts/browser');
await mkdir(artifactRoot, { recursive: true });
// A fresh download directory prevents a previous run's exports from passing this check.
const downloadRoot = await mkdtemp(join(artifactRoot, 'downloads-'));
const profile = await mkdtemp(join(tmpdir(), 'ride-recovery-ui-'));
const server = createServer(async (req, res) => {
  if (req.url === '/__telemetry') { res.writeHead(204).end(); return; }
  const originalPath = new URL(req.url, 'http://localhost').pathname;
  if (!originalPath.startsWith(basePath)) { res.writeHead(404).end(); return; }
  const pathname = '/' + originalPath.slice(basePath.length);
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
const pageErrors = [];
const failedLocalRequests = [];
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
    if (message.method === 'Runtime.exceptionThrown') pageErrors.push(message.params.exceptionDetails.text);
    if (message.method === 'Network.responseReceived' && message.params.response.url.startsWith(origin) && message.params.response.status >= 400) failedLocalRequests.push(message.params.response.url);
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params;
      const local = request.url.startsWith(origin + '/');
      void send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', local ? { requestId } : { requestId, errorReason: 'BlockedByClient' }, message.sessionId).catch(() => {});
    }
  });
  const target = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }));
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Network.enable', {}, sessionId);
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadRoot });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('tour_de_home_ride_view', 'scenic'); localStorage.setItem('tour_de_home_scenic_quality', 'efficient');" }, sessionId);
  await send('Page.navigate', { url: origin + basePath + '?scenicPerf=1' }, sessionId);
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

async function screenshot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  await writeFile(join(artifactRoot, name + '.png'), Buffer.from(data, 'base64'));
}

try {
  await startBrowser();
  await waitFor(() => evaluate("document.body?.innerText.includes('First Ride') ?? false"), 'sample library under hosting subpath');
  await screenshot('home-desktop');
  steps.push({ step: 'fresh start at /tour-de-home/', sampleLibraryLoaded: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
  await screenshot('home-narrow');
  await evaluate("document.documentElement.style.fontSize = '32px'");
  await evaluate('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))');
  await waitFor(() => evaluate('document.querySelector("main > div").scrollWidth <= document.querySelector("main > div").clientWidth + 1'), 'settled large-text home layout');
  await screenshot('home-large-text');
  assert.equal(await evaluate(`(() => {
    const [title, actions] = [...document.querySelector('header').children].map(element => element.getBoundingClientRect());
    return Math.min(title.right, actions.right) <= Math.max(title.left, actions.left)
      || Math.min(title.bottom, actions.bottom) <= Math.max(title.top, actions.top);
  })()`), true, 'Header title and actions must not overlap at enlarged text size');
  assert.equal(await evaluate('document.querySelector("main > div").scrollWidth <= document.querySelector("main > div").clientWidth + 1'), true, 'Home content must not require horizontal scrolling');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
  steps.push({ step: '360px viewport with 200% root text size', documentOverflow: false });
  await evaluate("document.documentElement.style.fontSize = ''");
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
  steps.push({ step: '360px home viewport', documentOverflow: false });
  await send('Emulation.setDeviceMetricsOverride', { width: 640, height: 450, deviceScaleFactor: 1, mobile: false }, sessionId);
  await click('/^Connect(?: Trainer)?$/');
  await screenshot('connection-small-viewport');
  assert.equal(await evaluate("!!document.querySelector('[aria-labelledby=connect-trainer-title]')"), true);
  await click('/^Cancel$/');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  await click('/^Ride this$/');
  await waitFor(() => evaluate("document.body.innerText.includes('Ready: First Ride')"), 'sample selection');
  await click('/^Demo Selected Route$/');
  await waitFor(() => evaluate("!!document.querySelector('.scenic-viewport canvas')"), 'scenic WebGL canvas');
  await waitFor(async () => (await snapshot()).samples.length >= 4, 'recorded demo samples');
  await screenshot('demo-scenic');
  const display = await evaluate("document.querySelector('.scenic-viewport').innerText");
  steps.push({ step: 'demo recording with original scenery', performanceOverlay: display, renderer: 'Headless Chrome software WebGL; not a hardware performance claim' });
  // Select an independently generated panoramic world to exercise its subpath assets.
  await evaluate(`(() => {
    const button = document.querySelector('[aria-label="Open ride controls"]');
    button?.click();
  })()`);
  await evaluate(`(() => {
    const style = document.querySelector('[aria-label="Scenic visual style"]');
    if (!style) throw new Error('Scenic style control missing');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(style, 'cinematic');
    style.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor(() => evaluate("document.body.innerText.includes('Verdant Tide')"), 'original cinematic world name');
  await pause(2000);
  await screenshot('demo-cinematic');
  await click('/^Pause(?: \\(Space\\))?$/');
  await click('/^Finish$/');
  await waitFor(() => evaluate("!!document.querySelector('[aria-labelledby=ride-summary-title]')"), 'saved ride summary');
  await click('/FIT/');
  await click('/TCX/');
  await waitFor(async () => {
    const { readdir } = await import('node:fs/promises');
    const names = await readdir(downloadRoot);
    return names.some(n => n.endsWith('.fit')) && names.some(n => n.endsWith('.tcx'));
  }, 'both export downloads');
  const { readdir } = await import('node:fs/promises');
  const { default: FitParser } = await import('fit-file-parser');
  const { XMLValidator } = await import('fast-xml-parser');
  const files = await readdir(downloadRoot);
  const fit = await readFile(join(downloadRoot, files.find(n => n.endsWith('.fit'))));
  const decoded = await new FitParser({ force: false, strict: true, mode: 'list' }).parseAsync(fit);
  assert.ok(decoded.records.length >= 4);
  const tcx = await readFile(join(downloadRoot, files.find(n => n.endsWith('.tcx'))), 'utf8');
  assert.equal(XMLValidator.validate(tcx), true);
  steps.push({ step: 'finish and download exports through actual UI', fitRecords: decoded.records.length, fitChecksums: 'valid', tcxXml: 'valid' });
  // Race the ride just saved through the real UI, without synthetic history injection.
  const firstRide = (await snapshot()).history[0];
  assert.ok(firstRide.samples.every(sample => Number.isFinite(sample.activeTimeSeconds)));
  await click('/^Back to Home$/');
  await waitFor(() => evaluate("!!document.querySelector('[aria-label=\"Previous ride to race\"]')"), 'saved ghost picker');
  await evaluate(`(() => {
    const select = document.querySelector('[aria-label="Previous ride to race"]');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(firstRide.id)});
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.scrollIntoView({block:'center'});
  })()`);
  await screenshot('race-picker');
  await click('/^Demo Selected Route$/');
  const raceState = () => evaluate(`(() => {
    const panel = document.querySelector('[aria-label="Race Yourself comparison"]');
    return panel && { seconds: Number(panel.dataset.raceSeconds), ghostDistance: panel.dataset.ghostDistance,
      gap: panel.querySelector('output').textContent };
  })()`);
  await waitFor(async () => Boolean(await raceState()), 'live ghost replay');
  await evaluate(`document.querySelector('[aria-label="Show simulator controls"]')?.click()`);
  await click('/^150W$/');
  await evaluate(`document.querySelector('[aria-label="Hide simulator controls"]')?.click()`);
  await waitFor(async () => (await raceState())?.seconds >= 4, 'visible opponent ahead');
  await screenshot('race-live');
  await click('/^Pause(?: \\(Space\\))?$/');
  await pause(150);
  const racePaused = await raceState();
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
  await evaluate("document.documentElement.style.fontSize = '32px'");
  await evaluate('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))');
  assert.equal(await evaluate(`(() => { const panel = document.querySelector('[aria-label="Race Yourself comparison"]'); return panel.scrollWidth <= panel.clientWidth + 1 && panel.getBoundingClientRect().right <= innerWidth; })()`), true);
  assert.equal(await evaluate(`(() => {
    const panel = document.querySelector('[aria-label="Race Yourself comparison"]').getBoundingClientRect();
    return [...document.querySelectorAll('button')].filter(button => /^(Resume|Finish)$/.test(button.textContent.trim())).every(button => {
      const r = button.getBoundingClientRect();
      return r.top >= panel.bottom && r.left >= 0 && r.right <= innerWidth
        && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === button;
    });
  })()`), true, 'Enlarged-text ride actions must be reachable without covering the race comparison');
  await screenshot('race-large-text');
  await evaluate("document.documentElement.style.fontSize = ''");
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  await pause(2500);
  assert.deepEqual(await raceState(), racePaused, 'Pause must freeze clock, ghost, and gap');
  await click('/^MAP$/');
  await waitFor(() => evaluate("!!document.querySelector('[aria-label=\"Your previous ride ghost\"]')"), 'map ghost marker');
  assert.deepEqual(await raceState(), racePaused, 'Changing views must not advance the race');
  await screenshot('race-map');
  await click('/^SCENIC$/');
  const checkpoint = await snapshot();
  assert.equal(checkpoint.header.raceAgainstId, firstRide.id);
  assert.ok(Math.abs(checkpoint.header.activeTimerSeconds - racePaused.seconds) < 0.002);
  await send('Page.reload', {}, sessionId);
  await waitFor(() => evaluate("!!document.querySelector('[aria-labelledby=crash-recovery-title]')"), 'race recovery dialog');
  await click('/^Resume /', 'document.querySelector(\'[aria-labelledby="crash-recovery-title"]\')');
  await waitFor(async () => Boolean(await raceState()), 'restored opponent');
  assert.deepEqual(await raceState(), racePaused, 'Recovery must restore exact race progress');
  await click('/^Connect Trainer$/');
  await click('/Launch Mock Simulator/');
  await waitFor(() => evaluate("!document.querySelector('[aria-labelledby=connect-trainer-title]')"), 'trainer reconnected');
  await pause(1500);
  assert.deepEqual(await raceState(), racePaused, 'Pairing must not advance the race');
  await click('/^Resume$/');
  await waitFor(async () => (await raceState()).seconds > racePaused.seconds + 1, 'resumed ghost clock');
  await click('/^Pause(?: \\(Space\\))?$/');
  await click('/^Finish$/');
  await waitFor(() => evaluate("!!document.querySelector('[aria-label=\"Race Yourself result\"]')"), 'race comparison summary');
  await screenshot('race-result');
  steps.push({ step: 'Race Yourself: saved ride selection, live ghost, pause, reload, reconnect, resume, result',
    opponentPreserved: true, mapGhostMarker: true, frozenDuringPauseAndPairing: true, restoredActiveSeconds: racePaused.seconds });
  await click('/^Back to Home$/');
  await waitFor(() => evaluate("!!document.querySelector('[aria-label=\"Original FIT file\"]')"), 'FIT import picker');
  const fixture = join(profile, 'Strava-original-treadmill.fit');
  await writeFile(fixture, new Uint8Array(makeFitActivity({ sport: 'running', gps: false })));
  const uploadFit = async () => {
    const { root: documentNode } = await send('DOM.getDocument', {}, sessionId);
    const { nodeId } = await send('DOM.querySelector', { nodeId: documentNode.nodeId, selector: '[aria-label="Original FIT file"]' }, sessionId);
    await send('DOM.setFileInputFiles', { nodeId, files: [fixture] }, sessionId);
    await waitFor(() => evaluate("document.body.innerText.includes('Ready to race:')"), 'FIT imported and saved');
  };
  await uploadFit();
  let imported = (await snapshot()).history.filter(ride => ride.importedFromFit);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].activeTimerSeconds, 20);
  assert.equal(imported[0].route.totalDistanceMeters, 60);
  assert.equal(imported[0].route.synthetic, true);
  await uploadFit();
  assert.equal((await snapshot()).history.filter(ride => ride.importedFromFit).length, 1, 'Same FIT must not duplicate history');
  await send('Page.reload', {}, sessionId);
  await waitFor(() => evaluate("!!document.querySelector('[aria-label=\"Saved imported activities\"] option[value^=\"fit_\"]')"), 'saved FIT after reload');
  await evaluate(`(() => {
    const select = document.querySelector('[aria-label="Saved imported activities"]');
    select.value = ${JSON.stringify(imported[0].id)}; select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor(() => evaluate("!!document.querySelector('[aria-label=\"Previous ride to race\"]')?.value"), 'imported opponent selected');
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
  await evaluate("document.documentElement.style.fontSize = '32px'");
  await evaluate('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))');
  await waitFor(() => evaluate('document.querySelector("main > div").scrollWidth <= document.querySelector("main > div").clientWidth + 1'), 'FIT picker at 360px and doubled text');
  await evaluate("document.querySelector('[aria-label=\"Import a Strava activity\"]').scrollIntoView()");
  await screenshot('fit-import-ready');
  await evaluate("document.documentElement.style.fontSize = ''");
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  // Exercise the real treadmill adapter against an isolated in-page FTMS device double.
  await evaluate(`(() => {
    const data = new EventTarget();
    data.startNotifications = async () => data; data.stopNotifications = async () => data;
    const device = new EventTarget(); device.name = 'Test FTMS Treadmill';
    const server = { getPrimaryService: async uuid => { if (uuid !== 0x1826) throw Error('Unexpected service'); return {
      getCharacteristic: async uuid => { if (uuid !== 0x2acd) throw Error('Treadmill must never request control'); return data; }
    }; } };
    device.gatt = { connect: async () => server, disconnect: () => {} };
    Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { requestDevice: async () => device } });
    window.testBelt = speed => { const value = new DataView(new ArrayBuffer(4)); value.setUint16(2, Math.round(speed * 100), true); data.value = value; data.dispatchEvent(new Event('characteristicvaluechanged')); };
    window.testDrop = () => device.dispatchEvent(new Event('gattserverdisconnected'));
  })()`);
  await click('/^Connect Trainer$/');
  await click('/Connect FTMS Treadmill/');
  await waitFor(() => evaluate("!document.querySelector('[aria-labelledby=connect-trainer-title]')"), 'FTMS treadmill connected');
  await click('/^LOAD COURSE$/');
  await evaluate('window.beltTimer = setInterval(() => window.testBelt(7.2), 200)');
  await waitFor(async () => (await raceState())?.seconds >= 2, 'treadmill movement and ghost');
  await evaluate('clearInterval(window.beltTimer); window.testBelt(0)');
  await waitFor(() => evaluate("[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Resume')"), 'belt stop pauses race');
  const stoppedBelt = await raceState();
  const beltCheckpoint = await snapshot();
  assert.equal(beltCheckpoint.header.sport, 'running');
  assert.ok(Math.abs(beltCheckpoint.header.totalDistanceMeters - stoppedBelt.seconds * 2) < 0.05, '7.2 km/h must advance 2 meters per second without cycling physics');
  await pause(1200);
  assert.deepEqual(await raceState(), stoppedBelt);
  await evaluate('window.testDrop()');
  await pause(1400);
  await evaluate('window.beltTimer = setInterval(() => window.testBelt(7.2), 200)');
  await pause(500);
  assert.deepEqual(await raceState(), stoppedBelt, 'Reconnection must not restart the treadmill comparison');
  await screenshot('treadmill-paused');
  await click('/^Resume$/');
  await waitFor(async () => (await raceState()).seconds > stoppedBelt.seconds + 1, 'treadmill resume');
  await evaluate('clearInterval(window.beltTimer)');
  await waitFor(() => evaluate("document.body.innerText.includes('speed signal is stale')"), 'stale speed pauses race');
  const staleBelt = await raceState();
  await pause(500);
  assert.deepEqual(await raceState(), staleBelt);
  await click('/^Finish$/');
  await waitFor(() => evaluate("/RUN COMPLETE/i.test(document.body.innerText)"), 'running summary');
  await screenshot('treadmill-result');
  steps.push({ step: 'FIT import and treadmill sync', pauseSecondsExcluded: 20, activeSeconds: 20,
    deduplicatedImport: true, retainedAfterReload: true, beltSpeedDrivesDistance: true,
    stopReconnectAndStaleSignalFreezeComparison: true, noTreadmillControlRequested: true });
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(failedLocalRequests, []);
  const report = { sourceManifestHash, measuredAt: new Date().toISOString(), browser: await send('Browser.getVersion'), steps, pageErrors, failedLocalRequests, hardware: 'Not tested; MockTrainer and an FTMS treadmill device double only' };
  await writeFile(join(artifactRoot, 'public-release.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await screenshot('failure').catch(() => {});
  console.error(JSON.stringify({ steps, pageErrors, failedLocalRequests, visibleText: await evaluate('document.body.innerText').catch(() => null), overflowBoxes: await evaluate(`Array.from(document.querySelectorAll('main, main *')).filter(el => el.clientWidth && el.scrollWidth > el.clientWidth + 1).map(el => ({tag:el.tagName, text:el.textContent.slice(0,60), width:el.clientWidth, scroll:el.scrollWidth, className:el.className})).slice(-20)`).catch(() => null), overflowingElements: await evaluate(`Array.from(document.querySelectorAll('main *')).filter(el => el.getBoundingClientRect().right > innerWidth + 1).slice(-30).map(el => ({ tag: el.tagName, text: el.textContent.slice(0, 80), className: el.className, right: el.getBoundingClientRect().right }))`).catch(() => null) }, null, 2));
  throw error;
} finally {
  await stopBrowser();
  server.close();
  server.closeAllConnections();
  await rm(profile, { recursive: true, force: true });
}

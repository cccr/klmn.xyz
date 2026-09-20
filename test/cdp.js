'use strict';
// Chrome DevTools Protocol driver for layout assertions.
//
// jsdom has no layout engine — offsetHeight is always 0 and
// getBoundingClientRect() always returns zeros — so every test in
// mass-qr.test.js is blind to where things actually land on the sheet. That
// blindness is why codes were misaligned across a row through a green suite.
// This drives real Chrome and measures real boxes.
//
// Node 26 ships a global WebSocket, so the CDP client needs no dependency.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { SITE } = require('./harness');

const PORT = 9222 + (process.pid % 500);
const SITE_PORT = 8700 + (process.pid % 90);

function resolveChrome() {
  if (process.env.CHROME) return fs.existsSync(process.env.CHROME) ? process.env.CHROME : null;
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (fs.existsSync(mac)) return mac;
  for (const bin of ['google-chrome', 'chromium', 'chromium-browser']) {
    try {
      const found = execFileSync('which', [bin], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (found) return found;
    } catch (e) { /* not on PATH */ }
  }
  return null;
}

const CHROME = resolveChrome();

function hashFor(state) {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let booted = null;

async function boot() {
  if (booted) return booted;
  const server = spawn('python3', ['-m', 'http.server', String(SITE_PORT)], { cwd: SITE, stdio: 'ignore' });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'massqr-cdp-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1400,1000', 'about:blank'
  ], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) { booted = { server, chrome, profile }; return booted; }
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Chrome did not expose a debugging port');
}

// One WebSocket per tab, with id-matched request/response.
function connect(url) {
  const ws = new WebSocket(url);
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
  });
  const ready = new Promise((res) => ws.addEventListener('open', res));
  return {
    ready,
    send(method, params) {
      const id = ++seq;
      return new Promise((res, rej) => {
        pending.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params: params || {} }));
      });
    },
    close() { ws.close(); }
  };
}

async function withSheet(state, fn) {
  await boot();
  const url = `http://localhost:${SITE_PORT}/tools/mass-qr/#s=${hashFor(state)}`;
  const tab = await (await fetch(
    `http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const c = connect(tab.webSocketDebuggerUrl);
  await c.ready;
  await c.send('Page.enable');
  await c.send('Network.enable');
  // Tailwind's CDN script rewrites styles after load; 2s is comfortably past
  // it on this machine and in CI, and the alternative (polling for a sentinel)
  // would need a hook in the page that exists only for tests.
  await new Promise((r) => setTimeout(r, 2000));
  const page = {
    async evalJson(expr) {
      const r = await c.send('Runtime.evaluate',
        { expression: `JSON.stringify(${expr})`, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' evaluating: ' + expr);
      return JSON.parse(r.result.value);
    },
    async setViewport(width, height) {
      await c.send('Emulation.setDeviceMetricsOverride',
        { width, height, deviceScaleFactor: 1, mobile: false });
      await c.send('Runtime.evaluate', { expression: "window.dispatchEvent(new Event('resize'))" });
      await new Promise((r) => setTimeout(r, 300));
    },
    async screenshot() {
      const r = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      return Buffer.from(r.data, 'base64');
    },
    // Evaluates print-only rules without going through printToPDF, so a test
    // can assert on the styles the printer sees rather than inferring them
    // from a page count. Pass '' to go back to screen.
    async emulateMedia(media) {
      await c.send('Emulation.setEmulatedMedia', { media: media });
    },
    async blockUrls(urls) {
      await c.send('Network.setBlockedURLs', { urls });
      await c.send('Page.reload');
      await new Promise((r) => setTimeout(r, 2000));
    },
    async printToPDF(opts) {
      const r = await c.send('Page.printToPDF', Object.assign(
        { printBackground: true, preferCSSPageSize: true,
          marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 }, opts || {}));
      return Buffer.from(r.data, 'base64');
    }
  };
  try {
    return await fn(page);
  } finally {
    c.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`);
  }
}

async function closeAll() {
  if (!booted) return;
  const { chrome, server, profile } = booted;
  booted = null;
  // Wait for the process to actually exit: Chrome is still flushing its
  // profile directory when kill() returns, so removing it immediately races
  // the flush and throws ENOTEMPTY.
  const exited = new Promise((res) => chrome.once('exit', res));
  chrome.kill();
  server.kill();
  await Promise.race([exited, new Promise((res) => setTimeout(res, 3000))]);
  // A leftover temp profile is litter, not a test failure.
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* best effort */ }
}

module.exports = { withSheet, hashFor, closeAll, CHROME };

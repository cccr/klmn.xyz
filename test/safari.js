'use strict';
// Minimal W3C WebDriver client for Safari. safaridriver speaks plain HTTP+JSON,
// so this needs no dependency — but note it does NOT implement the /print
// endpoint, so print behaviour can only be observed by forcing the print
// stylesheet on and measuring layout. Pagination and @page are not reachable.
// Requires a one-time `sudo safaridriver --enable`.
const { spawn } = require('child_process');
const { SITE } = require('./harness');

const PORT = 4610, SITE_PORT = 8772;
const B = `http://127.0.0.1:${PORT}`;
const post = async (p, b) => (await fetch(B + p, { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) })).json();
const del = async (p) => (await fetch(B + p, { method: 'DELETE' })).json();

function hashFor(state) {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function available() {
  try {
    const drv = spawn('safaridriver', ['-p', String(PORT)], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 1200));
    const s = await post('/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
    const sid = s.value && s.value.sessionId;
    if (sid) await del(`/session/${sid}`);
    drv.kill();
    return !!sid;
  } catch (e) { return false; }
}

// Opens a sheet in real Safari and runs `script` (a function body returning a
// JSON-serialisable value). `forcePrint` re-applies every @media print rule as
// an unconditional stylesheet first, which is the closest this driver can get
// to observing print layout.
async function withSheet(state, script, opts) {
  opts = opts || {};
  const site = spawn('python3', ['-m', 'http.server', String(SITE_PORT)],
    { cwd: SITE, stdio: 'ignore' });
  const drv = spawn('safaridriver', ['-p', String(PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  let sid;
  try {
    sid = (await post('/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } }))
      .value.sessionId;
    await post(`/session/${sid}/url`,
      { url: `http://localhost:${SITE_PORT}/tools/mass-qr/#s=${hashFor(state)}` });
    await new Promise((r) => setTimeout(r, 2000));
    if (opts.forcePrint) {
      await post(`/session/${sid}/execute/sync`, { script: FORCE_PRINT, args: [] });
      await new Promise((r) => setTimeout(r, 400));
    }
    const r = await post(`/session/${sid}/execute/sync`, { script, args: [] });
    if (r.value && r.value.error) throw new Error(JSON.stringify(r.value));
    return typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
  } finally {
    if (sid) await del(`/session/${sid}`).catch(() => {});
    drv.kill(); site.kill();
  }
}

// Lifts every `@media print` block into an unconditional <style>.
const FORCE_PRINT = `
  var out = [];
  for (var i = 0; i < document.styleSheets.length; i++) {
    var sheet = document.styleSheets[i], rules;
    try { rules = sheet.cssRules; } catch (e) { continue; }
    for (var j = 0; j < rules.length; j++) {
      var rule = rules[j];
      if (rule.type === 4 && /print/.test(rule.conditionText || rule.media.mediaText)) {
        for (var k = 0; k < rule.cssRules.length; k++) out.push(rule.cssRules[k].cssText);
      }
    }
  }
  var el = document.createElement('style');
  el.id = 'forced-print';
  el.textContent = out.join('\\n');
  document.head.appendChild(el);
  return out.length;
`;

module.exports = { withSheet, available, hashFor };

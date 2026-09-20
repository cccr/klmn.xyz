'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { JSDOM, VirtualConsole } = require('jsdom');
const jsQR = require('jsqr');

// Forward real console output (including genuine page script exceptions),
// but drop jsdom's own environmental noise — e.g. "not implemented" for
// anchor-click navigation to a blob: URL during a download, or CSS parsing
// complaints about Tailwind utility classes in inline <style> blocks. None
// of that reflects a page bug.
const virtualConsole = new VirtualConsole();
virtualConsole.forwardTo(console, { jsdomErrors: ['unhandled-exception'] });

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'public');

function buildSite() {
  execFileSync('hugo', ['--quiet', '--source', ROOT], { stdio: 'inherit' });
}

function hexToRgb(h) {
  return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)];
}

// Minimal 2d context: only fillStyle + fillRect, which is all the tools use.
function attachCanvas(window, canvas) {
  let ctx = null;
  Object.defineProperty(canvas, 'width', { get() { return this._w || 0; }, set(v) { this._w = v; this._buf = null; } });
  Object.defineProperty(canvas, 'height', { get() { return this._h || 0; }, set(v) { this._h = v; this._buf = null; } });
  canvas.getContext = function () {
    if (ctx) return ctx;
    ctx = {
      fillStyle: '#000000',
      fillRect(x, y, w, h) {
        const W = canvas.width, H = canvas.height;
        if (!canvas._buf || canvas._buf.length !== W * H * 4) canvas._buf = new Uint8ClampedArray(W * H * 4);
        const [r, g, b] = hexToRgb(this.fillStyle);
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const i = (yy * W + xx) * 4;
          canvas._buf[i] = r; canvas._buf[i + 1] = g; canvas._buf[i + 2] = b; canvas._buf[i + 3] = 255;
        }
      }
    };
    return ctx;
  };
  canvas.toBlob = (cb) => cb({ __png: true });
}

function decodeCanvas(canvas) {
  if (!canvas.width || !canvas._buf) return null;
  const res = jsQR(canvas._buf, canvas.width, canvas.height);
  return res && res.data;
}

// Rasterizes the "M x,y h1v1h-1z" path format our renderer emits, then decodes it.
function decodeSvgString(svg, scale) {
  scale = scale || 6;
  const n = parseInt(svg.match(/viewBox="0 0 (\d+) \1"/i)[1], 10);
  const bg = hexToRgb(svg.match(/<rect[^>]*fill="(#[0-9a-fA-F]{6})"/i)[1]);
  const fg = hexToRgb(svg.match(/<path[^>]*fill="(#[0-9a-fA-F]{6})"/)[1]);
  const W = n * scale;
  const buf = new Uint8ClampedArray(W * W * 4);
  for (let i = 0; i < W * W; i++) { buf[i * 4] = bg[0]; buf[i * 4 + 1] = bg[1]; buf[i * 4 + 2] = bg[2]; buf[i * 4 + 3] = 255; }
  const d = svg.match(/<path d="([^"]*)"/i)[1];
  const re = /M(\d+),(\d+)h1v1h-1z/g;
  let m;
  while ((m = re.exec(d))) {
    const x = +m[1] * scale, y = +m[2] * scale;
    for (let yy = y; yy < y + scale; yy++) for (let xx = x; xx < x + scale; xx++) {
      const i = (yy * W + xx) * 4;
      buf[i] = fg[0]; buf[i + 1] = fg[1]; buf[i + 2] = fg[2];
    }
  }
  const res = jsQR(buf, W, W);
  return res && res.data;
}

// Loads a built page and runs its scripts. External srcs resolve against public/.
// opts.hash: fragment to land with (no leading '#'), e.g. 's=abc123' or a
//   deliberately garbage value — exercises the location.hash.match(...) path
//   a shared link takes, which a bare 'http://localhost/' url never touches.
// opts.localStorage: value to seed into localStorage.massQr before the
//   page's inline script runs, for the no-hash/stored-sheet fallback path.
function loadPage(relPath, opts) {
  opts = opts || {};
  const file = path.join(SITE, relPath);
  const html = fs.readFileSync(file, 'utf8');
  const url = 'http://localhost/' + (opts.hash ? '#' + opts.hash : '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url, virtualConsole });
  const { window } = dom;
  const doc = window.document;

  // jsdom does not expose these on window; the state codec needs them.
  window.TextEncoder = TextEncoder;
  window.TextDecoder = TextDecoder;

  if (opts.localStorage !== undefined) {
    window.localStorage.setItem('massQr', opts.localStorage);
  }

  const canvas = doc.querySelector('canvas');
  if (canvas) attachCanvas(window, canvas);

  // External scripts first, in document order, then inline ones.
  // qrcodegen.js declares `var qrcodegen` under "use strict", which a strict
  // eval scopes locally — re-export it so page scripts can see it.
  const EXPOSE = ';if(typeof qrcodegen!=="undefined"){window.qrcodegen=qrcodegen;}';
  doc.querySelectorAll('script[src]').forEach((s) => {
    const src = s.getAttribute('src');
    if (/^(?:[a-z]+:)?\/\//i.test(src)) return; // skip CDN scripts (e.g. Tailwind) — irrelevant to page logic
    window.eval(fs.readFileSync(path.join(SITE, src.replace(/^\//, '')), 'utf8') + EXPOSE);
  });
  doc.querySelectorAll('script:not([src])').forEach((s) => window.eval(s.textContent));

  const $ = (id) => doc.getElementById(id);
  const setInput = (el, v) => { el.value = v; el.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const click = (el) => el.dispatchEvent(new window.Event('click', { bubbles: true }));

  return { dom, window, doc, $, setInput, click, canvas };
}

module.exports = { buildSite, loadPage, attachCanvas, decodeCanvas, decodeSvgString, hexToRgb, SITE, ROOT };

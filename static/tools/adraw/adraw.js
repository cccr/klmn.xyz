/* ══ Abstract Drawing ══════════════════════════════════════════════════════
   The page over adraw's engine, which runs in the browser as WebAssembly.
   adrawFetch (from wasm.js) answers the same JSON API as adraw's own
   server, so this file knows nothing about any one pattern: the pattern
   list, the sliders and the thumbnails all come from what the engine
   reports about itself.

   The address bar mirrors every setting, in the same query format the
   engine takes, so any drawing is a shareable link.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var PAGE_PRESETS = [
        { label: 'A4 landscape', w: 297, h: 210 },
        { label: 'A4 portrait',  w: 210, h: 297 },
        { label: 'A3 landscape', w: 420, h: 297 },
        { label: 'A3 portrait',  w: 297, h: 420 },
        { label: 'A5 landscape', w: 210, h: 148 },
        { label: 'Square',       w: 210, h: 210 },
        { label: 'Letter',       w: 279, h: 216 }
    ];
    var DEFAULT_PAGE = PAGE_PRESETS[0];

    var els = {
        patch:      document.getElementById('patch'),
        patchDesc:  document.getElementById('patchDesc'),
        seed:       document.getElementById('seed'),
        btnShuffle: document.getElementById('btnShuffle'),
        params:     document.getElementById('params'),
        pagePreset: document.getElementById('pagePreset'),
        pageW:      document.getElementById('pageW'),
        pageH:      document.getElementById('pageH'),
        btnRotate:  document.getElementById('btnRotate'),
        btnSvg:     document.getElementById('btnSvg'),
        btnGcode:   document.getElementById('btnGcode'),
        btnPrint:   document.getElementById('btnPrint'),
        btnReset:   document.getElementById('btnReset'),
        bed:        document.getElementById('bed'),
        canvas:     document.getElementById('canvas'),
        specPatch:  document.getElementById('specPatch'),
        specPaths:  document.getElementById('specPaths'),
        specPage:   document.getElementById('specPage'),
        specTime:   document.getElementById('specTime'),
        notice:     document.getElementById('notice'),
        patterns:   document.getElementById('patterns'),
        printArea:  document.getElementById('printArea')
    };

    var patches = [];      // every pattern and its parameter specs
    var categories = [];   // the thumbnail sheet's groups
    var current = null;    // the pattern being drawn
    var lastFrame = null;  // kept for printing
    var busy = false;
    var pending = false;

    function cssVar(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    function patchByName(name) {
        for (var i = 0; i < patches.length; i++) if (patches[i].name === name) return patches[i];
        return null;
    }

    function api(path) {
        return window.adrawFetch(path).then(function (res) {
            if (res.ok) return res;
            return res.json().then(function (body) { throw new Error(body.error || res.statusText); });
        });
    }

    function showError(err) {
        els.notice.textContent = err ? err.message : '';
        els.notice.classList.toggle('hidden', !err);
    }

    /* ── Drawing ───────────────────────────────────────────────── */

    // Shared by the big canvas and every thumbnail, so a thumbnail cannot
    // drift from what the pattern draws. One Path2D stroked once: a stroke()
    // per path costs far more when there are thousands of them.
    function paint(canvas, frame, boxW, boxH, lineWidth) {
        var scale = Math.min(boxW / frame.width, boxH / frame.height);
        var dpr = window.devicePixelRatio || 1;
        var w = Math.max(1, Math.round(frame.width * scale));
        var h = Math.max(1, Math.round(frame.height * scale));
        var c = canvas.getContext('2d');

        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);

        c.setTransform(1, 0, 0, 1, 0, 0);
        c.fillStyle = cssVar('--paper');
        c.fillRect(0, 0, canvas.width, canvas.height);

        c.setTransform(scale * dpr, 0, 0, scale * dpr,
                       -frame.minX * scale * dpr, -frame.minY * scale * dpr);
        c.strokeStyle = cssVar('--ink');
        c.lineWidth = lineWidth;
        c.lineJoin = 'round';
        c.lineCap = 'round';

        var all = new Path2D();
        frame.paths.forEach(function (flat, i) {
            if (flat.length < 4) return;
            all.moveTo(flat[0], flat[1]);
            for (var j = 2; j < flat.length; j += 2) all.lineTo(flat[j], flat[j + 1]);
            if (frame.closed[i]) all.closePath();
        });
        c.stroke(all);
        return { w: w, h: h };
    }

    // The box comes from the bed and the window, never from the canvas, so a
    // redraw cannot feed its own size back into the next one.
    function canvasBox() {
        var trimPad = 40;
        var w = Math.max(160, els.bed.clientWidth - trimPad - parseFloat(getComputedStyle(els.bed).paddingLeft || 0));
        var h = Math.max(160, Math.min(window.innerHeight * 0.75, 1000));
        return { w: w, h: h };
    }

    /* ── Paper ─────────────────────────────────────────────────── */

    function clampPage(v) { return Math.min(2000, Math.max(10, Math.round(v))); }

    function pageSize() {
        var w = parseFloat(els.pageW.value), h = parseFloat(els.pageH.value);
        if (!isFinite(w) || !isFinite(h)) return { w: DEFAULT_PAGE.w, h: DEFAULT_PAGE.h };
        return { w: clampPage(w), h: clampPage(h) };
    }

    // The dropdown follows the numbers, so typing 210 × 297 by hand selects
    // A4 portrait rather than leaving a stale preset showing.
    function syncPreset() {
        var p = pageSize();
        els.pagePreset.value = 'custom';
        PAGE_PRESETS.forEach(function (preset, i) {
            if (preset.w === p.w && preset.h === p.h) els.pagePreset.value = String(i);
        });
    }

    function setPage(w, h) {
        els.pageW.value = clampPage(w);
        els.pageH.value = clampPage(h);
        syncPreset();
    }

    function buildPresets() {
        PAGE_PRESETS.forEach(function (p, i) {
            var opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = p.label;
            els.pagePreset.appendChild(opt);
        });
        var custom = document.createElement('option');
        custom.value = 'custom';
        custom.textContent = 'Custom';
        els.pagePreset.appendChild(custom);
    }

    /* ── Parameters ────────────────────────────────────────────── */

    // A range slider only produces min + k·step, so an arbitrary step makes
    // round values unreachable — (60 − 5) / 200 never lands on 30. Rounding
    // the step to 1, 2 or 5 × 10ⁿ keeps about two hundred positions while
    // making every value a person would type reachable.
    function sliderStep(spec) {
        if (spec.step) return spec.step;
        var raw = (spec.max - spec.min) / 200;
        var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
        var steps = [1, 2, 5];
        for (var i = 0; i < steps.length; i++) if (steps[i] * mag >= raw) return steps[i] * mag;
        return 10 * mag;
    }

    function quantize(spec, v) {
        var step = sliderStep(spec);
        var places = Math.max(0, -Math.floor(Math.log(step) / Math.LN10 + 1e-9));
        return parseFloat((Math.round(v / step) * step).toFixed(places));
    }

    function decimals(spec) {
        if (spec.step >= 1) return 0;
        return (spec.max - spec.min) <= 2 ? 2 : 1;
    }

    function showValue(spec, slider, out) {
        var v = quantize(spec, parseFloat(slider.value));
        out.firstChild.textContent = v.toFixed(decimals(spec));
    }

    function buildParams() {
        var patch = patchByName(current);
        els.patchDesc.textContent = patch.description;
        els.params.innerHTML = '';

        patch.params.forEach(function (spec) {
            var id = 'p-' + spec.key;

            var field = document.createElement('div');
            field.className = 'field field-tight';
            field.title = spec.description;

            var label = document.createElement('label');
            label.htmlFor = id;
            label.textContent = spec.label;

            var out = document.createElement('span');
            out.className = 'field-value';
            out.appendChild(document.createElement('span'));
            if (spec.unit) {
                var unit = document.createElement('span');
                unit.className = 'unit';
                unit.textContent = spec.unit;
                out.appendChild(unit);
            }

            var slider = document.createElement('input');
            slider.type = 'range';
            slider.id = id;
            slider.className = 'rail-range';
            slider.min = spec.min;
            slider.max = spec.max;
            slider.step = sliderStep(spec);
            slider.value = spec.default;
            slider.setAttribute('data-key', spec.key);
            slider.refresh = function () { showValue(spec, slider, out); };
            slider.addEventListener('input', function () { slider.refresh(); draw(); });

            field.appendChild(label);
            field.appendChild(out);
            els.params.appendChild(field);
            els.params.appendChild(slider);
            slider.refresh();
        });
    }

    function query() {
        var p = pageSize();
        var q = new URLSearchParams();
        q.set('patch', current);
        q.set('seed', els.seed.value || '1');
        q.set('page', p.w + 'x' + p.h);
        var patch = patchByName(current);
        Array.prototype.forEach.call(els.params.querySelectorAll('input[type="range"]'), function (s) {
            var key = s.getAttribute('data-key');
            var spec = patch.params.filter(function (x) { return x.key === key; })[0];
            q.set(key, quantize(spec, parseFloat(s.value)));
        });
        return q;
    }

    function selectPatch(name) {
        current = name;
        els.patch.value = name;
        buildParams();
        Array.prototype.forEach.call(els.patterns.querySelectorAll('.pattern-tile'), function (t) {
            t.classList.toggle('is-on', t.getAttribute('data-patch') === name);
        });
    }

    // Unknown keys and out-of-range values are ignored, not rejected, so a
    // hand-edited or truncated link still opens a drawing.
    function applyURL() {
        var q = new URLSearchParams(location.search);
        var name = q.get('patch');
        // With no pattern named, open on the first one the thumbnail sheet
        // shows, so adraw.json decides what a visitor sees first.
        var first = categories.length ? categories[0].patches[0].name : patches[0].name;
        selectPatch(patchByName(name) ? name : first);

        var seed = q.get('seed');
        if (seed !== null && isFinite(+seed) && seed !== '') els.seed.value = seed;

        var page = (q.get('page') || '').split('x');
        if (page.length === 2 && isFinite(+page[0]) && isFinite(+page[1]) && page[0] && page[1]) {
            setPage(+page[0], +page[1]);
        } else {
            setPage(DEFAULT_PAGE.w, DEFAULT_PAGE.h);
        }

        var patch = patchByName(current);
        Array.prototype.forEach.call(els.params.querySelectorAll('input[type="range"]'), function (s) {
            var raw = q.get(s.getAttribute('data-key'));
            if (raw === null || raw === '' || !isFinite(+raw)) return;
            var spec = patch.params.filter(function (x) { return x.key === s.getAttribute('data-key'); })[0];
            s.value = Math.min(spec.max, Math.max(spec.min, +raw));
            s.refresh();
        });
    }

    /* ── Rendering ─────────────────────────────────────────────── */

    // Coalesced: while a frame is being drawn, remember that another is
    // wanted and draw exactly one more when it lands, so dragging a slider
    // costs one frame per frame rather than one per pixel.
    function draw() {
        if (!current) return;
        if (busy) { pending = true; return; }
        busy = true;

        var q = query();
        var started = performance.now();
        api('/api/render?' + q).then(function (res) { return res.json(); }).then(function (frame) {
            lastFrame = frame;
            var box = canvasBox();
            var size = paint(els.canvas, frame, box.w, box.h, 0.3);
            els.canvas.style.width = size.w + 'px';

            els.specPatch.textContent = current;
            els.specPaths.textContent = String(frame.paths.length);
            els.specPage.textContent = frame.width + ' × ' + frame.height + ' mm';
            els.specTime.textContent = Math.round(performance.now() - started) + ' ms';
            history.replaceState(null, '', '?' + q);
            showError(null);
        }).catch(showError).then(function () {
            busy = false;
            if (pending) { pending = false; draw(); }
        });
    }

    /* ── Thumbnails ────────────────────────────────────────────── */

    function buildPatterns() {
        els.patterns.innerHTML = '';
        var queue = [];

        categories.forEach(function (cat) {
            var group = document.createElement('section');
            group.className = 'patterns-group';
            var h = document.createElement('h2');
            h.textContent = cat.name;
            group.appendChild(h);
            if (cat.description) {
                var p = document.createElement('p');
                p.textContent = cat.description;
                group.appendChild(p);
            }

            var grid = document.createElement('div');
            grid.className = 'patterns-grid';
            cat.patches.forEach(function (tile) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'pattern-tile';
                btn.setAttribute('data-patch', tile.name);
                btn.title = tile.description;

                var canvas = document.createElement('canvas');
                canvas.className = 'artifact';
                var name = document.createElement('span');
                name.textContent = tile.name;

                btn.appendChild(canvas);
                btn.appendChild(name);
                btn.addEventListener('click', function () {
                    selectPatch(tile.name);
                    draw();
                    els.canvas.scrollIntoView({ behavior: 'smooth', block: 'center' });
                });
                grid.appendChild(btn);
                queue.push({ canvas: canvas, tile: tile });
            });
            group.appendChild(grid);
            els.patterns.appendChild(group);
        });

        // One at a time, each in its own task, starting after the main drawing:
        // the engine runs on the main thread, so drawing them all at once would
        // freeze the page before the drawing you came for appears.
        setTimeout(function next() {
            var job = queue.shift();
            if (!job) return;
            var q = new URLSearchParams();
            q.set('patch', job.tile.name);
            q.set('seed', job.tile.previewSeed);
            Object.keys(job.tile.preview || {}).forEach(function (k) { q.set(k, job.tile.preview[k]); });
            api('/api/render?' + q).then(function (res) { return res.json(); }).then(function (frame) {
                paint(job.canvas, frame, 280, 198, 0.5);
            }).catch(function () { /* a missing thumbnail is not worth a notice */ }).then(function () {
                setTimeout(next, 0);
            });
        }, 0);
    }

    /* ── Export ────────────────────────────────────────────────── */

    function saveBlob(blob, filename) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    // The engine names the file and records the pattern, seed and every
    // setting inside it, so a saved drawing can always be reproduced.
    function download(format) {
        var q = query();
        q.set('format', format);
        var name = 'drawing.' + format;
        api('/api/export?' + q).then(function (res) {
            var m = /filename=([^;]+)/.exec(res.headers.get('Content-Disposition') || '');
            if (m) name = m[1];
            return res.blob();
        }).then(function (blob) { saveBlob(blob, name); }).catch(showError);
    }

    /* ── Print ─────────────────────────────────────────────────── */

    function frameToSVG(frame, strokeWidth) {
        var parts = [];
        frame.paths.forEach(function (flat, i) {
            if (flat.length < 4) return;
            var d = 'M' + flat[0] + ' ' + flat[1];
            for (var j = 2; j < flat.length; j += 2) d += 'L' + flat[j] + ' ' + flat[j + 1];
            if (frame.closed[i]) d += 'Z';
            parts.push('<path d="' + d + '"/>');
        });
        return '<svg xmlns="http://www.w3.org/2000/svg" ' +
            'width="' + frame.width + 'mm" height="' + frame.height + 'mm" ' +
            'viewBox="' + frame.minX + ' ' + frame.minY + ' ' + frame.width + ' ' + frame.height + '">' +
            '<g fill="none" stroke="#000" stroke-width="' + strokeWidth + '" ' +
            'stroke-linejoin="round" stroke-linecap="round">' + parts.join('') + '</g></svg>';
    }

    function preparePrint() { if (lastFrame) els.printArea.innerHTML = frameToSVG(lastFrame, 0.3); }
    function clearPrint() { els.printArea.innerHTML = ''; }

    window.addEventListener('beforeprint', preparePrint);
    window.addEventListener('afterprint', clearPrint);
    // Safari has historically not fired beforeprint; the media query covers it.
    if (window.matchMedia) {
        var mq = window.matchMedia('print');
        var onChange = function (e) { if (e.matches) preparePrint(); else clearPrint(); };
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else if (mq.addListener) mq.addListener(onChange);
    }

    /* ── Wiring ────────────────────────────────────────────────── */

    els.patch.addEventListener('change', function () { selectPatch(els.patch.value); draw(); });
    els.seed.addEventListener('input', draw);
    els.btnShuffle.addEventListener('click', function () {
        els.seed.value = Math.floor(Math.random() * 1e6);
        draw();
    });
    els.pagePreset.addEventListener('change', function () {
        var p = PAGE_PRESETS[+els.pagePreset.value];
        if (p) { setPage(p.w, p.h); draw(); }
    });
    [els.pageW, els.pageH].forEach(function (input) {
        input.addEventListener('input', function () { syncPreset(); draw(); });
    });
    els.btnRotate.addEventListener('click', function () {
        var p = pageSize();
        setPage(p.h, p.w);
        draw();
    });
    els.btnReset.addEventListener('click', function () { buildParams(); draw(); });
    els.btnSvg.addEventListener('click', function () { download('svg'); });
    els.btnGcode.addEventListener('click', function () { download('gcode'); });
    els.btnPrint.addEventListener('click', function () { window.print(); });

    var resizeTimer;
    window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(draw, 120);
    });

    buildPresets();
    Promise.all([api('/api/patches'), api('/api/gallery')]).then(function (res) {
        return Promise.all([res[0].json(), res[1].json()]);
    }).then(function (data) {
        patches = data[0];
        categories = data[1];
        if (!patches.length) throw new Error('The engine reported no patterns.');

        // Grouped as on the thumbnail sheet, in the same order.
        categories.forEach(function (cat) {
            var group = document.createElement('optgroup');
            group.label = cat.name;
            cat.patches.forEach(function (tile) {
                var opt = document.createElement('option');
                opt.value = opt.textContent = tile.name;
                group.appendChild(opt);
            });
            els.patch.appendChild(group);
        });

        buildPatterns();
        applyURL();
        draw();
    }).catch(function (err) {
        showError(new Error('Could not start the drawing engine: ' + err.message));
    });
})();

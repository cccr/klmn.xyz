(function () {
    'use strict';

    var DEFAULTS = { ecc: 'MEDIUM', modulePx: 8, quietZone: 4, fg: '#0f172a', bg: '#ffffff' };
    var ECC_LABEL = { LOW: 'L', MEDIUM: 'M', QUARTILE: 'Q', HIGH: 'H' };
    var ECC_BY_ORDINAL = ['L', 'M', 'Q', 'H'];

    var els = {
        payload:    document.getElementById('payload'),
        charCount:  document.getElementById('charCount'),
        eccGroup:   document.getElementById('eccGroup'),
        modulePx:   document.getElementById('modulePx'),
        moduleOut:  document.getElementById('moduleOut'),
        quietZone:  document.getElementById('quietZone'),
        quietOut:   document.getElementById('quietOut'),
        fgColor:    document.getElementById('fgColor'),
        bgColor:    document.getElementById('bgColor'),
        canvas:     document.getElementById('qrCanvas'),
        emptyHint:  document.getElementById('emptyHint'),
        spec:       document.getElementById('qrSpec'),
        specVersion: document.getElementById('specVersion'),
        specModules: document.getElementById('specModules'),
        specEcc:     document.getElementById('specEcc'),
        specSize:    document.getElementById('specSize'),
        warning:    document.getElementById('qrWarning'),
        error:      document.getElementById('qrError'),
        btnPng:     document.getElementById('btnPng'),
        btnSvg:     document.getElementById('btnSvg'),
        btnReset:   document.getElementById('btnReset')
    };

    var ecc = DEFAULTS.ecc;
    var current = null; // last successfully encoded QrCode

    /* ── Rendering ─────────────────────────────────────────────── */

    function drawCanvas(qr, quiet, px, fg, bg) {
        var n = qr.size + quiet * 2;
        var dim = n * px;
        els.canvas.width = dim;
        els.canvas.height = dim;
        var ctx = els.canvas.getContext('2d');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, dim, dim);
        ctx.fillStyle = fg;
        for (var y = 0; y < qr.size; y++) {
            for (var x = 0; x < qr.size; x++) {
                if (qr.getModule(x, y)) {
                    ctx.fillRect((x + quiet) * px, (y + quiet) * px, px, px);
                }
            }
        }
        return dim;
    }

    /* ── Main ──────────────────────────────────────────────────── */

    function render() {
        var text = els.payload.value;
        var px = parseInt(els.modulePx.value, 10);
        var quiet = parseInt(els.quietZone.value, 10);
        var fg = els.fgColor.value;
        var bg = els.bgColor.value;

        els.charCount.textContent = text.length + (text.length === 1 ? ' character' : ' characters');
        // The unit lives beside the number in the markup, so these are bare.
        els.moduleOut.textContent = px;
        els.quietOut.textContent = quiet;
        els.error.classList.add('hidden');
        els.warning.classList.add('hidden');

        if (text.length === 0) {
            current = null;
            els.canvas.width = els.canvas.height = 0;
            els.canvas.style.display = 'none';
            els.emptyHint.style.display = '';
            els.spec.hidden = true;
            els.btnPng.disabled = els.btnSvg.disabled = true;
            return;
        }

        var qr;
        try {
            qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc[ecc]);
        } catch (e) {
            current = null;
            els.btnPng.disabled = els.btnSvg.disabled = true;
            els.error.textContent = (e instanceof RangeError)
                ? 'That is too much data for a single QR code at error correction ' + ECC_LABEL[ecc] +
                  '. Shorten the text' + (ecc === 'LOW' ? '' : ', or drop to a lower level') + '.'
                : 'Could not generate a QR code: ' + e.message;
            els.error.classList.remove('hidden');
            if (!(e instanceof RangeError)) { console.error(e); }
            return;
        }

        current = qr;
        els.emptyHint.style.display = 'none';
        els.canvas.style.display = '';
        var dim = drawCanvas(qr, quiet, px, fg, bg);

        // What the code turned out to be, as an aligned table. It used to be a
        // single middle-dot-joined string, where nothing lined up and the
        // interesting number was wherever it happened to land.
        var effective = ECC_BY_ORDINAL[qr.errorCorrectionLevel.ordinal];
        els.specVersion.textContent = qr.version;
        els.specModules.textContent = qr.size + ' \u00d7 ' + qr.size;
        els.specEcc.textContent = effective +
            (effective !== ECC_LABEL[ecc] ? ' (' + ECC_LABEL[ecc] + ' requested)' : '');
        els.specSize.textContent = dim + ' \u00d7 ' + dim + ' px';
        els.spec.hidden = false;

        if (quiet < 4) {
            els.warning.textContent = 'A quiet zone under 4 modules is below spec. Test it before printing a batch.';
            els.warning.classList.remove('hidden');
        }

        els.btnPng.disabled = els.btnSvg.disabled = false;
    }

    /* ── Downloads ─────────────────────────────────────────────── */

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

    /* ── Wiring ────────────────────────────────────────────────── */

    // The script says which button is on; qr.css says what that looks like.
    // It used to rewrite the whole Tailwind class list on every repaint, so
    // the segmented control's appearance was spread across two languages.
    function paintEccButtons() {
        Array.prototype.forEach.call(els.eccGroup.children, function (b) {
            var on = b.dataset.ecc === ecc;
            b.classList.toggle('is-on', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }

    els.eccGroup.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-ecc]');
        if (!btn) return;
        ecc = btn.dataset.ecc;
        paintEccButtons();
        render();
    });

    ['payload', 'modulePx', 'quietZone', 'fgColor', 'bgColor'].forEach(function (k) {
        els[k].addEventListener('input', render);
    });

    els.btnPng.addEventListener('click', function () {
        els.canvas.toBlob(function (blob) { saveBlob(blob, 'qr-code.png'); }, 'image/png');
    });

    els.btnSvg.addEventListener('click', function () {
        if (!current) return;
        var svg = qrRender.toSvgString(current, parseInt(els.quietZone.value, 10), els.fgColor.value, els.bgColor.value);
        saveBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), 'qr-code.svg');
    });

    els.btnReset.addEventListener('click', function () {
        ecc = DEFAULTS.ecc;
        els.modulePx.value = DEFAULTS.modulePx;
        els.quietZone.value = DEFAULTS.quietZone;
        els.fgColor.value = DEFAULTS.fg;
        els.bgColor.value = DEFAULTS.bg;
        paintEccButtons();
        render();
    });

    paintEccButtons();
    render();
})();

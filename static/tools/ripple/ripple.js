/* ══ Ripple Edge Profile ═══════════════════════════════════════════════════
   A decaying, growing sine wave, previewed on the canvas and exported as a
   DXF polyline for CNC routing or laser cutting a wavy edge.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var DEFAULTS = {
        length: 250, segments: 1200, amplitude: 20, offsetY: 0,
        damping: 0.012, wavelength: 12, wlGrowth: 0.07, phase: 0,
        profileMode: 'top', keepCrestsLevel: false, closeToWaterline: true
    };

    var els = {
        length:          document.getElementById('length'),
        segments:        document.getElementById('segments'),
        amplitude:       document.getElementById('amplitude'),
        offsetY:         document.getElementById('offsetY'),
        damping:         document.getElementById('damping'),
        wavelength:      document.getElementById('wavelength'),
        wlGrowth:        document.getElementById('wlGrowth'),
        phase:           document.getElementById('phase'),
        profileMode:     document.getElementById('profileMode'),
        keepCrestsLevel: document.getElementById('keepCrestsLevel'),
        closeToWaterline: document.getElementById('closeToWaterline'),
        canvas:          document.getElementById('canvas'),
        btnDownload:     document.getElementById('btnDownload'),
        specPoints:      document.getElementById('specPoints'),
        specSpan:        document.getElementById('specSpan'),
        specHeight:      document.getElementById('specHeight')
    };

    var ctx = els.canvas.getContext('2d');

    /* ── Parameters ────────────────────────────────────────────── */

    function applyDefaults() {
        els.length.value = DEFAULTS.length;
        els.segments.value = DEFAULTS.segments;
        els.amplitude.value = DEFAULTS.amplitude;
        els.offsetY.value = DEFAULTS.offsetY;
        els.damping.value = DEFAULTS.damping;
        els.wavelength.value = DEFAULTS.wavelength;
        els.wlGrowth.value = DEFAULTS.wlGrowth;
        els.phase.value = DEFAULTS.phase;
        els.profileMode.value = DEFAULTS.profileMode;
        els.keepCrestsLevel.checked = DEFAULTS.keepCrestsLevel;
        els.closeToWaterline.checked = DEFAULTS.closeToWaterline;
    }

    function getParams() {
        return {
            length: Number(els.length.value),
            segments: Number(els.segments.value),
            amplitude: Number(els.amplitude.value),
            offsetY: Number(els.offsetY.value),
            damping: Number(els.damping.value),
            wavelength: Number(els.wavelength.value),
            wlGrowth: Number(els.wlGrowth.value),
            phase: Number(els.phase.value),
            profileMode: els.profileMode.value,
            keepCrestsLevel: els.keepCrestsLevel.checked,
            closeToWaterline: els.closeToWaterline.checked
        };
    }

    /* ── Geometry ──────────────────────────────────────────────── */

    function computePoints() {
        var p = getParams();
        var pts = [];

        var length = Math.max(1, p.length);
        var segments = Math.max(2, Math.floor(p.segments));
        var dx = length / segments;

        var accumulatedPhase = p.phase;

        for (var i = 0; i <= segments; i++) {
            var x = i * dx;

            var localWavelength = Math.max(0.001, p.wavelength + p.wlGrowth * x);

            if (i > 0) {
                var prevX = (i - 1) * dx;
                var prevWavelength = Math.max(0.001, p.wavelength + p.wlGrowth * prevX);
                var avgWavelength = (localWavelength + prevWavelength) / 2;
                accumulatedPhase += (2 * Math.PI * dx) / avgWavelength;
            }

            var s = Math.sin(accumulatedPhase);
            var envelope = Math.exp(-p.damping * x);

            /* Normal mode: amplitude fades over distance. Keep-crests-level
               mode: the baseline rises while amplitude fades, so upper
               crests stay near one horizontal guide as the troughs shallow
               out — useful for a decorative half-profile CNC edge. */
            var y;
            if (p.keepCrestsLevel) {
                var topLine = p.offsetY + p.amplitude;
                var localAmplitude = p.amplitude * envelope;
                y = topLine - localAmplitude + localAmplitude * s;
            } else {
                y = p.offsetY + p.amplitude * envelope * s;
            }

            if (p.profileMode === 'top') {
                y = Math.max(p.offsetY, y);
            } else if (p.profileMode === 'bottom') {
                y = Math.min(p.offsetY, y);
            } else if (p.profileMode === 'absolute') {
                y = p.offsetY + Math.abs(y - p.offsetY);
            }

            pts.push({ x: x, y: y });
        }

        if (p.closeToWaterline) {
            pts.push({ x: length, y: p.offsetY });
            pts.push({ x: 0, y: p.offsetY });
            pts.push({ x: 0, y: pts[0].y });
        }

        return pts;
    }

    /* ── Preview ───────────────────────────────────────────────── */

    function cssVar(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    function drawPreview(pts) {
        var p = getParams();

        var dpr = window.devicePixelRatio || 1;
        var rect = els.canvas.getBoundingClientRect();

        els.canvas.width = rect.width * dpr;
        els.canvas.height = rect.height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        var w = rect.width;
        var h = rect.height;
        var margin = 24;

        var minX = pts[0].x, maxX = pts[0].x;
        var minY = Math.min(pts[0].y, p.offsetY), maxY = Math.max(pts[0].y, p.offsetY);
        pts.forEach(function (pt) {
            if (pt.x < minX) minX = pt.x;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.y > maxY) maxY = pt.y;
        });

        if (minY === maxY) { minY -= 1; maxY += 1; }
        var yPadding = (maxY - minY) * 0.15;
        minY -= yPadding;
        maxY += yPadding;

        function sx(x) { return margin + ((x - minX) / (maxX - minX)) * (w - margin * 2); }
        function sy(y) { return h - margin - ((y - minY) / (maxY - minY)) * (h - margin * 2); }

        ctx.fillStyle = cssVar('--paper');
        ctx.fillRect(0, 0, w, h);

        // waterline
        ctx.beginPath();
        ctx.moveTo(sx(minX), sy(p.offsetY));
        ctx.lineTo(sx(maxX), sy(p.offsetY));
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = cssVar('--ink-soft');
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);

        // crest guide
        if (p.keepCrestsLevel) {
            ctx.beginPath();
            ctx.moveTo(sx(minX), sy(p.offsetY + p.amplitude));
            ctx.lineTo(sx(maxX), sy(p.offsetY + p.amplitude));
            ctx.setLineDash([3, 5]);
            ctx.strokeStyle = cssVar('--rule');
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // profile
        ctx.beginPath();
        pts.forEach(function (pt, i) {
            if (i === 0) ctx.moveTo(sx(pt.x), sy(pt.y));
            else ctx.lineTo(sx(pt.x), sy(pt.y));
        });
        ctx.strokeStyle = cssVar('--reg');
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    function updateSpec(pts) {
        var minX = pts[0].x, maxX = pts[0].x, minY = pts[0].y, maxY = pts[0].y;
        pts.forEach(function (pt) {
            if (pt.x < minX) minX = pt.x;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.y > maxY) maxY = pt.y;
        });
        els.specPoints.textContent = String(pts.length);
        els.specSpan.textContent = (maxX - minX).toFixed(1) + ' mm';
        els.specHeight.textContent = (maxY - minY).toFixed(1) + ' mm';
    }

    function refresh() {
        var pts = computePoints();
        drawPreview(pts);
        updateSpec(pts);
    }

    /* ── DXF export ────────────────────────────────────────────── */

    function cleanNumber(n) {
        return Number(n.toFixed(6)).toString();
    }

    function buildDxfPolyline(points) {
        var dxf = '';

        dxf += '0\nSECTION\n2\nHEADER\n';
        dxf += '9\n$ACADVER\n1\nAC1009\n';
        dxf += '0\nENDSEC\n';

        dxf += '0\nSECTION\n2\nENTITIES\n';
        dxf += '0\nPOLYLINE\n8\nRIPPLE_PROFILE\n66\n1\n70\n0\n';

        points.forEach(function (p) {
            dxf += '0\nVERTEX\n8\nRIPPLE_PROFILE\n';
            dxf += '10\n' + cleanNumber(p.x) + '\n';
            dxf += '20\n' + cleanNumber(p.y) + '\n';
            dxf += '30\n0\n';
        });

        dxf += '0\nSEQEND\n';
        dxf += '0\nENDSEC\n0\nEOF\n';

        return dxf;
    }

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

    Array.prototype.forEach.call(document.querySelectorAll('.rail input, .rail select'),
        function (el) { el.addEventListener('input', refresh); });
    window.addEventListener('resize', refresh);

    els.btnDownload.addEventListener('click', function () {
        saveBlob(new Blob([buildDxfPolyline(computePoints())], { type: 'application/dxf' }),
            'ripple_profile.dxf');
    });

    applyDefaults();
    refresh();
})();

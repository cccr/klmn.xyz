/*
 * Shared QR rendering helpers for klmn.xyz tools.
 * Depends on the global `qrcodegen` (Project Nayuki, MIT) being loaded first.
 */
(function (global) {
    'use strict';

    // Renders a QrCode as a standalone SVG document string. One <path> of
    // single-module subpaths keeps the file small; crispEdges stops the
    // renderer from anti-aliasing module boundaries into grey.
    function toSvgString(qr, quiet, fg, bg) {
        var n = qr.size + quiet * 2;
        var parts = [];
        for (var y = 0; y < qr.size; y++) {
            for (var x = 0; x < qr.size; x++) {
                if (qr.getModule(x, y)) {
                    parts.push('M' + (x + quiet) + ',' + (y + quiet) + 'h1v1h-1z');
                }
            }
        }
        return [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 ' + n + ' ' + n + '" ' +
                'width="' + n + '" height="' + n + '" shape-rendering="crispEdges">',
            '\t<rect width="100%" height="100%" fill="' + bg + '"/>',
            '\t<path d="' + parts.join('') + '" fill="' + fg + '"/>',
            '</svg>',
            ''
        ].join('\n');
    }

    function luminance(hex) {
        var c = [1, 3, 5].map(function (i) {
            var v = parseInt(hex.substr(i, 2), 16) / 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    }

    // Advice on a foreground/background pair, or null if the pair is fine.
    // Shared because both tools offer the same two colour pickers and the
    // same footgun; mass-qr prints up to 36 codes at once, so an unscannable
    // sheet costs 36 times as much there as it does on the single-code tool.
    function contrastNote(fg, bg) {
        var lf = luminance(fg), lb = luminance(bg);
        var ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
        if (lf > lb) {
            return 'Your foreground is lighter than your background. Most scanners expect a dark code ' +
                   'on a light field and will not read an inverted one.';
        }
        if (ratio < 3) {
            return 'Only ' + ratio.toFixed(1) + ':1 contrast between the two colors. Aim for 3:1 or ' +
                   'more, or scanners will struggle.';
        }
        return null;
    }

    global.qrRender = { toSvgString: toSvgString, contrastNote: contrastNote };
})(typeof window !== 'undefined' ? window : globalThis);

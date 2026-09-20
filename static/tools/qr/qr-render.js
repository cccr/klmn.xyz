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

    global.qrRender = { toSvgString: toSvgString };
})(typeof window !== 'undefined' ? window : globalThis);

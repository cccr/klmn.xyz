'use strict';
// Every value printed on /design/ is read back out of the stylesheet that
// produced it, so the page cannot quietly disagree with what it documents.
// A token renamed in style.css shows up here as a blank, not as a stale hex.
(function () {
    var root = getComputedStyle(document.documentElement);

    // Colour swatches: the hex beside a swatch comes from the same custom
    // property that painted it.
    Array.prototype.forEach.call(document.querySelectorAll('[data-token]'), function (el) {
        var v = root.getPropertyValue(el.getAttribute('data-token')).trim();
        el.textContent = v || '(not defined)';
    });

    // Type scale: each row's pixel size is measured off the sample itself.
    Array.prototype.forEach.call(document.querySelectorAll('.ds-px'), function (el) {
        var sample = el.parentNode.querySelector('.ds-spec');
        if (!sample) return;
        var px = parseFloat(getComputedStyle(sample).fontSize);
        el.textContent = Math.round(px * 100) / 100 + ' px';
    });

    // The specimens are live, not screenshots — a segmented control that
    // cannot be pressed is a picture of one.
    Array.prototype.forEach.call(document.querySelectorAll('.seg'), function (seg) {
        seg.addEventListener('click', function (e) {
            var hit = e.target.closest('button');
            if (!hit) return;
            Array.prototype.forEach.call(seg.children, function (b) {
                b.classList.toggle('is-on', b === hit);
            });
        });
    });

    var payload = document.getElementById('ds-payload');
    var count = document.getElementById('ds-count');
    if (payload && count) {
        payload.addEventListener('input', function () {
            var n = payload.value.length;
            count.textContent = n + (n === 1 ? ' character' : ' characters');
        });
    }

    var range = document.getElementById('ds-module');
    var out = document.getElementById('ds-moduleOut');
    if (range && out) {
        range.addEventListener('input', function () { out.textContent = range.value; });
    }

    var mg = document.getElementById('ds-mg');
    if (mg) {
        Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (chip) {
            chip.addEventListener('click', function () { mg.value = chip.textContent; });
        });
    }
})();

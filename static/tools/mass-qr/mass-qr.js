(function () {
    'use strict';

    var grid = document.getElementById('grid');

    var MAX = 6;
    var ENUMS = {
        ecc: ['L', 'M', 'Q', 'H'],
        capPos: ['above', 'below'], capSize: ['s', 'm', 'l']
    };

    function defaultState() {
        return {
            v: 1, rows: 2, cols: 2, ecc: 'Q', mg: 10, gp: 4,
            capPos: 'above', capSize: 'm', fg: '#000000', bg: '#ffffff',
            qz: 4, tiles: {}
        };
    }

    function key(r, c) { return r + ',' + c; }

    function clamp(n, lo, hi, dflt) {
        n = parseInt(n, 10);
        if (isNaN(n)) return dflt;
        return Math.min(hi, Math.max(lo, n));
    }

    // Margin and gutter are fractional millimetres, so they need a float
    // clamp rounded to 0.1mm — finer than any printer resolves.
    var MG_MAX = 50, GP_MAX = 30;
    function clampMm(n, lo, hi, dflt) {
        n = parseFloat(n);
        if (!isFinite(n)) return dflt;
        return Math.round(Math.min(hi, Math.max(lo, n)) * 10) / 10;
    }

    function pickEnum(v, name, dflt) {
        return ENUMS[name].indexOf(v) === -1 ? dflt : v;
    }

    function hex(v, dflt) {
        return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : dflt;
    }

    function normalize(obj) {
        var d = defaultState();
        if (!obj || typeof obj !== 'object') return d;
        var s = {
            v: 1,
            rows: clamp(obj.rows, 1, MAX, d.rows),
            cols: clamp(obj.cols, 1, MAX, d.cols),
            ecc: pickEnum(obj.ecc, 'ecc', d.ecc),
            capPos: pickEnum(obj.capPos, 'capPos', d.capPos),
            capSize: pickEnum(obj.capSize, 'capSize', d.capSize),
            fg: hex(obj.fg, d.fg),
            bg: hex(obj.bg, d.bg),
            qz: clamp(obj.qz, 0, 8, d.qz),
            mg: clampMm(obj.mg, 0, MG_MAX, d.mg),
            gp: clampMm(obj.gp, 0, GP_MAX, d.gp),
            tiles: {}
        };
        var tiles = obj.tiles || {};
        Object.keys(tiles).forEach(function (k) {
            var parts = k.split(',');
            if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) return;
            var r = parseInt(parts[0], 10), c = parseInt(parts[1], 10);
            if (r >= s.rows || c >= s.cols) return;
            var t = tiles[k] || {};
            if (!t.u) return;
            s.tiles[key(r, c)] = { u: String(t.u), l: String(t.l || ''), d: String(t.d || '') };
        });
        return s;
    }

    // btoa throws above U+00FF, so the JSON goes through UTF-8 bytes first.
    // Built with a loop, not spread — a large sheet would blow the call stack.
    function encodeState(s) {
        var bytes = new TextEncoder().encode(JSON.stringify(s));
        var bin = '';
        for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function decodeState(str) {
        if (!str) return null;
        try {
            var b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
            while (b64.length % 4) b64 += '=';
            var bin = atob(b64);
            var bytes = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            var obj = JSON.parse(new TextDecoder().decode(bytes));
            if (!obj || obj.v !== 1) return null;
            return normalize(obj);
        } catch (e) {
            return null;
        }
    }

    // localStorage.getItem can throw (Safari private mode, restrictive storage
    // settings), so the startup read is guarded the same way persist() guards
    // its write.
    function readStored() {
        try { return localStorage.getItem('massQr'); } catch (e) { return null; }
    }

    var state = decodeState((location.hash.match(/[#&]s=([^&]+)/) || [])[1]) ||
                decodeState(readStored()) ||
                defaultState();

    var saveTimer = null;
    function persist() {
        var enc = encodeState(state);
        try { localStorage.setItem('massQr', enc); } catch (e) { /* private mode */ }
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () {
            history.replaceState(null, '', '#s=' + enc);
        }, 300);
    }

    function getState() { return state; }
    function setState(patch) {
        // An open editor's fields live in the DOM only, not in `state`, until
        // committed. Every state mutation must commit it first, or the patch
        // below merges onto a `state.tiles` that never saw the edit and the
        // next render() wipes whatever was typed. See commitOpen().
        commitOpen();
        var merged = {};
        Object.keys(state).forEach(function (k) { merged[k] = state[k]; });
        Object.keys(patch).forEach(function (k) { merged[k] = patch[k]; });
        state = normalize(merged);
        render();
        persist();
    }

    function orphansFor(rows, cols) {
        return Object.keys(state.tiles).filter(function (k) {
            var p = k.split(',');
            return parseInt(p[0], 10) >= rows || parseInt(p[1], 10) >= cols;
        });
    }

    function resize(rows, cols) {
        commitOpen();
        rows = clamp(rows, 1, MAX, state.rows);
        cols = clamp(cols, 1, MAX, state.cols);
        var lost = orphansFor(rows, cols);
        if (lost.length) {
            var msg = 'This removes ' + lost.length + ' tile' + (lost.length === 1 ? '' : 's') +
                      ' from the sheet. Continue?';
            if (!window.confirm(msg)) return false;
            lost.forEach(function (k) { delete state.tiles[k]; });
        }
        state.rows = rows;
        state.cols = cols;
        editing = null;
        render();
        persist();
        return true;
    }

    window.massQr = {
        defaultState: defaultState, encodeState: encodeState, decodeState: decodeState,
        normalize: normalize, getState: getState, setState: setState, key: key,
        resize: resize
    };

    var ECC_MAP = { L: 'LOW', M: 'MEDIUM', Q: 'QUARTILE', H: 'HIGH' };
    var CAP_MM = {
        s: { label: 3, desc: 2.2 },
        m: { label: 4, desc: 2.8 },
        l: { label: 5.5, desc: 3.6 }
    };

    function buildTile(cell, tile) {
        cell.className = 'cell is-filled' + (state.capPos === 'below' ? ' cap-below' : '');
        cell.setAttribute('role', 'button');
        cell.setAttribute('tabindex', '0');

        var cap = document.createElement('div');
        cap.className = 'cap';
        cap.style.color = state.fg;
        var sizes = CAP_MM[state.capSize];

        var label = document.createElement('span');
        label.className = 'label';
        label.style.fontSize = sizes.label + 'mm';
        label.textContent = tile.l;
        cap.appendChild(label);

        if (tile.d) {
            var desc = document.createElement('span');
            desc.className = 'desc';
            desc.style.fontSize = sizes.desc + 'mm';
            desc.textContent = tile.d;
            cap.appendChild(desc);
        }
        cell.appendChild(cap);

        var code = document.createElement('div');
        code.className = 'code';
        try {
            var qr = qrcodegen.QrCode.encodeText(tile.u, qrcodegen.QrCode.Ecc[ECC_MAP[state.ecc]]);
            // The quiet zone is the user's call (0-8 modules) and the grid gap
            // cannot substitute for it — the gap is millimetres, the zone is
            // modules. Anything under 4 is below spec; the preview shows what
            // that looks like, which is the user's call to make.
            code.innerHTML = qrRender.toSvgString(qr, state.qz, state.fg, state.bg)
                .replace(/^<\?xml[^>]*\?>\s*/, '');
            var svgEl = code.querySelector('svg');
            // Centred, not pinned to the caption edge: every .code box is now
            // the same size, so centring splits the leftover space evenly
            // above and below each code instead of pooling ~43mm of it at the
            // bottom of every cell.
            if (svgEl) svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        } catch (e) {
            // RangeError is qrcodegen's signal that the payload exceeds
            // capacity at this ECC level — that's an expected, user-facing
            // condition. Anything else is a real bug and must not be
            // relabelled as "Link too long"; log it so it surfaces instead
            // of hiding behind a plausible-looking UI state.
            if (e instanceof RangeError) {
                code.textContent = 'Link too long';
                code.className = 'code too-long';
            } else {
                console.error(e);
                code.textContent = 'Error';
                code.className = 'code error';
            }
        }
        cell.appendChild(code);
    }

    var editing = null; // "r,c" of the cell currently open, or null

    function buildEditor(cell, pos) {
        var tile = state.tiles[pos] || { u: '', l: '', d: '' };
        cell.className = 'cell is-editing';
        cell.innerHTML = '';

        // The fields live in an absolutely positioned `.editor` overlay, not
        // directly in the cell, so the cell's own box keeps its normal grid-
        // track size and the sheet underneath never reflows (see the CSS).
        var editor = document.createElement('div');
        editor.className = 'editor';

        var fields = [
            { cls: 'f-url', ph: 'https://…', val: tile.u },
            { cls: 'f-label', ph: 'Label', val: tile.l },
            { cls: 'f-desc', ph: 'Description (optional)', val: tile.d }
        ];
        fields.forEach(function (f) {
            var input = document.createElement('input');
            input.type = 'text';
            input.className = f.cls;
            input.placeholder = f.ph;
            input.value = f.val;
            editor.appendChild(input);
        });

        var row = document.createElement('div');
        row.className = 'f-row';
        var done = document.createElement('button');
        done.className = 'f-done';
        done.textContent = 'Done';
        var del = document.createElement('button');
        del.className = 'f-delete';
        del.textContent = 'Delete';
        row.appendChild(done);
        row.appendChild(del);
        editor.appendChild(row);

        cell.appendChild(editor);

        // Enter commits, Escape discards. Without these the only way out of
        // an editor was the mouse — Done, or a click somewhere else.
        editor.addEventListener('keydown', function (e) {
            // Buttons carry their own activation: a keydown here would commit
            // and rebuild the grid before the button's click ever fires, so
            // Enter on Delete would silently become Enter on Done.
            if (e.target.tagName === 'BUTTON') return;
            if (e.key === 'Enter') {
                e.preventDefault();
                commitEditor(cell, pos);
                focusCell(pos);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                // Clearing `editing` before render() rebuilds the cell from
                // the state that was there before the edit — the fields only
                // ever lived in the DOM, so dropping them discards the edit.
                editing = null;
                render();
                focusCell(pos);
            }
        });

        done.addEventListener('click', function (e) {
            e.stopPropagation();
            commitEditor(cell, pos);
            focusCell(pos);
        });
        del.addEventListener('click', function (e) {
            e.stopPropagation();
            delete state.tiles[pos];
            editing = null;
            render();
            persist();
            focusCell(pos);
        });
    }

    // `.f-url` etc. are nested one level deeper now (inside `.editor`), but
    // querySelector searches all descendants, so this needs no change.
    function commitEditor(cell, pos) {
        var url = cell.querySelector('.f-url').value.trim();
        if (url) {
            state.tiles[pos] = {
                u: url,
                l: cell.querySelector('.f-label').value.trim(),
                d: cell.querySelector('.f-desc').value.trim()
            };
        } else {
            delete state.tiles[pos];
        }
        editing = null;
        render();
        persist();
    }

    // Commits whatever editor is currently open, if any. This is the single
    // path every state-mutating entry point must go through before it reads
    // or overwrites `state.tiles` — control changes (setState), resize,
    // print (button click and the native beforeprint event, which also
    // covers Ctrl-P) and switching to a different cell (openCell). Without
    // it, each of those reads `state.tiles` while the open editor's fields
    // still only exist in the DOM, and clobbers or skips them.
    //
    // Re-entrancy guard: commitEditor's render()/persist() never call back
    // into commitOpen() today, but this is the sole choke point for every
    // mutation path, so it stays defensive against that changing later.
    var committingOpen = false;
    function commitOpen() {
        if (committingOpen || !editing) return;
        committingOpen = true;
        var open = grid.querySelector('.cell.is-editing');
        if (open) commitEditor(open, editing);
        editing = null;
        committingOpen = false;
    }

    function focusCell(pos) {
        var el = grid.querySelector('[data-pos="' + pos + '"]');
        if (el) el.focus();
    }

    function openCell(cell) {
        commitOpen();
        editing = cell.dataset.pos;
        render();
        // render() rebuilds the grid from scratch, so the cell that had focus
        // (or was just clicked) no longer exists and focus has dropped to
        // <body>. The editor is now in the document, so focus its first
        // field here — once, tied to opening — rather than in buildEditor
        // (where the cell is still detached and .focus() is a no-op) or in
        // render() itself (which also runs on unrelated state changes and
        // would yank focus out of a field the user is mid-typing in).
        var urlInput = grid.querySelector('.cell.is-editing .f-url');
        if (urlInput) urlInput.focus();
    }

    grid.addEventListener('click', function (e) {
        var cell = e.target.closest ? e.target.closest('.cell') : null;
        if (!cell || cell.classList.contains('is-editing')) return;
        openCell(cell);
    });

    // Enter and Space activate a cell exactly as a click does, so the sheet
    // is operable without a mouse. Space is prevented so the page doesn't
    // scroll underneath the newly opened editor.
    grid.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
        var cell = e.target.closest ? e.target.closest('.cell') : null;
        if (!cell || cell.classList.contains('is-editing')) return;
        if (e.key === ' ' || e.key === 'Spacebar') e.preventDefault();
        openCell(cell);
    });

    // "Clicking away commits" (spec) for clicks that land outside the grid
    // entirely — the control strip, a blank margin, anywhere the grid's own
    // click listener never sees. mousedown, not click, so this fires and
    // commits before a control's own change/click handling runs on the same
    // gesture (a <select>, for instance, opens its dropdown on mousedown).
    //
    // Deliberately excludes anything inside #grid, including clicks on a
    // different cell: committing on mousedown there would rebuild the grid
    // (replacing every cell's DOM node, including the one about to be
    // clicked) before mouseup/click fire. A real browser drops the click
    // entirely when its target was detached between mousedown and mouseup —
    // verified against real Chrome via the CDP Input domain, not just
    // jsdom's single-event click() helper, which can't see this class of
    // bug. Clicks inside the grid already commit-then-open correctly as one
    // atomic click event, via openCell()'s own commitOpen() call.
    document.addEventListener('mousedown', function (e) {
        if (!editing) return;
        if (e.target.closest && e.target.closest('#grid')) return;
        commitOpen();
    }, true);

    // The caption band is one height for the whole sheet. It has to be
    // measured rather than computed, because a caption's height depends on
    // how its text wraps and only layout knows that. Two passes: let the row
    // size to content, read the tallest caption, then write the band back.
    //
    // offsetHeight, not getBoundingClientRect(): the former is untransformed
    // layout pixels, so the band stays correct even if something scales the
    // sheet.
    // Margin drives both the preview's padding and the real @page margin, so
    // what you see is what the printer is asked for. Gutter is grid gap only.
    function applyPageSetup() {
        var sheet = document.getElementById('sheet');
        sheet.style.setProperty('--sheet-pad', state.mg + 'mm');
        sheet.style.setProperty('--gutter', state.gp + 'mm');
        document.getElementById('pageRule').textContent =
            '@page { margin: ' + state.mg + 'mm; }';
        elMg.value = state.mg;
        elGp.value = state.gp;
    }

    var CAP_LINE = 1.3; // line-height, matching the .cap rules
    function applyCaptionBand() {
        grid.style.setProperty('--cap-h', 'auto');
        var tallest = 0;
        grid.querySelectorAll('.cell.is-filled .cap').forEach(function (cap) {
            if (cap.offsetHeight > tallest) tallest = cap.offsetHeight;
        });
        if (tallest > 0) {
            grid.style.setProperty('--cap-h', tallest + 'px');
            return;
        }
        // No layout engine (jsdom) or a sheet that is not displayed: fall
        // back to the nominal single-line heights the sizes are defined in.
        var sizes = CAP_MM[state.capSize];
        var anyDesc = Object.keys(state.tiles).some(function (k) { return !!state.tiles[k].d; });
        grid.style.setProperty('--cap-h',
            (Math.round((sizes.label + (anyDesc ? sizes.desc : 0)) * CAP_LINE * 100) / 100) + 'mm');
    }

    // Grid track counts are set from JS rather than a CSS custom property:
    // repeat(var(--n), 1fr) is inconsistently supported and this is unambiguous.
    function render() {
        grid.style.gridTemplateColumns = 'repeat(' + state.cols + ', 1fr)';
        grid.style.gridTemplateRows = 'repeat(' + state.rows + ', 1fr)';
        grid.innerHTML = '';
        document.getElementById('sheet').style.background = state.bg;
        for (var r = 0; r < state.rows; r++) {
            for (var c = 0; c < state.cols; c++) {
                var cell = document.createElement('div');
                cell.dataset.pos = key(r, c);
                var tile = state.tiles[key(r, c)];
                if (key(r, c) === editing) {
                    buildEditor(cell, key(r, c));
                } else if (tile) {
                    buildTile(cell, tile);
                } else {
                    cell.className = 'cell is-empty';
                    cell.setAttribute('role', 'button');
                    cell.setAttribute('tabindex', '0');
                    cell.setAttribute('aria-label', 'Add link at row ' + (r + 1) + ', column ' + (c + 1));
                }
                grid.appendChild(cell);
            }
        }
        applyPageSetup();
        applyCaptionBand();
    }

    function fillSizeSelect(el, value) {
        el.innerHTML = '';
        for (var i = 1; i <= MAX; i++) {
            var opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = String(i);
            if (i === value) opt.selected = true;
            el.appendChild(opt);
        }
    }

    var elCols = document.getElementById('cols');
    var elRows = document.getElementById('rows');
    fillSizeSelect(elCols, state.cols);
    fillSizeSelect(elRows, state.rows);

    elCols.addEventListener('change', function () {
        // Reverting via `.value` (not rebuilding the <option> set) keeps
        // focus on the select — fillSizeSelect() destroys and recreates
        // every option, which drops focus to <body> along with them.
        if (!resize(state.rows, parseInt(elCols.value, 10))) elCols.value = state.cols;
    });
    elRows.addEventListener('change', function () {
        if (!resize(parseInt(elRows.value, 10), state.cols)) elRows.value = state.rows;
    });

    // ── Margin and gutter ──────────────────────────────────────
    var elMg = document.getElementById('mg');
    var elGp = document.getElementById('gp');

    // Focusing a field draws the thing it controls onto the preview: the
    // margin field outlines the content edge and tints the band outside it,
    // the gutter field tints the tiles so the gaps between them read as the
    // negative space being adjusted.
    [[elMg, 'show-margin'], [elGp, 'show-gutter']].forEach(function (pair) {
        var input = pair[0], cls = pair[1];
        var sheet = function () { return document.getElementById('sheet'); };
        input.addEventListener('focus', function () { sheet().classList.add(cls); });
        input.addEventListener('blur', function () { sheet().classList.remove(cls); });
        // `input`, not `change`: the guide should track the number as it is
        // typed or stepped, while the field still has focus.
        input.addEventListener('input', function () {
            var patch = {};
            patch[input.id] = input.value;
            setState(patch);
            sheet().classList.add(cls);
            input.focus();
        });
    });

    var SIMPLE = ['ecc', 'qz', 'capPos', 'capSize'];
    SIMPLE.forEach(function (name) {
        var el = document.getElementById(name);
        el.value = state[name];
        el.addEventListener('change', function () {
            var patch = {};
            patch[name] = el.value;
            setState(patch);
        });
    });

    ['fg', 'bg'].forEach(function (name) {
        var el = document.getElementById(name);
        el.value = state[name];
        el.addEventListener('input', function () {
            var patch = {};
            patch[name] = el.value;
            setState(patch);
        });
    });

    document.getElementById('btnPrint').addEventListener('click', function () {
        commitOpen();
        window.print();
    });
    // Ctrl-P (or the browser's own print menu item) fires window.print()
    // without ever touching #btnPrint, bypassing a commit wired only into
    // that button's click handler. beforeprint is dispatched by any path
    // that opens the print dialog, native shortcut included.
    window.addEventListener('beforeprint', commitOpen);

    render();
})();

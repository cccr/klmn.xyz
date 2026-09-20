(function () {
    /* ── DOM ── */
    const canvas = document.getElementById("canvas");
    const ctx = canvas.getContext("2d");
    const mainArea = document.getElementById("mainArea");
    const statusEl = document.getElementById("status");
    const fileInput = document.getElementById("fileInput");
    const uploadArea = document.getElementById("uploadArea");
    const filenameEl = document.getElementById("filenameEl");
    const btnRun = document.getElementById("btnRun");
    const btnStop = document.getElementById("btnStop");
    const btnGIF = document.getElementById("btnGIF");
    const btnWebM = document.getElementById("btnWebM");

    const rScale = document.getElementById("rScale");
    const rWiggle = document.getElementById("rWiggle");
    const rFrames = document.getElementById("rFrames");
    const rFps = document.getElementById("rFps");
    const sType = document.getElementById("sType");
    const rPad = document.getElementById("rPad");
    const cBg = document.getElementById("cBg");
    const sBgLabel = document.getElementById("sBgLabel");
    const chkStroke = document.getElementById("chkStroke");
    const strokeOptions = document.getElementById("strokeOptions");
    const cStroke = document.getElementById("cStroke");
    const rSW = document.getElementById("rSW");

    const vScale = document.getElementById("vScale");
    const vWiggle = document.getElementById("vWiggle");
    const vFrames = document.getElementById("vFrames");
    const vFps = document.getElementById("vFps");
    const vPad = document.getElementById("vPad");
    const vSW = document.getElementById("vSW");

    /* ── State ── */
    let svgText = null;
    let animFrames = [];
    let animating = false;
    let animId = null;
    let curFrame = 0;
    let lastTime = 0;

    /* ── Slider labels ── */
    rScale.oninput = () =>
        (vScale.textContent =
            parseFloat(rScale.value).toFixed(1) + "×");
    rWiggle.oninput = () => (vWiggle.textContent = rWiggle.value);
    rFrames.oninput = () => (vFrames.textContent = rFrames.value);
    rFps.oninput = () => (vFps.textContent = rFps.value);
    rPad.oninput = () => (vPad.textContent = rPad.value);
    rSW.oninput = () => (vSW.textContent = rSW.value);
    cBg.oninput = () =>
        (sBgLabel.textContent = cBg.value.toUpperCase());
    chkStroke.onchange = () => {
        strokeOptions.style.display = chkStroke.checked
            ? "flex"
            : "none";
    };

    /* ── File upload ── */
    uploadArea.addEventListener("click", () => fileInput.click());
    uploadArea.addEventListener("dragover", (e) => {
        e.preventDefault();
        uploadArea.classList.add("dragover");
    });
    uploadArea.addEventListener("dragleave", () =>
        uploadArea.classList.remove("dragover"),
    );
    uploadArea.addEventListener("drop", (e) => {
        e.preventDefault();
        uploadArea.classList.remove("dragover");
        const f = e.dataTransfer.files[0];
        if (f && f.name.toLowerCase().endsWith(".svg")) loadFile(f);
    });
    fileInput.addEventListener("change", () => {
        if (fileInput.files[0]) loadFile(fileInput.files[0]);
    });

    function loadFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            svgText = e.target.result;
            filenameEl.textContent = file.name;
            filenameEl.style.display = "block";
            stopAnimation();
            autoFitScale();
            renderPreview();
            btnRun.disabled = false;
            statusEl.textContent = "SVG loaded. Press Run.";
        };
        reader.readAsText(file);
    }

    function loadSvgString(str, name) {
        svgText = str;
        filenameEl.textContent = name;
        filenameEl.style.display = "block";
        stopAnimation();
        autoFitScale();
        renderPreview();
        btnRun.disabled = false;
        statusEl.textContent = "SVG loaded. Press Run.";
    }

    window.WigglerExamples.setup(loadSvgString);

    /* ── SVG dimension helpers ── */
    function svgDims(svgEl) {
        const vb = svgEl.getAttribute("viewBox");
        let minX = 0,
            minY = 0,
            w,
            h;
        if (vb) {
            const p = vb
                .trim()
                .split(/[\s,]+/)
                .map(Number);
            minX = p[0];
            minY = p[1];
            w = p[2];
            h = p[3];
        }
        if (!w) w = parseFloat(svgEl.getAttribute("width")) || 300;
        if (!h) h = parseFloat(svgEl.getAttribute("height")) || 300;
        return { minX, minY, w, h };
    }

    function autoFitScale() {
        const parser = new DOMParser();
        const doc = parser.parseFromString(
            svgText,
            "image/svg+xml",
        );
        const { w, h } = svgDims(doc.documentElement);
        const maxW = mainArea.clientWidth - 80;
        const maxH = mainArea.clientHeight - 80;
        let s = Math.min(maxW / w, maxH / h, 4);
        s = Math.max(0.1, Math.round(s * 10) / 10);
        rScale.value = s;
        vScale.textContent = s.toFixed(1) + "×";
    }

    /* ── Inject stroke style into SVG doc ── */
    function injectStroke(doc) {
        if (!chkStroke.checked) return;
        const color = cStroke.value;
        const width = parseFloat(rSW.value);
        // Remove any existing injected style
        const old = doc.getElementById("__wiggle_stroke__");
        if (old) old.remove();
        const style = doc.createElementNS(
            "http://www.w3.org/2000/svg",
            "style",
        );
        style.id = "__wiggle_stroke__";
        style.textContent = `path,circle,rect,line,polyline,polygon,ellipse{stroke:${color}!important;stroke-width:${width}px!important}`;
        doc.documentElement.prepend(style);
    }

    /* ── Prepare SVG for rendering (set viewBox with padding, set w/h, inject stroke) ── */
    function prepareSvg(svgEl, pad) {
        const { minX, minY, w, h } = svgDims(svgEl);
        const vbMinX = minX - pad;
        const vbMinY = minY - pad;
        const vbW = w + 2 * pad;
        const vbH = h + 2 * pad;
        svgEl.setAttribute(
            "viewBox",
            `${vbMinX} ${vbMinY} ${vbW} ${vbH}`,
        );
        svgEl.setAttribute("width", vbW);
        svgEl.setAttribute("height", vbH);
        svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        return { vbW, vbH };
    }

    function renderPreview() {
        if (!svgText) return;
        const pad = parseInt(rPad.value);
        const scale = parseFloat(rScale.value);
        const parser = new DOMParser();
        const doc = parser.parseFromString(
            svgText,
            "image/svg+xml",
        );
        injectStroke(doc);
        const { vbW, vbH } = prepareSvg(doc.documentElement, pad);
        canvas.width = Math.round(vbW * scale);
        canvas.height = Math.round(vbH * scale);
        const str = new XMLSerializer().serializeToString(doc);
        renderSvgToCanvas(str, cBg.value);
    }

    function renderSvgToCanvas(svgStr, bg) {
        const blob = new Blob([svgStr], {
            type: "image/svg+xml;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
        };
        img.onerror = () => URL.revokeObjectURL(url);
        img.src = url;
    }

    /* ════════════════════════════════════════════════════════
 PATH NORMALIZATION — convert all commands to absolute
 This is the key fix: wiggling absolute coords gives
 uniform amplitude everywhere; relative coords would
 accumulate offsets, making later points wiggle more.
 ════════════════════════════════════════════════════════ */

    const CMD_CNT = {
        M: 2,
        m: 2,
        L: 2,
        l: 2,
        H: 1,
        h: 1,
        V: 1,
        v: 1,
        C: 6,
        c: 6,
        S: 4,
        s: 4,
        Q: 4,
        q: 4,
        T: 2,
        t: 2,
        A: 7,
        a: 7,
        Z: 0,
        z: 0,
    };
    const TOK_RE =
        /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/gi;

    function pathToAbsSegs(d) {
        // Returns [{cmd, p: number[]}]  — all absolute, H/V expanded to L
        const segs = [];
        let cx = 0,
            cy = 0,
            mx = 0,
            my = 0;
        let tokens = [],
            m;
        TOK_RE.lastIndex = 0;
        while ((m = TOK_RE.exec(d)) !== null)
            tokens.push(
                m[1]
                    ? { t: "c", v: m[1] }
                    : { t: "n", v: parseFloat(m[0]) },
            );

        let i = 0;
        while (i < tokens.length) {
            if (tokens[i].t !== "c") {
                i++;
                continue;
            }
            let cmd = tokens[i].v;
            i++;
            const upper = cmd.toUpperCase();
            const cnt = CMD_CNT[upper] ?? 0;

            if (cnt === 0) {
                segs.push({ cmd: "Z", p: [] });
                cx = mx;
                cy = my;
                continue;
            }

            let firstInCmd = true;
            while (i < tokens.length && tokens[i].t === "n") {
                const p = [];
                for (
                    let j = 0;
                    j < cnt &&
                    i < tokens.length &&
                    tokens[i].t === "n";
                    j++
                )
                    p.push(tokens[i++].v);
                if (p.length < cnt) break;

                // implicit M→L after first pair
                let ec = cmd;
                if (!firstInCmd && cmd === "M") ec = "L";
                if (!firstInCmd && cmd === "m") ec = "l";
                firstInCmd = false;

                let seg;
                switch (ec) {
                    case "M":
                        seg = { cmd: "M", p: [p[0], p[1]] };
                        cx = p[0];
                        cy = p[1];
                        mx = cx;
                        my = cy;
                        break;
                    case "m":
                        seg = {
                            cmd: "M",
                            p: [cx + p[0], cy + p[1]],
                        };
                        cx += p[0];
                        cy += p[1];
                        mx = cx;
                        my = cy;
                        break;
                    case "L":
                        seg = { cmd: "L", p: [p[0], p[1]] };
                        cx = p[0];
                        cy = p[1];
                        break;
                    case "l":
                        seg = {
                            cmd: "L",
                            p: [cx + p[0], cy + p[1]],
                        };
                        cx += p[0];
                        cy += p[1];
                        break;
                    case "H":
                        seg = { cmd: "L", p: [p[0], cy] };
                        cx = p[0];
                        break;
                    case "h":
                        seg = { cmd: "L", p: [cx + p[0], cy] };
                        cx += p[0];
                        break;
                    case "V":
                        seg = { cmd: "L", p: [cx, p[0]] };
                        cy = p[0];
                        break;
                    case "v":
                        seg = { cmd: "L", p: [cx, cy + p[0]] };
                        cy += p[0];
                        break;
                    case "C":
                        seg = { cmd: "C", p: [...p] };
                        cx = p[4];
                        cy = p[5];
                        break;
                    case "c":
                        seg = {
                            cmd: "C",
                            p: [
                                cx + p[0],
                                cy + p[1],
                                cx + p[2],
                                cy + p[3],
                                cx + p[4],
                                cy + p[5],
                            ],
                        };
                        cx += p[4];
                        cy += p[5];
                        break;
                    case "S":
                        seg = { cmd: "S", p: [...p] };
                        cx = p[2];
                        cy = p[3];
                        break;
                    case "s":
                        seg = {
                            cmd: "S",
                            p: [
                                cx + p[0],
                                cy + p[1],
                                cx + p[2],
                                cy + p[3],
                            ],
                        };
                        cx += p[2];
                        cy += p[3];
                        break;
                    case "Q":
                        seg = { cmd: "Q", p: [...p] };
                        cx = p[2];
                        cy = p[3];
                        break;
                    case "q":
                        seg = {
                            cmd: "Q",
                            p: [
                                cx + p[0],
                                cy + p[1],
                                cx + p[2],
                                cy + p[3],
                            ],
                        };
                        cx += p[2];
                        cy += p[3];
                        break;
                    case "T":
                        seg = { cmd: "T", p: [...p] };
                        cx = p[0];
                        cy = p[1];
                        break;
                    case "t":
                        seg = {
                            cmd: "T",
                            p: [cx + p[0], cy + p[1]],
                        };
                        cx += p[0];
                        cy += p[1];
                        break;
                    case "A":
                        seg = { cmd: "A", p: [...p] };
                        cx = p[5];
                        cy = p[6];
                        break;
                    case "a":
                        seg = {
                            cmd: "A",
                            p: [
                                p[0],
                                p[1],
                                p[2],
                                p[3],
                                p[4],
                                cx + p[5],
                                cy + p[6],
                            ],
                        };
                        cx += p[5];
                        cy += p[6];
                        break;
                    default:
                        seg = { cmd: ec.toUpperCase(), p: [...p] };
                        break;
                }
                segs.push(seg);
            }
        }
        return segs;
    }

    function segsToD(segs) {
        return segs
            .map((s) => {
                if (s.cmd === "Z") return "Z";
                return (
                    s.cmd + s.p.map((n) => n.toFixed(3)).join(" ")
                );
            })
            .join("");
    }

    /* ════════════════════════════════════════════════════════
 WIGGLE MATH
 Per-anchor 2D wiggle: each anchor point gets ONE seed
 that produces (dx, dy). Control points follow their
 neighboring anchor(s) — not wiggled independently.
 This keeps curve shapes correct and gives uniform
 amplitude across the whole path.
 ════════════════════════════════════════════════════════ */

    function r2pi() {
        return Math.random() * Math.PI * 2;
    }

    function compute2D(frame, N, amp, seed, type, idx, total) {
        const t = (2 * Math.PI * frame) / N;
        switch (type) {
            case "smooth":
                return [
                    amp * Math.sin(t + seed.a),
                    amp * Math.sin(t + seed.b),
                ];
            case "jittery": {
                const jx =
                    amp *
                    (0.5 * Math.sin(t + seed.a) +
                        0.3 * Math.sin(2 * t + seed.b) +
                        0.2 * Math.sin(3 * t + seed.c));
                const jy =
                    amp *
                    (0.5 * Math.sin(t + seed.b) +
                        0.3 * Math.sin(2 * t + seed.c) +
                        0.2 * Math.sin(3 * t + seed.a));
                return [jx, jy];
            }
            case "wave": {
                const ph =
                    (idx / Math.max(total - 1, 1)) * Math.PI * 5;
                return [
                    amp * Math.sin(t + ph),
                    amp * Math.sin(t + ph + Math.PI / 2.5),
                ];
            }
            case "drift":
                return [
                    amp * Math.cos(t + seed.a),
                    amp * Math.sin(t + seed.a),
                ];
            default:
                return [
                    amp * Math.sin(t + seed.a),
                    amp * Math.sin(t + seed.b),
                ];
        }
    }

    /* Apply per-anchor wiggle to one path's segments for one frame */
    function wigglePathSegs(segs, seeds, frame, N, amp, type) {
        let prevDx = 0,
            prevDy = 0;
        let si = 0;
        return segs.map((seg) => {
            if (seg.cmd === "Z") {
                prevDx = 0;
                prevDy = 0;
                return seg;
            }
            const seed = seeds[si];
            const total = seeds.length;
            const [dx, dy] = compute2D(
                frame,
                N,
                amp,
                seed,
                type,
                si,
                total,
            );
            si++;
            const q = seg.p.slice(); // copy params
            switch (seg.cmd) {
                case "M":
                case "L":
                case "T":
                    q[0] += dx;
                    q[1] += dy;
                    break;
                case "C":
                    // ctrl1 (q0,q1) follows prev anchor; ctrl2 (q2,q3) + endpoint (q4,q5) follow this anchor
                    q[0] += prevDx;
                    q[1] += prevDy;
                    q[2] += dx;
                    q[3] += dy;
                    q[4] += dx;
                    q[5] += dy;
                    break;
                case "S":
                    // ctrl2 (q0,q1) + endpoint (q2,q3) follow this anchor
                    q[0] += dx;
                    q[1] += dy;
                    q[2] += dx;
                    q[3] += dy;
                    break;
                case "Q":
                    // control point blended between prev and this anchor
                    q[0] += (prevDx + dx) * 0.5;
                    q[1] += (prevDy + dy) * 0.5;
                    q[2] += dx;
                    q[3] += dy;
                    break;
                case "A":
                    // only move the endpoint; leave radii and flags intact
                    q[5] += dx;
                    q[6] += dy;
                    break;
            }
            prevDx = dx;
            prevDy = dy;
            return { cmd: seg.cmd, p: q };
        });
    }

    /* ════════════════════════════════════════════════════════
 TARGET EXTRACTION
 ════════════════════════════════════════════════════════ */

    function extractTargets(doc) {
        const targets = [];

        /* Paths */
        doc.querySelectorAll("path").forEach((el) => {
            const d = el.getAttribute("d");
            if (!d) return;
            const segs = pathToAbsSegs(d);
            // One seed per non-Z segment (each anchor)
            const count = segs.filter((s) => s.cmd !== "Z").length;
            targets.push({ el, kind: "path", segs, count });
        });

        /* Simple point-based elements — stored as xy-pairs */
        const pairMap = {
            circle: [["cx", "cy"]],
            ellipse: [["cx", "cy"]],
            rect: [["x", "y"]],
            line: [
                ["x1", "y1"],
                ["x2", "y2"],
            ],
        };
        for (const [tag, pairs] of Object.entries(pairMap)) {
            doc.querySelectorAll(tag).forEach((el) => {
                const orig = pairs.map(([a, b]) => [
                    parseFloat(el.getAttribute(a)) || 0,
                    parseFloat(el.getAttribute(b)) || 0,
                ]);
                targets.push({ el, kind: "simple", pairs, orig });
            });
        }

        /* Polylines / polygons */
        doc.querySelectorAll("polyline, polygon").forEach((el) => {
            const pts = el.getAttribute("points");
            if (!pts) return;
            const nums = [];
            let m;
            const re = /(-?(?:\d+\.?\d*|\.\d+))/g;
            while ((m = re.exec(pts)) !== null)
                nums.push(parseFloat(m[0]));
            // group into xy-pairs; if odd, last number is lone X
            const pairs = [];
            for (let i = 0; i + 1 < nums.length; i += 2)
                pairs.push([nums[i], nums[i + 1]]);
            targets.push({ el, kind: "polypts", pairs });
        });

        return targets;
    }

    function makeSeeds(targets) {
        return targets.map((t) => {
            const n = t.kind === "path" ? t.count : t.pairs.length;
            const arr = [];
            for (let i = 0; i < n; i++)
                arr.push({ a: r2pi(), b: r2pi(), c: r2pi() });
            return arr;
        });
    }

    /* Apply one frame of wiggle to all targets */
    function applyFrame(targets, seeds, frame, N, amp, type) {
        targets.forEach((tgt, ti) => {
            const s = seeds[ti];
            const total = s.length;

            if (tgt.kind === "path") {
                const wiggled = wigglePathSegs(
                    tgt.segs,
                    s,
                    frame,
                    N,
                    amp,
                    type,
                );
                tgt.el.setAttribute("d", segsToD(wiggled));
            } else if (tgt.kind === "simple") {
                tgt.pairs.forEach(([ax, ay], pi) => {
                    const [dx, dy] = compute2D(
                        frame,
                        N,
                        amp,
                        s[pi],
                        type,
                        pi,
                        total,
                    );
                    tgt.el.setAttribute(ax, tgt.orig[pi][0] + dx);
                    tgt.el.setAttribute(ay, tgt.orig[pi][1] + dy);
                });
            } else if (tgt.kind === "polypts") {
                const wiggled = tgt.pairs.map(([ox, oy], pi) => {
                    const [dx, dy] = compute2D(
                        frame,
                        N,
                        amp,
                        s[pi],
                        type,
                        pi,
                        total,
                    );
                    return `${(ox + dx).toFixed(3)},${(oy + dy).toFixed(3)}`;
                });
                tgt.el.setAttribute("points", wiggled.join(" "));
            }
        });
    }

    /* ════════════════════════════════════════════════════════
 PRE-RENDER ALL FRAMES
 ════════════════════════════════════════════════════════ */

    async function preRender() {
        const N = parseInt(rFrames.value);
        const amp = parseFloat(rWiggle.value);
        const scale = parseFloat(rScale.value);
        const type = sType.value;
        const pad = parseInt(rPad.value);
        const bg = cBg.value;

        const parser = new DOMParser();
        const doc = parser.parseFromString(
            svgText,
            "image/svg+xml",
        );
        injectStroke(doc);
        const { vbW, vbH } = prepareSvg(doc.documentElement, pad);

        canvas.width = Math.round(vbW * scale);
        canvas.height = Math.round(vbH * scale);

        const targets = extractTargets(doc);
        const seeds = makeSeeds(targets);
        const ser = new XMLSerializer();
        const frames = [];

        for (let f = 0; f < N; f++) {
            statusEl.textContent = `Generating ${f + 1} / ${N}…`;
            await new Promise((r) => setTimeout(r, 0)); // yield → UI updates

            applyFrame(targets, seeds, f, N, amp, type);
            const svgStr = ser.serializeToString(doc);

            const img = await new Promise((res, rej) => {
                const blob = new Blob([svgStr], {
                    type: "image/svg+xml;charset=utf-8",
                });
                const url = URL.createObjectURL(blob);
                const im = new Image();
                im.onload = () => {
                    URL.revokeObjectURL(url);
                    res(im);
                };
                im.onerror = () => {
                    URL.revokeObjectURL(url);
                    rej(new Error(`Frame ${f + 1} failed`));
                };
                im.src = url;
            });

            // Pre-bake bg + SVG onto an offscreen canvas for zero-cost playback
            const oc = document.createElement("canvas");
            oc.width = canvas.width;
            oc.height = canvas.height;
            const oc2 = oc.getContext("2d");
            oc2.fillStyle = bg;
            oc2.fillRect(0, 0, oc.width, oc.height);
            oc2.drawImage(img, 0, 0, oc.width, oc.height);
            frames.push(oc);
        }
        return frames;
    }

    /* ════════════════════════════════════════════════════════
 ANIMATION LOOP
 ════════════════════════════════════════════════════════ */

    function setExportEnabled(on) {
        btnGIF.disabled = !on;
        btnWebM.disabled = !on;
    }

    function startAnimation() {
        if (!animFrames.length) return;
        animating = true;
        curFrame = 0;
        lastTime = 0;
        btnRun.style.display = "none";
        btnStop.style.display = "inline-block";
        setExportEnabled(true);

        function tick(ts) {
            if (!animating) return;
            const fps = parseInt(rFps.value);
            const interval = 1000 / fps;
            if (!lastTime) lastTime = ts;
            if (ts - lastTime >= interval) {
                const src = animFrames[curFrame];
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(src, 0, 0);
                statusEl.textContent = `Frame ${curFrame + 1} / ${animFrames.length}`;
                curFrame = (curFrame + 1) % animFrames.length;
                lastTime = ts - ((ts - lastTime) % interval);
            }
            animId = requestAnimationFrame(tick);
        }
        animId = requestAnimationFrame(tick);
    }

    function stopAnimation() {
        animating = false;
        if (animId) {
            cancelAnimationFrame(animId);
            animId = null;
        }
        btnRun.style.display = "inline-block";
        btnStop.style.display = "none";
    }

    /* ── Button handlers ── */
    btnRun.addEventListener("click", async () => {
        if (!svgText) return;
        stopAnimation();
        btnRun.disabled = true;
        try {
            animFrames = await preRender();
            btnRun.disabled = false;
            startAnimation();
        } catch (err) {
            console.error(err);
            statusEl.textContent = "Error: " + err.message;
            btnRun.disabled = false;
        }
    });

    btnStop.addEventListener("click", () => {
        stopAnimation();
        statusEl.textContent = "Stopped.";
    });

    btnGIF.addEventListener("click", () => exportGIF());
    btnWebM.addEventListener("click", () => exportWebM());

    /* ── Auto-reload on control change ── */
    let reloadTimer = null;
    async function triggerReload() {
        if (!svgText) return;
        stopAnimation();
        btnRun.disabled = true;
        try {
            animFrames = await preRender();
            btnRun.disabled = false;
            startAnimation();
        } catch (err) {
            console.error(err);
            statusEl.textContent = "Error: " + err.message;
            btnRun.disabled = false;
        }
    }
    function scheduleReload() {
        if (!svgText) return;
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(triggerReload, 400);
    }
    [rScale, rWiggle, rFrames, rFps, rPad, cBg, cStroke, rSW, sType, chkStroke]
        .forEach(el => {
            el.addEventListener("input", scheduleReload);
            el.addEventListener("change", scheduleReload);
        });

    /* ════════════════════════════════════════════════════════
 EXPORT — GIF (pure inline encoder, zero dependencies)
 Algorithm: frequency-based palette quantization + LZW
 ════════════════════════════════════════════════════════ */

    async function exportGIF() {
        if (!animFrames.length) return;
        const W = canvas.width,
            H = canvas.height;
        const fps = parseInt(rFps.value);
        const delayHundredths = Math.max(1, Math.round(100 / fps)); // GIF delay unit = 1/100 s

        setExportEnabled(false);
        statusEl.textContent = "Building palette…";
        await tick();

        /* 1 ── Collect pixel data from all pre-baked canvases */
        const allData = animFrames.map(
            (c) => c.getContext("2d").getImageData(0, 0, W, H).data,
        );

        /* 2 ── Frequency count (ignore alpha; background is pre-baked) */
        const freq = new Map();
        for (const d of allData) {
            for (let i = 0; i < d.length; i += 4) {
                const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
                freq.set(k, (freq.get(k) || 0) + 1);
            }
        }

        /* 3 ── Sort by frequency, take top 255 (slot 0 reserved for bg) */
        const sorted = [...freq.entries()].sort(
            (a, b) => b[1] - a[1],
        );
        const rawPal = sorted
            .slice(0, 255)
            .map(([k]) => [
                (k >> 16) & 0xff,
                (k >> 8) & 0xff,
                k & 0xff,
            ]);
        rawPal.unshift([0, 0, 0]); // index 0: unused / transparent placeholder

        /* 4 ── Pad palette to power-of-2 size */
        const bits = Math.max(
            2,
            Math.ceil(Math.log2(Math.max(rawPal.length, 2))),
        );
        const palSize = 1 << bits;
        while (rawPal.length < palSize) rawPal.push([0, 0, 0]);
        const colorTableField = bits - 1; // 0-7, stored in GIF header packed byte
        const minCodeSize = Math.max(2, bits);

        /* 5 ── Nearest-color lookup with cache */
        const qCache = new Map();
        function nearest(r, g, b) {
            const key = (r << 16) | (g << 8) | b;
            if (qCache.has(key)) return qCache.get(key);
            let best = 0,
                bestD = Infinity;
            for (let i = 0; i < rawPal.length; i++) {
                const dr = r - rawPal[i][0],
                    dg = g - rawPal[i][1],
                    db = b - rawPal[i][2];
                const d = dr * dr + dg * dg + db * db;
                if (d < bestD) {
                    bestD = d;
                    best = i;
                    if (d === 0) break;
                }
            }
            qCache.set(key, best);
            return best;
        }

        /* 6 ── GIF binary writer helpers */
        const out = [];
        const wb = (...bytes) =>
            bytes.forEach((b) => out.push(b & 0xff));
        const ws = (n) => {
            wb(n & 0xff, (n >> 8) & 0xff);
        };
        const wst = (s) => {
            for (let i = 0; i < s.length; i++) wb(s.charCodeAt(i));
        };

        /* 7 ── Header + Logical Screen Descriptor */
        wst("GIF89a");
        ws(W);
        ws(H);
        wb(0xf0 | colorTableField); // GCT present, 8-bit color res, no sort, GCT size
        wb(0); // BG color index
        wb(0); // pixel aspect ratio

        /* 8 ── Global Color Table */
        for (const [r, g, b] of rawPal) wb(r, g, b);

        /* 9 ── Netscape loop extension */
        wb(0x21, 0xff, 11);
        wst("NETSCAPE2.0");
        wb(3, 1);
        ws(0);
        wb(0); // 0 = infinite loop

        /* 10 ── Encode each frame */
        for (let fi = 0; fi < allData.length; fi++) {
            statusEl.textContent = `Encoding GIF frame ${fi + 1} / ${allData.length}…`;
            await tick();

            /* quantize */
            const fd = allData[fi];
            const indices = new Uint8Array(W * H);
            for (let i = 0; i < W * H; i++)
                indices[i] = nearest(fd[i * 4], fd[i * 4 + 1], fd[i * 4 + 2]);

            /* Graphic Control Extension */
            wb(0x21, 0xf9, 4, 0);
            ws(delayHundredths);
            wb(0, 0);

            /* Image Descriptor */
            wb(0x2c);
            ws(0); ws(0); ws(W); ws(H);
            wb(0); // no local color table

            /* LZW compress */
            const lzwData = lzwEncode(indices, minCodeSize);
            wb(minCodeSize);
            // write in 255-byte sub-blocks
            for (let off = 0; off < lzwData.length; off += 255) {
                const chunk = lzwData.slice(off, off + 255);
                wb(chunk.length);
                chunk.forEach(b => wb(b));
            }
            wb(0); // block terminator
        }

        /* 11 ── Trailer */
        wb(0x3b);

        const blob = new Blob([new Uint8Array(out)], { type: "image/gif" });
        downloadBlob(blob, "wiggle.gif");
        statusEl.textContent = "GIF saved!";
        setExportEnabled(true);
    }

    /* LZW encoder */
    function lzwEncode(indices, minCodeSize) {
        const clearCode = 1 << minCodeSize;
        const eofCode = clearCode + 1;
        let nextCode = eofCode + 1;
        const table = new Map();
        const resetTable = () => {
            table.clear();
            for (let i = 0; i < clearCode; i++) table.set(String(i), i);
            nextCode = eofCode + 1;
        };

        let codeSize = minCodeSize + 1;
        const bits = [];
        const pushBits = (code) => {
            for (let b = 0; b < codeSize; b++)
                bits.push((code >> b) & 1);
        };

        resetTable();
        pushBits(clearCode);

        let buf = String(indices[0]);
        for (let i = 1; i < indices.length; i++) {
            const next = buf + "," + indices[i];
            if (table.has(next)) {
                buf = next;
            } else {
                pushBits(table.get(buf));
                if (nextCode < 4096) {
                    table.set(next, nextCode++);
                    if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
                } else {
                    pushBits(clearCode);
                    resetTable();
                    codeSize = minCodeSize + 1;
                }
                buf = String(indices[i]);
            }
        }
        pushBits(table.get(buf));
        pushBits(eofCode);

        // pack bits into bytes
        const bytes = [];
        for (let i = 0; i < bits.length; i += 8) {
            let b = 0;
            for (let j = 0; j < 8 && i + j < bits.length; j++)
                b |= bits[i + j] << j;
            bytes.push(b);
        }
        return bytes;
    }

    async function exportWebM() {
        if (!animFrames.length) return;
        if (!canvas.captureStream || !window.MediaRecorder) {
            statusEl.textContent =
                "WebM not supported in this browser. Try Chrome or Firefox.";
            return;
        }

        const fps = parseInt(rFps.value);
        const frameDelay = 1000 / fps;

        // Try codecs in preference order
        const mimes = [
            "video/webm;codecs=vp9",
            "video/webm;codecs=vp8",
            "video/webm",
        ];
        const mime =
            mimes.find((m) => MediaRecorder.isTypeSupported(m)) ||
            "video/webm";

        setExportEnabled(false);
        stopAnimation();
        statusEl.textContent = "Recording WebM…";
        await tick();

        const stream = canvas.captureStream(fps);
        const recorder = new MediaRecorder(stream, {
            mimeType: mime,
        });
        const chunks = [];

        recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) chunks.push(e.data);
        };
        recorder.onstop = () => {
            const blob = new Blob(chunks, { type: "video/webm" });
            downloadBlob(blob, "wiggle.webm");
            statusEl.textContent = "WebM saved!";
            setExportEnabled(true);
            startAnimation();
        };

        recorder.start();
        // Render frames onto the canvas while recorder captures the stream
        for (let i = 0; i < animFrames.length; i++) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(animFrames[i], 0, 0);
            statusEl.textContent = `Recording frame ${i + 1} / ${animFrames.length}…`;
            await new Promise((r) => setTimeout(r, frameDelay));
        }
        // Hold last frame one tick so encoder flushes it
        await new Promise((r) => setTimeout(r, frameDelay));
        recorder.stop();
    }

    /* ── Shared utilities ── */
    function downloadBlob(blob, name) {
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement("a"), {
            href: url,
            download: name,
        });
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    function tick() {
        return new Promise((r) => setTimeout(r, 0));
    }
})();

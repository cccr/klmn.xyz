// Runs the adraw API in the browser, for hosting the UI as static files.
//
// Loads adraw.wasm — the real web.Handler compiled to WebAssembly — and
// exposes it two ways:
//
//   adrawFetch('/api/render?…')  a Promise of a Response, for a page written
//                                against the static build (klmn.xyz).
//   fetch('/api/…')              routed to the same place, so adraw's own
//                                app.js runs unchanged with no server behind
//                                it. Every other fetch passes straight through.
//
// adraw.wasm and adraw.json are found beside this script rather than beside
// the page, so it works from any path. ES5 throughout: klmn.xyz serves its
// page scripts unbundled and untranspiled.
//
// Loaded after wasm_exec.js and before whatever calls it.
(function () {
    'use strict';

    var script = document.currentScript;
    var base = script ? script.src.replace(/[^\/]*$/, '') : '';
    var realFetch = window.fetch.bind(window);

    var started;
    var ready = new Promise(function (resolve) { started = resolve; });
    window.adrawReady = function () { started(); };

    // Streaming compiles while downloading, but only if the host sends
    // application/wasm. Not every static host does, so fall back to buffering.
    function instantiate(go) {
        var url = base + 'adraw.wasm';
        return WebAssembly.instantiateStreaming(realFetch(url), go.importObject)
            .catch(function () {
                return realFetch(url)
                    .then(function (r) { return r.arrayBuffer(); })
                    .then(function (b) { return WebAssembly.instantiate(b, go.importObject); });
            });
    }

    // adraw.json is fetched as a plain file rather than compiled in, so the
    // gallery stays tunable on the live site without rebuilding the module.
    var config = realFetch(base + 'adraw.json').then(
        function (r) { return r.ok ? r.text() : null; },
        function () { return null; });

    var go = new Go();
    var boot = instantiate(go).then(function (mod) {
        go.run(mod.instance);
        return Promise.all([ready, config]);
    }).then(function (r) {
        if (r[1] !== null) window.adrawConfig(r[1]);
    });

    window.adrawFetch = function (path) {
        return boot.then(function () {
            var res = window.adrawServe(path);
            return new Response(res.body, { status: res.status, headers: res.headers });
        });
    };

    window.fetch = function (input, init) {
        var url = typeof input === 'string' ? input : input.url;
        return url.indexOf('/api/') === 0 ? window.adrawFetch(url) : realFetch(input, init);
    };
})();

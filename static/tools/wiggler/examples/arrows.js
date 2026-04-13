(function () {
    const PATH = "M10 40 L60 40 L60 20 L90 50 L60 80 L60 60 L10 60 Z";

    const DIRS = [
        { label: "Right",      angle:   0 },
        { label: "Up",         angle: -90 },
        { label: "Left",       angle: 180 },
        { label: "Down",       angle:  90 },
        { label: "Up-Right",   angle: -45 },
        { label: "Up-Left",    angle: -135 },
        { label: "Down-Right", angle:  45 },
        { label: "Down-Left",  angle: 135 },
    ];

    function makeSvg(angle) {
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${PATH}" transform="rotate(${angle},50,50)" fill="none" stroke="#333" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
    }

    function makeThumb(angle) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${PATH}" transform="rotate(${angle},50,50)" fill="none" stroke="#555" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
        return `<img src="data:image/svg+xml;base64,${btoa(svg)}" width="100%" height="100%" style="display:block">`;
    }

    window.WigglerExamples.register({
        id: "arrows",
        label: "Arrows",
        items: DIRS.map(({ label, angle }) => ({
            label,
            svgString: makeSvg(angle),
            thumbnail: makeThumb(angle),
        })),
    });
})();

window.WigglerExamples = {
    _loader: null,
    _container: null,
    _label: null,
    setup(loaderFn) {
        this._loader = loaderFn;
        this._container = document.getElementById("wiggler-examples");
        this._label = document.getElementById("wiggler-examples-label");
        this._label.addEventListener("click", () => this._toggle());
    },
    _toggle() {
        const collapsed = this._container.classList.toggle("collapsed");
        this._label.classList.toggle("collapsed", collapsed);
        this._label.setAttribute("aria-expanded", String(!collapsed));
    },
    _collapse() {
        this._container.classList.add("collapsed");
        this._label.classList.add("collapsed");
        this._label.setAttribute("aria-expanded", "false");
    },
    register({ id, label, items }) {
        if (!this._container) return;
        this._label.style.display = "";
        const group = document.createElement("div");
        group.className = "examples-group";
        group.dataset.id = id;
        const sublabel = document.createElement("div");
        sublabel.className = "examples-sublabel";
        sublabel.textContent = label;
        const grid = document.createElement("div");
        grid.className = "examples-grid";
        items.forEach(({ label: itemLabel, svgString, thumbnail }) => {
            const btn = document.createElement("button");
            btn.className = "example-btn";
            btn.title = itemLabel;
            btn.innerHTML = thumbnail;
            btn.addEventListener("click", () => {
                if (this._loader) {
                    this._loader(svgString, itemLabel);
                    this._collapse();
                }
            });
            grid.appendChild(btn);
        });
        group.appendChild(sublabel);
        group.appendChild(grid);
        this._container.appendChild(group);
    },
};

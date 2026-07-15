const LAYOUT_STORAGE_KEY = 'curviosclash.editor.layout.v1';

function readLayoutState() {
    try {
        const parsed = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) || '{}');
        return {
            dockCollapsed: parsed.dockCollapsed === true,
            dockDetailed: parsed.dockDetailed === true,
            dockCompact: parsed.dockCompact !== false,
            helpVisible: parsed.helpVisible !== false,
        };
    } catch {
        return { dockCollapsed: false, dockDetailed: false, dockCompact: true, helpVisible: true };
    }
}

function writeLayoutState(state) {
    try {
        localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(state));
    } catch {
        // Layout persistence is optional.
    }
}

export function bindEditorLayoutControls(editor) {
    if (!editor) return;
    const dom = editor.dom || {};
    const dock = dom.buildDock;
    const shell = dock?.parentElement || null;
    const state = readLayoutState();

    const syncDockHeight = () => {
        if (!shell || !dock) return;
        shell.style.setProperty('--dock-height', `${Math.ceil(dock.getBoundingClientRect().height)}px`);
    };

    const render = () => {
        dock?.classList.toggle('is-collapsed', state.dockCollapsed);
        dock?.classList.toggle('is-detailed', state.dockDetailed && !state.dockCollapsed);
        dock?.classList.toggle('is-compact-view', state.dockCompact);
        dom.editorHelp?.classList.toggle('is-hidden', !state.helpVisible);

        if (dom.btnDockCollapse) {
            dom.btnDockCollapse.textContent = state.dockCollapsed ? 'Ausklappen' : 'Einklappen';
            dom.btnDockCollapse.setAttribute('aria-pressed', String(state.dockCollapsed));
        }
        if (dom.btnToggleDockFromScene) {
            dom.btnToggleDockFromScene.textContent = state.dockCollapsed ? 'Baukarten zeigen' : 'Baukarten ausblenden';
            dom.btnToggleDockFromScene.setAttribute('aria-pressed', String(!state.dockCollapsed));
        }
        if (dom.btnDockDetailToggle) {
            dom.btnDockDetailToggle.textContent = state.dockDetailed ? 'Details verbergen' : 'Details zeigen';
            dom.btnDockDetailToggle.setAttribute('aria-pressed', String(state.dockDetailed));
            dom.btnDockDetailToggle.disabled = state.dockCollapsed;
        }
        if (dom.btnDockViewToggle) {
            dom.btnDockViewToggle.textContent = state.dockCompact ? 'Kompakt' : 'Karten';
            dom.btnDockViewToggle.setAttribute('aria-pressed', String(state.dockCompact));
        }
        if (dom.btnToggleHelp) {
            dom.btnToggleHelp.textContent = state.helpVisible ? 'Hilfe ausblenden' : 'Hilfe zeigen';
            dom.btnToggleHelp.setAttribute('aria-pressed', String(state.helpVisible));
        }

        writeLayoutState(state);
        requestAnimationFrame(syncDockHeight);
    };

    const toggleDock = () => {
        state.dockCollapsed = !state.dockCollapsed;
        render();
    };

    dom.btnDockCollapse?.addEventListener('click', toggleDock);
    dom.btnToggleDockFromScene?.addEventListener('click', toggleDock);
    dom.btnDockDetailToggle?.addEventListener('click', () => {
        state.dockDetailed = !state.dockDetailed;
        render();
    });
    dom.btnDockViewToggle?.addEventListener('click', () => {
        state.dockCompact = !state.dockCompact;
        render();
    });
    dom.btnToggleHelp?.addEventListener('click', () => {
        state.helpVisible = !state.helpVisible;
        render();
    });

    const resizeObserver = typeof ResizeObserver === 'function' && dock
        ? new ResizeObserver(syncDockHeight)
        : null;
    resizeObserver?.observe(dock);
    window.addEventListener('resize', syncDockHeight);

    editor.layoutState = state;
    editor.refreshLayout = render;
    render();
}

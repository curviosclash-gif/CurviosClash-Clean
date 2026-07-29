const LAYOUT_STORAGE_KEY = 'curviosclash.editor.layout.v1';
const INSPECTOR_PANELS = ['objects', 'layers', 'map', 'validation'];

function readLayoutState() {
    try {
        const parsed = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) || '{}');
        return {
            dockCollapsed: parsed.dockCollapsed === true,
            dockDetailed: parsed.dockDetailed === true,
            dockCompact: parsed.dockCompact !== false,
            helpVisible: parsed.helpVisible === true,
            helpSeen: parsed.helpSeen === true,
            activePanel: INSPECTOR_PANELS.includes(parsed.activePanel) ? parsed.activePanel : 'objects',
        };
    } catch {
        return {
            dockCollapsed: false,
            dockDetailed: false,
            dockCompact: true,
            helpVisible: false,
            helpSeen: false,
            activePanel: 'objects',
        };
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
    const inspectorTabs = Array.from(document.querySelectorAll('[data-editor-tab]'));
    const inspectorPanels = Array.from(document.querySelectorAll('[data-editor-tab-panel]'));

    const syncDockHeight = () => {
        if (!shell || !dock) return;
        shell.style.setProperty('--dock-height', `${Math.ceil(dock.getBoundingClientRect().height)}px`);
    };

    const render = () => {
        dock?.classList.toggle('is-collapsed', state.dockCollapsed);
        dock?.classList.toggle('is-detailed', state.dockDetailed && !state.dockCollapsed);
        dock?.classList.toggle('is-compact-view', state.dockCompact);
        dom.editorHelp?.classList.toggle('is-hidden', !state.helpVisible);
        inspectorTabs.forEach((tab) => {
            const active = tab.dataset.editorTab === state.activePanel;
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
        });
        inspectorPanels.forEach((panel) => {
            panel.hidden = panel.dataset.editorTabPanel !== state.activePanel;
        });
        if (state.activePanel === 'validation' && dom.validationDetails) {
            dom.validationDetails.open = true;
        }

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
            dom.btnToggleHelp.textContent = '?';
            dom.btnToggleHelp.setAttribute('aria-label', state.helpVisible ? 'Hilfe ausblenden' : 'Hilfe anzeigen');
            dom.btnToggleHelp.title = state.helpVisible ? 'Hilfe ausblenden' : 'Hilfe anzeigen';
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
        if (state.dockDetailed) state.dockCompact = false;
        render();
    });
    dom.btnDockViewToggle?.addEventListener('click', () => {
        state.dockCompact = !state.dockCompact;
        if (state.dockCompact) state.dockDetailed = false;
        render();
    });
    dom.btnToggleHelp?.addEventListener('click', () => {
        state.helpVisible = !state.helpVisible;
        state.helpSeen = true;
        render();
    });

    const showInspectorPanel = (panelId, { focus = false } = {}) => {
        if (!INSPECTOR_PANELS.includes(panelId)) return false;
        state.activePanel = panelId;
        render();
        if (focus) inspectorTabs.find((tab) => tab.dataset.editorTab === panelId)?.focus();
        return true;
    };
    inspectorTabs.forEach((tab, index) => {
        tab.addEventListener('click', () => showInspectorPanel(tab.dataset.editorTab));
        tab.addEventListener('keydown', (event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const nextIndex = event.key === 'Home'
                ? 0
                : event.key === 'End'
                    ? inspectorTabs.length - 1
                    : (index + (event.key === 'ArrowRight' ? 1 : -1) + inspectorTabs.length) % inspectorTabs.length;
            showInspectorPanel(inspectorTabs[nextIndex]?.dataset.editorTab, { focus: true });
        });
    });

    const resizeObserver = typeof ResizeObserver === 'function' && dock
        ? new ResizeObserver(syncDockHeight)
        : null;
    resizeObserver?.observe(dock);
    window.addEventListener('resize', syncDockHeight);

    editor.layoutState = state;
    editor.refreshLayout = render;
    editor.showInspectorPanel = showInspectorPanel;
    render();
}

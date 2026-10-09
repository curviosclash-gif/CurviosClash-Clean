import { createEditorBuildHotbar, EDITOR_BUILD_HOTBAR_SLOT_COUNT } from '../EditorBuildHotbar.js';
import { findEditorBuildEntryByToolAndSubtype } from './EditorBuildCatalog.js';

const STYLE_TEXT = `
.editor-build-flight { --ebf-bg:#111923; --ebf-panel:#1b2734; --ebf-border:#3a4b5d; --ebf-text:#edf4fb; --ebf-muted:#b6c5d4; color:var(--ebf-text); font:600 14px/1.35 system-ui,sans-serif; }
.editor-build-flight[hidden], .editor-build-flight-menu[hidden] { display:none !important; }
.editor-build-flight button, .editor-build-flight select { color:var(--ebf-text); background:var(--ebf-panel); border:1px solid var(--ebf-border); border-radius:8px; font:inherit; }
.editor-build-flight button { min-height:40px; padding:8px 12px; cursor:pointer; }
.editor-build-flight button:hover { border-color:#91b9df; }
.editor-build-flight button:focus-visible, .editor-build-flight select:focus-visible { outline:3px solid #69b7ff; outline-offset:2px; }
.editor-build-flight-hotbar { position:fixed; z-index:1100; left:50%; bottom:16px; transform:translateX(-50%); display:flex; gap:6px; padding:8px; background:#0c121bea; border:1px solid var(--ebf-border); border-radius:14px; box-shadow:0 8px 32px #0008; }
.editor-build-flight-toolbar { position:fixed; z-index:1100; top:12px; left:50%; transform:translateX(-50%); display:flex; align-items:center; gap:8px; padding:8px; background:#0c121bea; border:1px solid var(--ebf-border); border-radius:14px; box-shadow:0 8px 32px #0008; }
.editor-build-flight-toolbar .editor-build-flight-status { margin:0 4px; }
.editor-build-flight-toolbar .editor-build-flight-actions { flex-wrap:wrap; }
.editor-build-flight-slot { display:flex; flex-direction:column; align-items:center; justify-content:center; width:76px; min-height:64px !important; padding:5px !important; text-align:center; }
.editor-build-flight-slot[aria-pressed="true"] { border-color:#79c1ff; box-shadow:inset 0 0 0 1px #79c1ff; }
.editor-build-flight-slot-key { color:var(--ebf-muted); font-size:11px; }
.editor-build-flight-slot-name { overflow:hidden; max-width:100%; text-overflow:ellipsis; white-space:nowrap; }
.editor-build-flight-actions { display:flex; gap:6px; }
.editor-build-flight-menu { position:fixed; z-index:1200; inset:4vh 4vw; display:flex; flex-direction:column; overflow:auto; padding:16px; background:var(--ebf-bg); border:1px solid var(--ebf-border); border-radius:16px; box-shadow:0 24px 80px #000b; }
.editor-build-flight-menu-header { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.editor-build-flight-menu h2 { margin:0; font-size:22px; }
.editor-build-flight-status { display:flex; flex-wrap:wrap; gap:12px; margin:12px 0; color:var(--ebf-muted); }
.editor-build-flight-slot-assign { display:flex; align-items:center; gap:8px; margin:8px 0 12px; }
.editor-build-flight-content { display:flex; align-items:stretch; gap:12px; min-height:0; flex:1; }
.editor-build-flight-menu .editor-build-flight-dock-host { min-height:0; flex:1; overflow:auto; }
.editor-build-flight-properties-host { flex:0 0 min(360px, 32vw); min-width:240px; overflow:auto; padding:12px; border:1px solid var(--ebf-border); border-radius:10px; background:#ffffff08; }
.editor-build-flight-menu .editor-build-flight-dock-host > #buildDock { position:static !important; inset:auto !important; width:100% !important; max-height:none !important; transform:none !important; }
.editor-build-flight-position { margin:12px 0; border:1px solid var(--ebf-border); border-radius:8px; }
.editor-build-flight-position input[type="number"] { color:var(--ebf-text); background:var(--ebf-panel); border:1px solid var(--ebf-border); border-radius:4px; padding:6px; }
.editor-build-flight-position p { color:var(--ebf-muted); margin:8px 0 0; }
@media(max-width:800px) { .editor-build-flight-hotbar { max-width:96vw; overflow-x:auto; } .editor-build-flight-slot { flex:0 0 62px; width:62px; } .editor-build-flight-menu { inset:2vh 2vw; } }
`;

function makeButton(doc, text, action, className = '') {
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = text;
    if (className) button.className = className;
    if (action) button.addEventListener('click', action);
    return button;
}

export function createEditorBuildMenu(editor, callbacks = {}) {
    const doc = editor?.dom?.buildDock?.ownerDocument || globalThis.document;
    if (!doc?.body) return null;
    const dock = editor?.dom?.buildDock || doc.getElementById('buildDock');
    const snapshot = editor?.toolDockState?.getSnapshot?.() || {};
    let hotbar = createEditorBuildHotbar({
        favoriteEntries: snapshot.favoriteEntries,
        recentEntries: snapshot.recentEntries,
    });
    let hotbarInitialized = false;
    const root = doc.createElement('div');
    root.className = 'editor-build-flight';
    root.hidden = true;
    const style = doc.createElement('style');
    style.textContent = STYLE_TEXT;
    const hotbarEl = doc.createElement('nav');
    hotbarEl.className = 'editor-build-flight-hotbar';
    hotbarEl.setAttribute('aria-label', 'Bau-Hotbar, Tasten 1 bis 9');
    const menu = doc.createElement('section');
    menu.className = 'editor-build-flight-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-modal', 'true');
    menu.setAttribute('aria-labelledby', 'editor-build-flight-title');
    const header = doc.createElement('div');
    header.className = 'editor-build-flight-menu-header';
    const title = doc.createElement('h2');
    title.id = 'editor-build-flight-title';
    title.textContent = 'Build-Menü';
    const closeButton = makeButton(doc, 'Schließen');
    header.append(title, closeButton);
    const toolbar = doc.createElement('div');
    toolbar.className = 'editor-build-flight-toolbar';
    const actions = doc.createElement('div');
    actions.className = 'editor-build-flight-actions';
    const menuActions = doc.createElement('div');
    menuActions.className = 'editor-build-flight-actions';
    const status = doc.createElement('div');
    status.className = 'editor-build-flight-status';
    const modeStatus = doc.createElement('span');
    const pauseStatus = doc.createElement('span');
    const speedStatus = doc.createElement('span');
    const inputHint = doc.createElement('span');
    inputHint.textContent = 'Esc: Maus frei';
    status.append(modeStatus, pauseStatus, speedStatus, inputHint);
    const assignRow = doc.createElement('div');
    assignRow.className = 'editor-build-flight-slot-assign';
    const assignLabel = doc.createElement('label');
    assignLabel.textContent = 'Ausgewählten Katalogeintrag übernehmen in Platz';
    const assignSelect = doc.createElement('select');
    assignSelect.setAttribute('aria-label', 'Hotbar-Platz auswählen');
    for (let index = 0; index < EDITOR_BUILD_HOTBAR_SLOT_COUNT; index += 1) {
        const option = doc.createElement('option');
        option.value = String(index);
        option.textContent = String(index + 1);
        assignSelect.append(option);
    }
    assignLabel.append(assignSelect);
    const assignButton = makeButton(doc, 'In Platz übernehmen');
    assignRow.append(assignLabel, assignButton);
    const dockHost = doc.createElement('div');
    dockHost.className = 'editor-build-flight-dock-host';
    const propertiesHost = doc.createElement('aside');
    propertiesHost.className = 'editor-build-flight-properties-host';
    propertiesHost.setAttribute('aria-label', 'Objekteigenschaften');
    const content = doc.createElement('div');
    content.className = 'editor-build-flight-content';
    content.append(dockHost, propertiesHost);
    const precision = doc.createElement('fieldset');
    precision.className = 'editor-build-flight-position';
    const legend = doc.createElement('legend');
    legend.textContent = 'Bauposition (Karteneinheiten)';
    precision.append(legend);
    const positionInputs = {};
    for (const axis of ['x', 'y', 'z']) {
        const label = doc.createElement('label');
        label.textContent = `${axis.toUpperCase()} `;
        const input = doc.createElement('input');
        input.type = 'number'; input.step = 'any'; input.style.width = '110px';
        input.setAttribute('aria-label', `Bauposition ${axis.toUpperCase()}`);
        const commit = () => {
            if (input.value.trim() && Number.isFinite(Number(input.value))) callbacks.onPosition?.(axis, Number(input.value));
            else callbacks.onPosition?.();
        };
        input.addEventListener('change', commit);
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); commit(); }
        });
        label.append(input); precision.append(label); positionInputs[axis] = input;
    }
    const stepLabel = doc.createElement('label'); stepLabel.textContent = ' Schrittweite ';
    const stepSelect = doc.createElement('select'); stepSelect.setAttribute('aria-label', 'Bau-Schrittweite');
    for (const value of [0.1, 1, 10]) {
        const option = doc.createElement('option'); option.value = String(value); option.textContent = String(value); stepSelect.append(option);
    }
    stepSelect.value = '1'; stepSelect.addEventListener('change', () => callbacks.onStep?.(Number(stepSelect.value)));
    stepLabel.append(stepSelect); precision.append(stepLabel);
    const snapLabel = doc.createElement('label'); const snapInput = doc.createElement('input');
    snapInput.type = 'checkbox'; snapInput.setAttribute('aria-label', 'Bauposition am Raster ausrichten');
    snapInput.addEventListener('change', () => callbacks.onSnap?.(snapInput.checked));
    snapLabel.append(snapInput, ' Raster'); precision.append(snapLabel);
    const precisionHint = doc.createElement('p');
    precisionHint.textContent = 'Pfeile: X/Z · Bild ↑/↓: Y · Enter außerhalb des Menüs: bestätigen · Esc: verwerfen';
    precision.append(precisionHint);
    const targetLabel = doc.createElement('div');
    targetLabel.className = 'editor-build-flight-target'; targetLabel.hidden = true;
    targetLabel.style.cssText = 'position:fixed;z-index:1100;top:55%;left:50%;transform:translateX(-50%);padding:6px 12px;background:#0c121bea;border-radius:8px;pointer-events:none';
    let dockPlaceholder = null;
    let previousFocus = null;
    let menuOpen = false;
    let active = false;
    let externalStatus = { mode: 'Bauflug', paused: false, speed: 1 };
    const isTestMode = () => String(externalStatus.mode || '').toLowerCase() === 'test';
    const menuButton = makeButton(doc, 'Build-Menü', () => setMenuOpen(true));
    const pauseButton = makeButton(doc, 'Welt pausieren', () => callbacks.onPause?.());
    const testButton = makeButton(doc, 'Schiffs-Test', () => callbacks.onTest?.());
    const exitButton = makeButton(doc, 'Bearbeitungsansicht', () => callbacks.onExit?.());
    const moveButton = makeButton(doc, 'Auswahl bewegen', () => callbacks.onMove?.());
    actions.append(menuButton, pauseButton, testButton, exitButton);
    toolbar.append(actions, status);

    const snapshotHotbar = hotbar.getSnapshot();
    const slotButtons = snapshotHotbar.slots.map((entry, index) => {
        const button = makeButton(doc, '', () => selectSlot(index), 'editor-build-flight-slot');
        button.setAttribute('aria-pressed', 'false');
        const key = doc.createElement('span');
        key.className = 'editor-build-flight-slot-key';
        key.textContent = String(index + 1);
        const label = doc.createElement('span');
        label.className = 'editor-build-flight-slot-name';
        label.textContent = entry?.label || 'Leer';
        button.append(key, label);
        hotbarEl.append(button);
        return { button, label };
    });

    const render = () => {
        const state = hotbar.getSnapshot();
        state.slots.forEach((entry, index) => {
            slotButtons[index].label.textContent = entry?.label || 'Leer';
            slotButtons[index].button.title = entry ? `${entry.label} (${index + 1})` : `Leerer Platz ${index + 1}`;
            slotButtons[index].button.setAttribute('aria-pressed', String(index === state.selectedIndex));
        });
        const testMode = isTestMode();
        modeStatus.textContent = `Modus: ${testMode ? 'Schiffs-Test' : (externalStatus.mode || 'Bauflug')}`;
        pauseStatus.textContent = externalStatus.loading ? 'Spielwelt lädt…' : (!testMode && externalStatus.paused ? 'Pausiert' : 'Aktiv');
        speedStatus.textContent = `Tempo: ${externalStatus.speed ?? 1}×`;
        menuButton.disabled = testMode;
        pauseButton.disabled = testMode;
        testButton.textContent = testMode ? 'Zum Bauflug' : 'Schiffs-Test';
        slotButtons.forEach(({ button }) => { button.disabled = testMode; });
        assignButton.disabled = testMode;
        assignSelect.disabled = testMode;
        moveButton.disabled = testMode;
        precision.disabled = testMode || !!externalStatus.loading;
    };
    const restoreDock = () => {
        if (dock && dockPlaceholder?.parentNode) dockPlaceholder.parentNode.insertBefore(dock, dockPlaceholder);
        dockPlaceholder?.remove();
        dockPlaceholder = null;
    };
    const setMenuOpen = (open) => {
        const nextOpen = Boolean(open) && active && !isTestMode();
        if (nextOpen === menuOpen) return;
        menuOpen = nextOpen;
        if (menuOpen) {
            previousFocus = doc.activeElement;
            if (dock?.parentNode) {
                dockPlaceholder = doc.createComment('editor-build-flight-dock');
                dock.parentNode.insertBefore(dockPlaceholder, dock);
                dockHost.append(dock);
            }
            menu.hidden = false;
            closeButton.focus();
        } else {
            menu.hidden = true;
            restoreDock();
            if (previousFocus?.isConnected) previousFocus.focus();
            previousFocus = null;
        }
        callbacks.onMenuChange?.(menuOpen);
    };
    const onMenuKeydown = (event) => {
        if (event.key !== 'Tab') return;
        const focusable = Array.from(menu.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )).filter((element) => (
            !element.hidden
            && element.getAttribute('aria-hidden') !== 'true'
            && !element.closest('[hidden]')
        ));
        if (!focusable.length) {
            event.preventDefault();
            closeButton.focus();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (doc.activeElement === first || !menu.contains(doc.activeElement))) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (doc.activeElement === last || !menu.contains(doc.activeElement))) {
            event.preventDefault();
            first.focus();
        }
    };
    function selectSlot(index) {
        if (isTestMode()) return false;
        if (!hotbar.selectSlot(index)) return false;
        const entry = hotbar.getSnapshot().slots[index];
        render();
        if (entry) editor?.activateBuildCatalogEntry?.(entry.id);
        return true;
    }
    const refresh = () => {
        const selectedEntryId = editor?.toolDockState?.getSnapshot?.()?.selectedEntry?.id;
        const matchingIndex = hotbar.getSnapshot().slots.findIndex((entry) => entry?.id === selectedEntryId);
        if (matchingIndex >= 0) hotbar.selectSlot(matchingIndex);
        render();
    };
    const onDockSelectionEvent = () => {
        const previousEntryId = editor?.toolDockState?.getSnapshot?.()?.selectedEntry?.id || null;
        queueMicrotask(() => {
            const selectedEntry = editor?.toolDockState?.getSnapshot?.()?.selectedEntry || null;
            if (!selectedEntry || selectedEntry.id === previousEntryId) return;
            refresh();
            callbacks.onCatalogChange?.(selectedEntry);
        });
    };
    const onAssign = () => {
        if (isTestMode()) return;
        const selectedEntry = editor?.toolDockState?.getSnapshot?.()?.selectedEntry;
        if (!selectedEntry) return;
        if (hotbar.rebindSlot(Number(assignSelect.value), selectedEntry)) render();
    };
    menuActions.append(moveButton);
    assignButton.addEventListener('click', onAssign);
    closeButton.addEventListener('click', () => setMenuOpen(false));
    menu.addEventListener('keydown', onMenuKeydown);
    dock?.addEventListener('click', onDockSelectionEvent, true);
    dock?.addEventListener('change', onDockSelectionEvent, true);
    menu.append(header, menuActions, precision, assignRow, content);
    root.append(style, toolbar, hotbarEl, targetLabel, menu);
    doc.body.append(root);
    render();

    return {
        setActive(value) {
            active = Boolean(value);
            if (active && !hotbarInitialized) {
                const latestSnapshot = editor?.toolDockState?.getSnapshot?.() || {};
                hotbar = createEditorBuildHotbar({
                    favoriteEntries: latestSnapshot.favoriteEntries,
                    recentEntries: latestSnapshot.recentEntries,
                });
                hotbarInitialized = true;
                refresh();
            }
            root.hidden = !active;
            if (!active) setMenuOpen(false);
            render();
        },
        setMenuOpen,
        isMenuOpen: () => menuOpen,
        selectSlot,
        setStatus(value = {}) {
            externalStatus = { ...externalStatus, ...value };
            if (isTestMode()) setMenuOpen(false);
            render();
        },
        refresh,
        setPosition(position, snap, snapSize, force = false) {
            for (const axis of ['x', 'y', 'z']) {
                const input = positionInputs[axis];
                if (force || doc.activeElement !== input) input.value = String(Number(position[axis].toFixed(6)));
            }
            snapInput.checked = snap;
            stepSelect.disabled = snap;
            stepSelect.title = snap ? `Raster-Schritt: ${snapSize}` : 'Freie Schrittweite';
        },
        setTarget(target) {
            targetLabel.hidden = !target || menuOpen || isTestMode();
            const object = target?.object;
            const label = object && (findEditorBuildEntryByToolAndSubtype(object.userData.type, object.userData.subType)?.label || object.userData.type);
            targetLabel.textContent = target ? `${object ? `${label} · ${object.userData.id}` : 'Kulisse'} · ${target.status}` : '';
            if (target) {
                const bounds = callbacks.getViewportBounds?.();
                if (bounds) {
                    targetLabel.style.left = `${bounds.left + bounds.width / 2}px`;
                    targetLabel.style.top = `${bounds.top + bounds.height / 2 + 40}px`;
                }
            }
        },
        dispose() {
            setMenuOpen(false);
            restoreDock();
            dock?.removeEventListener('click', onDockSelectionEvent, true);
            dock?.removeEventListener('change', onDockSelectionEvent, true);
            menu.removeEventListener('keydown', onMenuKeydown);
            root.remove();
            active = false;
        },
        getState() {
            return { ...hotbar.getSnapshot(), active, menuOpen, status: { ...externalStatus } };
        },
        getPropertiesHost: () => propertiesHost,
    };
}

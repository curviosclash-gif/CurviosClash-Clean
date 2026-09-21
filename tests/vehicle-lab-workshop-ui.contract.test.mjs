import assert from 'node:assert/strict';
import test from 'node:test';

import { VehicleLabUI } from '../prototypes/vehicle-lab/src/VehicleLabUI.js';

class FakeClassList {
    constructor(element) {
        this.element = element;
        this.values = new Set();
    }

    add(value) {
        this.values.add(value);
        this.element.className = Array.from(this.values).join(' ');
    }

    remove(value) {
        this.values.delete(value);
        this.element.className = Array.from(this.values).join(' ');
    }

    toggle(value, force) {
        if (force === false) this.remove(value);
        else this.add(value);
    }
}

class FakeElement {
    constructor(tagName, id = '') {
        this.tagName = String(tagName || '').toUpperCase();
        this.id = id;
        this.children = [];
        this.dataset = {};
        this.style = {};
        this.className = '';
        this.classList = new FakeClassList(this);
        this.textContent = '';
        this.value = '';
        this.disabled = false;
        this.checked = false;
        this.selected = false;
        this.type = '';
        this.onclick = null;
        this.onchange = null;
        this.oninput = null;
        this.parentNode = null;
        this.hidden = false;
        this._innerHTML = '';
        this.listeners = new Map();
    }

    addEventListener(type, handler, options = {}) {
        if (typeof handler !== 'function') return;
        const entries = this.listeners.get(type) || [];
        entries.push({ handler, once: options?.once === true });
        this.listeners.set(type, entries);
    }

    removeEventListener(type, handler) {
        const entries = this.listeners.get(type) || [];
        this.listeners.set(type, entries.filter((entry) => entry.handler !== handler));
    }

    dispatch(type) {
        const entries = this.listeners.get(type) || [];
        this.listeners.set(type, entries.filter((entry) => !entry.once));
        entries.forEach((entry) => entry.handler({ type }));
    }

    focus() {}
    setAttribute(name, value) { this[name] = value; }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        if (this.tagName === 'SELECT') {
            if (!this.value || child.selected) this.value = child.value;
        }
        return child;
    }

    set innerHTML(value) {
        this._innerHTML = String(value);
        this.children = [];
    }

    get innerHTML() {
        return this._innerHTML;
    }
}

// Mirrors <dialog>: showModal() opens, close(value) only overwrites returnValue when a
// value is passed, and Escape closes without one.
class FakeDialogElement extends FakeElement {
    constructor(id) {
        super('dialog', id);
        this.returnValue = '';
        this.open = false;
    }

    showModal() {
        this.open = true;
    }

    close(returnValue) {
        if (returnValue !== undefined) this.returnValue = String(returnValue);
        this.open = false;
        this.dispatch('close');
    }

    pressEscape() {
        this.close();
    }
}

function createFakeDocument(ids) {
    const elements = new Map(ids.map((id) => [id, new FakeElement('div', id)]));
    elements.set('compareVehicleSelect', new FakeElement('select', 'compareVehicleSelect'));
    elements.set('presetSelect', new FakeElement('select', 'presetSelect'));
    elements.set('workshopDialog', new FakeDialogElement('workshopDialog'));
    elements.set('workshopDialogInput', new FakeElement('input', 'workshopDialogInput'));

    return {
        getElementById(id) {
            return elements.get(id) || null;
        },
        createElement(tagName) {
            return new FakeElement(tagName);
        },
        querySelectorAll() {
            return [];
        },
    };
}

function createWorkshopUi(callbacks = {}) {
    const previousDocument = globalThis.document;
    globalThis.document = createFakeDocument([
        'btnLoadPreset',
        'btnImportJson',
        'btnExportJson',
        'btnSaveVehicle',
        'btnRestoreDraft',
        'btnUndo',
        'btnRedo',
        'btnAddPart',
        'btnAddChild',
        'btnDeletePart',
        'btnDuplicatePart',
        'btnMirrorPart',
        'partSearch',
        'chkSnap',
        'snapTranslate',
        'snapRotate',
        'snapScale',
        'workshopDialogCancel',
        'workshopDialogTitle',
        'workshopDialogMessage',
        'workshopDialogInputLabel',
        'workshopDialogConfirm',
        'compareRows',
        'shipLabel',
        'shipPrimaryColor',
        'workshopStatusBar',
        'workshopStatusMessage',
        'workshopHistoryState',
        'workshopBlueprintState',
    ]);

    const ui = new VehicleLabUI({
        onLoadPreset: () => {},
        onImportJson: () => {},
        onExportJson: () => {},
        onUndo: () => {},
        onRedo: () => {},
        onAddPart: () => {},
        onAddChild: () => {},
        onDeletePart: () => {},
        onFlyModeChange: () => {},
        onWireframeChange: () => {},
        onHitboxChange: () => {},
        onGlobalUpdate: () => {},
        ...callbacks,
    });

    return {
        document: globalThis.document,
        restore() {
            globalThis.document = previousDocument;
        },
        ui,
    };
}

test('VehicleLabUI toggles undo and redo controls from history state', () => {
    const { document, restore, ui } = createWorkshopUi();
    try {
        ui.updateHistoryControls({ canUndo: true, canRedo: false });

        assert.equal(document.getElementById('btnUndo').disabled, false);
        assert.equal(document.getElementById('btnRedo').disabled, true);

        ui.updateHistoryControls({ canUndo: false, canRedo: true });

        assert.equal(document.getElementById('btnUndo').disabled, true);
        assert.equal(document.getElementById('btnRedo').disabled, false);
    } finally {
        restore();
    }
});

test('VehicleLabUI loads the selected vehicle immediately', () => {
    let selectedVehicle = '';
    const { document, restore } = createWorkshopUi({
        onLoadPreset: (vehicleId) => {
            selectedVehicle = vehicleId;
        },
    });

    try {
        const select = document.getElementById('presetSelect');
        select.onchange({ target: { value: 'spaceship' } });
        assert.equal(selectedVehicle, 'spaceship');
    } finally {
        restore();
    }
});

test('VehicleLabUI separates named save from draft recovery', () => {
    let saves = 0;
    let restores = 0;
    const { document, restore, ui } = createWorkshopUi({
        onSaveVehicle: () => { saves += 1; },
        onRestoreDraft: () => { restores += 1; },
    });
    try {
        document.getElementById('btnSaveVehicle').onclick();
        document.getElementById('btnRestoreDraft').onclick();
        ui.setDraftRecoveryAvailable(false);
        assert.equal(saves, 1);
        assert.equal(restores, 1);
        assert.equal(document.getElementById('btnRestoreDraft').disabled, true);
    } finally {
        restore();
    }
});

test('VehicleLabUI renders compare candidates and metric rows', () => {
    let selectedVehicle = '';
    const { document, restore, ui } = createWorkshopUi({
        onCompareVehicleChange: (vehicleId) => {
            selectedVehicle = vehicleId;
        },
    });

    try {
        ui.updateComparePanel({
            candidates: [
                { id: 'jet_fighter', label: 'Jet-Fighter' },
                { id: 'spaceship', label: 'Spaceship' },
            ],
            selectedId: 'spaceship',
            rows: [
                { key: 'parts', label: 'Bauteile', current: 8, baseline: 6, delta: 2, tone: 'info' },
                { key: 'animated', label: 'Animated', current: 0, baseline: 0, delta: 0 },
            ],
        });

        const select = document.getElementById('compareVehicleSelect');
        assert.equal(select.children.length, 2);
        assert.equal(select.value, 'spaceship');

        select.onchange({ target: { value: 'jet_fighter' } });
        assert.equal(selectedVehicle, 'jet_fighter');

        const rows = document.getElementById('compareRows').children;
        assert.equal(rows.length, 2);
        assert.equal(rows[0].dataset.metric, 'parts');
        assert.equal(rows[0].children[0].textContent, 'Bauteile');
        assert.equal(rows[0].children[1].textContent, '8');
        assert.equal(rows[0].children[2].textContent, '6');
        assert.equal(rows[0].children[3].textContent, '+2');
        assert.match(rows[0].children[3].className, /is-info/);
    } finally {
        restore();
    }
});

test('VehicleLabUI renders the desktop workshop status bar', () => {
    const { document, restore, ui } = createWorkshopUi();
    try {
        ui.updateStatusBar({
            message: 'Undo angewendet.',
            tone: 'info',
            historyState: { index: 1, length: 3 },
            blueprintStatus: 'Bauplan gültig',
            selectedLabel: 'Auswahl: Wing',
        });

        assert.equal(document.getElementById('workshopStatusBar').dataset.tone, 'info');
        assert.equal(document.getElementById('workshopStatusMessage').textContent, 'Undo angewendet. | Auswahl: Wing');
        assert.equal(document.getElementById('workshopHistoryState').textContent, 'Verlauf 2/3');
        assert.equal(document.getElementById('workshopBlueprintState').textContent, 'Bauplan gültig');
    } finally {
        restore();
    }
});

test('VehicleLabUI treats Escape as cancel after a confirmed dialog', async () => {
    const { document, restore, ui } = createWorkshopUi();
    try {
        const dialog = document.getElementById('workshopDialog');

        const renamePromise = ui.requestDialog({ title: 'Umbenennen', inputLabel: 'Name' });
        document.getElementById('workshopDialogInput').value = 'Jaeger';
        dialog.close('confirm');
        assert.equal(await renamePromise, 'Jaeger');

        const deletePromise = ui.requestDialog({ title: 'Fahrzeug loeschen?', danger: true });
        dialog.pressEscape();
        assert.equal(await deletePromise, null);
    } finally {
        restore();
    }
});

test('VehicleLabUI resolves a confirmed delete dialog without an input', async () => {
    const { document, restore, ui } = createWorkshopUi();
    try {
        const dialog = document.getElementById('workshopDialog');
        const deletePromise = ui.requestDialog({ title: 'Fahrzeug loeschen?', danger: true });
        dialog.close('confirm');
        assert.equal(await deletePromise, true);
    } finally {
        restore();
    }
});

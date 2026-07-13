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
        this._innerHTML = '';
    }

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

function createFakeDocument(ids) {
    const elements = new Map(ids.map((id) => [id, new FakeElement('div', id)]));
    elements.set('compareVehicleSelect', new FakeElement('select', 'compareVehicleSelect'));

    return {
        getElementById(id) {
            return elements.get(id) || null;
        },
        createElement(tagName) {
            return new FakeElement(tagName);
        },
    };
}

function createWorkshopUi(callbacks = {}) {
    const previousDocument = globalThis.document;
    globalThis.document = createFakeDocument([
        'btnLoadPreset',
        'btnImportJson',
        'btnExportJson',
        'btnUndo',
        'btnRedo',
        'btnAddPart',
        'btnAddChild',
        'btnDeletePart',
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
                { key: 'parts', label: 'Parts', current: 8, baseline: 6, delta: 2 },
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
        assert.equal(rows[0].children[0].textContent, 'Parts');
        assert.equal(rows[0].children[1].textContent, '8');
        assert.equal(rows[0].children[2].textContent, '6');
        assert.equal(rows[0].children[3].textContent, '+2');
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
            blueprintStatus: 'Blueprint ok',
            selectedLabel: 'Auswahl: Wing',
        });

        assert.equal(document.getElementById('workshopStatusBar').dataset.tone, 'info');
        assert.equal(document.getElementById('workshopStatusMessage').textContent, 'Undo angewendet. | Auswahl: Wing');
        assert.equal(document.getElementById('workshopHistoryState').textContent, 'History 2/3');
        assert.equal(document.getElementById('workshopBlueprintState').textContent, 'Blueprint ok');
    } finally {
        restore();
    }
});

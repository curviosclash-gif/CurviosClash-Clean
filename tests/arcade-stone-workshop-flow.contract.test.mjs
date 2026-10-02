// ============================================
// arcade-stone-workshop-flow.contract.test.mjs - Paket 3, Schritt 2: die echte Werkstatt mit dem
// Steinpanel. Stein wählen, Platz anklicken, Rückgängig; der Pool bleibt bis „Für nächsten Run
// aktivieren“ unverändert; ein Stein aus einem anderen Fahrzeug wandert erst nach der Bestätigung;
// beim Öffnen zeigt der Entwurf die Steine, die fliegen; ein unlesbarer Speicher schreibt nichts.
// Der Fight-Hangar bleibt ohne Steinpanel. Läuft den echten Hangar-Aufbau mit einem schmalen
// Ersatz-DOM (3D fällt still weg), wie arcade-lab-build-choice.contract.
// ============================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

const storedValues = new Map();
globalThis.localStorage = {
    getItem: (key) => (storedValues.has(key) ? storedValues.get(key) : null),
    setItem: (key, value) => storedValues.set(key, String(value)),
    removeItem: (key) => storedValues.delete(key),
};

const toDatasetKey = (name) => name.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());

class FakeElement {
    constructor(tag) {
        this.tagName = String(tag).toUpperCase(); this.children = []; this.parentElement = null;
        this.dataset = {}; this.style = { setProperty() {}, removeProperty() {} }; this.attributes = new Map();
        this.textContent = ''; this.value = ''; this.checked = false; this.disabled = false; this.hidden = false;
        this.listeners = new Map();
        const classes = new Set();
        this._classes = classes;
        this.classList = {
            add: (...names) => names.forEach((name) => classes.add(name)),
            remove: (...names) => names.forEach((name) => classes.delete(name)),
            toggle: (name, force) => { const on = force === undefined ? !classes.has(name) : !!force; if (on) classes.add(name); else classes.delete(name); return on; },
            contains: (name) => classes.has(name),
        };
    }
    get className() { return [...this._classes].join(' '); }
    set className(value) { this._classes.clear(); String(value || '').split(/\s+/).filter(Boolean).forEach((name) => this._classes.add(name)); }
    get options() { return this.children.filter((child) => child.tagName === 'OPTION'); }
    get firstChild() { return this.children[0] || null; }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    getAttribute(key) { return this.attributes.has(key) ? this.attributes.get(key) : null; }
    removeAttribute(key) { this.attributes.delete(key); }
    hasAttribute(key) { return this.attributes.has(key); }
    appendChild(child) {
        if (!child || typeof child !== 'object') return child;
        child.parentElement = this;
        this.children.push(child);
        if (this.tagName === 'SELECT' && child.tagName === 'OPTION' && !this.value) this.value = child.value;
        return child;
    }
    append(...nodes) { nodes.forEach((node) => this.appendChild(typeof node === 'string' ? document.createTextNode(node) : node)); }
    prepend(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
    replaceChildren(...nodes) { this.children = []; if (this.tagName === 'SELECT') this.value = ''; this.append(...nodes); }
    removeChild(child) { this.children = this.children.filter((entry) => entry !== child); return child; }
    remove() { this.parentElement?.removeChild(this); }
    insertBefore(node) { return this.appendChild(node); }
    contains(node) { return node === this || this.children.some((child) => child.contains?.(node)); }
    closest(selector) {
        const match = /^\[data-([a-z-]+)\]$/.exec(String(selector));
        for (let node = this; match && node; node = node.parentElement) {
            if (node.dataset?.[toDatasetKey(match[1])] !== undefined) return node;
        }
        return null;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) {
        const match = /^\[data-([a-z-]+)\]$/.exec(String(selector));
        const found = [];
        const walk = (node) => node.children.forEach((child) => {
            if (match && child.dataset?.[toDatasetKey(match[1])] !== undefined) found.push(child);
            if (child.children) walk(child);
        });
        walk(this);
        return found;
    }
    addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(listener); }
    removeEventListener() {}
    dispatchEvent(event) { (this.listeners.get(event.type) || []).forEach((listener) => listener(event)); return true; }
    focus() {} blur() {} click() {} scrollIntoView() {} setPointerCapture() {} releasePointerCapture() {}
    getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
    getContext() { return null; }
}

globalThis.document = {
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_namespace, tag) => new FakeElement(tag),
    createTextNode: (text) => Object.assign(new FakeElement('#text'), { textContent: String(text) }),
    body: new FakeElement('body'),
    addEventListener() {},
    removeEventListener() {},
};
globalThis.window = { setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1 };

const { setupArcadeHangarWorkshop } = await import('../src/ui/hangar/ArcadeHangarWorkshop.js');
const {
    ARCADE_STONE_WORKSHOP_STORAGE_KEY, createArcadeStoneWorkshopRecord,
} = await import('../src/shared/contracts/ArcadeStoneWorkshopContract.js');
const {
    ARCADE_VEHICLE_PROFILE_STORAGE_KEY, createArcadeVehicleProfileRecord,
} = await import('../src/shared/contracts/ArcadeVehicleProfileContract.js');
const { getArcadeRunVehicleBonuses } = await import('../src/state/arcade/ArcadeVehicleProfile.js');
const { HANGAR_BUILD_STORAGE_KEYS } = await import('../src/shared/contracts/HangarModeContract.js');

const flush = async () => {
    for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

function findByClass(root, className) {
    if (root.classList?.contains(className)) return root;
    for (const child of root.children || []) {
        const found = findByClass(child, className);
        if (found) return found;
    }
    return null;
}

function openHangar({ mode = 'arcade', pool = null, readStatus = '', profile = {}, builds = null } = {}) {
    const records = new Map([[ARCADE_VEHICLE_PROFILE_STORAGE_KEY, {
        ship5: { ...createArcadeVehicleProfileRecord('ship5', 0), level: 5, xpBank: 1000, ...profile },
    }]]);
    if (pool) records.set(ARCADE_STONE_WORKSHOP_STORAGE_KEY, structuredClone(pool));
    if (builds) records.set(HANGAR_BUILD_STORAGE_KEYS.arcade, structuredClone(builds));
    const writes = [];
    const store = {
        loadJsonRecord: (key, fallback) => (records.has(key) ? structuredClone(records.get(key)) : fallback),
        saveJsonRecord(key, value) { writes.push(key); records.set(key, structuredClone(value)); return { success: true }; },
        readJsonRecordResult(key) {
            if (readStatus) return { status: readStatus, value: null };
            return records.has(key) ? { status: 'found', value: structuredClone(records.get(key)) } : { status: 'missing', value: null };
        },
    };
    const settings = { vehicles: { PLAYER_1: 'ship5', PLAYER_2: 'ship5' }, localSettings: { modePath: mode === 'fight' ? 'fight' : 'arcade' } };
    const binds = [];
    const originalError = console.error;
    console.error = () => {}; // THREE reports the missing WebGL context; the hangar falls back without 3D.
    let workshop;
    try {
        workshop = setupArcadeHangarWorkshop({
            ui: {}, settings, mode,
            runtimeAccess: { getSettingsStore: () => store, loadSettings: () => null, saveSettings() {} },
            bind: (node, type, listener) => { binds.push({ node, type, listener }); node?.addEventListener?.(type, listener); },
        });
    } finally {
        console.error = originalError;
    }
    // Fires the bound listeners of the nearest node above the target, like a bubbling DOM event.
    const fire = (target, type) => {
        for (let node = target; node; node = node.parentElement) {
            const hits = binds.filter((entry) => entry.node === node && entry.type === type);
            if (hits.length) { hits.forEach((entry) => entry.listener({ type, target, preventDefault() {} })); return; }
        }
        throw new Error(`no ${type} listener above ${target?.tagName}`);
    };
    const container = workshop.container;
    const byData = (key, value) => container.querySelectorAll(`[data-${key}]`).find((node) => node.dataset[toDatasetKey(key)] === value);
    const storedPool = () => records.get(ARCADE_STONE_WORKSHOP_STORAGE_KEY);
    return { workshop, container, fire, byData, store, writes, storedPool, records };
}

test('Arcade-Werkstatt: der Reiter „Ausbau“ öffnet zuerst und trägt Steinplätze, Verlauf und Vorrat', async () => {
    const hangar = openHangar();
    await flush();
    const upgradePanel = hangar.byData('build-view-panel', 'upgrade');
    assert.equal(upgradePanel.classList.contains('hidden'), false, '„Ausbau“ ist offen');
    assert.equal(hangar.byData('build-view-panel', 'workshop').classList.contains('hidden'), true);
    assert.equal(hangar.byData('build-view', 'workshop').classList.contains('hidden'), true, 'kein leerer Reiter „Umbau“');
    const stonePanel = findByClass(upgradePanel, 'hangar-stone-panel');
    assert.ok(stonePanel, 'Steinpanel im Reiter „Ausbau“');
    assert.ok(findByClass(stonePanel, 'hangar-slot-grid'), 'Steinplätze im Steinpanel');
    assert.ok(findByClass(stonePanel, 'hangar-undo'), 'Rückgängig im Steinpanel');
    assert.equal(stonePanel.querySelectorAll('[data-stone-id]').length, 3, 'drei Gratis-Steine');
    hangar.workshop.dispose();
});

test('Arcade-Werkstatt: Stein wählen, Platz anklicken, Rückgängig und Wiederholen; der Pool bleibt unberührt', async () => {
    const hangar = openHangar();
    await flush();
    hangar.fire(hangar.byData('stone-select', 'stone-0001'), 'click');
    assert.equal(hangar.byData('stone-select', 'stone-0001').getAttribute('aria-pressed'), 'true');
    hangar.fire(hangar.byData('select-slot', 'core'), 'click');
    assert.equal(hangar.workshop.getDraftBuild().stoneSlots.core, 'stone-0001');
    assert.equal(hangar.byData('installed-slot', 'core').textContent, 'Stein 1 · T1');
    assert.equal(hangar.workshop.hasUnsavedChanges(), true);
    assert.equal(hangar.writes.includes(ARCADE_STONE_WORKSHOP_STORAGE_KEY), false, 'Umstecken schreibt nicht in den Pool');

    hangar.fire(findByClass(hangar.container, 'hangar-undo'), 'click');
    assert.equal(hangar.workshop.getDraftBuild().stoneSlots.core, null, 'Rückgängig nimmt den Stein heraus');
    hangar.fire(findByClass(hangar.container, 'hangar-redo'), 'click');
    assert.equal(hangar.workshop.getDraftBuild().stoneSlots.core, 'stone-0001');
    hangar.fire(hangar.byData('remove-slot', 'core'), 'click');
    assert.equal(hangar.workshop.getDraftBuild().stoneSlots.core, null, 'Entfernen ist kostenlos');
    hangar.workshop.dispose();
});

test('Arcade-Werkstatt: erst „Aktivieren“ schreibt die Steine in den Pool, und nur der Pool erreicht den Run', async () => {
    const hangar = openHangar();
    await flush();
    const runSteps = () => getArcadeRunVehicleBonuses(hangar.records.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).ship5, hangar.store).build.stoneSteps;
    hangar.fire(hangar.byData('stone-select', 'stone-0002'), 'click');
    hangar.fire(hangar.byData('select-slot', 'nose'), 'click');
    assert.equal(runSteps().nose, 0, 'ein nicht aktivierter Entwurf erreicht den Run nie');
    hangar.fire(findByClass(hangar.container, 'hangar-activate-build'), 'click');
    await flush();
    const nose = hangar.storedPool().stones.find((entry) => entry.stoneId === 'stone-0002');
    assert.deepEqual(nose.placement, { vehicleId: 'ship5', slotId: 'nose' });
    assert.equal(runSteps().nose, 1, 'nach dem Aktivieren wirkt der Nasen-Stein im Run');
    assert.equal(hangar.workshop.getActiveBuild().stoneSlots.nose, 'stone-0002');
    assert.equal(findByClass(hangar.container, 'hangar-status-message').textContent, 'Build gespeichert und für den nächsten Run aktiviert.');
    assert.equal(findByClass(hangar.container, 'hangar-stone-status').classList.contains('hidden'), true, 'Entwurf = aktiver Build');
    hangar.workshop.dispose();
});

test('Arcade-Werkstatt: ein Stein aus einem anderen Fahrzeug wandert erst nach der Bestätigung', async () => {
    const pool = createArcadeStoneWorkshopRecord(0);
    pool.stones[0].placement = { vehicleId: 'manta', slotId: 'core' };
    const hangar = openHangar({ pool });
    await flush();
    hangar.fire(hangar.byData('stone-select', 'stone-0001'), 'click');
    hangar.fire(hangar.byData('select-slot', 'core'), 'click');
    assert.equal(hangar.byData('hangar-slot-row', 'core').classList.contains('is-foreign'), true);
    hangar.fire(findByClass(hangar.container, 'hangar-activate-build'), 'click');
    await flush();
    const dialog = findByClass(findByClass(hangar.container, 'hangar-activation-dock'), 'hangar-stone-transfer-confirm');
    assert.equal(dialog.classList.contains('hidden'), false, 'Bestätigung sichtbar');
    const lines = findByClass(dialog, 'hangar-stone-transfer-confirm-lines').children.map((line) => line.textContent);
    assert.ok(lines.includes('Stein 1 wird aus Manta-Gleiter · Rumpf entfernt'), lines.join(' | '));
    assert.deepEqual(hangar.storedPool().stones[0].placement, { vehicleId: 'manta', slotId: 'core' }, 'vor der Bestätigung unverändert');

    hangar.fire(findByClass(dialog, 'hangar-stone-transfer-confirm-accept'), 'click');
    await flush();
    assert.deepEqual(hangar.storedPool().stones[0].placement, { vehicleId: 'ship5', slotId: 'core' });
    assert.equal(dialog.classList.contains('hidden'), true);
    hangar.workshop.dispose();
});

test('Arcade-Werkstatt: beim Öffnen zeigt der Entwurf die Steine, die im Pool für das Fahrzeug stecken', async () => {
    const pool = createArcadeStoneWorkshopRecord(0);
    pool.stones[1].placement = { vehicleId: 'ship5', slotId: 'nose' };
    const hangar = openHangar({ pool });
    await flush();
    assert.equal(hangar.workshop.getDraftBuild().stoneSlots.nose, 'stone-0002');
    assert.equal(hangar.workshop.hasUnsavedChanges(), false);
    assert.equal(hangar.byData('hangar-slot-row', 'nose').classList.contains('is-foreign'), false);
    hangar.workshop.dispose();
});

test('Arcade-Werkstatt: Umbenennen des aktiven Presets lässt den Entwurf bei den Steinen, die fliegen', async () => {
    // Das aktive Preset wünscht Stein 1 im Rumpf; der Stein wurde inzwischen in die Manta umgesteckt.
    const pool = createArcadeStoneWorkshopRecord(0);
    pool.stones[0].placement = { vehicleId: 'manta', slotId: 'core' };
    const preset = {
        buildId: 'rumpf-ship5', mode: 'arcade', vehicleId: 'ship5', name: 'Rumpf', createdAtMs: 1, updatedAtMs: 1,
        stoneSlots: { core: 'stone-0001' },
    };
    const hangar = openHangar({
        pool,
        builds: { schemaVersion: 'hangar-build-store.v2', mode: 'arcade', builds: [preset], activeBuildByVehicle: { ship5: 'rumpf-ship5' } },
    });
    await flush();
    assert.equal(hangar.workshop.getDraftBuild().stoneSlots.core, null, 'beim Öffnen: der Rumpf ist leer, wie im Pool');
    assert.equal(hangar.workshop.hasUnsavedChanges(), false);

    findByClass(hangar.container, 'arcade-vehicle-preset-select').value = 'rumpf-ship5';
    findByClass(hangar.container, 'arcade-vehicle-preset-input').value = 'Rumpf neu';
    hangar.fire(findByClass(hangar.container, 'hangar-preset-rename'), 'click');
    await flush();
    assert.equal(hangar.workshop.getActiveBuild().name, 'Rumpf neu');
    assert.equal(hangar.workshop.getDraftBuild().stoneSlots.core, null, 'Umbenennen ändert nur den Namen, nicht die Steine');
    assert.equal(hangar.byData('hangar-slot-row', 'core').classList.contains('is-foreign'), false);
    assert.equal(hangar.workshop.hasUnsavedChanges(), false);
    hangar.workshop.dispose();
});

test('Arcade-Werkstatt: ein unlesbarer Steinspeicher lässt Aktivieren scheitern, ohne etwas zu schreiben', async () => {
    const hangar = openHangar({ readStatus: 'read_failed' });
    await flush();
    const writesBefore = hangar.writes.length;
    hangar.fire(findByClass(hangar.container, 'hangar-activate-build'), 'click');
    await flush();
    assert.equal(hangar.writes.length, writesBefore, 'weder Pool noch Build geschrieben');
    assert.match(findByClass(hangar.container, 'hangar-status-message').textContent, /Steinspeicher nicht lesbar/);
    hangar.workshop.dispose();
});

test('Fight-Hangar unverändert: kein Steinpanel, Fassungen im Reiter „Umbau“, kein stoneSlots im Entwurf', async () => {
    const hangar = openHangar({ mode: 'fight' });
    await flush();
    assert.equal(findByClass(hangar.container, 'hangar-stone-panel'), null);
    const workshopPanel = hangar.byData('build-view-panel', 'workshop');
    assert.ok(findByClass(workshopPanel, 'hangar-slot-grid'), 'Fassungen im Reiter „Umbau“');
    assert.equal(workshopPanel.classList.contains('hidden'), false);
    assert.equal('stoneSlots' in hangar.workshop.getDraftBuild(), false);
    assert.equal(hangar.byData('hangar-slot-row', 'core').querySelectorAll('[data-quick-upgrade]').length, 1, 'Stufe + bleibt');
    hangar.workshop.dispose();
});

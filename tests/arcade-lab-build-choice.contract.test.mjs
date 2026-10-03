// ============================================
// arcade-lab-build-choice.contract.test.mjs - Paket 1 (Korrektur): Arcade bietet nur die
// Werksschiffe an, ohne die gemeinsame P1-Wahl anzutasten. Ein in Classic gewählter
// Lab-Bau bleibt gespeichert, bis der Spieler in Arcade selbst ein Schiff wählt; Hangar,
// Schnellzeilen und Start-Setup-Wähler zeigen ihn in Arcade nicht. Fight bleibt unverändert.
// Läuft den echten Hangar-Aufbau mit einem schmalen Ersatz-DOM (3D fällt still weg).
// ============================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    saveVehicleLabCatalog,
    upsertVehicleLabCatalogVehicle,
} from '../src/shared/contracts/VehicleLabConfigContract.js';

// A Vehicle Lab build lives in localStorage; the registry reads it on import.
const storedValues = new Map();
globalThis.localStorage = {
    getItem: (key) => (storedValues.has(key) ? storedValues.get(key) : null),
    setItem: (key, value) => storedValues.set(key, String(value)),
    removeItem: (key) => storedValues.delete(key),
};
const labBuild = upsertVehicleLabCatalogVehicle(null, { label: 'Mein Flieger', parts: [{ name: 'Rumpf', geo: 'box', role: 'core' }] });
saveVehicleLabCatalog(labBuild.record);
const LAB_ID = labBuild.vehicle.id;

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

const { ARCADE_FACTORY_VEHICLE_IDS } = await import('../src/shared/contracts/ArcadeVehicleBalanceContract.js');
const { ARCADE_VEHICLE_PROFILE_STORAGE_KEY } = await import('../src/shared/contracts/ArcadeVehicleProfileContract.js');
const { ARCADE_STONE_WORKSHOP_STORAGE_KEY, createArcadeStoneWorkshopRecord } = await import('../src/shared/contracts/ArcadeStoneWorkshopContract.js');
const { HANGAR_BUILD_STORAGE_KEYS } = await import('../src/shared/contracts/HangarModeContract.js');
const { createArcadeVehicleProfileWorkshopPort } = await import('../src/state/arcade/ArcadeVehicleProfileWorkshopPort.js');
const { setupArcadeHangarWorkshop } = await import('../src/ui/hangar/ArcadeHangarWorkshop.js');
const { syncStartSetupSelectionState } = await import('../src/ui/start-setup/StartSetupSelectionSync.js');
const { listVehiclePreviewEntries, resolveVehiclePreview } = await import('../src/ui/menu/MenuPreviewCatalog.js');
const { renderStartSetupSummaryAndPreview } = await import('../src/ui/start-setup/StartSetupMultiplayerUiSync.js');
const { createRuntimeConfigSnapshot } = await import('../src/core/RuntimeConfig.js');
const { SettingsManager } = await import('../src/core/SettingsManager.js');
const { createMemoryStoragePlatform } = await import('./helpers/settings-manager-contract-test-utils.mjs');

function openHangar({ mode, playerOne = LAB_ID, recentVehicles = [LAB_ID, 'manta'], favoriteVehicles = [LAB_ID], ui = {}, profilePort = null, failBuildSaveOnCall = 0, failStonePoolSaveOnCall = 0, initialStonePool = null }) {
    const settings = {
        vehicles: { PLAYER_1: playerOne, PLAYER_2: 'ship5' },
        localSettings: { modePath: mode === 'fight' ? 'fight' : 'arcade', startSetup: { recentVehicles: [...recentVehicles], favoriteVehicles: [...favoriteVehicles] } },
    };
    const records = new Map();
    if (initialStonePool) records.set(ARCADE_STONE_WORKSHOP_STORAGE_KEY, structuredClone(initialStonePool));
    let buildSaveCalls = 0;
    let stonePoolSaveCalls = 0;
    const store = {
        loadJsonRecord: (key, fallback) => (records.has(key) ? records.get(key) : fallback),
        readJsonRecordResult: (key) => records.has(key)
            ? { status: 'found', value: records.get(key) }
            : { status: 'missing' },
        saveJsonRecord(key, value) {
            if (key === HANGAR_BUILD_STORAGE_KEYS[mode]) {
                buildSaveCalls += 1;
                if (failBuildSaveOnCall === buildSaveCalls) return { success: false, reason: 'quota_exceeded' };
            }
            if (key === ARCADE_STONE_WORKSHOP_STORAGE_KEY) {
                stonePoolSaveCalls += 1;
                if (failStonePoolSaveOnCall === stonePoolSaveCalls) return { success: false, reason: 'quota_exceeded' };
            }
            records.set(key, value);
            return true;
        },
    };
    const saved = [];
    const statusMessages = [];
    const binds = [];
    const originalError = console.error;
    console.error = () => {}; // THREE reports the missing WebGL context; the hangar falls back without 3D.
    let workshop;
    try {
        workshop = setupArcadeHangarWorkshop({
            ui, settings, mode,
            runtimeAccess: {
                getSettingsStore: () => store,
                loadSettings: () => null,
                saveSettings: (next) => saved.push(next.vehicles.PLAYER_1),
                arcadeVehicleProfileWorkshop: profilePort,
            },
            eventTypes: { SHOW_STATUS_TOAST: 'status-toast' },
            emit: (_type, payload) => statusMessages.push(payload),
            bind: (node, type, listener) => { binds.push({ node, type, listener }); node?.addEventListener?.(type, listener); },
        });
    } finally {
        console.error = originalError;
    }
    // Fires a bound listener like a bubbling DOM event from the given node.
    const fire = (target, type) => {
        for (let node = target; node; node = node.parentElement) {
            const hits = binds.filter((entry) => entry.node === node && entry.type === type);
            if (hits.length) { hits.forEach((entry) => entry.listener({ type, target, preventDefault() {} })); return; }
        }
        throw new Error(`no ${type} listener above ${target?.tagName}`);
    };
    const quickIds = () => workshop.container.querySelectorAll('[data-quick-vehicle-id]').map((node) => node.dataset.quickVehicleId);
    const card = (vehicleId) => workshop.container.querySelectorAll('[data-vehicle-id]').find((node) => node.dataset.vehicleId === vehicleId);
    return { workshop, settings, saved, statusMessages, records, fire, quickIds, card };
}

function findClass(root, className) {
    if (String(root?.className || '').split(/\s+/).includes(className)) return root;
    for (const child of root?.children || []) {
        const match = findClass(child, className);
        if (match) return match;
    }
    return null;
}

function createFailingProfilePort() {
    const persistence = {
        loadJsonRecord: (_key, fallback) => fallback,
        saveJsonRecord: (key) => key === ARCADE_VEHICLE_PROFILE_STORAGE_KEY
            ? ({ success: false, reason: 'quota_exceeded' })
            : true,
    };
    const basePort = createArcadeVehicleProfileWorkshopPort(persistence);
    let lastProfileMap = null;
    return {
        port: Object.freeze({
            ...basePort,
            save(profiles) {
                lastProfileMap = profiles;
                return basePort.save(profiles);
            },
        }),
        getLastProfileMap: () => lastProfileMap,
    };
}

function createSuccessfulProfilePort() {
    const records = new Map();
    const persistence = {
        loadJsonRecord: (key, fallback) => (records.has(key) ? records.get(key) : fallback),
        saveJsonRecord(key, value) { records.set(key, structuredClone(value)); return true; },
    };
    return {
        port: createArcadeVehicleProfileWorkshopPort(persistence),
        getRecord: (key) => records.get(key),
    };
}

test('Arcade-Hangar öffnen lässt die gespeicherte Lab-Wahl stehen; erst eine echte Wahl schreibt zurück', () => {
    const hangar = openHangar({ mode: 'arcade' });
    assert.equal(hangar.workshop.getSelectedVehicleId(), 'ship5', 'der Entwurf zeigt das Rückfall-Werksschiff');
    assert.equal(hangar.settings.vehicles.PLAYER_1, LAB_ID, 'Classic behält den Lab-Bau');
    assert.deepEqual(hangar.saved, [], 'beim Öffnen wird nichts gespeichert');

    hangar.fire(hangar.card('manta'), 'click');
    assert.equal(hangar.workshop.getSelectedVehicleId(), 'manta');
    assert.equal(hangar.settings.vehicles.PLAYER_1, 'manta', 'eine echte Wahl im Hangar schreibt zurück');
    assert.deepEqual(hangar.saved, ['manta']);
    hangar.workshop.dispose();
});

test('Arcade-Hangar öffnen mit einem Werksschiff schreibt es wie bisher zurück', () => {
    const hangar = openHangar({ mode: 'arcade', playerOne: 'drone' });
    assert.equal(hangar.workshop.getSelectedVehicleId(), 'drone');
    assert.deepEqual(hangar.saved, ['drone']);
    hangar.workshop.dispose();
});

test('a stone-pool save failure blocks run start and leaves the active-build pointer unchanged', async () => {
    const previousPool = createArcadeStoneWorkshopRecord(1000);
    const hangar = openHangar({ mode: 'arcade', initialStonePool: previousPool, failStonePoolSaveOnCall: 1 });

    const result = await hangar.workshop.prepareRunStart();

    assert.equal(result.ok, false);
    assert.equal(result.code, 'stone_activation_failed');
    assert.equal(hangar.workshop.getActiveBuild(), null);
    assert.deepEqual(hangar.records.get(ARCADE_STONE_WORKSHOP_STORAGE_KEY), previousPool);
    assert.equal(hangar.records.get(HANGAR_BUILD_STORAGE_KEYS.arcade).activeBuildByVehicle.ship5, undefined);
    assert.deepEqual(hangar.saved, [], 'a failed pool commit blocks vehicle-selection writeback');
    assert.ok(hangar.statusMessages.some(({ tone, message }) => tone === 'error' && /Steinpool konnte nicht aktiviert werden/.test(message)));
    hangar.workshop.dispose();
});

test('a draft-build save failure writes no active pointer or stone pool', async () => {
    const previousPool = createArcadeStoneWorkshopRecord(1000);
    const hangar = openHangar({ mode: 'arcade', initialStonePool: previousPool, failBuildSaveOnCall: 1 });

    const result = await hangar.workshop.prepareRunStart();

    assert.equal(result.ok, false);
    assert.equal(result.code, 'build_save_failed');
    assert.equal(hangar.workshop.getActiveBuild(), null);
    assert.equal(hangar.records.has(HANGAR_BUILD_STORAGE_KEYS.arcade), false);
    assert.deepEqual(hangar.records.get(ARCADE_STONE_WORKSHOP_STORAGE_KEY), previousPool);
    assert.deepEqual(hangar.saved, []);
    hangar.workshop.dispose();
});

test('an active-build save failure restores the previous stone pool', async () => {
    const previousPool = createArcadeStoneWorkshopRecord(1000);
    const hangar = openHangar({ mode: 'arcade', initialStonePool: previousPool, failBuildSaveOnCall: 2 });

    const result = await hangar.workshop.prepareRunStart();

    assert.equal(result.ok, false);
    assert.equal(result.code, 'build_activation_failed');
    assert.equal(result.poolRestored, true);
    assert.deepEqual(hangar.records.get(ARCADE_STONE_WORKSHOP_STORAGE_KEY), previousPool);
    assert.equal(hangar.records.get(HANGAR_BUILD_STORAGE_KEYS.arcade).activeBuildByVehicle.ship5, undefined);
    assert.equal(hangar.workshop.getActiveBuild(), null);
    assert.deepEqual(hangar.saved, []);
    assert.ok(hangar.statusMessages.some(({ tone, message }) => tone === 'error' && /Steinpool wurde zurückgesetzt/.test(message)));
    hangar.workshop.dispose();
});

test('a failed stone-pool rollback reports the persisted partial state', async () => {
    const previousPool = createArcadeStoneWorkshopRecord(1000);
    const hangar = openHangar({
        mode: 'arcade',
        initialStonePool: previousPool,
        failBuildSaveOnCall: 2,
        failStonePoolSaveOnCall: 2,
    });

    const result = await hangar.workshop.prepareRunStart();

    assert.equal(result.ok, false);
    assert.equal(result.code, 'build_activation_failed_pool_rollback_failed');
    assert.equal(result.poolRestored, false);
    assert.notDeepEqual(hangar.records.get(ARCADE_STONE_WORKSHOP_STORAGE_KEY), previousPool,
        'the failed compensation leaves the committed pool visible for diagnosis');
    assert.equal(hangar.records.get(HANGAR_BUILD_STORAGE_KEYS.arcade).activeBuildByVehicle.ship5, undefined);
    assert.equal(hangar.workshop.getActiveBuild(), null);
    assert.deepEqual(hangar.saved, []);
    assert.ok(hangar.statusMessages.some(({ tone, message }) => tone === 'error' && /Steinpool ließ sich nicht zurücksetzen/.test(message)));
    hangar.workshop.dispose();
});

test('a later cosmetic profile save preserves the independently persisted stone pool', async () => {
    const previousPool = createArcadeStoneWorkshopRecord(1000);
    const profileStore = createSuccessfulProfilePort();
    const hangar = openHangar({ mode: 'arcade', initialStonePool: previousPool, profilePort: profileStore.port });

    const startResult = await hangar.workshop.prepareRunStart();
    assert.equal(startResult.ok, true);
    const poolAfterRunStart = structuredClone(hangar.records.get(ARCADE_STONE_WORKSHOP_STORAGE_KEY));

    const trailStyle = findClass(hangar.workshop.container, 'hangar-cosmetic-select');
    assert.ok(trailStyle);
    trailStyle.value = 'standard';
    hangar.fire(trailStyle, 'change');

    assert.ok(profileStore.getRecord(ARCADE_VEHICLE_PROFILE_STORAGE_KEY), 'cosmetic state uses the profile port');
    assert.deepEqual(hangar.records.get(ARCADE_STONE_WORKSHOP_STORAGE_KEY), poolAfterRunStart,
        'saving a profile cosmetic never rewrites the separate stone pool');
    hangar.workshop.dispose();
});
test('a cosmetic profile save failure reports an error instead of a saved success', () => {
    const failingPort = createFailingProfilePort();
    const hangar = openHangar({ mode: 'arcade', profilePort: failingPort.port });
    const trailStyle = findClass(hangar.workshop.container, 'hangar-cosmetic-select');
    assert.ok(trailStyle);

    trailStyle.value = 'standard';
    hangar.fire(trailStyle, 'change');

    assert.ok(failingPort.getLastProfileMap()?.ship5, 'cosmetic edits stay in the current in-memory profile');
    assert.ok(hangar.statusMessages.some(({ tone, message }) => tone === 'error' && /Profil konnte nicht gespeichert/.test(message)));
    assert.ok(!hangar.statusMessages.some(({ tone, message }) => tone === 'success' && /Spurstil gespeichert/.test(message)));
    hangar.workshop.dispose();
});

test('Arcade-Hangar: Favoriten und Zuletzt zeigen nur Werksschiffe; eine Lab-ID von außen wird abgewiesen', () => {
    const select = document.createElement('select');
    for (const vehicleId of ['ship5', 'manta', LAB_ID]) select.appendChild(Object.assign(document.createElement('option'), { value: vehicleId }));
    const hangar = openHangar({ mode: 'arcade', ui: { vehicleSelectP1: select } });
    assert.deepEqual(hangar.quickIds(), ['manta'], 'nur die Werksschiffe aus Zuletzt, der Lab-Favorit fällt weg');

    select.value = LAB_ID;
    select.dispatchEvent({ type: 'change' });
    assert.equal(hangar.workshop.getSelectedVehicleId(), 'ship5', 'der Lab-Bau wird kein Arcade-Entwurf');
    assert.equal(hangar.settings.vehicles.PLAYER_1, LAB_ID, 'und nicht als Arcade-Wahl gespeichert');
    assert.deepEqual(hangar.saved, []);
    hangar.workshop.dispose();
});

test('Fight-Hangar unverändert: Lab-Bau bleibt Entwurf, Wahl und Schnellzeile', () => {
    const hangar = openHangar({ mode: 'fight' });
    assert.equal(hangar.workshop.getSelectedVehicleId(), LAB_ID);
    assert.equal(hangar.settings.vehicles.PLAYER_1, LAB_ID);
    assert.deepEqual(hangar.quickIds(), [LAB_ID, LAB_ID, 'manta'], 'Favoriten und Zuletzt samt Lab-Bau');
    hangar.workshop.dispose();
});

function syncStartSetup(modePath, settings) {
    const ui = {
        mapSelect: document.createElement('select'),
        vehicleSelectP1: document.createElement('select'),
        vehicleSelectP2: document.createElement('select'),
        vehicleSelectP3: document.createElement('select'),
        vehicleFavoritesList: document.createElement('div'),
        vehicleRecentList: document.createElement('div'),
    };
    syncStartSetupSelectionState({
        ui, settings, startSetup: settings.localSettings.startSetup,
        runtimeMaps: { standard: { name: 'Standard', size: [80, 30, 80] } },
        surfaceMenuState: { mapKey: 'standard' },
        mapPreviewEntries: [{ key: 'standard', name: 'Standard', category: 'medium' }],
        vehiclePreviewEntries: listVehiclePreviewEntries(),
        modePath, hangarSelectionModePath: modePath,
        surfacePolicyPort: { isMapAllowed: () => true },
        formatMapLabel: (entry) => entry.name,
        resolveSurfaceFallbackMapKey: () => 'standard',
        hasStoredCustomMap: () => false,
        ghostDuelState: {},
    });
    return ui;
}

test('Start-Setup-Wähler: Arcade bietet nur Werksschiffe, Classic behält den Lab-Bau samt Wahl', () => {
    const startSetup = {
        mapSearch: '', mapFilter: 'all', vehicleSearch: '', vehicleFilter: 'all',
        favoriteMaps: [], recentMaps: [], favoriteVehicles: [LAB_ID], recentVehicles: [LAB_ID, 'manta'],
    };
    const settings = { mapKey: 'standard', vehicles: { PLAYER_1: LAB_ID, PLAYER_2: LAB_ID, PLAYER_3: LAB_ID }, localSettings: { modePath: 'arcade', startSetup } };

    const arcade = syncStartSetup('arcade', settings);
    for (const select of [arcade.vehicleSelectP1, arcade.vehicleSelectP2, arcade.vehicleSelectP3]) {
        assert.deepEqual(select.options.map((option) => option.value).sort(), [...ARCADE_FACTORY_VEHICLE_IDS].sort());
        assert.equal(select.value, 'ship5', 'die gespeicherte Lab-Wahl zeigt sich in Arcade als Star-Cruiser');
    }
    assert.deepEqual(arcade.vehicleRecentList.children.map((node) => node.dataset.vehicleId), ['manta']);
    assert.deepEqual(arcade.vehicleFavoritesList.children, []);
    assert.deepEqual(settings.vehicles, { PLAYER_1: LAB_ID, PLAYER_2: LAB_ID, PLAYER_3: LAB_ID }, 'Arcade überschreibt die Classic-Wahl nicht');

    settings.localSettings.modePath = 'normal';
    const classic = syncStartSetup('normal', settings);
    assert.ok(classic.vehicleSelectP1.options.some((option) => option.value === LAB_ID), 'Classic listet den Lab-Bau');
    assert.equal(classic.vehicleSelectP1.value, LAB_ID);
    assert.ok(classic.vehicleSelectP3.options.some((option) => option.value === LAB_ID), 'Classic listet den Lab-Bau für Pilot 3');
    assert.equal(classic.vehicleSelectP3.value, LAB_ID);
    assert.deepEqual(classic.vehicleRecentList.children.map((node) => node.dataset.vehicleId), [LAB_ID, 'manta']);
});

// "Deine Auswahl" and the quick-start line, rendered like the menu does it (splitscreen shows both pilots).
function renderSelectionSummary(settings, modePath) {
    const ui = { menuSummary: document.createElement('div'), quickStartLastSummary: document.createElement('p') };
    renderStartSetupSummaryAndPreview({
        ui, settings, sessionType: 'splitscreen', modePath, effectiveMapKey: 'standard',
        surfaceEntryCopy: { sessionSummaryLabels: {} }, sessionContract: {},
        resolvedMultiplayerSessionState: null, hasActiveLobbySession: false,
        ghostDuelState: { effectiveMode: 'off', duelSelectable: false, effectiveTrailCollisionEnabled: false, trailCollisionSelectable: false },
    });
    const block = (label) => ui.menuSummary.children
        .find((node) => node.children[0]?.textContent === label)?.children[1]?.textContent;
    return { p1: block('Flugzeug'), p2: block('Flugzeug P2'), quickStart: ui.quickStartLastSummary.textContent };
}

test('„Deine Auswahl“ zeigt in Arcade das Schiff, das der Run fliegt; Classic zeigt weiter den Lab-Bau', () => {
    const settings = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() }).createDefaultSettings();
    settings.vehicles = { PLAYER_1: LAB_ID, PLAYER_2: LAB_ID };
    settings.localSettings.modePath = 'arcade';
    settings.localSettings.sessionType = 'splitscreen';
    const flown = createRuntimeConfigSnapshot(settings).player.vehicles;
    const flownLabel = resolveVehiclePreview(flown.PLAYER_1).label;
    assert.equal(flown.PLAYER_1, 'ship5', 'Vorbedingung: der Arcade-Run startet als Star-Cruiser');

    const arcade = renderSelectionSummary(settings, 'arcade');
    assert.equal(arcade.p1, flownLabel, 'Pilot 1 zeigt das geflogene Schiff statt des Lab-Baus');
    assert.equal(arcade.p2, resolveVehiclePreview(flown.PLAYER_2).label, 'Pilot 2 ebenso');
    assert.ok(arcade.quickStart.split(' · ').includes(flownLabel), 'die Schnellstart-Zeile ebenso');
    assert.doesNotMatch(arcade.quickStart, /Mein Flieger/);
    assert.deepEqual(settings.vehicles, { PLAYER_1: LAB_ID, PLAYER_2: LAB_ID }, 'die gemeinsame Wahl bleibt gespeichert');

    settings.vehicles = { PLAYER_1: 'manta', PLAYER_2: 'drone' };
    const factory = renderSelectionSummary(settings, 'arcade');
    assert.deepEqual([factory.p1, factory.p2], [resolveVehiclePreview('manta').label, resolveVehiclePreview('drone').label]);

    settings.vehicles = { PLAYER_1: LAB_ID, PLAYER_2: LAB_ID };
    for (const modePath of ['normal', 'fight']) {
        const shown = renderSelectionSummary(settings, modePath);
        assert.deepEqual([shown.p1, shown.p2], ['Mein Flieger', 'Mein Flieger'], `${modePath} zeigt den Lab-Bau unverändert`);
    }
});

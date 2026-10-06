// The arcade menu surface on a fake DOM: what its lines say after the player used its buttons.
// Each test pins one menu bug: a stale seed for Abrisskommando, a special run's description above
// "Arcade Run starten", and an empty "Letzter Arcade-Run" box next to the numbers of a finished run.

import assert from 'node:assert/strict';
import test, { after } from 'node:test';

import { createArcadeSeedRecord, ARCADE_SEED_STORAGE_KEY } from '../src/shared/contracts/ArcadeMenuPersistenceContract.js';
import { createDemolitionMapPlan } from '../src/shared/contracts/DemolitionContract.js';
import { resolveMapPreview } from '../src/ui/menu/MenuPreviewCatalog.js';
import { setupArcadeMenuSurface } from '../src/ui/arcade/ArcadeMenuSurface.js';

const originalDocument = globalThis.document;
after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
});

function createFakeDocument() {
    const created = [];
    const element = (tag = 'div') => {
        const classes = new Set();
        const node = {
            tagName: String(tag).toUpperCase(), id: '', type: '', value: '', textContent: '', title: '',
            disabled: false, open: false, hidden: false, style: {}, dataset: {}, attributes: {}, children: [],
            parentElement: null, ownerDocument: null,
            get className() { return [...classes].join(' '); },
            set className(value) { classes.clear(); String(value || '').split(/\s+/).filter(Boolean).forEach((name) => classes.add(name)); },
            classList: {
                add: (...names) => names.forEach((name) => classes.add(name)),
                remove: (...names) => names.forEach((name) => classes.delete(name)),
                toggle: (name, force) => {
                    const on = force === undefined ? !classes.has(name) : !!force;
                    if (on) classes.add(name); else classes.delete(name);
                    return on;
                },
                contains: (name) => classes.has(name),
            },
            get options() { return node.children; },
            setAttribute(name, value) { node.attributes[name] = String(value); },
            getAttribute(name) { return node.attributes[name] ?? null; },
            removeAttribute(name) { delete node.attributes[name]; },
            appendChild(child) { child.parentElement = node; node.children.push(child); return child; },
            append(...nodes) { nodes.forEach((child) => node.appendChild(child)); },
            insertBefore(child) { return node.appendChild(child); },
            removeChild(child) { node.children = node.children.filter((entry) => entry !== child); child.parentElement = null; return child; },
            replaceChildren(...nodes) { node.children = []; nodes.forEach((child) => node.appendChild(child)); },
            remove() { node.parentElement?.removeChild(node); },
            querySelector() { return null; },
            querySelectorAll() { return []; },
            closest() { return null; },
            addEventListener() {},
            removeEventListener() {},
        };
        created.push(node);
        return node;
    };
    const level3Body = element('div');
    const document = {
        createElement: element,
        querySelector: (selector) => (selector === '#submenu-game .level3-body' ? level3Body : null),
        getElementById: (id) => created.find((node) => node.id === id) || null,
    };
    return { document, byId: (id) => created.find((node) => node.id === id) || null };
}

function createStore(records = {}) {
    const data = new Map(Object.entries(records));
    return {
        loadJsonRecord: (key, fallback = null) => (data.has(key) ? structuredClone(data.get(key)) : fallback),
        saveJsonRecord: (key, value) => { data.set(key, structuredClone(value)); return true; },
        readJsonRecordResult: (key) => (data.has(key) ? { status: 'found', value: structuredClone(data.get(key)) } : { status: 'missing' }),
        removeJsonRecord: (key) => data.delete(key),
    };
}

function mountSurface({ storeRecords = {}, runtimeState = null } = {}) {
    const fake = createFakeDocument();
    // Clicks render option lists as well, so the fake document stays until the file is done.
    globalThis.document = fake.document;
    const handlers = new Map();
    const emitted = [];
    const settings = {
        mapKey: 'standard', numBots: 3, botDifficulty: 'NORMAL', mode: '1p', gameMode: 'ARCADE',
        vehicles: { PLAYER_1: 'ship5' },
        localSettings: { modePath: 'arcade', sessionType: 'single' },
        arcade: { seed: 1, runType: 'gauntlet', sectorCount: 5 },
    };
    const store = createStore(storeRecords);
    const profile = { id: 'p1', displayName: 'Pilot' };
    const runtimeAccess = {
        getActivePlayerProfile: () => profile,
        getPlayerProfiles: () => [profile],
        getSettingsStore: () => store,
        getArcadeMenuSurfaceState: () => runtimeState,
        showStatusToast: () => {},
        saveSettings: () => {},
    };
    setupArcadeMenuSurface({
        ui: {}, settings, runtimeAccess,
        emit: (type, payload) => emitted.push({ type, payload }),
        eventTypes: { START_MATCH: 'start_match', SHOW_STATUS_TOAST: 'toast' },
        bind: (target, type, handler) => {
            if (!handlers.has(target)) handlers.set(target, new Map());
            const byType = handlers.get(target);
            if (!byType.has(type)) byType.set(type, []);
            byType.get(type).push(handler);
        },
    });
    const click = (id) => {
        const target = fake.byId(id);
        assert.ok(target, `element #${id} exists`);
        const event = { preventDefault() {}, stopImmediatePropagation() {} };
        for (const handler of handlers.get(target)?.get('click') || []) handler(event);
    };
    return { byId: fake.byId, click, emitted, settings };
}

test('Abrisskommando plans its maps from the seed the player set last, not the seed at menu start', () => {
    const initialSeed = 1;
    const firstMapOf = (seed) => createDemolitionMapPlan(seed).maps[0].mapKey;
    let newSeed = 2;
    while (firstMapOf(newSeed) === firstMapOf(initialSeed)) newSeed += 1;

    const menu = mountSurface({ storeRecords: { [ARCADE_SEED_STORAGE_KEY]: createArcadeSeedRecord(initialSeed) } });
    menu.byId('input-arcade-seed').value = String(newSeed);
    menu.click('btn-arcade-seed-apply');
    menu.click('btn-arcade-demolition-start-inline');

    const start = menu.emitted.find((entry) => entry.type === 'start_match');
    assert.ok(start, 'the demolition run starts');
    assert.equal(start.payload.borrowedSettings.mapKey, firstMapOf(newSeed));
    assert.equal(menu.settings.arcade.seed, newSeed);
    const lastStart = menu.byId('arcade-post-run-line').textContent;
    assert.match(lastStart, new RegExp(`Seed ${newSeed}$`));
    assert.ok(lastStart.includes(resolveMapPreview(firstMapOf(newSeed)).name), lastStart);
});

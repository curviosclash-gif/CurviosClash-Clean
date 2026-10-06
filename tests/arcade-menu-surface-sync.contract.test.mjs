// The arcade menu surface on a fake DOM: what its lines say after the player used its buttons.
// Each test pins one menu bug: a stale seed for Abrisskommando, a special run's description above
// "Arcade Run starten", and an empty "Letzter Arcade-Run" box next to the numbers of a finished run.

import assert from 'node:assert/strict';
import test, { after } from 'node:test';

import { createArcadeSeedRecord, ARCADE_SEED_STORAGE_KEY } from '../src/shared/contracts/ArcadeMenuPersistenceContract.js';
import { createDemolitionMapPlan } from '../src/shared/contracts/DemolitionContract.js';
import { resolveMapPreview } from '../src/ui/menu/MenuPreviewCatalog.js';
import { setupArcadeMenuSurface } from '../src/ui/arcade/ArcadeMenuSurface.js';
import { ARCADE_RANKED_STORAGE_KEY, ARCADE_RANKED_VERSION } from '../src/shared/contracts/ArcadeRankedLeaderboardContract.js';

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

function mountSurface({ storeRecords = {}, runtimeState = null, arcade = {} } = {}) {
    const fake = createFakeDocument();
    // Clicks render option lists as well, so the fake document stays until the file is done.
    globalThis.document = fake.document;
    const handlers = new Map();
    const emitted = [];
    const settings = {
        mapKey: 'standard', numBots: 3, botDifficulty: 'NORMAL', mode: '1p', gameMode: 'ARCADE',
        vehicles: { PLAYER_1: 'ship5' },
        localSettings: { modePath: 'arcade', sessionType: 'single' },
        arcade: { seed: 1, runType: 'gauntlet', sectorCount: 5, ...arcade },
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

test('the line above "Arcade Run starten" keeps describing the standard run after a special run or the Daily', () => {
    for (const buttonId of ['btn-arcade-five-portals-start-inline', 'btn-arcade-demolition-start-inline', 'btn-arcade-daily']) {
        const menu = mountSurface();
        const standardLine = menu.byId('arcade-run-line').textContent;
        assert.match(standardLine, /Sektoren meistern/);
        menu.click(buttonId);
        assert.ok(menu.emitted.some((entry) => entry.type === 'start_match'), `${buttonId} starts a run`);
        // Back in the menu: any refresh (here the leaderboard toggle) re-renders the surface.
        menu.click('btn-arcade-local-leaderboard-toggle');
        assert.equal(menu.byId('arcade-run-line').textContent, standardLine, `after ${buttonId}`);
    }
});

test('the "Letzter Arcade-Run" box does not claim "no run yet" next to the numbers of a finished run', () => {
    const menu = mountSurface({
        runtimeState: {
            runType: 'gauntlet', phase: '',
            records: { runsPlayed: 1, lastScore: 1268, lastSector: 2, lastCombo: 4, lastMultiplier: 1.5, bestScore: 1268, lastRunAt: '2026-10-05T18:30:00.000Z' },
            postRunSummary: null,
        },
    });
    const line = menu.byId('arcade-post-run-line').textContent;
    assert.doesNotMatch(line, /Noch kein Arcade-Run/);
    assert.match(line, /1\.268 Punkte/);

    // Fünf Fronten keeps only a last total (mapped to lastScore), no run counter.
    const arenaMenu = mountSurface({ runtimeState: { runType: 'arena_waves', phase: '', records: { lastScore: 900, bestScore: 900 }, postRunSummary: null } });
    assert.match(arenaMenu.byId('arcade-post-run-line').textContent, /900 Punkte/);
});

test('a profile without any run still says so', () => {
    const menu = mountSurface({
        runtimeState: { runType: 'gauntlet', phase: '', records: { runsPlayed: 0, lastScore: 0, lastSector: 0 }, postRunSummary: null },
    });
    assert.equal(menu.byId('arcade-post-run-line').textContent, 'Noch kein Arcade-Run gestartet.');
});

test('the ranked line says when the chosen settings keep a run off the board', () => {
    const entry = { runId: 'old', vehicleId: 'ship5', vehicleLevel: 1, tierId: 'normal', score: 4321, date: '2026-10-01T10:00:00.000Z' };
    const storeRecords = { [ARCADE_RANKED_STORAGE_KEY]: { schemaVersion: ARCADE_RANKED_VERSION, boards: { 'gauntlet:normal:1-5': [entry] } } };
    const standard = mountSurface({ storeRecords }).byId('arcade-ranked-line').textContent;
    assert.match(standard, /4\.321 Punkte/);
    assert.doesNotMatch(standard, /nicht gewertet/);

    for (const arcade of [{ maxMultiplier: 25 }, { sectorCount: 20 }, { comboDecayPerSecond: 0 }]) {
        const line = mountSurface({ storeRecords, arcade }).byId('arcade-ranked-line').textContent;
        assert.match(line, /nicht gewertet \(eigene Einstellungen\)/, JSON.stringify(arcade));
        assert.match(line, /4\.321 Punkte/, 'the standard board stays visible');
    }
    const helped = mountSurface({ storeRecords, arcade: { companionCount: 1 } }).byId('arcade-ranked-line').textContent;
    assert.match(helped, /nicht gewertet \(mit Mitstreitern\)/);
});

test('the ranked line of a portal chain reads that chain\'s board, Fünf Portale its saved one', () => {
    const entry = { runId: 'old', vehicleId: 'ship5', vehicleLevel: 1, tierId: 'any', score: 61_500, date: '2026-09-01T10:00:00.000Z' };
    const storeRecords = { [ARCADE_RANKED_STORAGE_KEY]: { schemaVersion: ARCADE_RANKED_VERSION, boards: { 'five_portals:any:1-5': [entry] } } };
    const five = mountSurface({ storeRecords, arcade: { runType: 'five_portals', portalChainId: 'five_portals' } }).byId('arcade-ranked-line').textContent;
    assert.match(five, /61\.50 s/);
    const sky = mountSurface({ storeRecords, arcade: { runType: 'five_portals', portalChainId: 'sky_ladder' } }).byId('arcade-ranked-line').textContent;
    assert.doesNotMatch(sky, /61\.50 s/);
    assert.match(sky, /Noch kein gewerteter Lauf/);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { DemolitionRuntime } from '../src/core/arcade/DemolitionRuntime.js';
import {
    DEMOLITION_MEDAL_RECORD_STORAGE_KEY,
    formatDemolitionBestMedalsLine,
    mergeDemolitionMedalResult,
    normalizeDemolitionMedalRecord,
} from '../src/shared/contracts/DemolitionMedalRecordContract.js';
import {
    PLAYER_PROFILE_RECORD_KINDS,
    resolvePlayerScopedStorageKey,
    resolvePlayerScopedStorageKeyByKind,
} from '../src/shared/contracts/PlayerProfileStorageContract.js';

const KEY = DEMOLITION_MEDAL_RECORD_STORAGE_KEY;

function createStore(initial = {}, { readStatus = '' } = {}) {
    const data = new Map(Object.entries(initial));
    const saves = [];
    return {
        data,
        saves,
        readJsonRecordResult(key) {
            if (readStatus) return { ok: false, status: readStatus, reason: 'broken' };
            return data.has(key) ? { ok: true, status: 'found', value: structuredClone(data.get(key)) } : { ok: true, status: 'missing' };
        },
        loadJsonRecord(key, fallback) { return data.has(key) ? structuredClone(data.get(key)) : fallback; },
        saveJsonRecord(key, value) { if (key === KEY) saves.push(key); data.set(key, structuredClone(value)); return { success: true }; },
    };
}

function createEntityManager(humans, state) {
    return {
        players: humans,
        humanPlayers: humans,
        _mapDestructibleSystem: {
            getState: () => state,
            getHudState: () => ({ focusSegment: null }),
            getDefinition: () => ({ segments: [] }),
        },
    };
}

function sealedState() {
    return { sealed: true, segments: [{ id: 'target', maxHp: 500, hp: 0, destroyed: true }], events: [{ segmentId: 'target' }] };
}

/** Plays all three maps; every map is sealed right away, or times out with partial damage when weak. */
function playRun(runtime, { humans, profileIds, weak = false }) {
    for (let mapIndex = 0; mapIndex < 3; mapIndex += 1) {
        const state = weak
            ? { sealed: false, segments: [{ id: 'target', maxHp: 100, hp: 90, destroyed: false }], events: [] }
            : sealedState();
        runtime.start({ entityManager: createEntityManager(humans, state), seed: 4711, vehicleId: 'ship1', profileIds });
        runtime.update(weak ? 10_000 : 1);
    }
    assert.equal(runtime.phase, 'finished');
    return runtime.mapStats;
}

test('the medal record key is versioned and scoped per player profile', () => {
    assert.equal(KEY, 'cuviosclash.arcade-demolition-medals.v1');
    assert.equal(resolvePlayerScopedStorageKey('p1', KEY), 'cuviosclash.player.p1.arcade-demolition-medals.v1');
    assert.equal(resolvePlayerScopedStorageKeyByKind('p1', PLAYER_PROFILE_RECORD_KINDS.ARCADE_DEMOLITION_MEDALS),
        'cuviosclash.player.p1.arcade-demolition-medals.v1');
});

test('broken or foreign medal data normalizes to an empty record without throwing', () => {
    for (const value of [null, undefined, 'x', 42, [], {}, { version: 2, maps: { reactor_site: { medal: 'gold' } } }, { version: 1, maps: [] }, { version: 1, maps: 'x' }]) {
        assert.deepEqual(normalizeDemolitionMedalRecord(value), { version: 1, maps: {} });
    }
    assert.deepEqual(normalizeDemolitionMedalRecord({
        version: 1,
        maps: {
            reactor_site: { medal: 'platinum', bestScore: -5 },
            skyline_siege: { medal: 'silver', bestScore: '812.7' },
            'Bad Key!': { medal: 'gold', bestScore: 1 },
            eiffel_tower_siege: null,
        },
    }), { version: 1, maps: { reactor_site: { medal: '', bestScore: 0 }, skyline_siege: { medal: 'silver', bestScore: 812 } } });
});

test('a better medal or score wins and a weaker result never replaces it', () => {
    let { record, changed } = mergeDemolitionMedalResult(null, { mapKey: 'reactor_site', medal: 'silver', score: 500 });
    assert.equal(changed, true);
    ({ record, changed } = mergeDemolitionMedalResult(record, { mapKey: 'reactor_site', medal: 'bronze', score: 400 }));
    assert.equal(changed, false);
    assert.deepEqual(record.maps.reactor_site, { medal: 'silver', bestScore: 500 });
    ({ record, changed } = mergeDemolitionMedalResult(record, { mapKey: 'reactor_site', medal: 'bronze', score: 650 }));
    assert.deepEqual(record.maps.reactor_site, { medal: 'silver', bestScore: 650 });
    ({ record } = mergeDemolitionMedalResult(record, { mapKey: 'reactor_site', medal: 'gold', score: 10 }));
    assert.deepEqual(record.maps.reactor_site, { medal: 'gold', bestScore: 650 });
    assert.equal(mergeDemolitionMedalResult(record, { mapKey: '', medal: 'gold', score: 9 }).changed, false);
    assert.equal(formatDemolitionBestMedalsLine(record), 'Beste Medaillen: Reaktorgelände Gold');
    assert.equal(formatDemolitionBestMedalsLine(null), '');
});

test('a demolition run stores each map result once per local profile and keeps earlier bests', () => {
    const first = createStore({ [KEY]: { version: 1, maps: { eiffel_tower_siege: { medal: 'gold', bestScore: 99_999 } } }, 'other.key': { keep: true } });
    const second = createStore();
    const stores = { a: first, b: second };
    const humans = [
        { index: 0, isBot: false, vehicleId: 'ship1', rocketInventory: [] },
        { index: 1, isBot: false, vehicleId: 'ship1', rocketInventory: [] },
        { index: 2, isBot: false, vehicleId: 'ship1', rocketInventory: [] },
    ];
    const runtime = new DemolitionRuntime({ getRecordStoreForPlayerIndex: (_index, id) => stores[id] || null });
    // Player three shares profile "b": it must be written once per map, not twice.
    const stats = playRun(runtime, { humans, profileIds: ['a', 'b', 'b'] });

    assert.deepEqual(first.data.get('other.key'), { keep: true });
    assert.deepEqual(first.data.get(KEY).maps.eiffel_tower_siege, { medal: 'gold', bestScore: 99_999 });
    for (const stat of stats) {
        const expected = { medal: stat.medal, bestScore: stat.score.total };
        assert.ok(stat.score.total > 0);
        assert.deepEqual(second.data.get(KEY).maps[stat.mapKey], expected);
        if (stat.mapKey !== 'eiffel_tower_siege') assert.deepEqual(first.data.get(KEY).maps[stat.mapKey], expected);
    }
    assert.equal(second.saves.length, 3);

    const before = structuredClone(second.data.get(KEY));
    const weakRuntime = new DemolitionRuntime({ getRecordStoreForPlayerIndex: (_index, id) => stores[id] || null });
    playRun(weakRuntime, { humans, profileIds: ['a', 'b', 'b'], weak: true });
    assert.deepEqual(second.data.get(KEY), before);
    assert.equal(second.saves.length, 3);
});

test('an unreadable or missing store neither saves over the record nor breaks the run', () => {
    const broken = createStore({ [KEY]: { version: 1, maps: { reactor_site: { medal: 'gold', bestScore: 1 } } } }, { readStatus: 'read_failed' });
    const plain = createStore();
    const throwing = { ...plain, saveJsonRecord(key, value) { if (key === KEY) throw new Error('quota'); return plain.saveJsonRecord(key, value); } };
    const humans = [
        { index: 0, isBot: false, vehicleId: 'ship1', rocketInventory: [] },
        { index: 1, isBot: false, vehicleId: 'ship1', rocketInventory: [] },
    ];
    const stores = { a: broken, b: throwing };
    const runtime = new DemolitionRuntime({ getRecordStoreForPlayerIndex: (_index, id) => stores[id] || null });
    playRun(runtime, { humans, profileIds: ['a', 'b'] });
    assert.equal(broken.saves.length, 0);
    assert.deepEqual(broken.data.get(KEY).maps, { reactor_site: { medal: 'gold', bestScore: 1 } });

    const withoutProfile = new DemolitionRuntime({ getRecordStoreForPlayerIndex: () => null });
    playRun(withoutProfile, { humans: [humans[0]], profileIds: [] });
});

test('readable foreign data and a store without a read result are never saved over', () => {
    const newer = { version: 2, maps: { reactor_site: { medal: 'gold', bestScore: 7 } } };
    const foreign = createStore({ [KEY]: newer });
    const legacy = createStore({ [KEY]: { version: 1, maps: { reactor_site: { medal: 'gold', bestScore: 1 } } } });
    delete legacy.readJsonRecordResult;
    const human = { index: 0, isBot: false, vehicleId: 'ship1', rocketInventory: [] };
    for (const store of [foreign, legacy]) {
        const before = structuredClone(store.data.get(KEY));
        playRun(new DemolitionRuntime({ getRecordStoreForPlayerIndex: () => store }), { humans: [human], profileIds: ['a'] });
        assert.equal(store.saves.length, 0);
        assert.deepEqual(store.data.get(KEY), before);
    }
});

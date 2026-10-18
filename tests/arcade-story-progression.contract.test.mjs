import test from 'node:test';
import assert from 'node:assert/strict';
import { ARCADE_JOURNEY_SCHEMA, ARCADE_JOURNEY_STORAGE_KEY, ARCADE_JOURNEY_MAIN_STAGE_IDS,
    resolveArcadeJourneyAccess } from '../src/shared/contracts/ArcadeJourneyContract.js';
import { ARCADE_LAB_UNLOCK_STORAGE_KEY } from '../src/shared/contracts/ArcadeLabUnlockContract.js';
import { prepareArcadeJourneyRuntime } from '../src/core/runtime/ArcadeJourneyRuntimeOps.js';

function finalMission(previousStages) {
    const data = new Map([[ARCADE_JOURNEY_STORAGE_KEY, { schema: ARCADE_JOURNEY_SCHEMA,
        legacyAccessInitialized: true, stages: previousStages, preserve: 'metadata' }]]);
    const store = { readJsonRecordResult: key => data.has(key) ? { status: 'found', value: structuredClone(data.get(key)) } : { status: 'missing' },
        loadJsonRecord: (key, fallback) => data.has(key) ? structuredClone(data.get(key)) : fallback,
        saveJsonRecord: (key, value) => { data.set(key, structuredClone(value)); return true; } };
    const runtime = { rankContext: { tierId: 'any' } };
    const support = { game: { playerProfileManager: { getProfiles: () => [{ id: 'p' }], getRecordStorePort: () => store } },
        fivePortalsRuntime: runtime, _nowMs: () => 123456 };
    const state = { runtimeConfig: { arcade: { enabled: true, runType: 'five_portals',
        journeyStageId: 'sky_ladder', portalChainId: 'sky_ladder', playerProfileIds: ['p'] } },
        entityManager: { humanPlayers: [{ index: 0, isBot: false }] } };
    prepareArcadeJourneyRuntime(support, state, false);
    return { data, runtime };
}

test('the main route opens its successor on completion without requiring a medal', () => {
    const progress = { schema: ARCADE_JOURNEY_SCHEMA, stages: {} };
    for (let i = 0; i < ARCADE_JOURNEY_MAIN_STAGE_IDS.length; i++) {
        const id = ARCADE_JOURNEY_MAIN_STAGE_IDS[i];
        assert.equal(resolveArcadeJourneyAccess(id, progress).unlocked, true, id);
        if (i + 1 < ARCADE_JOURNEY_MAIN_STAGE_IDS.length) {
            assert.equal(resolveArcadeJourneyAccess(ARCADE_JOURNEY_MAIN_STAGE_IDS[i + 1], progress).unlocked, false);
        }
        progress.stages[id] = { completed: true };
    }
});

test('the actual final callback unlocks the Lab after all main missions, retaining progress metadata', () => {
    const previous = Object.fromEntries(ARCADE_JOURNEY_MAIN_STAGE_IDS.slice(0, -1).map(id => [id, { completed: true }]));
    const { data, runtime } = finalMission(previous);
    const result = runtime._onJourneyCompleted({ succeeded: true, value: 200000 });
    assert.equal(result.mainJourneyCompleted, true);
    assert.equal(data.get(ARCADE_LAB_UNLOCK_STORAGE_KEY).unlocked, true);
    assert.equal(data.get(ARCADE_JOURNEY_STORAGE_KEY).preserve, 'metadata');
});

test('finishing a separately accessible finale does not falsely announce the whole route or unlock the Lab', () => {
    const { data, runtime } = finalMission({});
    const result = runtime._onJourneyCompleted({ succeeded: true, value: 200000 });
    assert.equal(result.mainJourneyCompleted, false);
    assert.equal(data.has(ARCADE_LAB_UNLOCK_STORAGE_KEY), false);
});

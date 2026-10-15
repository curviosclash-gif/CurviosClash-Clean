import { GameRuntimeArcadeSupport } from '../src/core/runtime/GameRuntimeArcadeSupport.js';
import { ParcoursProgressSystem } from '../src/entities/systems/ParcoursProgressSystem.js';
import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { PARCOURS_MAPS } from '../src/core/config/maps/presets/parcours_maps.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { PlayerProfileManager } from '../src/application/player-profile/PlayerProfileManager.js';
import { ARCADE_JOURNEY_STORAGE_KEY } from '../src/shared/contracts/ArcadeJourneyContract.js';
import { resolvePlayerScopedStorageKey } from '../src/shared/contracts/PlayerProfileStorageContract.js';
import {
    completeClassicTutorialJourney,
    prepareArcadeJourneyRuntime,
    retryPendingArcadeJourney,
} from '../src/core/runtime/ArcadeJourneyRuntimeOps.js';

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createRecordStore() {
    const records = new Map();
    const failures = new Set();
    const writes = [];
    return {
        records,
        failures,
        writes,
        readJsonRecordResult(key) {
            return records.has(key)
                ? { ok: true, status: 'found', value: clone(records.get(key)) }
                : { ok: true, status: 'missing', value: null };
        },
        saveJsonRecord(key, value) {
            writes.push({ key, value: clone(value) });
            if (failures.has(key)) return { success: false, reason: 'quota_exceeded' };
            records.set(key, clone(value));
            return { success: true };
        },
        removeJsonRecord(key) { records.delete(key); return { success: true }; },
    };
}

function createProfileFixture() {
    let nextId = 1;
    const recordStore = createRecordStore();
    const manager = new PlayerProfileManager({
        recordStore,
        createId: () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`,
        now: () => '2026-10-15T12:00:00.000Z',
    });
    assert.equal(manager.bootstrap().ok, true);
    const profiles = [manager.getActiveProfile()];
    for (const name of ['Seat 0', 'Seat 1', 'Seat 2']) profiles.push(manager.createProfile(name).profile);
    assert.equal(manager.setActiveProfile(profiles[0].id).ok, true);
    return { manager, profiles, recordStore };
}

function makeSupport(manager, runtime, getNow = () => 1000) {
    return {
        game: { playerProfileManager: manager },
        arcadeRunRuntime: runtime,
        _journeySequence: 0,
        _nowMs: getNow,
    };
}

function makeState({ runType = 'gauntlet', journeyStageId = 'first_run', playerProfileIds, portalChainId = '' } = {}) {
    return {
        runtimeConfig: { arcade: {
            enabled: true,
            runType,
            journeyStageId,
            playerProfileIds,
            portalChainId,
            maps: runType === 'five_portals' ? ['micro_maw', 'frozen_helix'] : undefined,
        } },
        entityManager: { humanPlayers: [
            { index: 0, isBot: false }, { index: 1, isBot: false }, { index: 2, isBot: false },
        ] },
    };
}

function scopedJourneyKey(profileId) {
    return resolvePlayerScopedStorageKey(profileId, ARCADE_JOURNEY_STORAGE_KEY);
}

function journeyWrites(recordStore, profileIds) {
    const keys = new Set(profileIds.map(scopedJourneyKey));
    return recordStore.writes.filter(({ key }) => keys.has(key));
}

test('runtime pins all assigned local profiles, not the globally active profile', () => {
    const { manager, profiles, recordStore } = createProfileFixture();
    const [activeA, assignedB, assignedC, assignedD] = profiles;
    const runtime = { rankContext: { tierId: 'hard' }, _onJourneyCompleted: null };
    const support = makeSupport(manager, runtime);
    const state = makeState({ playerProfileIds: [assignedB.id, assignedC.id, assignedD.id] });

    prepareArcadeJourneyRuntime(support, state, false);
    const originalBinding = support._journeyRun.binding;
    state.runtimeConfig.arcade.playerProfileIds = [activeA.id, activeA.id, activeA.id];
    prepareArcadeJourneyRuntime(support, state, true);
    assert.equal(support._journeyRun.binding, originalBinding);
    assert.deepEqual(originalBinding.participants.map(({ profileId }) => profileId), [assignedB.id, assignedC.id, assignedD.id]);

    runtime._onJourneyCompleted({ succeeded: true, value: 30000 });
    for (const profile of [assignedB, assignedC, assignedD]) {
        const progress = manager.getRecordStorePort(profile.id).loadJsonRecord(ARCADE_JOURNEY_STORAGE_KEY);
        assert.equal(progress.stages.first_run.medals.hard.medal, 3);
    }
    assert.equal(manager.getRecordStorePort(activeA.id).loadJsonRecord(ARCADE_JOURNEY_STORAGE_KEY), null);
    assert.equal(journeyWrites(recordStore, [activeA.id, assignedB.id, assignedC.id, assignedD.id]).length, 3);
});

test('a pending award blocks a new prepare and retries the captured participant without per-frame reattempts', () => {
    const { manager, profiles, recordStore } = createProfileFixture();
    const [activeA, assignedB, assignedC, assignedD] = profiles;
    const bKey = scopedJourneyKey(assignedB.id);
    recordStore.failures.add(bKey);
    let now = 5000;
    const runtime = { rankContext: { tierId: 'normal' }, _onJourneyCompleted: null };
    const support = makeSupport(manager, runtime, () => now);
    const state = makeState({ playerProfileIds: [assignedB.id, assignedC.id, assignedD.id] });

    prepareArcadeJourneyRuntime(support, state, false);
    const originalBinding = support._journeyRun.binding;
    runtime._onJourneyCompleted({ succeeded: true, value: 30000 });
    assert.equal(support._journeyRun.binding.pending, true);
    assert.deepEqual(support._journeyRun.binding.participants.map(({ profileId }) => profileId), [assignedB.id, assignedC.id, assignedD.id]);
    const bAttemptsAfterCompletion = journeyWrites(recordStore, [assignedB.id]).length;
    assert.equal(bAttemptsAfterCompletion, 1);

    state.runtimeConfig.arcade.playerProfileIds = [activeA.id, activeA.id, activeA.id];
    assert.throws(() => prepareArcadeJourneyRuntime(support, state, false), /vorherigen Laufs/);
    assert.equal(support._journeyRun.binding, originalBinding);
    assert.deepEqual(originalBinding.participants.map(({ profileId }) => profileId), [assignedB.id, assignedC.id, assignedD.id]);
    assert.equal(journeyWrites(recordStore, [assignedB.id]).length, 2, 'prepare performs one immediate retry');

    assert.equal(retryPendingArcadeJourney(support), false, 'frame retry is throttled until one second elapses');
    assert.equal(journeyWrites(recordStore, [assignedB.id]).length, 2);
    now += 999;
    assert.equal(retryPendingArcadeJourney(support), false);
    assert.equal(journeyWrites(recordStore, [assignedB.id]).length, 2);
    now += 1;
    assert.equal(retryPendingArcadeJourney(support), false);
    assert.equal(journeyWrites(recordStore, [assignedB.id]).length, 3);

    recordStore.failures.delete(bKey);
    now += 1000;
    assert.equal(retryPendingArcadeJourney(support), true);
    assert.equal(support._journeyRun.binding, originalBinding);
    assert.deepEqual(originalBinding.participants.map(({ profileId }) => profileId), [assignedB.id, assignedC.id, assignedD.id]);
    assert.equal(journeyWrites(recordStore, [assignedB.id]).length, 4);
    assert.equal(journeyWrites(recordStore, [assignedC.id, assignedD.id]).length, 2, 'successful seats are not rewritten during retries');
});

test('map lists alone do not enable Journey callbacks, and the final callback records only a successful chain', () => {
    const { manager, profiles, recordStore } = createProfileFixture();
    const runtime = { rankContext: { tierId: 'any' }, _onJourneyCompleted: null };
    const support = {
        game: { playerProfileManager: manager },
        fivePortalsRuntime: runtime,
        _nowMs: () => 9000,
    };
    const [profile] = profiles;
    const noJourney = makeState({ runType: 'five_portals', journeyStageId: '', portalChainId: 'five_portals', playerProfileIds: [profile.id] });
    noJourney.entityManager.humanPlayers = [{ index: 0, isBot: false }];
    prepareArcadeJourneyRuntime(support, noJourney, false);
    assert.equal(support._journeyRun, null);
    assert.equal(runtime._onJourneyCompleted, null);
    assert.equal(journeyWrites(recordStore, [profile.id]).length, 0);

    const journeyState = makeState({ runType: 'five_portals', journeyStageId: 'five_portals', portalChainId: 'five_portals', playerProfileIds: [profile.id] });
    journeyState.entityManager.humanPlayers = [{ index: 0, isBot: false }];
    prepareArcadeJourneyRuntime(support, journeyState, false);
    assert.equal(typeof runtime._onJourneyCompleted, 'function');
    assert.equal(runtime._onJourneyCompleted({ succeeded: false, value: 200000 }).medal, 0);
    assert.equal(journeyWrites(recordStore, [profile.id]).length, 0);

    prepareArcadeJourneyRuntime(support, journeyState, false);
    const firstRunId = support._journeyRun.binding.runId;
    assert.equal(runtime._onJourneyCompleted({ succeeded: true, value: 200000 }).medal, 3);
    assert.equal(manager.getRecordStorePort(profile.id).loadJsonRecord(ARCADE_JOURNEY_STORAGE_KEY)
        .stages.five_portals.medals.normal.medal, 3);
    const writesAfterFinish = journeyWrites(recordStore, [profile.id]).length;
    runtime._onJourneyCompleted({ succeeded: true, value: 100000 });
    assert.equal(journeyWrites(recordStore, [profile.id]).length, writesAfterFinish, 'a duplicate completion callback does not write again');

    prepareArcadeJourneyRuntime(support, journeyState, false);
    assert.notEqual(support._journeyRun.binding.runId, firstRunId, 'a completed next run receives a fresh receipt id');
});

test('unsupported stage/runtime combinations fail before installing a completion callback', () => {
    const { manager, profiles } = createProfileFixture();
    const runtime = { rankContext: { tierId: 'normal' }, _onJourneyCompleted: null };
    const support = makeSupport(manager, runtime);
    const state = makeState({ runType: 'gauntlet', journeyStageId: 'five_portals', playerProfileIds: [profiles[0].id] });
    assert.throws(() => prepareArcadeJourneyRuntime(support, state, false), /gültige, getrennte Spielerprofile/);
    assert.equal(runtime._onJourneyCompleted, null);
    assert.equal(support._journeyRun, null);
});


test('real tutorial finish awards only the profile captured at start; checkpoints, foreign routes and repeats do not', () => {
    const { manager, profiles, recordStore } = createProfileFixture();
    const runtime = {};
    const support = makeSupport(manager, runtime);
    const outcomes = [];
    const state = { mapKey: 'tutorial_classic', runtimeConfig: { arcade: { enabled: false } },
        entityManager: { humanPlayers: [{ index: 0, isBot: false }], requestRoundEnd: value => outcomes.push(value) } };
    prepareArcadeJourneyRuntime(support, state, false);
    assert.equal(support._journeyRun.binding.stageId, 'flight_school');
    manager.setActiveProfile(profiles[1].id);
    const finish = { type: 'finish', playerIndex: 0, routeId: 'classic_tutorial_v1' };
    assert.equal(completeClassicTutorialJourney(support, state, { ...finish, type: 'checkpoint' }), false);
    assert.equal(completeClassicTutorialJourney(support, state, { ...finish, routeId: 'other' }), false);
    assert.equal(completeClassicTutorialJourney(support, state, { ...finish, playerIndex: 1 }), false);
    assert.equal(journeyWrites(recordStore, profiles.map(profile => profile.id)).length, 0);
    const human = state.entityManager.humanPlayers.pop();
    assert.equal(completeClassicTutorialJourney(support, state, finish), false, 'missing human cannot receive a successful result');
    assert.equal(journeyWrites(recordStore, profiles.map(profile => profile.id)).length, 0);
    state.entityManager.humanPlayers.push(human);
    assert.equal(completeClassicTutorialJourney(support, state, finish), true);
    assert.equal(completeClassicTutorialJourney(support, state, finish), false);
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].reason, 'JOURNEY_TUTORIAL');
    const writes = journeyWrites(recordStore, profiles.map(profile => profile.id));
    assert.equal(writes.length, 1); assert.equal(writes[0].key, scopedJourneyKey(profiles[0].id));
    assert.equal(writes[0].value.stages.flight_school.medals.normal.medal, 1);
    assert.equal(support._journeyRun.projected.nextStageId, 'first_run');
});

test('abandoning the tutorial does not count as a completed stage', () => {
    const { manager, profiles, recordStore } = createProfileFixture();
    const support = makeSupport(manager, {});
    const state = { mapKey: 'tutorial_classic', runtimeConfig: { arcade: { enabled: false } },
        entityManager: { humanPlayers: [{ index: 0, isBot: false }] } };
    prepareArcadeJourneyRuntime(support, state, false);
    prepareArcadeJourneyRuntime(support, { ...state, mapKey: 'standard' }, false);
    assert.equal(support._journeyRun, null);
    assert.equal(journeyWrites(recordStore, profiles.map(profile => profile.id)).length, 0);
});


test('real tutorial ring progression reaches the bound core completion callback only at its finish', () => {
    const { manager, profiles, recordStore } = createProfileFixture();
    const map = PARCOURS_MAPS.tutorial_classic;
    const player = { index: 0, isBot: false, alive: true, hitboxRadius: 1,
        position: { x: -200, y: 14, z: 0 } };
    const outcomes = [];
    const entities = { humanPlayers: [player], players: [player], activeGameMode: 'CLASSIC',
        entityRuntimeConfig: CONFIG_SECTIONS, _simulationClockMs: 1000,
        arena: { currentMapDefinition: map }, requestRoundEnd: value => outcomes.push(value),
        _notifyPlayerFeedback() {}, recorder: { logEvent() {} } };
    const parcours = new ParcoursProgressSystem(entities);
    entities._parcoursProgressSystem = parcours;
    parcours.startRound([player]); parcours.onPlayerSpawn(player, { reason: 'round_start' });
    const state = { mapKey: 'tutorial_classic', entityManager: entities,
        runtimeConfig: { arcade: { enabled: false, runType: 'gauntlet' }, session: { numHumans: 1 } } };
    const game = { playerProfileManager: manager, settings: {} };
    const support = new GameRuntimeArcadeSupport({ getGame: () => game, getRuntimeState: () => state });
    support.startRunIfEnabled();
    const route = parcours.getRouteSnapshot();
    for (const entry of [...route.checkpoints, route.finish]) {
        const length = Math.hypot(...entry.forward) || 1;
        const unit = entry.forward.map(value => value / length);
        const previous = Object.fromEntries(['x', 'y', 'z'].map((key, axis) => [key, entry.pos[axis] - unit[axis] * entry.radius * 0.5]));
        player.position = Object.fromEntries(['x', 'y', 'z'].map((key, axis) => [key, entry.pos[axis] + unit[axis] * entry.radius * 0.5]));
        entities._simulationClockMs += 1000;
        if (entry !== route.finish) assert.equal(journeyWrites(recordStore, profiles.map(profile => profile.id)).length, 0);
        parcours.updatePlayerProgress(player, previous, entities._simulationClockMs);
    }
    assert.equal(parcours.getPlayerProgressSnapshot(0).completed, true);
    assert.equal(outcomes.length, 1);
    assert.equal(support.getMenuSurfaceState().journey.medal, 1);
    assert.equal(journeyWrites(recordStore, profiles.map(profile => profile.id)).length, 1);
});

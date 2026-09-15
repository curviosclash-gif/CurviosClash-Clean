import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
    ENDLESS_PARCOURS_END_REASONS,
    ENDLESS_PARCOURS_MODULE_LENGTH,
} from '../src/shared/contracts/EndlessParcoursContract.js';
import {
    ENDLESS_PARCOURS_WAVE_PHASES,
    ENDLESS_PARCOURS_WAVE_TIMING,
    isEndlessEliteWave,
    resolveEndlessWaveProfile,
} from '../src/shared/contracts/EndlessParcoursWaveContract.js';
import {
    ENDLESS_PARCOURS_SETTLEMENT_STORAGE_KEY,
} from '../src/shared/contracts/EndlessParcoursSettlementContract.js';
import {
    ENDLESS_PARCOURS_RECORDS_STORAGE_KEY,
} from '../src/shared/contracts/EndlessParcoursRecordsContract.js';
import { ARCADE_VEHICLE_PROFILE_STORAGE_KEY } from '../src/shared/contracts/ArcadeVehicleProfileContract.js';
import { createArcadeVehicleProfile } from '../src/state/arcade/ArcadeVehicleProfile.js';
import { generateEndlessParcoursSequence } from '../src/entities/endless/EndlessParcoursGenerator.js';
import { resolveEndlessBotRocketType } from '../src/entities/endless/EndlessParcoursBotDirectorOps.js';
import { EndlessParcoursRuntime } from '../src/entities/endless/EndlessParcoursRuntime.js';
import { beginEndlessAttackWave } from '../src/entities/endless/EndlessParcoursWaveOps.js';
import { reconcileEndlessBots } from '../src/entities/endless/EndlessParcoursSlotOps.js';
import {
    syncEndlessFlightObjective,
    updateEndlessSideRoute,
} from '../src/entities/endless/EndlessParcoursObjectiveOps.js';
import { queueEndlessSettlement, retryEndlessSettlements } from '../src/state/arcade/EndlessParcoursSettlementStore.js';
import { resolveEndlessSpeedMultiplier } from '../src/shared/contracts/EndlessParcoursStageContract.js';
import { Player } from '../src/entities/Player.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import {
    emitArcadeDamageEvent,
    emitArcadeEliminationEvents,
} from '../src/entities/runtime/EntityArcadeGameplayEvents.js';

function settlement(runId = 'run-1', xp = 125) {
    return {
        runId,
        vehicleId: 'ship5',
        xp,
        ruleVersion: 'endless-parcours-rules.v2',
        endedAtIso: '2026-09-11T10:00:00.000Z',
        summary: { runId, score: 9000, distanceMeters: 1200, botKills: 3 },
        unlocks: ['accent-copper'],
    };
}

function createStore(failAtWrites = []) {
    const records = new Map();
    const failures = new Set(failAtWrites);
    let writes = 0;
    return {
        records,
        get writes() { return writes; },
        loadJsonRecord(key, fallback) { return records.has(key) ? structuredClone(records.get(key)) : fallback; },
        saveJsonRecord(key, value) {
            writes += 1;
            if (failures.has(writes)) return { success: false, reason: `write-${writes}` };
            records.set(key, structuredClone(value));
            return true;
        },
        clearFailures() { failures.clear(); },
    };
}

test('settlement retries before the first target and never credits XP twice', () => {
    const store = createStore([1]);
    assert.equal(queueEndlessSettlement(store, settlement()).pending, true);
    assert.equal(store.records.has(ENDLESS_PARCOURS_RECORDS_STORAGE_KEY), false);
    assert.equal(store.records.has(ARCADE_VEHICLE_PROFILE_STORAGE_KEY), false);
    store.clearFailures();
    assert.equal(queueEndlessSettlement(store, settlement()).ok, true);
    assert.equal(queueEndlessSettlement(store, settlement()).ok, true, 'repeated completion stays idempotent');
    const profile = store.records.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).ship5;
    assert.equal(profile.xp, 125);
    assert.deepEqual(profile.endlessSettlementIds, ['run-1']);
    assert.deepEqual(store.records.get(ENDLESS_PARCOURS_RECORDS_STORAGE_KEY).processedSettlementIds, ['run-1']);
});

test('partial settlement survives restart and a written receipt prevents duplicate XP', () => {
    const store = createStore([4]);
    const first = queueEndlessSettlement(store, settlement('run-partial', 80));
    assert.equal(first.reason, 'vehicle_write_failed');
    assert.equal(store.records.get(ENDLESS_PARCOURS_SETTLEMENT_STORAGE_KEY).pending.length, 1);
    store.clearFailures();
    assert.equal(retryEndlessSettlements(store).ok, true, 'a fresh runtime can continue the ledger');
    assert.equal(store.records.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).ship5.xp, 80);

    const receiptFailure = createStore([5]);
    assert.equal(queueEndlessSettlement(receiptFailure, settlement('receipt-run', 90)).pending, true);
    assert.equal(receiptFailure.records.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).ship5.xp, 90);
    receiptFailure.clearFailures();
    assert.equal(retryEndlessSettlements(receiptFailure).ok, true);
    assert.equal(receiptFailure.records.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).ship5.xp, 90);
});

test('wave profiles retain every authored balance value and elite cadence', () => {
    assert.deepEqual(
        Array.from({ length: 9 }, (_, index) => resolveEndlessWaveProfile(index + 1).capacity),
        [2, 3, 4, 5, 6, 8, 10, 12, 12]
    );
    assert.deepEqual(
        Array.from({ length: 9 }, (_, index) => resolveEndlessWaveProfile(index + 1).healthMultiplier),
        [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8]
    );
    assert.equal(resolveEndlessWaveProfile(20).damageMultiplier, 1.5);
    assert.deepEqual([4, 5, 8, 11, 12, 14].map(isEndlessEliteWave), [false, true, true, true, false, true]);
    assert.equal(resolveEndlessBotRocketType(3, 'flanker'), 'ROCKET_WEAK');
    assert.equal(resolveEndlessBotRocketType(5, 'flanker'), 'ROCKET_MEDIUM');
    assert.equal(resolveEndlessBotRocketType(5, 'interceptor'), 'ROCKET_MEDIUM');
    assert.equal(resolveEndlessBotRocketType(5, 'guard'), 'ROCKET_MEDIUM');
    assert.equal(resolveEndlessBotRocketType(9, 'pursuer'), '');
});

test('generator avoids equal adjacent arrangements including the seed-1 regression', () => {
    const modules = generateEndlessParcoursSequence(1, 80, 4);
    assert.notEqual(modules[8].arrangementId, modules[9].arrangementId);
    for (let index = 1; index < modules.length; index += 1) {
        assert.notEqual(modules[index - 1].arrangementId, modules[index].arrangementId);
    }
    for (let block = 1; block * 6 + 1 < modules.length; block += 1) {
        assert.notEqual(modules[block * 6].area, modules[block * 6 + 1].area);
    }
    assert.deepEqual(modules, generateEndlessParcoursSequence(1, 80, 4));
});

function createRuntime() {
    const sceneObjects = new Set();
    const human = {
        index: 0, isBot: false, alive: true, entitySlotActive: true,
        hp: 100, maxHp: 100, shieldHP: 0, inventory: [], baseSpeed: 20,
        position: new THREE.Vector3(0, 8, 121),
        getDirection(out) { return out.set(0, 0, 1); },
        setControlOptions() {},
    };
    const bots = Array.from({ length: 12 }, (_, slot) => ({ player: {
        index: slot + 1, isBot: true, alive: false, entitySlotActive: false,
        hp: 100, maxHp: 100, inventory: [], position: new THREE.Vector3(0, 0, -500),
        trail: { clear() {} },
    } }));
    const entityManager = {
        humanPlayers: [human], bots, players: [human, ...bots.map((entry) => entry.player)],
        _lockOnCache: new Map(), _projectileSystem: { clearInBounds() {}, clearForOwner() {} },
        activateBotSlot({ slot, position, role, difficulty }) {
            const player = bots[slot].player;
            if (player.entitySlotActive) return false;
            Object.assign(player, { entitySlotActive: true, alive: true, hp: 100, maxHp: 100, scenarioRole: role, difficulty });
            player.position.set(position.x, position.y, position.z);
            return true;
        },
        deactivateBotSlot(slot) { Object.assign(bots[slot].player, { entitySlotActive: false, alive: false }); return true; },
        _notifyPlayerFeedback() {}, requestRoundEnd() {},
    };
    const batches = new Map();
    const runtime = new EndlessParcoursRuntime({
        baseSeed: 1,
        renderer: { addToScene(object) { sceneObjects.add(object); }, removeFromScene(object) { sceneObjects.delete(object); } },
        arena: {
            enterStaticStreamingMode() {}, exitStaticStreamingMode() {}, checkCollisionFast() { return false; },
            registerStaticColliderBatch(id, value) { batches.set(id, value); },
            unregisterStaticColliderBatch(id) { batches.delete(id); }, getStaticColliderBatchCount() { return batches.size; },
        },
        powerupManager: { items: [], spawnAtAnchor() {}, removeByOwnerId() {} },
        entityManager,
        audio: { play() {} },
        wallClockIso: () => '2026-09-11T10:00:00.000Z',
    });
    runtime.combatStarted = true;
    runtime.elapsedCombatSeconds = 0;
    return { runtime, human, bots, batches, sceneObjects };
}

test('activation gate combines wave, warning, spacing, checkpoint and recovery locks', () => {
    const { runtime, bots } = createRuntime();
    beginEndlessAttackWave(runtime, 1);
    runtime.respiteUntilSeconds = 1.2;
    runtime.update(0);
    runtime.update(1);
    assert.equal(bots.filter((entry) => entry.player.alive).length, 0);
    runtime.update(0.2);
    assert.equal(bots.filter((entry) => entry.player.alive).length, 1);
    runtime.update(20);
    assert.equal(bots.filter((entry) => entry.player.alive).length, 1, 'one update activates at most one bot');
    runtime.update(1.5);
    assert.equal(bots.filter((entry) => entry.player.alive).length, 2);

    const blocked = createRuntime();
    beginEndlessAttackWave(blocked.runtime, 1);
    blocked.runtime.update(0);
    blocked.runtime.wavePhaseElapsedSeconds = ENDLESS_PARCOURS_WAVE_TIMING.attackSeconds - 0.5;
    blocked.runtime.update(1);
    assert.equal(blocked.runtime.wavePhase, ENDLESS_PARCOURS_WAVE_PHASES.RETREAT);
    assert.equal(blocked.bots.some((entry) => entry.player.alive), false, 'wave end wins over a matured warning');
    runtime.dispose();
    blocked.runtime.dispose();
});

test('recovery modules block even empty-field spawns and a moved anchor restarts its warning', () => {
    const recovery = createRuntime();
    recovery.runtime._syncModules(6, 1);
    recovery.runtime.currentModuleIndex = 6;
    assert.equal(recovery.runtime.activeModules.get(6).module.recovery, true);
    beginEndlessAttackWave(recovery.runtime, 1);
    reconcileEndlessBots(recovery.runtime);
    recovery.runtime.elapsedCombatSeconds = 2;
    reconcileEndlessBots(recovery.runtime);
    assert.equal(recovery.bots.some((entry) => entry.player.alive), false);
    recovery.runtime.dispose();

    const moved = createRuntime();
    beginEndlessAttackWave(moved.runtime, 1);
    reconcileEndlessBots(moved.runtime);
    const reserved = moved.runtime._botSlots[0];
    const originalTelegraphAt = reserved.telegraphedAt;
    reserved.plannedAnchor = { id: 'unloaded-anchor', x: 999, y: 999, z: 999, ahead: false };
    moved.runtime.elapsedCombatSeconds = 1;
    reconcileEndlessBots(moved.runtime);
    assert.equal(moved.bots.some((entry) => entry.player.alive), false);
    assert.ok(reserved.telegraphedAt > originalTelegraphAt, 're-anchoring restarts the full warning');
    moved.runtime.elapsedCombatSeconds = 1.99;
    reconcileEndlessBots(moved.runtime);
    assert.equal(moved.bots.some((entry) => entry.player.alive), false);
    moved.runtime.elapsedCombatSeconds = 2;
    reconcileEndlessBots(moved.runtime);
    assert.equal(moved.bots.filter((entry) => entry.player.alive).length, 1);
    moved.runtime.dispose();
});

test('wave 11 full occupancy selects one deterministic exchange without exceeding twelve', () => {
    const { runtime, human, bots } = createRuntime();
    runtime._botSlots.forEach((slot, index) => {
        slot.state = 'active';
        slot.activatedOrder = index < 2 ? 1 : index;
        Object.assign(slot.player, { alive: true, entitySlotActive: true, isEndlessElite: false });
    });
    beginEndlessAttackWave(runtime, 11);
    const exchange = runtime._botSlots.find((slot) => slot.state === 'exchange_retreat');
    assert.equal(exchange.slot, 0, 'activation order ties are resolved by slot');
    assert.equal(runtime.getDebugSnapshot().occupiedBots, 12);
    exchange.player.alive = false;
    runtime.handlePlayerDeath(exchange.player, 'MG', { killer: human, botSlot: 0, activationGeneration: 0 });
    assert.equal(runtime.botKills, 1, 'a real kill during exchange still scores');
    assert.equal(runtime.getDebugSnapshot().occupiedBots, 12, 'the elite reservation replaces, never adds');
    runtime.update(0);
    runtime.update(1);
    runtime.update(0.2);
    assert.equal(bots.filter((entry) => entry.player.isEndlessElite).length, 1);
    assert.ok(runtime.getDebugSnapshot().occupiedBots <= 12);
    runtime.dispose();
});

test('a blocked wave-11 elite expires at wave end and is never caught up later', () => {
    const { runtime, bots } = createRuntime();
    runtime._botSlots.forEach((slot, index) => {
        slot.state = 'active';
        slot.activatedOrder = index + 1;
        Object.assign(slot.player, { alive: true, entitySlotActive: true, isEndlessElite: false });
    });
    beginEndlessAttackWave(runtime, 11);
    runtime._isSpawnAnchorSafe = () => false;
    runtime.update(4);
    assert.equal(runtime.getDebugSnapshot().occupiedBots, 12, 'eleven active plus one reserved elite');
    runtime.update(26);
    assert.equal(runtime.lastCompletedWave, 11);
    assert.equal(runtime.getDebugSnapshot().occupiedBots, 11, 'the blocked reservation expires');
    assert.equal(bots.some((entry) => entry.player.isEndlessElite), false);
    runtime.update(4);
    runtime.update(15);
    assert.equal(runtime.waveNumber, 12);
    runtime._isSpawnAnchorSafe = () => true;
    runtime.update(1);
    runtime.update(1.5);
    assert.equal(bots.some((entry) => entry.player.isEndlessElite), false, 'wave 12 does not catch up wave 11');
    assert.ok(runtime.getDebugSnapshot().occupiedBots <= 12);
    runtime.dispose();
});

test('start vehicle bonuses are frozen, revive does not stack them, and abort grants no XP', () => {
    const store = createStore();
    const ship1 = createArcadeVehicleProfile('ship1');
    ship1.upgrades.engine_left = 'T2';
    ship1.upgrades.core = 'T2';
    const ship2 = createArcadeVehicleProfile('ship2');
    ship2.upgrades.engine_left = 'T3';
    ship2.upgrades.core = 'T3';
    store.records.set(ARCADE_VEHICLE_PROFILE_STORAGE_KEY, { ship1, ship2 });

    const first = createRuntime();
    const strategy = new ArcadeModeStrategy({ runType: 'endless_parcours', combatProfile: 'hunt' });
    first.runtime.setRecordStore(store);
    first.runtime.setRunProfile({ recordStore: store, vehicleId: 'ship1', strategy });
    assert.deepEqual(first.runtime.startBonuses, { turningBonusPct: 0, speedBonusPct: 8, maxHpBonus: 15 });
    assert.equal(first.human.baseSpeed, 21.6);
    assert.equal(first.human.maxHp, 115);

    store.records.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).ship1.upgrades.engine_left = 'T3';
    store.records.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).ship1.upgrades.core = 'T3';
    first.runtime.setRunProfile({ recordStore: store, vehicleId: 'ship2', strategy });
    assert.equal(first.runtime.startVehicleId, 'ship1', 'vehicle and bonuses stay bound for the running run');
    assert.equal(first.runtime.startBonuses.speedBonusPct, 8);

    first.runtime.entityManager._spawnOps = {
        spawnPlayerAt(player) {
            player.alive = true;
            strategy.resetPlayerHealth(player);
            strategy.applySpawnStatBonuses(player);
            return true;
        },
    };
    Object.assign(first.runtime, {
        lastCheckpointIndex: 0,
        lastCheckpointAnchor: { x: 0, y: 8, z: 116 },
        reviveArmedUntilSeconds: 5,
        elapsedCombatSeconds: 1,
        flightObjective: { id: 'three_clean_checkpoints', target: 3, progress: 2, completed: false },
    });
    first.human.alive = false;
    first.runtime.handlePlayerDeath(first.human, 'PROJECTILE');
    assert.equal(first.human.baseSpeed, 21.6);
    assert.equal(first.human.maxHp, 115);
    assert.equal(first.runtime.flightObjective.progress, 0, 'revive resets the clean-checkpoint sequence');
    first.runtime.collectRunXp('checkpoint', 3);
    first.runtime.finalize(ENDLESS_PARCOURS_END_REASONS.ABORT, { persist: false, requestRoundEnd: false });
    assert.equal(store.records.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).ship1.xp, 0);
    first.runtime.dispose();

    const second = createRuntime();
    const secondStrategy = new ArcadeModeStrategy({ runType: 'endless_parcours', combatProfile: 'hunt' });
    second.runtime.setRunProfile({ recordStore: store, vehicleId: 'ship2', strategy: secondStrategy });
    assert.equal(second.runtime.startVehicleId, 'ship2');
    assert.equal(second.human.baseSpeed, 23.2);
    assert.equal(second.human.maxHp, 130);
    second.runtime.dispose();
});

test('flight objectives use actual loss, count the final area gate, and keep fixed side-route scoring', () => {
    const { runtime, human } = createRuntime();
    syncEndlessFlightObjective(runtime, 1, 'industrial');
    runtime.flightObjective.progress = 2;
    const owner = {
        players: [human],
        onArcadeGameplayEvent: (event) => runtime.handleGameplayEvent(event),
    };
    emitArcadeDamageEvent(owner, { target: human, damageResult: { applied: 0 } });
    assert.equal(runtime.flightObjective.progress, 2, 'a zero-loss hit emits no damage event');
    emitArcadeDamageEvent(owner, { target: human, damageResult: { applied: 1, absorbedByShield: 1 } });
    assert.equal(runtime.flightObjective.progress, 0, 'shield loss resets the sequence');

    runtime.flightObjective.progress = 2;
    runtime._damagedSinceCheckpoint = false;
    const beforeObjective = runtime.bonusScore;
    runtime.onCheckpointPassed(6);
    assert.equal(runtime.flightObjective.completed, true, 'the last gate is evaluated in the old area');
    assert.equal(runtime.bonusScore - beforeObjective, 400);
    syncEndlessFlightObjective(runtime, 7, 'canyon');
    assert.equal(runtime.flightObjective.id, 'risk_route');

    runtime._syncModules(9, 4);
    runtime.currentModuleIndex = 9;
    const routeModule = runtime.activeModules.get(9).module;
    const route = routeModule.sideRoute;
    assert.ok(route);
    const scoreBeforeRoute = runtime.bonusScore;
    const streakBeforeRoute = runtime.streak;
    human.position.set(route.side * 100, 8, routeModule.originZ);
    updateEndlessSideRoute(runtime, human);
    human.position.z = routeModule.originZ + route.entryZ + 1;
    updateEndlessSideRoute(runtime, human);
    human.position.z = routeModule.originZ + route.exitZ + 1;
    updateEndlessSideRoute(runtime, human);
    assert.equal(runtime.sideRoutesCompleted, 1);
    assert.equal(runtime.flightObjectivesCompleted, 2);
    assert.equal(runtime.bonusScore - scoreBeforeRoute, 600, '200 route points plus a separate fixed 400 objective');
    assert.equal(runtime.streak, streakBeforeRoute, 'neither fixed award extends the streak');
    runtime.dispose();
});

test('bot kill events carry identity and stale generations cannot score a reused slot', () => {
    const { runtime, human, bots } = createRuntime();
    let emitted = null;
    emitArcadeEliminationEvents(
        { players: [human, bots[0].player], onArcadeGameplayEvent: (event) => { emitted = event; } },
        bots[0].player,
        'PROJECTILE',
        { killer: human, runId: runtime.runId, botSlot: 0, activationGeneration: 7 }
    );
    assert.deepEqual(
        { runId: emitted.runId, botSlot: emitted.botSlot, activationGeneration: emitted.activationGeneration },
        { runId: runtime.runId, botSlot: 0, activationGeneration: 7 }
    );

    const slot = runtime._botSlots[0];
    slot.state = 'active';
    slot.activationGeneration = 2;
    Object.assign(slot.player, { alive: true, entitySlotActive: true });
    runtime.handlePlayerDeath(slot.player, 'PROJECTILE', {
        killer: human, runId: runtime.runId, botSlot: 0, activationGeneration: 1,
    });
    assert.equal(runtime.botKills, 0);
    assert.equal(slot.state, 'active');
    runtime.handlePlayerDeath(slot.player, 'PROJECTILE', {
        killer: human, runId: 'previous-run', botSlot: 0, activationGeneration: 2,
    });
    assert.equal(runtime.botKills, 0);
    runtime.handlePlayerDeath(slot.player, 'PROJECTILE', {
        killer: human, runId: runtime.runId, botSlot: 0, activationGeneration: 2,
    });
    assert.equal(runtime.botKills, 1);
    runtime.dispose();
});

test('one thousand module switches and ten restarts keep runtime and renderer resources bounded', () => {
    let transitions = 0;
    for (let restart = 0; restart < 10; restart += 1) {
        const harness = createRuntime();
        const { runtime, human, batches, sceneObjects } = harness;
        let geometryDisposals = 0;
        let materialDisposals = 0;
        const geometryDispose = runtime._sharedGeometry.dispose.bind(runtime._sharedGeometry);
        runtime._sharedGeometry.dispose = () => { geometryDisposals += 1; geometryDispose(); };
        for (const material of Object.values(runtime._materials)) {
            const dispose = material.dispose.bind(material);
            material.dispose = () => { materialDisposals += 1; dispose(); };
        }
        for (let step = 1; step <= 100; step += 1) {
            const moduleIndex = step;
            human.position.z = moduleIndex * 120 + 1;
            runtime.update(0);
            transitions += 1;
            const snapshot = runtime.getDebugSnapshot();
            assert.ok(snapshot.activeModules <= 7);
            assert.ok(snapshot.colliderBatches <= 7);
            assert.ok(snapshot.pickups <= 21);
            assert.ok(snapshot.occupiedBots <= 12);
            assert.ok(snapshot.sideRouteMetadata <= snapshot.generatedModuleMetadata);
            assert.ok(sceneObjects.size <= 7);
        }
        const chainBeforeReload = runtime.getDebugSnapshot().generatedModuleMetadata;
        human.position.z -= 120;
        runtime.update(0);
        assert.equal(runtime.getDebugSnapshot().generatedModuleMetadata, chainBeforeReload);
        runtime.dispose();
        assert.equal(batches.size, 0);
        assert.equal(sceneObjects.size, 0);
        assert.equal(runtime.getDebugSnapshot().activeModules, 0);
        assert.equal(geometryDisposals, 1);
        assert.equal(materialDisposals, Object.keys(runtime._materials).length);
        assert.equal(runtime._sideRouteStates.size, 0);
    }
    assert.equal(transitions, 1000);
});

test('a vehicle speed upgrade counts once per module, not squared', () => {
    const store = createStore();
    const ship1 = createArcadeVehicleProfile('ship1');
    ship1.upgrades.engine_left = 'T2';
    ship1.upgrades.core = 'T2';
    store.records.set(ARCADE_VEHICLE_PROFILE_STORAGE_KEY, { ship1 });

    const { runtime, human } = createRuntime();
    // Die echte Spielerlogik: sie rechnet den Strategiefaktor selbst wieder ein.
    human.setControlOptions = (options) => Player.prototype.setControlOptions.call(human, options);
    const strategy = new ArcadeModeStrategy({ runType: 'endless_parcours', combatProfile: 'hunt' });
    runtime.setRecordStore(store);
    runtime.setRunProfile({ recordStore: store, vehicleId: 'ship1', strategy });

    const upgradeFactor = 1 + runtime.startBonuses.speedBonusPct / 100;
    assert.equal(runtime.startBonuses.speedBonusPct, 8);
    assert.equal(human.baseSpeed, 20 * upgradeFactor, 'the run starts with the upgrade applied once');

    // Erster Baustein geschafft: das Tempo der Strecke kommt dazu.
    human.position.set(0, 8, ENDLESS_PARCOURS_MODULE_LENGTH + 4);
    runtime._updateProgress(human);
    assert.equal(runtime.completedModules, 1, 'the first module counts as completed');
    const moduleFactor = resolveEndlessSpeedMultiplier(1);
    assert.equal(
        Number(human.baseSpeed.toFixed(6)),
        Number((20 * upgradeFactor * moduleFactor).toFixed(6)),
        'the upgrade must not be multiplied in a second time'
    );

    // Zweiter Baustein: der Faktor darf sich auch danach nicht aufschaukeln.
    human.position.set(0, 8, ENDLESS_PARCOURS_MODULE_LENGTH * 2 + 4);
    runtime._updateProgress(human);
    assert.equal(
        Number(human.baseSpeed.toFixed(6)),
        Number((20 * upgradeFactor * resolveEndlessSpeedMultiplier(2)).toFixed(6)),
        'every further module keeps the upgrade linear'
    );
    runtime.dispose();
});

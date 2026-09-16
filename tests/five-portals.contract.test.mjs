import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import { createDefaultSettingsSnapshot } from '../src/core/settings/SettingsDefaultsFacade.js';
import { PARCOURS_PACK_V130_MAPS } from '../src/core/config/maps/presets/parcours_pack_v130.js';
import { FivePortalsRuntime } from '../src/core/arcade/FivePortalsRuntime.js';
import { GameRuntimeArcadeSupport } from '../src/core/runtime/GameRuntimeArcadeSupport.js';
import { EntityManager } from '../src/entities/EntityManager.js';
import { ParcoursProgressSystem } from '../src/entities/systems/ParcoursProgressSystem.js';
import { PowerupManager } from '../src/entities/Powerup.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { FIVE_PORTALS_MAPS } from '../src/shared/contracts/FivePortalsContract.js';
import { normalizeArcadeRunSettings } from '../src/shared/contracts/ArcadeRunSettingsContract.js';

test('Fünf Portale has a fixed solo route, Hunt profile, anchored items and separate exits', () => {
    assert.equal(normalizeArcadeRunSettings({ runType: 'FIVE_PORTALS' }).runType, 'five_portals');
    assert.equal(normalizeArcadeRunSettings({ runType: 'FIVE_PORTALS' }).combatProfile, 'hunt');
    assert.deepEqual(FIVE_PORTALS_MAPS, ['micro_maw', 'mirror_docks', 'glass_serpent', 'storm_switchyard', 'wind_cathedral']);
    const strategy = new ArcadeModeStrategy({ runType: 'five_portals' });
    assert.equal(strategy.getPickupModeType(), 'HUNT');
    assert.equal(strategy.getParcoursRespawnFallback().lastCheckpointRespawns, 3);
    const settings = createDefaultSettingsSnapshot();
    settings.arcade.runType = 'five_portals'; settings.gameMode = 'ARCADE';
    settings.localSettings.modePath = 'arcade'; settings.numBots = 9;
    settings.mapKey = 'standard'; settings.portalsEnabled = false;
    const runtimeConfig = createRuntimeConfigSnapshot(settings);
    assert.equal(runtimeConfig.session.numBots, 0);
    assert.equal(runtimeConfig.session.mapKey, 'micro_maw');
    assert.equal(runtimeConfig.session.portalsEnabled, true);
    for (const mapKey of FIVE_PORTALS_MAPS) {
        const map = PARCOURS_PACK_V130_MAPS[mapKey];
        assert.equal(map.itemSpawnMode, 'anchor-only');
        assert.equal(map.itemRespawnSeconds, 30);
        assert.equal(map.fivePortalsExit.color, 0xffcc44);
        assert.ok(map.parcours.finish);
        assert.ok(map.staticTurrets.length > 0);
        assert.ok(map.staticTurrets.every((turret) => turret.destructible && turret.allowedModes.includes('ARCADE')));
    }
});

test('finish freezes time; only the exit portal advances all five maps and saves the best sum', () => {
    const transitions = []; const advances = []; const saves = [];
    const store = { loadJsonRecord() { return null; }, saveJsonRecord(key, value) { saves.push({ key, value }); } };
    let clock = 1000; let active = false; let deactivated = 0;
    const manager = {
        _simulationClockMs: clock,
        _parcoursProgressSystem: { getPlayerProgressSnapshot: () => ({ startedAtMs: 1000, penaltyTimeMs: 0, nextCheckpointIndex: 2, totalCheckpoints: 7, checkpointRespawnsUsed: 0 }) },
        arena: { _portalGateSystem: { portalRuntime: { activateExitPortals() { active = true; }, deactivateExitPortals() { active = false; deactivated += 1; } } } },
    };
    const runtime = new FivePortalsRuntime({ getRecordStore: () => store, requestMapTransition: (transition) => transitions.push(transition), requestAdvance: () => advances.push(true) });
    runtime.start(manager);
    for (let index = 0; index < 5; index += 1) {
        manager._simulationClockMs = clock + 50000;
        assert.equal(runtime.handleGameplayEvent({ type: 'exit_portal', playerIndex: 0 }), null, 'inactive exit cannot advance');
        runtime.handleParcoursEvent({ type: 'finish', playerIndex: 0, totalTimeMs: (index + 1) * 1000 });
        assert.equal(runtime.phase, 'portal'); assert.equal(active, true);
        const stopped = runtime.getHudState().currentTimeMs;
        manager._simulationClockMs += 30000;
        assert.equal(runtime.getHudState().currentTimeMs, stopped, 'portal wait is excluded');
        runtime.handleGameplayEvent({ type: 'internal_portal', playerIndex: 0 });
        assert.equal(runtime.phase, 'portal');
        runtime.handleGameplayEvent({ type: 'exit_portal', playerIndex: 0 });
        assert.equal(active, false);
        if (index < 4) {
            assert.equal(transitions[index].mapKey, FIVE_PORTALS_MAPS[index + 1]);
            assert.equal(transitions[index].botCount, 0);
            assert.equal(advances.length, index + 1);
            runtime.start(manager);
            clock += 100000;
        }
    }
    const state = runtime.getHudState();
    assert.equal(state.phase, 'finished');
    assert.deepEqual(state.mapTimesMs, [1000, 2000, 3000, 4000, 5000]);
    assert.equal(state.postRunSummary.totalMs, 15000);
    assert.equal(state.records.bestTotalMs, 15000);
    assert.equal(saves.length, 1);
    assert.equal(saves[0].value.version, 'five-portals-records.v1');
    assert.ok(deactivated >= 5);
});

test('the versioned total-time record keeps a faster previous run', () => {
    const saved = [];
    const store = {
        loadJsonRecord() { return { version: 'five-portals-records.v1', bestTotalMs: 12000, lastTotalMs: 12000, lastMapsMs: [2000, 2000, 2000, 3000, 3000] }; },
        saveJsonRecord(_key, value) { saved.push(value); },
    };
    const runtime = new FivePortalsRuntime({ getRecordStore: () => store });
    runtime.start(null);
    runtime.mapIndex = 4;
    runtime.mapTimesMs = [3000, 3000, 3000, 3000];
    runtime.handleParcoursEvent({ type: 'finish', playerIndex: 0, totalTimeMs: 3000 });
    runtime.handleGameplayEvent({ type: 'exit_portal', playerIndex: 0 });
    assert.equal(saved[0].lastTotalMs, 15000);
    assert.equal(saved[0].bestTotalMs, 12000);
});

test('leaving a finished run releases its portal binding and run state', () => {
    const state = { runtimeConfig: null };
    let deactivations = 0;
    const support = new GameRuntimeArcadeSupport({ getRuntimeState: () => state, getGame: () => null });
    support.fivePortalsRuntime.phase = 'finished';
    support.fivePortalsRuntime.entityManager = { arena: { _portalGateSystem: { portalRuntime: { deactivateExitPortals() { deactivations += 1; } } } } };
    support.resetRunState({ force: true });
    assert.equal(support.fivePortalsRuntime.phase, 'idle');
    assert.equal(support.fivePortalsRuntime.entityManager, null);
    assert.equal(deactivations, 1);
});

test('three checkpoint deaths preserve turrets; fourth death resets only the current attempt', () => {
    const map = PARCOURS_PACK_V130_MAPS.micro_maw;
    const strategy = new ArcadeModeStrategy({ runType: 'five_portals' });
    const player = { index: 0, isBot: false, alive: true, hitboxRadius: 1, position: new THREE.Vector3() };
    let turretResets = 0; let itemResets = 0; let projectileResets = 0;
    const manager = {
        arena: { currentMapDefinition: map, _portalGateSystem: { portalRuntime: { deactivateExitPortals() {} } } },
        gameModeStrategy: strategy, activeGameMode: 'ARCADE', entityRuntimeConfig: CONFIG_SECTIONS,
        players: [player], _simulationClockMs: 1000,
        _notifyPlayerFeedback() {}, recorder: { logEvent() {} },
        _staticTurretSystem: { startRound() { turretResets += 1; } },
        _projectileSystem: { clear() { projectileResets += 1; } },
        powerupManager: { clear() { itemResets += 1; } },
    };
    const parcours = new ParcoursProgressSystem(manager);
    manager._parcoursProgressSystem = parcours;
    parcours.startRound([player]);
    const runtime = new FivePortalsRuntime(); runtime.start(manager);
    runtime.mapTimesMs = [1000, 2000]; runtime.mapIndex = 2;
    runtime.currentTimeMs = 9000;
    parcours.setAttemptResetCallback(() => runtime.handleAttemptReset());
    for (let death = 1; death <= 3; death += 1) {
        parcours.onPlayerDeath(player, { cause: 'test' });
        assert.equal(parcours.getPlayerProgressSnapshot(0).checkpointRespawnsUsed, death);
        assert.equal(parcours.takeRespawnPlan(player).restartAtFirstCheckpoint, false);
    }
    assert.equal(turretResets, 0);
    parcours.onPlayerDeath(player, { cause: 'test' });
    assert.equal(parcours.takeRespawnPlan(player).restartAtFirstCheckpoint, true);
    assert.equal(parcours.getPlayerProgressSnapshot(0).checkpointRespawnsUsed, 0);
    assert.equal(runtime.currentTimeMs, 0);
    assert.deepEqual(runtime.mapTimesMs, [1000, 2000]);
    assert.equal(runtime.mapIndex, 2);
    assert.equal(turretResets, 1); assert.equal(itemResets, 1); assert.equal(projectileResets, 1);
});

test('fixed items return after 30 simulation seconds or on death without duplicates', () => {
    const anchors = PARCOURS_PACK_V130_MAPS.micro_maw.items.slice(0, 2);
    const arena = { bounds: { x: 100, y: 50, z: 100 }, currentMapDefinition: { itemSpawnMode: 'anchor-only', itemRespawnSeconds: 30, itemRespawnOnDeath: true }, getAuthoredItemAnchors: () => anchors };
    const renderer = { addToScene() {}, removeFromScene() {} };
    const manager = new PowerupManager(renderer, arena, CONFIG_SECTIONS);
    manager.getStrategy = () => new ArcadeModeStrategy({ runType: 'five_portals' });
    manager._createPowerupMesh = () => new THREE.Object3D();
    manager._applyAuthoredItemModel = () => {};
    manager._spawnRandom = () => { throw new Error('fixed maps must never use random item spawning'); };
    manager.update(0);
    assert.equal(manager.items.length, 2);
    const target = manager.items[0];
    assert.equal(manager.checkPickup(target.mesh.position, 1, () => true)?.ok, true);
    assert.equal(manager.items.length, 1);
    manager.update(29.9); assert.equal(manager.items.length, 1);
    manager.update(0.1); assert.equal(manager.items.length, 2);
    manager.update(5); assert.equal(manager.items.length, 2, 'each anchor is unique');
    const next = manager.items[0];
    assert.equal(manager.checkPickup(next.mesh.position, 1, () => true)?.ok, true);
    manager.refillAuthoredOnDeath();
    assert.equal(manager.items.length, 2);
    manager.dispose();
});

test('a finished Fünf Portale map never ends the round through the parcours outcome', () => {
    const outcomeFor = (runType) => {
        const manager = new EntityManager(null, null, null, null, null, null);
        manager.runtimeConfig = { arcade: { enabled: true, runType } };
        manager.players = [{ index: 0, alive: true }];
        manager._parcoursProgressSystem._route = { routeId: 'goal', totalCheckpoints: 1, rules: { winnerByParcoursComplete: true } };
        manager._parcoursProgressSystem._completionOrder = [
            { playerIndex: 0, completedAtMs: 1000, completionTimeMs: 1000, penaltyTimeMs: 0 },
        ];
        return {
            parcoursEnds: manager._parcoursProgressSystem.getRoundOutcome()?.shouldEnd === true,
            objectiveOutcome: manager._roundOutcomeSystem.getObjectiveOutcome(),
        };
    };

    const fivePortals = outcomeFor('five_portals');
    assert.equal(fivePortals.parcoursEnds, true);
    assert.equal(fivePortals.objectiveOutcome, null, 'the exit portal, not the goal ring, advances the run');
    assert.equal(outcomeFor('endless').objectiveOutcome?.shouldEnd, true, 'other parcours runs still end on the goal');
});
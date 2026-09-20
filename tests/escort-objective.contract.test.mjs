import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ESCORT_DEFAULTS,
    ESCORT_PHASES,
    resolveEscortOutcome,
    resolveEscortTankSpeed,
} from '../src/shared/contracts/EscortObjectiveContract.js';
import { GAME_MODE_TYPES, isHuntMode, normalizeGameMode } from '../src/hunt/HuntMode.js';
import { createGameModeStrategy } from '../src/modes/GameModeRegistry.js';
import { TEAM_IDS } from '../src/shared/contracts/TeamCombatContract.js';
import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';
import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import { serializeMapUnits } from '../src/entities/systems/map-units/MapUnitNetworkOps.js';
import { buildMatchRuntimeProjection } from '../src/shared/runtime/MatchRuntimeProjectionBuilder.js';
import {
    createMapUnitAssets,
    createMapUnitVisual,
    disposeMapUnitAssets,
    removeMapUnitVisual,
} from '../src/entities/systems/map-units/MapUnitVisualOps.js';
import * as THREE from 'three';

test('escort keeps the approved tank, movement and round balance', () => {
    assert.deepEqual(ESCORT_DEFAULTS, {
        tankMaxHp: 600,
        baseSpeed: 6,
        escortedSpeed: 10,
        escortRadius: 30,
        pathSeconds: 180,
        roundSeconds: 300,
    });
    assert.equal(resolveEscortTankSpeed(false), 6);
    assert.equal(resolveEscortTankSpeed(true), 10);
});

test('escort outcome gives Alpha the destination and Bravo destruction or timeout', () => {
    assert.equal(resolveEscortOutcome({ tankAlive: true, reachedGoal: true, elapsedSeconds: 100 }).winnerTeamId, TEAM_IDS.ALPHA);
    assert.equal(resolveEscortOutcome({ tankAlive: false, reachedGoal: false, elapsedSeconds: 100 }).winnerTeamId, TEAM_IDS.BRAVO);
    assert.equal(resolveEscortOutcome({ tankAlive: true, reachedGoal: false, elapsedSeconds: 300 }).winnerTeamId, TEAM_IDS.BRAVO);
    assert.equal(resolveEscortOutcome({ tankAlive: true, reachedGoal: false, elapsedSeconds: 299 }), null);
});

test('escort is an explicit combat mode backed by its own strategy', () => {
    assert.equal(normalizeGameMode('escort'), GAME_MODE_TYPES.ESCORT);
    assert.equal(isHuntMode(GAME_MODE_TYPES.ESCORT), true);
    const strategy = createGameModeStrategy(GAME_MODE_TYPES.ESCORT);
    assert.equal(strategy.modeType, GAME_MODE_TYPES.ESCORT);
    assert.equal(strategy.getPickupModeType(), GAME_MODE_TYPES.HUNT);
    assert.equal(strategy.hasCombatHud(), true);
});

test('the Escort team objective selects the explicit runtime mode', () => {
    const runtime = createRuntimeConfigSnapshot({
        gameMode: GAME_MODE_TYPES.HUNT,
        localSettings: { modePath: 'fight' },
        hunt: { teamMode: true, teamObjective: 'ESCORT', respawnEnabled: true },
    });
    assert.equal(runtime.session.activeGameMode, GAME_MODE_TYPES.ESCORT);
    assert.equal(runtime.hunt.teamObjective, 'ESCORT');
    assert.equal(runtime.hunt.respawnEnabled, true);
    const invalid = createRuntimeConfigSnapshot({
        gameMode: GAME_MODE_TYPES.HUNT,
        hunt: { teamMode: false, teamObjective: 'ESCORT', respawnEnabled: true },
    });
    assert.equal(invalid.session.activeGameMode, GAME_MODE_TYPES.HUNT);
    assert.equal(invalid.hunt.teamMode, false);
});

test('escort HUD always projects the fixed five minute round clock', () => {
    const entityManager = {
        players: [],
        activeGameMode: GAME_MODE_TYPES.ESCORT,
        runtimeConfig: { hunt: { teamMode: true, teamObjective: 'ESCORT' } },
        entityRuntimeConfig: { HUNT: { WIN_CONDITION: 'last_alive' } },
        gameModeStrategy: { hasCombatHud: () => true, isRespawnEnabled: () => true, getPickupModeType: () => 'HUNT' },
        _roundOutcomeSystem: { getDeathmatchState: () => ({ elapsedSeconds: 42 }) },
        _mapUnitSystem: { getEscortObjectiveState: () => ({
            active: true,
            tankId: 'escort_tank',
            phase: 'MOVING',
            hp: 450,
            maxHp: 600,
            hpRatio: 0.75,
            progress: 0.25,
            checkpointIndex: -1,
            checkpointCount: 2,
            position: { x: 10, y: 2, z: 20 },
        }) },
    };
    const projection = buildMatchRuntimeProjection({
        game: { entityManager, state: 'PLAYING' },
        runtimeState: { activeGameMode: GAME_MODE_TYPES.ESCORT },
    });
    assert.equal(projection.hunt.timeLimitSeconds, 300);
    assert.equal(projection.hunt.timeRemainingSeconds, 258);
    assert.equal(projection.hunt.escort.hpRatio, 0.75);
    assert.equal(projection.hunt.escort.progress, 0.25);
    assert.deepEqual(projection.hunt.escort.position, { x: 10, y: 2, z: 20 });
});

test('escort runtime creates the 600 HP tank, accelerates near Alpha and ends for Bravo on destruction', () => {
    const alpha = { index: 0, teamId: TEAM_IDS.ALPHA, alive: true, position: new THREE.Vector3(-80, 2, -80) };
    const bravo = { index: 1, teamId: TEAM_IDS.BRAVO, alive: true, position: new THREE.Vector3(80, 2, 80) };
    const manager = {
        gameModeStrategy: createGameModeStrategy(GAME_MODE_TYPES.ESCORT),
        arena: {
            bounds: { minX: -100, maxX: 100, minY: 0, maxY: 80, minZ: -100, maxZ: 100 },
            currentMapDefinition: {},
        },
        players: [alpha, bravo],
        _targetableRegistry: { collect: () => [] },
        _huntScoring: {
            downs: 0,
            finals: 0,
            registerEscortTankDown(_index, final, countDown = true) {
                if (countDown) this.downs += 1;
                if (final) this.finals += 1;
            },
        },
        _simulationClockMs: 1000,
    };
    const system = new MapUnitSystem(manager);
    assert.equal(system.startRound(), 1);
    const tank = system.units[0];
    assert.equal(tank.escortTank, true);
    assert.equal(tank.hp, 600);
    const pathLength = tank.path.slice(1).reduce((sum, point, index) => {
        const previous = tank.path[index];
        return sum + Math.hypot(
            point[0] - previous[0], point[1] - previous[1], point[2] - previous[2],
        );
    }, 0);
    assert.ok(pathLength / ESCORT_DEFAULTS.baseSpeed > 150);
    assert.ok(pathLength / ESCORT_DEFAULTS.baseSpeed < 210);
    alpha.position.copy(tank.position);
    system.update(0.1);
    assert.equal(tank.speed, 10);
    assert.equal(serializeMapUnits(system.units)[0].escortSpeed, 10);
    assert.equal(tank.takeDamage(100, { sourcePlayer: alpha }).hpApplied, 0);
    const downed = tank.takeDamage(600, { sourcePlayer: bravo });
    assert.equal(downed.isDead, false);
    assert.equal(downed.isDowned, true);
    assert.equal(tank.escortPhase, ESCORT_PHASES.DOWNED);
    assert.equal(system.getEscortOutcome().shouldEnd, false);
    alpha.position.set(100, 2, 100);
    system.update(12.1);
    assert.equal(system.getEscortOutcome().winnerTeamId, TEAM_IDS.BRAVO);
    assert.equal(manager._huntScoring.downs, 1);
    assert.equal(manager._huntScoring.finals, 1);
});

test('escort tank visual carries the blue team accent and health color', () => {
    const sceneRoots = [];
    const renderer = {
        addToScene(root) { sceneRoots.push(root); },
        removeFromScene(root) { sceneRoots.splice(sceneRoots.indexOf(root), 1); },
    };
    const assets = createMapUnitAssets();
    const unit = {
        root: createMapUnitVisual(renderer, assets, 1, 0x00aaff),
    };
    try {
        assert.equal(unit.root.userData.teamAccent.material.color.getHex(THREE.SRGBColorSpace), 0x00aaff);
        assert.equal(unit.root.userData.healthFill.material.color.getHex(THREE.SRGBColorSpace), 0x00aaff);
    } finally {
        removeMapUnitVisual(renderer, unit);
        disposeMapUnitAssets(assets);
    }
    assert.equal(sceneRoots.length, 0);
});

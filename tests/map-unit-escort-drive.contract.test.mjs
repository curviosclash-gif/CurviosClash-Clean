import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';
import { steerUnitAlongPath } from '../src/entities/systems/map-units/MapUnitDriveOps.js';
import { resolveUnitPathPose } from '../src/entities/systems/map-units/MapUnitMovementOps.js';
import { normalizeMapUnit } from '../src/shared/contracts/MapUnitContract.js';
import { EIFFEL_SIEGE_VAULT_BOSS } from '../src/core/config/maps/presets/eiffel_tower_siege/EiffelTowerSiegeTanks.js';
import { createGameModeStrategy } from '../src/modes/GameModeRegistry.js';
import { GAME_MODE_TYPES } from '../src/hunt/HuntMode.js';
import { TEAM_IDS } from '../src/shared/contracts/TeamCombatContract.js';

const VAULT_HALF = 20;

/** Builds a driving unit the way MapUnitSystem does, without needing a renderer or a map. */
function buildUnit(source, scale = 1) {
    const definition = normalizeMapUnit(source, 0, undefined, { preserveSpatial: true });
    const unit = {
        definition,
        scale,
        path: definition.path.map((point) => point.map((value) => value * scale)),
        speed: definition.speed * scale,
        hitboxRadius: definition.hitboxRadius * scale,
        fromIndex: 0,
        toIndex: 1,
        progress: 0,
        yaw: 0,
        drivenY: null,
        chaseBlockedUntilIndex: -1,
        groundPosition: new THREE.Vector3(),
    };
    unit.yaw = resolveUnitPathPose(unit, unit.path, unit.groundPosition) ?? 0;
    return unit;
}

/** The furthest the unit ever got from the middle of its path, measured on the ground plane. */
function widestReach(unit, seconds) {
    let worst = 0;
    for (let step = 0; step < Math.round(seconds * 60); step += 1) {
        steerUnitAlongPath(unit, 1 / 60);
        worst = Math.max(worst, Math.abs(unit.groundPosition.x), Math.abs(unit.groundPosition.z));
    }
    return worst;
}

test('a steering unit turns inside its path, not around it', () => {
    // A square 40 wide driven at 24 a second: the turning radius alone is almost ten units. A unit
    // that starts its turn only at the corner swings out to 27; starting a turning radius early
    // keeps it at 20.2, which is the square itself plus rounding.
    const unit = buildUnit({
        id: 'fast', kind: 'tank', loop: true, speed: 24,
        path: [[-20, 0, -20], [20, 0, -20], [20, 0, 20], [-20, 0, 20]],
    });
    const worst = widestReach(unit, 40);
    assert.ok(worst <= 21, `the driven track stays inside the authored square, reached ${worst}`);
});

test('the vault boss keeps its hull off the vault walls', () => {
    const boss = buildUnit(EIFFEL_SIEGE_VAULT_BOSS, 3);
    const reach = widestReach(boss, 120) + boss.hitboxRadius;
    assert.ok(reach < VAULT_HALF * 3, `the boss must stay in its room, reached ${reach} of ${VAULT_HALF * 3}`);
});

test('a slow unit still uses its authored waypoint reach', () => {
    const unit = buildUnit({
        id: 'slow', kind: 'tank', loop: true, speed: 1,
        path: [[-20, 0, -20], [20, 0, -20], [20, 0, 20], [-20, 0, 20]],
    });
    const worst = widestReach(unit, 60);
    assert.ok(worst > 19, `a crawling unit drives its corners out, reached ${worst}`);
    assert.ok(worst <= 20.001, 'and still stays inside them');
});

test('the escort tank drives its whole route and arrives in the authored window', () => {
    const alpha = { index: 0, teamId: TEAM_IDS.ALPHA, alive: true, position: new THREE.Vector3(-1000, 2, -1000) };
    const manager = {
        gameModeStrategy: createGameModeStrategy(GAME_MODE_TYPES.ESCORT),
        arena: {
            bounds: { minX: -100, maxX: 100, minY: 0, maxY: 80, minZ: -100, maxZ: 100 },
            currentMapDefinition: {},
        },
        players: [alpha],
        _targetableRegistry: { collect: () => [] },
        _simulationClockMs: 1000,
    };
    const system = new MapUnitSystem(manager);
    system.startRound();
    const tank = system.units[0];

    let seconds = 0;
    while (!tank.escortReachedGoal && seconds < 400) {
        system.update(1 / 60);
        seconds += 1 / 60;
    }
    assert.equal(tank.escortReachedGoal, true, 'the tank reached its destination');
    assert.ok(seconds > 150 && seconds < 210, `unescorted the run takes about three minutes, took ${seconds}`);
    assert.ok(
        Math.abs(tank.groundPosition.x) <= 100 && Math.abs(tank.groundPosition.z) <= 100,
        'it never drove out of the arena on its way',
    );
});

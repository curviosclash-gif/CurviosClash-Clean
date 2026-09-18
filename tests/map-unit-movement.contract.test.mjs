import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
    advanceUnitOnPath,
    resetUnitOnPath,
    resolveUnitPathPose,
    turnYawTowards,
} from '../src/entities/systems/map-units/MapUnitMovementOps.js';
import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';
import { createEntityRuntimeSystems } from '../src/entities/runtime/EntityRuntimeSystemAssembly.js';

const SQUARE = [[0, 0, 0], [10, 0, 0], [10, 0, 10], [0, 0, 10]];

function driveTo(path, distance, loop) {
    const unit = {};
    resetUnitOnPath(unit);
    advanceUnitOnPath(unit, path, distance, loop);
    const position = new THREE.Vector3();
    const yaw = resolveUnitPathPose(unit, path, position);
    return { unit, position, yaw };
}

test('a looping path closes from the last point back to the first', () => {
    assert.deepEqual(driveTo(SQUARE, 5, true).position.toArray(), [5, 0, 0]);
    assert.deepEqual(driveTo(SQUARE, 15, true).position.toArray(), [10, 0, 5]);
    assert.deepEqual(driveTo(SQUARE, 35, true).position.toArray(), [0, 0, 5], 'the fourth side runs back to the start');
    assert.deepEqual(driveTo(SQUARE, 40, true).position.toArray(), [0, 0, 0], 'one full lap ends on the start');
    assert.deepEqual(driveTo(SQUARE, 45, true).position.toArray(), [5, 0, 0], 'and the next lap begins');
});

test('an open path turns around at both ends', () => {
    const line = [[0, 0, 0], [10, 0, 0], [20, 0, 0]];
    assert.deepEqual(driveTo(line, 25, false).position.toArray(), [15, 0, 0], 'drives back from the far end');
    assert.deepEqual(driveTo(line, 45, false).position.toArray(), [5, 0, 0], 'turns again at the start');
});

test('the pose follows the segment heading and height', () => {
    const ramp = [[0, 0, 0], [0, 6, 8]];
    const { position, yaw } = driveTo(ramp, 5, false);
    assert.deepEqual(position.toArray().map((value) => Math.round(value * 1000) / 1000), [0, 3, 4]);
    assert.equal(yaw, 0, 'driving towards +Z is yaw 0');
    assert.equal(Math.round(driveTo(SQUARE, 5, true).yaw * 1000) / 1000, Math.round((Math.PI / 2) * 1000) / 1000);
});

test('zero length segments and huge steps do not hang', () => {
    const stuck = [[1, 1, 1], [1, 1, 1], [1, 1, 1]];
    const { position } = driveTo(stuck, 1000, true);
    assert.deepEqual(position.toArray(), [1, 1, 1]);
    assert.deepEqual(driveTo(SQUARE, 40 * 3 + 5, true).position.toArray(), [5, 0, 0]);
});

test('the hull turns towards the new heading along the shorter way', () => {
    assert.equal(turnYawTowards(0, 1, 0.25), 0.25);
    assert.equal(turnYawTowards(0, 0.1, 0.25), 0.1);
    assert.ok(turnYawTowards(3, -3, 0.2) > 3, 'crosses +PI instead of turning the long way round');
    assert.equal(turnYawTowards(1, null, 0.5), 1);
});

function createOwner({ modeType = 'HUNT', mapUnits = [] } = {}) {
    const scene = new Set();
    return {
        scene,
        owner: {
            gameModeStrategy: { modeType, getPickupModeType: () => modeType },
            arena: { currentMapDefinition: { mapUnits } },
            renderer: {
                addToScene: (object) => scene.add(object),
                removeFromScene: (object) => scene.delete(object),
            },
        },
    };
}

const PATROL = { id: 'patrol', path: [[0, 0, 0], [24, 0, 0]], speed: 12, allowedModes: ['HUNT'] };

test('a round builds the tanks of the map for allowed modes only', () => {
    const hunt = createOwner({ mapUnits: [PATROL] });
    const system = new MapUnitSystem(hunt.owner);
    assert.equal(system.startRound(), 1);
    assert.equal(hunt.scene.size, 1, 'the tank model is in the scene');
    assert.equal(system.units[0].hp, 150);
    assert.equal(system.units[0].position.y > 0, true, 'weapons aim at the turret, above the ground');

    const classic = createOwner({ modeType: 'CLASSIC', mapUnits: [PATROL] });
    assert.equal(new MapUnitSystem(classic.owner).startRound(), 0, 'classic has no tanks');
});

test('the runtime assembly publishes the map unit system', () => {
    const owner = { players: [], runtimeConfig: {} };
    const systems = createEntityRuntimeSystems(owner, {}, null);
    assert.equal(owner._mapUnitSystem, systems.mapUnitSystem);
    assert.equal(systems.mapUnitSystem instanceof MapUnitSystem, true);
});

test('tanks drive every tick and a new round starts them at the path start', () => {
    const { owner, scene } = createOwner({ mapUnits: [PATROL] });
    const system = new MapUnitSystem(owner);
    owner._mapUnitSystem = system;
    system.startRound();

    system.update(1);
    assert.equal(system.units[0].groundPosition.x, 12, 'speed 12 drives 12 units in a second');
    assert.equal(system.units[0].root.position.x, 12, 'the model follows');

    system.startRound();
    assert.equal(system.units[0].groundPosition.x, 0);
    assert.equal(scene.size, 1, 'the old model left the scene');

    system.clear();
    assert.equal(scene.size, 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { normalizeMapUnit } from '../src/shared/contracts/MapUnitContract.js';
import { applyGroundClamp } from '../src/entities/systems/map-units/MapUnitGroundOps.js';

/** An arena whose only geometry is an endless floor at `y`. */
function arenaWithFloorAt(y) {
    const result = { hit: false, distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0) };
    return {
        calls: 0,
        raycast(origin, direction, maxDistance) {
            this.calls += 1;
            const distance = origin.y - y;
            result.hit = direction.y < 0 && distance >= 0 && distance <= maxDistance;
            result.distance = distance;
            result.point.set(origin.x, y, origin.z);
            return result;
        },
    };
}

function tankAt(y, drive = undefined) {
    const definition = normalizeMapUnit(
        { id: 'probe', kind: 'tank', path: [[0, y, 0], [40, y, 0]], ...(drive ? { drive } : {}) },
        0,
        undefined,
        { preserveSpatial: true },
    );
    return { definition, scale: 1, kind: 'tank', groundPosition: new THREE.Vector3(0, y, 0) };
}

test('a tank sinks onto the floor under its waypoint', () => {
    const arena = arenaWithFloorAt(0);
    const unit = tankAt(6);
    for (let step = 0; step < 120; step += 1) applyGroundClamp(arena, unit, 1 / 60);
    assert.equal(unit.groundPosition.y, 0);
});

test('the fall is limited per tick, so an edge is not a jump', () => {
    const arena = arenaWithFloorAt(0);
    const unit = tankAt(6);
    applyGroundClamp(arena, unit, 1 / 60);
    assert.ok(unit.groundPosition.y > 0, 'one tick must not teleport the hull down');
    assert.ok(unit.groundPosition.y < 6, 'one tick must move the hull down');
});

test('groundClamp false keeps the authored height', () => {
    const arena = arenaWithFloorAt(0);
    const unit = tankAt(6, { groundClamp: false });
    for (let step = 0; step < 120; step += 1) applyGroundClamp(arena, unit, 1 / 60);
    assert.equal(unit.groundPosition.y, 6);
    assert.equal(arena.calls, 0, 'a switched off clamp must not cost a ray');
});

test('without a floor in reach the authored height stays', () => {
    const arena = arenaWithFloorAt(-500);
    const unit = tankAt(6);
    for (let step = 0; step < 120; step += 1) applyGroundClamp(arena, unit, 1 / 60);
    assert.equal(unit.groundPosition.y, 6);
});

test('a floor above the hull lifts it, so a ramp is driven up', () => {
    const arena = arenaWithFloorAt(3);
    const unit = tankAt(0);
    for (let step = 0; step < 120; step += 1) applyGroundClamp(arena, unit, 1 / 60);
    assert.equal(unit.groundPosition.y, 3);
});

test('map scale grows the probe, so a scaled map still finds its floor', () => {
    const arena = arenaWithFloorAt(0);
    const unit = tankAt(9);
    unit.scale = 3;
    for (let step = 0; step < 240; step += 1) applyGroundClamp(arena, unit, 1 / 60);
    assert.equal(unit.groundPosition.y, 0);
});

test('only ground kinds carry a drive block', () => {
    const tank = normalizeMapUnit({ id: 't', kind: 'tank', path: [[0, 0, 0], [10, 0, 0]] });
    const boss = normalizeMapUnit({ id: 'b', kind: 'boss', path: [[0, 0, 0], [10, 0, 0]] });
    const swarm = normalizeMapUnit({ id: 's', kind: 'swarm', path: [[0, 0, 0], [10, 0, 0]] });
    const bomber = normalizeMapUnit({ id: 'f', kind: 'bomber', path: [[0, 0, 0], [10, 0, 0]] });
    assert.equal(tank?.drive?.groundClamp, true);
    assert.equal(boss?.drive?.groundClamp, true);
    assert.equal(swarm?.drive, null);
    assert.equal(bomber?.drive, null);
});

test('the running system clamps its tanks and forgets the height on respawn', async () => {
    const { MapUnitSystem } = await import('../src/entities/systems/MapUnitSystem.js');
    const floor = arenaWithFloorAt(0);
    const scene = new Set();
    const owner = {
        gameModeStrategy: { modeType: 'HUNT', getPickupModeType: () => 'HUNT' },
        arena: {
            currentMapDefinition: { mapUnits: [{ id: 'patrol', path: [[0, 5, 0], [240, 5, 0]], allowedModes: ['HUNT'] }] },
            raycast: (origin, direction, maxDistance) => floor.raycast(origin, direction, maxDistance),
        },
        renderer: { addToScene: (object) => scene.add(object), removeFromScene: (object) => scene.delete(object) },
    };
    const system = new MapUnitSystem(owner);
    system.startRound();
    for (let step = 0; step < 120; step += 1) system.update(1 / 60);
    assert.equal(system.units[0].groundPosition.y, 0, 'the tank drives on the floor, not above it');

    system.startRound();
    assert.equal(system.units[0].drivenY, null, 'a new round starts from the authored path');
});

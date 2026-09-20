import assert from 'node:assert/strict';
import test from 'node:test';

import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';

const CORNER_PATH = [[0, 0, 0], [60, 0, 0], [60, 0, 60]];

function createOwner({ path = CORNER_PATH, loop = false, drive = undefined } = {}) {
    const scene = new Set();
    return {
        scene,
        owner: {
            gameModeStrategy: { modeType: 'HUNT', getPickupModeType: () => 'HUNT' },
            arena: {
                currentMapDefinition: {
                    mapUnits: [{ id: 'patrol', path, loop, allowedModes: ['HUNT'], ...(drive ? { drive } : {}) }],
                },
            },
            renderer: { addToScene: (object) => scene.add(object), removeFromScene: (object) => scene.delete(object) },
        },
    };
}

test('the hull always drives where it points', () => {
    const { owner } = createOwner();
    const system = new MapUnitSystem(owner);
    system.startRound();
    const unit = system.units[0];
    let worstDot = 1;
    let previous = unit.groundPosition.clone();
    for (let step = 0; step < 600; step += 1) {
        system.update(1 / 60);
        const moved = unit.groundPosition.clone().sub(previous);
        previous = unit.groundPosition.clone();
        if (moved.lengthSq() < 1e-8) continue;
        moved.normalize();
        const facing = { x: Math.sin(unit.yaw), z: Math.cos(unit.yaw) };
        worstDot = Math.min(worstDot, moved.x * facing.x + moved.z * facing.z);
    }
    assert.ok(worstDot > 0.999, `hull and course must agree, worst dot was ${worstDot}`);
});

test('without steering the hull still lags behind the course at a corner', () => {
    const { owner } = createOwner({ drive: { steering: false } });
    const system = new MapUnitSystem(owner);
    system.startRound();
    const unit = system.units[0];
    let worstDot = 1;
    let previous = unit.groundPosition.clone();
    for (let step = 0; step < 600; step += 1) {
        system.update(1 / 60);
        const moved = unit.groundPosition.clone().sub(previous);
        previous = unit.groundPosition.clone();
        if (moved.lengthSq() < 1e-8) continue;
        moved.normalize();
        worstDot = Math.min(worstDot, moved.x * Math.sin(unit.yaw) + moved.z * Math.cos(unit.yaw));
    }
    assert.ok(worstDot < 0.9, 'the old behaviour is kept when a map asks for it');
});

test('a steering tank drives a straight leg at its plain speed', () => {
    const { owner } = createOwner({ path: [[0, 0, 0], [240, 0, 0]] });
    const system = new MapUnitSystem(owner);
    system.startRound();
    for (let step = 0; step < 60; step += 1) system.update(1 / 60);
    assert.ok(Math.abs(system.units[0].groundPosition.x - 12) < 0.001, 'speed 12 drives 12 units in a second');
});

test('a steering tank still works its way through every waypoint', () => {
    const { owner } = createOwner({ loop: true });
    const system = new MapUnitSystem(owner);
    system.startRound();
    const seen = new Set();
    for (let step = 0; step < 3600; step += 1) {
        system.update(1 / 60);
        seen.add(system.units[0].fromIndex);
    }
    assert.deepEqual([...seen].sort(), [0, 1, 2], 'a closed circuit visits all three corners');
});

test('waypoints closer together than the reach do not spin the unit', () => {
    const { owner } = createOwner({ path: [[0, 0, 0], [0.5, 0, 0], [1, 0, 0], [40, 0, 0]] });
    const system = new MapUnitSystem(owner);
    system.startRound();
    for (let step = 0; step < 120; step += 1) system.update(1 / 60);
    assert.ok(Number.isFinite(system.units[0].groundPosition.x), 'the unit is still on the map');
    assert.ok(system.units[0].groundPosition.x > 20, 'it drove past the crowded start instead of circling in it');
});

test('a steering unit sends its position, a path bound one does not', async () => {
    const { serializeMapUnits } = await import('../src/entities/systems/map-units/MapUnitNetworkOps.js');
    const steering = new MapUnitSystem(createOwner().owner);
    steering.startRound();
    steering.update(1);
    const [entry] = serializeMapUnits(steering.units);
    assert.ok(Array.isArray(entry.gpos), 'a steering tank cannot be rebuilt from a path index alone');

    const legacy = new MapUnitSystem(createOwner({ drive: { steering: false } }).owner);
    legacy.startRound();
    legacy.update(1);
    assert.equal(serializeMapUnits(legacy.units)[0].gpos, undefined, 'the old block stays as small as it was');
});

test('a client lands on the position the host sent', async () => {
    const { serializeMapUnits } = await import('../src/entities/systems/map-units/MapUnitNetworkOps.js');
    const host = new MapUnitSystem(createOwner({ loop: true }).owner);
    host.startRound();
    const client = new MapUnitSystem(createOwner({ loop: true }).owner);
    client.startRound();
    client.setNetworkReplica(true);

    for (let step = 0; step < 300; step += 1) host.update(1 / 60);
    client.update(0.5);
    client.applyNetworkState(serializeMapUnits(host.units));

    assert.ok(
        client.units[0].groundPosition.distanceTo(host.units[0].groundPosition) < 0.01,
        'the snapshot is the truth on the client',
    );
});

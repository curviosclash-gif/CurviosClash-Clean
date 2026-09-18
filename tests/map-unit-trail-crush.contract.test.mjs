import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';
import { crushTrailsUnderUnit } from '../src/entities/systems/map-units/MapUnitTrailOps.js';

function segment(playerIndex, from, to, radius = 0.4) {
    return {
        playerIndex,
        fromX: from[0], fromY: from[1], fromZ: from[2],
        toX: to[0], toY: to[1], toZ: to[2],
        radius,
        destroyed: false,
    };
}

function createTrails(segments) {
    return {
        segments,
        collectSegmentsInArea(minX, minZ, maxX, maxZ, out) {
            out.length = 0;
            for (const entry of this.segments) {
                if (entry.destroyed) continue;
                const lowX = Math.min(entry.fromX, entry.toX);
                const highX = Math.max(entry.fromX, entry.toX);
                const lowZ = Math.min(entry.fromZ, entry.toZ);
                const highZ = Math.max(entry.fromZ, entry.toZ);
                if (highX < minX || lowX > maxX || highZ < minZ || lowZ > maxZ) continue;
                out.push(entry);
            }
            return out;
        },
        destroySegment(entry) {
            entry.destroyed = true;
            return true;
        },
    };
}

function createUnit(position = [0, 2.1, 0]) {
    const unit = {
        hitboxRadius: 3.5,
        position: new THREE.Vector3(...position),
        damage: [],
        takeDamage(amount, options) {
            this.damage.push({ amount, source: options.sourcePlayer, cause: options.cause });
        },
    };
    return unit;
}

test('trail pieces reaching into the tank vanish and the tank takes 10 damage per second', () => {
    const owner = { index: 3 };
    const wall = segment(3, [-10, 3, 0], [10, 3, 0]);
    const high = segment(3, [-10, 40, 0], [10, 40, 0]);
    const far = segment(3, [-10, 3, 30], [10, 3, 30]);
    const trails = createTrails([wall, high, far]);
    const unit = createUnit();

    const crushed = crushTrailsUnderUnit({ getTrailSpatialIndex: () => trails, players: [owner] }, unit, 0.5, []);

    assert.equal(crushed, 1);
    assert.equal(wall.destroyed, true, 'a low trail across the path is crushed');
    assert.equal(high.destroyed, false, 'a trail high above stays');
    assert.equal(far.destroyed, false, 'a trail further along stays for now');
    assert.deepEqual(unit.damage, [{ amount: 5, source: owner, cause: 'TRAIL_CRUSH' }], 'half a second at 10 per second, credited to the trail owner');
});

test('no contact, no damage, and a missing trail index is harmless', () => {
    const unit = createUnit();
    assert.equal(crushTrailsUnderUnit({ getTrailSpatialIndex: () => createTrails([]), players: [] }, unit, 1, []), 0);
    assert.equal(crushTrailsUnderUnit({}, unit, 1, []), 0);
    assert.deepEqual(unit.damage, []);
});

test('a driving tank grinds through a trail wall across its path', () => {
    const wall = segment(0, [-20, 1, 12], [20, 1, 12]);
    const trails = createTrails([wall]);
    const manager = {
        gameModeStrategy: { modeType: 'HUNT', getPickupModeType: () => 'HUNT' },
        arena: {
            checkCollisionFast: () => false,
            currentMapDefinition: { mapUnits: [{ id: 't', path: [[0, 0, 0], [0, 0, 100]], weapons: { mg: false, rocket: false } }] },
        },
        players: [],
        humanPlayers: [],
        getTrailSpatialIndex: () => trails,
    };
    const system = new MapUnitSystem(manager);
    system.startRound();
    system.update(0.5);
    assert.equal(wall.destroyed, false, 'still 6 units short of the wall edge');
    for (let i = 0; i < 10; i += 1) system.update(0.1);
    assert.equal(wall.destroyed, true);
    assert.equal(system.units[0].hp < 150, true, 'the tank paid for it');

    const replicaTrails = createTrails([segment(0, [-20, 1, 2], [20, 1, 2])]);
    const replica = new MapUnitSystem({ ...manager, getTrailSpatialIndex: () => replicaTrails });
    replica.setNetworkReplica(true);
    replica.startRound();
    replica.update(0.1);
    assert.equal(replicaTrails.segments[0].destroyed, false, 'only the host crushes trails');
});

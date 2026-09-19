import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { normalizeMapUnits } from '../src/shared/contracts/MapUnitContract.js';
import { normalizeSecretRooms } from '../src/shared/contracts/SecretRoomContract.js';

const MAP = MAP_PRESET_CATALOG.eiffel_tower_siege;
const ROOM = normalizeSecretRooms(MAP.secretRooms)[0];

test('the Eiffel vault pairs its boss with one eight-drone swarm', () => {
    const swarms = normalizeMapUnits(MAP.mapUnits).filter((unit) => unit.kind === 'swarm');
    assert.equal(swarms.length, 1);
    const [swarm] = swarms;

    assert.equal(swarm.memberCount, 8);
    assert.equal(swarm.respawnSeconds, 20);
    assert.deepEqual(swarm.allowedModes, ['HUNT', 'ARCADE']);
});

test('the vault swarm path and formation stay inside the room', () => {
    const [swarm] = normalizeMapUnits(MAP.mapUnits).filter((unit) => unit.kind === 'swarm');
    const clearance = swarm.formationRadius + swarm.hitboxRadius;

    for (const point of swarm.path) {
        assert.ok(point[0] >= ROOM.bounds.min[0] + clearance && point[0] <= ROOM.bounds.max[0] - clearance);
        assert.ok(point[2] >= ROOM.bounds.min[2] + clearance && point[2] <= ROOM.bounds.max[2] - clearance);
        assert.ok(point[1] >= ROOM.bounds.min[1] + swarm.hitboxRadius);
        assert.ok(point[1] <= ROOM.bounds.max[1] - swarm.hitboxRadius);
    }
});

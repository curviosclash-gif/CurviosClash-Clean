import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { getPickupSpawnWeight, isPickupTypeAllowedForMode } from '../src/shared/contracts/PickupRegistryContract.js';
import { isPointInSecretRoom, normalizeSecretRooms } from '../src/shared/contracts/SecretRoomContract.js';

// User decision 28.09.2026: every secret room hands out one bomber strike and one lightning at a
// fixed point, on top of what the room offered before.
const PRIZES = Object.freeze(['BOMBER_STRIKE', 'LIGHTNING']);
// Map units. Closer than this and one pickup hides the other, or the way back hides a prize.
const MIN_GAP = 4;

const ROOMS = Object.entries(MAP_PRESET_CATALOG).flatMap(([mapKey, map]) => (
    normalizeSecretRooms(map?.secretRooms).map((room) => ({ mapKey, room }))
));

function distance(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

test('every map with a secret room is covered', () => {
    const maps = new Set(ROOMS.map((entry) => entry.mapKey));
    for (const mapKey of ['reactor_site', 'eiffel_tower_siege', 'dandelion_sky', 'storm_lighthouse_siege', 'storm_dam_siege', 'storm_bridge_siege']) {
        assert.ok(maps.has(mapKey), `${mapKey} lost its secret room`);
    }
});

for (const { mapKey, room } of ROOMS) {
    test(`${mapKey}/${room.id}: one fixed bomber strike and one fixed lightning`, () => {
        for (const type of PRIZES) {
            const points = room.items.filter((item) => item.type === type);
            assert.equal(points.length, 1, `${type}: ${points.length} fixed points`);
            assert.ok(isPointInSecretRoom(room, points[0].pos), `${type} lies outside the room`);
            // A type the mode cannot spawn silently turns into a random draw at runtime
            // (SecretRoomRefillOps), so the prize only holds where every room mode allows it.
            for (const mode of room.modes) {
                assert.ok(isPickupTypeAllowedForMode(type, mode), `${type} is not allowed in ${mode}`);
                assert.ok(getPickupSpawnWeight(type, mode) > 0, `${type} never spawns in ${mode}`);
            }
            assert.ok(distance(points[0].pos, room.roomPortal.pos) >= MIN_GAP, `${type} sits on the way back`);
        }
    });

    test(`${mapKey}/${room.id}: no two item points share a spot`, () => {
        for (let a = 0; a < room.items.length; a += 1) {
            for (let b = a + 1; b < room.items.length; b += 1) {
                const gap = distance(room.items[a].pos, room.items[b].pos);
                assert.ok(gap >= MIN_GAP, `items ${a} and ${b} stand ${gap.toFixed(1)} apart`);
            }
        }
    });
}

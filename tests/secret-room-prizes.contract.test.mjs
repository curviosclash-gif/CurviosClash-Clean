import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { normalizeMapSchemaDocument } from '../src/entities/mapSchema/MapSchemaSanitizeOps.js';
import { toArenaMapDefinition } from '../src/entities/mapSchema/MapSchemaRuntimeOps.js';
import { createSecretRoomItemPoints } from '../src/entities/powerup/SecretRoomRefillOps.js';
import { getPickupSpawnWeight, isPickupTypeAllowedForMode } from '../src/shared/contracts/PickupRegistryContract.js';
import { isPointInSecretRoom, normalizeSecretRooms } from '../src/shared/contracts/SecretRoomContract.js';

// Secret rooms carry fixed bomber and lightning prizes except reactor_site, where they now live
// in the flyable reactor room and are tied to the containment break.
const PRIZES = Object.freeze(['BOMBER_STRIKE', 'LIGHTNING']);
const ENLARGED_ROOMS = {
    reactor_site: { height: 24, items: 44 },
    eiffel_tower_siege: { height: 24, items: 24 },
    dandelion_sky: { height: 28, items: 24 },
    storm_lighthouse_siege: { height: 24, items: 22 },
    storm_dam_siege: { height: 24, items: 22 },
    storm_bridge_siege: { height: 24, items: 22 },
};
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
    test(`${mapKey}/${room.id}: doubled height and item stock survive loading and world scaling`, () => {
        const expected = ENLARGED_ROOMS[mapKey];
        assert.ok(expected, `${mapKey} has no room-size expectation`);
        assert.equal(room.bounds.max[1] - room.bounds.min[1], expected.height);
        assert.equal(room.items.length, expected.items);
        for (const item of room.items) {
            assert.ok(isPointInSecretRoom(room, item.pos), `item ${item.pos} lies outside the room`);
        }

        const document = normalizeMapSchemaDocument({ secretRooms: [room] });
        const mapScale = 3;
        const runtime = toArenaMapDefinition(document, { mapScale });
        const loadedRoom = normalizeSecretRooms(runtime.map.secretRooms)[0];
        assert.equal(loadedRoom.items.length, expected.items, 'loading must keep every item point');
        const loadedHeight = (loadedRoom.bounds.max[1] - loadedRoom.bounds.min[1]) * mapScale;
        assert.ok(Math.abs(loadedHeight - expected.height) < 1e-6,
            'loading must keep the enlarged playable height');
        const points = createSecretRoomItemPoints(loadedRoom, mapScale);
        assert.equal(points.positions.length, expected.items);
        for (let index = 0; index < room.items.length; index += 1) {
            assert.ok(distance(points.positions[index], room.items[index].pos) < 1e-6,
                `item ${index} moved during loading`);
        }
        assert.deepEqual(points.authoredTypes, room.items.map((item) => item.type || ''));
        assert.equal(new Set(points.ownerIds).size, expected.items, 'every point needs its own refill owner');
    });

    test(`${mapKey}/${room.id}: prize ownership matches its map contract`, () => {
        if (mapKey === 'reactor_site') {
            const map = MAP_PRESET_CATALOG[mapKey];
            assert.deepEqual(map.mapOwnedPickups.map((entry) => entry.pickupType), PRIZES);
            assert.ok(map.mapOwnedPickups.every((entry) => entry.despawnOnBreakSegment === 'reactor_dome'));
            assert.equal(room.items.filter((item) => PRIZES.includes(item.type)).length, 0);
            return;
        }
        for (const type of PRIZES) {
            const points = room.items.filter((item) => item.type === type);
            assert.equal(points.length, 2, `${type}: ${points.length} fixed points`);
            for (const point of points) {
                assert.ok(isPointInSecretRoom(room, point.pos), `${type} lies outside the room`);
                assert.ok(distance(point.pos, room.roomPortal.pos) >= MIN_GAP, `${type} sits on the way back`);
            }
            // A type the mode cannot spawn silently turns into a random draw at runtime
            // (SecretRoomRefillOps), so the prize only holds where every room mode allows it.
            for (const mode of room.modes) {
                assert.ok(isPickupTypeAllowedForMode(type, mode), `${type} is not allowed in ${mode}`);
                assert.ok(getPickupSpawnWeight(type, mode) > 0, `${type} never spawns in ${mode}`);
            }
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

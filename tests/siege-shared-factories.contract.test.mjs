import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';

const STORM_SIEGE_IDS = ['storm_bridge_siege', 'storm_lighthouse_siege', 'storm_dam_siege'];

for (const id of STORM_SIEGE_IDS) {
    test(`${id}: landmark frame and vault stay consistent`, () => {
        const map = MAP_PRESET_CATALOG[id];
        const [sx, , sz] = map.size;
        const foam = map.obstacles.find((box) => box.kind === 'foam');
        assert.deepEqual(foam.size, [sx, 4, sz], 'the foam floor covers the whole field');
        assert.equal(map.singlePlayerScenario.id, id);

        const [segment] = map.destructibles.segments;
        assert.equal(map.destructibles.hudNoun, segment.label);
        assert.equal(map.destructibles.breakScenes[0].trigger.segmentId, segment.id);

        const [room] = map.secretRooms;
        assert.equal(room.unlock.destructible.startsWith('storm_'), true);
        const { min, max } = room.bounds;
        assert.equal(room.items.length, 22, 'eleven pickups on two floors');
        for (const { pos } of room.items) {
            pos.forEach((value, axis) => {
                assert.ok(value > min[axis] && value < max[axis], `${id} vault item ${pos} inside the room`);
            });
        }
        assert.equal(map.obstacles.filter((box) => box.renderWithGlb).length, 6, 'six shell boxes');
    });
}

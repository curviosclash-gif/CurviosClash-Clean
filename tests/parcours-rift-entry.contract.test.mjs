import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';

// Roughly one ship width in authored units once the map scale is applied.
const SHIP_MARGIN = 1;

function segmentHitsBox(from, to, min, max) {
    let enter = 0;
    let exit = 1;
    for (let axis = 0; axis < 3; axis += 1) {
        const delta = to[axis] - from[axis];
        if (Math.abs(delta) < 1e-9) {
            if (from[axis] < min[axis] || from[axis] > max[axis]) return false;
            continue;
        }
        let near = (min[axis] - from[axis]) / delta;
        let far = (max[axis] - from[axis]) / delta;
        if (near > far) [near, far] = [far, near];
        enter = Math.max(enter, near);
        exit = Math.min(exit, far);
        if (enter > exit) return false;
    }
    return true;
}

function blockingObstacles(mapDef, fromId, toId) {
    const checkpoints = mapDef.parcours.checkpoints;
    const from = checkpoints.find((entry) => entry.id === fromId).pos;
    const to = checkpoints.find((entry) => entry.id === toId).pos;
    return mapDef.obstacles.filter((obstacle) => {
        if (obstacle.shape === 'tube' || obstacle.tunnel) return false;
        const min = obstacle.pos.map((value, axis) => value - obstacle.size[axis] / 2 - SHIP_MARGIN);
        const max = obstacle.pos.map((value, axis) => value + obstacle.size[axis] / 2 + SHIP_MARGIN);
        return segmentHitsBox(from, to, min, max);
    });
}

for (const mapKey of ['parcours_rift', 'parcours_rift_sprint', 'parcours_rift_precision']) {
    test(`${mapKey}: the first ring does not lead straight into a wall`, () => {
        const mapDef = MAP_PRESET_CATALOG[mapKey];
        assert.ok(mapDef?.parcours?.enabled, `${mapKey} is a parcours map`);
        // The first sector of an arcade run starts here; a ship that follows the ring must survive.
        assert.deepEqual(blockingObstacles(mapDef, 'CP01', 'CP02'), []);
    });
}

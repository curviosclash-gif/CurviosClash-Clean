import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
import { sphereIntersectsStaticMeshCollider } from '../src/entities/arena/StaticMeshCollider.js';
import { analyzeMapAnchors } from './helpers/map-anchor-guard.mjs';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

// toybox_titan and hydra_temple used to name no item anchors, so every pickup was a random roll.
// Both keep their scene as one GLB the anchor guard cannot see into, so this test loads the
// colliders the arena would use and tries every anchor against them. The scene and the anchors of
// these maps are both in map units here (scaleAuthoredAnchors), so no scale is applied.

const CLEARANCE = 2;
const EDGE_MARGIN = 6;
const MIN_ANCHORS = 4;
const MAX_ANCHORS = 8;
// MapUnitHydraOps.snapHit: the bite starts 5.5 out, runs 4 further and is 1.6 wide, in unit
// scale, which is the map scale; one more unit stands for the pilot's own radius.
const HYDRA_BITE_REACH = 5.5 + 4 + 1.6 + 1;

const anchorOf = (entry) => [Number(entry.pos[0]), Number(entry.pos[1]), Number(entry.pos[2])];

for (const mapKey of ['toybox_titan', 'hydra_temple']) {
    const map = MAP_PRESET_CATALOG[mapKey];

    test(`${mapKey} names ${MIN_ANCHORS} to ${MAX_ANCHORS} item anchors in free space`, async () => {
        assert.equal(map.scaleAuthoredAnchors, true, 'anchors below are written in map units');
        assert.ok(Array.isArray(map.items), `${mapKey} has an items list`);
        assert.ok(map.items.length >= MIN_ANCHORS && map.items.length <= MAX_ANCHORS,
            `${mapKey} has ${map.items.length} anchors`);
        assert.equal(analyzeMapAnchors(mapKey, map, 3).filter((violation) => violation.point.startsWith('items')).length, 0);

        const loaded = await loadGLBMapCollection(map.glbModels, {
            loader: geometryOnlyGlbLoader, colliderMode: 'scene', requireComplete: true,
        });
        try {
            const seen = new Set();
            for (const entry of map.items) {
                const [x, y, z] = anchorOf(entry);
                assert.ok(![x, y, z].some(Number.isNaN), 'an anchor has numeric coordinates');
                assert.ok(!seen.has(`${x},${y},${z}`), `anchor (${x}, ${y}, ${z}) is listed twice`);
                seen.add(`${x},${y},${z}`);
                assert.ok(Math.abs(x) <= map.size[0] / 2 - EDGE_MARGIN && Math.abs(z) <= map.size[2] / 2 - EDGE_MARGIN,
                    `anchor (${x}, ${y}, ${z}) is too close to the wall`);
                assert.ok(y > 0 && y < map.size[1], `anchor (${x}, ${y}, ${z}) is outside the height range`);
                const point = new Vector3(x, y, z);
                for (const collider of loaded.colliders) {
                    assert.equal(
                        sphereIntersectsStaticMeshCollider(collider.meshCollider, point, CLEARANCE),
                        false,
                        `anchor (${x}, ${y}, ${z}) touches ${collider.sourceName || 'a collider'}`,
                    );
                }
            }
        } finally {
            loaded.scene.traverse((node) => {
                node.geometry?.dispose();
                for (const material of Array.isArray(node.material) ? node.material : [node.material]) material?.dispose();
            });
        }
    });
}

test('hydra_temple keeps every anchor out of the Hydra bite along its route', () => {
    const map = MAP_PRESET_CATALOG.hydra_temple;
    const route = map.mapUnits[0].path;
    const ring = Math.hypot(route[0][0], route[0][2]);
    for (const entry of map.items) {
        const [x, , z] = anchorOf(entry);
        // The route is a circle and the bite points in any direction: the danger zone is a band.
        assert.ok(Math.abs(Math.hypot(x, z) - ring) >= HYDRA_BITE_REACH,
            `anchor (${x}, ${z}) lies within ${HYDRA_BITE_REACH} of the Hydra route (radius ${ring})`);
    }
});

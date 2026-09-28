import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import test from 'node:test';
import { Box3, Vector3 } from 'three';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MAP_PRESETS_BASE } from '../src/core/config/maps/MapPresetsBase.js';
import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
import { sphereIntersectsStaticMeshCollider } from '../src/entities/arena/StaticMeshCollider.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

const MAP_KEY = 'toybox_titan';
const map = MAP_PRESET_CATALOG[MAP_KEY];
const GLB_URL = 'assets/maps/toybox_titan/glb/toybox_titan.glb';
const BLEND_URL = 'assets/maps/toybox_titan/blender/toybox_titan.blend';
const SPAWN_RADIUS = 44;
const CLEARANCE_RADIUS = 6;
const REQUIRED_MESH_SUBSTRINGS = ['Block', 'Teddy', 'Book'];

test('the giant nursery preset is registered with the right size, spawns and GLB reference', () => {
    assert.ok(map, `${MAP_KEY} must be registered in MAP_PRESET_CATALOG`);
    assert.equal(MAP_PRESETS_BASE[MAP_KEY], map, `${MAP_KEY} must be registered in MAP_PRESETS_BASE`);
    assert.deepEqual(map.size, [120, 40, 120]);
    assert.equal(map.glbModels.length, 1);
    assert.equal(map.glbModels[0].url, GLB_URL);
    assert.equal(map.glbColliderMode, 'scene');

    for (const spawn of [map.playerSpawn, ...map.botSpawns]) {
        assert.ok(Math.abs(Math.hypot(spawn.x, spawn.z) - SPAWN_RADIUS) < 0.001, `spawn ${JSON.stringify(spawn)} off radius`);
        assert.ok(spawn.y > 0, `spawn ${JSON.stringify(spawn)} must be above the floor`);
    }
    assert.equal(map.botSpawns.length, 3);
});

test('the GLB and its Blender source exist within the expected size budget', () => {
    assert.ok(existsSync(GLB_URL), `missing ${GLB_URL}`);
    const size = statSync(GLB_URL).size;
    assert.ok(size > 20 * 1024, `${GLB_URL} is only ${size} bytes, expected > 20 KiB`);
    assert.ok(size <= 600 * 1024, `${GLB_URL} is ${size} bytes, expected <= 600 KiB`);
    assert.ok(existsSync(BLEND_URL), `missing Blender source ${BLEND_URL}`);
});

test('the loaded scene spans the authored footprint, keeps spawns clear and carries the fixed props', async () => {
    const loaded = await loadGLBMapCollection(map.glbModels, {
        loader: geometryOnlyGlbLoader,
        colliderMode: 'scene',
        requireComplete: true,
    });
    try {
        assert.deepEqual(loaded.warnings, []);

        const bounds = new Box3().setFromObject(loaded.scene);
        const width = bounds.max.x - bounds.min.x;
        const depth = bounds.max.z - bounds.min.z;
        // Walls start at the ±60 play bounds and are 2 thick, so the shell spans 124.
        assert.ok(Math.abs(width - 124) <= 1, `world width ${width}, expected ~124`);
        assert.ok(Math.abs(depth - 124) <= 1, `world depth ${depth}, expected ~124`);

        // The loader lifts the scene so its lowest vertex sits at y=0; read the plank top back.
        const floor = loaded.scene.getObjectByName('Floor_planks_light');
        assert.ok(floor, 'expected the Floor_planks_light mesh');
        const floorTop = new Box3().setFromObject(floor).max.y;
        const spawns = [map.playerSpawn, ...map.botSpawns];
        for (const spawn of spawns) {
            assert.ok(spawn.y > floorTop + 1, `spawn ${JSON.stringify(spawn)} sits below the floor top ${floorTop}`);
            // Start just above the floor so the probe sphere never grazes the planks.
            for (let y = floorTop + CLEARANCE_RADIUS + 0.2; y <= floorTop + 12; y += 1) {
                const point = new Vector3(spawn.x, y, spawn.z);
                for (const entry of loaded.colliders) {
                    assert.equal(
                        sphereIntersectsStaticMeshCollider(entry.meshCollider, point, CLEARANCE_RADIUS),
                        false,
                        `collider ${entry.sourceName || ''} blocks spawn ${JSON.stringify(spawn)} at y=${y}`,
                    );
                }
            }
        }

        const colliderNames = loaded.colliders.map((entry) => entry.sourceName || '');
        for (const needle of REQUIRED_MESH_SUBSTRINGS) {
            assert.ok(colliderNames.some((name) => name.includes(needle)),
                `expected a collidable mesh containing "${needle}", found: ${colliderNames.join(', ')}`);
        }
    } finally {
        loaded.scene.traverse((node) => {
            node.geometry?.dispose();
            for (const material of Array.isArray(node.material) ? node.material : [node.material]) material?.dispose();
        });
    }
});

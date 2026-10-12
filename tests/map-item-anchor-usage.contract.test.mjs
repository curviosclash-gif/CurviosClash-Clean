import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { Arena } from '../src/entities/Arena.js';
import { PowerupManager } from '../src/entities/Powerup.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

// Catalog templates reach the arena unchanged (ArenaBuilder), so the pickup manager must
// read the authored anchors of a template without any editor-side mode derivation.
function explicitMode(map) {
    return String(map.itemSpawnAuthoring?.mode || map.itemSpawnMode || '').trim().toLowerCase();
}

// Anchors exactly as the arena publishes them to the pickup manager (same scaling and key handling).
function authoredAnchors(map) {
    const holder = {};
    Arena.prototype._cacheAuthoredMapAnchors.call(holder, map, 1);
    return Arena.prototype.getAuthoredItemAnchors.call(holder);
}

function spawnAll(map, spawns) {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    let randomIndex = 0;
    const anchors = authoredAnchors(map);
    const arena = {
        currentMapDefinition: map,
        getAuthoredItemAnchors: () => anchors,
        // Spread far from every authored anchor so random spawns stay distinguishable.
        getRandomPosition: () => new THREE.Vector3(1000 + 50 * randomIndex++, 10, 1000),
    };
    const manager = new PowerupManager({ addToScene() {}, removeFromScene() {} }, arena, entityRuntimeConfig);
    for (let i = 0; i < spawns; i += 1) manager._spawnRandom();
    const anchored = manager.items.filter((item) => item.anchorKey).length;
    const total = manager.items.length;
    manager.dispose();
    return { anchored, total };
}

const mapsWithAnchors = Object.entries(MAP_PRESET_CATALOG)
    .filter(([, map]) => Array.isArray(map?.items) && map.items.length > 0);

test('catalog contains maps with authored item anchors', () => {
    assert.ok(mapsWithAnchors.length > 0);
});

for (const [key, map] of mapsWithAnchors) {
    const mode = explicitMode(map);
    if (mode) {
        test(`explicit mode "${mode}" on ${key} keeps its behavior`, () => {
            const { anchored, total } = spawnAll(map, map.items.length);
            if (mode === 'fallback-random') {
                assert.equal(anchored, 0, 'fallback-random ignores anchors');
            } else if (mode === 'anchor-only') {
                assert.equal(anchored, total, 'anchor-only spawns only on anchors');
                assert.ok(anchored > 0);
            } else {
                assert.ok(anchored > 0, 'hybrid uses anchors first');
            }
        });
    } else {
        test(`${key} uses its authored item anchors without an explicit mode`, () => {
            const { anchored, total } = spawnAll(map, map.items.length);
            assert.ok(anchored > 0, `${key}: 0 of ${total} spawns used one of ${map.items.length} anchors`);
        });
    }
}

test('anchors written as pos arrays keep their own positions', () => {
    const anchors = authoredAnchors({ items: [{ pos: [-34, 6, -5] }, { x: 1, y: 2, z: 3 }, { pos: [4, 5, 6] }] });
    assert.deepEqual(anchors.map((a) => [a.x, a.y, a.z]), [[-34, 6, -5], [1, 2, 3], [4, 5, 6]]);
    // These anchors name no pickup type: the mode roll picks it, only the position is authored.
    const [first] = authoredAnchors(MAP_PRESET_CATALOG.pyramid);
    assert.deepEqual([first.x, first.y, first.z], MAP_PRESET_CATALOG.pyramid.items[0].pos);
    for (const key of ['pyramid', 'cherry_grove', 'bloom_core', 'skyline_siege']) {
        const positions = new Set(authoredAnchors(MAP_PRESET_CATALOG[key]).map((a) => `${a.x},${a.y},${a.z}`));
        assert.ok(positions.size > 1 || MAP_PRESET_CATALOG[key].items.length === 1, `${key} anchors are distinct`);
    }
});

test('hybrid default fills free anchors first, then falls back to random positions', () => {
    const map = { items: [{ id: 'a', x: 1, y: 2, z: 3 }, { id: 'b', x: 4, y: 2, z: 6 }] };
    const { anchored, total } = spawnAll(map, 4);
    assert.equal(anchored, 2);
    assert.equal(total, 4);
});

test('maps without anchors and maps with explicit fallback-random stay random', () => {
    assert.deepEqual(spawnAll({}, 2), { anchored: 0, total: 2 });
    const randomMap = { itemSpawnMode: 'fallback-random', items: [{ id: 'a', x: 1, y: 2, z: 3 }] };
    assert.deepEqual(spawnAll(randomMap, 2), { anchored: 0, total: 2 });
});

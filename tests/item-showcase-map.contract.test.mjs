import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { MAP_PRESETS_BASE } from '../src/core/config/maps/MapPresetsBase.js';
import { SHOWCASE_MAPS } from '../src/core/config/maps/presets/showcase_maps.js';
import { PowerupManager } from '../src/entities/Powerup.js';
import {
    getPickupTypes,
    isPickupTypeAllowedForMode,
} from '../src/entities/PickupRegistry.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

test('item showcase publishes one authored anchor for every registered item', () => {
    const map = SHOWCASE_MAPS.item_showcase;

    assert.equal(MAP_PRESETS_BASE.item_showcase, map);
    assert.equal(map.itemSpawnMode, 'anchor-only');
    assert.equal(map.keepAuthoredItemsAvailable, true);
    assert.deepEqual(
        new Set(map.items.map((item) => item.pickupType)),
        new Set(getPickupTypes()),
    );
});

test('item showcase keeps every Hunt item spawned and immediately replaces pickups', () => {
    const map = SHOWCASE_MAPS.item_showcase;
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const scene = new THREE.Scene();
    const renderer = {
        addToScene: (mesh) => scene.add(mesh),
        removeFromScene: (mesh) => scene.remove(mesh),
    };
    const arena = {
        currentMapDefinition: map,
        getAuthoredItemAnchors: () => map.items,
        getRandomPosition: () => new THREE.Vector3(),
    };
    const manager = new PowerupManager(renderer, arena, entityRuntimeConfig);
    manager.getStrategy = () => new HuntModeStrategy({ entityRuntimeConfig, random: () => 0.5 });

    manager.update(0);

    const huntTypes = getPickupTypes().filter((type) => isPickupTypeAllowedForMode(type, 'HUNT'));
    assert.equal(manager.items.length, map.items.length);
    for (const type of huntTypes) {
        assert.ok(manager.items.some((item) => item.type === type), `${type} is spawned`);
    }

    const turret = manager.items.find((item) => item.type === 'MG_TURRET');
    manager.update(0.75);
    assert.equal(manager.checkPickup(turret.mesh.position, 0)?.type, 'MG_TURRET');
    assert.equal(manager.items.length, map.items.length - 1);

    manager.update(0);

    assert.equal(manager.items.length, map.items.length);
    assert.ok(manager.items.some((item) => item.type === 'MG_TURRET'));
    manager.dispose();
});

test('discarded authored model clones release their materials after an async pickup race', async () => {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const manager = new PowerupManager({ addToScene() {}, removeFromScene() {} }, {}, entityRuntimeConfig);
    const authoredMesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial()
    );
    let disposed = false;
    authoredMesh.material.dispose = () => { disposed = true; };
    manager._authoredModelCache = {
        createModel: async () => authoredMesh,
        dispose() {},
    };
    const item = { mesh: new THREE.Group() };
    manager.items.push(item);

    manager._applyAuthoredItemModel(item, { type: 'item_box' }, { color: 0xffffff });
    manager.items.length = 0;
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(disposed, true);
    authoredMesh.geometry.dispose();
    manager.dispose();
});

test('Arcade authored health anchors keep their fixed pickup type', () => {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const map = {
        itemSpawnMode: 'anchor-only',
        items: [{ id: 'arcade-health', pickupType: 'HEALTH', x: 1, y: 2, z: 3 }],
    };
    const manager = new PowerupManager({ addToScene() {}, removeFromScene() {} }, {
        currentMapDefinition: map,
        getAuthoredItemAnchors: () => map.items,
    }, entityRuntimeConfig);
    manager.getStrategy = () => new ArcadeModeStrategy({ random: () => 0.5 });

    manager.update(CONFIG_BASE.POWERUP.SPAWN_INTERVAL);

    assert.equal(manager.items.length, 1);
    assert.equal(manager.items[0].type, 'HEALTH');
    manager.dispose();
});

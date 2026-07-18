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
    assert.equal(manager.checkPickup(turret.mesh.position, 0)?.type, 'MG_TURRET');
    assert.equal(manager.items.length, map.items.length - 1);

    manager.update(0);

    assert.equal(manager.items.length, map.items.length);
    assert.ok(manager.items.some((item) => item.type === 'MG_TURRET'));
    manager.dispose();
});

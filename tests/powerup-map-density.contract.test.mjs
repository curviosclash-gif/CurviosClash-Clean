import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { CONFIG_BASE } from '../src/core/Config.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { PowerupManager } from '../src/entities/Powerup.js';
import { resolvePowerupFieldLimit } from '../src/entities/powerup/PowerupDensityOps.js';

function bounds(width = 80, height = 30, depth = 80) {
    return { minX: -width / 2, maxX: width / 2, minY: 0, maxY: height, minZ: -depth / 2, maxZ: depth / 2 };
}

function createManager(t, arenaBounds = bounds(), baseAmount = 8) {
    const config = createEntityRuntimeConfig(null, CONFIG_BASE);
    config.POWERUP.MAX_ON_FIELD = baseAmount;
    config.POWERUP.TYPES = { SHIELD: config.POWERUP.TYPES.SHIELD };
    config.GAMEPLAY.PLANAR_MODE = false;
    let positionIndex = 0;
    const arena = {
        bounds: arenaBounds,
        getRandomPosition() {
            const index = positionIndex++;
            return new THREE.Vector3((index % 8) * 10 - 35, 10, Math.floor(index / 8) * 10 - 35);
        },
    };
    const manager = new PowerupManager({ addToScene() {}, removeFromScene() {} }, arena, config);
    t.after(() => manager.dispose());
    return manager;
}

test('density follows actual dimensions and scale relative to the standard arena', () => {
    assert.equal(resolvePowerupFieldLimit(8, bounds()), 8);
    assert.equal(resolvePowerupFieldLimit(8, bounds(160, 30, 80)), 16);
    assert.equal(resolvePowerupFieldLimit(8, bounds(80, 60, 80)), 16);
    assert.equal(resolvePowerupFieldLimit(4, bounds(160, 60, 160)), 32);
    assert.equal(resolvePowerupFieldLimit(8, bounds(40, 15, 40)), 1);
    assert.equal(resolvePowerupFieldLimit(8, bounds(80, 60, 80), true), 8);
    assert.equal(resolvePowerupFieldLimit(8, bounds(160, 60, 160), true), 32);
});

test('density stays bounded and tolerates missing or invalid arena bounds', () => {
    assert.equal(resolvePowerupFieldLimit(8, bounds(8000, 3000, 8000)), 100);
    assert.equal(resolvePowerupFieldLimit(8, bounds(1, 1, 1)), 1);
    assert.equal(resolvePowerupFieldLimit(0, bounds()), 0);
    assert.equal(resolvePowerupFieldLimit(NaN, bounds()), 0);
    for (const invalid of [undefined, {}, bounds(0), bounds(-10), bounds(Infinity), bounds(80, NaN)]) {
        assert.equal(resolvePowerupFieldLimit(8, invalid), 8);
    }
});

test('large arenas refill proportionally faster and stop at their scaled capacity', (t) => {
    const manager = createManager(t, bounds(160, 30, 80));
    const interval = manager.entityRuntimeConfig.POWERUP.SPAWN_INTERVAL / 2;
    manager.update(interval / 2);
    assert.equal(manager.items.length, 0);
    manager.update(interval / 2);
    assert.equal(manager.items.length, 1);
    for (let i = 0; i < 20; i++) manager.update(interval);
    assert.equal(manager.items.length, 16);
    assert.equal(manager.checkPickup(manager.items[0].mesh.position, 0)?.type, 'SHIELD');
    assert.equal(manager.items.length, 15);
    manager.update(interval);
    assert.equal(manager.items.length, 16);
});

test('very large arenas spawn at most 100 items', (t) => {
    const manager = createManager(t, bounds(8000, 3000, 8000));
    for (let i = 0; i < 120; i++) manager.update(1);
    assert.equal(manager.items.length, 100);
});

test('small arenas refill more slowly and planar gameplay ignores arena height', (t) => {
    const small = createManager(t, bounds(40, 30, 80));
    const interval = small.entityRuntimeConfig.POWERUP.SPAWN_INTERVAL;
    small.update(interval);
    assert.equal(small.items.length, 0);
    small.update(interval);
    assert.equal(small.items.length, 1);
    for (let i = 0; i < 6; i++) small.update(interval * 2);
    assert.equal(small.items.length, 4);
    const planar = createManager(t, bounds(80, 60, 80));
    planar.entityRuntimeConfig.GAMEPLAY.PLANAR_MODE = true;
    for (let i = 0; i < 10; i++) planar.update(interval);
    assert.equal(planar.items.length, 8);
});

test('standard timing is preserved and live item settings and arena changes take effect', (t) => {
    const manager = createManager(t);
    const interval = manager.entityRuntimeConfig.POWERUP.SPAWN_INTERVAL;
    manager.update(interval / 2);
    assert.equal(manager.items.length, 0);
    manager.update(interval / 2);
    assert.equal(manager.items.length, 1);
    for (let i = 0; i < 10; i++) manager.update(interval);
    assert.equal(manager.items.length, 8);
    manager.arena.bounds = bounds(160, 30, 80);
    manager.update(interval / 2);
    assert.equal(manager.items.length, 9);
    manager.entityRuntimeConfig.POWERUP.MAX_ON_FIELD = 2;
    manager.update(interval * 10);
    assert.equal(manager.items.length, 9, 'lower limits keep existing pickups until collected');
    assert.equal(manager.entityRuntimeConfig.POWERUP.MAX_ON_FIELD, 2, 'scaling never overwrites the base setting');
});

test('mode spawn multipliers compose with density', (t) => {
    const manager = createManager(t, bounds(160, 30, 80));
    manager.getStrategy = () => ({
        getSpawnRateMultiplier: () => 2,
        filterSpawnableTypes: (types) => types,
        resolveSpawnType: () => 'SHIELD',
    });
    manager.update(manager.entityRuntimeConfig.POWERUP.SPAWN_INTERVAL / 4);
    assert.equal(manager.items.length, 1);
});

test('replicas and endless parcours keep ownership of their spawns', (t) => {
    const replica = createManager(t, bounds(160, 60, 160));
    replica.networkReplica = true;
    replica.update(100);
    assert.equal(replica.items.length, 0);
    const endless = createManager(t, bounds(160, 60, 160));
    endless.getStrategy = () => ({ isEndlessParcours: () => true });
    endless.update(100);
    assert.equal(endless.items.length, 0);
});

test('authored refill targets remain independent of density and random field limits', (t) => {
    const manager = createManager(t, bounds(160, 60, 160), 1);
    manager.arena.currentMapDefinition = { keepAuthoredItemsAvailable: true, itemSpawnMode: 'anchor-only' };
    manager.arena.getAuthoredItemAnchors = () => [
        { id: 'one', pickupType: 'SHIELD', x: -20, y: 10, z: 0 },
        { id: 'two', pickupType: 'SHIELD', x: 20, y: 10, z: 0 },
    ];
    manager.update(0);
    assert.equal(manager.items.length, 2);
    manager.update(100);
    assert.equal(manager.items.length, 2);
});

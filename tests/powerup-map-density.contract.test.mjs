import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { CONFIG_BASE } from '../src/core/Config.js';
import { MAP_PRESETS } from '../src/core/config/MapPresets.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { GAMEPLAY_CONFIG_DEFAULTS } from '../src/shared/contracts/GameplayConfigContract.js';
import { PowerupManager } from '../src/entities/Powerup.js';
import { resolvePowerupFieldLimit } from '../src/entities/powerup/PowerupDensityOps.js';

// Arena bounds are what the arena builder produces: authored map size times MAP_SCALE. The density
// has to be measured against those, not against authored sizes, or every map looks 27 times bigger.
const MAP_SCALE = CONFIG_BASE.ARENA.MAP_SCALE;

function bounds(width = 80, height = 30, depth = 80) {
    const [w, h, d] = [width, height, depth].map((value) => value * MAP_SCALE);
    return { minX: -w / 2, maxX: w / 2, minY: 0, maxY: h, minZ: -d / 2, maxZ: d / 2 };
}

function mapBounds(mapKey) {
    return bounds(...MAP_PRESETS[mapKey].size);
}

function fieldLimit(amount, arenaBounds, planarMode = false) {
    return resolvePowerupFieldLimit(amount, arenaBounds, planarMode, MAP_SCALE);
}

function createManager(t, arenaBounds = bounds(), baseAmount = 1) {
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

test('the item setting scales against the built standard arena', () => {
    // Before the fix the 80 x 30 x 80 reference met the 3x built world: every amount from 4 up
    // landed on the 100 cap on the standard map and the slider did nothing.
    const standard = mapBounds('standard');
    assert.deepEqual([1, 4, 5, 10].map((amount) => fieldLimit(amount, standard)), [10, 40, 50, 100]);
    assert.notEqual(fieldLimit(4, standard), fieldLimit(10, standard));
});

test('the configured default amount fills the built standard arena to the cap', () => {
    const defaultAmount = GAMEPLAY_CONFIG_DEFAULTS.POWERUP.MAX_ON_FIELD;
    assert.equal(fieldLimit(defaultAmount, bounds()), 100);
    assert.equal(fieldLimit(defaultAmount - 1, bounds()) < 100, true, 'one step below the default is still visible');
});

test('density follows actual dimensions relative to the built standard arena', () => {
    assert.equal(fieldLimit(1, bounds()), 10);
    assert.equal(fieldLimit(1, bounds(160, 30, 80)), 20);
    assert.equal(fieldLimit(1, bounds(80, 60, 80)), 20);
    assert.equal(fieldLimit(1, bounds(160, 60, 160)), 80);
    assert.equal(fieldLimit(1, bounds(40, 15, 40)), 1);
    assert.equal(fieldLimit(1, bounds(80, 60, 80), true), 10);
    assert.equal(fieldLimit(1, bounds(160, 60, 160), true), 40);
});

test('real catalog maps measure against their built size', () => {
    // empty is 150 x 75 x 150 authored: about a third of the standard volume.
    assert.equal(fieldLimit(10, mapBounds('empty')), 33);
    assert.equal(fieldLimit(1, mapBounds('empty')), 3);
    // Larger maps reach the cap earlier but the low end of the slider still separates them.
    assert.equal(fieldLimit(1, mapBounds('mega_maze')), 18);
    assert.equal(fieldLimit(10, mapBounds('mega_maze')), 100);
    assert.equal(fieldLimit(1, mapBounds('pyramid')), 100);
});

test('density stays bounded and tolerates missing or invalid arena bounds', () => {
    assert.equal(fieldLimit(1, bounds(8000, 3000, 8000)), 100);
    assert.equal(fieldLimit(1, bounds(1, 1, 1)), 1);
    assert.equal(fieldLimit(0, bounds()), 0);
    assert.equal(fieldLimit(NaN, bounds()), 0);
    for (const invalid of [undefined, {}, bounds(0), bounds(-10), bounds(Infinity), bounds(80, NaN)]) {
        assert.equal(fieldLimit(1, invalid), 10, 'unknown bounds count as the standard arena');
    }
});

test('large arenas refill proportionally faster and stop at their scaled capacity', (t) => {
    const manager = createManager(t, bounds(160, 30, 80));
    const interval = manager.entityRuntimeConfig.POWERUP.SPAWN_INTERVAL / 20;
    manager.update(interval / 2);
    assert.equal(manager.items.length, 0);
    manager.update(interval / 2);
    assert.equal(manager.items.length, 1);
    for (let i = 0; i < 40; i++) manager.update(interval);
    assert.equal(manager.items.length, 20);
    assert.equal(manager.checkPickup(manager.items[0].mesh.position, 0)?.type, 'SHIELD');
    assert.equal(manager.items.length, 19);
    manager.update(interval);
    assert.equal(manager.items.length, 20);
});

test('very large arenas spawn at most 100 items', (t) => {
    const manager = createManager(t, bounds(8000, 3000, 8000));
    for (let i = 0; i < 120; i++) manager.update(1);
    assert.equal(manager.items.length, 100);
});

test('small arenas refill more slowly and planar gameplay ignores arena height', (t) => {
    const small = createManager(t, bounds(40, 30, 80));
    const interval = small.entityRuntimeConfig.POWERUP.SPAWN_INTERVAL / 5;
    small.update(interval / 2);
    assert.equal(small.items.length, 0);
    small.update(interval / 2);
    assert.equal(small.items.length, 1);
    for (let i = 0; i < 10; i++) small.update(interval);
    assert.equal(small.items.length, 5);
    const planar = createManager(t, bounds(80, 60, 80));
    planar.entityRuntimeConfig.GAMEPLAY.PLANAR_MODE = true;
    for (let i = 0; i < 20; i++) planar.update(interval / 2);
    assert.equal(planar.items.length, 10);
});

test('standard timing is preserved and live item settings and arena changes take effect', (t) => {
    const manager = createManager(t, bounds(), 2);
    const interval = manager.entityRuntimeConfig.POWERUP.SPAWN_INTERVAL / 10;
    manager.update(interval / 2);
    assert.equal(manager.items.length, 0);
    manager.update(interval / 2);
    assert.equal(manager.items.length, 1);
    for (let i = 0; i < 30; i++) manager.update(interval);
    assert.equal(manager.items.length, 20);
    manager.arena.bounds = bounds(160, 30, 80);
    manager.update(interval / 2);
    assert.equal(manager.items.length, 21);
    manager.entityRuntimeConfig.POWERUP.MAX_ON_FIELD = 1;
    manager.update(interval * 10);
    assert.equal(manager.items.length, 21, 'lower limits keep existing pickups until collected');
    assert.equal(manager.entityRuntimeConfig.POWERUP.MAX_ON_FIELD, 1, 'scaling never overwrites the base setting');
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

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG } from '../src/core/Config.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { Arena } from '../src/entities/Arena.js';
import { SpawnPlacementSystem } from '../src/entities/systems/SpawnPlacementSystem.js';
import { compileArenaCollision } from './helpers/parcours-race-line.mjs';

const MAP_SCALE = CONFIG.ARENA.MAP_SCALE;
const FALLBACK = new THREE.Vector3(210, 18, -210);

function createSpawnProbe(map) {
    const collision = compileArenaCollision(map, MAP_SCALE);
    const [sx, sy, sz] = map.size.map((value) => value * MAP_SCALE);
    let fallbackCalls = 0;
    const collisionProbes = [];
    const arena = {
        bounds: { minX: -sx / 2, maxX: sx / 2, minY: 0, maxY: sy, minZ: -sz / 2, maxZ: sz / 2 },
        checkCollision: (position, radius) => {
            collisionProbes.push({ position: position.toArray(), radius });
            return collision.checkCollisionFast(position, radius);
        },
        getRandomPosition: () => {
            fallbackCalls += 1;
            return FALLBACK.clone();
        },
    };
    Arena.prototype._cacheAuthoredMapAnchors.call(arena, map, MAP_SCALE);
    arena.getAuthoredPlayerSpawn = Arena.prototype.getAuthoredPlayerSpawn;
    arena.getAuthoredBotSpawns = Arena.prototype.getAuthoredBotSpawns;

    const player = { index: 0, isBot: false, alive: false, hitboxRadius: 1, position: new THREE.Vector3() };
    const owner = {
        arena,
        players: [player],
        humanPlayers: [player],
        runtimeRng: { next: () => 0.5 },
    };
    return {
        collision,
        collisionProbes,
        player,
        system: new SpawnPlacementSystem(owner),
        get fallbackCalls() { return fallbackCalls; },
    };
}

test('Frozen Helix rejects the old authored start that touches its start platform', () => {
    const map = structuredClone(MAP_PRESET_CATALOG.frozen_helix);
    map.playerSpawn = { x: -8, y: 96, z: 38 };
    const probe = createSpawnProbe(map);
    const oldWorldSpawn = new THREE.Vector3(-24, 288, 114);

    assert.equal(probe.player.hitboxRadius, 1, 'the runtime minimum, rather than this small player radius, sets the probe radius');
    assert.equal(probe.collision.checkCollisionFast(oldWorldSpawn, 3), true, 'the compiled collision rejects the old start at the runtime minimum radius');
    const selected = probe.system.findSpawnPosition(12, 12, { planarLevel: null, player: probe.player });
    assert.deepEqual(selected.toArray(), FALLBACK.toArray(), 'a rejected authored point falls through to the deterministic free random candidate');
    assert.ok(probe.collisionProbes.some(({ position, radius }) => (
        position.every((value, axis) => value === oldWorldSpawn.toArray()[axis]) && radius === 3
    )), 'the real placement path tested the old authored point against the compiled collision at radius 3');
    assert.equal(probe.fallbackCalls, 1, 'the old authored point forced fallback selection');
});

test('Frozen Helix uses the revised authored start with the compiled platform collision', () => {
    const map = MAP_PRESET_CATALOG.frozen_helix;
    assert.deepEqual(map.playerSpawn, { x: -8, y: 96.5, z: 38 });
    const probe = createSpawnProbe(map);
    const expectedWorldSpawn = new THREE.Vector3(-24, 289.5, 114);
    const collision = compileArenaCollision(map, MAP_SCALE);

    assert.equal(collision.checkCollisionFast(expectedWorldSpawn, 3), false, 'the authored point clears the compiled platform at runtime radius 3');
    const selected = probe.system.findSpawnPosition(12, 12, { planarLevel: null, player: probe.player });
    assert.ok(selected, 'a spawn position is returned');
    assert.deepEqual(selected.toArray(), expectedWorldSpawn.toArray(), 'the first human receives the scaled authored player spawn');
    assert.equal(probe.fallbackCalls, 0, 'the free authored point avoids random fallback');
});

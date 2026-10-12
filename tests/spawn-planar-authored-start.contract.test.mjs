import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG } from '../src/core/Config.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { Arena } from '../src/entities/Arena.js';
import { resolvePlanarLevels } from '../src/entities/arena/PortalPlacementOps.js';
import { SpawnPlacementSystem } from '../src/entities/systems/SpawnPlacementSystem.js';

// Planar mode flies every ship on one of a few fixed heights, and the portals sit on exactly
// those heights. Authored start points (playerSpawn/botSpawns) carry their own y for the free
// 3D flight; taking that y in planar mode left the ship between the levels, out of reach of
// every portal (T10d on pillar_hall). The start point keeps its x/z, the level sets the height.

const MAP_SCALE = CONFIG.ARENA.MAP_SCALE;
const LEVEL_COUNTS = [...new Set([CONFIG.GAMEPLAY.PLANAR_LEVEL_COUNT, 4, 2])];

function createArenaStub(map) {
    const arena = {
        bounds: {
            minX: -(map.size[0] * MAP_SCALE) / 2, maxX: (map.size[0] * MAP_SCALE) / 2,
            minY: 0, maxY: map.size[1] * MAP_SCALE,
            minZ: -(map.size[2] * MAP_SCALE) / 2, maxZ: (map.size[2] * MAP_SCALE) / 2,
        },
        checkCollision: () => false,
        getRandomPosition: () => new THREE.Vector3(0, 0, 0),
        getRandomPositionOnLevel: (level) => new THREE.Vector3(0, level, 0),
    };
    // The arena's own anchor scaling, so the expected x/z are what a real round sees.
    Arena.prototype._cacheAuthoredMapAnchors.call(arena, map, MAP_SCALE);
    arena.getAuthoredPlayerSpawn = Arena.prototype.getAuthoredPlayerSpawn;
    arena.getAuthoredBotSpawns = Arena.prototype.getAuthoredBotSpawns;
    return arena;
}

function spawnOnLevel(map, player, planarLevel) {
    const arena = createArenaStub(map);
    const owner = { arena, players: [player], humanPlayers: player.isBot ? [] : [player], runtimeRng: { next: () => 0.5 } };
    const system = new SpawnPlacementSystem(owner);
    const expected = player.isBot ? arena.getAuthoredBotSpawns()[0] : arena.getAuthoredPlayerSpawn();
    return { position: system.findSpawnPosition(12, 12, { planarLevel, player }), expected };
}

const createPlayer = (isBot) => ({ index: isBot ? 1 : 0, isBot, alive: false, hitboxRadius: 1, position: new THREE.Vector3() });

test('planar mode puts an authored start point on the chosen level and keeps its x/z', () => {
    const map = { size: [100, 30, 100], playerSpawn: { x: 4, y: 30, z: 54 }, botSpawns: [{ x: -20, y: 30, z: 8 }] };
    const human = spawnOnLevel(map, createPlayer(false), 12);
    assert.deepEqual(human.position.toArray(), [4, 12, 54]);
    const bot = spawnOnLevel(map, createPlayer(true), 12);
    assert.deepEqual(bot.position.toArray(), [-20, 12, 8]);
});

test('without a planar level the authored start point keeps its own height', () => {
    const map = { size: [100, 30, 100], playerSpawn: { x: 4, y: 30, z: 54 }, botSpawns: [] };
    const { position } = spawnOnLevel(map, createPlayer(false), null);
    assert.deepEqual(position.toArray(), [4, 30, 54]);
});

const START_POINT_MAPS = Object.entries(MAP_PRESET_CATALOG)
    .filter(([, map]) => map?.playerSpawn || (Array.isArray(map?.botSpawns) && map.botSpawns.length > 0));

test('the catalog has maps with authored start points', () => {
    assert.ok(START_POINT_MAPS.some(([key]) => key === 'pillar_hall'), 'pillar_hall authors start points');
});

for (const [key, map] of START_POINT_MAPS) {
    test(`${key}: every planar level holds the authored start points`, () => {
        const arena = createArenaStub(map);
        const roles = [
            ...(arena.getAuthoredPlayerSpawn() ? [false] : []),
            ...(arena.getAuthoredBotSpawns().length > 0 ? [true] : []),
        ];
        for (const levelCount of LEVEL_COUNTS) {
            const levels = resolvePlanarLevels(map.portalLevels, levelCount, arena.bounds, MAP_SCALE);
            for (const level of levels) {
                for (const isBot of roles) {
                    const { position, expected } = spawnOnLevel(map, createPlayer(isBot), level);
                    const who = isBot ? 'bot' : 'player';
                    assert.equal(position.y, level, `${who} spawn of ${key} sits on level ${level} (${levelCount} levels)`);
                    assert.equal(position.x, expected.x, `${who} spawn of ${key} keeps its x`);
                    assert.equal(position.z, expected.z, `${who} spawn of ${key} keeps its z`);
                }
            }
        }
    });
}

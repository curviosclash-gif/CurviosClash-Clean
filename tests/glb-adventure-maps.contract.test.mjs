import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MAP_PRESETS_BASE } from '../src/core/config/maps/MapPresetsBase.js';
import { GLB_ADVENTURE_MAPS } from '../src/core/config/maps/presets/glb_adventure_maps.js';
import { Arena } from '../src/entities/Arena.js';
import { ARCADE_SECTOR_CATALOG } from '../src/entities/directors/ArcadeEncounterCatalog.js';
import { buildRouteFromParcours } from '../src/entities/systems/ParcoursProgressUtils.js';
import { SECTOR_MAP_POOLS } from '../src/state/arcade/ArcadeMapProgression.js';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..');

function distance3(left, right) {
    return Math.hypot(
        (Number(left?.[0]) || 0) - (Number(right?.[0]) || 0),
        (Number(left?.[1]) || 0) - (Number(right?.[1]) || 0),
        (Number(left?.[2]) || 0) - (Number(right?.[2]) || 0)
    );
}

function isStrictlyInsideBox(point, obstacle) {
    if (!Array.isArray(obstacle?.pos) || !Array.isArray(obstacle?.size)) return false;
    return obstacle.pos.every((center, axis) => (
        Math.abs(point[axis] - center) < ((obstacle.size[axis] / 2) - 0.05)
    ));
}

test('GLB adventure maps register curated, locally available art collections', () => {
    for (const [mapKey, map] of Object.entries(GLB_ADVENTURE_MAPS)) {
        assert.equal(MAP_PRESET_CATALOG[mapKey], map, `${mapKey} reaches the runtime catalog`);
        assert.equal(MAP_PRESETS_BASE[mapKey], map, `${mapKey} reaches desktop base maps`);
        assert.equal(map.glbColliderMode, 'mesh');
        assert.ok(map.glbModels.length >= 18, `${mapKey} has a substantial art set`);
        assert.ok(new Set(map.glbModels.map((entry) => entry.id.split('/')[0])).size >= 4,
            `${mapKey} combines several visual packs`);
        assert.equal(new Set(map.glbModels.map((entry) => entry.id)).size, map.glbModels.length);

        for (const entry of map.glbModels) {
            assert.equal(existsSync(path.resolve(WORKSPACE_ROOT, entry.url)), true, `missing ${entry.url}`);
            assert.ok(entry.targetSize > 0, `${entry.id} has a visible target size`);
        }
    }
});

test('Rift Bazaar is a symmetric combat map with four districts and deliberate traversal tools', () => {
    const map = GLB_ADVENTURE_MAPS.rift_bazaar;
    assert.equal(map.parcours, undefined);
    assert.equal(map.glbModels.length, 20);
    assert.equal(map.obstacles.length, 23);
    assert.equal(map.portals.length, 2);
    assert.equal(map.gates.length, 5);
    assert.ok(map.missions.some((entry) => entry.type === 'KILL_COUNT'));
    assert.ok(map.missions.some((entry) => entry.type === 'SURVIVE_DURATION'));

    const obstaclePositions = new Set(map.obstacles
        .filter((entry) => Array.isArray(entry.pos))
        .map((entry) => entry.pos.join('|')));
    for (const position of [[-47, 11, -48], [47, 11, -48], [47, 11, 48], [-47, 11, 48]]) {
        assert.ok(obstaclePositions.has(position.join('|')), `district footprint ${position.join(',')} exists`);
    }

    const oppositeSpawn = map.botSpawns[0];
    assert.equal(map.playerSpawn.x + oppositeSpawn.x, 0);
    assert.equal(map.playerSpawn.y, oppositeSpawn.y);
    assert.equal(map.playerSpawn.z + oppositeSpawn.z, 0);
});

test('Adventure map spawns remain outside solid collision volumes', () => {
    for (const [mapKey, map] of Object.entries(GLB_ADVENTURE_MAPS)) {
        const solidBoxes = map.obstacles.filter((entry) => entry.shape !== 'tube' && !entry.tunnel);
        const spawns = [map.playerSpawn, ...map.botSpawns]
            .map((spawn) => [spawn.x, spawn.y, spawn.z]);
        for (const spawn of spawns) {
            assert.equal(solidBoxes.some((obstacle) => isStrictlyInsideBox(spawn, obstacle)), false,
                `${mapKey} spawn ${spawn.join(',')} is clear`);
        }

        for (const model of map.glbModels) {
            const horizontalClearance = Math.hypot(
                map.playerSpawn.x - model.position[0],
                map.playerSpawn.z - model.position[2]
            );
            assert.ok(horizontalClearance > (model.targetSize / 2) + 2,
                `${mapKey} player camera starts clear of ${model.id}`);
        }
    }
});

test('Aether Relay builds a demanding forward-only route with a valid high-low branch', () => {
    const map = GLB_ADVENTURE_MAPS.aether_relay;
    const route = buildRouteFromParcours(map.parcours);

    assert.ok(route);
    assert.equal(route.routeId, 'aether_relay_v1');
    assert.equal(route.totalCheckpoints, 10);
    assert.equal(route.checkpoints.length, 11);
    assert.equal(route.rules.bidirectionalCheckpoints, false);
    assert.equal(route.rules.resetToLastValid, true);
    assert.equal(route.rules.showGhost, true);
    assert.equal(route.rules.winnerByParcoursComplete, true);
    assert.ok(route.finish);

    const branch = route.branches.find((entry) => entry.checkpointId === 'CP04');
    assert.deepEqual(branch?.nextCheckpointIds, ['CP05A_HIGH', 'CP05B_LOW']);
    assert.equal(branch?.mergeCheckpointId, 'CP06');
    assert.equal(branch?.validMerge, true);

    const solidBoxes = map.obstacles.filter((entry) => entry.shape !== 'tube' && !entry.tunnel);
    for (const checkpoint of [...map.parcours.checkpoints, map.parcours.finish]) {
        assert.ok(checkpoint.radius >= 4.5, `${checkpoint.id} remains reachable at speed`);
        assert.ok(Math.abs(checkpoint.pos[0]) <= map.size[0] / 2, `${checkpoint.id} stays in X bounds`);
        assert.ok(checkpoint.pos[1] >= 0 && checkpoint.pos[1] <= map.size[1], `${checkpoint.id} stays in Y bounds`);
        assert.ok(Math.abs(checkpoint.pos[2]) <= map.size[2] / 2, `${checkpoint.id} stays in Z bounds`);
        assert.equal(solidBoxes.some((obstacle) => isStrictlyInsideBox(checkpoint.pos, obstacle)), false,
            `${checkpoint.id} is not buried in a solid obstacle`);
    }
});

test('Aether Relay scales spawn and route anchors into the same world space', () => {
    const map = GLB_ADVENTURE_MAPS.aether_relay;
    const arena = Object.create(Arena.prototype);
    arena._cacheAuthoredMapAnchors(map, 3);

    assert.deepEqual(arena.getAuthoredPlayerSpawn(), { x: -156, y: 45, z: -54 });
    assert.deepEqual(arena.getAuthoredBotSpawns()[0], { x: -162, y: 36, z: -105 });
    assert.deepEqual(
        [arena.getAuthoredItemAnchors()[0].x, arena.getAuthoredItemAnchors()[0].y, arena.getAuthoredItemAnchors()[0].z],
        [-93, 51, -60]
    );

    const scaledRoute = buildRouteFromParcours(map.parcours, { positionScale: 3 });
    const spawn = [-156, 45, -54];
    assert.ok(distance3(spawn, scaledRoute.checkpoints[0].pos) < 60,
        'the first checkpoint is close enough to read from the starting platform');
    assert.ok(scaledRoute.checkpoints[0].pos[2] < spawn[2],
        'the first checkpoint lies in the default forward direction');

    const legacyArena = Object.create(Arena.prototype);
    legacyArena._cacheAuthoredMapAnchors({ playerSpawn: { x: 2, y: 3, z: 4 } }, 3);
    assert.deepEqual(legacyArena.getAuthoredPlayerSpawn(), { x: 2, y: 3, z: 4 },
        'existing maps keep their historical unscaled spawn contract');
});

test('Aether Relay is available in both synchronized arcade parcours pools', () => {
    const progressionPool = SECTOR_MAP_POOLS.sector_parcours;
    const encounterPool = ARCADE_SECTOR_CATALOG
        .find((entry) => entry.id === 'sector_parcours')?.mapPool;

    assert.deepEqual(encounterPool, progressionPool);
    assert.ok(progressionPool.includes('aether_relay'));
});

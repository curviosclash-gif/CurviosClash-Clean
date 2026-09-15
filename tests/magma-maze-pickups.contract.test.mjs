import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { Arena } from '../src/entities/Arena.js';
import { ArenaGeometryCompilePipeline } from '../src/entities/arena/ArenaGeometryCompilePipeline.js';
import { PowerupManager } from '../src/entities/Powerup.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

const MAP = CONFIG_BASE.MAPS.magma_maze;
const PLAYER_RADIUS = CONFIG_BASE.PLAYER.HITBOX_RADIUS;
const AFFECTED_PICKUPS = Object.freeze([
    { id: 'mm_speed_1', approachStartX: -9 },
    { id: 'mm_shield_2', approachStartX: 21 },
    { id: 'mm_speed_3', approachStartX: 61 },
    { id: 'mm_speed_fin', approachStartX: 76 },
]);

function createRendererStub() {
    const scene = new THREE.Scene();
    return {
        scene,
        addToScene(object) { scene.add(object); },
        removeFromScene(object) { scene.remove(object); },
    };
}

function disposePendingGeometry(arena) {
    const geometryKeys = [
        '_pendingWallGeos',
        '_pendingObstacleGeos',
        '_pendingFoamGeos',
        '_pendingObstacleEdgeGeos',
        '_pendingFoamEdgeGeos',
    ];
    for (const key of geometryKeys) {
        for (const geometry of arena[key] || []) geometry.dispose();
        arena[key] = [];
    }
}

function buildCollisionRuntime(scale) {
    const renderer = createRendererStub();
    const arena = new Arena(renderer);
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    entityRuntimeConfig.ARENA.MAP_SCALE = scale;
    arena.entityRuntimeConfig = entityRuntimeConfig;
    arena.currentMapKey = 'magma_maze';
    arena.currentMapDefinition = MAP;
    arena.openFaces = Object.freeze([]);

    const [width, height, depth] = MAP.size.map((value) => value * scale);
    arena._builder._applyArenaBounds({ sx: width, sy: height, sz: depth });
    const pipeline = new ArenaGeometryCompilePipeline(arena);
    pipeline.beginBuildStage();
    pipeline.compileWallStage({
        sx: width,
        sy: height,
        sz: depth,
        scale,
        openFaces: arena.openFaces,
    });
    pipeline.compileObstacleStage({ obstacleDefs: MAP.obstacles, scale });
    arena._cacheAuthoredMapAnchors(MAP, scale);

    return { arena, entityRuntimeConfig, renderer };
}

test('Magma Maze authored pickups are reachable through their compiled tunnels', () => {
    assert.equal(PLAYER_RADIUS, 0.8);

    for (const scale of [1.5, 3]) {
        const { arena, entityRuntimeConfig, renderer } = buildCollisionRuntime(scale);
        let powerupManager = null;
        try {
            const anchorsById = new Map(
                arena.getAuthoredItemAnchors().map((anchor) => [anchor.id, anchor])
            );
            const blockedAnchors = [];
            const blockedApproaches = [];

            for (const pickup of AFFECTED_PICKUPS) {
                const anchor = anchorsById.get(pickup.id);
                assert.ok(anchor, `${pickup.id} has a cached runtime anchor`);
                const anchorPosition = new THREE.Vector3(anchor.x, anchor.y, anchor.z);
                if (arena.checkCollisionFast(anchorPosition, PLAYER_RADIUS)) {
                    blockedAnchors.push(pickup.id);
                }

                for (let x = pickup.approachStartX; x >= anchor.x / scale; x -= 0.25) {
                    const probe = new THREE.Vector3(x * scale, anchor.y, anchor.z);
                    if (arena.checkCollisionFast(probe, PLAYER_RADIUS)) {
                        blockedApproaches.push(`${pickup.id}@${x.toFixed(2)}`);
                    }
                }
            }

            assert.deepEqual(blockedAnchors, [], `scale ${scale}: pickup anchors stay outside solid geometry`);
            assert.deepEqual(blockedApproaches, [], `scale ${scale}: positive-X tunnel approaches stay flyable`);

            powerupManager = new PowerupManager(renderer, arena, entityRuntimeConfig);
            const collectibleAnchor = anchorsById.get('mm_speed_1');
            const item = powerupManager.spawnAtAnchor({
                ...collectibleAnchor,
                ownerId: 'magma-maze-contract',
            });
            assert.ok(item, `scale ${scale}: affected pickup is placed by the real powerup manager`);
            assert.equal(arena.checkCollisionFast(item.mesh.position, PLAYER_RADIUS), false);
            assert.deepEqual(
                item.box.getSize(new THREE.Vector3()).toArray(),
                Array(3).fill(CONFIG_BASE.POWERUP.PICKUP_RADIUS * 2),
                `scale ${scale}: pickup uses the default collection box`
            );
            const collected = powerupManager.checkPickup(
                item.mesh.position,
                PLAYER_RADIUS,
                () => true
            );
            assert.equal(collected?.ok, true, `scale ${scale}: reachable pickup can be collected`);
            assert.equal(collected?.type, collectibleAnchor.pickupType);
            assert.equal(powerupManager.items.length, 0);
        } finally {
            powerupManager?.dispose();
            disposePendingGeometry(arena);
            arena.dispose();
        }
    }
});

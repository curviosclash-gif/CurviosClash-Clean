import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { GLB_ADVENTURE_MAPS } from '../src/core/config/maps/presets/glb_adventure_maps.js';
import { Arena } from '../src/entities/Arena.js';
import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';
import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { ParcoursProgressSystem } from '../src/entities/systems/ParcoursProgressSystem.js';

const SCALE = 3;
const RADIUS = 1.1;

async function buildCollision(map) {
    const arena = new Arena({
        addToScene() {}, removeFromScene() {}, setMapLighting() {}, setShadowCoverage() {},
        getGraphicsStyle() { return 'modern'; }, getMaxAnisotropy() { return 1; },
    });
    arena.runtimeMapKey = 'adventure-flight-probe';
    arena.entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_SECTIONS);
    arena.runtimeMapDefinition = {
        ...map, glbModels: [],
        obstacles: map.obstacles.filter((obstacle) => obstacle.compileWithGlb),
    };
    await arena.build(arena.runtimeMapKey);
    const collection = await loadGLBMapCollection(map.glbModels, {
        loader: geometryOnlyGlbLoader, placementScale: SCALE, requireComplete: true,
    });
    arena._glbScene = collection.scene;
    arena._glbAnimation.setTracks(collection.animationTracks);
    arena.obstacles.push(...collection.colliders);
    return arena;
}

function assertClearLine(arena, from, to, label) {
    const start = new Vector3(...from).multiplyScalar(SCALE);
    const end = new Vector3(...to).multiplyScalar(SCALE);
    const steps = Math.ceil(start.distanceTo(end) / (RADIUS / 2));
    const point = new Vector3();
    for (let step = 0; step <= steps; step++) {
        point.lerpVectors(start, end, step / (steps || 1));
        assert.equal(arena.checkCollisionFast(point, RADIUS), false,
            `${label} blocked at ${point.toArray().map((n) => (n / SCALE).toFixed(2))}`);
    }
}

for (const [key, map] of Object.entries(GLB_ADVENTURE_MAPS)) {
    test(`${key} real model collision keeps every spawn, item and gate clear`, async () => {
        const arena = await buildCollision(map);
        try {
            const anchors = [map.playerSpawn, ...map.botSpawns, ...map.items];
            for (const anchor of anchors) {
                const p = [anchor.x, anchor.y, anchor.z];
                assertClearLine(arena, p, p, anchor.id || 'spawn');
            }
            for (const gate of map.gates) assertClearLine(arena, gate.pos, gate.pos, gate.id);
        } finally { arena.dispose(); }
    });
}

test('both Relay branches have continuous vehicle-sized clearance through every checkpoint', async () => {
    const map = GLB_ADVENTURE_MAPS.aether_relay;
    const arena = await buildCollision(map);
    try {
        for (const branch of ['CP05A_HIGH', 'CP05B_LOW']) {
            let previous = [map.playerSpawn.x, map.playerSpawn.y, map.playerSpawn.z];
            const route = map.parcours.checkpoints.filter((cp) => !cp.id.startsWith('CP05') || cp.id === branch);
            for (const cp of [...route, map.parcours.finish]) {
                assertClearLine(arena, previous, cp.pos, `${branch} -> ${cp.id}`);
                const forward = new Vector3(...cp.forward).normalize().multiplyScalar(cp.radius / 2);
                const before = cp.pos.map((n, i) => n - forward.getComponent(i));
                const after = cp.pos.map((n, i) => n + forward.getComponent(i));
                assertClearLine(arena, before, after, `${cp.id} crossing`);
                previous = cp.pos;
            }
        }
    } finally { arena.dispose(); }
});

test('Bazaar central tunnel walls are solid beside four clear cardinal passages', async () => {
    const arena = await buildCollision(GLB_ADVENTURE_MAPS.rift_bazaar);
    try {
        for (const obstacle of GLB_ADVENTURE_MAPS.rift_bazaar.obstacles.filter((entry) => entry.compileWithGlb)) {
            const axis = obstacle.tunnel.axis === 'x' ? 0 : 2;
            const from = [...obstacle.pos]; const to = [...obstacle.pos];
            from[axis] -= 6; to[axis] += 6;
            assertClearLine(arena, from, to, `tunnel ${obstacle.pos}`);
            const wall = new Vector3(...obstacle.pos).multiplyScalar(SCALE);
            wall.y += 8 * SCALE;
            assert.equal(arena.checkCollisionFast(wall, RADIUS), true);
        }
    } finally { arena.dispose(); }
});

test('both Relay choices retain readable HUD labels and complete the ordered route', () => {
    const map = GLB_ADVENTURE_MAPS.aether_relay;
    for (const branch of ['CP05A_HIGH', 'CP05B_LOW']) {
        const system = new ParcoursProgressSystem({
            arena: { currentMapDefinition: map }, entityRuntimeConfig: CONFIG_SECTIONS, _simulationClockMs: 0,
        });
        const player = { index: 0, alive: true, isBot: false, hitboxRadius: RADIUS,
            position: { x: -156, y: 45, z: -54 } };
        system.startRound([player]);
        system.onPlayerSpawn(player, { reason: 'round_start' });
        const route = system.getRouteSnapshot();
        let now = 1000;
        for (const cp of [...route.checkpoints.filter((entry) => !entry.id.startsWith('CP05') || entry.id === branch), route.finish]) {
            const direction = new Vector3(...cp.forward).normalize().multiplyScalar(cp.radius / 2);
            const before = new Vector3(...cp.pos).sub(direction);
            player.position = new Vector3(...cp.pos).add(direction);
            const result = system.updatePlayerProgress(player, before, now);
            assert.ok(result, `${branch}: ${cp.id}`);
            if (cp.id === 'CP04') {
                assert.deepEqual(system.getPlayerHudState(0, now).expectedCheckpointLabels,
                    ['Hoch: Luftinseln', 'Tief: Tunnel']);
            }
            now += 1000;
        }
        assert.equal(system.getPlayerHudState(0, now).completed, true);
        assert.equal(system.getPlayerHudState(0, now).wrongOrderCount, 0);
    }
});

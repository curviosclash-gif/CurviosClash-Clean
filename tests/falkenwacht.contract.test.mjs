import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MAP_PRESETS_BASE } from '../src/core/config/maps/MapPresetsBase.js';
import { FALKENWACHT_MAPS } from '../src/core/config/maps/presets/burg_falkenwacht/index.js';
import { FALKENWACHT_MODELS } from '../src/core/config/maps/presets/burg_falkenwacht/FalkenwachtModels.js';
import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { Arena } from '../src/entities/Arena.js';
import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
import { GlbAnimationDriver } from '../src/entities/arena/GlbAnimationDriver.js';
import { sphereIntersectsStaticMeshCollider, refreshDynamicMeshCollider } from '../src/entities/arena/StaticMeshCollider.js';
import { ParcoursProgressSystem } from '../src/entities/systems/ParcoursProgressSystem.js';
import { buildRouteFromParcours } from '../src/entities/systems/ParcoursProgressUtils.js';
import { createSolidProbe } from './helpers/notre-dame-collision-utils.mjs';

const map = FALKENWACHT_MAPS.burg_falkenwacht;
const arenaMap = FALKENWACHT_MAPS.burg_falkenwacht_arena;
const SCALE = CONFIG_SECTIONS.ARENA.MAP_SCALE;
const gltfLoader = new GLTFLoader();
const castle = await loadGLBMapCollection(FALKENWACHT_MODELS, {
    loader: { async loadAsync(url) {
        const bytes = readFileSync(url);
        return gltfLoader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    } },
    colliderMode: 'scene', placementScale: SCALE, animationClock: map.glbAnimationClock,
});
const clock = new GlbAnimationDriver();
clock.setTracks(castle.animationTracks);

function pose(seconds) {
    clock.setElapsedSeconds(seconds);
    clock.advance(0);
    castle.scene.updateMatrixWorld(true);
    for (const entry of castle.colliders) if (entry.dynamic) refreshDynamicMeshCollider(entry.meshCollider, entry.box);
}

function hit(point, radius = 1.1 / SCALE, includeDynamic = true) {
    const position = { x: point[0] * SCALE, y: point[1] * SCALE, z: point[2] * SCALE };
    return castle.colliders.some((entry) => (includeDynamic || !entry.dynamic)
        && sphereIntersectsStaticMeshCollider(entry.meshCollider, position, radius * SCALE));
}

function harness() {
    const manager = { arena: { currentMapDefinition: map }, entityRuntimeConfig: CONFIG_SECTIONS, _simulationClockMs: 0 };
    const system = new ParcoursProgressSystem(manager);
    const player = { index: 0, alive: true, isBot: false, hitboxRadius: 1.1,
        position: { x: 0, y: 26 * SCALE, z: 174 * SCALE } };
    system.startRound([player]);
    system.onPlayerSpawn(player, { reason: 'round_start' });
    return { system, player };
}

function cross(system, player, entry, now) {
    const unit = entry.forward.map((n) => n / (Math.hypot(...entry.forward) || 1));
    const previous = Object.fromEntries(['x', 'y', 'z'].map((axis, i) => [axis, entry.pos[i] - unit[i] * entry.radius * .5]));
    player.position = Object.fromEntries(['x', 'y', 'z'].map((axis, i) => [axis, entry.pos[i] + unit[i] * entry.radius * .5]));
    return system.updatePlayerProgress(player, previous, now);
}

test('both castle variants register shared geometry, light, items and independent gameplay', () => {
    for (const [key, value] of Object.entries(FALKENWACHT_MAPS)) {
        assert.equal(MAP_PRESET_CATALOG[key], value);
        assert.equal(MAP_PRESETS_BASE[key], value);
        for (const model of value.glbModels) assert.ok(existsSync(model.url), model.url);
    }
    for (const field of ['glbModels', 'obstacles', 'lighting', 'lights', 'items']) assert.equal(map[field], arenaMap[field]);
    assert.equal(arenaMap.parcours, undefined);
    assert.equal(arenaMap.botSpawns.length + 1, 8);
    assert.equal(castle.failedCount, 0);
    assert.deepEqual(castle.warnings, []);
    assert.equal(castle.loadedCount, 12);
    const runtime = Object.create(Arena.prototype);
    runtime._cacheAuthoredMapAnchors(map, SCALE);
    assert.deepEqual(runtime.getAuthoredPlayerSpawn(), { x: 0, y: 26 * SCALE, z: 174 * SCALE });
});

test('exported castle parts obey triangle budgets and carry exactly the authored loop durations', () => {
    let bytesTotal = 0;
    for (const model of FALKENWACHT_MODELS) {
        const bytes = readFileSync(model.url);
        bytesTotal += bytes.length;
        const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString().trimEnd());
        const triangles = json.meshes.flatMap((m) => m.primitives).reduce((sum, p) => sum + (
            json.accessors[p.indices ?? p.attributes.POSITION].count / 3), 0);
        assert.ok(triangles <= (model.animationClock ? 6000 : 18000), `${model.id}: ${triangles}`);
        assert.ok(existsSync(model.url.replace('/glb/', '/blender/').replace('.glb', '.blend')));
    }
    assert.ok(bytesTotal < 5 * 1024 * 1024, `castle GLBs: ${bytesTotal} bytes`);
    assert.deepEqual(castle.animationTracks.map((t) => [t.clipName, t.durationSeconds]),
        [['DrawbridgeLoop', 24], ['PortcullisLoop', 12], ['BannersLoop', 4]]);
    assert.ok(castle.colliders.some((c) => c.dynamic));
});

test('walls collide while actual arches, halls and the tower passage remain open', () => {
    pose(0);
    for (const p of [[145, 30, 0], [-145, 30, 0], [80, 35, -34], [-64, 30, -78]]) {
        assert.equal(hit(p), true, `solid wall at ${p}`);
    }
    const fallback = createSolidProbe(map.obstacles);
    for (const p of [[0, 26, 118], [-85, 26, 72], [-85, 28, 18], [36, 34, -56],
        [108, 34, -78], [100, 35, -92], [145, 64, -118], [0, 30, 0]]) {
        assert.equal(hit(p), false, `open GLB passage at ${p}`);
        assert.equal(fallback(p), false, `open fallback passage at ${p}`);
    }
});

test('bridge and gate collision follows open, moving and closed poses and repeats on the common clock', () => {
    for (const [time, bridgeBlocked, gateBlocked] of [[0,false,false],[5,false,false],[7,false,true],
        [10,true,true],[14,true,false],[18,true,true],[22,true,true],[24,false,false]]) {
        pose(time);
        // At t=10/22 the bridge intersects its 45-degree swing, at t=14/18 its raised plane.
        const bridgePoint = [0, 26, (time === 10 || time === 22) ? 132 : 118];
        assert.equal(hit(bridgePoint), bridgeBlocked, `bridge t=${time}`);
        assert.equal(hit([0,30,0]), gateBlocked, `gate t=${time}`);
        assert.equal(hit([-65,58,118]), false, `bridge bypass t=${time}`);
        assert.equal(hit([-65,62,0]), false, `gate bypass t=${time}`);
    }
});

test('all anchors and checkpoints stay clear through the complete mechanism cycle', () => {
    const route = buildRouteFromParcours(map.parcours);
    const points = [map.playerSpawn, arenaMap.playerSpawn, ...arenaMap.botSpawns, ...map.items]
        .map((p) => [p.x,p.y,p.z]);
    points.push(...route.checkpoints.map((p) => p.pos), route.finish.pos);
    for (let time = 0; time <= 24; time += .5) {
        pose(time);
        for (const point of points) assert.equal(hit(point), false, `anchor ${point} at ${time}s`);
    }
});

test('closed gate bars leave no aircraft-sized holes across the direct flight lane', () => {
    pose(7);
    for (let x = -15; x <= 15; x += .25) assert.equal(hit([x,30,0]), true, `gate gap at ${x}`);
    pose(0);
    for (let x = -15; x <= 15; x += .25) assert.equal(hit([x,30,0]), false, `open gate at ${x}`);
});

test('all four branch combinations finish eighteen stages and produce safe death respawns at every stage', () => {
    for (let choice = 0; choice < 4; choice++) {
        const clean = harness();
        const route = clean.system.getRouteSnapshot();
        assert.equal(route.totalCheckpoints, 18);
        assert.equal(route.checkpoints.length, 20);
        let now = 1000;
        let branch = 0;
        const visited = [];
        for (let stage = 0; stage < 18; stage++) {
            const entries = route.checkpoints.filter((p) => p.routeIndex === stage);
            const checkpoint = entries[entries.length > 1 ? ((choice >> branch++) & 1) : 0];
            assert.equal(cross(clean.system, clean.player, checkpoint, now)?.type, 'checkpoint', checkpoint.id);
            visited.push(checkpoint);
            // The actual respawn implementation offsets behind the ring; test that position,
            // not just the centre, against moving geometry across an entire cycle.
            const recovery = harness();
            visited.forEach((entry, index) => cross(recovery.system, recovery.player, entry, 1000 + index * 1000));
            recovery.system.onPlayerDeath(recovery.player, { now: now + 1 });
            const plan = recovery.system.takeRespawnPlan(recovery.player);
            assert.ok(plan, checkpoint.id);
            for (let t = 0; t < 24; t += .5) {
                pose(t);
                assert.equal(hit(plan.position.map((v) => v / SCALE)), false, `${checkpoint.id} respawn at ${t}s: ${plan.position}`);
            }
            now += 1000;
        }
        assert.equal(cross(clean.system, clean.player, route.finish, now)?.type, 'finish');
        assert.equal(clean.system.getPlayerHudState(0, now).wrongOrderCount, 0);
    }
});

test('every route connection has a clear flight line through the static castle', () => {
    const route = buildRouteFromParcours(map.parcours);
    pose(0);
    for (let stage = 0; stage < route.totalCheckpoints; stage++) {
        const starts = route.checkpoints.filter((p) => p.routeIndex === stage);
        const ends = stage === route.totalCheckpoints - 1 ? [route.finish]
            : route.checkpoints.filter((p) => p.routeIndex === stage + 1);
        for (const from of starts) for (const to of ends) {
            const steps = Math.ceil(Math.hypot(...to.pos.map((v, i) => v - from.pos[i])));
            for (let step = 0; step <= steps; step++) {
                const p = from.pos.map((v, i) => v + (to.pos[i] - v) * step / steps);
                assert.equal(hit(p, 1.1 / SCALE, false), false, `${from.id} -> ${to.id} at ${p}`);
            }
        }
    }
});

test.after(() => {
    clock.clear();
    castle.scene.traverse((node) => {
        node.geometry?.dispose();
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) material?.dispose();
    });
});

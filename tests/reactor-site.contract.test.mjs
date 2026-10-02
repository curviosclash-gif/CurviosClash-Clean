import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as THREE from 'three';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { MAP_PRESETS } from '../src/core/config/MapPresets.js';
import { getRuntimeMapDefinition } from '../src/shared/contracts/RuntimeMapCatalogContract.js';
import { resolveMapPickerCollection } from '../src/ui/menu/MenuMapCollectionCatalog.js';
import {
    REACTOR_SITE_METRE,
    REACTOR_SITE_GROUND,
    REACTOR_PART_BASE_METRES,
    REACTOR_SCENE_BASE_METRES,
    REACTOR_SCENE_CLIPS,
    REACTOR_SCENE_INTACT_MODEL,
} from '../src/core/config/maps/presets/reactor_site/ReactorSiteModels.js';
import {
    REACTOR_WRECK_REACH,
    REACTOR_HALF_SIZE,
    REACTOR_SITE_GROUND_TILES,
} from '../src/core/config/maps/presets/reactor_site/ReactorSiteStructure.js';
import { REACTOR_SITE_PIECES } from '../src/core/config/maps/presets/reactor_site/ReactorSiteDestructibles.js';
import {
    applyMapDestructibleDamage,
    createMapDestructibleState,
    normalizeMapDestructibles,
    resolveMapDestructibleSceneTimeline,
} from '../src/shared/contracts/MapDestructibleContract.js';
import { resolveMapSinglePlayerScenario } from '../src/shared/contracts/MapSinglePlayerScenarioContract.js';
import { MapOwnedPickupSystem } from '../src/entities/systems/MapOwnedPickupSystem.js';
import { MapDestructibleGlowController } from '../src/entities/arena/MapDestructibleGlowController.js';
import { PortalRuntimeSystem } from '../src/entities/arena/portal/PortalRuntimeSystem.js';
import { ArenaCollision } from '../src/entities/arena/ArenaCollision.js';
import { resolveArenaPlayableVolumes } from '../src/entities/arena/ArenaPlayableVolumes.js';

// The map preset of the reactor site. The Blender side of the same contract lives in
// reactor-site-blender-assets.contract.test.mjs; this file checks the half the preset owns: that
// the scenes are placed where the intact parts stand, address the clips their files really
// contain, name models that exist, and that every structure comes down the way the break plan
// says - towers onto their own side, the stack along the shot, the hall and the cloud in place.

const MAP_KEY = 'reactor_site';
const MAP = MAP_PRESET_CATALOG[MAP_KEY];
const FUNGUS_PREFIX = 'assets/models/glowing_mushroom/';
const WRECK_MARGIN = 12;
const RUNTIME_WORLD_SCALE = 3;

// Which intact model each segment's meshes live in, and which scene replaces it.
const SEGMENT_MODELS = Object.freeze({
    cooling_tower_w: 'reactor-cooling-tower-west',
    cooling_tower_e: 'reactor-cooling-tower-east',
    vent_stack: 'reactor-vent-stack',
    turbine_hall: 'reactor-turbine-hall',
    reactor_dome: 'reactor-block',
});
const SEGMENT_SCENES = Object.freeze({
    cooling_tower_w: 'topple_tower_w',
    cooling_tower_e: 'topple_tower_e',
    vent_stack: 'topple_stack',
    turbine_hall: 'collapse_hall',
    reactor_dome: 'mushroom_cloud',
});
// The two scenes that never turn: every wall falls to its own side, and a cloud has no side.
const UNTURNED_SCENES = Object.freeze(['collapse_hall', 'mushroom_cloud']);

function readGlbJson(url) {
    const bytes = readFileSync(path.resolve(url));
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${url} has a GLB header`);
    const jsonLength = bytes.readUInt32LE(12);
    return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
}

function collidableNodeNames(document) {
    return (document.nodes || [])
        .filter((node) => node.mesh !== undefined && !String(node.name || '').toLowerCase().includes('_nocol'))
        .map((node) => String(node.name));
}

function nodeNames(document) {
    return (document.nodes || []).map((node) => String(node.name || ''));
}

function modelById(id) {
    return MAP.glbModels.find((model) => model.id === id) || null;
}

function definition() {
    const normalized = normalizeMapDestructibles(MAP.destructibles);
    assert.ok(normalized, 'the destructible block normalizes');
    return normalized;
}

function breakSegment(segmentId, hitDirection = { x: 1, y: 0.2, z: 0 }) {
    const def = definition();
    const state = createMapDestructibleState(def);
    const segment = def.segments.find((entry) => entry.id === segmentId);
    const result = applyMapDestructibleDamage(state, def, segmentId, segment.hp, { atSeconds: 4, hitDirection });
    return { def, state, segment, result, timeline: resolveMapDestructibleSceneTimeline(def, state.events) };
}

test('the reactor site reaches the runtime, not just the catalog', () => {
    assert.ok(MAP, 'the reactor site is in the catalog');
    assert.equal(MAP.name, 'Reaktor Sperrzone');
    assert.equal(MAP_PRESETS[MAP_KEY], MAP, 'the reactor site is in the runtime map set');
    assert.equal(getRuntimeMapDefinition(MAP_KEY, MAP_PRESETS).name, 'Reaktor Sperrzone');
    assert.equal(resolveMapPickerCollection(MAP_KEY).id, 'arena', 'a demolition is fought, so it lives with the arenas');
});

test('the map is a scene-collided, scaled-anchor hunt map with a single-player scenario', () => {
    assert.equal(MAP.glbColliderMode, 'scene');
    assert.equal(MAP.glbAuthoredObstaclesCollisionOnly, true);
    assert.equal(MAP.scaleAuthoredAnchors, true);
    assert.equal(MAP.itemSpawnMode, 'hybrid', 'authored pickup routes are used before random fallback');
    assert.equal(MAP.parcours, undefined);
    assert.equal(MAP.portals.length, 1, 'the reactor hall has one fixed exit portal pair');
    assert.deepEqual(MAP.portals[0].a, [0, 14, 13.2]);
    assert.deepEqual(MAP.portals[0].b, [0, 14, REACTOR_HALF_SIZE - 9]);
    assert.equal(MAP.secretRooms[0].id, 'bunker', 'the existing bunker portal remains available');
    const scenario = resolveMapSinglePlayerScenario(MAP);
    assert.equal(scenario?.gameMode, 'HUNT');
    assert.equal(scenario?.modePath, 'fight');
    assert.equal(scenario?.id, MAP_KEY);
    assert.ok(scenario.minBots >= 1 && scenario.minBots <= scenario.botCount);
});

test('the deep basin and flooded gallery contract preserves the water surface and opens only mapped shafts', () => {
    const [west, east, core, westGallery, eastGallery] = MAP.permanentWaterZones;
    assert.deepEqual(west.center, [-63, 0]);
    assert.deepEqual(east.center, [63, 0]);
    assert.equal(west.floorLevel, -52.9);
    assert.equal(east.floorLevel, -52.9);
    assert.equal(west.radius, 24.5);
    assert.equal(east.radius, 24.5);
    assert.equal(west.surfaceLevel, 8.1);
    assert.equal(east.surfaceLevel, 8.1);
    assert.equal(core.floorLevel, -52.9);
    assert.equal(core.radius, 13.0);
    assert.equal(core.surfaceLevel, 8.1);
    assert.equal(westGallery.surfaceVisible, false);
    assert.equal(eastGallery.surfaceVisible, false);
    assert.deepEqual(westGallery.bounds, { min: [-45, -34, -9.3], max: [-7.2, -26.35, 9.3] });
    assert.deepEqual(eastGallery.bounds, { min: [7.2, -34, -9.3], max: [45, -26.35, 9.3] });
    const clearGallery = MAP.playableVolumes[3].bounds;
    const visibleMantaWidth = 16.59;
    assert.ok(clearGallery.max[2] - clearGallery.min[2] >= visibleMantaWidth + 2,
        'the full-sized Manta visual envelope has a one-unit margin on both tunnel walls');
    assert.ok(west.surfaceLevel < 8.25 && west.surfaceLevel > west.floorLevel);
    assert.ok(east.surfaceLevel < 8.25 && east.surfaceLevel > east.floorLevel);
    for (const centerX of [-63, 63]) {
        for (const tile of REACTOR_SITE_GROUND_TILES) {
            const dx = Math.max(Math.abs(tile.pos[0] - centerX) - tile.size[0] / 2, 0);
            const dz = Math.max(Math.abs(tile.pos[2]) - tile.size[2] / 2, 0);
            assert.ok(Math.hypot(dx, dz) >= 27, `fallback ground intrudes into the basin at ${Math.hypot(dx, dz).toFixed(1)}`);
        }
    }
    for (const item of MAP.items) {
        for (const pool of MAP.permanentWaterZones.filter((zone) => Array.isArray(zone.center))) {
            assert.ok(Math.hypot(item.x - pool.center[0], item.z - pool.center[1]) > pool.radius,
                `${item.id} does not spawn under permanent pool water`);
        }
    }
    assert.ok(!REACTOR_SITE_GROUND_TILES.some((tile) => {
        const dx = Math.max(Math.abs(tile.pos[0]) - tile.size[0] / 2, 0);
        const dz = Math.max(Math.abs(tile.pos[2]) - tile.size[2] / 2, 0);
        return Math.hypot(dx, dz) < 15.12;
    }), 'fallback floor leaves the complete enlarged central bowl hole open');
});

test('a large vehicle can fly continuously through both flooded routes above the complete reactor core', () => {
    const scale = CONFIG_SECTIONS.ARENA.MAP_SCALE;
    const playableVolumes = resolveArenaPlayableVolumes(MAP, scale);
    const bounds = {
        minX: -REACTOR_HALF_SIZE * scale, maxX: REACTOR_HALF_SIZE * scale,
        minY: 0, maxY: MAP.size[1] * scale,
        minZ: -REACTOR_HALF_SIZE * scale, maxZ: REACTOR_HALF_SIZE * scale,
    };
    const collision = new ArenaCollision({ bounds, obstacles: [], playableVolumes });
    const radius = 4.64; // largest ordinary vehicle bound radius in runtime units
    const flightY = -30.175; // above the entire fuel core, below the tunnel roof and water surface
    const routes = [
        [[-63, flightY, 0], [63, flightY, 0]],
        [[63, flightY, 0], [-63, flightY, 0]],
    ];
    for (const route of routes) {
        for (let segment = 0; segment < route.length - 1; segment += 1) {
            const from = route[segment];
            const to = route[segment + 1];
            const distance = Math.hypot(...to.map((value, axis) => value - from[axis])) * scale;
            const steps = Math.ceil(distance / 1.5);
            for (let index = 0; index <= steps; index += 1) {
                const point = new THREE.Vector3(...from.map((value, axis) => (
                    (value + ((to[axis] - value) * index) / steps) * scale
                )));
                const label = `segment ${segment} step ${index}`;
                assert.equal(collision.checkCollisionFast(point, radius), false, `player route blocked at ${label}`);
                assert.equal(collision.checkBotCollisionFast(point, radius), false, `bot route blocked at ${label}`);
                assert.equal(collision.getCollisionInfo(point, radius), null, `projectile/precise query blocked at ${label}`);
            }
        }
    }
    const outsideShaft = new THREE.Vector3(20 * scale, flightY * scale, 20 * scale);
    assert.equal(collision.checkCollisionFast(outsideShaft, radius), true, 'the surrounding below-map volume stays closed');
});

test('the fixed reactor exit endpoint is collision-free and portal traversal reaches the safe field edge', () => {
    const [pair] = MAP.portals;
    const a = new THREE.Vector3(...pair.a.map((value) => value * RUNTIME_WORLD_SCALE));
    const b = new THREE.Vector3(...pair.b.map((value) => value * RUNTIME_WORLD_SCALE));
    const entryRadius = Math.hypot(pair.a[0], pair.a[2]);
    assert.ok(entryRadius > 12, 'the reactor endpoint stays outside the radiation radius');
    assert.ok(entryRadius < 15.45, 'the reactor endpoint stays inside the containment ring');
    assert.ok(pair.a[1] > 0 && pair.a[1] < 26, 'the entry is in the open reactor hall, clear of the roof');
    assert.ok(Math.hypot(pair.b[0], pair.b[2]) > REACTOR_WRECK_REACH, 'the field endpoint clears all tower wreck reach');
    assert.ok(Math.abs(pair.b[0]) < REACTOR_HALF_SIZE && Math.abs(pair.b[2]) < REACTOR_HALF_SIZE);
    const portal = { posA: a, posB: b, forwardA: null, forwardB: null, cooldowns: new Map() };
    const arena = { portalsEnabled: true, portals: [portal] };
    const runtime = new PortalRuntimeSystem(arena);
    const transfer = runtime.checkPortal(a.clone(), 1, 'test-player');
    assert.equal(transfer.ok, true);
    assert.deepEqual(transfer.target.toArray(), b.toArray());
});

test('the opening view reaches the plant and traversal stays on persistent site geometry', () => {
    const spawnDistance = Math.hypot(MAP.playerSpawn.x, MAP.playerSpawn.z) * RUNTIME_WORLD_SCALE;
    assert.ok(MAP.lighting.fog.near < spawnDistance, 'the plant enters the fog before the spawn view');
    assert.ok(MAP.lighting.fog.far > spawnDistance, 'the plant remains visible from the opening spawn');

    assert.equal(MAP.items.length, 12);
    assert.equal(new Set(MAP.items.map((item) => item.id)).size, MAP.items.length, 'pickup ids stay unique');
    assert.equal(new Set(MAP.gates.map((gate) => gate.id)).size, MAP.gates.length, 'gate ids stay unique');
    for (const item of MAP.items) {
        assert.ok(Math.abs(item.x) < MAP.size[0] / 2 && Math.abs(item.z) < MAP.size[2] / 2, `${item.id} stays in the field`);
        assert.ok(item.y <= REACTOR_SITE_GROUND + 26 * REACTOR_SITE_METRE,
            `${item.id} is supported by the permanent site instead of a destructible roof or rim`);
    }
    for (const gate of MAP.gates) {
        assert.ok(Math.abs(gate.pos[0]) < MAP.size[0] / 2 && Math.abs(gate.pos[2]) < MAP.size[2] / 2, `${gate.id} stays in the field`);
    }
});

test('every model the map places exists on disk at the one shared scale', () => {
    for (const model of MAP.glbModels) {
        assert.ok(existsSync(path.resolve(model.url)), `${model.id} references a local GLB`);
        // The shared metre applies to everything authored for this map. Models taken from a
        // shared library are authored at their own size and normalised by targetSize instead;
        // forcing them to the reactor's metre would place them at whatever size their own
        // generator happened to pick.
        if (model.url.startsWith(FUNGUS_PREFIX)) continue;
        assert.equal(model.scale, REACTOR_SITE_METRE, `${model.id} shares the one scale factor`);
        assert.equal(model.targetSize, undefined, `${model.id} must not be size-normalised`);
    }
    for (const [id, baseMetres] of Object.entries(REACTOR_PART_BASE_METRES)) {
        const model = modelById(id);
        assert.ok(model, `${id} is placed`);
        assert.ok(Math.abs(model.position[1] - (REACTOR_SITE_GROUND + baseMetres * REACTOR_SITE_METRE)) < 1e-6,
            `${id} sits at the underside the generator reported`);
    }
    // The two towers are the same file at two places.
    assert.equal(modelById('reactor-cooling-tower-west').url, modelById('reactor-cooling-tower-east').url);
    assert.equal(modelById('reactor-cooling-tower-west').position[0], -modelById('reactor-cooling-tower-east').position[0]);
});

test('the contaminated growth stands where no collapse can reach it', () => {
    // Every collapse on this map throws its wreck to REACTOR_WRECK_REACH from the centre. A
    // mushroom inside that circle would end up standing inside a fallen cooling tower - not a
    // crash, and not something any other assertion notices, just a tower with a mushroom
    // through it for the rest of the round. The corners are the only ground outside the circle
    // and inside the field, and the margin is what makes that true for the whole clump rather
    // than for its centre.
    const fungus = MAP.glbModels.filter((model) => model.url.startsWith(FUNGUS_PREFIX));
    assert.ok(fungus.length >= 15, 'the perimeter is actually planted');
    for (const model of fungus) {
        const [x, y, z] = model.position;
        const reach = model.targetSize / 2;
        const distance = Math.hypot(x, z);
        assert.ok(distance - reach > REACTOR_WRECK_REACH,
            `${model.id} stands clear of every wreck: ${(distance - reach).toFixed(1)} > ${REACTOR_WRECK_REACH.toFixed(1)}`);
        assert.ok(Math.abs(x) + reach < REACTOR_HALF_SIZE && Math.abs(z) + reach < REACTOR_HALF_SIZE,
            `${model.id} stays inside the field`);
        assert.equal(y, REACTOR_SITE_GROUND, `${model.id} stands on the site's ground`);
        assert.equal(model.collision, false, `${model.id} stays decoration`);
    }
});

test('every break scene stays hidden until it is triggered and then plays once', () => {
    for (const [id, clipName] of Object.entries(REACTOR_SCENE_CLIPS)) {
        const model = modelById(id);
        assert.ok(model, `${id} is placed in the map`);
        assert.equal(model.hiddenUntilTriggered, true, `${id} is invisible while the plant stands`);
        assert.equal(model.animationClock?.mode, 'once', `${id} plays a single time`);
        assert.equal(model.animationClock.phaseOffsetBeats, undefined, `${id} inherits no beat offset`);
        const document = readGlbJson(model.url);
        assert.equal(document.animations?.length, 1, `${id} holds exactly one clip`);
        assert.equal(model.animationClock.clipName, document.animations[0].name, `${id} addresses the clip its GLB contains`);
        assert.equal(model.animationClock.clipName, clipName);
    }
});

test('a scene stands exactly where the intact part it replaces stands', () => {
    for (const [sceneId, intactId] of Object.entries(REACTOR_SCENE_INTACT_MODEL)) {
        const scene = modelById(sceneId);
        const intact = modelById(intactId);
        assert.ok(scene && intact, `${sceneId} and ${intactId} are placed`);
        // The loader drops a model onto its own bounding box, so a scene at a different place
        // would jump at the one moment the player is looking straight at it.
        assert.deepEqual(scene.position, intact.position, `${sceneId} shares its slot`);
        assert.deepEqual(scene.rotation, [0, 0, 0], `${sceneId} carries no authored turn`);
        const baseMetres = REACTOR_SCENE_BASE_METRES[sceneId];
        assert.ok(Math.abs(scene.position[1] - (REACTOR_SITE_GROUND + baseMetres * REACTOR_SITE_METRE)) < 1e-6,
            `${sceneId} sits at the underside the generator reported`);
    }
});

test('the permanent fuel core applies a strong collapse emissive and restores on round reset', () => {
    const controller = new MapDestructibleGlowController();
    const map = MAP.mapDestructibleGlow;
    const base = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x102030, emissiveIntensity: 0.6 });
    const rods = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), base);
    rods.name = 'reactor_fuel_rods';
    const unrelated = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), base);
    unrelated.name = 'reactor_wall_concrete';
    const slot = new THREE.Group();
    slot.name = 'glb-slot-reactor-site';
    slot.add(rods, unrelated);
    const scene = new THREE.Group();
    scene.add(slot);
    const intact = { segments: [{ id: 'reactor_dome', destroyed: false }] };
    const collapsed = { segments: [{ id: 'reactor_dome', destroyed: true }] };

    assert.equal(controller.update(scene, map, intact), true, 'late-loaded assets start with their intact material');
    assert.equal(base.emissiveIntensity, 0.6);
    assert.notEqual(rods.material, base, 'the targeted core gets a private material');
    assert.equal(unrelated.material, base, 'the unrelated mesh keeps the shared GLB material');
    assert.equal(controller.update(scene, map, collapsed), true);
    assert.equal(rods.material.emissiveIntensity, 8);
    assert.equal(rods.material.emissive.getHex(), 0xff5a1e);
    assert.equal(unrelated.material.emissiveIntensity, 0.6, 'a mesh sharing the source material stays unlit');
    assert.equal(unrelated.material.emissive.getHex(), 0x102030);
    assert.equal(controller.update(scene, map, collapsed), false, 'unchanged burn ticks do no material traversal');
    assert.equal(controller.update(scene, map, intact), true, 'round reset restores the asset emissive');
    assert.equal(rods.material.emissiveIntensity, 0.6);
    assert.equal(rods.material.emissive.getHex(), 0x102030);
    assert.equal(base.emissiveIntensity, 0.6);
    assert.equal(base.emissive.getHex(), 0x102030);
    rods.geometry.dispose();
    unrelated.geometry.dispose();
    rods.material.dispose();
    base.dispose();
});

test('a scene animates exactly the pieces its GLB carries and hides exactly its own part', () => {
    const def = definition();
    const placedIds = new Set(MAP.glbModels.map((model) => model.id));
    for (const scene of def.breakScenes) {
        assert.ok(placedIds.has(scene.modelId), `${scene.id} names a model the map places`);
        const document = readGlbJson(modelById(scene.modelId).url);
        const rigPieces = (document.scenes[document.scene || 0].nodes || [])
            .map((index) => String(document.nodes[index].name || ''))
            .filter((name) => name.startsWith('piece_'))
            .map((name) => name.slice('piece_'.length))
            .sort();
        assert.deepEqual([...scene.pieces].sort(), rigPieces, `${scene.id} lists the pieces its GLB really drops`);
        for (const piece of scene.pieces) assert.ok(def.pieces.includes(piece), `${piece} is one of the map's pieces`);
        // Every scene replaces one structure: it hides that structure's model and nothing else.
        const segmentId = Object.entries(SEGMENT_SCENES).find(([, id]) => id === scene.id)[0];
        assert.deepEqual([...scene.hideModelIds], [SEGMENT_MODELS[segmentId]], `${scene.id} hides its own part`);
        assert.equal(scene.trigger.segmentId, segmentId, `${scene.id} is triggered by its own segment`);
        assert.equal(scene.trigger.kind, '', `${scene.id} is not also triggered by kind`);
    }
    // No two scenes share a piece: each exists exactly once and can only fall once.
    const listed = def.breakScenes.flatMap((scene) => [...scene.pieces]);
    assert.equal(new Set(listed).size, listed.length, 'no piece is listed by two scenes');
    assert.deepEqual([...listed].sort(), [...REACTOR_SITE_PIECES].sort(), 'every piece is dropped by some scene');
});

test('segment prefixes claim every collidable mesh of their part and nothing of any other', () => {
    const def = definition();
    const staticModels = MAP.glbModels.filter((model) => model.hiddenUntilTriggered !== true);
    for (const segment of def.segments) {
        const own = readGlbJson(modelById(SEGMENT_MODELS[segment.id]).url);
        const matches = (names) => names.filter((name) => segment.meshPrefixes.some((prefix) => name.toLowerCase().startsWith(prefix)));
        assert.deepEqual(matches(collidableNodeNames(own)).sort(), collidableNodeNames(own).sort(),
            `${segment.id} claims every collidable mesh of ${SEGMENT_MODELS[segment.id]}`);
        for (const model of staticModels) {
            if (model.url === modelById(SEGMENT_MODELS[segment.id]).url) continue;
            assert.deepEqual(matches(nodeNames(readGlbJson(model.url))), [], `${segment.id} must not claim anything in ${model.id}`);
        }
        // ...nor anything in a scene: the wreck of a tower is not the tower.
        for (const sceneId of Object.keys(REACTOR_SCENE_CLIPS)) {
            assert.deepEqual(matches(nodeNames(readGlbJson(modelById(sceneId).url))), [], `${segment.id} must not claim anything in ${sceneId}`);
        }
    }
});

test('a tower keels onto its own side, the stack follows the shot, the hall and the cloud stay put', () => {
    const yAxis = new THREE.Vector3(0, 1, 0);
    const baked = new THREE.Vector3(1, 0, 0);   // every topple is baked falling towards +X
    for (const [segmentId, sign] of [['cooling_tower_w', -1], ['cooling_tower_e', 1]]) {
        const { segment, timeline } = breakSegment(segmentId);
        const [entry] = timeline;
        assert.ok(entry, `${segmentId} starts a collapse`);
        assert.equal(entry.yawFromEvent, true);
        const direction = baked.clone().applyAxisAngle(yAxis, entry.yaw);
        const corner = new THREE.Vector3(segment.anchor[0], 0, segment.anchor[2]).normalize();
        assert.ok(direction.distanceTo(corner) < 1e-6, `${segmentId} keels towards (${direction.x.toFixed(2)}, ${direction.z.toFixed(2)})`);
        assert.equal(Math.sign(direction.x), sign, `${segmentId} keels away from the plant`);
    }
    const stack = breakSegment('vent_stack', { x: 0, y: 0.3, z: -1 });
    const stackDirection = baked.clone().applyAxisAngle(yAxis, stack.timeline[0].yaw);
    assert.ok(stackDirection.distanceTo(new THREE.Vector3(0, 0, -1)) < 1e-6, 'the stack topples along the shot');
    for (const segmentId of ['turbine_hall', 'reactor_dome']) {
        const { timeline } = breakSegment(segmentId);
        assert.equal(timeline[0].yawFromEvent, false, `${SEGMENT_SCENES[segmentId]} is never turned`);
    }
});

test('the reactor seals the site; nothing else does', () => {
    const def = definition();
    for (const segment of def.segments) {
        const { state } = breakSegment(segment.id);
        assert.equal(state.sealed, segment.id === 'reactor_dome', `${segment.id} ${segment.id === 'reactor_dome' ? 'seals' : 'must not seal'}`);
    }
    // After the breach a tower can no longer be shot at.
    const { state } = breakSegment('reactor_dome');
    const refused = applyMapDestructibleDamage(state, def, 'cooling_tower_w', 50, { atSeconds: 9 });
    assert.equal(refused.applied, false, 'no damage books on a sealed site');
    // Before it, every structure can come down in any order, and the cloud still plays last.
    const open = createMapDestructibleState(def);
    for (const id of ['vent_stack', 'cooling_tower_e', 'turbine_hall', 'cooling_tower_w', 'reactor_dome']) {
        const segment = def.segments.find((entry) => entry.id === id);
        const result = applyMapDestructibleDamage(open, def, id, segment.hp, { atSeconds: 10, hitDirection: { x: 1, y: 0, z: 0 } });
        assert.equal(result.destroyed, true, `${id} comes down`);
    }
    const timeline = resolveMapDestructibleSceneTimeline(def, open.events);
    assert.deepEqual(timeline.map((entry) => entry.sceneId), ['topple_stack', 'topple_tower_e', 'collapse_hall', 'topple_tower_w', 'mushroom_cloud']);
    for (const entry of timeline) assert.deepEqual(entry.hiddenPieceIds, [], `${entry.sceneId} hides no piece of another scene`);
});

test('the field is wide enough for the wreck and the fallback ground covers it', () => {
    const [sizeX, sizeY, sizeZ] = MAP.size;
    assert.equal(sizeX / 2, REACTOR_HALF_SIZE);
    assert.ok(REACTOR_HALF_SIZE >= REACTOR_WRECK_REACH + WRECK_MARGIN, `half of ${sizeX} must clear the wreck at ${REACTOR_WRECK_REACH.toFixed(1)}`);
    assert.ok(sizeZ / 2 >= REACTOR_WRECK_REACH + WRECK_MARGIN);
    // The cloud climbs past the ceiling on purpose; the standing plant does not.
    assert.ok(REACTOR_SITE_GROUND + 100 * REACTOR_SITE_METRE < sizeY);
    assert.ok(REACTOR_SITE_GROUND_TILES.length > 1);
    assert.ok(REACTOR_SITE_GROUND_TILES.every((ground) => ground.kind === 'foam' && ground.compileWithGlb === true));
    assert.equal(Math.min(...REACTOR_SITE_GROUND_TILES.map((tile) => tile.pos[0] - tile.size[0] / 2)), -sizeX / 2);
    assert.equal(Math.max(...REACTOR_SITE_GROUND_TILES.map((tile) => tile.pos[0] + tile.size[0] / 2)), sizeX / 2);
    assert.equal(Math.min(...REACTOR_SITE_GROUND_TILES.map((tile) => tile.pos[2] - tile.size[2] / 2)), -sizeZ / 2);
    assert.equal(Math.max(...REACTOR_SITE_GROUND_TILES.map((tile) => tile.pos[2] + tile.size[2] / 2)), sizeZ / 2);
    // Nothing authored above the apron is drawn beside the GLBs, so nothing can be left hanging
    // where a structure was. The one exception is the secret room below the site: no GLB draws it,
    // and no collapse can reach under the ground to leave it hanging.
    for (const obstacle of MAP.obstacles) {
        if (obstacle.pos?.[1] < 0) continue;
        assert.notEqual(obstacle.renderWithGlb, true, 'no drawn fallback box');
    }
    for (const spawn of [MAP.playerSpawn, ...MAP.botSpawns]) {
        assert.ok(Math.abs(spawn.x) < sizeX / 2 && Math.abs(spawn.z) < sizeZ / 2, `spawn (${spawn.x}, ${spawn.z}) is in the field`);
        assert.ok(spawn.y > REACTOR_SITE_GROUND && spawn.y < sizeY, `spawn y ${spawn.y}`);
    }
});

test('the destructible block survives normalization without losing anything', () => {
    const def = definition();
    assert.equal(def.segments.length, 5);
    assert.equal(def.breakScenes.length, 5);
    assert.equal(def.pieces.length, 12);
    assert.deepEqual([...def.gameModes], ['HUNT']);
    assert.deepEqual(def.segments.map((segment) => segment.id), MAP.destructibles.segments.map((segment) => segment.id));
    assert.deepEqual(def.segments.map((segment) => segment.hp), MAP.destructibles.segments.map((segment) => segment.hp));
    assert.deepEqual(def.segments.map((segment) => segment.piece), MAP.destructibles.segments.map((segment) => segment.piece));
    assert.deepEqual(def.breakScenes.map((scene) => scene.id), MAP.destructibles.breakScenes.map((scene) => scene.id));
    for (const scene of def.breakScenes) {
        const authored = MAP.destructibles.breakScenes.find((entry) => entry.id === scene.id);
        assert.deepEqual([...scene.pieces], authored.pieces, `${scene.id} keeps its pieces`);
        assert.deepEqual([...scene.hideModelIds], authored.hideModelIds, `${scene.id} keeps its hidden models`);
        assert.equal(scene.yawFromEvent, !UNTURNED_SCENES.includes(scene.id), `${scene.id} turns or not as authored`);
    }
    for (const segment of def.segments) {
        assert.notEqual(segment.label, segment.id, `${segment.id} has a readable label`);
        assert.ok(def.pieces.includes(segment.piece), `${segment.id} belongs to a listed piece`);
    }
});

test('the reactor room has exactly one host-owned bomber and lightning pickup that vanish with containment', () => {
    const [bomber, lightning] = MAP.mapOwnedPickups;
    assert.equal(MAP.mapOwnedPickups.length, 2);
    assert.deepEqual([bomber.id, lightning.id], ['rs_bomber_strike_core', 'rs_lightning_core']);
    assert.deepEqual([bomber.pickupType, lightning.pickupType], ['BOMBER_STRIKE', 'LIGHTNING']);
    assert.ok(MAP.mapOwnedPickups.every((entry) => entry.despawnOnBreakSegment === 'reactor_dome'));
    assert.ok(MAP.mapOwnedPickups.every((entry) => entry.x === 0 && Math.abs(entry.z) >= 8));

    const spawned = [];
    const removed = [];
    const owner = {
        arena: { currentMapDefinition: MAP },
        powerupManager: {
            spawnAtAnchor(anchor) {
                const item = { ownerId: anchor.ownerId, type: anchor.type, anchor };
                spawned.push(item);
                return item;
            },
            removeByOwnerId(ownerId) { removed.push(ownerId); },
        },
        _mapDestructibleSystem: { getState: () => ({ events: [] }) },
    };
    const system = new MapOwnedPickupSystem(owner);
    assert.equal(system.startRound(), 2);
    assert.deepEqual(spawned.map((entry) => entry.type), ['BOMBER_STRIKE', 'LIGHTNING']);
    assert.deepEqual(spawned.map((entry) => entry.anchor.ownerId), [
        'map-owned:rs_bomber_strike_core', 'map-owned:rs_lightning_core',
    ]);
    assert.equal(spawned[0].anchor.x, 0);
    assert.equal(spawned[1].anchor.x, 0);
    assert.ok(Math.abs(spawned[0].anchor.z + 25.2) < 1e-9);
    assert.ok(Math.abs(spawned[1].anchor.z - 25.2) < 1e-9);

    owner._mapDestructibleSystem.getState = () => ({ events: [{ segmentId: 'cooling_tower_w' }] });
    system.update();
    assert.deepEqual(removed, []);
    owner._mapDestructibleSystem.getState = () => ({ events: [{ segmentId: 'reactor_dome' }] });
    system.update();
    system.update();
    assert.deepEqual(removed, ['map-owned:rs_bomber_strike_core', 'map-owned:rs_lightning_core']);
    assert.deepEqual(spawned.length, 2, 'the map-owned pickup system never respawns an item after collapse');

    owner._mapDestructibleSystem.getState = () => ({ events: [] });
    assert.equal(system.startRound(), 2, 'round reset reinitializes the two fixed pickups');
    assert.equal(spawned.length, 4);
    assert.deepEqual(removed.slice(-2), ['map-owned:rs_bomber_strike_core', 'map-owned:rs_lightning_core']);
    const replicaSystem = new MapOwnedPickupSystem(owner);
    replicaSystem.setNetworkReplica(true);
    replicaSystem.startRound();
    assert.equal(spawned.length, 4, 'replicas leave spawning and lifetime removal to the host snapshot');
});

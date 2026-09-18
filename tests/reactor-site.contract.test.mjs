import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as THREE from 'three';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
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
} from '../src/core/config/maps/presets/reactor_site/ReactorSiteStructure.js';
import { REACTOR_SITE_PIECES } from '../src/core/config/maps/presets/reactor_site/ReactorSiteDestructibles.js';
import {
    applyMapDestructibleDamage,
    createMapDestructibleState,
    normalizeMapDestructibles,
    resolveMapDestructibleSceneTimeline,
} from '../src/shared/contracts/MapDestructibleContract.js';
import { resolveMapSinglePlayerScenario } from '../src/shared/contracts/MapSinglePlayerScenarioContract.js';

// The map preset of the reactor site. The Blender side of the same contract lives in
// reactor-site-blender-assets.contract.test.mjs; this file checks the half the preset owns: that
// the scenes are placed where the intact parts stand, address the clips their files really
// contain, name models that exist, and that every structure comes down the way the break plan
// says - towers onto their own side, the stack along the shot, the hall and the cloud in place.

const MAP_KEY = 'reactor_site';
const MAP = MAP_PRESET_CATALOG[MAP_KEY];
const WRECK_MARGIN = 20;
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
    assert.deepEqual(MAP.portals, []);
    const scenario = resolveMapSinglePlayerScenario(MAP);
    assert.equal(scenario?.gameMode, 'HUNT');
    assert.equal(scenario?.modePath, 'fight');
    assert.equal(scenario?.id, MAP_KEY);
    assert.ok(scenario.minBots >= 1 && scenario.minBots <= scenario.botCount);
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
    const [ground] = MAP.obstacles;
    assert.equal(ground.kind, 'foam');
    assert.equal(ground.compileWithGlb, true);
    assert.ok(ground.size[0] >= sizeX && ground.size[2] >= sizeZ, 'the fallback ground spans the field');
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

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as THREE from 'three';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MAP_PRESETS } from '../src/core/config/MapPresets.js';
import { getRuntimeMapDefinition } from '../src/shared/contracts/RuntimeMapCatalogContract.js';
import { resolveMapPickerCollection } from '../src/ui/menu/MenuMapCollectionCatalog.js';
import { EIFFEL_TOWER_MAPS } from '../src/core/config/maps/presets/eiffel_tower/index.js';
import {
    EIFFEL_TOWER_METRE,
    EIFFEL_TOWER_GROUND,
} from '../src/core/config/maps/presets/eiffel_tower/EiffelTowerModels.js';
import {
    FIRST_DECK,
    SECOND_DECK,
} from '../src/core/config/maps/presets/eiffel_tower/EiffelTowerStructure.js';
import {
    EIFFEL_SIEGE_ESPLANADE_ID,
    EIFFEL_SIEGE_ESPLANADE_URL,
    EIFFEL_SIEGE_SCENE_BASE_METRES,
    EIFFEL_SIEGE_SCENE_CLIPS,
} from '../src/core/config/maps/presets/eiffel_tower_siege/EiffelTowerSiegeModels.js';
import {
    applyMapDestructibleDamage,
    createMapDestructibleState,
    normalizeMapDestructibles,
    resolveMapDestructibleSceneTimeline,
} from '../src/shared/contracts/MapDestructibleContract.js';
import { resolveMapSinglePlayerScenario } from '../src/shared/contracts/MapSinglePlayerScenarioContract.js';

// The map preset of the destructible Eiffel Tower. The Blender side of the same contract lives in
// eiffel-tower-siege-blender-assets.contract.test.mjs; this file checks the half the preset owns:
// that the scenes are placed where the intact parts stand, address the clips their files really
// contain, name models that exist, and topple towards the leg that was shot out.

const SIEGE_MAP_KEY = 'eiffel_tower_siege';
const MAP = MAP_PRESET_CATALOG[SIEGE_MAP_KEY];

// How far the wreck of a toppled tower reaches from the axis, in authored units, plus the margin
// the map keeps beyond it. Both numbers come from the baked falls, not from taste.
// 218.2 m, the furthest any piece of a collapse settles from the axis (see the Blender asset test,
// which derives it from the files rather than stating it), in authored units at 0.6 per metre.
const WRECK_REACH = 218.2 * 0.6;
const WRECK_MARGIN = 20;

// Which intact models each piece of the tower is made of. A scene that drops a piece has to take
// every one of them off the screen, or something stays hanging in the air where the tower was.
const PIECE_MODELS = Object.freeze({
    lower: [
        'eiffel-legs-lower',
        'eiffel-arches',
        'eiffel-first-floor',
        'eiffel-lift-north-east',
        'eiffel-lift-south-west',
        'eiffel-illumination-iris',
    ],
    mid: ['eiffel-legs-mid', 'eiffel-second-floor'],
    shaft: ['eiffel-shaft', 'eiffel-summit-lift'],
    summit: ['eiffel-summit', 'eiffel-beacon'],
});

// Which intact part each segment prefix set belongs to, and which scene replaces which part.
const SEGMENT_PARTS = Object.freeze({
    legs_lower: 'eiffel_tower/glb/02_legs_lower',
    legs_mid: 'eiffel_tower/glb/05_legs_mid',
    shaft: 'eiffel_tower/glb/07_shaft',
    summit: 'eiffel_tower/glb/08_summit',
});
const SEGMENT_PART_BY_KIND = Object.freeze({
    leg_lower: 'legs_lower',
    leg_mid: 'legs_mid',
    shaft: 'shaft',
    summit: 'summit',
});
// Scene model id -> the intact model whose slot height it has to share exactly.
const SCENE_INTACT_MODEL = Object.freeze({
    'eiffel-topple-lower': 'eiffel-legs-lower',
    'eiffel-topple-mid': 'eiffel-legs-mid',
    'eiffel-topple-shaft': 'eiffel-shaft',
    'eiffel-topple-summit': 'eiffel-summit',
});

function readGlb(relativePath) {
    const bytes = readFileSync(path.resolve(`assets/maps/${relativePath}.glb`));
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${relativePath} has a GLB header`);
    const jsonLength = bytes.readUInt32LE(12);
    const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
    // The binary chunk follows the JSON one, behind its own eight byte header.
    return { document, binary: bytes.subarray(20 + jsonLength + 8) };
}

function readGlbJson(relativePath) {
    return readGlb(relativePath).document;
}

const ACCESSOR_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** One element of a float accessor, as a plain array. */
function readAccessorElement({ document, binary }, accessorIndex, element) {
    const accessor = document.accessors[accessorIndex];
    assert.equal(accessor.componentType, 5126, 'animation samplers are stored as floats');
    const view = document.bufferViews[accessor.bufferView];
    const size = ACCESSOR_COMPONENTS[accessor.type];
    const stride = view.byteStride || size * 4;
    const offset = (view.byteOffset || 0) + (accessor.byteOffset || 0) + element * stride;
    return Array.from({ length: size }, (_value, index) => binary.readFloatLE(offset + index * 4));
}

/**
 * The world heading a scene's clip actually falls towards, read out of the asset: where the named
 * rig has arrived by its last translation keyframe, measured against where it started.
 */
function bakedHeadingOf(fileStem, rigName) {
    const glb = readGlb(`eiffel_tower_siege/glb/${fileStem}`);
    const { document } = glb;
    const nodeIndex = document.nodes.findIndex((node) => node.name === rigName);
    assert.ok(nodeIndex >= 0, `${fileStem} has a rig named ${rigName}`);

    const [animation] = document.animations;
    const channel = animation.channels.find(
        (entry) => entry.target.node === nodeIndex && entry.target.path === 'translation',
    );
    assert.ok(channel, `${rigName} is moved by ${fileStem}`);
    const sampler = animation.samplers[channel.sampler];
    const frames = document.accessors[sampler.output].count;
    const rest = document.nodes[nodeIndex].translation || [0, 0, 0];
    const last = readAccessorElement(glb, sampler.output, frames - 1);
    // The GLB is already exported Y-up, so x and z are the two ground axes here as well.
    return Math.atan2(last[0] - rest[0], last[2] - rest[2]);
}

function nodeNames(document) {
    return (document.nodes || []).map((node) => String(node.name || ''));
}

/** Mesh nodes that can carry a collider; `_nocol` marks decor the loader never collides with. */
function collidableNodeNames(document) {
    return (document.nodes || [])
        .filter((node) => node.mesh !== undefined && !String(node.name || '').toLowerCase().includes('_nocol'))
        .map((node) => String(node.name));
}

function modelById(id) {
    return MAP.glbModels.find((model) => model.id === id) || null;
}

function sceneModels() {
    return Object.keys(EIFFEL_SIEGE_SCENE_CLIPS).map((id) => {
        const model = modelById(id);
        assert.ok(model, `${id} is placed in the map`);
        return model;
    });
}

function sceneDocument(model) {
    return readGlbJson(`eiffel_tower_siege/glb/${path.basename(model.url, '.glb')}`);
}

test('the siege map reaches the runtime, not just the catalog', () => {
    // Being in MAP_PRESET_CATALOG is not enough: the runtime plays CONFIG.MAPS, which is built
    // from the key list in MapPresetsBase.js. A map missing there cannot be picked at all, and a
    // forced map key quietly falls back to `standard` instead of failing.
    assert.ok(MAP_PRESET_CATALOG[SIEGE_MAP_KEY], 'the siege map is in the catalog');
    assert.ok(MAP_PRESETS[SIEGE_MAP_KEY], 'the siege map is in the runtime map set');
    assert.equal(MAP_PRESETS[SIEGE_MAP_KEY], MAP_PRESET_CATALOG[SIEGE_MAP_KEY]);
    assert.equal(
        getRuntimeMapDefinition(SIEGE_MAP_KEY, MAP_PRESETS).name,
        'Eiffelturm Belagerung',
        'asking the runtime for the siege map must not fall back to another one',
    );

    // ...and the picker has to file it somewhere, or it lands in the catch-all group.
    assert.equal(
        resolveMapPickerCollection(SIEGE_MAP_KEY).id,
        'arena',
        'a siege is fought rather than flown as a course, so it lives with the arenas',
    );
});

test('the siege map is registered and reuses the tower it is built on', () => {
    assert.ok(MAP, 'the siege map is in the catalog');
    assert.equal(MAP.name, 'Eiffelturm Belagerung');
    // Derived from the route map rather than copied: the lattice, the machines and the triangle
    // collision are the expensive part and must stay one source.
    assert.equal(MAP.glbColliderMode, EIFFEL_TOWER_MAPS.eiffel_tower.glbColliderMode);
    assert.equal(MAP.glbAuthoredObstaclesCollisionOnly, true);
    assert.equal(MAP.scaleAuthoredAnchors, true);
    // A siege is fought, not flown as a course.
    assert.equal(MAP.parcours, undefined);

    const scenario = resolveMapSinglePlayerScenario(MAP);
    assert.equal(scenario?.gameMode, 'HUNT');
    assert.equal(scenario?.modePath, 'fight');
    assert.equal(scenario?.id, SIEGE_MAP_KEY);
    assert.equal(scenario?.botCount, 5);
    assert.ok(scenario.minBots >= 1 && scenario.minBots <= scenario.botCount);
});

test('every model the siege map places exists on disk', () => {
    for (const model of MAP.glbModels) {
        const filePath = path.resolve(model.url);
        if (model.id === EIFFEL_SIEGE_ESPLANADE_ID && !existsSync(filePath)) {
            // The wide Champ-de-Mars is exported by the Blender stage of this map. Everything else
            // is asserted either way, so a missing esplanade must not hide a broken tower.
            console.log(`skipped: ${EIFFEL_SIEGE_ESPLANADE_URL} is not exported yet`);
            continue;
        }
        assert.ok(existsSync(filePath), `${model.id} references a local GLB`);
        if (model.collision === false) {
            assert.ok(model.targetSize > 0, `${model.id} has an explicit decorative size`);
            assert.equal(model.scale, undefined, `${model.id} uses target sizing rather than tower scale`);
        } else {
            assert.equal(model.scale, EIFFEL_TOWER_METRE, `${model.id} shares the one tower scale factor`);
            assert.equal(model.targetSize, undefined, `${model.id} must not be size-normalised`);
        }
    }
    assert.equal(modelById(EIFFEL_SIEGE_ESPLANADE_ID)?.url, EIFFEL_SIEGE_ESPLANADE_URL);
    // The narrow esplanade of the route map is replaced, not placed alongside.
    assert.equal(modelById('eiffel-champ-de-mars'), null);
});

test('every break scene stays hidden until it is triggered and then plays once', () => {
    for (const model of sceneModels()) {
        assert.equal(model.hiddenUntilTriggered, true, `${model.id} is invisible while the tower stands`);
        // A collapse that looped would put the tower back up and drop it again.
        assert.equal(model.animationClock?.mode, 'once', `${model.id} plays a single time`);
        assert.equal(model.animationClock.phaseOffsetBeats, undefined,
            `${model.id} must not inherit a beat offset into its fall`);

        const document = sceneDocument(model);
        assert.equal(document.animations?.length, 1, `${model.id} holds exactly one clip`);
        assert.equal(
            model.animationClock.clipName,
            document.animations[0].name,
            `${model.id} addresses the clip its GLB actually contains`,
        );
        assert.equal(model.animationClock.clipName, EIFFEL_SIEGE_SCENE_CLIPS[model.id]);
    }
});

test('a scene stands exactly where the intact part it replaces stands', () => {
    for (const model of sceneModels()) {
        const intact = modelById(SCENE_INTACT_MODEL[model.id]);
        assert.ok(intact, `${model.id} replaces a model the map still places`);
        // The loader drops a model onto its own bounding box, so a scene at a different height
        // would jump at the one moment the player is looking straight at it.
        assert.deepEqual(model.position, intact.position, `${model.id} shares its slot height`);
        assert.deepEqual(model.rotation, [0, 0, 0], `${model.id} carries no authored turn`);
        assert.equal(model.scale, EIFFEL_TOWER_METRE);

        const baseMetres = EIFFEL_SIEGE_SCENE_BASE_METRES[model.id];
        assert.ok(
            Math.abs(model.position[1] - (EIFFEL_TOWER_GROUND + baseMetres * EIFFEL_TOWER_METRE)) < 1e-6,
            `${model.id} sits at the underside the generator reported`,
        );
    }
});

test('a scene animates exactly the pieces its GLB carries, and hides models that exist', () => {
    const definition = normalizeMapDestructibles(MAP.destructibles);
    assert.ok(definition);
    const placedIds = new Set(MAP.glbModels.map((model) => model.id));

    for (const scene of definition.breakScenes) {
        assert.ok(placedIds.has(scene.modelId), `${scene.id} names a model the map places`);
        for (const hidden of scene.hideModelIds) {
            assert.ok(placedIds.has(hidden), `${scene.id} hides ${hidden}, which the map places`);
        }

        const document = sceneDocument(modelById(scene.modelId));
        const rigPieces = (document.scenes[document.scene || 0].nodes || [])
            .map((index) => String(document.nodes[index].name || ''))
            .filter((name) => name.startsWith('piece_'))
            .map((name) => name.slice('piece_'.length))
            .sort();
        assert.deepEqual(
            [...scene.pieces].sort(),
            rigPieces,
            `${scene.id} lists the pieces its GLB really drops`,
        );
        for (const piece of scene.pieces) {
            assert.ok(definition.pieces.includes(piece), `${piece} is one of the map's pieces`);
        }
    }
});

test('segment prefixes claim their own iron and never the lift running through it', () => {
    const definition = normalizeMapDestructibles(MAP.destructibles);
    const everyPart = Object.values(SEGMENT_PARTS);

    for (const segment of definition.segments) {
        const part = SEGMENT_PART_BY_KIND[segment.kind];
        const document = readGlbJson(SEGMENT_PARTS[part]);
        const matches = (names) => names.filter(
            (name) => segment.meshPrefixes.some((prefix) => name.toLowerCase().startsWith(prefix)),
        );

        // Every mesh of the part that can carry a collider answers to this segment - and nothing
        // else in the file does, so a hit anywhere on the part books on exactly one segment.
        assert.deepEqual(
            matches(collidableNodeNames(document)).sort(),
            collidableNodeNames(document).sort(),
            `${segment.id} claims every collidable mesh of ${part}`,
        );

        // The summit lift's guides are named shaft_lift_* and are a machine, not the tower: a
        // prefix of `shaft_` would quietly make the lift part of the shaft's health bar.
        for (const other of everyPart.filter((entry) => entry !== SEGMENT_PARTS[part])) {
            assert.deepEqual(matches(collidableNodeNames(readGlbJson(other))), [],
                `${segment.id} must not claim ${other}`);
        }
        for (const machine of ['09_leg_elevator', '10_shaft_lift', '11_beacon', '12_illumination_ring']) {
            assert.deepEqual(
                matches(nodeNames(readGlbJson(`eiffel_tower/glb/${machine}`))),
                [],
                `${segment.id} must not claim anything in ${machine}`,
            );
        }
        // Decor marked _nocol never produces a collider and so can never report a hit; what must
        // not happen is a segment reaching into another part's file, which is checked above.
        for (const name of matches(nodeNames(document))) {
            assert.ok(name.startsWith(part.split('_')[0]), `${name} belongs to ${part}`);
        }
    }
});

test('every scene states the heading its clip was really baked falling towards', () => {
    // The number the preset writes down is checked against the asset itself, because getting it
    // wrong does not fail anywhere else - the tower simply lands in the wrong direction.
    const definition = normalizeMapDestructibles(MAP.destructibles);
    for (const scene of definition.breakScenes) {
        const model = modelById(scene.modelId);
        const fileStem = path.basename(model.url, '.glb');
        const measured = bakedHeadingOf(fileStem, 'piece_summit');
        assert.ok(
            Math.abs(measured - scene.bakedHeading) < 0.05,
            `${scene.id} states ${scene.bakedHeading.toFixed(3)} rad, the clip falls towards ${measured.toFixed(3)}`,
        );
    }
    // All four were authored the same way: towards world (+X, -Z).
    const headings = definition.breakScenes.map((scene) => scene.bakedHeading);
    assert.deepEqual(headings, headings.map(() => Math.atan2(1, -1)));
});

test('a leg brings the tower down onto its own corner', () => {
    const definition = normalizeMapDestructibles(MAP.destructibles);
    const yAxis = new THREE.Vector3(0, 1, 0);

    const legs = definition.segments.filter((segment) => segment.kind.startsWith('leg_'));
    assert.equal(legs.length, 8, 'four lower legs and four mid legs');
    for (const segment of legs) {
        const state = createMapDestructibleState(definition);
        applyMapDestructibleDamage(state, definition, segment.id, segment.hp, { atSeconds: 4 });
        const [entry] = resolveMapDestructibleSceneTimeline(definition, state.events);
        assert.ok(entry, `${segment.id} starts a collapse`);

        // Turning the baked fall by the timeline's yaw has to point it at this leg's own corner.
        const direction = new THREE.Vector3(1, 0, -1).normalize().applyAxisAngle(yAxis, entry.yaw);
        const corner = new THREE.Vector3(segment.anchor[0], 0, segment.anchor[2]).normalize();
        assert.ok(
            direction.distanceTo(corner) < 1e-6,
            `${segment.id} falls towards (${direction.x.toFixed(2)}, ${direction.z.toFixed(2)})`,
        );
    }

    // The shaft and the summit stand on the axis, so they follow the shot that felled them.
    for (const segment of definition.segments.filter((entry) => !entry.kind.startsWith('leg_'))) {
        assert.deepEqual([segment.anchor[0], segment.anchor[2]], [0, 0], `${segment.id} is axis-centred`);
        const state = createMapDestructibleState(definition);
        applyMapDestructibleDamage(state, definition, segment.id, segment.hp, {
            atSeconds: 4,
            hitDirection: { x: 1, y: 0.3, z: 0 },
        });
        const [entry] = resolveMapDestructibleSceneTimeline(definition, state.events);
        const direction = new THREE.Vector3(1, 0, -1).normalize().applyAxisAngle(yAxis, entry.yaw);
        assert.ok(
            direction.distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-6,
            `${segment.id} flies along the shot, towards (${direction.x.toFixed(2)}, ${direction.z.toFixed(2)})`,
        );
    }
});

test('a scene takes every model of the pieces it carries away off the screen', () => {
    const definition = normalizeMapDestructibles(MAP.destructibles);
    // Every model of the map belongs to a piece or stands outside the tower altogether.
    const claimed = new Set(Object.values(PIECE_MODELS).flat());
    for (const modelId of claimed) {
        assert.ok(modelById(modelId), `${modelId} is placed by the map`);
    }

    for (const scene of definition.breakScenes) {
        const expected = scene.pieces.flatMap((piece) => PIECE_MODELS[piece] || []).sort();
        assert.ok(expected.length > 0, `${scene.id} drops known pieces`);
        assert.deepEqual(
            [...scene.hideModelIds].sort(),
            expected,
            `${scene.id} hides exactly the models of the pieces it drops`,
        );
    }
});

test('the field is wide enough for the wreck and the fallback ground covers it', () => {
    const [sizeX, sizeY, sizeZ] = MAP.size;
    assert.ok(sizeX / 2 >= WRECK_REACH + WRECK_MARGIN, `half of ${sizeX} must clear the wreck`);
    assert.ok(sizeZ / 2 >= WRECK_REACH + WRECK_MARGIN, `half of ${sizeZ} must clear the wreck`);
    // The tip still has to fit under the ceiling, exactly as on the route map.
    assert.ok(EIFFEL_TOWER_GROUND + 330 * EIFFEL_TOWER_METRE < sizeY);

    const [ground] = MAP.obstacles;
    assert.equal(ground.kind, 'foam');
    assert.equal(ground.compileWithGlb, true);
    assert.deepEqual(ground.pos, [0, 4, 0]);
    assert.ok(ground.size[0] >= sizeX, `the fallback ground spans ${ground.size[0]} of ${sizeX}`);
    assert.ok(ground.size[2] >= sizeZ, `the fallback ground spans ${ground.size[2]} of ${sizeZ}`);

    // Nothing authored may be left hanging where the tower used to be. The route map's two gallery
    // landing platforms are drawn as well as compiled, so they would stay visible in mid-air after
    // the collapse; the approach pad on the esplanade stands on ground that does not fall.
    const routeObstacles = EIFFEL_TOWER_MAPS.eiffel_tower.obstacles;
    const dropped = routeObstacles.filter((obstacle) => !MAP.obstacles.slice(1).includes(obstacle));
    assert.deepEqual(
        dropped.slice(1).map((obstacle) => obstacle.pos[1]),
        [FIRST_DECK + 0.4, SECOND_DECK + 0.4],
        'exactly the two gallery platforms are dropped',
    );
    for (const obstacle of MAP.obstacles) {
        if (obstacle.renderWithGlb !== true) continue;
        assert.ok(obstacle.pos[1] < FIRST_DECK, `a drawn box at ${obstacle.pos[1]} would float`);
    }

    // The route map's portals end on the summit and in the open middle - both places the tower can
    // take away underneath a player. A siege is flown, not shortcut.
    assert.deepEqual(MAP.portals, []);

    // Every spawn stands inside the field it was pushed out into.
    for (const spawn of [MAP.playerSpawn, ...MAP.botSpawns]) {
        assert.ok(Math.abs(spawn.x) < sizeX / 2, `spawn x ${spawn.x}`);
        assert.ok(Math.abs(spawn.z) < sizeZ / 2, `spawn z ${spawn.z}`);
        assert.ok(spawn.y > EIFFEL_TOWER_GROUND && spawn.y < sizeY, `spawn y ${spawn.y}`);
    }
});

test('the destructible block survives normalization without losing anything', () => {
    const definition = normalizeMapDestructibles(MAP.destructibles);
    assert.equal(definition?.segments.length, 10);
    assert.equal(definition.breakScenes.length, 4);
    assert.deepEqual([...definition.pieces], ['lower', 'mid', 'shaft', 'summit']);
    // Only the hunt brings the tower down; every other mode flies the same place as intact iron.
    assert.deepEqual([...definition.gameModes], ['HUNT']);

    assert.deepEqual(
        definition.segments.map((segment) => segment.id),
        MAP.destructibles.segments.map((segment) => segment.id),
        'no authored segment is dropped or reordered',
    );
    assert.deepEqual(
        definition.segments.map((segment) => segment.hp),
        MAP.destructibles.segments.map((segment) => segment.hp),
    );
    assert.deepEqual(
        definition.breakScenes.map((scene) => scene.id),
        MAP.destructibles.breakScenes.map((scene) => scene.id),
    );
    for (const scene of definition.breakScenes) {
        const authored = MAP.destructibles.breakScenes.find((entry) => entry.id === scene.id);
        assert.deepEqual([...scene.pieces], authored.pieces, `${scene.id} keeps its pieces`);
        assert.deepEqual([...scene.hideModelIds], authored.hideModelIds, `${scene.id} keeps its hidden models`);
        assert.equal(scene.yawFromEvent, true, `${scene.id} turns with the break`);
    }
    // Every segment carries a label the HUD can print rather than falling back to its id.
    for (const segment of definition.segments) {
        assert.notEqual(segment.label, segment.id, `${segment.id} has a readable label`);
    }
});

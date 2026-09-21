import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as THREE from 'three';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MAP_PRESETS_BASE } from '../src/core/config/maps/MapPresetsBase.js';
import { normalizeGLBModelCollection } from '../src/entities/GLBMapLoader.js';
import { normalizeMapFogLayer, resolveMapFogLayerState } from '../src/shared/contracts/MapFogLayerContract.js';
import {
    CANOPY_DECK,
    FOREST_CLEARINGS,
    FOREST_GROUND,
    FOREST_HALF_SIZE,
    isInsideClearing,
} from '../src/core/config/maps/presets/giant_forest/GiantForestStructure.js';
import { TREE_SCALE } from '../src/core/config/maps/presets/giant_forest/GiantForestTrees.js';

// The giant forest is the first map that places a drawn model and a separate collision body in
// the same spot. This file is the half of that contract the preset depends on: that the two files
// really do end up in one place, that nothing is planted where the map says there is a clearing,
// and that the fog turns over instead of merely rising.
//
// The alignment numbers in GiantForestTrees.js are recomputed here from the GLBs themselves, so
// regenerating the tree variants cannot leave the collision standing beside its tree.

const MAP = MAP_PRESET_CATALOG.giant_forest;
/** CONFIG.ARENA.MAP_SCALE: what the arena multiplies every authored coordinate by. */
const MAP_SCALE = 3;

function readGlb(relativePath) {
    const bytes = readFileSync(path.resolve(relativePath));
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${relativePath} is a GLB`);
    const jsonLength = bytes.readUInt32LE(12);
    return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
}

/** Bounding box of a GLB's rest pose with every node transform applied. */
function restBounds(document) {
    const bounds = new THREE.Box3().makeEmpty();
    const corner = new THREE.Vector3();
    const visit = (nodeIndex, parentMatrix) => {
        const node = document.nodes?.[nodeIndex];
        if (!node) return;
        const local = new THREE.Matrix4();
        if (node.matrix) {
            local.fromArray(node.matrix);
        } else {
            local.compose(
                new THREE.Vector3().fromArray(node.translation || [0, 0, 0]),
                new THREE.Quaternion().fromArray(node.rotation || [0, 0, 0, 1]),
                new THREE.Vector3().fromArray(node.scale || [1, 1, 1]),
            );
        }
        const world = new THREE.Matrix4().multiplyMatrices(parentMatrix, local);
        if (node.mesh !== undefined) {
            for (const primitive of document.meshes[node.mesh].primitives) {
                const accessor = document.accessors[primitive.attributes.POSITION];
                for (const x of [accessor.min[0], accessor.max[0]]) {
                    for (const y of [accessor.min[1], accessor.max[1]]) {
                        for (const z of [accessor.min[2], accessor.max[2]]) {
                            bounds.expandByPoint(corner.set(x, y, z).applyMatrix4(world));
                        }
                    }
                }
            }
        }
        for (const child of node.children || []) visit(child, world);
    };
    for (const root of document.scenes[document.scene || 0].nodes) visit(root, new THREE.Matrix4());
    return bounds;
}

/**
 * The point the loader pins a model by: its box centre on X and Z, its lowest point on Y.
 * placeCollectionScene offsets every scene by exactly this before scaling it.
 */
function loaderOrigin(relativePath) {
    const bounds = restBounds(readGlb(relativePath));
    const centre = bounds.getCenter(new THREE.Vector3());
    return new THREE.Vector3(centre.x, bounds.min.y, centre.z);
}

/** Where a model's own origin ends up in the world, given how the preset places it. */
function placedModelOrigin(descriptor) {
    const origin = loaderOrigin(descriptor.url).multiplyScalar(-descriptor.scale);
    origin.applyAxisAngle(new THREE.Vector3(0, 1, 0), descriptor.rotation[1]);
    return origin.add(new THREE.Vector3().fromArray(descriptor.position));
}

const MODELS = normalizeGLBModelCollection(MAP.glbModels);
const CROWNS = MODELS.filter((model) => model.id.startsWith('giant-forest-crown-'));
const TRUNKS = MODELS.filter((model) => model.id.startsWith('giant-forest-trunk-'));

test('the forest is in the catalog, in the base set and in a menu collection', async () => {
    assert.ok(MAP, 'giant_forest is in the preset catalog');
    assert.equal(MAP.name, 'Riesenwald');
    assert.ok(MAP_PRESETS_BASE.giant_forest, 'and in the base preset set, or no mode can pick it');
    const { MAP_PICKER_COLLECTIONS } = await import('../src/ui/menu/MenuMapCollectionCatalog.js');
    const collections = MAP_PICKER_COLLECTIONS.filter((entry) => entry.mapKeys.includes('giant_forest'));
    assert.equal(collections.length, 1, 'listed in exactly one menu collection');
});

test('the map is authored in one space', async () => {
    const { CONFIG_SECTIONS } = await import('../src/core/config/ConfigSections.js');
    assert.equal(CONFIG_SECTIONS.ARENA.MAP_SCALE, MAP_SCALE, 'the scale this file assumes');
    // Obstacles, gates and model placements are scaled whether a map asks or not. Spawns,
    // pickups and the fog heights only follow with this flag - without it a round would start in
    // the middle of a forest three times its size.
    assert.equal(MAP.scaleAuthoredAnchors, true);
    // The fog range is the exception: world units, so it is stated against the scaled field.
    const worldHalfSize = FOREST_HALF_SIZE * MAP_SCALE;
    assert.ok(MAP.lighting.fog.far < worldHalfSize, 'the far side of the map is never visible');
    assert.ok(MAP.lighting.fog.far > worldHalfSize / 3, 'but the forest still reads as deep');
});

test('every model file the map names exists', () => {
    for (const model of MODELS) {
        assert.ok(existsSync(path.resolve(model.url)), `${model.id} -> ${model.url} is missing`);
    }
});

test('the collection stays inside the schema limit', () => {
    // MAP_SCHEMA_COLLECTION_LIMITS.glbModels is 256, and the forest places two files per tree.
    assert.ok(MODELS.length <= 256, `${MODELS.length} models exceed the limit of 256`);
    assert.ok(MODELS.length > 80, 'and it is a forest, not a copse');
});

test('every tree is a flyable crown with an invisible solid body in the same place', () => {
    assert.ok(CROWNS.length >= 40, `only ${CROWNS.length} trees planted`);
    assert.equal(TRUNKS.length, CROWNS.length, 'one collision body per crown');

    for (const crown of CROWNS) {
        const trunk = TRUNKS.find((model) => model.id === crown.id.replace('-crown-', '-trunk-'));
        assert.ok(trunk, `${crown.id} has no collision body`);

        assert.equal(crown.collision, false, 'a crown is flown through, not collided with');
        assert.equal(crown.collisionOnly, false);
        assert.equal(trunk.collisionOnly, true, 'the body is solid and never drawn');
        assert.equal(trunk.collision, true);
        assert.equal(crown.scale, trunk.scale, 'both files are placed at one scale');
        assert.equal(crown.rotation[1], trunk.rotation[1], 'and turned by the same angle');

        // The decisive check: both models' own origins land on the same world point, which is
        // what makes the invisible body sit inside the tree it belongs to rather than beside it.
        const distance = placedModelOrigin(crown).distanceTo(placedModelOrigin(trunk));
        assert.ok(distance < 0.02, `${crown.id}: body offset by ${distance.toFixed(3)} units`);
    }
});

test('a crown is drawn at a distance the fog has already closed', () => {
    // The fog's range is world units and the cull distance is authored units multiplied by the
    // map scale, so the two only compare after that conversion.
    const far = MAP.lighting.fog.far;
    for (const crown of CROWNS) {
        assert.ok(crown.maxRenderDistance > 0, `${crown.id} is never culled`);
        assert.ok(
            crown.maxRenderDistance * MAP_SCALE >= far,
            'crowns must not vanish inside the visible range',
        );
    }
});

test('nothing is planted in a clearing, and nothing grows through the rim', () => {
    for (const crown of CROWNS) {
        const [x, , z] = crown.position;
        assert.equal(isInsideClearing(x, z), false, `${crown.id} stands in a clearing`);
        assert.ok(Math.abs(x) < FOREST_HALF_SIZE, `${crown.id} stands outside the field`);
        assert.ok(Math.abs(z) < FOREST_HALF_SIZE, `${crown.id} stands outside the field`);
    }
});

test('no round starts inside a trunk', () => {
    const spawns = [MAP.playerSpawn, ...MAP.botSpawns];
    // A trunk is about 17 units across at this scale; a ship needs its own clearance beside it.
    const clearance = 14;
    for (const spawn of spawns) {
        for (const trunk of TRUNKS) {
            const dx = spawn.x - trunk.position[0];
            const dz = spawn.z - trunk.position[2];
            assert.ok(
                Math.hypot(dx, dz) > clearance,
                `spawn (${spawn.x}, ${spawn.z}) sits in ${trunk.id}`,
            );
        }
        assert.ok(spawn.y > FOREST_GROUND, 'a spawn stands above the floor, not in it');
    }
});

test('the ground spawns start under the fog and the canopy spawns above it', () => {
    const layer = normalizeMapFogLayer(MAP.fogLayer);
    assert.ok(layer, 'the map states a travelling layer');
    const start = resolveMapFogLayerState(layer, 0);
    for (const spawn of [MAP.playerSpawn, ...MAP.botSpawns]) {
        const inFog = spawn.y < start.ceiling;
        const onDeck = spawn.y > CANOPY_DECK;
        assert.equal(inFog, !onDeck, `spawn at y=${spawn.y} is neither clearly below nor above`);
    }
});

test('the fog turns over rather than merely rising', () => {
    const layer = normalizeMapFogLayer(MAP.fogLayer);
    const start = resolveMapFogLayerState(layer, 0);
    const end = resolveMapFogLayerState(layer, 600);

    // Phase one: a lid at the deck and no floor, so the ground storey is the blind one.
    assert.equal(start.ceiling, CANOPY_DECK);
    assert.ok(start.ceilingFalloff > 0);
    assert.equal(start.floorFalloff, 0);

    // Phase three: a floor at the deck and no lid, so the canopy is.
    assert.equal(end.floor, CANOPY_DECK);
    assert.ok(end.floorFalloff > 0);
    assert.equal(end.ceilingFalloff, 0);
    assert.ok(end.ceiling > MAP.size[1], 'the lid leaves over the top of the map, not through it');

    // And it holds long enough at the start for a round to be about the canopy first.
    const held = resolveMapFogLayerState(layer, 90);
    assert.equal(held.ceiling, start.ceiling);
    assert.equal(held.floorFalloff, 0);
});

test('the canopy is reachable from every clearing a round starts in', () => {
    const climbs = MAP.gates.filter((gate) => gate.type === 'slingshot');
    for (const clearing of FOREST_CLEARINGS.slice(1)) {
        const climb = climbs.find((gate) => (
            Math.hypot(gate.pos[0] - clearing.x, gate.pos[2] - clearing.z) < 1
        ));
        assert.ok(climb, `the ${clearing.name} clearing has no way up`);
        assert.ok(climb.params.liftImpulse > 30, 'and the way up has to reach the canopy');
    }
});

test('the canopy walks are solid and the forest floor is not', () => {
    const walks = MODELS.find((model) => model.id === 'giant-forest-canopy-walks');
    const floor = MODELS.find((model) => model.id === 'giant-forest-floor');
    assert.equal(walks.collision, true, 'the decks carry a ship');
    assert.equal(walks.collisionOnly, false, 'and are drawn while doing so');
    assert.equal(walks.position[1], CANOPY_DECK);
    assert.equal(floor.collision, false, 'the authored box is the floor that collides');

    // The drawn ground has to meet the collision floor exactly: a lip catches, a gap shows.
    const floorSurface = floor.position[1] + restBounds(readGlb(floor.url)).getSize(new THREE.Vector3()).y;
    assert.ok(Math.abs(floorSurface - FOREST_GROUND) < 0.01, `ground surface at ${floorSurface}`);
    assert.equal(MAP.glbColliderMode, 'scene', 'the exported triangles are the level');
});

test('the trees are placed at one scale rather than by target size', () => {
    for (const model of [...CROWNS, ...TRUNKS]) {
        assert.equal(model.targetSize, 0, `${model.id} would be normalized against its own box`);
        assert.equal(model.scale, TREE_SCALE);
    }
});

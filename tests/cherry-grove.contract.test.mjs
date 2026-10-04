import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import * as THREE from 'three';
import { CherryLeafController } from '../src/entities/arena/CherryLeafController.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MAP_PRESETS_BASE } from '../src/core/config/maps/MapPresetsBase.js';
import { CHERRY_GROVE_MAPS } from '../src/core/config/maps/presets/cherry_grove.js';
import { createGameStateSnapshot } from '../src/core/GameStateSnapshot.js';

const ROOT = resolve(import.meta.dirname, '..');
const QA = JSON.parse(readFileSync(resolve(ROOT, 'assets/maps/cherry_grove/cherry_grove_asset_qa.json'), 'utf8'));

test('Kirschhain is registered with five variants per family and shared trunk collision', () => {
    const map = MAP_PRESET_CATALOG.cherry_grove;
    assert.equal(map, CHERRY_GROVE_MAPS.cherry_grove);
    assert.equal(MAP_PRESETS_BASE.cherry_grove, map, 'the playable registry must retain Kirschhain instead of falling back to standard');
    const renders = map.glbModels.filter((model) => model.collision === false);
    const collisions = map.glbModels.filter((model) => model.collisionOnly === true);
    assert.equal(renders.length, 10);
    assert.equal(collisions.length, 10);
    assert.equal(renders.filter((model) => model.url.includes('/akebono_')).length, 5);
    assert.equal(renders.filter((model) => model.url.includes('/kanzan_')).length, 5);
    assert.equal(new Set(renders.map((model) => model.id)).size, 10);
    assert.deepEqual(new Set(collisions.map((model) => model.url)), new Set([
        'assets/maps/cherry_grove/glb/akebono_collision.glb',
        'assets/maps/cherry_grove/glb/kanzan_collision.glb',
    ]));
    assert.equal(renders.filter((model) => model.maxRenderDistance === 230).length, 2);
    assert.ok(renders.filter((model) => model.maxRenderDistance === 145).length === 8);
});

test('tree variant roundtrips preserve wind leaf anchors and measured render budgets', () => {
    assert.equal(QA.families.akebono.variants.length, 5);
    assert.equal(QA.families.kanzan.variants.length, 5);
    for (const family of Object.values(QA.families)) {
        assert.equal(new Set(family.variants.map((variant) => variant.seed)).size, 5);
        assert.ok(new Set(family.variants.map((variant) => JSON.stringify(variant.branch_counts_by_order))).size >= 4,
            'variant seeds must alter the branching profile');
        for (const variant of family.variants) {
            assert.equal(variant.wind_leaf_extras, 48, variant.file);
            assert.equal(variant.reimported_wind_leaf_nodes, 48, variant.file);
            assert.ok(variant.triangles > 0 && variant.file_bytes > 1000, variant.file);
            assert.ok(variant.bounds_m.every((dimension) => dimension > 0), variant.file);
        }
    }
    assert.ok(QA.lod_placement.all_visible_triangles > 0);
    assert.ok(QA.lod_placement.total_render_bytes > 0);
    assert.ok(QA.collisions.akebono.triangles < 100);
    assert.ok(QA.collisions.kanzan.triangles < 100);
});

function makeSceneWithLeaves(count, offset = 0) {
    const scene = new THREE.Group();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.1, 0, 0, 0, 0.15, 0, 0.1, 0, 0,
    ], 3));
    geometry.setIndex([0, 1, 2]);
    const material = new THREE.MeshBasicMaterial({ color: 0xe8a5b8 });
    for (let index = 0; index < count; index += 1) {
        const leaf = new THREE.Mesh(geometry, material);
        leaf.position.set(offset + index * 0.2, 2, 0);
        leaf.scale.setScalar(0.7 + index * 0.025);
        leaf.userData.role = 'wind_leaf';
        leaf.userData.leaf_index = (index % 48) + 1;
        scene.add(leaf);
    }
    scene.updateWorldMatrix(true, true);
    return scene;
}

test('wind leaf release is swept, bounded, deterministic, replicated, and resettable', () => {
    const scene = makeSceneWithLeaves(12);
    const controller = new CherryLeafController(scene);
    assert.equal(controller.count, 12);
    assert.equal(scene.children.filter((child) => child.userData.role === 'wind_leaf_batch').length, 1);
    assert.equal(controller.batch.count, 12);
    assert.ok(scene.children.filter((child) => child.userData.role === 'wind_leaf').every((child) => !child.visible));

    assert.equal(controller.releaseNearPass(new THREE.Vector3(-20, 2, 0), new THREE.Vector3(20, 2, 0), 0, 2), 5,
        'a fast pass crosses anchors but releases no more than five leaves');
    const events = controller.serialize();
    assert.equal(events.length, 5);
    assert.equal(new Set(events.map(([id]) => id)).size, 5);
    const before = new THREE.Matrix4();
    const after = new THREE.Matrix4();
    controller.batch.getMatrixAt(0, before);
    controller.update(5);
    controller.batch.getMatrixAt(0, after);
    assert.notDeepEqual(after.elements, before.elements, 'released leaves drift and tumble');

    const replica = new CherryLeafController(makeSceneWithLeaves(12));
    replica.applyNetworkState(events);
    assert.deepEqual(replica.serialize(), events);
    replica.update(5);
    const replicated = new THREE.Matrix4();
    replica.batch.getMatrixAt(0, replicated);
    assert.deepEqual(replicated.elements, after.elements);

    controller.reset();
    assert.equal(controller.serialize().length, 0);
    controller.releaseNearPass(new THREE.Vector3(-20, 2, 0), new THREE.Vector3(20, 2, 0), 0, 2);
    assert.deepEqual(controller.serialize(), events, 'reset and replay produce identical wind events');
});

test('cherry leaf host events are included in game state snapshots', () => {
    const events = [[1, 2.5, 0.25, 0.8, -0.4]];
    const snapshot = createGameStateSnapshot({
        arena: {
            serializeCherryLeaves: () => events,
            serializeDandelionSeeds: () => null,
            serializeSunflowerKernels: () => null,
        },
    }, { frame: 1 });
    assert.deepEqual(snapshot.cherryLeaves, events);
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot)).cherryLeaves, events,
        'the release event survives JSON transport');
});

test('wind batch resources are released with their owning map scene', () => {
    const scene = makeSceneWithLeaves(2);
    const controller = new CherryLeafController(scene);
    controller.release(1, 0);
    let geometryDisposed = false;
    let materialDisposed = false;
    controller.batch.geometry.addEventListener('dispose', () => { geometryDisposed = true; });
    controller.batch.material.addEventListener('dispose', () => { materialDisposed = true; });

    controller.reset();
    assert.equal(controller.serialize().length, 0);
    disposeObject3DResources(scene);
    assert.equal(geometryDisposed, true);
    assert.equal(materialDisposed, true);
});

test('wind batches preserve each model family geometry and authored leaf scale', () => {
    const scene = new THREE.Group();
    const parent = new THREE.Group();
    parent.scale.setScalar(2);
    scene.add(parent);
    const firstGeometry = new THREE.BufferGeometry();
    firstGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    firstGeometry.setIndex([0, 1, 2]);
    const secondGeometry = firstGeometry.clone();
    secondGeometry.translate(0, 0, 0.25);
    const firstMaterial = new THREE.MeshBasicMaterial({ color: 0xa4b67a });
    const secondMaterial = new THREE.MeshBasicMaterial({ color: 0xdda6be });
    const first = new THREE.Mesh(firstGeometry, firstMaterial);
    first.position.set(1, 2, 3);
    first.scale.setScalar(0.6);
    first.userData.role = 'wind_leaf';
    const second = new THREE.Mesh(secondGeometry, secondMaterial);
    second.position.set(-1, 2, 3);
    second.scale.setScalar(0.4);
    second.userData.role = 'wind_leaf';
    parent.add(first, second);
    scene.updateWorldMatrix(true, true);

    const controller = new CherryLeafController(scene);
    assert.equal(controller.count, 2);
    assert.equal(controller.batches.length, 2, 'distinct family geometries use separate instanced batches');
    for (const leaf of controller.leaves) {
        const matrix = new THREE.Matrix4();
        const scale = new THREE.Vector3();
        leaf.batchGroup.batch.getMatrixAt(leaf.instance, matrix);
        matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
        assert.ok(Math.abs(scale.x - leaf.source.scale.x * parent.scale.x) < 1e-6);
    }

    const firstLeaf = controller.leaves[0];
    const before = new THREE.Matrix4();
    const after = new THREE.Matrix4();
    firstLeaf.batchGroup.batch.getMatrixAt(firstLeaf.instance, before);
    controller.release(firstLeaf.index, 0);
    controller.update(2);
    firstLeaf.batchGroup.batch.getMatrixAt(firstLeaf.instance, after);
    const beforeScale = new THREE.Vector3();
    const afterScale = new THREE.Vector3();
    before.decompose(new THREE.Vector3(), new THREE.Quaternion(), beforeScale);
    after.decompose(new THREE.Vector3(), new THREE.Quaternion(), afterScale);
    assert.ok(Math.abs(afterScale.x - beforeScale.x) < 1e-6, 'flight motion retains the authored leaf size');
});

test('wind batches remain inside the tree LOD that owns their source leaves', () => {
    const scene = new THREE.Group();
    const slot = new THREE.Group();
    slot.position.set(10, 3, -4);
    scene.add(slot);
    const lod = new THREE.LOD();
    slot.add(lod);
    const near = new THREE.Group();
    near.scale.setScalar(2);
    lod.addLevel(near, 0);
    lod.addLevel(new THREE.Group(), 145);
    const offset = new THREE.Group();
    offset.position.set(-1, 0, 2);
    near.add(offset);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.2, 0, 0, 0, 0.2, 0], 3));
    geometry.setIndex([0, 1, 2]);
    const leaf = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xe8a5b8 }));
    leaf.position.set(0.5, 4, 0.25);
    leaf.userData.role = 'wind_leaf';
    offset.add(leaf);
    scene.updateWorldMatrix(true, true);
    const expectedWorldPosition = leaf.getWorldPosition(new THREE.Vector3());

    const controller = new CherryLeafController(scene);
    assert.equal(controller.batches.length, 1);
    assert.equal(controller.batch.parent, near, 'the batch shares the source tree LOD level');
    scene.updateWorldMatrix(true, true);
    const instance = new THREE.Matrix4();
    const world = new THREE.Matrix4();
    controller.batch.getMatrixAt(0, instance);
    world.multiplyMatrices(controller.batch.matrixWorld, instance);
    const actualWorldPosition = new THREE.Vector3().setFromMatrixPosition(world);
    assert.ok(actualWorldPosition.distanceTo(expectedWorldPosition) < 1e-6,
        'LOD-local batching preserves the source leaf world position');

    near.visible = false;
    assert.equal(controller.batch.parent.visible, false,
        'switching to the distant LOD hides the wind-leaf batch with the tree');
});

test('completed leaf flights stop matrix uploads and recover when replay time rewinds', () => {
    const controller = new CherryLeafController(makeSceneWithLeaves(1));
    controller.release(1, 0);
    controller.update(14);
    const completedVersion = controller.batch.instanceMatrix.version;
    controller.update(15);
    assert.equal(controller.batch.instanceMatrix.version, completedVersion,
        'expired leaves must not dirty the GPU instance buffer on every frame');

    controller.update(2);
    assert.ok(controller.batch.instanceMatrix.version > completedVersion,
        'rewinding replay time restores the in-flight leaf');
    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    controller.batch.getMatrixAt(0, matrix);
    matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    assert.ok(scale.x > 0);
});

test('Kanzan bark base color survives GLB export for every variant', () => {
    for (let number = 1; number <= 5; number += 1) {
        const variant = `kanzan_${String(number).padStart(2, '0')}.glb`;
        const glb = readFileSync(resolve(ROOT, 'assets/maps/cherry_grove/glb', variant));
        assert.equal(glb.toString('ascii', 0, 4), 'glTF');
        assert.equal(glb.readUInt32LE(4), 2);
        const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
        const bark = json.materials.find((material) => material.name === 'Bark | warm reddish brown');
        const color = bark?.pbrMetallicRoughness?.baseColorFactor;
        assert.ok(Array.isArray(color) && color.length === 4);
        [0.16, 0.062, 0.047, 1].forEach((expected, index) => {
            assert.ok(Math.abs(color[index] - expected) < 1e-7,
                `${variant} must retain the authored bark color after float32 export`);
        });
    }
});

test('Kanzan distance variants preserve small wood faces and all pink petal materials', () => {
    for (let number = 1; number <= 5; number += 1) {
        const variant = `kanzan_${String(number).padStart(2, '0')}.glb`;
        const glb = readFileSync(resolve(ROOT, 'assets/maps/cherry_grove/glb', variant));
        const jsonSize = glb.readUInt32LE(12);
        const document = JSON.parse(glb.subarray(20, 20 + jsonSize).toString('utf8'));
        const binaryOffset = 28 + jsonSize;
        const read = (accessorId) => {
            const accessor = document.accessors[accessorId];
            const view = document.bufferViews[accessor.bufferView];
            const components = accessor.type === 'VEC3' ? 3 : 1;
            const bytes = accessor.componentType === 5123 ? 2 : 4;
            const method = { 5123: 'readUInt16LE', 5125: 'readUInt32LE', 5126: 'readFloatLE' }[accessor.componentType];
            assert.ok(method, 'known index or float component type');
            return Array.from({ length: accessor.count }, (_, index) => Array.from({ length: components }, (_, component) => (
                glb[method](binaryOffset + (view.byteOffset || 0) + (accessor.byteOffset || 0)
                    + index * (view.byteStride || components * bytes) + component * bytes)
            )));
        };
        const petals = new Set();
        let woodTriangles = 0;
        for (const mesh of document.meshes) {
            for (const primitive of mesh.primitives) {
                const material = document.materials[primitive.material]?.name || '';
                if (material.startsWith('Petals |')) {
                    assert.ok(document.accessors[primitive.indices].count >= 3, `${variant}: visible ${material}`);
                    petals.add(material);
                }
                if (material !== 'Bark | warm reddish brown') continue;
                const positions = read(primitive.attributes.POSITION);
                const indices = read(primitive.indices).flat();
                woodTriangles += indices.length / 3;
                for (let index = 0; index < indices.length; index += 3) {
                    for (let edge = 0; edge < 3; edge += 1) {
                        const start = positions[indices[index + edge]];
                        const end = positions[indices[index + (edge + 1) % 3]];
                        const length = Math.hypot(...start.map((value, axis) => value - end[axis]));
                        assert.ok(length < 1.25, `${variant}: a ${length.toFixed(2)}m bark face collapsed across the trunk`);
                    }
                }
            }
        }
        assert.ok(woodTriangles > 1000, `${variant}: the branching surface must survive LOD`);
        assert.equal(petals.size, 3, `${variant}: simplification must preserve the pink blossom palette`);
    }
});

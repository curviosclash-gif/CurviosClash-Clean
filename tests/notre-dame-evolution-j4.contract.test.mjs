import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import * as THREE from 'three';

import { NOTRE_DAME_EVOLUTION_MAPS } from '../src/core/config/maps/presets/notre_dame/NotreDameEvolution.js';
import { NOTRE_DAME_CHECKPOINTS } from '../src/core/config/maps/presets/notre_dame/NotreDameRoute.js';
import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
import { createStaticMeshCollider, sphereIntersectsStaticMeshCollider } from '../src/entities/arena/StaticMeshCollider.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';
import { placeMapGlbModel, MAP_SCALE, worldMeshBounds } from './helpers/placed-glb-model.mjs';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

const map = NOTRE_DAME_EVOLUTION_MAPS.notre_dame;
const models = map.glbModels.filter((model) => model.id.startsWith('notre-dame-evolution-'));
const placedModels = new Map();
let collection = null;

async function placed(id) {
    if (!placedModels.has(id)) placedModels.set(id, placeMapGlbModel(map, id));
    return placedModels.get(id);
}

function meshEntries(root) {
    const entries = [];
    root.traverse((child) => {
        if (child.isMesh && child.geometry?.getAttribute('position')) entries.push(child);
    });
    return entries;
}

function closedTriangleShell(mesh) {
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    const pointKey = (vertex) => [position.getX(vertex), position.getY(vertex), position.getZ(vertex)]
        .map((value) => Math.round(value * 10000)).join(',');
    const edgeUse = new Map();
    const elementCount = index ? index.count : position.count;
    const vertexAt = (offset) => index ? index.getX(offset) : offset;
    for (let offset = 0; offset + 2 < elementCount; offset += 3) {
        const points = [0, 1, 2].map((corner) => pointKey(vertexAt(offset + corner)));
        for (const [a, b] of [[points[0], points[1]], [points[1], points[2]], [points[2], points[0]]]) {
            const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
            edgeUse.set(edge, (edgeUse.get(edge) || 0) + 1);
        }
    }
    return [...edgeUse.values()].every((count) => count === 2);
}

function center(bounds) {
    return bounds.getCenter(new THREE.Vector3());
}

function poseMatrices(root) {
    root.updateWorldMatrix(true, true);
    return new Map(meshEntries(root).map((mesh) => [
        mesh.name,
        { matrix: mesh.matrixWorld.clone(), bounds: new THREE.Box3().setFromObject(mesh) },
    ]));
}

function clipSampleTimes(clip) {
    const times = new Set([0, clip.duration]);
    for (const track of clip.tracks) {
        const keys = [...track.times].filter((time) => time >= 0 && time <= clip.duration);
        for (let index = 0; index < keys.length; index += 1) {
            times.add(keys[index]);
            if (index + 1 < keys.length) times.add((keys[index] + keys[index + 1]) / 2);
        }
    }
    return [...times].sort((left, right) => left - right);
}

function meshSurfaceDistance(mesh, point) {
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    const elementCount = index ? index.count : position.count;
    const vertexAt = (offset) => index ? index.getX(offset) : offset;
    const triangle = new THREE.Triangle();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const closest = new THREE.Vector3();
    let distance = Infinity;
    for (let offset = 0; offset + 2 < elementCount; offset += 3) {
        a.fromBufferAttribute(position, vertexAt(offset)).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(position, vertexAt(offset + 1)).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(position, vertexAt(offset + 2)).applyMatrix4(mesh.matrixWorld);
        triangle.set(a, b, c);
        triangle.closestPointToPoint(point, closest);
        distance = Math.min(distance, closest.distanceTo(point));
    }
    return distance;
}

function visibleVerticalAxisEndpoints(group) {
    group.updateWorldMatrix(true, true);
    const worldToGroup = group.matrixWorld.clone().invert();
    const vertices = [];
    for (const mesh of meshEntries(group).filter((entry) => !/_colonly/i.test(entry.name))) {
        const position = mesh.geometry.getAttribute('position');
        const groupLocal = mesh.matrixWorld.clone().premultiply(worldToGroup);
        const point = new THREE.Vector3();
        for (let index = 0; index < position.count; index += 1) {
            vertices.push(point.fromBufferAttribute(position, index).applyMatrix4(groupLocal).clone());
        }
    }
    assert.ok(vertices.length > 0, `${group.name} contains visible geometry`);
    const minY = Math.min(...vertices.map((point) => point.y));
    const maxY = Math.max(...vertices.map((point) => point.y));
    const endBand = (maxY - minY) * 0.08;
    const average = (points) => points.reduce((sum, point) => sum.add(point), new THREE.Vector3())
        .multiplyScalar(1 / points.length);
    return {
        bottom: average(vertices.filter((point) => point.y <= minY + endBand)),
        top: average(vertices.filter((point) => point.y >= maxY - endBand)),
    };
}

function worldAxis(group, endpoints) {
    group.updateWorldMatrix(true, true);
    const bottom = endpoints.bottom.clone().applyMatrix4(group.matrixWorld);
    const top = endpoints.top.clone().applyMatrix4(group.matrixWorld);
    return top.sub(bottom).normalize();
}

after(async () => {
    for (const promise of placedModels.values()) {
        const model = await promise;
        disposeObject3DResources(model.scene);
    }
    if (collection) disposeObject3DResources(collection.scene);
});

test('J4 E1 tower collapses use closed, static collision-only boxes', async () => {
    collection = await loadGLBMapCollection(models, {
        loader: geometryOnlyGlbLoader,
        colliderMode: 'scene',
        requireComplete: true,
    });

    for (const model of models.filter((entry) => /-(north|south|crown)$/.test(entry.id))) {
        const meshes = meshEntries(collection.scene.getObjectByName(`glb-slot-${model.id}`));
        const proxies = meshes.filter((mesh) => mesh.name.toLowerCase().includes('_colonly'));
        assert.ok(proxies.length > 0, `${model.id} exports explicit collision proxies`);
        for (const proxy of proxies) {
            assert.ok(closedTriangleShell(proxy), `${model.id}/${proxy.name} is a closed shell`);
        }

        const colliders = collection.colliders.filter((collider) => collider.modelId === model.id);
        assert.ok(colliders.length > 0, `${model.id} has runtime collision`);
        assert.ok(colliders.every((collider) => (
            collider.sourceName.toLowerCase().includes('_colonly')
            || (!collider.dynamic && collider.sourceName.toLowerCase().includes('_base_'))
        )), `${model.id} collides against closed fragment boxes and its static tower base`);
    }
});

test('Evolution nave uses the current Fire source and leaves the vaulted flight corridor clear', async () => {
    const source = await geometryOnlyGlbLoader.loadAsync(new URL('../assets/maps/notre_dame_fire/glb/02_nave_burnt.glb', import.meta.url));
    const exported = await geometryOnlyGlbLoader.loadAsync(new URL('../assets/maps/notre_dame_evolution/glb/nave.glb', import.meta.url));
    const evolution = await placed('notre-dame-evolution-nave');
    source.scene.updateWorldMatrix(true, true);
    exported.scene.updateWorldMatrix(true, true);
    evolution.scene.updateWorldMatrix(true, true);

    const staleVaultNames = /nave_burnt_stoneshaded_colonly|nave_vault_shell_colonly/i;
    assert.deepEqual(meshEntries(exported.scene).filter((mesh) => staleVaultNames.test(mesh.name)).map((mesh) => mesh.name), []);

    const sourceMeshes = meshEntries(source.scene);
    const evolvedMeshes = meshEntries(exported.scene).filter((mesh) => mesh.name.startsWith('nave_burnt_'));
    const meshesByName = new Map(evolvedMeshes.map((mesh) => [mesh.name, mesh]));
    assert.equal(meshesByName.size, sourceMeshes.length, 'each current Fire nave mesh appears exactly once in the Evolution GLB');
    for (const sourceMesh of sourceMeshes) {
        const evolvedMesh = meshesByName.get(sourceMesh.name);
        assert.ok(evolvedMesh, `${sourceMesh.name} is retained from the Fire source`);
        const sourceTriangles = sourceMesh.geometry.index?.count ?? sourceMesh.geometry.getAttribute('position').count;
        const evolvedTriangles = evolvedMesh.geometry.index?.count ?? evolvedMesh.geometry.getAttribute('position').count;
        assert.equal(evolvedTriangles, sourceTriangles, `${sourceMesh.name} keeps its source geometry`);
        const sourceBounds = new THREE.Box3().setFromObject(sourceMesh);
        const evolvedBounds = new THREE.Box3().setFromObject(evolvedMesh);
        for (const key of ['x', 'y', 'z']) {
            assert.ok(Math.abs(sourceBounds.min[key] - evolvedBounds.min[key]) < 0.001, `${sourceMesh.name} min ${key} matches`);
            assert.ok(Math.abs(sourceBounds.max[key] - evolvedBounds.max[key]) < 0.001, `${sourceMesh.name} max ${key} matches`);
        }
    }

    const colliders = meshEntries(evolution.scene)
        .filter((mesh) => !/_nocol/i.test(mesh.name))
        .map((mesh) => createStaticMeshCollider(mesh))
        .filter(Boolean);
    assert.ok(colliders.length > 0, 'placed nave geometry produces production static colliders');
    const vaultProbes = [-68, -52, -36, -20, -4].map((x) => ({ x: x * MAP_SCALE, y: 55 * MAP_SCALE, z: 0 }));
    for (const point of vaultProbes) {
        assert.equal(colliders.some((collider) => sphereIntersectsStaticMeshCollider(collider, point, 1.6)), false,
            `world-radius 1.6 aircraft clears the nave vault at (${point.x / MAP_SCALE}, 55, 0)`);
    }
    disposeObject3DResources(source.scene);
    disposeObject3DResources(exported.scene);
});

test('J4 E2 the roof collapse animates the spire and its rubble into the fall', async () => {
    const roof = await placed('notre-dame-evolution-roof');
    assert.ok(roof.clip, 'the roof setpiece has its collapse clip');
    roof.pose(0);
    const before = poseMatrices(roof.scene);
    roof.pose(roof.clip.duration);
    const afterFall = poseMatrices(roof.scene);
    const moved = (name) => {
        const start = before.get(name);
        const end = afterFall.get(name);
        return start && end && start.matrix.elements.some((value, index) => Math.abs(value - end.matrix.elements[index]) > 0.05);
    };

    const spire = [...before.keys()].filter((name) => /spire|fleche/i.test(name));
    assert.ok(spire.some(moved), 'the visible spire has a moving mesh');
    const debris = [...before.keys()].filter((name) => /debris|rubble/i.test(name));
    assert.ok(debris.some((name) => moved(name)
        && center(afterFall.get(name).bounds).y < center(before.get(name).bounds).y - 1),
    'rubble moves down as part of the collapse instead of appearing complete at the start');
});

test('J4 E3-E4 timber falls inward and starts without stacked beams', async () => {
    for (const id of ['notre-dame-evolution-roof', 'notre-dame-evolution-nave', 'notre-dame-evolution-transept']) {
        const model = await placed(id);
        assert.ok(model.clip, `${id} has a collapse clip`);
        model.pose(0);
        const start = poseMatrices(model.scene);
        model.pose(model.clip.duration);
        const end = poseMatrices(model.scene);
        const beams = [...start.keys()].filter((name) => /falling/i.test(name) && !/_nocol/i.test(name));
        assert.ok(beams.length >= 8, `${id} includes its authored falling timbers`);
        for (const name of beams) {
            const from = center(start.get(name).bounds);
            const to = center(end.get(name).bounds);
            assert.ok(to.y < from.y - 15, `${id}/${name} falls toward the ground`);
            assert.ok(Math.abs(to.z) < 30 * MAP_SCALE,
                `${id}/${name} remains within the church envelope instead of crossing its walls`);
        }
        if (id.endsWith('-transept')) {
            for (let left = 0; left < beams.length; left += 1) {
                for (let right = left + 1; right < beams.length; right += 1) {
                    const distance = center(start.get(beams[left]).bounds)
                        .distanceTo(center(start.get(beams[right]).bounds));
                    assert.ok(distance > MAP_SCALE,
                        `${beams[left]} and ${beams[right]} do not start stacked together`);
                }
            }
        }
    }
});

test('J4 E5 no collapse debris ends below the church floor', async () => {
    const floor = 8 * MAP_SCALE;
    for (const descriptor of models) {
        const model = await placed(descriptor.id);
        assert.ok(model.clip, `${descriptor.id} has a collapse clip`);
        model.pose(0);
        const before = poseMatrices(model.scene);
        model.pose(model.clip.duration);
        const afterFall = poseMatrices(model.scene);
        const fallen = [...before.keys()].filter((name) => {
            const start = before.get(name)?.matrix.elements;
            const end = afterFall.get(name)?.matrix.elements;
            return start && end && start.some((value, index) => Math.abs(value - end[index]) > 0.05);
        });
        assert.ok(fallen.length > 0, `${descriptor.id} contains animated collapse pieces`);
        for (const name of fallen) {
            const bounds = afterFall.get(name).bounds;
            assert.ok(bounds.min.y >= floor - (0.2 * MAP_SCALE),
                `${descriptor.id}/${name} debris bottom ${bounds.min.y.toFixed(2)} stays at floor ${floor}`);
        }
    }
});

test('J4 E6 only clip-moved Notre-Dame meshes use dynamic colliders', async () => {
    if (!collection) {
        collection = await loadGLBMapCollection(models, {
            loader: geometryOnlyGlbLoader,
            colliderMode: 'scene',
            requireComplete: true,
        });
    }

    for (const descriptor of models) {
        assert.equal(descriptor.fixedTriggeredPlacement, true,
            `${descriptor.id} opts into baked placement for its stationary facade`);
        const slot = collection.scene.getObjectByName(`glb-slot-${descriptor.id}`);
        const before = poseMatrices(slot);
        for (const track of collection.animationTracks.filter((entry) => entry.modelId === descriptor.id)) {
            track.action.time = track.durationSeconds;
            track.mixer.update(0);
        }
        const afterFall = poseMatrices(slot);
        const movedNames = new Set([...before.keys()].filter((name) => {
            const start = before.get(name)?.matrix.elements;
            const end = afterFall.get(name)?.matrix.elements;
            return start && end && start.some((value, index) => Math.abs(value - end[index]) > 0.05);
        }));
        const colliders = collection.colliders.filter((collider) => collider.modelId === descriptor.id);
        const actualDynamic = new Set(colliders.filter((collider) => collider.dynamic).map((collider) => collider.sourceName));
        const expectedDynamic = new Set(colliders
            .filter((collider) => movedNames.has(collider.sourceName) || /_dyn/i.test(collider.sourceName))
            .map((collider) => collider.sourceName));

        assert.ok(actualDynamic.size > 0, `${descriptor.id} retains moving-piece colliders`);
        assert.ok(actualDynamic.size < colliders.length,
            `${descriptor.id} keeps unmoved mesh colliders static`);
        assert.deepEqual([...actualDynamic].sort(), [...expectedDynamic].sort(),
            `${descriptor.id} dynamic colliders follow only the clip-moved meshes`);
    }
});

test('J4 the animated fleche stays clear of CP11_CHOIR throughout its clip', async () => {
    const roof = await placed('notre-dame-evolution-roof');
    assert.ok(roof.clip, 'the roof setpiece has its collapse clip');
    const choir = NOTRE_DAME_CHECKPOINTS.find((checkpoint) => checkpoint.id === 'CP11_CHOIR');
    assert.ok(choir, 'the canonical choir checkpoint is registered');
    const centerPoint = new THREE.Vector3(...choir.pos);
    const meshes = meshEntries(roof.scene).filter((mesh) => (
        /fleche|spire/i.test(mesh.name) && !/_colonly/i.test(mesh.name)
    ));
    roof.pose(0);
    const bindPose = poseMatrices(roof.scene);
    let movingFlecheMeshes = 0;
    let closestApproach = { distance: Infinity, mesh: '', time: 0 };

    for (const time of clipSampleTimes(roof.clip)) {
        roof.pose(time);
        for (const mesh of meshes) {
            const start = bindPose.get(mesh.name)?.matrix.elements;
            if (!start || !mesh.matrixWorld.elements.some((value, index) => (
                Math.abs(value - start[index]) > 0.001
            ))) continue;
            movingFlecheMeshes += 1;
            const clearance = meshSurfaceDistance(mesh, centerPoint);
            if (clearance < closestApproach.distance) {
                closestApproach = { distance: clearance, mesh: mesh.name, time };
            }
        }
    }

    assert.ok(movingFlecheMeshes > 0, 'the fleche envelope has animated meshes to validate');
    assert.ok(closestApproach.distance >= choir.radius - 0.05,
        `${closestApproach.mesh} enters CP11_CHOIR at t=${closestApproach.time.toFixed(3)}s (minimum surface clearance ${closestApproach.distance.toFixed(2)}, required ${choir.radius})`);
});

test('J4 the visible fleche shell tips west between GLB frames 1 and 121', async () => {
    const roof = await placed('notre-dame-evolution-roof');
    assert.ok(roof.clip, 'the roof setpiece has its collapse clip');
    const fleche = roof.scene.getObjectByName('evolution_fleche_falling_nocol');
    assert.ok(fleche, 'the GLB contains the visible falling fleche shell');

    // The exported scene runs at 24 fps: frame 1 is t=0 and frame 121 is t=5 seconds.
    roof.pose(0);
    const endpoints = visibleVerticalAxisEndpoints(fleche);
    const initial = worldAxis(fleche, endpoints);
    assert.ok(initial.y > 0.95,
        `the frame-1 visible fleche main axis starts upright (axis=${initial.toArray().map((value) => value.toFixed(2))})`);

    roof.pose(5);
    const fallen = worldAxis(fleche, endpoints);
    assert.ok(fallen.x < -0.75 && Math.abs(fallen.y) < 0.65,
        `the frame-121 visible fleche main axis tips west and near-horizontal (axis=${fallen.toArray().map((value) => value.toFixed(2))})`);
});

import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { createGameStateSnapshot } from '../src/core/GameStateSnapshot.js';
import { DANDELION_SKY_MAP } from '../src/core/config/maps/presets/dandelion_sky.js';
import { EntityManager } from '../src/entities/EntityManager.js';
import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
import { SunflowerKernelController } from '../src/entities/arena/SunflowerKernelController.js';
import { ProjectileHitResolver } from '../src/entities/systems/projectile/ProjectileHitResolver.js';
import { ProjectileSimulationOps } from '../src/entities/systems/projectile/ProjectileSimulationOps.js';
import { MGHitResolver } from '../src/hunt/mg/MGHitResolver.js';
import { OverheatGunSystem } from '../src/hunt/OverheatGunSystem.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_DIR = path.join(ROOT, 'assets', 'models', 'sunflower');
const GLB_URL = 'assets/models/sunflower/sunflower_shootable.glb';
const MATERIAL = new THREE.MeshStandardMaterial({ color: 0x40291d });
const STRIPE = new THREE.MeshStandardMaterial({ color: 0x9a805f });
const TEST_POSITIONS = [-0.21, -0.07, 0.07, 0.21];

function parseGlb(buffer) {
    assert.equal(buffer.toString('ascii', 0, 4), 'glTF');
    assert.equal(buffer.readUInt32LE(4), 2);
    assert.equal(buffer.readUInt32LE(8), buffer.length);
    const jsonLength = buffer.readUInt32LE(12);
    assert.equal(buffer.toString('ascii', 16, 20), 'JSON');
    return JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength).trim());
}

function triangleCount(document) {
    let total = 0;
    for (const mesh of document.meshes || []) {
        for (const primitive of mesh.primitives || []) {
            if (primitive.indices === undefined) continue;
            total += document.accessors[primitive.indices].count / 3;
        }
    }
    return total;
}

function makeSunflowerScene(positions = TEST_POSITIONS) {
    const scene = new THREE.Group();
    scene.name = 'test-sunflower-scene';
    const plant = new THREE.Group();
    plant.name = 'test-sunflower-instance';
    scene.add(plant);
    const head = new THREE.Group();
    head.name = 'test-sunflower-head';
    head.userData = { role: 'shootable_sunflower_head', kernel_hit_radius: 0.82 };
    plant.add(head);
    const kernelGeometry = new THREE.SphereGeometry(1, 10, 8);
    const stripeGeometry = new THREE.BoxGeometry(0.008, 0.08, 0.002);
    const kernels = [];
    for (let index = 0; index < positions.length; index += 1) {
        const kernel = new THREE.Group();
        kernel.name = 'SunflowerKernel_' + String(index + 1).padStart(3, '0') + '_SHOOTABLE_nocol';
        kernel.position.set(positions[index], 0, 0.12);
        kernel.userData = {
            role: 'shootable_kernel',
            kernel_index: index + 1,
            hit_radius_x: 0.032,
            hit_radius_y: 0.05,
            hit_radius_z: 0.028,
            flight_profile: 'heavy_achene_v1',
        };
        const shell = new THREE.Mesh(kernelGeometry, MATERIAL);
        shell.name = 'KernelShell_nocol';
        shell.scale.set(0.029, 0.048, 0.025);
        const stripe = new THREE.Mesh(stripeGeometry, STRIPE);
        stripe.name = 'KernelStripe_nocol';
        stripe.position.z = 0.026;
        kernel.add(shell, stripe);
        head.add(kernel);
        kernels.push(kernel);
    }
    scene.updateWorldMatrix(true, true);
    return { scene, plant, head, kernels };
}

function worldCenter(node) {
    return node.getWorldPosition(new THREE.Vector3());
}

function frontRayFor(node, distance = 6) {
    const center = worldCenter(node);
    const normal = new THREE.Vector3(0, 0, 1)
        .applyQuaternion(node.getWorldQuaternion(new THREE.Quaternion())).normalize();
    return { origin: center.clone().addScaledVector(normal, distance), direction: normal.negate() };
}

test('sunflower package contains editable source, five QA views, and 220 distinct mesh kernels', async () => {
    const blend = await stat(path.join(ASSET_DIR, 'blender', 'sunflower.blend'));
    assert.ok(blend.size > 250_000, 'editable Blender source is unexpectedly small');

    for (const view of ['front', 'quarter', 'side', 'back', 'game']) {
        const png = await readFile(path.join(
            ASSET_DIR, 'blender', 'previews', 'sunflower_' + view + '.png',
        ));
        assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
        assert.equal(png.readUInt32BE(16), 720);
        assert.equal(png.readUInt32BE(20), 720);
    }

    const buffer = await readFile(path.join(ASSET_DIR, 'sunflower_shootable.glb'));
    const document = parseGlb(buffer);
    const kernels = document.nodes.filter((node) => node.extras?.role === 'shootable_kernel');
    const head = document.nodes.find((node) => node.extras?.role === 'shootable_sunflower_head');
    const indices = kernels.map((node) => node.extras.kernel_index);
    assert.equal(kernels.length, 220);
    assert.equal(new Set(indices).size, kernels.length);
    assert.deepEqual(indices.sort((a, b) => a - b), Array.from({ length: 220 }, (_, i) => i + 1));
    assert.ok(kernels.every((node) => node.mesh !== undefined
        && Array.isArray(node.translation)
        && node.extras.hit_radius_x > 0
        && node.extras.hit_radius_y > 0
        && node.extras.hit_radius_z > 0
        && node.extras.flight_profile === 'heavy_achene_v1'));
    assert.ok(head?.mesh !== undefined);
    assert.equal(head.extras.kernel_count, 220);
    assert.equal(document.animations?.length || 0, 0,
        'kernel release must not autoplay as a Blender or GLB animation');
    assert.ok(triangleCount(document) < 100_000);
    assert.ok(document.materials.length <= 20);
    assert.equal(document.textures?.length || 0, 0);
    assert.ok(buffer.length < 2_000_000);
});

test('dandelion sky loads the sunflower GLB at map scale without per-kernel physics colliders', async () => {
    const map = DANDELION_SKY_MAP.dandelion_sky;
    const model = map.glbModels.find((entry) => entry.id === 'dandelion-sky-sunflower');
    assert.ok(model);
    assert.equal(model.url, GLB_URL);
    assert.equal(model.targetSize, 15);
    assert.deepEqual(model.position, [10, 216, -135]);
    assert.equal(model.collision, false);

    const raw = await geometryOnlyGlbLoader.loadAsync(GLB_URL);
    raw.scene.updateWorldMatrix(true, true);
    const rawFirst = worldCenter(raw.scene.getObjectByName('SunflowerKernel_001_SHOOTABLE_nocol'));
    const rawSecond = worldCenter(raw.scene.getObjectByName('SunflowerKernel_002_SHOOTABLE_nocol'));
    const rawSize = new THREE.Box3().setFromObject(raw.scene).getSize(new THREE.Vector3());
    const scale = model.targetSize / Math.max(rawSize.x, rawSize.y, rawSize.z);

    const result = await loadGLBMapCollection([model], {
        loader: geometryOnlyGlbLoader,
        placementScale: 1,
        colliderMode: map.glbColliderMode,
    });
    assert.ok(result.scene);
    assert.ok(result.colliders.length <= 6,
        'shootable kernels must use targeted queries instead of permanent colliders');
    result.scene.updateWorldMatrix(true, true);
    const controller = new SunflowerKernelController(result.scene);
    assert.equal(controller.count, 220);
    const loadedFirst = controller.byIndex.get(1);
    const loadedSecond = controller.byIndex.get(2);
    const loadedDistance = worldCenter(loadedFirst.node).distanceTo(worldCenter(loadedSecond.node));
    const rawDistance = rawFirst.distanceTo(rawSecond);
    assert.ok(Math.abs(loadedDistance - rawDistance * scale) < 0.002,
        'GLB parent transforms and targetSize scaling must survive the runtime loader');

    const batch = controller.getRenderBatchMetrics();
    assert.equal(batch.enabled, true);
    assert.equal(batch.instances, controller.count);
    assert.ok(batch.batches <= 12, 'kernel colors/materials create too many batches');
    assert.ok(batch.estimatedDrawCalls <= 12,
        'the shootable kernel field exceeds its instanced draw-call budget');
    assert.ok(controller.kernels.every((kernel) => kernel.node.visible === false),
        'source kernel meshes must stay hidden behind their render batches');

    let adjacentHits = null;
    for (let index = 0; index < controller.kernels.length - 1; index += 1) {
        const firstRay = frontRayFor(controller.kernels[index].node, 20);
        const secondRay = frontRayFor(controller.kernels[index + 1].node, 20);
        const firstHit = controller.raycast(firstRay.origin, firstRay.direction, 40);
        const secondHit = controller.raycast(secondRay.origin, secondRay.direction, 40);
        if (firstHit?.kernelIndex === index + 1 && secondHit?.kernelIndex === index + 2) {
            adjacentHits = { firstRay, secondRay, firstHit, secondHit };
            break;
        }
    }
    assert.ok(adjacentHits, 'the imported seed field should expose a directly aimable neighbor pair');
    assert.equal(controller.releaseByName(adjacentHits.firstHit.sourceName, 1.25,
        adjacentHits.firstRay.direction), true);
    assert.equal(controller.releaseByName(adjacentHits.firstHit.sourceName, 1.26,
        adjacentHits.firstRay.direction), false);
    assert.equal(controller.raycast(adjacentHits.secondRay.origin,
        adjacentHits.secondRay.direction, 40)?.kernelIndex, adjacentHits.secondHit.kernelIndex,
    'removing one loaded kernel must leave its neighbor targetable');
    assert.equal(controller.releaseByName(adjacentHits.secondHit.sourceName, 1.27,
        adjacentHits.secondRay.direction), true);
    controller.reset();
});

test('targeted hits leave neighboring kernels available and close misses release nothing', () => {
    const { scene, kernels } = makeSunflowerScene();
    const controller = new SunflowerKernelController(scene);
    const firstRay = frontRayFor(kernels[0]);
    const firstHit = controller.raycast(firstRay.origin, firstRay.direction, 12);
    assert.equal(firstHit?.kernelIndex, 1);
    assert.equal(controller.releaseByName(firstHit.sourceName, 1.25, firstRay.direction), true);
    assert.equal(controller.releaseByName(firstHit.sourceName, 1.3, firstRay.direction), false);
    assert.equal(controller.raycast(firstRay.origin, firstRay.direction, 12), null);

    const gapRay = frontRayFor(kernels[1]);
    gapRay.origin.x = 0;
    const gap = controller.raycast(gapRay.origin, gapRay.direction, 12);
    assert.equal(gap, null, 'the gap between two kernels must not be inflated into a hit');

    const neighborRay = frontRayFor(kernels[1]);
    const neighbor = controller.raycast(neighborRay.origin, neighborRay.direction, 12);
    assert.equal(neighbor?.kernelIndex, 2);
    assert.equal(controller.releaseByName(neighbor.sourceName, 1.5, neighborRay.direction), true);
    assert.deepEqual(controller.serialize().map((event) => event[0]), [1, 2]);
    assert.equal(controller.kernels[0].node.parent, controller.flightRoot);
    assert.equal(controller.kernels[1].node.parent, controller.flightRoot);
    assert.equal(controller.kernels[2].node.parent, controller.heads[0].node);
});

test('MG and projectile hit resolution release the exact kernel and pass their hit direction', () => {
    const { scene, kernels } = makeSunflowerScene();
    const controller = new SunflowerKernelController(scene);
    const releasedDirections = [];
    const arena = {
        raycast: () => ({ hit: false }),
        getCollisionInfo: () => null,
        raycastDandelionSeed: (...args) => controller.raycast(...args),
        releaseDandelionSeed: (name, direction) => {
            const released = controller.releaseByName(name, 3, direction);
            if (released) releasedDirections.push(direction.clone().normalize().toArray());
            return released;
        },
    };
    const mgRay = frontRayFor(kernels[0]);
    const mgHit = new MGHitResolver({ arena, players: [] }).resolveHit(
        { position: mgRay.origin }, { RANGE: 20 }, null, null, mgRay.direction,
    );
    assert.equal(mgHit?.arena?.sourceName, kernels[0].name);
    assert.equal(OverheatGunSystem.prototype._applyMapDestructibleHit.call(
        { entityManager: { arena } }, null, { arena: mgHit.arena, point: mgHit.point }, mgRay.direction,
    ), true);

    const projectileRay = frontRayFor(kernels[1]);
    const projectile = {
        previousPosition: projectileRay.origin.clone(),
        position: worldCenter(kernels[1]).addScaledVector(projectileRay.direction, 1),
        velocity: projectileRay.direction.clone().multiplyScalar(40),
        radius: 0.01,
        type: 'MG_BULLET',
    };
    const collision = new ProjectileSimulationOps({})._resolveArenaCollision(projectile, arena);
    assert.equal(collision?.sourceName, kernels[1].name);
    const resolver = new ProjectileHitResolver({ getArena: () => arena });
    assert.equal(resolver._applyDestructibleMapHit(projectile, { arenaCollision: collision }).applied, true);
    assert.deepEqual(controller.serialize().map((event) => event[0]), [1, 2]);
    assert.equal(releasedDirections.length, 2);
    assert.ok(releasedDirections.every((direction) => direction.some((component) => component < -0.9)));
});

test('kernel flight starts at the moved and scaled world transform, then ignores plant motion', () => {
    const { scene, plant, kernels } = makeSunflowerScene();
    plant.position.set(8, 3, -4);
    plant.rotation.set(0.12, 0.34, -0.06);
    plant.scale.set(2.2, 3.1, 2.7);
    scene.updateWorldMatrix(true, true);
    const controller = new SunflowerKernelController(scene);
    const target = kernels[2];
    const ray = frontRayFor(target, 22);
    const hit = controller.raycast(ray.origin, ray.direction, 40);
    assert.equal(hit?.kernelIndex, 3);
    const expectedStart = worldCenter(target);
    assert.equal(controller.releaseByName(hit.sourceName, 2, new THREE.Vector3(1, 0, 0)), true);
    assert.ok(worldCenter(target).distanceTo(expectedStart) < 1e-6,
        'the detach operation must preserve the kernel world transform');

    plant.position.x += 30;
    controller.update(2.6);
    const expected = expectedStart.clone()
        .addScaledVector(controller.byName.get(target.name).velocity, 0.6)
        .add(new THREE.Vector3(0, -0.5 * 9.81 * 0.6 * 0.6, 0));
    assert.ok(worldCenter(target).distanceTo(expected) < 1e-5,
        'a detached kernel must follow its recorded world trajectory, not the moving head');

    controller.reset();
    assert.equal(target.parent, controller.byName.get(target.name).homeParent);
    assert.deepEqual(target.position.toArray(), [TEST_POSITIONS[2], 0, 0.12]);
    assert.equal(target.visible, true);
    assert.equal(controller.flightRoot.children.length, 0,
        'reset must remove all detached kernels from the flight root');
    assert.deepEqual(controller.serialize(), []);
});

test('kernel flight is reproducible and authoritative snapshots carry hit direction', () => {
    const hostScene = makeSunflowerScene();
    const replicaScene = makeSunflowerScene();
    const hostController = new SunflowerKernelController(hostScene.scene);
    const replicaController = new SunflowerKernelController(replicaScene.scene);
    const direction = new THREE.Vector3(0.8, -0.2, -0.5).normalize();
    assert.equal(hostController.releaseByName(hostScene.kernels[1].name, 0.1234, direction), true);

    const hostManager = {
        players: [],
        arena: { serializeSunflowerKernels: () => hostController.serialize() },
    };
    const snapshot = createGameStateSnapshot(hostManager, null);
    assert.deepEqual(snapshot.sunflowerKernels, hostController.serialize());
    assert.equal(snapshot.sunflowerKernels[0].length, 5,
        'ID, millisecond release time, and quantized hit direction must be transmitted');

    const replicaManager = {
        arena: { applySunflowerKernelState: (state) => replicaController.applyNetworkState(state) },
    };
    EntityManager.prototype.applyNetworkSnapshot.call(replicaManager, snapshot);
    hostController.update(1.7);
    replicaController.update(1.7);
    assert.deepEqual(replicaController.serialize(), hostController.serialize());
    assert.ok(worldCenter(hostScene.kernels[1]).distanceTo(worldCenter(replicaScene.kernels[1])) < 1e-6);
    assert.ok(hostScene.kernels[1].quaternion.angleTo(replicaScene.kernels[1].quaternion) < 1e-6);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DandelionSeedController, dandelionWindAt } from '../src/entities/arena/DandelionSeedController.js';

function makeScene() {
    const scene = new THREE.Group();
    for (let index = 1; index <= 3; index += 1) {
        const seed = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.8, 0.1));
        seed.name = `AttachedSeed_${String(index).padStart(3, '0')}_SHOOTABLE_nocol`;
        seed.position.set((index - 1) * 3, 0, 0);
        seed.userData = { role: 'shootable_seed', seed_index: index, pappus_height: 1.8 };
        scene.add(seed);
    }
    return scene;
}

test('a shot releases only its own seed and a second shot cannot release it twice', () => {
    const scene = makeScene();
    const controller = new DandelionSeedController(scene);
    assert.equal(controller.count, 3);
    const first = controller.raycast(new THREE.Vector3(0, 1.8, 5),
        new THREE.Vector3(0, 0, -1), 10);
    assert.equal(first.seedIndex, 1);
    assert.equal(controller.releaseByName(first.sourceName, 4), true);
    assert.equal(controller.releaseByName(first.sourceName, 5), false);
    assert.equal(controller.raycast(new THREE.Vector3(0, 1.8, 5),
        new THREE.Vector3(0, 0, -1), 10), null);
    controller.update(8);
    assert.ok(scene.children[0].position.distanceTo(new THREE.Vector3()) > 1);
    assert.deepEqual(controller.serialize(), [[1, 4]]);
    assert.equal(scene.children[1].position.x, 3);
    controller.reset();
    assert.deepEqual(controller.serialize(), []);
    assert.deepEqual(scene.children[0].position.toArray(), [0, 0, 0]);
});

test('shots hit the narrow seed body and shaft below the pappus crown', () => {
    const controller = new DandelionSeedController(makeScene());
    const origin = new THREE.Vector3(0, 0.45, 5);
    const aim = new THREE.Vector3(0, 0, -1);
    const hit = controller.raycast(origin, aim, 10);
    assert.equal(hit?.seedIndex, 1);
    assert.ok(hit.distance < 5);
});

test('wind changes slowly and release time changes the subsequent flight heading', () => {
    const earlyWind = dandelionWindAt(0);
    const laterWind = dandelionWindAt(90);
    assert.ok(earlyWind.angleTo(laterWind) > 1);
    assert.ok(earlyWind.angleTo(dandelionWindAt(1)) < 0.1);

    const early = new DandelionSeedController(makeScene());
    const late = new DandelionSeedController(makeScene());
    early.releaseByName(early.seeds[0].node.name, 0);
    late.releaseByName(late.seeds[0].node.name, 90);
    early.update(4);
    late.update(94);
    assert.ok(early.seeds[0].node.position.distanceTo(late.seeds[0].node.position) > 0.5);
});

test('drag-limited gravity bends an airborne seed downward after its initial lift', () => {
    const controller = new DandelionSeedController(makeScene());
    const seed = controller.seeds[0];
    controller.releaseByName(seed.node.name, 0);
    const age = 10;
    controller.update(age);
    const liftOnlyY = seed.root.y
        + seed.launch.y * seed.speed * age * 0.72
        + seed.speed * (0.14 * age + 0.16 * Math.sin(age * 1.3 + seed.index));
    assert.ok(seed.currentRoot.y < liftOnlyY - seed.speed,
        `gravity should lower the seed, got ${seed.currentRoot.y} versus ${liftOnlyY}`);
});

test('a replica receives the same release events and can reset for a new round', () => {
    const host = new DandelionSeedController(makeScene());
    const replica = new DandelionSeedController(makeScene());
    host.releaseByName(host.seeds[1].node.name, 12.345);
    replica.applyNetworkState(host.serialize());
    host.update(15);
    replica.update(15);
    assert.deepEqual(replica.serialize(), host.serialize());
    assert.ok(replica.seeds[1].node.position.distanceTo(host.seeds[1].node.position) < 1e-6);
    replica.applyNetworkState([]);
    assert.deepEqual(replica.serialize(), []);
    assert.equal(replica.seeds[1].node.visible, true);
});

test('attached seeds collide across their full length once per continuous vehicle contact', () => {
    const scene = makeScene();
    scene.children[1].position.x = 0.2;
    const controller = new DandelionSeedController(scene);
    const seed = controller.seeds[0];
    const shaft = seed.root.clone().lerp(seed.tip, 0.35);
    const hit = controller.consumeCollision(shaft, 0.4, 2);
    assert.equal(hit.seedIndex, 1);
    assert.equal(hit.attached, true);
    assert.ok(Math.abs(hit.normal.length() - 1) < 1e-9);
    assert.equal(controller.consumeCollision(seed.tip, 0.4, 2), null,
        'overlapping seeds in the dense crown must not stack contacts');
    assert.equal(controller.consumeCollision(new THREE.Vector3(20, 20, 20), 0.4, 2), null);
    assert.equal(controller.consumeCollision(seed.tip, 0.4, 2)?.seedIndex, 1,
        'leaving the crown arms a later contact again');
});

test('attached seed shafts sweep vehicle movement instead of allowing tunneling', () => {
    const controller = new DandelionSeedController(makeScene());
    const seed = controller.seeds[0];
    const previousPosition = new THREE.Vector3(-5, 0.45, 0);
    const position = new THREE.Vector3(5, 0.45, 0);
    const hit = controller.consumeCollision(position, 0.1, 8, previousPosition);
    assert.equal(hit?.seedIndex, seed.index);
    assert.equal(hit?.attached, true);
});

test('a released seed collides softly with each player once', () => {
    const controller = new DandelionSeedController(makeScene());
    const seed = controller.seeds[0];

    controller.releaseByName(seed.node.name, 3);
    controller.update(3.1);
    const hit = controller.consumeCollision(seed.collisionCenter.clone(), 0.4, 2);
    assert.equal(hit.seedIndex, 1);
    assert.ok(Math.abs(hit.normal.length() - 1) < 1e-9);
    assert.equal(controller.consumeCollision(seed.collisionCenter, 0.4, 2), null);
    assert.equal(controller.consumeCollision(seed.collisionCenter, 0.4, 7)?.seedIndex, 1);

    controller.reset();
    assert.equal(controller.consumeCollision(seed.tip, 0.4, 2)?.attached, true);
});

test('seed hitboxes sweep between frames instead of missing fast crossings', () => {
    const controller = new DandelionSeedController(makeScene());
    const seed = controller.seeds[0];
    controller.releaseByName(seed.node.name, 0);
    seed.previousCollisionCenter.copy(seed.tip);
    seed.collisionCenter.copy(seed.tip);

    const previousPosition = seed.tip.clone().add(new THREE.Vector3(-5, 0, 0));
    const position = seed.tip.clone().add(new THREE.Vector3(5, 0, 0));
    assert.ok(position.distanceTo(seed.collisionCenter) > seed.collisionRadius);
    assert.equal(
        controller.consumeCollision(position, 0.4, 4, previousPosition)?.seedIndex,
        seed.index,
    );
});

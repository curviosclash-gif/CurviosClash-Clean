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

test('a released seed collides softly with each player once and attached seeds do not', () => {
    const controller = new DandelionSeedController(makeScene());
    const seed = controller.seeds[0];
    assert.equal(controller.consumeCollision(seed.tip, 0.4, 2), null);

    controller.releaseByName(seed.node.name, 3);
    controller.update(3.1);
    const hit = controller.consumeCollision(seed.collisionCenter.clone(), 0.4, 2);
    assert.equal(hit.seedIndex, 1);
    assert.ok(Math.abs(hit.normal.length() - 1) < 1e-9);
    assert.equal(controller.consumeCollision(seed.collisionCenter, 0.4, 2), null);
    assert.equal(controller.consumeCollision(seed.collisionCenter, 0.4, 7)?.seedIndex, 1);

    controller.reset();
    assert.equal(controller.consumeCollision(seed.tip, 0.4, 2), null);
});

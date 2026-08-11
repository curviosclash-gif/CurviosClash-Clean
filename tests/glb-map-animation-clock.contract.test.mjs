import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { Arena } from '../src/entities/Arena.js';
import { loadGLBMap, loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';

// Two clips of four seconds each. 'slide-x' moves the node from 0 to 4 on X, 'slide-y'
// from 0 to 8 on Y, so the pose alone tells which clip is playing and how far it ran.
function createTwoClipLoader() {
    return {
        async loadAsync() {
            const scene = new THREE.Group();
            const node = new THREE.Object3D();
            node.name = 'setpiece';
            scene.add(node);
            return {
                scene,
                animations: [
                    new THREE.AnimationClip('slide-x', 4, [
                        new THREE.NumberKeyframeTrack('setpiece.position[x]', [0, 4], [0, 4]),
                    ]),
                    new THREE.AnimationClip('slide-y', 4, [
                        new THREE.NumberKeyframeTrack('setpiece.position[y]', [0, 4], [0, 8]),
                    ]),
                ],
            };
        },
    };
}

function createArena(result) {
    const arena = new Arena({ addToScene() {}, removeFromScene() {} });
    arena._portalGateSystem.update = () => {};
    arena._glbScene = result.scene;
    arena.setGlbAnimationTracks(result.animationTracks);
    return arena;
}

function findNode(result) {
    return result.scene.getObjectByName('setpiece');
}

test('an animated setpiece can be placed on an offset phase of the map beat', async () => {
    const result = await loadGLBMap('/setpiece.glb', {
        loader: createTwoClipLoader(),
        collectColliders: false,
        // Half a beat of two seconds: the clip starts one second in.
        animationClock: { beatSeconds: 2, phaseOffsetBeats: 0.5 },
    });
    const arena = createArena(result);
    const node = findNode(result);

    arena.update(0);
    assert.equal(node.position.x, 1);

    arena.update(1);
    assert.equal(node.position.x, 2);

    disposeObject3DResources(result.scene);
});

test('a setpiece plays the clip its clock names, not just the first one', async () => {
    const result = await loadGLBMap('/setpiece.glb', {
        loader: createTwoClipLoader(),
        collectColliders: false,
        animationClock: { clipName: 'slide-y' },
    });
    const arena = createArena(result);
    const node = findNode(result);

    arena.update(2);
    assert.equal(node.position.x, 0);
    assert.equal(node.position.y, 4);

    disposeObject3DResources(result.scene);
});

test('a named clip that the file does not contain falls back to the first clip', async () => {
    const result = await loadGLBMap('/setpiece.glb', {
        loader: createTwoClipLoader(),
        collectColliders: false,
        animationClock: { clipName: 'does-not-exist' },
    });
    const arena = createArena(result);

    arena.update(2);
    assert.equal(findNode(result).position.x, 2);

    disposeObject3DResources(result.scene);
});

test('the pose follows the elapsed time, not the sequence of frame deltas', async () => {
    const evenLoad = await loadGLBMap('/setpiece.glb', {
        loader: createTwoClipLoader(),
        collectColliders: false,
    });
    const jitteredLoad = await loadGLBMap('/setpiece.glb', {
        loader: createTwoClipLoader(),
        collectColliders: false,
    });
    const evenArena = createArena(evenLoad);
    const jitteredArena = createArena(jitteredLoad);

    for (let index = 0; index < 120; index += 1) evenArena.update(1 / 60);
    // Same two seconds of simulation, but delivered in uneven chunks like a stuttering
    // client would.
    for (const step of [0.5, 0.25, 0.75, 0.4, 0.1]) jitteredArena.update(step);

    assert.ok(Math.abs(findNode(evenLoad).position.x - findNode(jitteredLoad).position.x) < 1e-9);
    assert.ok(Math.abs(findNode(evenLoad).position.x - 2) < 1e-9);

    disposeObject3DResources(evenLoad.scene);
    disposeObject3DResources(jitteredLoad.scene);
});

test('an external time source can pull a drifted client back onto the shared pose', async () => {
    const result = await loadGLBMap('/setpiece.glb', {
        loader: createTwoClipLoader(),
        collectColliders: false,
    });
    const arena = createArena(result);

    arena.update(3);
    assert.equal(findNode(result).position.x, 3);

    // The host reports that the round is only one second in.
    arena.setGlbAnimationElapsedSeconds(1);
    arena.update(0);
    assert.equal(findNode(result).position.x, 1);

    disposeObject3DResources(result.scene);
});

test('loading a scene restarts the animation clock at zero', async () => {
    const result = await loadGLBMap('/setpiece.glb', {
        loader: createTwoClipLoader(),
        collectColliders: false,
    });
    const arena = createArena(result);

    arena.update(3);
    arena._clearLoadedGlbScene();
    assert.equal(arena.glbAnimationElapsedSeconds, 0);

    disposeObject3DResources(result.scene);
});

test('a collection gives every model its own phase within one map beat', async () => {
    const result = await loadGLBMapCollection([
        { id: 'gate-a', url: '/a.glb', position: [0, 0, 0], targetSize: 10 },
        { id: 'gate-b', url: '/b.glb', position: [8, 0, 0], targetSize: 10, animationClock: { phaseOffsetBeats: 1 } },
    ], {
        loader: createTwoClipLoader(),
        collectColliders: false,
        animationClock: { beatSeconds: 2 },
    });

    assert.equal(result.animationTracks.length, 2);
    assert.deepEqual(
        result.animationTracks.map((track) => track.clock.phaseOffsetBeats),
        [0, 1],
    );
    assert.deepEqual(
        result.animationTracks.map((track) => track.clock.beatSeconds),
        [2, 2],
    );

    const arena = createArena(result);
    arena.update(0);
    const [first, second] = result.scene.children.map((slot) => slot.getObjectByName('setpiece'));
    assert.equal(first.position.x, 0);
    // One beat of two seconds ahead on a four second clip.
    assert.equal(second.position.x, 2);

    disposeObject3DResources(result.scene);
});

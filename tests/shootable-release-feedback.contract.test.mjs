import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';

import { DandelionSeedController } from '../src/entities/arena/DandelionSeedController.js';
import { SunflowerKernelController } from '../src/entities/arena/SunflowerKernelController.js';
import { emitShootablePartReleaseFeedback } from '../src/entities/effects/ShootablePartReleaseFeedback.js';
import { bindMapFeedback } from '../src/entities/effects/MapFeedbackBindings.js';
import { playGameplayVoice } from '../src/core/audio/GameplayVoices.js';
import { SOUND_COOLDOWNS_MS } from '../src/core/audio/AudioEventProfiles.js';

function seedScene() {
    const scene = new THREE.Group();
    const seed = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.8, 0.1));
    seed.name = 'AttachedSeed_001_SHOOTABLE_nocol';
    seed.position.set(4, 0, 0);
    seed.userData = { role: 'shootable_seed', seed_index: 1, pappus_height: 1.8 };
    scene.add(seed);
    return scene;
}

function kernelScene() {
    const scene = new THREE.Group();
    const kernel = new THREE.Group();
    kernel.name = 'SunflowerKernel_001_SHOOTABLE_nocol';
    kernel.position.set(0, 2, 0);
    kernel.userData = { role: 'shootable_kernel', kernel_index: 1, hit_radius_x: 0.1, hit_radius_y: 0.1, hit_radius_z: 0.1 };
    scene.add(kernel);
    scene.updateWorldMatrix(true, true);
    return scene;
}

test('both plants report every release with its world position and map second', () => {
    const seeds = new DandelionSeedController(seedScene());
    const kernels = new SunflowerKernelController(kernelScene());
    const calls = [];
    seeds.onRelease = (position, at) => calls.push(['seed', position.clone(), at]);
    kernels.onRelease = (position, at) => calls.push(['kernel', position.clone(), at]);
    seeds.releaseByName('AttachedSeed_001_SHOOTABLE_nocol', 3.25);
    kernels.releaseByName('SunflowerKernel_001_SHOOTABLE_nocol', 4.5, new THREE.Vector3(0, 0, -1));
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0][1].toArray(), [4, 1.8, 0], 'the seed puffs at its crown');
    assert.equal(calls[0][2], 3.25);
    assert.deepEqual(calls[1][1].toArray(), [0, 2, 0]);
    assert.equal(calls[1][2], 4.5);
});

function fakeOwner(elapsedSeconds) {
    const spawned = [];
    const played = [];
    return {
        spawned,
        played,
        arena: { glbAnimationElapsedSeconds: elapsedSeconds },
        particles: { spawn: (position, count, color, speed, size) => spawned.push({ position, count, color, speed, size }) },
        audio: { play: (type, options) => played.push({ type, options }) },
    };
}

test('a fresh release puffs a tuft of the plant colour and a soft sound', () => {
    const owner = fakeOwner(10.1);
    assert.equal(emitShootablePartReleaseFeedback(owner, new THREE.Vector3(1, 2, 3), 10, 'dandelionSeeds'), true);
    assert.equal(owner.spawned.length, 1);
    assert.ok(owner.spawned[0].count > 0);
    assert.equal(owner.played[0].type, 'SEED_PUFF');

    const kernelOwner = fakeOwner(5);
    emitShootablePartReleaseFeedback(kernelOwner, new THREE.Vector3(), 5, 'sunflowerKernels');
    assert.notEqual(kernelOwner.spawned[0].color, owner.spawned[0].color, 'kernels are not white fluff');
    assert.ok(kernelOwner.spawned[0].size < owner.spawned[0].size, 'a kernel is far smaller than a pappus');
});

test('a replica catching up on old releases stays silent', () => {
    // A late joiner receives every release of the round at once; 220 puffs in one frame
    // would be noise, not feedback.
    const owner = fakeOwner(90);
    assert.equal(emitShootablePartReleaseFeedback(owner, new THREE.Vector3(), 12, 'dandelionSeeds'), false);
    assert.equal(owner.spawned.length, 0);
    assert.equal(owner.played.length, 0);
});

test('the puff is a real, rate-limited gameplay voice', () => {
    let noise = 0;
    playGameplayVoice({
        _intensity: () => 1,
        _playNoise: () => { noise += 1; },
        _playTone: () => {},
        _playLayered: () => {},
    }, 'SEED_PUFF', {});
    assert.ok(noise > 0);
    assert.ok(SOUND_COOLDOWNS_MS.SEED_PUFF > 0);
});

test('the entity manager feeds arena releases into the feedback', () => {
    const arenaSource = readFileSync(new URL('../src/entities/Arena.js', import.meta.url), 'utf8');
    assert.match(arenaSource, /seeds\.onRelease = /);
    assert.match(arenaSource, /sunflowerKernels\.onRelease = /);
    const manager = readFileSync(new URL('../src/entities/EntityManager.js', import.meta.url), 'utf8');
    assert.match(manager, /bindMapFeedback\(this, arena\)/);

    let listener = null;
    const owner = fakeOwner(7);
    bindMapFeedback(owner, { setShootableReleaseListener: (callback) => { listener = callback; } });
    assert.equal(typeof owner.onMapDestructibleBreak, 'function');
    listener(new THREE.Vector3(), 7, 'dandelionSeeds');
    assert.equal(owner.played[0]?.type, 'SEED_PUFF');
});

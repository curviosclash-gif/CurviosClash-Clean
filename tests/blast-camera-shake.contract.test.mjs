import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { ParticleSystem } from '../src/entities/Particles.js';
import { resolveBlastShake } from '../src/entities/effects/BlastCameraShake.js';
import { HUNT_CONFIG } from '../src/hunt/HuntConfig.js';

/**
 * Stands in for Renderer: only the three seams a blast actually touches are
 * modelled - the local camera list (one entry per local player, which is why
 * bots never appear here), the shake entry point, and the reduce-motion setting.
 */
function createRendererStub({ cameraPositions = [[0, 0, 0]], reduceMotion = false } = {}) {
    const shakeCalls = [];
    return {
        shakeCalls,
        cameras: cameraPositions.map((xyz) => ({ position: new THREE.Vector3(...xyz) })),
        addToScene() {},
        removeFromScene() {},
        getCameraPerspectiveSettings: () => ({ reduceMotion }),
        triggerCameraShake(playerIndex, intensity, duration) {
            shakeCalls.push({ playerIndex, intensity, duration });
        },
    };
}

function createParticles(renderer) {
    return new ParticleSystem(renderer, { HUNT: HUNT_CONFIG });
}

test('shake strength falls off with distance and dies out beyond the blast reach', () => {
    const near = resolveBlastShake(1, 5.2);
    const far = resolveBlastShake(15, 5.2);
    const outOfRange = resolveBlastShake(200, 5.2);

    assert.ok(near.intensity > far.intensity, 'a blast at your feet outshakes one across the arena');
    assert.ok(far.intensity > 0, 'a blast still inside its reach is felt');
    assert.equal(outOfRange.intensity, 0, 'a blast across the map does not rattle the screen');
    assert.equal(outOfRange.duration, 0);
});

test('a bigger blast shakes harder and longer than a small one at the same distance', () => {
    const deathBlast = resolveBlastShake(4, 8.3);
    const itemBurst = resolveBlastShake(4, 1.6);

    assert.ok(deathBlast.intensity > itemBurst.intensity);
    assert.ok(deathBlast.duration > itemBurst.duration);
    // Stay inside the range the rest of the game uses, so a blast never out-shouts
    // the killcam or the damage shake.
    assert.ok(deathBlast.intensity <= 0.52);
    assert.ok(deathBlast.duration <= 0.38);
});

test('an explosion next to a player shakes their camera without any damage event', () => {
    const renderer = createRendererStub({ cameraPositions: [[0, 0, 2]] });
    const particles = createParticles(renderer);

    // No damage is dealt here at all - this is exactly the case the old
    // damage-driven shake could never see.
    particles.spawnExplosion(new THREE.Vector3(0, 0, 0), 0xffffff, { cause: 'WALL' });

    assert.equal(renderer.shakeCalls.length, 1);
    assert.equal(renderer.shakeCalls[0].playerIndex, 0);
    assert.ok(renderer.shakeCalls[0].intensity > 0);
    particles.dispose();
});

test('split-screen players are shaken by their own distance, not a shared one', () => {
    // Player 0 stands next to the blast, player 1 further out but still inside it.
    const renderer = createRendererStub({ cameraPositions: [[0, 0, 1], [0, 0, 8]] });
    const particles = createParticles(renderer);

    particles.spawnExplosion(new THREE.Vector3(0, 0, 0), 0xffffff, { cause: 'WALL' });

    const byPlayer = new Map(renderer.shakeCalls.map((call) => [call.playerIndex, call]));
    assert.equal(byPlayer.size, 2, 'both local views are considered');
    assert.ok(
        byPlayer.get(0).intensity > byPlayer.get(1).intensity,
        'the player standing in the blast is shaken harder than the one further out'
    );
    particles.dispose();
});

test('a local player across the arena is left alone', () => {
    // Player 1 sits far outside the reach of a wall death; only player 0 feels it.
    const renderer = createRendererStub({ cameraPositions: [[0, 0, 1], [0, 0, 60]] });
    const particles = createParticles(renderer);

    particles.spawnExplosion(new THREE.Vector3(0, 0, 0), 0xffffff, { cause: 'WALL' });

    assert.deepEqual(renderer.shakeCalls.map((call) => call.playerIndex), [0]);
    particles.dispose();
});

test('reduce motion suppresses the blast shake entirely', () => {
    const renderer = createRendererStub({ cameraPositions: [[0, 0, 1]], reduceMotion: true });
    const particles = createParticles(renderer);

    particles.spawnExplosion(new THREE.Vector3(0, 0, 0), 0xffffff, { cause: 'WALL' });

    assert.equal(renderer.shakeCalls.length, 0);
    particles.dispose();
});

test('a rocket hitting a wall shakes the camera even though nobody took damage', () => {
    const renderer = createRendererStub({ cameraPositions: [[0, 0, 3]] });
    const particles = createParticles(renderer);

    particles.spawnRocketImpact(new THREE.Vector3(0, 0, 0), 'ROCKET_MEGA');

    assert.equal(renderer.shakeCalls.length, 1);
    assert.ok(renderer.shakeCalls[0].intensity > 0);
    particles.dispose();
});

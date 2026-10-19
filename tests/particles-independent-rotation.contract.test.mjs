import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { ParticleSystem } from '../src/entities/Particles.js';
import { EXPLOSION_BUDGET } from '../src/entities/effects/ConventionalExplosionEffect.js';

const PARTICLE_CAPACITY = EXPLOSION_BUDGET.sharedParticles;

function createParticles() {
    return new ParticleSystem({
        addToScene() {},
        removeFromScene() {},
    });
}

function resetSharedTransform(particles) {
    particles.spawnDirectional(
        new THREE.Vector3(),
        new THREE.Vector3(0, 0, 1),
        1,
        0xffffff,
        1,
        1,
        2,
    );
    particles.clear();
}

function readRotation(particles, index) {
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    particles.mesh.getMatrixAt(index, matrix);
    matrix.decompose(position, quaternion, scale);
    return new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
}

function runFirstParticle(extraParticle) {
    const particles = createParticles();
    try {
        resetSharedTransform(particles);
        particles.spawn(new THREE.Vector3(), extraParticle ? 2 : 1, 0xffffff, 1, 1, 5);
        particles.velocities[0] = 0.7;
        particles.velocities[2] = 0.4;
        if (extraParticle) {
            particles.velocities[3] = -2.5;
            particles.velocities[5] = 3.5;
        }

        particles.update(0.1);
        const afterFirstFrame = readRotation(particles, 0);
        particles.update(0.1);
        return { afterFirstFrame, afterSecondFrame: readRotation(particles, 0) };
    } finally {
        particles.dispose();
    }
}

test('a particle keeps its own spin when another particle is present', () => {
    const alone = runFirstParticle(false);
    const alongside = runFirstParticle(true);

    assert.ok(Math.abs(alone.afterFirstFrame.x - alongside.afterFirstFrame.x) < 1e-6);
    assert.ok(Math.abs(alone.afterFirstFrame.y - alongside.afterFirstFrame.y) < 1e-6);
    assert.ok(Math.abs(alone.afterSecondFrame.x - alone.afterFirstFrame.x) > 0.02,
        'the particle continues rotating on its own across frames');
    assert.ok(Math.abs(alone.afterSecondFrame.x - alongside.afterSecondFrame.x) < 1e-6,
        'the second particle does not contribute to the first particle matrix');
    assert.ok(Math.abs(alone.afterSecondFrame.y - alongside.afterSecondFrame.y) < 1e-6,
        'the second particle does not contribute to the first particle matrix');
});

test('a surviving particle keeps its rotation when compaction moves it to another slot', () => {
    const particles = createParticles();
    try {
        resetSharedTransform(particles);
        particles.spawn(new THREE.Vector3(), 2, 0xffffff, 1, 1, 5);
        particles.lifetimes[0] = 0.01;
        particles.maxLifetimes[1] = 1;
        particles.lifetimes[1] = 1;
        particles.velocities[3] = 0.4;
        particles.velocities[5] = 0.8;

        particles.update(0.1);
        assert.equal(particles.count, 1);
        assert.ok(Math.abs(readRotation(particles, 0).x - 0.08) < 1e-6);
        assert.ok(Math.abs(readRotation(particles, 0).y - 0.04) < 1e-6);

        particles.update(0.1);
        assert.ok(Math.abs(readRotation(particles, 0).x - 0.16) < 1e-6,
            'the compacted particle continues its own rotation instead of restarting');
        assert.ok(Math.abs(readRotation(particles, 0).y - 0.08) < 1e-6);
    } finally {
        particles.dispose();
    }
});

test('a recycled slot starts a fresh rotation and then advances from its own velocity', () => {
    const particles = createParticles();
    try {
        resetSharedTransform(particles);
        particles.spawn(new THREE.Vector3(), 1, 0xffffff, 1, 1, 5);
        particles.velocities[2] = 1.2;
        particles.update(0.5);
        assert.ok(Math.abs(readRotation(particles, 0).x) > 0.1,
            'the original particle has a nonzero spin before its slot is recycled');

        particles.spawn(new THREE.Vector3(), PARTICLE_CAPACITY - 1, 0xffffff, 1, 1, 5);
        assert.equal(particles.count, PARTICLE_CAPACITY);
        particles.spawn(new THREE.Vector3(), 1, 0xffffff, 1, 1, 5);

        assert.ok(Math.abs(readRotation(particles, 0).x) < 1e-6,
            'the recycled particle does not inherit its previous owner’s orientation');
        particles.velocities[2] = 0.6;
        particles.update(0.1);
        assert.ok(Math.abs(readRotation(particles, 0).x - 0.06) < 1e-6,
            'the recycled particle rotates at its own velocity-based rate');
    } finally {
        particles.dispose();
    }
});

test('two particle systems cannot change each other through the shared transform scratch', () => {
    const first = createParticles(), second = createParticles();
    try {
        first.spawn(new THREE.Vector3(), 1, 0xffffff, 1, 1, 5);
        second.spawn(new THREE.Vector3(), 1, 0xffffff, 1, 1, 5);
        first.velocities[2] = 0.4; first.velocities[0] = 0.2;
        second.velocities[2] = -2; second.velocities[0] = 3;
        first.update(0.1); second.update(0.2); first.update(0.1);
        assert.ok(Math.abs(readRotation(first, 0).x - 0.08) < 1e-6);
        assert.ok(Math.abs(readRotation(first, 0).y - 0.04) < 1e-6);
        assert.ok(Math.abs(readRotation(second, 0).x + 0.4) < 1e-6);
        assert.ok(Math.abs(readRotation(second, 0).y - 0.6) < 1e-6);
    } finally { first.dispose(); second.dispose(); }
});

test('compaction retains distinct accumulated angles after earlier frames', () => {
    const particles = createParticles();
    try {
        particles.spawn(new THREE.Vector3(), 3, 0xffffff, 1, 1, 5);
        particles.velocities[3] = 0.4; particles.velocities[5] = 0.8;
        particles.velocities[6] = -0.2; particles.velocities[8] = -1.2;
        particles.update(0.1); particles.lifetimes[0] = 0.01; particles.update(0.1);
        assert.equal(particles.count, 2);
        assert.ok(Math.abs(readRotation(particles, 0).x - 0.16) < 1e-6);
        assert.ok(Math.abs(readRotation(particles, 0).y - 0.08) < 1e-6);
        assert.ok(Math.abs(readRotation(particles, 1).x + 0.24) < 1e-6);
        particles.lifetimes[0] = 0.01; particles.update(0.1);
        assert.equal(particles.count, 1);
        assert.ok(Math.abs(readRotation(particles, 0).x + 0.36) < 1e-6);
        assert.ok(Math.abs(readRotation(particles, 0).y + 0.06) < 1e-6);
    } finally { particles.dispose(); }
});

for (const directional of [false, true]) {
    test(`clear then ${directional ? 'directional' : 'ordinary'} spawn does not inherit prior spin`, () => {
        const particles = createParticles();
        try {
            particles.spawn(new THREE.Vector3(), 1, 0xffffff, 1, 1, 5);
            particles.velocities[2] = 2; particles.update(0.2);
            particles.clear();
            if (directional) particles.spawnDirectional(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 1, 0xffffff, 1, 1, 5);
            else particles.spawn(new THREE.Vector3(), 1, 0xffffff, 1, 1, 5);
            assert.ok(Math.abs(readRotation(particles, 0).x) < 1e-6);
            assert.ok(Math.abs(readRotation(particles, 0).y) < 1e-6);
            particles.velocities[2] = 0.6; particles.velocities[0] = 0.3;
            particles.update(0.1);
            assert.ok(Math.abs(readRotation(particles, 0).x - 0.06) < 1e-6);
            assert.ok(Math.abs(readRotation(particles, 0).y - 0.03) < 1e-6);
        } finally { particles.dispose(); }
    });
}

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { ParticleSystem } from '../src/entities/Particles.js';
import { HUNT_CONFIG } from '../src/hunt/HuntConfig.js';

// The shared particle buffer holds 1000 instances for the whole game.
const GLOBAL_PARTICLE_BUDGET = 1000;
// A mega rocket clears 90 m of trail. Segments are laid down once per simulation
// step, so at fight speed they are roughly half a metre long - about 180 points
// for a single burst. The exact segment length is not the point; the point is
// that the destroyed-segment count can outgrow the buffer that has to draw it.
const MEGA_BLAST_POINTS = 180;
// A weak rocket clears 6 m, which stays well inside the budget.
const WEAK_BLAST_POINTS = 12;

function createParticles() {
    return new ParticleSystem({
        addToScene() {},
        removeFromScene() {},
    }, { HUNT: HUNT_CONFIG });
}

// One point per metre along a straight line, so each destroyed segment carries a
// unique x coordinate and can be identified again in the buffer afterwards.
function buildBlastLine(count) {
    const points = [];
    for (let i = 0; i < count; i += 1) points.push(new THREE.Vector3(i, 0, 0));
    return points;
}

function collectSpawnedX(particles) {
    const seen = [];
    for (let i = 0; i < particles.count; i += 1) seen.push(particles.positions[i * 3]);
    return seen;
}

test('a mega trail blast does not erase the segments it already drew', () => {
    const particles = createParticles();
    const points = buildBlastLine(MEGA_BLAST_POINTS);

    particles.spawnTrailExplosion(points);

    const spawnedX = collectSpawnedX(particles);
    // 180 points at 8 particles each is 1440 writes into 1000 slots, so the burst
    // wrapped around and recycled its own oldest slots: the segments nearest the
    // impact were gone before the far end of the blast had finished drawing.
    assert.equal(Math.min(...spawnedX), points[0].x, 'the blast still starts at the first destroyed segment');
    assert.equal(Math.max(...spawnedX), points.at(-1).x, 'the blast still reaches the last destroyed segment');
    particles.dispose();
});

test('one trail blast leaves room for the effects it shares the buffer with', () => {
    const particles = createParticles();

    particles.spawnTrailExplosion(buildBlastLine(MEGA_BLAST_POINTS));

    // The rocket impact, the kill it causes and every other hit draw from the same
    // 1000 slots. A single burst that claims all of them starves the rest.
    assert.ok(
        particles.count < GLOBAL_PARTICLE_BUDGET,
        `one burst claimed ${particles.count} of ${GLOBAL_PARTICLE_BUDGET} slots`
    );
    particles.dispose();
});

test('a small trail blast spawns exactly what it always did', () => {
    const particles = createParticles();
    const countPerSegment = HUNT_CONFIG.FEEDBACK.TRAIL_EXPLOSION.countPerSegment;

    particles.spawnTrailExplosion(buildBlastLine(WEAK_BLAST_POINTS));

    // Thinning must only start at the budget - a weak rocket looks exactly as before.
    assert.equal(particles.count, WEAK_BLAST_POINTS * countPerSegment);
    assert.equal(collectSpawnedX(particles).length, WEAK_BLAST_POINTS * countPerSegment);
    particles.dispose();
});

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { ParticleSystem } from '../src/entities/Particles.js';
import { HUNT_CONFIG } from '../src/hunt/HuntConfig.js';

function createRendererStub({ graphicsStyle = 'modern' } = {}) {
    const added = [];
    const removed = [];
    return {
        added,
        removed,
        addToScene(object) { added.push(object); },
        removeFromScene(object) { removed.push(object); },
        getGraphicsStyle: () => graphicsStyle,
    };
}

function createParticles(renderer) {
    return new ParticleSystem(renderer, { HUNT: HUNT_CONFIG });
}

test('the modern style adds exactly one blast light and reuses it', () => {
    const renderer = createRendererStub();
    const particles = createParticles(renderer);
    const light = particles.rocketBlastEffect.light;

    assert.ok(light?.isPointLight, 'a point light exists');
    assert.equal(renderer.added.filter((object) => object.isLight).length, 1);
    assert.equal(light.intensity, 0, 'it starts dark');

    particles.spawnRocketImpact(new THREE.Vector3(1, 2, 3), 'ROCKET_MEGA');
    particles.update(0.016);
    assert.ok(light.intensity > 0, 'a fresh blast lights the world');
    assert.equal(light.position.x, 1);
    assert.equal(light.position.z, 3);

    // A second, larger blast must take over the same light rather than add one.
    particles.spawnExplosion(new THREE.Vector3(-4, 0, 0), 0xffffff, {
        cause: 'PROJECTILE',
        projectileType: 'ROCKET_MEGA',
    });
    particles.update(0.016);
    assert.equal(renderer.added.filter((object) => object.isLight).length, 1, 'still only one light');
    assert.equal(light.position.x, -4, 'the brightest blast owns the light');
    particles.dispose();
});

test('the blast light fades out on its own and never lingers', () => {
    const renderer = createRendererStub();
    const particles = createParticles(renderer);
    const light = particles.rocketBlastEffect.light;

    particles.spawnRocketImpact(new THREE.Vector3(), 'ROCKET_HEAVY');
    particles.update(0.016);
    const litIntensity = light.intensity;
    assert.ok(litIntensity > 0);

    // Halfway through the flash the light is dimmer but still on.
    particles.update(0.07);
    assert.ok(light.intensity > 0);
    assert.ok(light.intensity < litIntensity, 'the flash decays');

    // Past the flash window the light is off, even though the blast itself is
    // still visible as glowing debris for another half second.
    particles.update(0.1);
    assert.equal(light.intensity, 0, 'the flash is over well before the blast is');
    assert.ok(particles.rocketBlastEffect.count > 0, 'the blast itself is still alive');
    particles.dispose();
});

test('a bigger blast lights harder than a small one', () => {
    const renderer = createRendererStub();
    const particles = createParticles(renderer);
    const light = particles.rocketBlastEffect.light;

    particles.spawnRocketImpact(new THREE.Vector3(), 'ROCKET_WEAK');
    particles.update(0.016);
    const weakIntensity = light.intensity;
    const weakRange = light.distance;

    particles.clear();
    particles.spawnRocketImpact(new THREE.Vector3(), 'ROCKET_MEGA');
    particles.update(0.016);

    assert.ok(light.intensity > weakIntensity, 'a mega rocket outshines a weak one');
    assert.ok(light.distance > weakRange, 'and reaches further');
    particles.dispose();
});

test('clearing a round leaves the arena dark without detaching the light', () => {
    const renderer = createRendererStub();
    const particles = createParticles(renderer);
    const light = particles.rocketBlastEffect.light;

    particles.spawnRocketImpact(new THREE.Vector3(), 'ROCKET_MEGA');
    particles.update(0.016);
    assert.ok(light.intensity > 0);

    particles.clear();

    assert.equal(light.intensity, 0, 'a round change cannot leave a dead explosion lighting the map');
    // Detaching would force a shader recompile on the next round, so it stays in.
    assert.equal(renderer.removed.length, 0);
    particles.dispose();
});

test('the classic style creates no light at all', () => {
    const renderer = createRendererStub({ graphicsStyle: 'classic' });
    const particles = createParticles(renderer);

    assert.equal(particles.rocketBlastEffect.light, null);
    assert.equal(renderer.added.filter((object) => object.isLight).length, 0);

    // The blast still works, it just does not light the world.
    particles.spawnRocketImpact(new THREE.Vector3(), 'ROCKET_MEGA');
    particles.update(0.016);
    assert.equal(particles.rocketBlastEffect.count, 1);
    particles.dispose();
});

test('disposal removes the light so it cannot leak between rounds', () => {
    const renderer = createRendererStub();
    const particles = createParticles(renderer);
    const light = particles.rocketBlastEffect.light;

    particles.dispose();

    assert.ok(renderer.removed.includes(light), 'the light is taken out of the scene');
});

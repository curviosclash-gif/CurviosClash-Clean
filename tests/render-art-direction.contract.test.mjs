import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { PARCOURS_MAPS } from '../src/core/config/maps/presets/parcours_maps.js';
import { getArenaMaterialBundle } from '../src/entities/arena/ArenaBuildResourceCache.js';
import { ParticleSystem } from '../src/entities/Particles.js';
import { HUNT_CONFIG } from '../src/hunt/HuntConfig.js';

test('desktop art pass keeps Rift landmarks visual-only and uses readable PBR surfaces', () => {
    const rift = PARCOURS_MAPS.parcours_rift;
    assert.equal(rift.glbColliderMode, 'fallbackOnly');
    assert.ok(rift.glbModels.length >= 5);
    assert.ok(rift.glbModels.every((entry) => entry.url.startsWith('assets/models/downloaded_cc0/')));
    assert.ok(rift.glbModels.every((entry) => entry.graphicsStyle === 'modern'));

    const bundle = getArenaMaterialBundle({
        checkerLightColor: 0x243b58,
        checkerDarkColor: 0x0d1626,
        checkerWorldSize: 18,
        sx: 260,
        sy: 84,
        sz: 180,
        graphicsStyle: 'modern',
    });
    assert.equal(bundle.floorTexture.colorSpace, THREE.SRGBColorSpace);
    assert.ok(bundle.wallMat.roughness < 0.75);
    assert.ok(bundle.floorMat.metalness > 0.1);
    assert.ok(bundle.obstacleMat.emissiveIntensity > 0);
});

test('arena textures carry the reported anisotropy and cache one bundle per level', () => {
    const params = {
        checkerLightColor: 0x243b58,
        checkerDarkColor: 0x0d1626,
        checkerWorldSize: 18,
        sx: 120,
        sy: 40,
        sz: 120,
        graphicsStyle: 'modern',
    };

    const sharp = getArenaMaterialBundle({ ...params, maxAnisotropy: 16 });
    assert.equal(sharp.floorTexture.anisotropy, 16);
    assert.equal(sharp.wallTexture.anisotropy, 16);

    // Without the anisotropy in the cache key this would hand back the bundle above, and the
    // setting would silently do nothing on every map built after the first one.
    const blurry = getArenaMaterialBundle({ ...params, maxAnisotropy: 1 });
    assert.notEqual(blurry, sharp);
    assert.equal(blurry.floorTexture.anisotropy, 1);

    // Identical inputs must still share one bundle, or every map build would leak textures.
    assert.equal(getArenaMaterialBundle({ ...params, maxAnisotropy: 16 }), sharp);

    // A renderer that cannot report a ceiling falls back to 1 instead of leaking NaN into the key.
    const fallback = getArenaMaterialBundle({ ...params, sx: 121, maxAnisotropy: Number.NaN });
    assert.equal(fallback.floorTexture.anisotropy, 1);
});

test('particle pass uses an additive low-poly glow without adding a dependency', () => {
    const added = [];
    const removed = [];
    const particles = new ParticleSystem({
        addToScene(object) { added.push(object); },
        removeFromScene(object) { removed.push(object); },
    });

    assert.equal(particles.mesh.geometry.type, 'OctahedronGeometry');
    assert.equal(particles.mesh.material.blending, THREE.AdditiveBlending);
    assert.equal(particles.mesh.material.depthWrite, false);
    assert.equal(particles.rocketBlastEffect.coreMesh.material.blending, THREE.AdditiveBlending);
    assert.equal(particles.rocketBlastEffect.waveMesh.material.wireframe, true);
    // Particle mesh, blast core, blast shockwave and the single reused blast light.
    particles.dispose();
    assert.equal(added.length, 4);
    assert.equal(removed.length, 4, 'everything put into the scene is taken back out');
});

test('rocket impacts animate a tier-scaled fireball and expanding shockwave', () => {
    const particles = new ParticleSystem({
        addToScene() {},
        removeFromScene() {},
    });
    const impact = new THREE.Vector3(3, 4, 5);

    particles.spawnRocketImpact(impact, 'ROCKET_MEGA');

    assert.equal(particles.rocketBlastEffect.count, 1);
    assert.equal(particles.rocketBlastEffect.coreMesh.count, 1);
    assert.equal(particles.rocketBlastEffect.waveMesh.count, 1);
    assert.ok(Math.abs(particles.rocketBlastEffect.radii[0] - 4.8) < 0.001);

    const initialMatrix = new THREE.Matrix4();
    const animatedMatrix = new THREE.Matrix4();
    const initialScale = new THREE.Vector3();
    const animatedScale = new THREE.Vector3();
    particles.rocketBlastEffect.waveMesh.getMatrixAt(0, initialMatrix);
    initialScale.setFromMatrixScale(initialMatrix);

    particles.update(0.2);
    particles.rocketBlastEffect.waveMesh.getMatrixAt(0, animatedMatrix);
    animatedScale.setFromMatrixScale(animatedMatrix);

    assert.ok(animatedScale.x > initialScale.x);
    particles.update(1);
    assert.equal(particles.rocketBlastEffect.count, 0);
    assert.equal(particles.rocketBlastEffect.coreMesh.count, 0);
    assert.equal(particles.rocketBlastEffect.waveMesh.count, 0);
    particles.dispose();
});

test('deaths detonate wider and slower than the strongest rocket tier', () => {
    const particles = new ParticleSystem({
        addToScene() {},
        removeFromScene() {},
    });
    const origin = new THREE.Vector3(1, 2, 3);

    particles.spawnExplosion(origin, 0x44ff88);

    assert.equal(particles.rocketBlastEffect.count, 1);
    assert.ok(particles.rocketBlastEffect.radii[0] > 4.8, 'death blast outgrows the mega rocket blast');
    assert.ok(particles.rocketBlastEffect.maxLifetimes[0] > 0.72, 'death blast outlasts the mega rocket blast');

    particles.spawnExplosion(origin, 0xff0000, { blast: 'ITEM_BURST' });

    assert.equal(particles.rocketBlastEffect.count, 2);
    assert.ok(particles.rocketBlastEffect.radii[1] < 2.6, 'knocking an item loose stays below the weakest rocket');
    particles.dispose();
});

test('suppressed presentation withholds the death blast, not just its particles', () => {
    const particles = new ParticleSystem({
        addToScene() {},
        removeFromScene() {},
    });
    const origin = new THREE.Vector3();

    particles.setPresentationSuppressed(true);
    particles.spawnExplosion(origin, 0xffffff);
    assert.equal(particles.rocketBlastEffect.count, 0);

    particles.spawnExplosion(origin, 0xffffff, { presentationOverride: true });
    assert.equal(particles.rocketBlastEffect.count, 1);
    particles.dispose();
});

test('particles flash hot on spawn and burn out before they vanish', () => {
    const particles = new ParticleSystem({
        addToScene() {},
        removeFromScene() {},
        getGraphicsStyle: () => 'classic',
    });
    // No channel sits at full brightness, so the ramp stays measurable in both
    // directions instead of clipping.
    const base = new THREE.Color(0x3366cc);
    const sampled = new THREE.Color();

    // Zero speed and gravity keep the particle in place so only the ramp moves.
    particles.spawn(new THREE.Vector3(), 1, 0x3366cc, 0, 0.5, 1.0, { gravity: 0 });

    particles.update(0.01);
    particles.mesh.getColorAt(0, sampled);
    assert.ok(sampled.r > base.r, 'the flash phase pushes the dark channels toward white');
    assert.ok(sampled.b > base.b, 'the flash phase brightens the identity colour');

    // Spawn jitter puts the lifetime in [0.8, 1.2], so 0.71s elapsed always lands
    // inside the burnout window while leaving the particle alive.
    particles.update(0.7);
    particles.mesh.getColorAt(0, sampled);
    assert.equal(particles.count, 1);
    assert.ok(sampled.b < base.b, 'burnout darkens the particle before it dies');
    particles.dispose();
});

test('a death explosion scales with the cause and the weapon that landed it', () => {
    const particles = new ParticleSystem({
        addToScene() {},
        removeFromScene() {},
    }, { HUNT: HUNT_CONFIG });
    const origin = new THREE.Vector3();

    particles.spawnExplosion(origin, 0xffffff, { cause: 'WALL' });
    const wallCount = particles.count;
    const wallRadius = particles.rocketBlastEffect.radii[0];
    const wallLifetime = particles.rocketBlastEffect.maxLifetimes[0];

    particles.clear();
    particles.spawnExplosion(origin, 0xffffff, { cause: 'PROJECTILE', projectileType: 'ROCKET_MEGA' });
    const megaCount = particles.count;
    const megaRadius = particles.rocketBlastEffect.radii[0];

    assert.ok(megaCount > wallCount, 'a mega rocket kill throws more debris than a wall death');
    assert.ok(megaRadius > wallRadius, 'a mega rocket kill detonates wider than a wall death');
    // The blast is a fast slap that gets wider, not a slow one that lingers.
    assert.equal(particles.rocketBlastEffect.maxLifetimes[0], wallLifetime);

    // A weak rocket has to land between the two, otherwise the tiers are decoration.
    particles.clear();
    particles.spawnExplosion(origin, 0xffffff, { cause: 'PROJECTILE', projectileType: 'ROCKET_WEAK' });
    assert.ok(particles.rocketBlastEffect.radii[0] > wallRadius);
    assert.ok(particles.rocketBlastEffect.radii[0] < megaRadius);
    particles.dispose();
});

test('knocking an item loose stays pickup-sized even when a mega rocket did it', () => {
    const particles = new ParticleSystem({
        addToScene() {},
        removeFromScene() {},
    }, { HUNT: HUNT_CONFIG });
    const origin = new THREE.Vector3();

    particles.spawnExplosion(origin, 0xff0000, { blast: 'ITEM_BURST' });
    const plainCount = particles.count;
    const plainRadius = particles.rocketBlastEffect.radii[0];

    particles.clear();
    particles.spawnExplosion(origin, 0xff0000, {
        blast: 'ITEM_BURST',
        cause: 'PROJECTILE',
        projectileType: 'ROCKET_MEGA',
    });

    assert.equal(particles.count, plainCount, 'an item burst does not grow with the weapon');
    assert.equal(particles.rocketBlastEffect.radii[0], plainRadius);
    particles.dispose();
});

test('rocket blast saturation replaces an expiring blast instead of dropping the new impact', () => {
    const particles = new ParticleSystem({
        addToScene() {},
        removeFromScene() {},
    });

    for (let i = 0; i < 33; i++) {
        particles.spawnRocketImpact(new THREE.Vector3(i, 0, 0), 'ROCKET_WEAK');
    }

    assert.equal(particles.rocketBlastEffect.count, 32);
    assert.ok(Array.from(particles.rocketBlastEffect.positions).includes(32));
    particles.dispose();
});

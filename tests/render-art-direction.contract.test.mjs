import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { PARCOURS_MAPS } from '../src/core/config/maps/presets/parcours_maps.js';
import { getArenaMaterialBundle } from '../src/entities/arena/ArenaBuildResourceCache.js';
import { ParticleSystem } from '../src/entities/Particles.js';

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
    particles.dispose();
    assert.equal(added.length, 3);
    assert.equal(removed.length, 3);
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

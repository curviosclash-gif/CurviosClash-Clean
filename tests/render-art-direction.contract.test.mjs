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
    particles.dispose();
    assert.equal(added.length, 1);
    assert.equal(removed.length, 1);
});

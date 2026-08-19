import assert from 'node:assert/strict';
import test from 'node:test';

import { Trail } from '../src/entities/Trail.js';

function createRenderer() {
    return {
        addToScene() {},
        removeFromScene() {},
        getGraphicsStyle: () => 'modern',
    };
}

test('trail impostor renders only on the direct framebuffer', () => {
    const trail = new Trail(createRenderer(), 0x33aaff, 0, {
        getTrailSpatialIndex: () => null,
    });

    assert.ok(trail.material.emissiveIntensity > 1, 'the real trail crosses the bloom threshold');
    trail.glowMesh.onBeforeRender({ getRenderTarget: () => ({}) });
    assert.equal(trail.glowMaterial.colorWrite, false, 'composer render suppresses the impostor');
    trail.glowMesh.onBeforeRender({ getRenderTarget: () => null });
    assert.equal(trail.glowMaterial.colorWrite, true, 'direct split-screen keeps its existing halo');

    trail.dispose();
    assert.equal(trail.glowMaterial, null);
});

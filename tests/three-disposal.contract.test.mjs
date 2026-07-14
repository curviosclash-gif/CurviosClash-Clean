import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    disposeMaterialResources,
    disposeObject3DResources,
} from '../src/shared/rendering/ThreeDisposal.js';

function createDisposable(overrides = {}) {
    return {
        disposeCount: 0,
        dispose() {
            this.disposeCount += 1;
        },
        ...overrides,
    };
}

test('Three disposal releases shared material textures exactly once', () => {
    const map = createDisposable({ isTexture: true });
    const uniformTexture = createDisposable({ isTexture: true });
    const material = createDisposable({
        map,
        uniforms: {
            surface: { value: [map, uniformTexture] },
        },
    });

    disposeMaterialResources([material, material]);

    assert.equal(material.disposeCount, 1);
    assert.equal(map.disposeCount, 1);
    assert.equal(uniformTexture.disposeCount, 1);
});

test('Three disposal releases geometry, materials and instanced resources without duplicates', () => {
    const geometry = createDisposable();
    const texture = createDisposable({ isTexture: true });
    const material = createDisposable({ map: texture });
    const instancedMesh = createDisposable({
        isInstancedMesh: true,
        geometry,
        material,
    });
    const sharedMesh = { geometry, material };
    const skippedGeometry = createDisposable({ userData: { __sharedNoDispose: true } });
    const skippedMaterial = createDisposable({ userData: { __sharedNoDispose: true } });
    const root = {
        traverse(visitor) {
            [instancedMesh, sharedMesh, {
                geometry: skippedGeometry,
                material: skippedMaterial,
            }].forEach(visitor);
        },
    };

    disposeObject3DResources(root);

    assert.equal(instancedMesh.disposeCount, 1);
    assert.equal(geometry.disposeCount, 1);
    assert.equal(material.disposeCount, 1);
    assert.equal(texture.disposeCount, 1);
    assert.equal(skippedGeometry.disposeCount, 0);
    assert.equal(skippedMaterial.disposeCount, 0);
});

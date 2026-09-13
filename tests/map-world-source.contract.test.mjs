import assert from 'node:assert/strict';
import test from 'node:test';
import { Raycaster, Vector3, Mesh, BufferGeometry, Float32BufferAttribute,
    MeshBasicMaterial, DoubleSide } from 'three';
import { createMapWorldSource } from '../scripts/map-world-source.mjs';

function asMesh(data) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(data.positions, 3));
    geometry.setIndex(data.indices);
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
    mesh.updateMatrixWorld(true);
    return mesh;
}

test('Blender source preserves clear tunnel mouths and their rotation', () => {
    const fixtures = {
        tunnel: { pos: [0, 0, 0], size: [12, 12, 8], tunnel: { radius: 3, axis: 'z' } },
        rotated: { pos: [0, 0, 0], size: [12, 12, 8], tunnel: { radius: 3, axis: 'z' }, rotateY: Math.PI / 2 },
        tube: { shape: 'tube', start: [0, 0, -4], end: [0, 0, 4], radius: 3 },
    };
    for (const [key, obstacle] of Object.entries(fixtures)) {
        const source = createMapWorldSource(key, { [key]: { size: [30, 30, 30], obstacles: [obstacle] } });
        const mesh = asMesh(source.meshes[0]);
        const direction = key === 'rotated' ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
        const origin = direction.clone().multiplyScalar(-20);
        assert.equal(new Raycaster(origin, direction).intersectObject(mesh).length, 0, `${key}: passage stays open`);
        // A ray across the passage wall must still hit the authored surface.
        const sideways = key === 'rotated' ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
        assert.ok(new Raycaster(new Vector3(), sideways).intersectObject(mesh).length > 0, `${key}: wall retained`);
        mesh.geometry.dispose();
        mesh.material.dispose();
    }
});

test('source export is deterministic, preserves gameplay data and skips native GLB overlays', () => {
    const first = createMapWorldSource('wind_cathedral');
    assert.deepEqual(first, createMapWorldSource('wind_cathedral'));
    assert.notEqual(first.seed, createMapWorldSource('standard').seed);
    assert.ok(first.meshes.some((mesh) => mesh.kind === 'foam'));
    assert.equal(first.definition.parcours.routeId, 'wind_cathedral_v1');
    const map = { size: [30, 30, 30], obstacles: [
        { pos: [0, 2, 0], size: [2, 4, 2], renderWithGlb: true },
        { pos: [4, 2, 0], size: [2, 4, 2] },
    ] };
    const snapshot = JSON.stringify(map);
    const source = createMapWorldSource('fixture', { fixture: map });
    assert.equal(source.meshes.length, 1);
    assert.equal(source.meshes[0].id, 'obstacle_1');
    assert.equal(JSON.stringify(map), snapshot);
    for (const key of ['custom', '../escape', 'unknown']) assert.throws(() => createMapWorldSource(key));
});

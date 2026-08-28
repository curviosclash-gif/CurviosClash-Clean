import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { resolveVisibleShadowBounds } from '../src/entities/arena/ShadowCoverageOps.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';

// Notre-Dame's arena in world units, which is what the builder hands the lighting rig today.
const NOTRE_DAME_ARENA = Object.freeze({
    minX: -690, maxX: 690, minY: 0, maxY: 450, minZ: -480, maxZ: 480,
});

// Measured in the running desktop build. The island is what makes this map the case the terrain
// rule exists for: it is wider than everything else together and almost entirely flat.
const NOTRE_DAME_PARTS = Object.freeze([
    { name: 'parvis-island', center: [-92, 41, 0], size: [1090, 50, 722] },
    { name: 'west-facade', center: [-249, 175, 0], size: [40, 317, 185] },
    { name: 'nave', center: [-104, 96, 0], size: [254, 143, 179] },
    { name: 'transept', center: [51, 112, 0], size: [71, 176, 212] },
    { name: 'choir-apse', center: [175, 96, 0], size: [191, 143, 175] },
    { name: 'buttresses', center: [22, 88, 0], size: [492, 129, 221] },
    { name: 'roof-fleche', center: [19, 256, 0], size: [498, 345, 202] },
    { name: 'tower-crane', center: [89, 158, -297], size: [161, 267, 118] },
    { name: 'fleche-hoist', center: [390, 89, 0], size: [62, 130, 62] },
]);

function partNode({ center, size }) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]));
    mesh.position.set(center[0], center[1], center[2]);
    const part = new THREE.Object3D();
    part.add(mesh);
    return part;
}

function sceneOfParts(parts) {
    const scene = new THREE.Object3D();
    for (const part of parts) scene.add(partNode(part));
    scene.updateMatrixWorld(true);
    return scene;
}

test('flat terrain is dropped so it stops deciding the frustum size', () => {
    const withIsland = resolveVisibleShadowBounds({
        scene: sceneOfParts(NOTRE_DAME_PARTS),
        arenaBounds: NOTRE_DAME_ARENA,
    });
    const withoutIsland = resolveVisibleShadowBounds({
        scene: sceneOfParts(NOTRE_DAME_PARTS.filter((part) => part.name !== 'parvis-island')),
        arenaBounds: NOTRE_DAME_ARENA,
    });

    assert.ok(withIsland && withoutIsland);
    assert.deepEqual(
        withIsland,
        withoutIsland,
        'the island must not widen the frustum, because it receives shadow rather than casting it'
    );
    // The island spans 1090 units; the casters span 874. Keeping it would cost a quarter of the
    // texel density for a piece that is 50 units tall.
    assert.ok(
        withIsland.maxX - withIsland.minX < 1000,
        `frustum has to come in under the island's own width, got ${withIsland.maxX - withIsland.minX}`
    );
});

test('the casters that matter stay inside the frustum', () => {
    const bounds = resolveVisibleShadowBounds({
        scene: sceneOfParts(NOTRE_DAME_PARTS),
        arenaBounds: NOTRE_DAME_ARENA,
    });
    assert.ok(bounds);
    // The crane out at z -356 and the lifting gantry at x 421 are the two extremes. Dropping either
    // would take a visible shadow off the map, so the box has to reach both.
    assert.ok(bounds.minZ <= -356, `crane has to stay covered, minZ is ${bounds.minZ}`);
    assert.ok(bounds.maxX >= 421, `lifting gantry has to stay covered, maxX is ${bounds.maxX}`);
    assert.ok(bounds.maxY >= 428, 'the spire tip must not be clipped out of the shadow camera');
    assert.ok(bounds.maxY <= NOTRE_DAME_ARENA.maxY, 'and it stays inside the arena ceiling');
});

test('the frustum is worth the rebuild it costs', () => {
    const bounds = resolveVisibleShadowBounds({
        scene: sceneOfParts(NOTRE_DAME_PARTS),
        arenaBounds: NOTRE_DAME_ARENA,
    });
    assert.ok(bounds);
    const before = Math.max(
        NOTRE_DAME_ARENA.maxX - NOTRE_DAME_ARENA.minX,
        NOTRE_DAME_ARENA.maxZ - NOTRE_DAME_ARENA.minZ
    );
    const after = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
    assert.ok(
        after < before * 0.75,
        `the widest extent has to fall by at least a quarter, got ${after} from ${before}`
    );
});

test('a map whose casters fill its box keeps the arena frustum', () => {
    // 0.95 of the arena width - above the shrink threshold, so refitting would buy nothing.
    const scene = sceneOfParts([{ center: [0, 200, 0], size: [1311, 400, 912] }]);
    assert.equal(
        resolveVisibleShadowBounds({ scene, arenaBounds: NOTRE_DAME_ARENA }),
        null,
        'content nearly as wide as the arena leaves the coverage alone'
    );
});

test('a map made only of flat pieces still gets a frustum', () => {
    // Nothing here passes the caster test, but there is no terrain to drop either - a plate map is
    // all the geometry there is, and falling back to the arena box would throw away the fit.
    const scene = sceneOfParts([
        { center: [0, 20, 0], size: [300, 10, 300] },
        { center: [120, 25, 60], size: [200, 8, 200] },
    ]);
    const bounds = resolveVisibleShadowBounds({ scene, arenaBounds: NOTRE_DAME_ARENA });
    assert.ok(bounds, 'an all-flat map keeps a fitted frustum instead of falling back');
    // The two plates together span 370 units, so anything near that beats the 1380 arena by far.
    assert.ok(
        bounds.maxX - bounds.minX < 450,
        `frustum should hug the plates, got ${bounds.maxX - bounds.minX}`
    );
});

test('the floor stays inside the frustum even when every caster hangs above it', () => {
    const scene = sceneOfParts([{ center: [0, 300, 0], size: [200, 100, 200] }]);
    const bounds = resolveVisibleShadowBounds({ scene, arenaBounds: NOTRE_DAME_ARENA });
    assert.ok(bounds);
    assert.equal(
        bounds.minY,
        NOTRE_DAME_ARENA.minY,
        'a receiver on the ground must not fall out of the shadow camera'
    );
});

test('the frustum never leaves the arena it belongs to', () => {
    // Sits against the eastern wall, so the margin would push the box outside the arena.
    const scene = sceneOfParts([{ center: [680, 100, 470], size: [40, 200, 40] }]);
    const bounds = resolveVisibleShadowBounds({ scene, arenaBounds: NOTRE_DAME_ARENA });
    assert.ok(bounds);
    assert.equal(bounds.maxX, NOTRE_DAME_ARENA.maxX);
    assert.equal(bounds.maxZ, NOTRE_DAME_ARENA.maxZ);
    assert.ok(bounds.maxY <= NOTRE_DAME_ARENA.maxY);
});

test('nothing to measure leaves the coverage alone', () => {
    assert.equal(
        resolveVisibleShadowBounds({ scene: new THREE.Object3D(), arenaBounds: NOTRE_DAME_ARENA }),
        null
    );
    assert.equal(resolveVisibleShadowBounds({ scene: null, arenaBounds: NOTRE_DAME_ARENA }), null);
    assert.equal(resolveVisibleShadowBounds({}), null);
});

test('a broken arena box is refused rather than turned into a frustum', () => {
    const scene = sceneOfParts([{ center: [0, 100, 0], size: [100, 100, 100] }]);
    for (const broken of [
        { ...NOTRE_DAME_ARENA, maxX: NOTRE_DAME_ARENA.minX },
        { ...NOTRE_DAME_ARENA, minZ: Number.NaN },
        { ...NOTRE_DAME_ARENA, maxY: -1 },
        null,
    ]) {
        assert.equal(
            resolveVisibleShadowBounds({ scene, arenaBounds: broken }),
            null,
            `refuses ${JSON.stringify(broken)}`
        );
    }
});

test('Notre-Dame is still the map this was measured on', () => {
    const map = MAP_PRESET_CATALOG.notre_dame;
    assert.ok(map, 'the route map is still in the catalogue');
    const [sizeX, sizeY, sizeZ] = map.size;
    // The runtime scales authored anchors by ARENA.MAP_SCALE, which is 3.
    const scale = 3;
    assert.deepEqual(
        {
            minX: -(sizeX * scale) / 2, maxX: (sizeX * scale) / 2,
            minY: 0, maxY: sizeY * scale,
            minZ: -(sizeZ * scale) / 2, maxZ: (sizeZ * scale) / 2,
        },
        { ...NOTRE_DAME_ARENA },
        'the arena these numbers were measured against still matches the preset'
    );
});

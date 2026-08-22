import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG } from '../src/core/Config.js';
import { SceneLightingRig } from '../src/core/renderer/SceneLightingRig.js';

function createRig() {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x000000, 50, 200);
    const renderer = { toneMappingExposure: 1 };
    return new SceneLightingRig({ scene, renderer, config: CONFIG });
}

function frustumToSphereRatio(rig) {
    const { radius } = rig.getShadowCoverage();
    const camera = rig.keyLight.shadow.camera;
    const fitted = (camera.right - camera.left) * (camera.top - camera.bottom);
    return fitted / (4 * radius * radius);
}

// A 260 by 180 metre map, the size the Rift parcours actually runs at.
const LARGE_MAP = Object.freeze({
    minX: -130, maxX: 130,
    minY: 0, maxY: 84,
    minZ: -90, maxZ: 90,
});

test('a map that reports its bounds widens the shadow frustum to cover it', () => {
    const rig = createRig();
    const before = rig.getShadowCoverage();
    assert.equal(before.radius, 60, 'the default keeps the previous fixed coverage');

    assert.equal(rig.setShadowCoverage(LARGE_MAP), true);
    const after = rig.getShadowCoverage();

    // Half the diagonal of the map, so any light angle stays covered.
    const expected = 0.5 * Math.hypot(260, 84, 180);
    assert.ok(Math.abs(after.radius - expected) < 0.001);
    assert.ok(after.radius > before.radius);

    // The frustum is fitted to the eight box corners in light space, not to a sphere around the
    // map. A sphere would have to span the corner-to-corner diagonal from every angle and would
    // throw away roughly half the shadow resolution for nothing.
    const camera = rig.keyLight.shadow.camera;
    const width = camera.right - camera.left;
    const height = camera.top - camera.bottom;
    assert.ok(width > 0 && height > 0);
    assert.ok(width < 2 * after.radius, 'tighter than a bounding sphere would be');
    assert.ok(height < 2 * after.radius, 'tighter than a bounding sphere would be');
    // Still large enough to hold the map: the shortest side of the footprint always fits.
    assert.ok(width >= 180, 'the map still fits across the frustum');
});

test('the fitted frustum stays smaller than a bounding sphere, most of all on flat maps', () => {
    const chunky = createRig();
    chunky.setShadowCoverage(LARGE_MAP);
    const chunkyRatio = frustumToSphereRatio(chunky);
    assert.ok(chunkyRatio < 0.9, `a chunky arena still saves area (${chunkyRatio.toFixed(3)})`);

    // The same footprint, but almost flat. A sphere is dominated by a height this map barely uses,
    // so fitting the box is worth far more here.
    const flat = createRig();
    flat.setShadowCoverage({ minX: -130, maxX: 130, minY: 0, maxY: 8, minZ: -90, maxZ: 90 });
    const flatRatio = frustumToSphereRatio(flat);

    assert.ok(flatRatio < chunkyRatio, 'a flatter map gains more from the fit');
});

// This is the actual defect: the key light sat at a fixed (30, 50, 30), which on a map this size
// is inside the level. Everything outside the old -60..60 box had no shadow at all.
test('the key light moves outside the map instead of standing in it', () => {
    const rig = createRig();
    rig.setShadowCoverage(LARGE_MAP);

    const { radius } = rig.getShadowCoverage();
    const center = new THREE.Vector3(...rig.getShadowCoverage().center);
    const distance = rig.keyLight.position.distanceTo(center);

    assert.ok(distance > radius, 'the light clears the map it is supposed to light');
    assert.ok(rig.keyLight.position.y > 84, 'the light clears the ceiling of the map');
    assert.ok(rig.keyLight.shadow.camera.far >= distance, 'the far plane still reaches the map');
    assert.ok(rig.keyLight.shadow.camera.near > 0, 'the near plane stays in front of the camera');
});

test('growing the coverage does not change the lighting direction', () => {
    const rig = createRig();
    const center = new THREE.Vector3();
    const before = rig.keyLight.position.clone()
        .sub(new THREE.Vector3(...rig.getShadowCoverage().center))
        .normalize();

    rig.setShadowCoverage(LARGE_MAP);
    center.set(...rig.getShadowCoverage().center);
    const after = rig.keyLight.position.clone().sub(center).normalize();

    // A directional light is defined by direction alone - pushing it further out must not relight
    // the scene, it may only move the shadow camera back.
    assert.ok(before.distanceTo(after) < 0.0001);
});

test('the light aims at the centre of the map, and the target is in the scene', () => {
    const rig = createRig();
    rig.setShadowCoverage({ minX: 0, maxX: 200, minY: 0, maxY: 40, minZ: -50, maxZ: 50 });

    assert.deepEqual(rig.keyLight.target.position.toArray(), [100, 20, 0]);
    // Without the target in the scene graph three keeps aiming at the world origin.
    assert.ok(rig.keyLight.target.parent, 'the target is part of the scene');
});

test('unusable bounds are rejected and leave the previous coverage untouched', () => {
    const rig = createRig();
    rig.setShadowCoverage(LARGE_MAP);
    const good = rig.getShadowCoverage();

    for (const broken of [
        null,
        undefined,
        {},
        { minX: 0, maxX: 0, minY: 0, maxY: 1, minZ: -1, maxZ: 1 },
        { minX: -1, maxX: 1, minY: 0, maxY: 1, minZ: Number.NaN, maxZ: 1 },
    ]) {
        assert.equal(rig.setShadowCoverage(broken), false);
        assert.deepEqual(rig.getShadowCoverage(), good);
    }
});

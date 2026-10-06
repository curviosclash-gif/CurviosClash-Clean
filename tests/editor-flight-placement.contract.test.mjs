import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import {
    FLIGHT_PLACEMENT_DISTANCE_RADII,
    isTwoPointFlightTool,
    resolveCrosshairTarget,
    resolveFlightFacing,
    resolveSurfaceContactOffset,
    resolveTwoPointBox,
} from '../editor/js/EditorFlightPlacement.js';

const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);

test('the crosshair targets the surface it hits and remembers its normal', () => {
    const target = resolveCrosshairTarget({
        origin: new THREE.Vector3(0, 100, 0),
        direction: new THREE.Vector3(0, -1, 0),
        hit: { point: new THREE.Vector3(3, 0, 4), normal: new THREE.Vector3(0, 1, 0) },
        fallbackDistance: 50,
    });
    assert.deepEqual(target.point.toArray(), [3, 0, 4]);
    assert.deepEqual(target.normal.toArray(), [0, 1, 0]);
    assert.equal(target.onSurface, true);
});

test('without a hit the target floats the chosen distance ahead of the ship', () => {
    const target = resolveCrosshairTarget({
        origin: new THREE.Vector3(10, 20, 30),
        direction: new THREE.Vector3(0, 0, -2),
        hit: null,
        fallbackDistance: 50,
    });
    assert.deepEqual(target.point.toArray(), [10, 20, -20]);
    assert.equal(target.normal, null);
    assert.equal(target.onSurface, false);
});

test('a hit further away than the free distance still wins, so far ground can be built on', () => {
    const target = resolveCrosshairTarget({
        origin: new THREE.Vector3(0, 500, 0),
        direction: new THREE.Vector3(0, -1, 0),
        hit: { point: new THREE.Vector3(0, 0, 0), normal: new THREE.Vector3(0, 1, 0) },
        fallbackDistance: 50,
    });
    assert.deepEqual(target.point.toArray(), [0, 0, 0]);
});

test('grid snap rounds the horizontal position like the ground placement does', () => {
    const target = resolveCrosshairTarget({
        origin: new THREE.Vector3(0, 0, 0),
        direction: new THREE.Vector3(1, 0, 0),
        hit: { point: new THREE.Vector3(74, 12, -26), normal: new THREE.Vector3(-1, 0, 0) },
        fallbackDistance: 50,
        snapSize: 50,
    });
    assert.deepEqual(target.point.toArray(), [50, 12, -50]);
});

test('an object set onto a surface is lifted until its underside touches it', () => {
    const box = new THREE.Box3(new THREE.Vector3(-5, -20, -5), new THREE.Vector3(5, 20, 5));
    near(resolveSurfaceContactOffset(box, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)), 20, 'floor');
    // Against a wall the object is pushed out along the wall normal by its half width.
    near(resolveSurfaceContactOffset(box, new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)), 5, 'wall');
    near(resolveSurfaceContactOffset(box, new THREE.Vector3(0, 0, 0), null), 0, 'free');
});

test('two clicks span a block between the corners with a default height for flat corners', () => {
    const flat = resolveTwoPointBox(new THREE.Vector3(0, 0, 0), new THREE.Vector3(100, 0, -60), { minSize: 10, defaultHeight: 80 });
    assert.deepEqual(flat.center.toArray(), [50, 40, -30]);
    assert.deepEqual([flat.sizeX, flat.sizeY, flat.sizeZ], [100, 80, 60]);

    const tall = resolveTwoPointBox(new THREE.Vector3(0, 10, 0), new THREE.Vector3(2, 210, 40), { minSize: 10, defaultHeight: 80 });
    assert.deepEqual([tall.sizeX, tall.sizeY, tall.sizeZ], [10, 200, 40]);
    assert.deepEqual(tall.center.toArray(), [1, 110, 20]);
});

test('blocks and tunnels take two clicks, everything else one', () => {
    assert.equal(isTwoPointFlightTool('hard'), true);
    assert.equal(isTwoPointFlightTool('foam'), true);
    assert.equal(isTwoPointFlightTool('tunnel'), true);
    assert.equal(isTwoPointFlightTool('checkpoint'), false);
    assert.equal(isTwoPointFlightTool('item'), false);
});

test('rings set from the cockpit face the flight direction, so the route is flown through them', () => {
    const forward = new THREE.Vector3(1, 1, 0);
    const checkpoint = resolveFlightFacing('checkpoint', forward);
    near(checkpoint.cpForward[0], Math.SQRT1_2, 'cp x');
    near(checkpoint.cpForward[1], Math.SQRT1_2, 'cp y');
    assert.deepEqual(Object.keys(resolveFlightFacing('portal', forward)), ['forward']);
    assert.deepEqual(resolveFlightFacing('item', forward), {});
});

test('the free placement distance is a list of hitbox radii with a middle default', () => {
    assert.ok(FLIGHT_PLACEMENT_DISTANCE_RADII.length >= 3);
    assert.ok(FLIGHT_PLACEMENT_DISTANCE_RADII.every((value, index, list) => index === 0 || value > list[index - 1]));
});

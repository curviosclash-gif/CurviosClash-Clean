import test from 'node:test';
import assert from 'node:assert/strict';

import {
    VEHICLE_LAB_CAMERA_DISTANCE_LIMITS,
    resolveVehicleLabFitDistance,
    resolveVehicleLabViewPose,
} from '../prototypes/vehicle-lab/src/VehicleLabCameraPolicy.js';

test('vehicle lab fit distance keeps the vehicle visible at narrow and wide aspects', () => {
    const narrow = resolveVehicleLabFitDistance(4, 75, 0.5);
    const wide = resolveVehicleLabFitDistance(4, 75, 2);

    assert.ok(narrow > wide);
    assert.ok(narrow <= VEHICLE_LAB_CAMERA_DISTANCE_LIMITS.max);
    assert.ok(wide >= VEHICLE_LAB_CAMERA_DISTANCE_LIMITS.min);
});

test('vehicle lab fixed views use stable axes and camera-up vectors', () => {
    assert.deepEqual(resolveVehicleLabViewPose('front', 10), {
        offset: [0, 0, 10],
        up: [0, 1, 0],
    });
    assert.deepEqual(resolveVehicleLabViewPose('side', 10), {
        offset: [10, 0, 0],
        up: [0, 1, 0],
    });
    assert.deepEqual(resolveVehicleLabViewPose('top', 10), {
        offset: [0, 10, 0],
        up: [0, 0, -1],
    });
});

test('vehicle lab fit view keeps the requested distance', () => {
    const pose = resolveVehicleLabViewPose('fit', 12);
    const length = Math.hypot(...pose.offset);

    assert.ok(Math.abs(length - 12) < 1e-10);
    assert.deepEqual(pose.up, [0, 1, 0]);
});

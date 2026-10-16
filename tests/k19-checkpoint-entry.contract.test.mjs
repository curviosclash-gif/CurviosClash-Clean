import assert from 'node:assert/strict';
import test from 'node:test';

import { FROZEN_HELIX_MAP } from '../src/core/config/maps/presets/frozen_helix.js';
import { NEON_CIRCUIT_MAP } from '../src/core/config/maps/presets/neon_circuit.js';
import { buildRouteFromParcours } from '../src/entities/systems/ParcoursProgressUtils.js';
import {
    createPortalSafeCheckpointEntryCandidate,
    createWallSafeCheckpointEntryCandidates,
    shouldSelectPortalSafeCheckpointEntryCandidate,
} from './helpers/k19-checkpoint-entry.mjs';

const browserCandidate = new Function(`return (${createPortalSafeCheckpointEntryCandidate.toString()});`)();
const browserWallCandidates = new Function(`return (${createWallSafeCheckpointEntryCandidates.toString()});`)();
const browserEligibility = new Function(`return (${shouldSelectPortalSafeCheckpointEntryCandidate.toString()});`)();

function candidate(input) {
    const actual = browserCandidate(input);
    assert.deepEqual(actual, createPortalSafeCheckpointEntryCandidate(input), 'browser executes the exact shared helper');
    return actual;
}

function wallCandidates(input) {
    const actual = browserWallCandidates(input);
    assert.deepEqual(actual, createWallSafeCheckpointEntryCandidates(input), 'browser executes the exact shared pure helper');
    return actual;
}

function eligible(input) {
    const actual = browserEligibility(input);
    assert.equal(actual, shouldSelectPortalSafeCheckpointEntryCandidate(input), 'browser executes the shared eligibility predicate');
    return actual;
}

test('Neon CP01 yields a portal-safe forward-plane entry inside its actual trigger sphere', () => {
    const route = buildRouteFromParcours(NEON_CIRCUIT_MAP.neon_circuit.parcours, { positionScale: 3 });
    const checkpoint = route.checkpoints.find((entry) => entry.id === 'CP01');
    assert.equal(route.rules.bidirectionalCheckpoints, true,
        'the production route builder defaults the authored Neon rule to bidirectional');
    assert.equal(eligible({
        kind: 'checkpoint', target: checkpoint, directWallClear: true, directPortalConflict: true,
    }), true, 'the actual default-bidirectional checkpoint remains eligible for the guarded candidate');

    const result = candidate({
        start: { x: -240, y: 42, z: 22.2 },
        checkpoint,
        playerRadius: 1.2,
        portal: { x: -237.81345073215152, y: 41, z: 1.2120240506158426 },
        portalClearance: 6.2,
        maxMotionDisplacement: 9.368,
    });

    assert.ok(result, 'the candidate uses the live relocated Neon portal endpoint from V23 Native');
    assert.equal(result.contactRadius, 20.7);
    assert.ok(result.checkpointDistance < result.contactRadius);
    assert.ok(result.centerlinePortalDistance <= result.portalClearance);
    assert.ok(result.portalDistanceAfter > result.portalClearance);
    assert.ok(result.crossingDistance + result.maxMotionDisplacement < result.contactRadius);
    assert.ok(result.tangentOffset > 7.6 && result.tangentOffset < 11.6);
    assert.equal(result.forwardPenetration, 1);
});

test('fails closed when the live checkpoint cannot reserve the actual motion bound', () => {
    const route = buildRouteFromParcours(NEON_CIRCUIT_MAP.neon_circuit.parcours, { positionScale: 3 });
    const checkpoint = route.checkpoints.find((entry) => entry.id === 'CP01');
    assert.equal(candidate({
        start: { x: -240, y: 42, z: 22.2 }, checkpoint, playerRadius: 1.2,
        portal: { x: -237.81345073215152, y: 41, z: 1.2120240506158426 },
        portalClearance: 6.2, maxMotionDisplacement: 20,
    }), null);
});

test('entry geometry follows a rotated checkpoint forward vector', () => {
    const result = candidate({
        start: { x: -30, y: 2, z: 7 },
        checkpoint: { pos: [10, 2, 7], radius: 12, forward: [1, 0, 0] },
        playerRadius: 1,
        portal: { x: 0, y: 0, z: 7 },
        portalClearance: 2,
        maxMotionDisplacement: 0.5,
    });

    assert.ok(result);
    assert.ok(result.position.x > 10, 'the candidate crosses the +x checkpoint plane');
    assert.ok(result.position.y > 2, 'the tangent shifts away from the portal in the checkpoint plane');
    assert.ok(result.checkpointDistance < result.contactRadius);
    assert.ok(result.portalDistanceAfter > result.portalClearance);
    assert.ok(result.crossingDistance + result.maxMotionDisplacement < result.contactRadius);
});

test('rejects a candidate whose actual plane crossing is outside the checkpoint sphere', () => {
    const result = candidate({
        start: { x: 100, y: 0, z: -0.1 },
        checkpoint: { pos: [0, 0, 0], radius: 19.5, forward: [0, 0, 1] },
        playerRadius: 1.2,
        portal: { x: 50, y: 6, z: -0.05 },
        portalClearance: 6.2,
        maxMotionDisplacement: 1,
    });

    assert.equal(result, null);
});

test('keeps fixed-tick motion margin inside the actual checkpoint contact radius', () => {
    const geometry = {
        start: { x: 10.5, y: 0, z: -0.1 },
        checkpoint: { pos: [0, 0, 0], radius: 9.8, forward: [0, 0, 1] },
        playerRadius: 1.2,
        portal: { x: 5.25, y: 6, z: -0.05 },
        portalClearance: 6.2,
    };
    const shortStep = candidate({ ...geometry, maxMotionDisplacement: 0.1 });
    assert.ok(shortStep);
    assert.ok(shortStep.crossingDistance < shortStep.contactRadius);
    assert.ok(shortStep.crossingDistance + shortStep.maxMotionDisplacement < shortStep.contactRadius);

    assert.equal(candidate({ ...geometry, maxMotionDisplacement: 1.5 }), null,
        'candidate is rejected when one bounded motion step could end outside the trigger sphere');
});

test('rejects reversed starts, degenerate geometry, non-conflicting portals, and undersized volumes', () => {
    const base = {
        start: { x: -240, y: 42, z: 22.8 },
        checkpoint: { pos: [-240, 42, -18], radius: 19.5, forward: [0, 0, -1] },
        playerRadius: 1.2,
        portal: { x: -240, y: 36, z: 0 },
        portalClearance: 6.2,
        maxMotionDisplacement: 9.368,
    };
    assert.equal(candidate({ ...base, start: { x: -240, y: 42, z: -30 } }), null, 'start is already beyond the forward plane');
    assert.equal(candidate({ ...base, checkpoint: { ...base.checkpoint, forward: [0, 0, 0] } }), null, 'zero forward vector');
    assert.equal(candidate({ ...base, portal: { x: 0, y: 36, z: 0 } }), null, 'centerline does not conflict with this portal');
    assert.equal(candidate({
        ...base,
        checkpoint: { ...base.checkpoint, radius: 0.05 },
        playerRadius: 0.05,
    }), null, 'candidate cannot fit inside a tiny contact sphere');
    assert.equal(candidate({ ...base, portal: { x: -240, y: 42, z: 0.8 } }), null, 'no usable in-plane tangent');
    assert.equal(candidate({ ...base, start: { x: Number.NaN, y: 42, z: 22.8 } }), null, 'non-finite start fails closed');
    assert.equal(candidate({ ...base, maxMotionDisplacement: Number.POSITIVE_INFINITY }), null,
        'non-finite motion bound fails closed');
    assert.equal(candidate({ ...base, maxMotionDisplacement: -1 }), null, 'negative motion bound fails closed');
});

test('Frozen CP01 yields bounded physical poses inside its original plane and contact radius', () => {
    const route = buildRouteFromParcours(FROZEN_HELIX_MAP.frozen_helix.parcours, { positionScale: 3 });
    const checkpoint = route.checkpoints.find((entry) => entry.id === 'CP01');
    const start = { x: -24, y: 289.5, z: 114 };
    assert.deepEqual(checkpoint.pos, [-6, 288, 108]);
    assert.equal(route.rules.bidirectionalCheckpoints, true);

    const candidates = wallCandidates({
        start,
        checkpoint,
        playerRadius: 1.2,
        maxMotionDisplacement: 9.718,
        bidirectionalCheckpoints: route.rules.bidirectionalCheckpoints,
    });
    assert.ok(candidates.length > 0 && candidates.length <= 4, 'the helper returns only a small fixed set');
    const upper = candidates.find((entry) => entry.tangentAxis === 'up' && entry.tangentSign === 1);
    assert.ok(upper, 'the physically upper ring pose has enough trigger and motion reserve');

    const forwardLength = Math.hypot(...checkpoint.forward);
    const signedSide = (point) => checkpoint.forward.reduce(
        (sum, value, axis) => sum + (point[['x', 'y', 'z'][axis]] - checkpoint.pos[axis]) * value / forwardLength,
        0,
    );
    assert.ok(signedSide(start) < 0 && signedSide(upper.position) > 0, 'the pose crosses the authored checkpoint plane from the correct side');
    assert.ok(Math.abs(signedSide(upper.crossingPosition)) < 1e-9, 'the reported crossing lies on that plane');
    assert.ok(upper.checkpointDistance < upper.contactRadius, 'the endpoint stays inside the original radius plus player radius');
    assert.ok(upper.crossingDistance + upper.maxMotionDisplacement < upper.contactRadius,
        'the crossing leaves the full existing motion bound inside the unchanged contact radius');
    assert.ok(upper.position.y > checkpoint.pos[1], 'the upper tangent is above the ring center');
});

test('wall-safe entry solves a smaller legal offset for the actual Frozen CP02 and CP03 approaches', () => {
    const cp02 = {
        pos: [105, 267, 0],
        radius: 16.5,
        forward: [0, -0.3, -1],
    };
    const cp02Entries = wallCandidates({
        start: { x: 105, y: 315, z: 0 },
        checkpoint: cp02,
        playerRadius: 1.2,
        maxMotionDisplacement: 9.718,
        bidirectionalCheckpoints: true,
    });
    const cp02Upper = cp02Entries.find((entry) => entry.tangentAxis === 'up' && entry.tangentSign === 1);
    assert.ok(cp02Upper, 'CP02 retains its legal upper ring-entry pose instead of discarding the endpoint-max offset');
    const cp02Penetration = cp02Upper.forwardPenetration;
    const cp02MaximumEndpointOffset = Math.sqrt(cp02Upper.contactRadius ** 2 - cp02Penetration ** 2) * (1 - 1e-6);
    assert.ok(cp02Upper.tangentOffset < cp02MaximumEndpointOffset,
        'the selected upper tangent is reduced to satisfy the actual plane-crossing reserve');
    const forwardLength = Math.hypot(...cp02.forward);
    const forward = cp02.forward.map((value) => value / forwardLength);
    const upProjection = [0, 1, 0].map((value, index) => value - forward[index] * forward[1]);
    const upLength = Math.hypot(...upProjection);
    const maximumOffsetPosition = {
        x: cp02.pos[0] + forward[0] * cp02Penetration + upProjection[0] / upLength * cp02MaximumEndpointOffset,
        y: cp02.pos[1] + forward[1] * cp02Penetration + upProjection[1] / upLength * cp02MaximumEndpointOffset,
        z: cp02.pos[2] + forward[2] * cp02Penetration + upProjection[2] / upLength * cp02MaximumEndpointOffset,
    };
    const start = { x: 105, y: 315, z: 0 };
    const startSide = cp02.forward.reduce((sum, value, axis) => (
        sum + ([start.x, start.y, start.z][axis] - cp02.pos[axis]) * value / forwardLength
    ), 0);
    const endpointSide = cp02.forward.reduce((sum, value, axis) => (
        sum + (maximumOffsetPosition[['x', 'y', 'z'][axis]] - cp02.pos[axis]) * value / forwardLength
    ), 0);
    const crossingAmount = -((start.x - cp02.pos[0]) * forward[0]
        + (start.y - cp02.pos[1]) * forward[1] + (start.z - cp02.pos[2]) * forward[2])
        / (endpointSide - ((start.x - cp02.pos[0]) * forward[0]
            + (start.y - cp02.pos[1]) * forward[1] + (start.z - cp02.pos[2]) * forward[2]));
    const maximumOffsetCrossing = {
        x: start.x + (maximumOffsetPosition.x - start.x) * crossingAmount,
        y: start.y + (maximumOffsetPosition.y - start.y) * crossingAmount,
        z: start.z + (maximumOffsetPosition.z - start.z) * crossingAmount,
    };
    const maximumOffsetCrossingDistance = Math.hypot(
        maximumOffsetCrossing.x - cp02.pos[0],
        maximumOffsetCrossing.y - cp02.pos[1],
        maximumOffsetCrossing.z - cp02.pos[2],
    );
    assert.ok(startSide < 0 && endpointSide > 0);
    assert.ok(maximumOffsetCrossingDistance + cp02Upper.maxMotionDisplacement >= cp02Upper.contactRadius,
        'the former endpoint-max offset really violates the crossing motion reserve');
    assert.ok(cp02Upper.checkpointDistance < cp02Upper.contactRadius);
    assert.ok(cp02Upper.crossingDistance + cp02Upper.maxMotionDisplacement < cp02Upper.contactRadius);

    const cp03 = {
        pos: [-105, 219, 0],
        radius: 16.5,
        forward: [0, -0.3, 1],
    };
    const cp03Entries = wallCandidates({
        start: { x: -105, y: 250, z: -105 },
        checkpoint: cp03,
        playerRadius: 1.2,
        maxMotionDisplacement: 9.718,
        bidirectionalCheckpoints: true,
    });
    assert.ok(cp03Entries.length > 0,
        'CP03 candidates are computed from the last authored approach waypoint and remain physically legal');
    assert.ok(cp03Entries.every((entry) => entry.checkpointDistance < entry.contactRadius
        && entry.crossingDistance + entry.maxMotionDisplacement < entry.contactRadius));
});

test('wall-safe checkpoint entries fail closed for wrong-way, degenerate, invalid, or unreserved inputs', () => {
    const checkpoint = { pos: [-6, 288, 108], radius: 21, forward: [1, -0.3, -1] };
    const base = {
        start: { x: -24, y: 289.5, z: 114 },
        checkpoint,
        playerRadius: 1.2,
        maxMotionDisplacement: 9.718,
        bidirectionalCheckpoints: false,
    };
    const forwardLength = Math.hypot(...checkpoint.forward);
    const positiveSideStart = {
        x: checkpoint.pos[0] + checkpoint.forward[0] / forwardLength * 20,
        y: checkpoint.pos[1] + checkpoint.forward[1] / forwardLength * 20,
        z: checkpoint.pos[2] + checkpoint.forward[2] / forwardLength * 20,
    };
    assert.deepEqual(wallCandidates({ ...base, start: positiveSideStart }), [],
        'a positive-side start is rejected when the route is one-way');
    const reverse = wallCandidates({
        ...base,
        start: positiveSideStart,
        bidirectionalCheckpoints: true,
    });
    assert.ok(reverse.length > 0, 'a positive-side start may cross backwards only on a bidirectional route');
    const reverseEndSide = (entry) => checkpoint.forward.reduce(
        (sum, value, axis) => sum + (entry.position[['x', 'y', 'z'][axis]] - checkpoint.pos[axis]) * value / forwardLength,
        0,
    );
    assert.ok(reverse.every((entry) => reverseEndSide(entry) < 0), 'reverse candidates cross to the negative side of the plane');
    assert.deepEqual(wallCandidates({ ...base, checkpoint: { ...checkpoint, forward: [0, 0, 0] } }), [],
        'a degenerate forward vector fails closed');
    assert.deepEqual(wallCandidates({ ...base, checkpoint: { ...checkpoint, radius: Number.NaN } }), [],
        'a non-finite checkpoint radius fails closed');
    assert.deepEqual(wallCandidates({
        ...base,
        checkpoint: { ...checkpoint, radius: 0.5 },
        maxMotionDisplacement: 1.7,
    }), [], 'there is no candidate without strictly positive motion reserve');
    assert.deepEqual(wallCandidates({ ...base, start: { x: Number.NaN, y: 289.5, z: 114 } }), [],
        'a non-finite start fails closed');
});

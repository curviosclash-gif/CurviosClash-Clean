import * as THREE from 'three';
import { createEndlessPathSample } from './EndlessParcoursPathMetric.js';

export const ENDLESS_RING = Object.freeze({ radius: 18, thickness: 0.65, radialSegments: 8, tubularSegments: 48 });
const FRAME = createEndlessPathSample();

export function createEndlessRingState(human) {
    return { previous: new THREE.Vector3().copy(human?.position || { x: 0, y: 0, z: 0 }),
        renderVersion: Number(human?._renderDiscontinuityVersion) || 0, eligible: false };
}

/** Save the real previous flight pose once per runtime tick. Discontinuous poses
 * and jumps longer than a module never manufacture a string of scored rings.
 */
export function prepareEndlessRingSegment(runtime, human) {
    const state = runtime._ringState, position = human?.position;
    if (!state || !position) return false;
    const version = Number(human._renderDiscontinuityVersion) || 0;
    state.eligible = human.alive !== false && version === state.renderVersion
        && state.previous.distanceToSquared(position) <= 180 * 180;
    state.renderVersion = version;
    return state.eligible;
}

export function finishEndlessRingSegment(runtime, human) {
    if (human?.position) runtime._ringState.previous.copy(human.position);
}

/** Test the actual segment's intersection with the ring plane and inner radius. */
export function crossesEndlessRing(runtime, instance, human) {
    const state = runtime._ringState;
    if (!state?.eligible || !human?.position) return false;
    const module = instance.module;
    runtime.getPathMetric().sampleAtProgress(module.moduleIndex, module.localCheckpointZ / module.length, FRAME);
    const from = state.previous, to = human.position, center = FRAME.position, n = FRAME.tangent;
    const a = (from.x - center.x) * n.x + (from.y - center.y) * n.y + (from.z - center.z) * n.z;
    const b = (to.x - center.x) * n.x + (to.y - center.y) * n.y + (to.z - center.z) * n.z;
    if (a >= -1e-7 || b < -1e-7 || b - a <= 1e-7) return false;
    const t = Math.max(0, Math.min(1, -a / (b - a)));
    const x = from.x + (to.x - from.x) * t - center.x;
    const y = from.y + (to.y - from.y) * t - center.y;
    const z = from.z + (to.z - from.z) * t - center.z;
    const right = x * FRAME.right.x + y * FRAME.right.y + z * FRAME.right.z;
    const up = x * FRAME.up.x + y * FRAME.up.y + z * FRAME.up.z;
    const clearance = ENDLESS_RING.radius - ENDLESS_RING.thickness - Math.max(0, Number(human.hitboxRadius) || 0);
    return clearance > 0 && right * right + up * up <= clearance * clearance;
}

// ============================================
// ArcadeVehicleHitboxContract.js - Arcade hitbox from part boxes (Paket 2b)
// Every top-level Vehicle Lab part becomes one box in vehicle space (a mirrored part one
// per half): factory shape x functional size x ARCADE_HITBOX_SCALE. Only the core box has a minimum thickness (the
// core anchor): it carries the sweep against tunnelling, see resolveArcadeMotionWorstCase.
// Each box is covered by up to six probe spheres, because the arena only answers sphere
// queries. Pure data + math, no Three.js, no imports from core/ui/state.
// ============================================

import { measureVehiclePartBounds, resolveHullMountedPivot, resolveVehiclePartMirrorAxis } from './VehiclePartStyleContract.js';
import { resolveArcadePartSizeFactors } from './ArcadeVehicleSizeContract.js';
import { ALTITUDE_SPEED_MAX_MULTIPLIER } from './AltitudeSpeedContract.js';

export const ARCADE_HITBOX_SCALE = 0.9;
/** Edge length of the core anchor cube around the vehicle origin (vehicle space). */
export const ARCADE_HITBOX_MIN_THICKNESS = 0.25;
export const ARCADE_HITBOX_MAX_BOXES = 24;
export const ARCADE_PROBES_PER_BOX_MAX = 6;
/** Covers the maximum 50% dive bonus; the collision matrix verifies the required samples. */
export const ARCADE_SWEEP_MAX_STEPS = 256;
/**
 * Largest authored map push in u/s: a boost portal (forwardImpulse) overlapping a slingshot
 * (forwardImpulse + liftImpulse). The safety test scans every preset against it.
 */
export const ARCADE_EXTERNAL_IMPULSE_MAX = 135;

// Engine flames and force fields are effects, not hull.
const EFFECT_GEOS = Object.freeze(['flame', 'forcefield']);
const MEASURE_OPTIONS = Object.freeze({ includeMirrors: true, ignoreGeos: EFFECT_GEOS });
// A mirrored part is two boxes, one per half: one box over both would add hit area in the
// empty space between them (the spaceship's nose cannons, the Manta's wing roots).
const MEASURE_WHOLE = Object.freeze([MEASURE_OPTIONS]);
const MEASURE_HALVES = Object.freeze([
    Object.freeze({ ...MEASURE_OPTIONS, mirrorHalf: /** @type {'own'} */ ('own') }),
    Object.freeze({ ...MEASURE_OPTIONS, mirrorHalf: /** @type {'copy'} */ ('copy') }),
]);

/** @param {any} part */
function measuresOf(part) {
    return resolveVehiclePartMirrorAxis(part) ? MEASURE_HALVES : MEASURE_WHOLE;
}

/**
 * @typedef {object} ArcadeHitboxShape
 * @property {number} count
 * @property {Float64Array} boxes      count x [cx, cy, cz, hx, hy, hz]
 * @property {Float64Array} boxReach   count: radius around the box centre that covers all its probes
 * @property {string[]} names
 * @property {string[]} roles          '' for parts without a role
 * @property {Float64Array} probes     m x [x, y, z, r]
 * @property {Int32Array} probeStart   count + 1 offsets into probes
 * @property {number} boundRadius      covers every probe around the origin
 * @property {number} crossRadius      largest box distance off the flight axis (bot evasion)
 */

/**
 * @param {number[]} center
 * @param {number[]} half
 * @param {number} originScale
 */
function scaleAroundOrigin(center, half, originScale) {
    for (let a = 0; a < 3; a++) {
        center[a] *= originScale;
        half[a] *= originScale;
    }
}

/**
 * Grows the core box so it holds the anchor cube [-T/2, T/2]^3 around the origin.
 * @param {number[]} center
 * @param {number[]} half
 */
function anchorCore(center, half) {
    const t = ARCADE_HITBOX_MIN_THICKNESS / 2;
    for (let a = 0; a < 3; a++) {
        if (center[a] - half[a] <= -t && center[a] + half[a] >= t) continue;
        const min = Math.min(center[a] - half[a], -t);
        const max = Math.max(center[a] + half[a], t);
        center[a] = (min + max) / 2;
        half[a] = (max - min) / 2;
    }
}

/**
 * Split counts along the two longest axes (product <= ARCADE_PROBES_PER_BOX_MAX) that give
 * the smallest enclosing probe spheres.
 * @param {number[]} half
 * @returns {number[]} pieces per axis
 */
function probeSplit(half) {
    const order = [0, 1, 2].sort((p, q) => half[q] - half[p]);
    let best = [1, 1, 1];
    let bestRadius = Infinity;
    for (let na = 1; na <= ARCADE_PROBES_PER_BOX_MAX; na++) {
        for (let nb = 1; na * nb <= ARCADE_PROBES_PER_BOX_MAX; nb++) {
            const pieces = [1, 1, 1];
            pieces[order[0]] = na;
            pieces[order[1]] = nb;
            const radius = Math.hypot(half[0] / pieces[0], half[1] / pieces[1], half[2] / pieces[2]);
            if (radius < bestRadius - 1e-12) {
                bestRadius = radius;
                best = pieces;
            }
        }
    }
    return best;
}

/**
 * @param {Array<{name: string, role: string, center: number[], half: number[]}>} list
 * @returns {ArcadeHitboxShape}
 */
function finishShape(list) {
    const count = list.length;
    const boxes = new Float64Array(count * 6);
    const boxReach = new Float64Array(count);
    const probeStart = new Int32Array(count + 1);
    /** @type {number[]} */
    const probeValues = [];
    let boundRadius = 0;
    let crossRadius = 0;
    list.forEach((box, i) => {
        const { center: c, half: h } = box;
        boxes.set([c[0], c[1], c[2], h[0], h[1], h[2]], i * 6);
        crossRadius = Math.max(crossRadius, Math.hypot(Math.abs(c[0]) + h[0], Math.abs(c[1]) + h[1]));
        const pieces = probeSplit(h);
        const sub = [h[0] / pieces[0], h[1] / pieces[1], h[2] / pieces[2]];
        const radius = Math.hypot(sub[0], sub[1], sub[2]);
        probeStart[i] = probeValues.length / 4;
        for (let ix = 0; ix < pieces[0]; ix++) {
            for (let iy = 0; iy < pieces[1]; iy++) {
                for (let iz = 0; iz < pieces[2]; iz++) {
                    const p = [
                        c[0] - h[0] + sub[0] * (2 * ix + 1),
                        c[1] - h[1] + sub[1] * (2 * iy + 1),
                        c[2] - h[2] + sub[2] * (2 * iz + 1),
                    ];
                    probeValues.push(p[0], p[1], p[2], radius);
                    boxReach[i] = Math.max(boxReach[i], Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) + radius);
                    boundRadius = Math.max(boundRadius, Math.hypot(p[0], p[1], p[2]) + radius);
                }
            }
        }
    });
    probeStart[count] = probeValues.length / 4;
    return {
        count,
        boxes,
        boxReach,
        names: list.map((box) => box.name),
        roles: list.map((box) => box.role),
        probes: Float64Array.from(probeValues),
        probeStart,
        boundRadius,
        crossRadius,
    };
}

/**
 * Keeps role parts first, then the largest others, so no vehicle exceeds the box budget.
 * Mirror partners (a left/right pair with mirrored bounds) stay or go together, so the hit
 * zone never turns one-sided; a mirrored part counts as its two boxes.
 * @param {ReadonlyArray<any>} parts
 */
function pickParts(parts) {
    const valid = parts.filter((part) => part && typeof part === 'object');
    if (valid.reduce((sum, part) => sum + measuresOf(part).length, 0) <= ARCADE_HITBOX_MAX_BOXES) return valid;
    /** @type {Map<string, {index: number, rank: number, boxes: number, members: number[]}>} */
    const groups = new Map();
    valid.forEach((part, index) => {
        const { center, size } = measureVehiclePartBounds(part, MEASURE_OPTIONS);
        // Partners share size, height, depth and |x|; rounding hides the measuring noise.
        const key = [Math.abs(center[0]), center[1], center[2], ...size].map((value) => Math.round(value * 1e6)).join('|');
        const group = groups.get(key) || { index, rank: 0, boxes: 0, members: [] };
        groups.set(key, group);
        group.rank = Math.max(group.rank, part.role ? Infinity : size.reduce((v, s) => v * Math.max(s, 1e-6), 1));
        group.boxes += measuresOf(part).length;
        group.members.push(index);
    });
    let room = ARCADE_HITBOX_MAX_BOXES;
    /** @type {number[]} */
    const kept = [];
    for (const group of [...groups.values()].sort((p, q) => (q.rank - p.rank) || (p.index - q.index))) {
        if (group.boxes > room) continue;
        room -= group.boxes;
        kept.push(...group.members);
    }
    return kept.sort((p, q) => p - q).map((index) => valid[index]);
}

/**
 * Hitbox of a part-built vehicle. `partSizes` are the functional sizes in percent
 * ({hull, nose, wings, engines, utility}; missing = 100). `originScale` shrinks every box
 * around the vehicle origin (wall/trail shape, see resolveArcadeWallHitboxScale); the core
 * anchor keeps its thickness either way.
 * @param {ReadonlyArray<any>|null|undefined} parts
 * @param {unknown} partSizes
 * @param {{originScale?: number}} [options]
 * @returns {ArcadeHitboxShape}
 */
export function buildArcadeHitboxShape(parts, partSizes, options = {}) {
    const list = Array.isArray(parts) ? parts : [];
    const factors = resolveArcadePartSizeFactors(list, partSizes);
    const originScale = Number(options.originScale) > 0 ? Number(options.originScale) : 1;
    // The drawn utility part rides on the hull (applyVehiclePartStyle); its box does the same.
    const hull = list.find((part) => part?.role === 'core');
    const hullFactor = hull ? factors[String(hull.name || '')] : 1;
    /** @type {Array<{name: string, role: string, center: number[], half: number[]}>} */
    const boxes = [];
    for (const part of pickParts(list)) {
        const factor = factors[String(part.name || '')] || 1;
        const pivot = resolveHullMountedPivot(part, hull, hullFactor);
        const scaled = factor === 1 && !pivot
            ? part
            : {
                ...part,
                ...(pivot ? { pos: pivot } : {}),
                scale: [0, 1, 2].map((a) => (Array.isArray(part.scale) ? Number(part.scale[a]) || 1 : 1) * factor),
            };
        for (const measure of measuresOf(part)) {
            const bounds = measureVehiclePartBounds(scaled, measure);
            const center = bounds.center.slice();
            const half = bounds.size.map((size) => (size / 2) * ARCADE_HITBOX_SCALE);
            scaleAroundOrigin(center, half, originScale);
            boxes.push({ name: String(part.name || ''), role: String(part.role || ''), center, half });
        }
    }
    let core = boxes.find((box) => box.role === 'core');
    if (!core) {
        core = { name: 'core', role: 'core', center: [0, 0, 0], half: [0, 0, 0] };
        boxes.push(core);
    }
    anchorCore(core.center, core.half);
    return finishShape(boxes);
}

/**
 * Vehicles without a part list: one core box from the model bounds (vehicle space).
 * @param {ArrayLike<number>} min
 * @param {ArrayLike<number>} max
 * @param {{originScale?: number}} [options]
 * @returns {ArcadeHitboxShape}
 */
export function buildArcadeCoreHitboxShape(min, max, options = {}) {
    const center = [0, 1, 2].map((a) => ((Number(min[a]) || 0) + (Number(max[a]) || 0)) / 2);
    const half = [0, 1, 2].map((a) => (Math.abs((Number(max[a]) || 0) - (Number(min[a]) || 0)) / 2) * ARCADE_HITBOX_SCALE);
    scaleAroundOrigin(center, half, Number(options.originScale) > 0 ? Number(options.originScale) : 1);
    anchorCore(center, half);
    return finishShape([{ name: 'core', role: 'core', center, half }]);
}

/**
 * Plain box list for the Hangar overlay (translucent boxes in vehicle space, full shape).
 * @param {{parts?: ReadonlyArray<any>}|null|undefined} config
 * @param {unknown} partSizes
 * @returns {Array<{name: string, role: string, center: number[], halfSize: number[]}>}
 */
export function listArcadeHitboxBoxes(config, partSizes) {
    const shape = buildArcadeHitboxShape(config?.parts, partSizes);
    const b = shape.boxes;
    return shape.names.map((name, i) => ({
        name,
        role: shape.roles[i],
        center: [b[i * 6], b[i * 6 + 1], b[i * 6 + 2]],
        halfSize: [b[i * 6 + 3], b[i * 6 + 4], b[i * 6 + 5]],
    }));
}

/**
 * Size of the hit zone for the Hangar value preview: the summed surface of the part boxes of the
 * full shape (vehicle space). A box's mean silhouette over all directions is a quarter of its
 * surface (Cauchy), so the number follows how easily the ship is hit from any side, and unlike a
 * bounding sphere it counts every part, also one inside the wing span.
 * @param {ReadonlyArray<any>|null|undefined} parts
 * @param {unknown} partSizes
 * @returns {number}
 */
export function measureArcadeHitboxSurface(parts, partSizes) {
    const { boxes, count } = buildArcadeHitboxShape(parts, partSizes);
    let surface = 0;
    for (let i = 0; i < count; i++) {
        const x = boxes[i * 6 + 3];
        const y = boxes[i * 6 + 4];
        const z = boxes[i * 6 + 5];
        surface += 8 * (x * y + y * z + z * x);
    }
    return surface;
}

/**
 * Sweep samples for one frame: consecutive samples move the origin (and with it the core
 * anchor) by at most one anchor edge, and a point on the outermost probe by at most the
 * same plus its share of the rotation.
 * @param {number} travelled       world units since the last frame
 * @param {number} angle           rotation since the last frame (rad)
 * @param {number} boundRadiusWorld
 * @param {number} minThicknessWorld
 * @param {number} [cap]
 * @returns {number}
 */
export function computeArcadeSweepSteps(travelled, angle, boundRadiusWorld, minThicknessWorld, cap = ARCADE_SWEEP_MAX_STEPS) {
    const reach = (Number(travelled) || 0) + (Number(angle) || 0) * (Number(boundRadiusWorld) || 0);
    const steps = Math.ceil(reach / Math.max(1e-6, Number(minThicknessWorld) || 0));
    return Math.min(cap, Math.max(1, steps));
}

/**
 * @typedef {object} ArcadeMotionEnv
 * @property {number} baseSpeed              u/s before stats (settings / CONFIG.PLAYER.SPEED)
 * @property {number} speedCapPct            highest vehicle speed cap (base + 100 points)
 * @property {number} boostMultiplier
 * @property {number} speedEffectMultiplier  SPEED_UP pickup
 * @property {number} externalImpulse        ARCADE_EXTERNAL_IMPULSE_MAX
 * @property {number} turnSpeed              rad/s per axis (pitch and yaw at once)
 * @property {number} turnCapPct
 * @property {number} rollSpeed              rad/s
 * @property {number} rollCapPct             roll is capped like speed and turn (base + 100 points)
 * @property {number} frameDt
 * @property {number} minClockScale          slow-motion owner steers on dt / scale
 */

/**
 * Worst-case motion of one collision step. The roll term is the wing-tip speed while
 * rolling; pitch and yaw at full input add up to sqrt(2) x turnSpeed.
 * @param {ArcadeMotionEnv} env
 * @returns {{stepDt: number, specStepDistance: number, stepDistance: number, stepAngle: number}}
 */
export function resolveArcadeMotionWorstCase(env) {
    const stepDt = env.frameDt / env.minClockScale;
    const cappedSpeed = env.baseSpeed * (env.speedCapPct / 100) * env.boostMultiplier
        * ALTITUDE_SPEED_MAX_MULTIPLIER;
    return {
        stepDt,
        specStepDistance: cappedSpeed * stepDt,
        stepDistance: (cappedSpeed * env.speedEffectMultiplier + env.externalImpulse) * stepDt,
        stepAngle: (Math.SQRT2 * env.turnSpeed * (env.turnCapPct / 100) + env.rollSpeed * (env.rollCapPct / 100)) * stepDt,
    };
}

export default {
    ARCADE_HITBOX_SCALE,
    ARCADE_HITBOX_MIN_THICKNESS,
    ARCADE_HITBOX_MAX_BOXES,
    ARCADE_PROBES_PER_BOX_MAX,
    ARCADE_SWEEP_MAX_STEPS,
    ARCADE_EXTERNAL_IMPULSE_MAX,
    buildArcadeHitboxShape,
    buildArcadeCoreHitboxShape,
    listArcadeHitboxBoxes,
    measureArcadeHitboxSurface,
    computeArcadeSweepSteps,
    resolveArcadeMotionWorstCase,
};

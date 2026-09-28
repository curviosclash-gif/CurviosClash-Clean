// ============================================
// ArcadePartHitboxOps.js - Paket 2b: per-player Arcade hitbox from part boxes.
// Only normal Arcade runs switch it on (player.arcadeHitbox, set at every spawn).
// hitboxRadius/hitboxBox stay untouched everywhere, so pickups, portals, gates, bounces,
// spawns, turrets, mines and markers keep their reach; only bot evasion reads
// player.arcadeAvoidRadius (the wall shape) first. `full` is the shape MG, rockets and
// crashes see, `wall` the one walls and trails see (resolveArcadeWallHitboxScale).
// Queries are allocation-free: shapes are built once per vehicle/size change.
// ============================================
import * as THREE from 'three';

import {
    buildArcadeCoreHitboxShape,
    buildArcadeHitboxShape,
} from '../../shared/contracts/ArcadeVehicleHitboxContract.js';
import { ARCADE_PART_SIZE_GROUPS } from '../../shared/contracts/ArcadeVehicleSizeContract.js';
import { resolveArcadeWallHitboxScale } from '../../shared/contracts/ArcadeVehicleBalanceContract.js';
import { getVehicleModularConfig } from '../vehicle-registry.js';

const _local = new THREE.Vector3();
const _localEnd = new THREE.Vector3();
const _invQuat = new THREE.Quaternion();

function modelScaleOf(player) {
    const scale = Number(player?.modelScale);
    return scale > 0 ? scale : 1;
}

function sizeOf(player, group) {
    return Number(player?.arcadePartSizes?.[group]) || 100;
}

function buildShapes(player) {
    const vehicleId = String(player.vehicleId || '');
    const sizes = {};
    for (const group of ARCADE_PART_SIZE_GROUPS) sizes[group] = sizeOf(player, group);
    const originScale = resolveArcadeWallHitboxScale(vehicleId);
    const parts = getVehicleModularConfig(vehicleId)?.parts;
    if (Array.isArray(parts) && parts.length > 0) {
        const full = buildArcadeHitboxShape(parts, sizes);
        return { full, wall: originScale === 1 ? full : buildArcadeHitboxShape(parts, sizes, { originScale }) };
    }
    // Mesh-only vehicles: one core box from the model bounds.
    const box = player.vehicleMesh?.localBox || (player.hitboxBox?.isEmpty?.() === false ? player.hitboxBox : null);
    const r = (Number(player.hitboxRadius) || 0.8) / modelScaleOf(player);
    const min = box ? [box.min.x, box.min.y, box.min.z] : [-r, -r, -r];
    const max = box ? [box.max.x, box.max.y, box.max.z] : [r, r, r];
    const full = buildArcadeCoreHitboxShape(min, max);
    return { full, wall: originScale === 1 ? full : buildArcadeCoreHitboxShape(min, max, { originScale }) };
}

function stateMatches(state, player) {
    if (state.vehicleId !== player.vehicleId) return false;
    for (let i = 0; i < ARCADE_PART_SIZE_GROUPS.length; i++) {
        if (state.sizes[i] !== sizeOf(player, ARCADE_PART_SIZE_GROUPS[i])) return false;
    }
    return true;
}

function buildState(player) {
    const shapes = buildShapes(player);
    const sizes = new Float64Array(ARCADE_PART_SIZE_GROUPS.length);
    for (let i = 0; i < sizes.length; i++) sizes[i] = sizeOf(player, ARCADE_PART_SIZE_GROUPS[i]);
    return { full: shapes.full, wall: shapes.wall, vehicleId: player.vehicleId, sizes };
}

/** Switches the part hitbox on (or refreshes it); the bot evasion radius follows the wall shape. */
export function applyArcadePartHitbox(player) {
    if (!player) return null;
    if (!player.arcadeHitbox) player.arcadeHitbox = buildState(player);
    return syncArcadePartHitbox(player);
}

/** Cheap per-frame check: rebuilds only after a vehicle or size change. */
export function syncArcadePartHitbox(player) {
    if (!player?.arcadeHitbox) return null;
    if (!stateMatches(player.arcadeHitbox, player)) player.arcadeHitbox = buildState(player);
    const state = player.arcadeHitbox;
    player.arcadeAvoidRadius = state.wall.crossRadius * modelScaleOf(player);
    return state;
}

export function clearArcadePartHitbox(player) {
    if (!player?.arcadeHitbox) return;
    player.arcadeHitbox = null;
    player.arcadeAvoidRadius = 0;
}

/** Spawn switch: on in normal Arcade runs (humans and bots), off everywhere else. */
export function applyArcadeSpawnHitbox(player, enabled) {
    if (enabled) applyArcadePartHitbox(player);
    else clearArcadePartHitbox(player);
}

/** out = position + quaternion * (local * scale) */
export function writeArcadeWorldPoint(position, quaternion, scale, x, y, z, out) {
    return out.set(x * scale, y * scale, z * scale).applyQuaternion(quaternion).add(position);
}

function toLocal(player, world, out) {
    _invQuat.copy(player.quaternion).invert();
    return out.subVectors(world, player.position).applyQuaternion(_invQuat).multiplyScalar(1 / modelScaleOf(player));
}

/** Does a world sphere touch any box of the full shape? */
export function sphereHitsArcadePartBoxes(player, worldCenter, radius, shape = player?.arcadeHitbox?.full) {
    if (!shape || !worldCenter) return false;
    const s = modelScaleOf(player);
    const reach = shape.boundRadius * s + radius;
    if (player.position.distanceToSquared(worldCenter) > reach * reach) return false;
    toLocal(player, worldCenter, _local);
    const r = radius / s;
    const b = shape.boxes;
    for (let i = 0; i < shape.count; i++) {
        const o = i * 6;
        const dx = Math.max(0, Math.abs(_local.x - b[o]) - b[o + 3]);
        const dy = Math.max(0, Math.abs(_local.y - b[o + 1]) - b[o + 4]);
        const dz = Math.max(0, Math.abs(_local.z - b[o + 2]) - b[o + 5]);
        if (dx * dx + dy * dy + dz * dz <= r * r) return true;
    }
    return false;
}

// Slab test of the local segment a + t (b - a), t in [0, tMax], against every box grown by
// `inflate` (local units). Returns the smallest entry t or -1.
function slabEntry(shape, a, d, tMax, inflate) {
    const b = shape.boxes;
    let best = -1;
    for (let i = 0; i < shape.count; i++) {
        const o = i * 6;
        let t0 = 0;
        let t1 = tMax;
        for (let axis = 0; axis < 3 && t0 <= t1; axis++) {
            const origin = axis === 0 ? a.x : (axis === 1 ? a.y : a.z);
            const dir = axis === 0 ? d.x : (axis === 1 ? d.y : d.z);
            const lo = b[o + axis] - b[o + 3 + axis] - inflate;
            const hi = b[o + axis] + b[o + 3 + axis] + inflate;
            if (Math.abs(dir) < 1e-12) {
                if (origin < lo || origin > hi) t1 = -1;
                continue;
            }
            let near = (lo - origin) / dir;
            let far = (hi - origin) / dir;
            if (near > far) { const swap = near; near = far; far = swap; }
            if (near > t0) t0 = near;
            if (far < t1) t1 = far;
        }
        if (t0 <= t1 && (best < 0 || t0 < best)) best = t0;
    }
    return best;
}

/** Segment a->b (world) against the full shape grown by `inflate`: entry fraction in [0, 1] or -1. */
export function segmentHitsArcadePartBoxes(player, a, b, inflate = 0) {
    const shape = player?.arcadeHitbox?.full;
    if (!shape || !a || !b) return -1;
    toLocal(player, a, _local);
    toLocal(player, b, _localEnd).sub(_local);
    return slabEntry(shape, _local, _localEnd, 1, Math.max(0, inflate) / modelScaleOf(player));
}

/** Ray (normalized world direction) against the full shape: entry distance or -1. */
export function rayHitsArcadePartBoxes(player, origin, direction, maxDistance) {
    const shape = player?.arcadeHitbox?.full;
    if (!shape || !origin || !direction) return -1;
    const s = modelScaleOf(player);
    const reach = shape.boundRadius * s;
    _local.subVectors(player.position, origin);
    const along = _local.dot(direction);
    if (along < -reach || along > maxDistance + reach) return -1;
    if (_local.lengthSq() - along * along > reach * reach) return -1;
    toLocal(player, origin, _local);
    _invQuat.copy(player.quaternion).invert();
    _localEnd.copy(direction).applyQuaternion(_invQuat);
    const t = slabEntry(shape, _local, _localEnd, Math.max(0, maxDistance) / s, 0);
    return t < 0 ? -1 : t * s;
}

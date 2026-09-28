// ============================================
// ArcadePartCollisionOps.js - Paket 2b: walls, trails and crashes against the Arcade
// part boxes (only for players with player.arcadeHitbox; everyone else keeps the
// PlayerCollisionPhase code path unchanged).
//
// Two stages per frame: the sweep samples are spaced by the core anchor thickness, so the
// thick core around the hull can never jump a wall (proof: ArcadeVehicleHitboxContract
// resolveArcadeMotionWorstCase, tests/arcade-collision-safety.contract.test.mjs). At every
// sample the part boxes are checked too, through their probe spheres. Each stage asks a
// cheap enclosing sphere first: frame path -> ship -> box -> probe. Enclosing spheres use
// the broad arena query (Arena.checkCollisionBroad), which never misses what a smaller
// sphere inside them touches; only the probes ask the exact query.
// ============================================
import * as THREE from 'three';

import {
    ARCADE_HITBOX_MIN_THICKNESS,
    computeArcadeSweepSteps,
} from '../../../shared/contracts/ArcadeVehicleHitboxContract.js';
import {
    sphereHitsArcadePartBoxes,
    syncArcadePartHitbox,
    writeArcadeWorldPoint,
} from '../../player/ArcadePartHitboxOps.js';

const _mid = new THREE.Vector3();
const _samplePos = new THREE.Vector3();
const _sampleQuat = new THREE.Quaternion();
const _boxCenter = new THREE.Vector3();
const _probePoint = new THREE.Vector3();
const _hitProbe = new THREE.Vector3();
const _contactNormal = new THREE.Vector3();

// The contexts hold match objects only during one call; both resolvers release them again.
const arenaQueryContext = { phase: null, arena: null, isBot: false, info: null, broad: queryArenaBroad, exact: queryArena };
const trailQueryContext = { index: null, gridSize: 10, playerIndex: -1, skipRecent: 0, info: null, broad: queryTrails, exact: queryTrails };
const sweep = { steps: 0, hitProbeRadius: 0 };

const arenaResponse = {
    hit: false,
    kind: 'wall',
    isWall: false,
    normal: new THREE.Vector3(),
    responseHasProbe: false,
    responseAlreadySeparated: false,
    responseProbeOffsetX: 0,
    responseProbeOffsetY: 0,
    responseProbeOffsetZ: 0,
    responseProbeRadius: 0,
    // The move this frame really flew: start orientation -> pose the wall sweep stopped at.
    // The wall response afterwards jumps (turn, push), it does not fly; see the trail check.
    flownStartQuaternion: new THREE.Quaternion(),
    flownPosition: new THREE.Vector3(),
    flownQuaternion: new THREE.Quaternion(),
};

function modelScaleOf(player) {
    const scale = Number(player?.modelScale);
    return scale > 0 ? scale : 1;
}

function queryArena(context, point, radius) {
    context.info = context.phase._probeArenaCollision(point, radius, context.isBot);
    return !!context.info;
}

function queryArenaBroad(context, point, radius) {
    if (typeof context.arena?.checkCollisionBroad !== 'function') return queryArena(context, point, radius);
    return context.arena.checkCollisionBroad(point, radius, context.isBot);
}

function queryTrails(context, point, radius) {
    const cellRange = Math.max(1, Math.ceil(radius / context.gridSize));
    context.info = context.index.checkGlobalCollision(point, radius, context.playerIndex, context.skipRecent, null, cellRange);
    return !!context.info?.hit;
}

// First probe of `shape` at the given pose that touches; leaves it in _hitProbe.
function probeShapeAt(shape, pos, quat, s, context) {
    if (!context.broad(context, pos, shape.boundRadius * s)) return false;
    const b = shape.boxes;
    const p = shape.probes;
    for (let i = 0; i < shape.count; i++) {
        writeArcadeWorldPoint(pos, quat, s, b[i * 6], b[i * 6 + 1], b[i * 6 + 2], _boxCenter);
        if (!context.broad(context, _boxCenter, shape.boxReach[i] * s)) continue;
        for (let k = shape.probeStart[i]; k < shape.probeStart[i + 1]; k++) {
            writeArcadeWorldPoint(pos, quat, s, p[k * 4], p[k * 4 + 1], p[k * 4 + 2], _probePoint);
            if (context.exact(context, _probePoint, p[k * 4 + 3] * s)) {
                _hitProbe.copy(_probePoint);
                sweep.hitProbeRadius = p[k * 4 + 3] * s;
                return true;
            }
        }
    }
    return false;
}

function samplePose(start, startQuat, endPos, endQuat, t) {
    _samplePos.lerpVectors(start, endPos, t);
    _sampleQuat.slerpQuaternions(startQuat, endQuat, t);
}

// Sweeps the shape from (start, startQuat) to (endPos, endQuat). Returns the first sample
// that touched (0 = free), with the pose left in _samplePos/_sampleQuat.
function sweepShape(shape, s, start, startQuat, endPos, endQuat, context) {
    const travelled = start.distanceTo(endPos);
    const reach = shape.boundRadius * s;
    _mid.lerpVectors(start, endPos, 0.5);
    if (!context.broad(context, _mid, travelled / 2 + reach)) return 0;
    sweep.steps = computeArcadeSweepSteps(travelled, startQuat.angleTo(endQuat), reach, ARCADE_HITBOX_MIN_THICKNESS * s);
    for (let i = 1; i <= sweep.steps; i++) {
        samplePose(start, startQuat, endPos, endQuat, i / sweep.steps);
        if (probeShapeAt(shape, _samplePos, _sampleQuat, s, context)) return i;
    }
    return 0;
}

// Outward normal of the arena contact of the probe at `probe`. For a tunnel (a box with a
// cylinder hole) ArenaCollision reports the nearest box face even when the cavity wall is the
// nearer surface; that face runs across the flight path in the tunnel, so a bounce off the
// cavity wall kept heading into it. Then the probe is sent back towards the axis instead.
function writeContactNormal(info, probe, out) {
    const tunnel = info?.obstacle?.tunnel;
    const box = info?.obstacle?.box;
    if (tunnel && box) {
        const axis = tunnel.axis === 'x' || tunnel.axis === 'y' ? tunnel.axis : 'z';
        const dx = axis === 'x' ? 0 : probe.x - (Number(tunnel.cx) || 0);
        const dy = axis === 'y' ? 0 : probe.y - (Number(tunnel.cy) || 0);
        const dz = axis === 'z' ? 0 : probe.z - (Number(tunnel.cz) || 0);
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        // Signed distance to the nearest box face (negative outside the box).
        const face = Math.min(probe.x - box.min.x, box.max.x - probe.x, probe.y - box.min.y,
            box.max.y - probe.y, probe.z - box.min.z, box.max.z - probe.z);
        if (dist > 1e-6 && dist - (Number(tunnel.radius) || 0) < face) {
            return out.set(-dx / dist, -dy / dist, -dz / dist);
        }
    }
    return info?.normal ? out.copy(info.normal) : out.set(0, 1, 0);
}

function copyContact(response, info, probe) {
    response.kind = info?.kind || 'wall';
    response.isWall = info?.isWall === true;
    writeContactNormal(info, probe, response.normal);
}

function resolveArenaSweep(player, shape, s, start, startQuat, context) {
    const hitStep = sweepShape(shape, s, start, startQuat, player.position, player.quaternion, context);
    if (!hitStep) return null;
    const response = arenaResponse;
    response.hit = true;
    copyContact(response, context.info, _hitProbe);
    // The probe that touched first, relative to its sample pose.
    let probeX = _hitProbe.x - _samplePos.x;
    let probeY = _hitProbe.y - _samplePos.y;
    let probeZ = _hitProbe.z - _samplePos.z;
    let probeRadius = sweep.hitProbeRadius;
    let t = (hitStep - 1) / sweep.steps;
    const stuck = hitStep === 1 && probeShapeAt(shape, start, startQuat, s, context);
    if (stuck) {
        // Already touching before this move (after a grace time or a spawn). Flying on into that
        // contact: stay on the pose and hand its probe over - one sample on would push deeper.
        // Flying out: move one sample and hand that sample's probe over - holding still would
        // freeze a vehicle stuck deeper than the push-out reaches.
        writeContactNormal(context.info, _hitProbe, _contactNormal);
        const end = player.position;
        const leaving = (end.x - start.x) * _contactNormal.x + (end.y - start.y) * _contactNormal.y
            + (end.z - start.z) * _contactNormal.z > 0;
        if (leaving) {
            t = 1 / sweep.steps;
        } else {
            copyContact(response, context.info, _hitProbe);
            probeX = _hitProbe.x - start.x;
            probeY = _hitProbe.y - start.y;
            probeZ = _hitProbe.z - start.z;
            probeRadius = sweep.hitProbeRadius;
        }
    }
    samplePose(start, startQuat, player.position, player.quaternion, t);
    response.responseHasProbe = stuck;
    response.responseAlreadySeparated = !stuck;
    response.responseProbeOffsetX = stuck ? probeX : 0;
    response.responseProbeOffsetY = stuck ? probeY : 0;
    response.responseProbeOffsetZ = stuck ? probeZ : 0;
    response.responseProbeRadius = stuck ? probeRadius : 0;
    response.flownStartQuaternion.copy(startQuat);
    response.flownPosition.copy(_samplePos);
    response.flownQuaternion.copy(_sampleQuat);
    player.position.copy(_samplePos);
    player.quaternion.copy(_sampleQuat);
    player.refreshObbCollisionQuery?.();
    return response;
}

/**
 * Wall contact of the wall shape along this frame's move. A hit puts the vehicle back on
 * its last free sample (responseAlreadySeparated). If even the previous pose touches (after
 * a grace time or a spawn), the touching probe goes to the probe push-out instead: the one of
 * the previous pose, which the vehicle stays on, or - when this move leads out of that
 * contact - the one of the first sample, which the vehicle moves to.
 */
export function resolveArcadeArenaCollision(phase, player, prevPos, prevQuat = player?._renderPrevQuaternion) {
    const state = syncArcadePartHitbox(player);
    if (!state || !phase) return null;
    const context = arenaQueryContext;
    context.phase = phase;
    context.arena = phase.entityManager?.arena || null;
    context.isBot = player.isBot === true;
    const response = resolveArenaSweep(player, state.wall, modelScaleOf(player), prevPos || player.position, prevQuat || player.quaternion, context);
    context.phase = null;
    context.arena = null;
    context.info = null;
    return response;
}

/**
 * Trail contact of the wall shape along this frame's move (same samples as the walls).
 * After a wall contact (`wallHit`, this frame's arena response) only the path the vehicle
 * really flew is swept; the pose the wall response jumped to is checked on its own.
 */
export function resolveArcadeTrailCollision(phase, player, prevPos, skipRecent, wallHit = null) {
    const state = syncArcadePartHitbox(player);
    const index = phase?.entityManager?._trailSpatialIndex;
    if (!state || typeof index?.checkGlobalCollision !== 'function') return null;
    const context = trailQueryContext;
    context.index = index;
    context.gridSize = Number(index.gridSize) > 0 ? Number(index.gridSize) : 10;
    context.playerIndex = player.index;
    context.skipRecent = skipRecent;
    const s = modelScaleOf(player);
    const start = prevPos || player.position;
    const hit = wallHit?.hit === true
        ? sweepShape(state.wall, s, start, wallHit.flownStartQuaternion, wallHit.flownPosition, wallHit.flownQuaternion, context) > 0
            || probeShapeAt(state.wall, player.position, player.quaternion, s, context)
        : sweepShape(state.wall, s, start, player._renderPrevQuaternion || player.quaternion, player.position, player.quaternion, context) > 0;
    const info = hit ? context.info : null;
    context.index = null;
    context.info = null;
    return info;
}

function distance3(ax, ay, az, bx, by, bz) {
    const dx = ax - bx;
    const dy = ay - by;
    const dz = az - bz;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Own-trail segments an Arcade ship skips: the newest ones whose nearer end lies within
 * `protectDistance` along the laid trail from the ship, plus the first one beyond (the spare
 * segment of the speed estimate). Measured on the trail itself instead of estimated from the
 * current speed: that estimate stopped at 12 segments, which left the wall-shape tail on its own
 * trail in slow flight, and it undercounted the short slow segments right after a speed jump.
 * A destroyed segment or a gap counts by the straight distance between its neighbours.
 * Returns null without the part hitbox or a laid trail (every other mode keeps its estimate).
 */
export function countArcadeSelfTrailSkip(player, protectDistance) {
    const trail = player?.trail;
    const refs = trail?.segmentRefs;
    if (!player?.arcadeHitbox || !Array.isArray(refs)) return null;
    const size = trail.maxSegments;
    const count = Math.min(trail.segmentCount, size);
    let x = player.position.x;
    let y = player.position.y;
    let z = player.position.z;
    let along = 0;
    for (let age = 0; age < count; age++) {
        const entry = refs[(trail.writeIndex - 1 - age + size) % size]?.entry;
        if (!entry || entry.destroyed) continue;
        along += distance3(entry.toX, entry.toY, entry.toZ, x, y, z);
        if (along >= protectDistance) return age + 1;
        along += distance3(entry.fromX, entry.fromY, entry.fromZ, entry.toX, entry.toY, entry.toZ);
        x = entry.fromX;
        y = entry.fromY;
        z = entry.fromZ;
    }
    return count;
}

/** Full part shapes of two Arcade vehicles touch (end pose, like the legacy crash test). */
export function arcadeShipsTouch(player, other) {
    const a = player?.arcadeHitbox?.full;
    const b = other?.arcadeHitbox?.full;
    if (!a || !b) return false;
    const s = modelScaleOf(player);
    const reach = a.boundRadius * s + b.boundRadius * modelScaleOf(other);
    if (player.position.distanceToSquared(other.position) > reach * reach) return false;
    const boxes = a.boxes;
    const probes = a.probes;
    for (let i = 0; i < a.count; i++) {
        writeArcadeWorldPoint(player.position, player.quaternion, s, boxes[i * 6], boxes[i * 6 + 1], boxes[i * 6 + 2], _boxCenter);
        if (!sphereHitsArcadePartBoxes(other, _boxCenter, a.boxReach[i] * s)) continue;
        for (let k = a.probeStart[i]; k < a.probeStart[i + 1]; k++) {
            writeArcadeWorldPoint(player.position, player.quaternion, s, probes[k * 4], probes[k * 4 + 1], probes[k * 4 + 2], _probePoint);
            if (sphereHitsArcadePartBoxes(other, _probePoint, probes[k * 4 + 3] * s)) return true;
        }
    }
    return false;
}

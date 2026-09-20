import * as THREE from 'three';
import { nextToIndex, turnYawTowards } from './MapUnitMovementOps.js';

/**
 * Driving a ground unit through the world (A2). The path says where a tank wants to go; this file
 * says whether it may. Before a step counts, a probe sphere is placed where the hull would stand:
 * if it touches world geometry or the arena bounds, the step is rolled back and the tank waits.
 *
 * The probe sits above the floor on purpose. A sphere around the turret centre would always touch
 * the ground the tank stands on, so it would report "blocked" everywhere. It is therefore a smaller
 * sphere, lifted just clear of the ground - which also means a curb is driven over instead of
 * treated as a wall.
 *
 * Nothing here may freeze a round. A tank that is blocked for longer than `blockedSeconds` is let
 * through until its next waypoint, and after `DRIVE_RELEASE_LIMIT` releases it stops probing
 * altogether: a badly authored path then drives like it did before this file existed, instead of
 * parking a map unit forever.
 */

/** Waypoints a unit may tick past in one step, so a path of identical points cannot spin. */
const MAX_WAYPOINT_HOPS = 8;

/** How often a unit may be released before the probe is given up for the rest of the round. */
export const DRIVE_RELEASE_LIMIT = 3;

/** Share of the hit radius used for the body probe, and how far it is lifted off the floor. */
const PROBE_RADIUS_FACTOR = 0.6;
const PROBE_GROUND_CLEARANCE = 0.3;

const probePoint = new THREE.Vector3();

/** Resets the drive bookkeeping of a unit; called on build and on every respawn. */
export function resetDriveState(unit) {
    if (!unit) return;
    unit.driveBlockedSeconds = 0;
    unit.driveReleases = 0;
    unit.driveIgnoreUntilIndex = -1;
}

/** Remembers where a unit stood, so a blocked step can be taken back. */
export function captureUnitPose(unit, out) {
    out.fromIndex = unit.fromIndex;
    out.toIndex = unit.toIndex;
    out.progress = unit.progress;
    out.yaw = unit.yaw;
    out.drivenY = unit.drivenY;
    out.position.copy(unit.groundPosition);
    return out;
}

export function restoreUnitPose(unit, pose) {
    unit.fromIndex = pose.fromIndex;
    unit.toIndex = pose.toIndex;
    unit.progress = pose.progress;
    unit.yaw = pose.yaw;
    unit.drivenY = pose.drivenY;
    unit.groundPosition.copy(pose.position);
}

export function createUnitPose() {
    return { fromIndex: 0, toIndex: 1, progress: 0, yaw: 0, drivenY: null, position: new THREE.Vector3() };
}

/** True when the hull would stand inside world geometry at its current ground position. */
export function isDrivePositionBlocked(arena, unit) {
    if (typeof arena?.checkCollisionFast !== 'function') return false;
    const radius = Math.max(0.05, unit.hitboxRadius * PROBE_RADIUS_FACTOR);
    const scale = Math.max(0.001, Number(unit.scale) || 1);
    probePoint.set(
        unit.groundPosition.x,
        unit.groundPosition.y + radius + PROBE_GROUND_CLEARANCE * scale,
        unit.groundPosition.z,
    );
    return arena.checkCollisionFast(probePoint, radius) === true;
}

/**
 * Answers whether the step just taken has to be rolled back. Also keeps the blocked clock and the
 * release bookkeeping, so the caller only has to restore the old pose.
 */
export function shouldRollBackDriveStep(arena, unit, dt) {
    const drive = unit?.definition?.drive;
    if (drive?.obstacleStop !== true) return false;
    if (unit.driveReleases >= DRIVE_RELEASE_LIMIT) return false;
    if (unit.driveIgnoreUntilIndex >= 0) {
        // Released until the next waypoint: probing resumes once the unit got there.
        if (unit.fromIndex === unit.driveIgnoreUntilIndex) unit.driveIgnoreUntilIndex = -1;
        else return false;
    }
    if (!isDrivePositionBlocked(arena, unit)) {
        unit.driveBlockedSeconds = 0;
        return false;
    }
    unit.driveBlockedSeconds += Math.max(0, Number(dt) || 0);
    if (unit.driveBlockedSeconds < drive.blockedSeconds) return true;
    unit.driveBlockedSeconds = 0;
    unit.driveReleases += 1;
    unit.driveIgnoreUntilIndex = unit.toIndex;
    return false;
}

/**
 * Drives a ground unit towards its next waypoint (A3). The course is the leading value: the hull
 * turns at `turnRate` and the position follows where the hull points, so a corner becomes an arc
 * instead of a knee. A waypoint counts as reached inside `waypointRadius`, which is what lets the
 * unit start turning before it is exactly on the point.
 *
 * Height follows the waypoint in step with the horizontal distance left; the ground clamp corrects
 * whatever the floor really does underneath.
 */
export function steerUnitAlongPath(unit, dt) {
    const drive = unit?.definition?.drive;
    const path = unit?.path;
    if (!drive || !Array.isArray(path) || path.length < 2) return;
    const position = unit.groundPosition;
    const scale = Math.max(0.001, Number(unit.scale) || 1);
    const reach = Math.max(0.05, drive.waypointRadius * scale);
    for (let hop = 0; hop < MAX_WAYPOINT_HOPS; hop += 1) {
        const point = path[unit.toIndex];
        const dx = point[0] - position.x;
        const dz = point[2] - position.z;
        if (dx * dx + dz * dz > reach * reach) break;
        const reached = unit.toIndex;
        unit.toIndex = nextToIndex(path.length, unit.fromIndex, unit.toIndex, unit.definition.loop);
        unit.fromIndex = reached;
    }
    const target = path[unit.toIndex];
    const dx = target[0] - position.x;
    const dz = target[2] - position.z;
    const horizontal = Math.hypot(dx, dz);
    const step = Math.max(0, unit.speed * Math.max(0, Number(dt) || 0));
    if (horizontal > 0.000001) {
        unit.yaw = turnYawTowards(unit.yaw, Math.atan2(dx, dz), drive.turnRate * Math.max(0, Number(dt) || 0));
        position.y += (target[1] - position.y) * Math.min(1, step / horizontal);
    }
    position.x += Math.sin(unit.yaw) * step;
    position.z += Math.cos(unit.yaw) * step;
    const from = path[unit.fromIndex];
    unit.progress = Math.hypot(position.x - from[0], position.z - from[2]);
}

import * as THREE from 'three';
import { nextToIndex, turnYawTowards } from './MapUnitMovementOps.js';

/**
 * Driving a ground unit through the world (A2-A4). The path says where a tank wants to go; this
 * file says whether it may, how it gets there, and when it is allowed to leave the path for a
 * player.
 *
 * Before a step counts, a probe sphere is placed where the hull would stand: if it touches world
 * geometry or the arena bounds, the step is rolled back and the tank waits. The probe sits above
 * the floor on purpose - a sphere around the turret centre would always touch the ground the tank
 * stands on and report "blocked" everywhere. The lift also means a curb is driven over instead of
 * being treated as a wall.
 *
 * Nothing here may freeze a round. A tank blocked for longer than `blockedSeconds` is let through
 * until its next waypoint, and after `DRIVE_RELEASE_LIMIT` releases it stops probing altogether: a
 * badly authored path then drives like it did before this file existed, instead of parking a map
 * unit forever.
 */

/** Waypoints a unit may tick past in one step, so a path of identical points cannot spin. */
const MAX_WAYPOINT_HOPS = 8;

/** How often a unit may be released before the probe is given up for the rest of the round. */
export const DRIVE_RELEASE_LIMIT = 3;

/** Share of the hit radius used for the body probe, and how far it is lifted off the floor. */
const PROBE_RADIUS_FACTOR = 0.6;
const PROBE_GROUND_CLEARANCE = 0.3;

/** A target stays interesting a little past the range it was picked at, so it cannot flicker. */
const CHASE_HOLD_FACTOR = 1.2;

/** How close the sight ray stops in front of the target, so the target is not its own wall. */
const SIGHT_MARGIN = 0.5;

export const DRIVE_MODES = Object.freeze({ PATROL: 'patrol', CHASE: 'chase', RETURN: 'return' });

const probePoint = new THREE.Vector3();
const sightDirection = new THREE.Vector3();

/** Resets the drive bookkeeping of a unit; called on build and on every respawn. */
export function resetDriveState(unit) {
    if (!unit) return;
    unit.driveBlockedSeconds = 0;
    unit.driveReleases = 0;
    unit.driveIgnoreUntilIndex = -1;
    unit.driveMode = DRIVE_MODES.PATROL;
    unit.chaseTarget = null;
    unit.chaseAnchorIndex = -1;
    unit.chaseFromIndex = -1;
    unit.chaseBlockedUntilIndex = -1;
    unit.chaseAnchor?.copy(unit.groundPosition);
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
 * Turns the hull towards a point and moves it that way. Answers the horizontal distance that was
 * left before the step, which is what tells the caller whether the point counts as reached.
 */
function driveTowards(unit, x, y, z, dt, speed) {
    const position = unit.groundPosition;
    const safeDt = Math.max(0, Number(dt) || 0);
    const dx = x - position.x;
    const dz = z - position.z;
    const horizontal = Math.hypot(dx, dz);
    const step = Math.max(0, speed * safeDt);
    if (horizontal > 0.000001) {
        unit.yaw = turnYawTowards(unit.yaw, Math.atan2(dx, dz), unit.definition.drive.turnRate * safeDt);
        position.y += (y - position.y) * Math.min(1, step / horizontal);
    }
    position.x += Math.sin(unit.yaw) * step;
    position.z += Math.cos(unit.yaw) * step;
    return horizontal;
}

/**
 * How close a waypoint has to be to count as reached. At least a turning radius: a unit that only
 * begins to turn once it sits on the corner swings out past the path, and in a tight room that puts
 * its hull through the wall. Starting the turn a turning radius early makes the arc tangent to both
 * legs, so the driven track stays inside the authored corner.
 */
function waypointReach(unit) {
    const drive = unit.definition.drive;
    const scale = Math.max(0.001, Number(unit.scale) || 1);
    const turningRadius = unit.speed / Math.max(0.001, drive.turnRate);
    return Math.max(0.05, drive.waypointRadius * scale, turningRadius);
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
    const path = unit?.path;
    if (!unit?.definition?.drive || !Array.isArray(path) || path.length < 2) return;
    const reach = waypointReach(unit);
    for (let hop = 0; hop < MAX_WAYPOINT_HOPS; hop += 1) {
        const point = path[unit.toIndex];
        const dx = point[0] - unit.groundPosition.x;
        const dz = point[2] - unit.groundPosition.z;
        if (dx * dx + dz * dz > reach * reach) break;
        const reached = unit.toIndex;
        unit.toIndex = nextToIndex(path.length, unit.fromIndex, unit.toIndex, unit.definition.loop);
        unit.fromIndex = reached;
        if (unit.chaseBlockedUntilIndex === unit.fromIndex) unit.chaseBlockedUntilIndex = -1;
    }
    const target = path[unit.toIndex];
    driveTowards(unit, target[0], target[1], target[2], dt, unit.speed);
    const from = path[unit.fromIndex];
    unit.progress = Math.hypot(unit.groundPosition.x - from[0], unit.groundPosition.z - from[2]);
}

/** Free sight from the turret to a target, tested against the same geometry a shot would hit. */
function hasDriveSight(arena, unit, target) {
    if (typeof arena?.raycast !== 'function') return true;
    sightDirection.copy(target.position).sub(unit.position);
    const distance = sightDirection.length();
    if (distance <= SIGHT_MARGIN) return true;
    sightDirection.divideScalar(distance);
    return arena.raycast(unit.position, sightDirection, distance - SIGHT_MARGIN)?.hit !== true;
}

/** The nearest player a unit is allowed to hunt, in sight and inside `range`. */
export function pickChaseTarget(arena, unit, players, range) {
    let best = null;
    let bestDistanceSq = range * range;
    for (const player of players || []) {
        if (player?.alive !== true || !player.position) continue;
        if (unit.definition.targetPlayers === 'humans' && player.isBot === true) continue;
        const distanceSq = player.position.distanceToSquared(unit.position);
        if (distanceSq > bestDistanceSq || !hasDriveSight(arena, unit, player)) continue;
        best = player;
        bestDistanceSq = distanceSq;
    }
    return best;
}

/**
 * Patrol, chase, return (A4). The path stays the home of the unit: it only leaves for a player in
 * sight, and never gets further than the leash from the spot where it left. A broken leash sends
 * it back to that spot and bars the next chase until the circuit carried it on, so a far away
 * player cannot hold a tank in a tug of war at the end of its rope.
 */
export function driveChasingUnit(arena, unit, players, dt) {
    const drive = unit.definition.drive;
    const scale = Math.max(0.001, Number(unit.scale) || 1);

    if (unit.driveMode === DRIVE_MODES.PATROL && unit.chaseBlockedUntilIndex < 0) {
        const target = pickChaseTarget(arena, unit, players, drive.chaseRange * scale);
        if (target) {
            unit.driveMode = DRIVE_MODES.CHASE;
            unit.chaseTarget = target;
            unit.chaseAnchorIndex = unit.toIndex;
            unit.chaseFromIndex = unit.fromIndex;
            unit.chaseAnchor.copy(unit.groundPosition);
        }
    }

    if (unit.driveMode === DRIVE_MODES.CHASE) {
        const target = unit.chaseTarget;
        const anchor = unit.chaseAnchor;
        const holdRange = drive.chaseRange * scale * CHASE_HOLD_FACTOR;
        const leashed = Math.hypot(unit.groundPosition.x - anchor.x, unit.groundPosition.z - anchor.z)
            <= drive.chaseLeash * scale;
        const keeps = target?.alive === true && target.position
            && target.position.distanceToSquared(unit.position) <= holdRange * holdRange
            && hasDriveSight(arena, unit, target);
        if (keeps && leashed) {
            driveTowards(unit, target.position.x, unit.groundPosition.y, target.position.z, dt, unit.speed);
            return;
        }
        unit.driveMode = DRIVE_MODES.RETURN;
        unit.chaseTarget = null;
        // A broken leash also bars the next chase until the circuit carried the unit on.
        if (!leashed) unit.chaseBlockedUntilIndex = unit.chaseAnchorIndex;
    }

    if (unit.driveMode === DRIVE_MODES.RETURN) {
        const anchor = unit.chaseAnchor;
        const left = driveTowards(unit, anchor.x, anchor.y, anchor.z, dt, unit.speed * drive.returnSpeedFactor);
        if (left > waypointReach(unit)) return;
        unit.driveMode = DRIVE_MODES.PATROL;
        unit.fromIndex = unit.chaseFromIndex;
        unit.toIndex = unit.chaseAnchorIndex;
        unit.chaseAnchorIndex = -1;
        unit.chaseFromIndex = -1;
        return;
    }

    steerUnitAlongPath(unit, dt);
}

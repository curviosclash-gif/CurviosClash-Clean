import * as THREE from 'three';

/**
 * Keeps a ground unit on the floor (A1). There is no height map in the game, so a waypoint carries
 * its own height and a roughly authored path leaves the tank floating. A short ray straight down
 * from just above the hull answers where the floor really is.
 *
 * The height is followed at a limited rate (`climbRate`), so an edge is driven over instead of
 * jumped down, and `drivenY` carries the reached height into the next tick - without it the clamp
 * would start again from the authored height every tick and never get anywhere.
 *
 * Misses are the normal case on a bridge, a ramp gap or over water: then the authored height wins
 * again. That keeps a map that places its waypoints exactly working like before.
 */

const DOWN = new THREE.Vector3(0, -1, 0);
const probeOrigin = new THREE.Vector3();

/** Forgets the driven height, so a respawn starts from the authored path again. */
export function resetGroundClamp(unit) {
    if (unit) unit.drivenY = null;
}

/**
 * Pulls `unit.groundPosition.y` towards the floor under it. Answers whether a ray was spent.
 * `groundPosition` must already hold the authored height of this tick.
 */
export function applyGroundClamp(arena, unit, dt) {
    const drive = unit?.definition?.drive;
    if (drive?.groundClamp !== true || typeof arena?.raycast !== 'function') return false;
    const scale = Math.max(0.001, Number(unit.scale) || 1);
    const authoredY = unit.groundPosition.y;
    const currentY = Number.isFinite(unit.drivenY) ? Number(unit.drivenY) : authoredY;
    const probeHeight = drive.probeHeight * scale;
    probeOrigin.set(unit.groundPosition.x, Math.max(authoredY, currentY) + probeHeight, unit.groundPosition.z);
    const hit = arena.raycast(probeOrigin, DOWN, probeHeight + drive.maxDrop * scale);
    const targetY = hit?.hit === true ? probeOrigin.y - (Number(hit.distance) || 0) : authoredY;
    const step = Math.max(0, drive.climbRate * scale * Math.max(0, Number(dt) || 0));
    const delta = targetY - currentY;
    const nextY = Math.abs(delta) <= step ? targetY : currentY + Math.sign(delta) * step;
    unit.groundPosition.y = nextY;
    unit.drivenY = nextY;
    return true;
}

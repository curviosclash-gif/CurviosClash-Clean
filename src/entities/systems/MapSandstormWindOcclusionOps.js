import * as THREE from 'three';

const DEFAULT_MAX_DISTANCE = 16;
const DEFAULT_CROSSWIND_OFFSET = 1.25;
const DIRECTION_EPSILON_SQ = 1e-8;

/** Reusable vectors for the three arena geometry probes made for one exposure query. */
export function createSandstormWindOcclusionScratch() {
    return {
        origin: new THREE.Vector3(),
        direction: new THREE.Vector3(),
        crosswind: new THREE.Vector3(),
    };
}

/**
 * Estimate how much wind reaches a position by checking three parallel paths from upwind.
 * Wind direction points in the direction the wind travels. The upwind origins are therefore
 * placed against the wind direction and rays travel with the wind toward the player.
 *
 * Arena.raycast skips tunnel obstacle AABBs because those boxes enclose hollow space. Keep that
 * behavior here: a tunnel must not become a false solid wind barrier until it has exact ray tests.
 */
export function resolveSandstormWindExposure(arena, position, windDirectionXZ, scratch, options = undefined) {
    if (typeof arena?.raycast !== 'function'
        || !position || !Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)
        || !windDirectionXZ || !Number.isFinite(windDirectionXZ.x) || !Number.isFinite(windDirectionXZ.z)
        || !scratch?.origin?.set || !scratch?.direction?.set || !scratch?.crosswind?.set) {
        return 1;
    }

    const windLengthSq = windDirectionXZ.x * windDirectionXZ.x + windDirectionXZ.z * windDirectionXZ.z;
    if (!Number.isFinite(windLengthSq) || windLengthSq <= DIRECTION_EPSILON_SQ) return 1;

    const inverseLength = 1 / Math.sqrt(windLengthSq);
    const windX = windDirectionXZ.x * inverseLength;
    const windZ = windDirectionXZ.z * inverseLength;
    const maxDistanceOption = Number(options?.maxDistance);
    const maxDistance = Number.isFinite(maxDistanceOption) && maxDistanceOption > 0
        ? maxDistanceOption
        : DEFAULT_MAX_DISTANCE;
    const crosswindOffsetOption = Number(options?.crosswindOffset);
    const crosswindOffset = Number.isFinite(crosswindOffsetOption) && crosswindOffsetOption >= 0
        ? crosswindOffsetOption
        : DEFAULT_CROSSWIND_OFFSET;

    const { origin, direction, crosswind } = scratch;
    crosswind.set(-windZ, 0, windX);
    direction.set(windX, 0, windZ);

    let clearProbes = 0;
    for (let probe = -1; probe <= 1; probe += 1) {
        const lateral = probe * crosswindOffset;
        origin.set(
            position.x - windX * maxDistance + crosswind.x * lateral,
            position.y,
            position.z - windZ * maxDistance + crosswind.z * lateral,
        );
        // ArenaCollision reuses its ray result object, so consume the hit bit before raycasting
        // the next lateral probe mutates that same object.
        const hit = arena.raycast(origin, direction, maxDistance);
        if (!hit?.hit) clearProbes += 1;
    }

    return clearProbes / 3;
}

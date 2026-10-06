// Flight test: would the match crash the ship here? Blocks and world models answer through the
// game's own collision (createEditorCollisionProbe), the floor and the arena walls through the
// arena box. The hitbox is the match hitbox in world units; positions are editor units.

/**
 * @param {{
 *   position: {x: number, y: number, z: number},
 *   arenaSize: {width: number, height: number, depth: number},
 *   hitboxRadiusWorld: number,
 *   unitsPerWorldUnit: number,
 *   isBlocked?: ((position: any, radiusWorld: number) => boolean) | null,
 * }} options
 * @returns {{colliding: boolean, reason: 'geometry'|'floor'|'outside'|null}}
 */
export function evaluateFlightClearance({ position, arenaSize, hitboxRadiusWorld, unitsPerWorldUnit, isBlocked = null }) {
    const radius = Math.max(0, Number(hitboxRadiusWorld) || 0) * Math.max(0, Number(unitsPerWorldUnit) || 1);
    const halfWidth = (Number(arenaSize?.width) || 0) / 2;
    const halfDepth = (Number(arenaSize?.depth) || 0) / 2;
    const height = Number(arenaSize?.height) || 0;
    if (Math.abs(position.x) > halfWidth || Math.abs(position.z) > halfDepth || position.y > height) {
        return { colliding: true, reason: 'outside' };
    }
    if (position.y < radius) return { colliding: true, reason: 'floor' };
    if (isBlocked?.(position, hitboxRadiusWorld)) return { colliding: true, reason: 'geometry' };
    return { colliding: false, reason: null };
}

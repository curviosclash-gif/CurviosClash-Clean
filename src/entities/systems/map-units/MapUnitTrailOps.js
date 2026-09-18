/**
 * Tanks crush the trails they drive through (E18): every trail piece that reaches into the tank
 * disappears, and the tank takes 10 damage per second while it grinds through them. That makes a
 * trail laid across a tank's path a weak weapon, and the kill counts for the trail's owner.
 */

export const TRAIL_CRUSH_DAMAGE_PER_SECOND = 10;
export const TRAIL_CRUSH_CAUSE = 'TRAIL_CRUSH';

/** Squared distance from point p to the segment a-b, all as plain numbers. */
function segmentDistanceSq(px, py, pz, segment) {
    const ax = Number(segment.fromX) || 0;
    const ay = Number(segment.fromY) || 0;
    const az = Number(segment.fromZ) || 0;
    const dx = (Number(segment.toX) || 0) - ax;
    const dy = (Number(segment.toY) || 0) - ay;
    const dz = (Number(segment.toZ) || 0) - az;
    const lengthSq = dx * dx + dy * dy + dz * dz;
    const t = lengthSq > 0.000001
        ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / lengthSq))
        : 0;
    const ex = ax + dx * t - px;
    const ey = ay + dy * t - py;
    const ez = az + dz * t - pz;
    return ex * ex + ey * ey + ez * ez;
}

/**
 * Crushes the trail pieces touching `unit` this tick. Answers how many were destroyed.
 * `scratch` is a reused array for the area query.
 */
export function crushTrailsUnderUnit(entityManager, unit, dt, scratch) {
    const trails = entityManager?.getTrailSpatialIndex?.();
    if (typeof trails?.collectSegmentsInArea !== 'function' || typeof trails.destroySegment !== 'function') return 0;
    const reach = unit.hitboxRadius;
    const centre = unit.position;
    const candidates = trails.collectSegmentsInArea(
        centre.x - reach, centre.z - reach, centre.x + reach, centre.z + reach, scratch,
    );
    let crushed = 0;
    let creditIndex = -1;
    for (const segment of candidates) {
        if (!segment || segment.destroyed) continue;
        const touch = reach + Math.max(0, Number(segment.radius) || 0);
        if (segmentDistanceSq(centre.x, centre.y, centre.z, segment) > touch * touch) continue;
        trails.destroySegment(segment);
        crushed += 1;
        if (creditIndex < 0 && Number.isInteger(segment.playerIndex)) creditIndex = segment.playerIndex;
    }
    if (crushed > 0 && dt > 0) {
        const owner = (entityManager.players || []).find((player) => player?.index === creditIndex) || null;
        unit.takeDamage?.(TRAIL_CRUSH_DAMAGE_PER_SECOND * dt, { sourcePlayer: owner, cause: TRAIL_CRUSH_CAUSE });
    }
    return crushed;
}

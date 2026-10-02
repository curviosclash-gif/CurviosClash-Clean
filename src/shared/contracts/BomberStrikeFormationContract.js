export const BOMBER_STRIKE_FORMATION = Object.freeze({
    speed: 30,
    count: 5,
    hitPoints: 120,
    hitboxRadius: 6.75,
    bombCooldown: 0.75,
    offsets: Object.freeze([
        Object.freeze([0, 0]),
        Object.freeze([-10, -12]),
        Object.freeze([-10, 12]),
        Object.freeze([-20, -24]),
        Object.freeze([-20, 24]),
    ]),
});

export function resolveBomberStrikeFormation(bounds, callerPosition) {
    const minX = Number(bounds?.minX ?? bounds?.min?.x);
    const maxX = Number(bounds?.maxX ?? bounds?.max?.x);
    const minY = Number(bounds?.minY ?? bounds?.min?.y);
    const maxY = Number(bounds?.maxY ?? bounds?.max?.y);
    const minZ = Number(bounds?.minZ ?? bounds?.min?.z);
    const maxZ = Number(bounds?.maxZ ?? bounds?.max?.z);
    if (![minX, maxX, minY].every(Number.isFinite) || maxX <= minX) return null;

    const ceilingY = Number.isFinite(maxY) && maxY > minY ? maxY : minY + 60;
    const minZBound = Number.isFinite(minZ) ? minZ : -100;
    const maxZBound = Number.isFinite(maxZ) ? maxZ : 100;
    const radius = BOMBER_STRIKE_FORMATION.hitboxRadius;
    const rearDepth = 20;
    const wingSpan = 24;
    const scaleX = Math.min(
        1,
        (maxX - minX - radius * 2 - 5) / rearDepth,
    );
    const scaleZ = Math.min(1, (maxZBound - minZBound - radius * 2) / (wingSpan * 2));
    if (!(scaleX > 0) || !(scaleZ >= 0.5625)) return null;
    const scaledOffsets = BOMBER_STRIKE_FORMATION.offsets.map(([x, z]) => [x * scaleX, z * scaleZ]);
    for (let first = 0; first < scaledOffsets.length; first += 1) {
        for (let second = first + 1; second < scaledOffsets.length; second += 1) {
            const dx = scaledOffsets[first][0] - scaledOffsets[second][0];
            const dz = scaledOffsets[first][1] - scaledOffsets[second][1];
            if (dx * dx + dz * dz < (radius * 2) ** 2) return null;
        }
    }

    const halfWing = wingSpan * scaleZ;
    const centreZ = Number(callerPosition?.z) || 0;
    const z = Math.max(minZBound + halfWing + radius,
        Math.min(maxZBound - halfWing - radius, centreZ));
    const desiredY = minY + (ceilingY - minY) * 0.75;
    const y = Math.max(minY + radius, Math.min(ceilingY - radius, desiredY));
    const firstX = minX + (rearDepth * scaleX) + radius;
    const lastX = maxX - radius;
    if (lastX - firstX < 4.999 || y < minY + radius - 0.0001 || y > ceilingY - radius + 0.0001) return null;

    return scaledOffsets.map(([x, wingZ]) => {
        return Object.freeze({
            path: Object.freeze([
                Object.freeze([firstX + x, y, z + wingZ]),
                Object.freeze([lastX + x, y, z + wingZ]),
            ]),
            speed: BOMBER_STRIKE_FORMATION.speed,
            hitPoints: BOMBER_STRIKE_FORMATION.hitPoints,
        });
    });
}

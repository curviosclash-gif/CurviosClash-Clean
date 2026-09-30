// Ray and segment geometry for the shootable dandelion crown, kept apart from the seed state.

function dot(ax, ay, az, bx, by, bz) {
    return ax * bx + ay * by + az * bz;
}

// Only entries from outside count. The crowns are much larger than the bristles they stand for
// and overlap densely, so a muzzle inside one would otherwise hit it at distance 0 every shot.
export function raySphereEntry(origin, direction, center, radius, maxDistance) {
    const ox = origin.x - center.x;
    const oy = origin.y - center.y;
    const oz = origin.z - center.z;
    const c = dot(ox, oy, oz, ox, oy, oz) - radius * radius;
    if (c <= 0) return Infinity;
    const b = dot(ox, oy, oz, direction.x, direction.y, direction.z);
    const discriminant = b * b - c;
    if (discriminant < 0) return Infinity;
    const entry = -b - Math.sqrt(discriminant);
    return entry >= 0 && entry < maxDistance ? entry : Infinity;
}

function pointSegmentDistanceSquared(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const lengthSq = dx * dx + dy * dy + dz * dz;
    const t = lengthSq > 0.000001
        ? Math.max(0, Math.min(1,
            ((point.x - start.x) * dx + (point.y - start.y) * dy + (point.z - start.z) * dz)
            / lengthSq))
        : 0;
    const offsetX = point.x - (start.x + dx * t);
    const offsetY = point.y - (start.y + dy * t);
    const offsetZ = point.z - (start.z + dz * t);
    return offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ;
}

/** Entry distance for a normalized ray against a capsule from start to end, from outside only. */
export function rayCapsuleEntry(origin, direction, start, end, radius, maxDistance) {
    if (pointSegmentDistanceSquared(origin, start, end) <= radius * radius) return Infinity;
    const bax = end.x - start.x;
    const bay = end.y - start.y;
    const baz = end.z - start.z;
    const oax = origin.x - start.x;
    const oay = origin.y - start.y;
    const oaz = origin.z - start.z;
    const baba = dot(bax, bay, baz, bax, bay, baz);
    if (baba <= 0.000001) {
        return raySphereEntry(origin, direction, start, radius, maxDistance);
    }

    const bard = dot(bax, bay, baz, direction.x, direction.y, direction.z);
    const baoa = dot(bax, bay, baz, oax, oay, oaz);
    const rdoa = dot(direction.x, direction.y, direction.z, oax, oay, oaz);
    const oaoa = dot(oax, oay, oaz, oax, oay, oaz);
    const a = baba - bard * bard;
    const b = baba * rdoa - baoa * bard;
    const c = baba * oaoa - baoa * baoa - radius * radius * baba;
    let entry = Infinity;
    if (Math.abs(a) > 0.000001) {
        const discriminant = b * b - a * c;
        if (discriminant >= 0) {
            const bodyEntry = (-b - Math.sqrt(discriminant)) / a;
            const axisPosition = baoa + bodyEntry * bard;
            if (bodyEntry >= 0 && bodyEntry < maxDistance
                && axisPosition > 0 && axisPosition < baba) {
                entry = bodyEntry;
            }
        }
    }
    return Math.min(
        entry,
        raySphereEntry(origin, direction, start, radius, maxDistance),
        raySphereEntry(origin, direction, end, radius, maxDistance),
    );
}

/** Closest points between two finite line segments, written into a reusable result. */
export function closestSegmentPoints(a0, a1, b0, b1, result) {
    const ux = a1.x - a0.x;
    const uy = a1.y - a0.y;
    const uz = a1.z - a0.z;
    const vx = b1.x - b0.x;
    const vy = b1.y - b0.y;
    const vz = b1.z - b0.z;
    const wx = a0.x - b0.x;
    const wy = a0.y - b0.y;
    const wz = a0.z - b0.z;
    const a = dot(ux, uy, uz, ux, uy, uz);
    const b = dot(ux, uy, uz, vx, vy, vz);
    const c = dot(vx, vy, vz, vx, vy, vz);
    const d = dot(ux, uy, uz, wx, wy, wz);
    const e = dot(vx, vy, vz, wx, wy, wz);
    const denominator = a * c - b * b;
    let sNumerator = denominator;
    let sDenominator = denominator;
    let tNumerator = denominator;
    let tDenominator = denominator;

    if (denominator < 0.000001) {
        sNumerator = 0;
        sDenominator = 1;
        tNumerator = e;
        tDenominator = c;
    } else {
        sNumerator = b * e - c * d;
        tNumerator = a * e - b * d;
        if (sNumerator < 0) {
            sNumerator = 0;
            tNumerator = e;
            tDenominator = c;
        } else if (sNumerator > sDenominator) {
            sNumerator = sDenominator;
            tNumerator = e + b;
            tDenominator = c;
        }
    }

    if (tNumerator < 0) {
        tNumerator = 0;
        if (-d < 0) {
            sNumerator = 0;
        } else if (-d > a) {
            sNumerator = sDenominator;
        } else {
            sNumerator = -d;
            sDenominator = a;
        }
    } else if (tNumerator > tDenominator) {
        tNumerator = tDenominator;
        if ((-d + b) < 0) {
            sNumerator = 0;
        } else if ((-d + b) > a) {
            sNumerator = sDenominator;
        } else {
            sNumerator = -d + b;
            sDenominator = a;
        }
    }

    const s = Math.abs(sNumerator) < 0.000001 ? 0 : sNumerator / sDenominator;
    const t = Math.abs(tNumerator) < 0.000001 ? 0 : tNumerator / tDenominator;
    result.ax = a0.x + s * ux;
    result.ay = a0.y + s * uy;
    result.az = a0.z + s * uz;
    result.bx = b0.x + t * vx;
    result.by = b0.y + t * vy;
    result.bz = b0.z + t * vz;
    const dx = result.ax - result.bx;
    const dy = result.ay - result.by;
    const dz = result.az - result.bz;
    result.distanceSq = dx * dx + dy * dy + dz * dz;
    return result;
}

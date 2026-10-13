// Free rings for hunt parcours variants: placed, added or removed at any time, counted for
// ships and projectiles alike, each with an owner. Independent of the static parcours route.
export const RING_FIELD_DEFAULT_RADIUS = 6;

/** @param {unknown} value */
function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

/**
 * @param {any} source
 * @param {number} index
 */
function normalizeRing(source, index) {
    const pos = Array.isArray(source?.pos) ? source.pos : [];
    const forward = Array.isArray(source?.forward) ? source.forward : [];
    let fx = finite(forward[0]);
    let fy = finite(forward[1]);
    let fz = finite(forward[2]);
    const length = Math.hypot(fx, fy, fz);
    if (length > 1e-6) {
        fx /= length; fy /= length; fz /= length;
    } else {
        fx = 0; fy = 0; fz = 1;
    }
    const radius = Number(source?.radius);
    return {
        id: typeof source?.id === 'string' && source.id ? source.id : `ring_${index}`,
        x: finite(pos[0]),
        y: finite(pos[1]),
        z: finite(pos[2]),
        fx, fy, fz,
        radius: Number.isFinite(radius) && radius > 0 ? radius : RING_FIELD_DEFAULT_RADIUS,
        directional: source?.directional === true,
        ownerId: '',
    };
}

/** @param {any[]} rings */
export function createRingField(rings = []) {
    return { rings: (Array.isArray(rings) ? rings : []).map(normalizeRing) };
}

/**
 * True when the segment prev -> curr crosses the ring disc. Works on the segment, not on
 * samples, so fast projectiles cannot tunnel through. Directional rings only count along
 * their forward vector. Scalar arguments keep the per-frame call allocation free.
 * @param {any} ring
 * @param {number} px @param {number} py @param {number} pz
 * @param {number} cx @param {number} cy @param {number} cz
 * @param {number} [bodyRadius]
 */
export function testRingFieldCrossing(ring, px, py, pz, cx, cy, cz, bodyRadius = 0) {
    if (!ring) return false;
    const dotPrev = ((px - ring.x) * ring.fx) + ((py - ring.y) * ring.fy) + ((pz - ring.z) * ring.fz);
    const dotCurr = ((cx - ring.x) * ring.fx) + ((cy - ring.y) * ring.fy) + ((cz - ring.z) * ring.fz);
    const forwardCross = dotPrev <= 0 && dotCurr > 0;
    const backwardCross = dotPrev >= 0 && dotCurr < 0;
    if (!forwardCross && !(backwardCross && !ring.directional)) return false;
    const t = dotPrev / (dotPrev - dotCurr);
    const hx = px + ((cx - px) * t) - ring.x;
    const hy = py + ((cy - py) * t) - ring.y;
    const hz = pz + ((cz - pz) * t) - ring.z;
    const reach = ring.radius + Math.max(0, finite(bodyRadius));
    return ((hx * hx) + (hy * hy) + (hz * hz)) <= reach * reach;
}

/**
 * @param {{ rings: any[] }} field
 * @param {number} index
 * @param {string} ownerId
 * @returns {string | null} previous owner ('' when it was free), null when nothing changed
 */
export function claimRingFieldRing(field, index, ownerId) {
    const ring = field?.rings?.[index];
    if (!ring || typeof ownerId !== 'string' || !ownerId || ring.ownerId === ownerId) return null;
    const previous = ring.ownerId;
    ring.ownerId = ownerId;
    return previous;
}

/**
 * @param {{ rings: any[] }} field
 * @param {string} ownerId
 * @returns {number} number of rings set free
 */
export function releaseRingFieldOwner(field, ownerId) {
    if (!ownerId || !Array.isArray(field?.rings)) return 0;
    let released = 0;
    for (const ring of field.rings) {
        if (ring.ownerId !== ownerId) continue;
        ring.ownerId = '';
        released += 1;
    }
    return released;
}

/**
 * @param {{ rings: any[] }} field
 * @param {string} ownerId
 */
export function countRingFieldRingsOwnedBy(field, ownerId) {
    if (!ownerId || !Array.isArray(field?.rings)) return 0;
    let count = 0;
    for (const ring of field.rings) {
        if (ring.ownerId === ownerId) count += 1;
    }
    return count;
}

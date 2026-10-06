import * as THREE from 'three';

// Building from the cockpit: where the crosshair puts an object, how it sits on the
// surface it was aimed at, and the block a two-click span describes. Pure: the caller
// does the raycast and hands in the hit.

// Free placement distance ahead of the ship, in match hitbox radii (Ctrl + mouse wheel).
export const FLIGHT_PLACEMENT_DISTANCE_RADII = Object.freeze([6, 10, 15, 22, 32, 48, 70]);
export const FLIGHT_PLACEMENT_DEFAULT_DISTANCE_INDEX = 2;

const TWO_POINT_TOOLS = new Set(['hard', 'foam', 'tunnel']);
const FACING_FIELDS = Object.freeze({ checkpoint: 'cpForward', portal: 'forward' });
const _corner = new THREE.Vector3();

export function isTwoPointFlightTool(tool) {
    return TWO_POINT_TOOLS.has(tool);
}

/**
 * @param {{origin: THREE.Vector3, direction: THREE.Vector3,
 *   hit?: {point: THREE.Vector3, normal?: THREE.Vector3|null}|null,
 *   fallbackDistance: number, snapSize?: number}} options
 */
export function resolveCrosshairTarget({ origin, direction, hit = null, fallbackDistance, snapSize = 0 }) {
    let point;
    let normal = null;
    if (hit?.point) {
        point = hit.point.clone();
        normal = hit.normal ? hit.normal.clone().normalize() : null;
    } else {
        point = direction.clone().normalize().multiplyScalar(Math.max(0, Number(fallbackDistance) || 0)).add(origin);
    }
    const snap = Number(snapSize);
    if (Number.isFinite(snap) && snap > 0) {
        point.x = Math.round(point.x / snap) * snap;
        point.z = Math.round(point.z / snap) * snap;
    }
    return { point, normal, onSurface: !!hit?.point };
}

/**
 * Distance to move an object along the surface normal so the side facing the surface
 * touches the aimed point instead of sinking into it.
 * @param {THREE.Box3} box World bounds of the object as created at the aimed point.
 */
export function resolveSurfaceContactOffset(box, point, normal) {
    if (!normal || !box || box.isEmpty()) return 0;
    let deepest = Infinity;
    for (let index = 0; index < 8; index += 1) {
        _corner.set(
            index & 1 ? box.max.x : box.min.x,
            index & 2 ? box.max.y : box.min.y,
            index & 4 ? box.max.z : box.min.z
        );
        deepest = Math.min(deepest, _corner.dot(normal));
    }
    return Math.max(0, point.dot(normal) - deepest);
}

/**
 * Block between two aimed corners. Corners at almost the same height (both on a floor)
 * give the default wall height standing on that floor.
 */
export function resolveTwoPointBox(a, b, { minSize = 10, defaultHeight = 100 } = {}) {
    const minX = Math.min(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const minZ = Math.min(a.z, b.z);
    const sizeX = Math.max(minSize, Math.abs(a.x - b.x));
    const sizeZ = Math.max(minSize, Math.abs(a.z - b.z));
    const spanY = Math.abs(a.y - b.y);
    const sizeY = spanY < minSize ? Math.max(minSize, defaultHeight) : spanY;
    return {
        center: new THREE.Vector3(
            Math.abs(a.x - b.x) < minSize ? (a.x + b.x) / 2 : minX + sizeX / 2,
            minY + sizeY / 2,
            Math.abs(a.z - b.z) < minSize ? (a.z + b.z) / 2 : minZ + sizeZ / 2
        ),
        sizeX,
        sizeY,
        sizeZ,
    };
}

/** Rings face the flight direction, so the route is flown through them as aimed. */
export function resolveFlightFacing(tool, direction) {
    const field = FACING_FIELDS[tool];
    if (!field || !direction || direction.lengthSq() <= Number.EPSILON) return {};
    return { [field]: direction.clone().normalize().toArray() };
}

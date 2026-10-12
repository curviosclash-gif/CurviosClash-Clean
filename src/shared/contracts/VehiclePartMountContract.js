// Fixed mount of a top-level Vehicle Lab part, written into the ship data:
// `mount: { anchor: [x, y, z], carrier: 'hull' | '<name of another top-level part>' }`.
// The anchor is a point in factory vehicle space where the part meets its carrier. When the
// arcade hangar sizes the ship, the part grows away from its anchor, and a carrier that grows or
// moves takes the anchor along (VehiclePartStyleContract.resolveVehiclePartPlacements). The drawn
// ship (applyVehiclePartStyle) and the hit zone (buildArcadeHitboxShape) read the same placement.
// A part without a valid mount keeps the old behaviour: it grows around its own pivot.
// Pure data - no imports from core/ui/state.

/** Carrier name for the part with role 'core'. */
export const VEHICLE_PART_MOUNT_HULL = 'hull';
const MAX_CARRIER_LENGTH = 80;
const MAX_ABS_ANCHOR = 1000;

/**
 * @typedef {object} VehiclePartMount
 * @property {number[]} anchor  [x, y, z] in factory vehicle space
 * @property {string} carrier   'hull' or the name of another top-level part
 */

/**
 * Normalized mount of a part, or null when the part has none (or an unusable one).
 * A missing carrier means the hull.
 * @param {unknown} raw
 * @returns {VehiclePartMount|null}
 */
export function normalizeVehiclePartMount(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const source = /** @type {Record<string, unknown>} */ (raw);
    const anchorSource = source.anchor;
    if (!Array.isArray(anchorSource) || anchorSource.length !== 3) return null;
    const anchor = anchorSource.map((value) => (typeof value === 'number' ? value : Number.NaN));
    if (anchor.some((value) => !Number.isFinite(value) || Math.abs(value) > MAX_ABS_ANCHOR)) return null;
    const carrier = typeof source.carrier === 'string' ? source.carrier.trim().slice(0, MAX_CARRIER_LENGTH) : '';
    return { anchor, carrier: carrier || VEHICLE_PART_MOUNT_HULL };
}

export default {
    VEHICLE_PART_MOUNT_HULL,
    normalizeVehiclePartMount,
};

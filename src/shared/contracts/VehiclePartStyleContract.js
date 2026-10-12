// Per-vehicle look a player sets in the arcade hangar: keyed by the name of a top-level
// part, each entry may recolor it, scale it within limits or swap its shape for the part
// with the same role from another ship. Hitboxes never follow these changes.
import { normalizeVehiclePartMount, VEHICLE_PART_MOUNT_HULL } from './VehiclePartMountContract.js';

export const VEHICLE_PART_STYLE_SCALE_RANGE = Object.freeze({ min: 0.8, max: 1.25 });
const MAX_STYLED_PARTS = 48;
const MAX_KEY_LENGTH = 80;
const NON_SWAPPABLE_ROLES = new Set(['core']);

function normalizeColor(value) {
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return Number.parseInt(value.slice(1), 16);
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 0xffffff ? numeric : null;
}

function normalizeEntry(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const entry = {};
    const color = raw.color === undefined ? null : normalizeColor(raw.color);
    if (color !== null) entry.color = color;
    const scale = Number(raw.scale);
    if (Number.isFinite(scale) && scale !== 1) {
        entry.scale = Math.max(VEHICLE_PART_STYLE_SCALE_RANGE.min, Math.min(VEHICLE_PART_STYLE_SCALE_RANGE.max, scale));
    }
    const variant = String(raw.variant || '').trim().slice(0, MAX_KEY_LENGTH);
    if (variant) entry.variant = variant;
    return Object.keys(entry).length > 0 ? entry : null;
}

/**
 * @param {unknown} raw
 * @returns {Record<string, {color?: number, scale?: number, variant?: string}>}
 */
export function normalizeVehiclePartStyle(raw) {
    /** @type {Record<string, {color?: number, scale?: number, variant?: string}>} */
    const style = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return style;
    for (const [key, value] of Object.entries(raw)) {
        const name = String(key || '').trim().slice(0, MAX_KEY_LENGTH);
        const entry = name ? normalizeEntry(value) : null;
        if (!entry) continue;
        style[name] = entry;
        if (Object.keys(style).length >= MAX_STYLED_PARTS) break;
    }
    return style;
}

const DEG = Math.PI / 180;

// Half extents of each lab geometry in its own frame (see ModularVehicleMesh).
function halfExtents(part) {
    const s = Array.isArray(part.size) ? part.size.map((value) => Math.abs(Number(value) || 0)) : [1, 1, 1];
    const radius = Math.max(s[0] || 0, s[1] || 0);
    switch (part.geo) {
        case 'sphere': return [s[0], s[0], s[0]];
        case 'cone': return [s[0], s[1] / 2, s[0]];
        case 'cylinder':
        case 'pylon': return [radius, (s[2] ?? 1) / 2, radius];
        case 'torus': return [s[0] + s[1], s[0] + s[1], s[1]];
        case 'capsule': return [s[0], s[1] / 2 + s[0], s[0]];
        case 'engine': return [radius, radius, (s[2] ?? 0.5) * 0.65];
        case 'flame':
        case 'forcefield': return [radius, radius, (s[2] ?? 0.5) / 2];
        default: return [(s[0] ?? 1) / 2, (s[1] ?? 1) / 2, (s[2] ?? 1) / 2];
    }
}

// Rotation matrix for Three.js Euler order XYZ, rows as arrays.
function rotationMatrix(rot = [0, 0, 0]) {
    const [a, b, c] = [0, 1, 2].map((axis) => (Number(rot?.[axis]) || 0) * DEG);
    const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
    return [
        [cb * cc, -cb * sc, sb],
        [ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb],
        [sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb],
    ];
}

function multiply(m, n) {
    return m.map((row) => [0, 1, 2].map((col) => row[0] * n[0][col] + row[1] * n[1][col] + row[2] * n[2][col]));
}

function apply(m, v) {
    return m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
}

const IDENTITY = Object.freeze([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
const MIRROR_MATRICES = Object.freeze({
    x: [[-1, 0, 0], [0, 1, 0], [0, 0, 1]],
    y: [[1, 0, 0], [0, -1, 0], [0, 0, 1]],
    z: [[1, 0, 0], [0, 1, 0], [0, 0, -1]],
});

/**
 * Axis a part is mirrored on, or null. A mirrored part is drawn a second time, reflected in
 * its parent's frame (see VehicleLabConfigContract: `mirror: true` means the x axis).
 * @param {any} part
 * @returns {'x'|'y'|'z'|null}
 */
export function resolveVehiclePartMirrorAxis(part) {
    const axis = part?.mirrorAxis || (part?.mirror === true ? 'x' : null);
    return axis === 'x' || axis === 'y' || axis === 'z' ? axis : null;
}

function collectOrientedBounds(part, parentMatrix, parentOffset, bounds, options = {}, mirrored = false) {
    if (options.ignoreGeos?.includes(part.geo)) return bounds;
    const mirrorAxis = resolveVehiclePartMirrorAxis(part);
    if (options.includeMirrors && !mirrored && mirrorAxis) {
        collectOrientedBounds(part, multiply(parentMatrix, MIRROR_MATRICES[mirrorAxis]), parentOffset, bounds, options, true);
    }
    const scale = Array.isArray(part.scale) ? part.scale.map((value) => Number(value) || 1) : [1, 1, 1];
    const pos = apply(parentMatrix, Array.isArray(part.pos) ? part.pos.map((value) => Number(value) || 0) : [0, 0, 0]);
    const offset = [0, 1, 2].map((axis) => parentOffset[axis] + pos[axis]);
    const matrix = multiply(parentMatrix, multiply(rotationMatrix(part.rot), [[scale[0], 0, 0], [0, scale[1], 0], [0, 0, scale[2]]]));
    const half = halfExtents(part);
    const primitive = options.collectPrimitive ? { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] } : null;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        const corner = apply(matrix, [sx * half[0], sy * half[1], sz * half[2]]);
        for (const axis of [0, 1, 2]) {
            bounds.min[axis] = Math.min(bounds.min[axis], offset[axis] + corner[axis]);
            bounds.max[axis] = Math.max(bounds.max[axis], offset[axis] + corner[axis]);
            if (primitive) {
                primitive.min[axis] = Math.min(primitive.min[axis], offset[axis] + corner[axis]);
                primitive.max[axis] = Math.max(primitive.max[axis], offset[axis] + corner[axis]);
            }
        }
    }
    if (primitive) options.collectPrimitive(primitive, part, { matrix, offset, half });
    for (const child of Array.isArray(part.children) ? part.children : []) {
        if (child && typeof child === 'object') collectOrientedBounds(child, matrix, offset, bounds, options);
    }
    return bounds;
}

/** Bounds of every visible primitive in vehicle space, with parent transforms and mirrors. */
export function listVehiclePrimitiveBounds(parts, options = {}) {
    const result = [];
    for (const part of Array.isArray(parts) ? parts : []) {
        if (!part || typeof part !== 'object') continue;
        collectOrientedBounds(part, IDENTITY, [0, 0, 0], {
            min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity],
        }, { ...options, includeMirrors: true, collectPrimitive: (bounds, source, frame) => result.push(
            options.includeFrames ? { ...bounds, ...frame, geo: source.geo, size: source.size } : bounds
        ) });
    }
    return result;
}

/**
 * Axis-aligned bounds of one top-level part with its children, rotation and scale
 * included, in vehicle space. Mirrored copies only count with `includeMirrors`;
 * parts (and their children) whose geo is in `ignoreGeos` are skipped. `mirrorHalf`
 * measures one half of a mirrored part alone: 'own' as authored, 'copy' its reflection
 * (mirrored children inside that half still count with `includeMirrors`).
 * @param {object} part
 * @param {{includeMirrors?: boolean, ignoreGeos?: ReadonlyArray<string>, mirrorHalf?: 'own'|'copy'}} [options]
 * @returns {{min: number[], max: number[], size: number[], center: number[]}}
 */
export function measureVehiclePartBounds(part, options = {}) {
    const opts = options || {};
    const source = part || {};
    const halfAxis = opts.mirrorHalf ? resolveVehiclePartMirrorAxis(source) : null;
    const frame = halfAxis && opts.mirrorHalf === 'copy' ? MIRROR_MATRICES[halfAxis] : IDENTITY;
    const { min, max } = collectOrientedBounds(source, frame, [0, 0, 0], {
        min: [Infinity, Infinity, Infinity],
        max: [-Infinity, -Infinity, -Infinity],
    }, opts, halfAxis !== null);
    if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], center: [0, 0, 0] };
    return {
        min,
        max,
        size: [0, 1, 2].map((axis) => max[axis] - min[axis]),
        center: [0, 1, 2].map((axis) => (max[axis] + min[axis]) / 2),
    };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function findDonorPart(donors, donorId, role) {
    const donor = (Array.isArray(donors) ? donors : []).find((entry) => entry?.id === donorId);
    return donor?.parts?.find((part) => part?.role === role) || null;
}

function prefixChildNames(children, prefix) {
    return (children || []).map((child) => ({
        ...child,
        name: `${prefix} · ${child.name}`,
        ...(child.children ? { children: prefixChildNames(child.children, prefix) } : {}),
    }));
}

// The donor shape takes the name, role and footprint of the old part: scaled evenly until
// it fits the old part's two largest extents (rotation included, otherwise a Manta wing
// would dwarf a Pfeil) and centered where the old part sat.
function swapShape(part, donorPart) {
    const donor = clone(donorPart);
    const target = measureVehiclePartBounds(part);
    const source = measureVehiclePartBounds({ ...donor, pos: [0, 0, 0] });
    const axes = [0, 1, 2].sort((a, b) => target.size[b] - target.size[a]).slice(0, 2);
    const ratios = axes.filter((axis) => source.size[axis] > 1e-6).map((axis) => target.size[axis] / source.size[axis]);
    const fit = ratios.length > 0 ? Math.min(...ratios) : 1;
    const swapped = {
        ...donor,
        name: part.name,
        role: part.role,
        pos: [0, 1, 2].map((axis) => target.center[axis] - source.center[axis] * fit),
        scale: (donor.scale || [1, 1, 1]).map((value) => value * fit),
    };
    delete swapped.mirror;
    delete swapped.mirrorAxis;
    // The new shape hangs where the old part did, not where the donor part hung on its own ship.
    if (part.mount) swapped.mount = part.mount;
    else delete swapped.mount;
    if (donor.children) swapped.children = prefixChildNames(donor.children, part.name);
    return swapped;
}

const HULL_MEASURE = Object.freeze({ includeMirrors: true, ignoreGeos: Object.freeze(['flame', 'forcefield']) });
const HULL_EPSILON = 1e-6;

/**
 * Pivot of a utility part built into the hull once the hull (role 'core') is drawn at `coreScale`.
 * Its pivot lies inside the hull's bounds, so it is a point of the hull: the hull grows around its
 * own pivot and carries it along, and a larger hull no longer swallows the part (Manta tail hump) nor
 * a smaller one leaves it hanging past the deck edge (spaceship deck module). The part still grows
 * around that pivot with its own size. A utility part standing on the hull or on another part
 * (Star-Cruiser deck, Helix fin on its reactor spine) and every other part keep their pivot.
 * @param {any} part
 * @param {any} core
 * @param {unknown} coreScale
 * @returns {number[]|null} the new pivot, or null when the part stays where it is
 */
export function resolveHullMountedPivot(part, core, coreScale) {
    const scale = Number(coreScale);
    if (part?.role !== 'utility' || !core || !Number.isFinite(scale) || scale <= 0 || scale === 1) return null;
    const pivot = [0, 1, 2].map((axis) => Number(part.pos?.[axis]) || 0);
    const hull = measureVehiclePartBounds(core, HULL_MEASURE);
    if (pivot.some((value, axis) => value < hull.min[axis] - HULL_EPSILON || value > hull.max[axis] + HULL_EPSILON)) return null;
    return pivot.map((value, axis) => {
        const origin = Number(core.pos?.[axis]) || 0;
        return origin + (value - origin) * scale;
    });
}

const pointOf = (/** @type {any} */ value) => [0, 1, 2].map((axis) => Number(value?.[axis]) || 0);

/**
 * @typedef {object} VehiclePartPlacement
 * Moves a top-level part: every point p of it is drawn at target + factor * (p - origin).
 * @property {number[]} origin
 * @property {number[]} target
 * @property {number} factor
 * @property {boolean} mounted  true when the part follows its mount from the ship data
 */

/**
 * Where each top-level part is drawn once each is scaled by its factor (`factors` by part name,
 * missing = 1). A part with a mount (VehiclePartMountContract) grows away from its anchor, and the
 * anchor moves with its carrier: the hull (role 'core') grows around its own pivot, a carrier part
 * moves the way its own placement says. A mirrored carrier carries an anchor on its other side with
 * its mirrored half. A part without a usable mount (unknown carrier, mount loop, no mount at all)
 * grows around its pivot as before; a utility part built into the hull still rides on it
 * (resolveHullMountedPivot). Drawn ship and arcade hit zone both read this.
 * @param {ReadonlyArray<any>} parts
 * @param {Record<string, number>} factors
 * @returns {VehiclePartPlacement[]}
 */
export function resolveVehiclePartPlacements(parts, factors) {
    const list = Array.isArray(parts) ? parts : [];
    const factorOf = (/** @type {any} */ part) => {
        const factor = Number(factors?.[String(part?.name || '')]);
        return Number.isFinite(factor) && factor > 0 ? factor : 1;
    };
    const coreIndex = list.findIndex((part) => part?.role === 'core');
    const core = coreIndex >= 0 ? list[coreIndex] : null;
    /** @type {Array<VehiclePartPlacement|undefined>} */
    const placements = list.map(() => undefined);
    const visiting = new Set();
    const legacy = (/** @type {number} */ index) => {
        const part = list[index];
        const origin = pointOf(part?.pos);
        const pivot = resolveHullMountedPivot(part, core, factorOf(core));
        return { origin, target: pivot || origin, factor: factorOf(part), mounted: false };
    };
    /** @param {number} index @returns {VehiclePartPlacement} */
    const resolve = (index) => {
        const known = placements[index];
        if (known) return known;
        if (visiting.has(index)) return (placements[index] = legacy(index));
        const part = list[index];
        const mount = index === coreIndex ? null : normalizeVehiclePartMount(part?.mount);
        const carrierIndex = !mount ? -1 : mount.carrier === VEHICLE_PART_MOUNT_HULL
            ? coreIndex
            : list.findIndex((entry) => entry?.name === mount.carrier);
        if (!mount || carrierIndex < 0 || carrierIndex === index) return (placements[index] = legacy(index));
        visiting.add(index);
        let carrier = resolve(carrierIndex);
        visiting.delete(index);
        if (placements[index]) return /** @type {VehiclePartPlacement} */ (placements[index]);
        const carrierPart = list[carrierIndex];
        const axis = resolveVehiclePartMirrorAxis(carrierPart);
        if (axis) {
            const k = 'xyz'.indexOf(axis);
            if (mount.anchor[k] * (Number(carrierPart.pos?.[k]) || 0) < 0) {
                const reflect = (/** @type {number[]} */ point) => point.map((value, i) => (i === k ? -value : value));
                carrier = { ...carrier, origin: reflect(carrier.origin), target: reflect(carrier.target) };
            }
        }
        const target = mount.anchor.map((value, i) => carrier.target[i] + (value - carrier.origin[i]) * carrier.factor);
        return (placements[index] = { origin: mount.anchor, target, factor: factorOf(part), mounted: true });
    };
    return list.map((_, index) => resolve(index));
}

/**
 * The part moved and scaled by its placement (the same object when nothing changes).
 * @template {Record<string, any>} T
 * @param {T} part
 * @param {VehiclePartPlacement} placement
 * @returns {T}
 */
export function placeVehiclePart(part, placement) {
    const { origin, target, factor } = placement;
    const pos = pointOf(part?.pos).map((value, axis) => target[axis] + (value - origin[axis]) * factor);
    const moved = pos.some((value, axis) => Math.abs(value - (Number(part?.pos?.[axis]) || 0)) > 1e-12);
    if (factor === 1 && !moved) return part;
    return {
        ...part,
        ...(moved ? { pos } : {}),
        ...(factor === 1 ? {} : { scale: [0, 1, 2].map((axis) => (Array.isArray(part.scale) ? Number(part.scale[axis]) || 1 : 1) * factor) }),
    };
}

/**
 * Returns a styled copy of a Vehicle Lab config; the input stays untouched.
 * @param {{parts?: object[]}} config
 * @param {unknown} style
 * @param {Array<{id: string, parts: object[]}>} [donors]
 */
export function applyVehiclePartStyle(config, style, donors = []) {
    const styled = clone(config || {});
    const entries = normalizeVehiclePartStyle(style);
    /** @type {Record<string, number>} */
    const factors = {};
    for (const [name, entry] of Object.entries(entries)) if (entry.scale) factors[name] = entry.scale;
    const placements = resolveVehiclePartPlacements(styled.parts, factors);
    styled.parts = (styled.parts || []).map((part, index) => {
        const placement = placements[index];
        const entry = entries[part?.name];
        const donorPart = entry?.variant && part?.role && !NON_SWAPPABLE_ROLES.has(part.role)
            ? findDonorPart(donors, entry.variant, part.role)
            : null;
        let next = part;
        if (placement.mounted) {
            // The donor shape takes the factory place first, then follows the mount like the old part.
            next = placeVehiclePart(donorPart ? swapShape(part, donorPart) : part, placement);
        } else if (donorPart) {
            next = swapShape({ ...part, pos: placement.target }, donorPart);
            if (entry?.scale) next = { ...next, scale: (next.scale || [1, 1, 1]).map((value) => value * entry.scale) };
        } else {
            next = placeVehiclePart(part, placement);
        }
        if (entry?.color !== undefined) next = { ...next, color: entry.color };
        return next;
    });
    return styled;
}

/**
 * Other ships whose part with the same role can replace this part's shape.
 * @param {{id?: string, parts?: object[]}} config
 * @param {string} partName
 * @param {Array<{id: string, label?: string, parts: object[]}>} donors
 * @returns {Array<{id: string, label: string}>}
 */
export function listVehiclePartVariants(config, partName, donors = []) {
    const part = (config?.parts || []).find((entry) => entry?.name === partName);
    if (!part?.role || NON_SWAPPABLE_ROLES.has(part.role)) return [];
    return (Array.isArray(donors) ? donors : [])
        .filter((donor) => donor?.id && donor.id !== config.id && findDonorPart([donor], donor.id, part.role))
        .map((donor) => ({ id: donor.id, label: String(donor.label || donor.id) }));
}

// Per-vehicle look a player sets in the arcade hangar: keyed by the name of a top-level
// part, each entry may recolor it, scale it within limits or swap its shape for the part
// with the same role from another ship. Hitboxes never follow these changes.
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

function collectOrientedBounds(part, parentMatrix, parentOffset, bounds) {
    const scale = Array.isArray(part.scale) ? part.scale.map((value) => Number(value) || 1) : [1, 1, 1];
    const pos = apply(parentMatrix, Array.isArray(part.pos) ? part.pos.map((value) => Number(value) || 0) : [0, 0, 0]);
    const offset = [0, 1, 2].map((axis) => parentOffset[axis] + pos[axis]);
    const matrix = multiply(parentMatrix, multiply(rotationMatrix(part.rot), [[scale[0], 0, 0], [0, scale[1], 0], [0, 0, scale[2]]]));
    const half = halfExtents(part);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        const corner = apply(matrix, [sx * half[0], sy * half[1], sz * half[2]]);
        for (const axis of [0, 1, 2]) {
            bounds.min[axis] = Math.min(bounds.min[axis], offset[axis] + corner[axis]);
            bounds.max[axis] = Math.max(bounds.max[axis], offset[axis] + corner[axis]);
        }
    }
    for (const child of Array.isArray(part.children) ? part.children : []) {
        if (child && typeof child === 'object') collectOrientedBounds(child, matrix, offset, bounds);
    }
    return bounds;
}

/**
 * Axis-aligned bounds of one top-level part with its children, rotation and scale
 * included, in vehicle space.
 * @param {object} part
 * @returns {{min: number[], max: number[], size: number[], center: number[]}}
 */
export function measureVehiclePartBounds(part) {
    const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const { min, max } = collectOrientedBounds(part || {}, identity, [0, 0, 0], {
        min: [Infinity, Infinity, Infinity],
        max: [-Infinity, -Infinity, -Infinity],
    });
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
    if (donor.children) swapped.children = prefixChildNames(donor.children, part.name);
    return swapped;
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
    styled.parts = (styled.parts || []).map((part) => {
        const entry = entries[part?.name];
        if (!entry) return part;
        let next = part;
        if (entry.variant && part.role && !NON_SWAPPABLE_ROLES.has(part.role)) {
            const donorPart = findDonorPart(donors, entry.variant, part.role);
            if (donorPart) next = swapShape(part, donorPart);
        }
        if (entry.scale) next = { ...next, scale: (next.scale || [1, 1, 1]).map((value) => value * entry.scale) };
        if (entry.color !== undefined) next = { ...next, color: entry.color };
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

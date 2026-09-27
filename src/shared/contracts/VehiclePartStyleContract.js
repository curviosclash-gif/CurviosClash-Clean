import { estimateVehicleLabPartExtent } from './VehicleLabConfigContract.js';

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

// The donor shape takes the place, name and role of the old part and is scaled so its
// longest extent matches the old part; otherwise a Manta wing would dwarf a Pfeil.
function swapShape(part, donorPart) {
    const donor = clone(donorPart);
    const targetExtent = estimateVehicleLabPartExtent(part);
    const donorExtent = estimateVehicleLabPartExtent(donor);
    const fit = targetExtent > 0 && donorExtent > 0 ? targetExtent / donorExtent : 1;
    const swapped = {
        ...donor,
        name: part.name,
        role: part.role,
        pos: part.pos ? [...part.pos] : [0, 0, 0],
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

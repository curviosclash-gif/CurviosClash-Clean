// ============================================
// ArcadeVehicleSizeContract.js - functional part sizes of Arcade vehicles (Paket 2)
// Five size groups (hull, nose, wings, engines, utility) in whole percent,
// 80..125 in 5 % steps. The same factor drives visuals and the Arcade hitbox.
// Pure data + functions - no imports from core/ui/state.
// ============================================

export const ARCADE_PART_SIZE_GROUPS = Object.freeze(['hull', 'nose', 'wings', 'engines', 'utility']);
export const ARCADE_PART_SIZE_MIN_PCT = 80;
export const ARCADE_PART_SIZE_MAX_PCT = 125;
export const ARCADE_PART_SIZE_STEP_PCT = 5;
export const ARCADE_PART_SIZE_DEFAULT_PCT = 100;

// Vehicle Lab part roles -> size group. Wings and engines are pairs and always share one size.
const ROLE_TO_SIZE_GROUP = Object.freeze({
    core: 'hull',
    nose: 'nose',
    wing_left: 'wings',
    wing_right: 'wings',
    engine_left: 'engines',
    engine_right: 'engines',
    utility: 'utility',
});

/**
 * @param {unknown} role
 * @returns {string|null}
 */
export function resolveArcadeSizeGroupForRole(role) {
    return ROLE_TO_SIZE_GROUP[String(role || '')] || null;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeSizePct(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return ARCADE_PART_SIZE_DEFAULT_PCT;
    const snapped = Math.round(numeric / ARCADE_PART_SIZE_STEP_PCT) * ARCADE_PART_SIZE_STEP_PCT;
    return Math.min(ARCADE_PART_SIZE_MAX_PCT, Math.max(ARCADE_PART_SIZE_MIN_PCT, snapped));
}

/**
 * Normalized size map {hull, nose, wings, engines, utility} in whole percent.
 * @param {unknown} source
 * @returns {Record<string, number>}
 */
export function normalizeArcadePartSizes(source) {
    const input = source && typeof source === 'object' ? /** @type {Record<string, unknown>} */ (source) : {};
    /** @type {Record<string, number>} */
    const sizes = {};
    for (const group of ARCADE_PART_SIZE_GROUPS) sizes[group] = normalizeSizePct(input[group]);
    return sizes;
}

/**
 * Scale factor per part name (1 = factory size) for every part of a Vehicle Lab
 * part list, including nested children. Parts without a size role keep factor 1.
 * Visuals (Paket 2a) and the Arcade hitbox (Paket 2b) both read this function.
 * @param {ReadonlyArray<any>} parts
 * @param {unknown} partSizes
 * @returns {Record<string, number>}
 */
export function resolveArcadePartSizeFactors(parts, partSizes) {
    const sizes = normalizeArcadePartSizes(partSizes);
    /** @type {Record<string, number>} */
    const factors = {};
    const visit = (/** @type {ReadonlyArray<any>} */ list) => {
        for (const part of Array.isArray(list) ? list : []) {
            if (!part || typeof part !== 'object') continue;
            const group = resolveArcadeSizeGroupForRole(part.role);
            const name = String(part.name || '');
            if (name && group) factors[name] = sizes[group] / 100;
            visit(part.children);
        }
    };
    visit(parts);
    return factors;
}

export default {
    ARCADE_PART_SIZE_GROUPS,
    ARCADE_PART_SIZE_MIN_PCT,
    ARCADE_PART_SIZE_MAX_PCT,
    ARCADE_PART_SIZE_STEP_PCT,
    ARCADE_PART_SIZE_DEFAULT_PCT,
    resolveArcadeSizeGroupForRole,
    normalizeArcadePartSizes,
    resolveArcadePartSizeFactors,
};

export const HUNT_PARCOURS_RUN_TYPE = 'hunt_parcours';
export const HUNT_PARCOURS_COMBAT_PROFILE = 'hunt';
export const HUNT_PARCOURS_WORLD_ID = 'jagdgruende';

export const HUNT_PARCOURS_PATHS = Object.freeze({
    ENTRY: 'entry',
    HETZEN: 'hetzen',
    STUERMEN: 'stuermen',
    GRENZLAND_ELEMENTS: 'grenzland_elements',
});

export const HUNT_PARCOURS_MEDAL_THRESHOLDS = Object.freeze({
    bronze: 0.5,
    silver: 0.7,
    gold: 0.9,
});

const MEDAL_RANK = Object.freeze({ bronze: 1, silver: 2, gold: 3 });

// raceWeight steers the race-hunt bot: 0 = only hunt, 1 = only fly the rings.
// roundSeconds 0 means the stage ends by its own goal (finish line, catch, all gates).
// Reference scores are first estimates; they move once real runs are measured.
const VARIANTS = Object.freeze([
    Object.freeze({
        id: 'nemesis', label: 'Nemesis', path: HUNT_PARCOURS_PATHS.ENTRY, unlockAfter: '',
        mapKeys: Object.freeze(['mirror_docks', 'glass_serpent', 'wind_cathedral']),
        botCount: 1, raceWeight: 0.6, roundSeconds: 0, seed: 130101, referenceScore: 3600,
    }),
    Object.freeze({
        id: 'thunderflight', label: 'Gewitterflug', path: HUNT_PARCOURS_PATHS.GRENZLAND_ELEMENTS, unlockAfter: 'nemesis',
        mapKeys: Object.freeze(['sky_islands', 'spiral_tower', 'abyssal_descent']),
        botCount: 4, raceWeight: 1, roundSeconds: 0, seed: 130909, referenceScore: 4800,
    }),
    Object.freeze({
        id: 'fox_hunt', label: 'Fuchsjagd', path: HUNT_PARCOURS_PATHS.HETZEN, unlockAfter: 'nemesis',
        mapKeys: Object.freeze(['neon_carnival', 'kinetic_tide', 'orbital_shipyard']),
        botCount: 4, raceWeight: 0.2, roundSeconds: 300, seed: 130202, referenceScore: 4200,
    }),
    Object.freeze({
        id: 'trail_scent', label: 'Fährte', path: HUNT_PARCOURS_PATHS.HETZEN, unlockAfter: 'fox_hunt',
        mapKeys: Object.freeze(['giant_forest', 'crystal_ruins', 'clockwork_canyon']),
        botCount: 1, raceWeight: 1, roundSeconds: 150, seed: 130303, referenceScore: 5400,
    }),
    Object.freeze({
        id: 'herd_drive', label: 'Treibjagd', path: HUNT_PARCOURS_PATHS.HETZEN, unlockAfter: 'trail_scent',
        mapKeys: Object.freeze(['sunflower_meadow', 'cherry_grove', 'dandelion_sky']),
        botCount: 2, raceWeight: 0, roundSeconds: 180, seed: 130404, referenceScore: 6000,
    }),
    Object.freeze({
        id: 'fire_front', label: 'Feuerwalze', path: HUNT_PARCOURS_PATHS.STUERMEN, unlockAfter: 'nemesis',
        mapKeys: Object.freeze(['notre_dame', 'burg_falkenwacht', 'eiffel_tower']),
        botCount: 3, raceWeight: 0, roundSeconds: 0, seed: 130505, referenceScore: 4500,
    }),
    Object.freeze({
        id: 'beacon_hold', label: 'Leuchtfeuer', path: HUNT_PARCOURS_PATHS.STUERMEN, unlockAfter: 'fire_front',
        mapKeys: Object.freeze(['eclipse_foundry', 'chrono_forge_nexus', 'aetherion_orrery']),
        botCount: 5, raceWeight: 0.5, roundSeconds: 240, seed: 130606, referenceScore: 4800,
    }),
    Object.freeze({
        id: 'guided_breach', label: 'Lenkflug', path: HUNT_PARCOURS_PATHS.STUERMEN, unlockAfter: 'beacon_hold',
        mapKeys: Object.freeze(['storm_switchyard', 'chrono_spillway', 'vulkan_odyssey']),
        botCount: 3, raceWeight: 0, roundSeconds: 0, seed: 130707, referenceScore: 4500,
    }),
]);

/** @type {Map<string, (typeof VARIANTS)[number]>} */
const VARIANT_BY_ID = new Map(VARIANTS.map((variant) => [variant.id, variant]));

/** @returns {readonly object[]} */
export function listHuntParcoursVariants() {
    return VARIANTS;
}

/** @param {unknown} value */
export function normalizeHuntParcoursVariantId(value) {
    const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return VARIANT_BY_ID.has(id) ? id : '';
}

/** @param {unknown} value */
export function resolveHuntParcoursVariant(value) {
    return VARIANT_BY_ID.get(normalizeHuntParcoursVariantId(value)) || null;
}

/** @param {unknown} runType */
export function isHuntParcoursRunType(runType) {
    return typeof runType === 'string' && runType.trim().toLowerCase() === HUNT_PARCOURS_RUN_TYPE;
}

/** @param {any} runtimeConfig */
export function isHuntParcoursConfig(runtimeConfig = null) {
    return runtimeConfig?.arcade?.enabled === true && isHuntParcoursRunType(runtimeConfig?.arcade?.runType);
}

/**
 * @param {unknown} variantId
 * @param {Record<string, string>} medalsByVariant best medal per variant id ('' | bronze | silver | gold)
 */
export function isHuntParcoursVariantUnlocked(variantId, medalsByVariant = {}) {
    const variant = resolveHuntParcoursVariant(variantId);
    if (!variant) return false;
    if (!variant.unlockAfter) return true;
    const medal = medalsByVariant?.[variant.unlockAfter];
    return (MEDAL_RANK[/** @type {keyof typeof MEDAL_RANK} */ (medal)] || 0) >= MEDAL_RANK.bronze;
}

/**
 * @param {unknown} variantId
 * @param {unknown} score
 * @returns {'' | 'bronze' | 'silver' | 'gold'}
 */
export function resolveHuntParcoursMedal(variantId, score, { succeeded = false } = {}) {
    const variant = resolveHuntParcoursVariant(variantId);
    const value = Number(score);
    if (!variant || !Number.isFinite(value) || !(variant.referenceScore > 0)) return '';
    const ratio = value / variant.referenceScore;
    if (ratio >= HUNT_PARCOURS_MEDAL_THRESHOLDS.gold) return 'gold';
    if (ratio >= HUNT_PARCOURS_MEDAL_THRESHOLDS.silver) return 'silver';
    if (ratio >= HUNT_PARCOURS_MEDAL_THRESHOLDS.bronze || (variant.id === 'fox_hunt' && succeeded === true)) return 'bronze';
    return '';
}

// ─── Arcade Map Progression: Multi-Map Sequencing per Arcade Run ───
// Note: This module is now decoupled from MapPresetCatalog via dependency injection.
// Consumers must provide mapCatalog as a parameter to resolveMapSequence().

export const SECTOR_MAP_POOLS = Object.freeze({
    sector_intro: Object.freeze(['standard', 'foam_forest', 'crossfire']),
    sector_pressure: Object.freeze(['maze', 'vertical_maze', 'trench', 'neon_abyss']),
    sector_hazard: Object.freeze(['complex', 'pyramid', 'crystal_ruins']),
    sector_endurance: Object.freeze(['expert_gauntlet', 'portal_madness', 'crystal_ruins']),
    // 82.1.1: Parcours sector — uses parcours maps exclusively
    sector_parcours: Object.freeze([
        'parcours_rift',
        'parcours_rift_sprint',
        'parcours_rift_precision',
        'micro_maw',
        'mirror_docks',
        'glass_serpent',
        'storm_switchyard',
        'wind_cathedral',
        'chrono_spillway',
    ]),
});

import { createSeededRandom } from '../../shared/utils/ArcadeUtils.js';

const DEFAULT_MAP = 'standard';

function isValidMapKey(mapKey, mapCatalog) {
    return typeof mapKey === 'string' && mapKey in mapCatalog;
}

function pickValidMap(pool, randomFn, mapCatalog) {
    if (!Array.isArray(pool) || pool.length === 0) return DEFAULT_MAP;
    const validPool = pool.filter((key) => isValidMapKey(key, mapCatalog));
    if (validPool.length === 0) return DEFAULT_MAP;
    const index = Math.floor(randomFn() * validPool.length);
    return validPool[Math.max(0, Math.min(validPool.length - 1, index))];
}

/**
 * Resolves a map sequence from a sector plan.
 * Each sector gets a map picked from the template's map pool.
 * Avoids repeating the same map in consecutive sectors when possible.
 * @param {Object} sectorPlan - Sector plan with sequence array
 * @param {string} seed - Seed for randomization
 * @param {Object} mapCatalog - Map catalog for validation (injected dependency)
 */
export function resolveMapSequence(sectorPlan, seed, mapCatalog) {
    if (!sectorPlan || !Array.isArray(sectorPlan.sequence)) return [];
    const randomFn = createSeededRandom(`${seed}-mapseq`);
    const sequence = [];

    for (let i = 0; i < sectorPlan.sequence.length; i += 1) {
        const entry = sectorPlan.sequence[i];
        const templateId = String(entry?.templateId || 'sector_intro');
        const pool = SECTOR_MAP_POOLS[templateId] || SECTOR_MAP_POOLS.sector_intro;

        let mapKey = pickValidMap(pool, randomFn, mapCatalog);

        // Avoid consecutive duplicate maps when pool has alternatives
        if (i > 0 && mapKey === sequence[i - 1] && pool.length > 1) {
            const alternatives = pool.filter((k) => k !== mapKey && isValidMapKey(k, mapCatalog));
            if (alternatives.length > 0) {
                mapKey = alternatives[Math.floor(randomFn() * alternatives.length)];
            }
        }

        sequence.push(mapKey);
    }

    return sequence;
}

/**
 * Gets the map key for a given sector index from the run state.
 */
export function getMapKeyForSector(mapSequence, sectorIndex) {
    if (!Array.isArray(mapSequence) || mapSequence.length === 0) return DEFAULT_MAP;
    const idx = Math.max(0, Math.min(mapSequence.length - 1, Math.floor(sectorIndex)));
    return mapSequence[idx] || DEFAULT_MAP;
}

/**
 * Checks whether the next sector requires a map transition.
 */
export function needsMapTransition(mapSequence, currentSectorIndex) {
    if (!Array.isArray(mapSequence) || mapSequence.length === 0) return false;
    const currentIdx = Math.max(0, Math.floor(currentSectorIndex));
    const nextIdx = currentIdx + 1;
    if (nextIdx >= mapSequence.length) return false;
    return mapSequence[currentIdx] !== mapSequence[nextIdx];
}

export default {
    SECTOR_MAP_POOLS,
    resolveMapSequence,
    getMapKeyForSector,
    needsMapTransition,
};

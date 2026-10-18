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
        'aether_relay',
        'neon_carnival',
        'skyscraper_site',
    ]),
});

import { createSeededRandom } from '../../shared/utils/ArcadeUtils.js';
import { ARCADE_DAILY_PARCOURS_MAP_POOL } from '../../shared/contracts/ArcadeDailyRulesContract.js';
import { resolveMapDifficultyStage } from '../../shared/contracts/MapPickerMetaContract.js';
import { getMapPickerMeta } from '../../shared/maps/MapPickerMeta.js';

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
 * Parcours sectors form a campaign: the k-th of n parcours sectors of a run draws from the
 * difficulty stage (teaching, craft, mastery) that matches its place, so easier maps come first
 * and the last one is the hardest stage the pool offers. Chance only picks inside a stage, and a
 * map already played in this run is skipped while its stage has others.
 */
function pickParcoursMap(pool, randomFn, mapCatalog, { index, count, played, previous = '' }) {
    const validPool = Array.isArray(pool) ? pool.filter((key) => isValidMapKey(key, mapCatalog)) : [];
    if (validPool.length === 0) return DEFAULT_MAP;
    const stages = [];
    validPool.forEach((key) => {
        const stage = resolveMapDifficultyStage(getMapPickerMeta(key).difficulty);
        const bucket = stages.find((entry) => entry.stage === stage);
        if (bucket) bucket.maps.push(key);
        else stages.push({ stage, maps: [key] });
    });
    stages.sort((left, right) => left.stage.min - right.stage.min);
    const stageIndex = count > 1 ? Math.round((index * (stages.length - 1)) / (count - 1)) : 0;
    const maps = stages[Math.max(0, Math.min(stages.length - 1, stageIndex))].maps;
    const fresh = maps.filter((key) => !played.has(key));
    let candidates = fresh.length > 0 ? fresh : maps;
    if (candidates.length > 1) candidates = candidates.filter((key) => key !== previous);
    else if (candidates[0] === previous && validPool.some((key) => key !== previous)) {
        candidates = validPool.filter((key) => key !== previous && !played.has(key));
        if (!candidates.length) candidates = validPool.filter((key) => key !== previous);
    }
    return candidates[Math.max(0, Math.min(candidates.length - 1, Math.floor(randomFn() * candidates.length)))];
}
function resolveLockedMapKey(entry, mapCatalog) {
    if (entry?.mapKeyLocked !== true) return '';
    const mapKey = String(entry?.mapKey || '').trim();
    return isValidMapKey(mapKey, mapCatalog) ? mapKey : '';
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
    const parcoursCount = sectorPlan.sequence.filter((entry) => entry?.templateId === 'sector_parcours').length;
    const parcoursPlayed = new Set();
    let parcoursIndex = 0;

    for (let i = 0; i < sectorPlan.sequence.length; i += 1) {
        const entry = sectorPlan.sequence[i];
        const templateId = String(entry?.templateId || 'sector_intro');
        const pool = sectorPlan.dailyChallenge === true && templateId === 'sector_parcours'
            ? ARCADE_DAILY_PARCOURS_MAP_POOL
            : SECTOR_MAP_POOLS[templateId] || SECTOR_MAP_POOLS.sector_intro;

        const lockedMapKey = resolveLockedMapKey(entry, mapCatalog);
        const isParcours = templateId === 'sector_parcours';
        let mapKey = lockedMapKey || (isParcours
            ? pickParcoursMap(pool, randomFn, mapCatalog, { index: parcoursIndex, count: parcoursCount, played: parcoursPlayed,
                previous: sectorPlan.dailyChallenge === true ? '' : sequence[i - 1] || '' })
            : pickValidMap(pool, randomFn, mapCatalog));
        if (isParcours) {
            parcoursIndex += 1;
        }

        // A fixed encounter in the next sector cannot move. Prefer a different flexible map now.
        const nextLocked = sectorPlan.dailyChallenge === true ? ''
            : resolveLockedMapKey(sectorPlan.sequence[i + 1], mapCatalog);
        if (!lockedMapKey && !(sectorPlan.dailyChallenge === true && isParcours)
            && (mapKey === sequence[i - 1] || (nextLocked && mapKey === nextLocked))) {
            const alternatives = pool.filter((key) => key !== mapKey && key !== sequence[i - 1]
                && key !== nextLocked && isValidMapKey(key, mapCatalog));
            if (alternatives.length > 0) {
                mapKey = alternatives[Math.floor(randomFn() * alternatives.length)];
            }
        }
        if (isParcours) parcoursPlayed.add(mapKey);

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

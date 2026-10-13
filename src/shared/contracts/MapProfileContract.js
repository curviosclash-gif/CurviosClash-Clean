// Map profile ("Steckbrief"): what a player wants to know about a map before choosing it, derived
// from the map definition and the resolved map balancing. Pure and text-free: the contract hands
// out codes and numbers, the menu turns them into words.
import {
    resolveMapPortalEntryCount,
    resolvePortalMode,
    resolvePortalPairCount,
} from './PortalAuthoringContract.js';

export const MAP_PROFILE_CONTRACT_VERSION = 'map-profile.v1';

export const MAP_PROFILE_SIZE_CLASSES = Object.freeze({
    SMALL: 'small',
    MEDIUM: 'medium',
    LARGE: 'large',
});

// Floor area (width x depth) in map units. Of the 75 maps the picker offers, 23 fall below the
// first line, 23 reach the second and 29 sit between them (measured over the preset catalog).
export const MAP_PROFILE_SMALL_FOOTPRINT_BELOW = 15000;
export const MAP_PROFILE_LARGE_FOOTPRINT_FROM = 60000;

// The default arena a map without a readable size is treated as.
const FALLBACK_EXTENT = 80;

export const MAP_PROFILE_FEATURES = Object.freeze({
    PORTALS: 'portals',
    PARCOURS: 'parcours',
    LEVELS: 'levels',
    DESTRUCTIBLE: 'destructible',
    SANDSTORM: 'sandstorm',
    FOG: 'fog',
});

// Pilots = the human plus bots. Rough guidance per size class, narrowed by the bot limit.
const PILOTS_BY_SIZE = Object.freeze({
    small: Object.freeze({ min: 2, max: 4 }),
    medium: Object.freeze({ min: 4, max: 6 }),
    large: Object.freeze({ min: 6, max: 9 }),
});

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value @returns {number} */
function extentOrFallback(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : FALLBACK_EXTENT;
}

/**
 * Size of the floor area in map units, read from the map's `size` ([width, height, depth]).
 * @param {unknown} size
 * @returns {Readonly<{ code: string, width: number, depth: number, footprint: number }>}
 */
export function resolveMapFootprint(size) {
    const list = Array.isArray(size) ? size : [];
    const width = extentOrFallback(list[0]);
    const depth = extentOrFallback(list[2]);
    const footprint = width * depth;
    /** @type {string} */
    let code = MAP_PROFILE_SIZE_CLASSES.MEDIUM;
    if (footprint < MAP_PROFILE_SMALL_FOOTPRINT_BELOW) code = MAP_PROFILE_SIZE_CLASSES.SMALL;
    else if (footprint >= MAP_PROFILE_LARGE_FOOTPRINT_FROM) code = MAP_PROFILE_SIZE_CLASSES.LARGE;
    return Object.freeze({ code, width, depth, footprint });
}

/** @param {unknown} size @returns {string} 'small' | 'medium' | 'large' */
export function classifyMapSize(size) {
    return resolveMapFootprint(size).code;
}

/**
 * Bot range from resolved map balancing; null when the balancing does not carry a usable maximum.
 * @param {unknown} balancing
 * @returns {Readonly<{ min: number, max: number }> | null}
 */
function readBotRange(balancing) {
    const values = isRecord(balancing) && isRecord(balancing.values) ? balancing.values : null;
    if (!values || typeof values.botCountMax !== 'number' || !Number.isFinite(values.botCountMax)) return null;
    const max = Math.max(0, Math.floor(values.botCountMax));
    const rawMin = typeof values.botCountMin === 'number' && Number.isFinite(values.botCountMin) ? values.botCountMin : 0;
    return Object.freeze({ min: Math.min(max, Math.max(0, Math.floor(rawMin))), max });
}

/**
 * @param {number} value @param {number} low @param {number} high
 * @returns {number}
 */
function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
}

/**
 * @param {string} sizeCode
 * @param {Readonly<{ min: number, max: number }> | null} bots
 * @returns {Readonly<{ min: number, max: number }>}
 */
function recommendPilots(sizeCode, bots) {
    const base = PILOTS_BY_SIZE[/** @type {keyof typeof PILOTS_BY_SIZE} */ (sizeCode)] || PILOTS_BY_SIZE.medium;
    if (!bots) return base;
    const low = clamp(base.min, bots.min + 1, bots.max + 1);
    return Object.freeze({ min: low, max: clamp(base.max, low, bots.max + 1) });
}

/**
 * @param {Record<string, any>} map
 * @param {{ portalsEnabled?: unknown }} values
 * @returns {number} portal pairs the match builds on this map
 */
function countPortalPairs(map, values) {
    if (values.portalsEnabled === false) return 0;
    const authoredPairs = Array.isArray(map.portals) ? map.portals.length : 0;
    const portalMode = resolvePortalMode(map);
    if (portalMode === 'authored') return authoredPairs;
    const dynamicPairs = resolvePortalPairCount(resolveMapPortalEntryCount(map));
    return portalMode === 'hybrid' ? Math.max(authoredPairs, dynamicPairs) : dynamicPairs;
}

/**
 * @param {Record<string, any>} map
 * @param {string} gameMode upper case, '' when unknown
 * @returns {number} destructible segments in this game mode
 */
function countDestructibleSegments(map, gameMode) {
    const destructibles = map.destructibles;
    if (!isRecord(destructibles) || !Array.isArray(destructibles.segments)) return 0;
    const modes = Array.isArray(destructibles.gameModes)
        ? destructibles.gameModes.map((/** @type {unknown} */ mode) => String(mode).trim().toUpperCase()).filter(Boolean)
        : [];
    if (gameMode && modes.length > 0 && !modes.includes(gameMode)) return 0;
    return destructibles.segments.length;
}

/**
 * @param {Record<string, any>} map
 * @param {Record<string, any>} values
 * @param {string} gameMode
 * @returns {Readonly<{ code: string, count: number }>[]}
 */
function listFeatures(map, values, gameMode) {
    /** @type {Readonly<{ code: string, count: number }>[]} */
    const features = [];
    /** @param {string} code @param {number} count */
    const add = (code, count) => features.push(Object.freeze({ code, count }));

    const portalPairs = countPortalPairs(map, values);
    if (portalPairs > 0) add(MAP_PROFILE_FEATURES.PORTALS, portalPairs);

    const checkpoints = isRecord(map.parcours) && map.parcours.enabled === true && Array.isArray(map.parcours.checkpoints)
        ? map.parcours.checkpoints.length
        : 0;
    if (checkpoints > 0) add(MAP_PROFILE_FEATURES.PARCOURS, checkpoints);

    // Authored flight levels: portals change the altitude between them (planar flight).
    const levels = Array.isArray(map.portalLevels)
        ? map.portalLevels.filter((/** @type {unknown} */ level) => Number.isFinite(Number(level))).length
        : 0;
    if (levels >= 2) add(MAP_PROFILE_FEATURES.LEVELS, levels);

    const segments = countDestructibleSegments(map, gameMode);
    if (segments > 0) add(MAP_PROFILE_FEATURES.DESTRUCTIBLE, segments);

    if (isRecord(map.sandstorm) && map.sandstorm.enabled === true) add(MAP_PROFILE_FEATURES.SANDSTORM, 1);

    // Every map has its own distance fog; only the layered fog that changes during the round counts.
    if (isRecord(map.fogLayer) && Array.isArray(map.fogLayer.stages) && map.fogLayer.stages.length > 0) {
        add(MAP_PROFILE_FEATURES.FOG, 1);
    }
    return features;
}

/**
 * @typedef {{
 *   version: string,
 *   size: Readonly<{ code: string, width: number, depth: number, footprint: number }>,
 *   bots: Readonly<{ min: number, max: number }> | null,
 *   pilots: Readonly<{ min: number, max: number }>,
 *   features: ReadonlyArray<Readonly<{ code: string, count: number }>>
 * }} MapProfile
 */

/**
 * Profile of one map. `balancing` is the resolved map balancing (`{ values }`); without it the
 * bot limit stays unknown (`bots: null`). `gameMode` (upper case) decides which destructible
 * parts count, because some maps break things only in HUNT.
 * @param {unknown} mapDefinition
 * @param {unknown} [balancing]
 * @param {{ gameMode?: unknown }} [options]
 * @returns {Readonly<MapProfile>}
 */
export function resolveMapProfile(mapDefinition, balancing = null, { gameMode = '' } = {}) {
    const map = isRecord(mapDefinition) ? mapDefinition : null;
    const values = isRecord(balancing) && isRecord(balancing.values) ? balancing.values : {};
    const size = resolveMapFootprint(map?.size);
    const bots = readBotRange(balancing);
    const mode = typeof gameMode === 'string' ? gameMode.trim().toUpperCase() : '';
    return Object.freeze({
        version: MAP_PROFILE_CONTRACT_VERSION,
        size,
        bots,
        pilots: recommendPilots(size.code, bots),
        features: Object.freeze(map ? listFeatures(map, values, mode) : []),
    });
}

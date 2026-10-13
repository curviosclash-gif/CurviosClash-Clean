import { listMapExcludedGameModes } from './MapModeContract.js';
import { TEAM_OBJECTIVE_TYPES } from './FlagObjectiveContract.js';

export const FREE_PLAY_VARIANT_CONTRACT_VERSION = 'free-play-variant.v1';

export const FREE_PLAY_VARIANTS = Object.freeze(['ffa', 'team', 'flags', 'escort', 'classic']);
export const DEFAULT_FREE_PLAY_VARIANT = 'ffa';

/**
 * What each variant pins in the settings. Free play is the fight path with one of four
 * team setups, plus classic as its own mode path. Respawn is only forced for team play;
 * free-for-all keeps the deathmatch choice the player made.
 */
const VARIANT_SETTINGS = Object.freeze({
    ffa: Object.freeze({ modePath: 'fight', gameMode: 'HUNT', teamMode: false, teamObjective: TEAM_OBJECTIVE_TYPES.HUNT }),
    team: Object.freeze({ modePath: 'fight', gameMode: 'HUNT', teamMode: true, teamObjective: TEAM_OBJECTIVE_TYPES.HUNT }),
    flags: Object.freeze({ modePath: 'fight', gameMode: 'HUNT', teamMode: true, teamObjective: TEAM_OBJECTIVE_TYPES.FLAGS }),
    escort: Object.freeze({ modePath: 'fight', gameMode: 'HUNT', teamMode: true, teamObjective: TEAM_OBJECTIVE_TYPES.ESCORT }),
    classic: Object.freeze({ modePath: 'normal', gameMode: 'CLASSIC', teamMode: false, teamObjective: TEAM_OBJECTIVE_TYPES.HUNT }),
});

// Escort runs on the hunt runtime, so a map left out of either cannot host it.
const VARIANT_REQUIRED_GAME_MODES = Object.freeze({
    ffa: Object.freeze(['HUNT']),
    team: Object.freeze(['HUNT']),
    flags: Object.freeze(['HUNT']),
    escort: Object.freeze(['HUNT', 'ESCORT']),
    classic: Object.freeze(['CLASSIC']),
});

/** @param {unknown} value @param {string} [fallback] @returns {string} */
export function normalizeFreePlayVariant(value, fallback = DEFAULT_FREE_PLAY_VARIANT) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (FREE_PLAY_VARIANTS.includes(normalized)) return normalized;
    return FREE_PLAY_VARIANTS.includes(fallback) ? fallback : DEFAULT_FREE_PLAY_VARIANT;
}

/**
 * @param {unknown} variant
 * @returns {{ variant: string, modePath: string, gameMode: string, teamMode: boolean, teamObjective: string, forcesRespawn: boolean }}
 */
export function resolveFreePlayVariantSettings(variant) {
    const normalized = normalizeFreePlayVariant(variant);
    const pinned = VARIANT_SETTINGS[normalized];
    return Object.freeze({ variant: normalized, ...pinned, forcesRespawn: pinned.teamMode });
}

/**
 * Reads the variant back out of stored settings; arcade and quick action are not free play.
 * @param {*} settings
 * @returns {string | null}
 */
export function deriveFreePlayVariant(settings) {
    const modePath = String(settings?.localSettings?.modePath || '').trim().toLowerCase();
    if (modePath === 'normal') return 'classic';
    if (modePath !== 'fight') return null;
    if (settings?.hunt?.teamMode !== true) return 'ffa';
    const objective = String(settings?.hunt?.teamObjective || '').trim().toUpperCase();
    if (objective === TEAM_OBJECTIVE_TYPES.FLAGS) return 'flags';
    if (objective === TEAM_OBJECTIVE_TYPES.ESCORT) return 'escort';
    return 'team';
}

/** @param {unknown} mapDefinition @param {unknown} variant @returns {boolean} */
export function isMapEligibleForFreePlayVariant(mapDefinition, variant) {
    if (!mapDefinition || typeof mapDefinition !== 'object') return false;
    const excluded = listMapExcludedGameModes(mapDefinition);
    return !VARIANT_REQUIRED_GAME_MODES[normalizeFreePlayVariant(variant)].some((mode) => excluded.includes(mode));
}

/**
 * Remembered map per variant (V7). Unknown variants and empty keys drop out.
 * @param {unknown} raw
 * @returns {Readonly<Record<string, string>>}
 */
export function normalizeFreePlayMapMemory(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? /** @type {Record<string, unknown>} */ (raw) : {};
    /** @type {Record<string, string>} */
    const memory = {};
    for (const variant of FREE_PLAY_VARIANTS) {
        const mapKey = typeof source[variant] === 'string' ? source[variant].trim() : '';
        if (mapKey) memory[variant] = mapKey;
    }
    return Object.freeze(memory);
}

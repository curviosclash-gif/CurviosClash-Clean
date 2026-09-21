import {
    ENDLESS_PARCOURS_COMBAT_PROFILE,
    ENDLESS_PARCOURS_RUN_TYPE,
    normalizeArcadeCombatProfile,
    normalizeArcadeRunType,
} from './EndlessParcoursContract.js';
import { ARENA_WAVES_COMBAT_PROFILE, ARENA_WAVES_RUN_TYPE, isArenaWavesRunType, normalizeArenaWavesCombatProfile } from './ArenaWavesContract.js';
import { FIVE_PORTALS_COMBAT_PROFILE, FIVE_PORTALS_RUN_TYPE, isFivePortalsRunType } from './FivePortalsContract.js';
import { WEAPON_RACE_RUN_TYPE, isWeaponRaceRunType } from './WeaponRaceContract.js';

// Persisted arcade run settings: the single source for the shape and the ranges.
// Both the settings sanitizer (what survives a save) and the runtime config
// (what a match actually runs with) normalize through this contract, so a value
// can never be accepted in one place and silently dropped in the other.

export const ARCADE_RUN_SETTINGS_RANGES = Object.freeze({
    seed: Object.freeze({ min: 0, max: 2_147_483_647 }),
    sectorCount: Object.freeze({ min: 1, max: 20 }),
    intermissionSeconds: Object.freeze({ min: 1, max: 20 }),
    comboWindowMs: Object.freeze({ min: 800, max: 20_000 }),
    comboDecayPerSecond: Object.freeze({ min: 0, max: 10 }),
    maxMultiplier: Object.freeze({ min: 1, max: 25 }),
});

export const CURRENT_ARCADE_SCORE_MODEL = 'arcade-score.v3';
export const LEGACY_ARCADE_RUN_PROFILE_STORAGE_KEY = 'cuviosclash.arcade-run-profile.v1';
export const ARCADE_RUN_PROFILE_STORAGE_KEY = 'cuviosclash.arcade-run-profile.v3';
export const ARCADE_RUN_PROFILE_SCHEMA_VERSION = 'arcade-run-profile.v3';

const DEFAULTS = Object.freeze({
    profileId: 'arcade-default',
    runType: 'gauntlet',
    combatProfile: '',
    scoreModel: CURRENT_ARCADE_SCORE_MODEL,
    seed: 0,
    sectorCount: 5,
    intermissionSeconds: 10,
    comboWindowMs: 5000,
    comboDecayPerSecond: 1,
    maxMultiplier: 8,
    replayHooksEnabled: true,
    dailyChallenge: false,
    // Arcade-only run tier "Albtraum": the sector plan uses the nightmare scale.
    nightmare: false,
});

/** @typedef {{ profileId: string, runType: string, combatProfile: string, scoreModel: string,
 * seed: number, sectorCount: number, intermissionSeconds: number, comboWindowMs: number,
 * comboDecayPerSecond: number, maxMultiplier: number, replayHooksEnabled: boolean,
 * dailyChallenge: boolean, nightmare: boolean }} ArcadeRunSettings */

function clampNumber(value, range, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(range.max, Math.max(range.min, parsed));
}

function clampInteger(value, range, fallback) {
    const parsed = Math.trunc(Number(value));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(range.max, Math.max(range.min, parsed));
}

function normalizeText(value, fallback) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

export function normalizeArcadeScoreModel(_value) {
    return CURRENT_ARCADE_SCORE_MODEL;
}

/** @returns {ArcadeRunSettings} */
export function createDefaultArcadeRunSettings() {
    return { ...DEFAULTS };
}

/**
 * @param {any} source persisted `settings.arcade` block, in any state
 * @returns {ReturnType<typeof createDefaultArcadeRunSettings>}
 */
export function normalizeArcadeRunSettings(source) {
    const input = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
    const runType = isFivePortalsRunType(input.runType)
        ? FIVE_PORTALS_RUN_TYPE
        : (isArenaWavesRunType(input.runType)
            ? ARENA_WAVES_RUN_TYPE
            : (isWeaponRaceRunType(input.runType)
                ? WEAPON_RACE_RUN_TYPE
                : (normalizeArcadeRunType(input.runType) === ENDLESS_PARCOURS_RUN_TYPE ? ENDLESS_PARCOURS_RUN_TYPE : DEFAULTS.runType)));
    return {
        profileId: normalizeText(input.profileId, DEFAULTS.profileId),
        runType,
        combatProfile: runType === ENDLESS_PARCOURS_RUN_TYPE
            && normalizeArcadeCombatProfile(input.combatProfile, runType) === ENDLESS_PARCOURS_COMBAT_PROFILE
            ? ENDLESS_PARCOURS_COMBAT_PROFILE
            : (runType === WEAPON_RACE_RUN_TYPE
                ? 'hunt'
                : (runType === FIVE_PORTALS_RUN_TYPE
                ? FIVE_PORTALS_COMBAT_PROFILE
                : (runType === ARENA_WAVES_RUN_TYPE
                && normalizeArenaWavesCombatProfile(input.combatProfile, runType) === ARENA_WAVES_COMBAT_PROFILE
                    ? ARENA_WAVES_COMBAT_PROFILE : DEFAULTS.combatProfile))),
        scoreModel: normalizeArcadeScoreModel(input.scoreModel),
        seed: clampInteger(input.seed, ARCADE_RUN_SETTINGS_RANGES.seed, DEFAULTS.seed),
        sectorCount: clampInteger(input.sectorCount, ARCADE_RUN_SETTINGS_RANGES.sectorCount, DEFAULTS.sectorCount),
        intermissionSeconds: clampNumber(
            input.intermissionSeconds,
            ARCADE_RUN_SETTINGS_RANGES.intermissionSeconds,
            DEFAULTS.intermissionSeconds
        ),
        comboWindowMs: clampInteger(input.comboWindowMs, ARCADE_RUN_SETTINGS_RANGES.comboWindowMs, DEFAULTS.comboWindowMs),
        comboDecayPerSecond: clampNumber(
            input.comboDecayPerSecond,
            ARCADE_RUN_SETTINGS_RANGES.comboDecayPerSecond,
            DEFAULTS.comboDecayPerSecond
        ),
        maxMultiplier: clampInteger(input.maxMultiplier, ARCADE_RUN_SETTINGS_RANGES.maxMultiplier, DEFAULTS.maxMultiplier),
        replayHooksEnabled: input.replayHooksEnabled !== false,
        dailyChallenge: input.dailyChallenge === true,
        nightmare: input.nightmare === true,
    };
}

/** True when the block carries an explicit seed the runtime must not overwrite. */
export function hasExplicitArcadeSeed(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
    return Number.isFinite(Number(source.seed)) && Number(source.seed) > 0;
}

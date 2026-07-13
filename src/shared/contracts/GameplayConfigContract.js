// ============================================
// GameplayConfigContract.js - Shared Gameplay Config Contract
// ============================================
// Provides canonical config section keys, frozen defaults, and resolution
// helpers so that consumers outside src/core/ can access gameplay config
// without importing directly from src/core/Config.js.

// ---- Section key constants ----

export const CONFIG_SECTIONS = Object.freeze({
    PLAYER: 'PLAYER',
    GAMEPLAY: 'GAMEPLAY',
    TRAIL: 'TRAIL',
    POWERUP: 'POWERUP',
    PROJECTILE: 'PROJECTILE',
    BOT: 'BOT',
    HOMING: 'HOMING',
    HUNT: 'HUNT',
    ARENA: 'ARENA',
    PORTAL: 'PORTAL',
    COLORS: 'COLORS',
    MAPS: 'MAPS',
    RENDER: 'RENDER',
    CAMERA: 'CAMERA',
    KEYS: 'KEYS',
});

// ---- Frozen gameplay defaults ----
// These mirror the canonical values from ConfigSections.js so that
// shared-layer consumers have safe fallbacks without a core import.

export const GAMEPLAY_CONFIG_DEFAULTS = Object.freeze({
    PLAYER: Object.freeze({
        SPEED: 35,
        TURN_SPEED: 3.4,
        ROLL_SPEED: 2.0,
        BOOST_MULTIPLIER: 1.8,
        BOOST_DURATION: 4.0,
        BOOST_COOLDOWN: 5.0,
        SPAWN_PROTECTION: 1.0,
        HITBOX_RADIUS: 0.8,
        MODEL_SCALE: 1.0,
        START_Y: 10,
        AUTO_ROLL: true,
        AUTO_ROLL_SPEED: 1.5,
        DEFAULT_VEHICLE_ID: 'ship5',
    }),
    GAMEPLAY: Object.freeze({
        PLANAR_MODE: false,
        PORTAL_COUNT: 8,
        PLANAR_LEVEL_COUNT: 5,
        PORTAL_BEAMS: false,
        PLANAR_AIM_INPUT_SPEED: 1.5,
        PLANAR_AIM_RETURN_SPEED: 0.6,
    }),
    TRAIL: Object.freeze({
        WIDTH: 0.6,
        UPDATE_INTERVAL: 0.07,
        GAP_CHANCE: 0.02,
        GAP_DURATION: 0.3,
        MAX_SEGMENTS: 5000,
    }),
    POWERUP: Object.freeze({
        SPAWN_INTERVAL: 3.0,
        MAX_ON_FIELD: 10,
        PICKUP_RADIUS: 2.5,
        SIZE: 1.5,
        ROTATION_SPEED: 2.0,
        BOUNCE_SPEED: 1.5,
        BOUNCE_HEIGHT: 0.5,
        MAX_INVENTORY: 5,
        DURATION: 5.0,
    }),
    PROJECTILE: Object.freeze({
        SPEED: 45,
        RADIUS: 0.7,
        LIFE_TIME: 3.0,
        MAX_DISTANCE: 140,
        COOLDOWN: 1.25,
        PLANAR_AIM_MAX_ANGLE_DEG: 18,
    }),
    BOT: Object.freeze({
        DEFAULT_DIFFICULTY: 'HARD',
        ACTIVE_DIFFICULTY: 'HARD',
    }),
    HOMING: Object.freeze({
        LOCK_ON_ANGLE: 11,
        TURN_RATE: 3.0,
        MAX_LOCK_RANGE: 100,
    }),
    HUNT: Object.freeze({
        ENABLED: true,
        ACTIVE_MODE: 'CLASSIC',
        RESPAWN_ENABLED: false,
        PLAYER_MAX_HP: 100,
        SHIELD_MAX_HP: 40,
    }),
    ARENA: Object.freeze({
        SIZE: 80,
        WALL_HEIGHT: 30,
        MAP_SCALE: 3,
        CHECKER_LIGHT_COLOR: 0xd9d9d9,
        CHECKER_DARK_COLOR: 0x5a5a5a,
        CHECKER_WORLD_SIZE: 18,
    }),
    PORTAL: Object.freeze({
        RADIUS: 4.0,
        COOLDOWN: 1.2,
        RING_SIZE: 4.0,
        ROTATION_SPEED: 2.0,
        MIN_PAIR_DISTANCE: 15,
        MIN_PAIR_DISTANCE_PLANAR: 4,
    }),
    COLORS: Object.freeze({
        PLAYER_1: 0x00aaff,
        PLAYER_2: 0xff8800,
        BOT_COLORS: Object.freeze([0xff4444, 0x44ff44, 0xffff44, 0xff44ff, 0x44ffff]),
    }),
    RENDER: Object.freeze({
        MAX_PIXEL_RATIO: 1.35,
        SHADOW_MAP_SIZE: 512,
    }),
});

function resolveGameplayConfigCarrier(source) {
    if (!source || typeof source !== 'object') return null;
    return source.config
        || source.runtime?.config
        || null;
}

function resolveEntityRuntimeCarrier(source) {
    if (!source || typeof source !== 'object') return null;
    return source.entityRuntimeConfig
        || source.services?.entityRuntimeConfig
        || source.runtime?.services?.entityRuntimeConfig
        || source.entityManager?.entityRuntimeConfig
        || source.arena?.entityRuntimeConfig
        || source.runtimeContext?.services?.entityRuntimeConfig
        || source.owner?.entityRuntimeConfig
        || source.game?.entityManager?.entityRuntimeConfig
        || source.runtime?.entityManager?.entityRuntimeConfig
        || null;
}

// ---- Config resolution helpers ----

/**
 * Returns a single config section from the given source, falling back to
 * GAMEPLAY_CONFIG_DEFAULTS when the source does not carry the section.
 *
 * Accepted source shapes (checked in order):
 *   - source[sectionKey]                          (direct property)
 *   - source.entityRuntimeConfig[sectionKey]      (entity context)
 *   - source.services?.entityRuntimeConfig[sectionKey]
 *   - source.runtimeContext?.services?.entityRuntimeConfig[sectionKey]
 *
 * @param {object|null} source - Runtime context, entity config, or plain config object.
 * @param {string} sectionKey - One of the CONFIG_SECTIONS keys.
 * @returns {object} The resolved section (never null).
 */
export function getGameplayConfigSection(source, sectionKey) {
    const fallback = GAMEPLAY_CONFIG_DEFAULTS[sectionKey] || {};

    if (!source || typeof source !== 'object') return fallback;

    // Direct property (e.g. a full config or entityRuntimeConfig passed directly)
    if (source[sectionKey] && typeof source[sectionKey] === 'object') {
        return source[sectionKey];
    }

    const configCarrier = resolveGameplayConfigCarrier(source);
    if (configCarrier?.[sectionKey] && typeof configCarrier[sectionKey] === 'object') {
        return configCarrier[sectionKey];
    }

    // EntityRuntimeConfig shapes
    const erc = resolveEntityRuntimeCarrier(source);
    if (erc && typeof erc === 'object' && erc[sectionKey] && typeof erc[sectionKey] === 'object') {
        return erc[sectionKey];
    }

    return fallback;
}

/**
 * Resolves a full gameplay config object from the given source.
 * Each section is resolved individually via getGameplayConfigSection.
 *
 * @param {object|null} source - Runtime context, entity config, or plain config object.
 * @returns {object} A config object with all standard gameplay sections.
 */
export function resolveGameplayConfig(source) {
    const config = {};
    for (const key of Object.values(CONFIG_SECTIONS)) {
        config[key] = getGameplayConfigSection(source, key);
    }
    return config;
}

/**
 * Returns the MAPS catalog from a config-like source, or an empty object.
 *
 * @param {object|null} source - Config object or runtime context carrying MAPS.
 * @returns {object} The maps catalog.
 */
export function getGameplayMapCatalog(source) {
    if (!source || typeof source !== 'object') return {};

    if (source.MAPS && typeof source.MAPS === 'object') return source.MAPS;

    const configCarrier = resolveGameplayConfigCarrier(source);
    if (configCarrier?.MAPS && typeof configCarrier.MAPS === 'object') {
        return configCarrier.MAPS;
    }

    const erc = resolveEntityRuntimeCarrier(source);
    if (erc && typeof erc === 'object' && erc.MAPS && typeof erc.MAPS === 'object') {
        return erc.MAPS;
    }

    return {};
}

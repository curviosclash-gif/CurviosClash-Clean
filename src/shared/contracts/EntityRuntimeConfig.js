function cloneObject(value, fallback = {}) {
    if (!value || typeof value !== 'object') return { ...fallback };
    return JSON.parse(JSON.stringify(value));
}

function toFiniteNumber(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneSection(baseConfig, sectionName, fallback = {}) {
    const section = baseConfig?.[sectionName];
    return cloneObject(section, fallback);
}

// Entity-level defaults differ from game-level GAMEPLAY_CONFIG_DEFAULTS:
// entities use conservative/safe fallbacks (lower speeds, no gaps, etc.)
// so that entities spawned without a full config are still functional.
export const DEFAULT_ENTITY_RUNTIME_CONFIG = Object.freeze({
    PLAYER: Object.freeze({
        SPEED: 18,
        TURN_SPEED: 2.2,
        ROLL_SPEED: 2.0,
        BOOST_DURATION: 1,
        BOOST_COOLDOWN: 1,
        BOOST_MULTIPLIER: 2,
        HITBOX_RADIUS: 0.8,
        MODEL_SCALE: 1,
        DEFAULT_VEHICLE_ID: 'aircraft',
        SPAWN_PROTECTION: 0,
        START_Y: 5,
        AUTO_ROLL: false,
        AUTO_ROLL_SPEED: 3,
    }),
    GAMEPLAY: Object.freeze({
        PLANAR_MODE: false,
        PORTAL_COUNT: 0,
        PLANAR_LEVEL_COUNT: 5,
    }),
    TRAIL: Object.freeze({
        WIDTH: 0.6,
        UPDATE_INTERVAL: 0.07,
        GAP_CHANCE: 0,
        GAP_DURATION: 0.5,
        MAX_SEGMENTS: 1400,
        GHOST_COLLISION_ENABLED: false,
    }),
    POWERUP: Object.freeze({
        SIZE: 1,
        MAX_ON_FIELD: 4,
        SPAWN_INTERVAL: 8,
        PICKUP_RADIUS: 1.25,
        ROTATION_SPEED: 1.5,
        BOUNCE_SPEED: 2,
        BOUNCE_HEIGHT: 0.35,
        TYPES: Object.freeze({}),
    }),
    PROJECTILE: Object.freeze({
        SPEED: 60,
        RADIUS: 0.5,
        LIFE_TIME: 2,
        COOLDOWN: 0.4,
        MAX_DISTANCE: 120,
        PLANAR_AIM_MAX_ANGLE_DEG: 45,
    }),
    HOMING: Object.freeze({
        TURN_RATE: 3,
        LOCK_ON_ANGLE: 15,
        MAX_LOCK_RANGE: 100,
    }),
    HUNT: Object.freeze({
        ENABLED: false,
        ACTIVE_MODE: 'CLASSIC',
        DEFAULT_MODE: 'CLASSIC',
        RESPAWN_ENABLED: false,
        PLAYER_MAX_HP: 100,
        SHIELD_MAX_HP: 40,
        PLAYER_REGEN_DELAY: 3,
        PLAYER_REGEN_PER_SECOND: 2.5,
        TRAIL_SEGMENT_HP: 3,
        COLLISION_DAMAGE: Object.freeze({
            WALL: 22,
            TRAIL: 34,
            PLAYER_CRASH: 40,
        }),
        RESPAWN: Object.freeze({}),
        TARGETING: Object.freeze({}),
        MG: Object.freeze({}),
        ROCKET: Object.freeze({}),
    }),
    BOT: Object.freeze({
        ACTIVE_DIFFICULTY: 'NORMAL',
        DEFAULT_DIFFICULTY: 'NORMAL',
        POLICY_TYPE: '',
        TRAINER_BRIDGE_ENABLED: false,
        DIFFICULTY_PROFILES: Object.freeze({}),
    }),
    PORTAL: Object.freeze({}),
    ARENA: Object.freeze({
        MAP_SCALE: 1,
        CHECKER_WORLD_SIZE: 18,
        CHECKER_LIGHT_COLOR: 0xffffff,
        CHECKER_DARK_COLOR: 0x2f3542,
    }),
    COLORS: Object.freeze({
        PLAYER_1: 0xffffff,
        PLAYER_2: 0x7dd3fc,
        BOT_COLORS: Object.freeze([0xff8a65]),
    }),
    MAPS: Object.freeze({}),
    runtimeConfig: null,
});

export function createEntityRuntimeConfig(runtimeConfig = null, baseConfig = null) {
    const contract = {
        PLAYER: cloneSection(baseConfig, 'PLAYER', DEFAULT_ENTITY_RUNTIME_CONFIG.PLAYER),
        GAMEPLAY: cloneSection(baseConfig, 'GAMEPLAY', DEFAULT_ENTITY_RUNTIME_CONFIG.GAMEPLAY),
        TRAIL: cloneSection(baseConfig, 'TRAIL', DEFAULT_ENTITY_RUNTIME_CONFIG.TRAIL),
        POWERUP: cloneSection(baseConfig, 'POWERUP', DEFAULT_ENTITY_RUNTIME_CONFIG.POWERUP),
        PROJECTILE: cloneSection(baseConfig, 'PROJECTILE', DEFAULT_ENTITY_RUNTIME_CONFIG.PROJECTILE),
        HOMING: cloneSection(baseConfig, 'HOMING', DEFAULT_ENTITY_RUNTIME_CONFIG.HOMING),
        HUNT: cloneSection(baseConfig, 'HUNT', DEFAULT_ENTITY_RUNTIME_CONFIG.HUNT),
        BOT: cloneSection(baseConfig, 'BOT', DEFAULT_ENTITY_RUNTIME_CONFIG.BOT),
        PORTAL: cloneSection(baseConfig, 'PORTAL', DEFAULT_ENTITY_RUNTIME_CONFIG.PORTAL),
        ARENA: cloneSection(baseConfig, 'ARENA', DEFAULT_ENTITY_RUNTIME_CONFIG.ARENA),
        COLORS: cloneSection(baseConfig, 'COLORS', DEFAULT_ENTITY_RUNTIME_CONFIG.COLORS),
        MAPS: cloneSection(baseConfig, 'MAPS', DEFAULT_ENTITY_RUNTIME_CONFIG.MAPS),
        runtimeConfig: runtimeConfig ? cloneObject(runtimeConfig, null) : null,
    };

    if (runtimeConfig?.player) {
        contract.PLAYER.SPEED = toFiniteNumber(runtimeConfig.player.speed, contract.PLAYER.SPEED);
        contract.PLAYER.TURN_SPEED = toFiniteNumber(runtimeConfig.player.turnSpeed, contract.PLAYER.TURN_SPEED);
        contract.PLAYER.MODEL_SCALE = toFiniteNumber(runtimeConfig.player.modelScale, contract.PLAYER.MODEL_SCALE);
        contract.PLAYER.AUTO_ROLL = runtimeConfig.player.autoRoll === true;
        const defaultVehicleId = String(
            runtimeConfig.player.vehicles?.PLAYER_1
            || contract.PLAYER.DEFAULT_VEHICLE_ID
            || DEFAULT_ENTITY_RUNTIME_CONFIG.PLAYER.DEFAULT_VEHICLE_ID
        ).trim();
        if (defaultVehicleId) {
            contract.PLAYER.DEFAULT_VEHICLE_ID = defaultVehicleId;
        }
    }

    if (runtimeConfig?.gameplay) {
        if (typeof runtimeConfig.gameplay.planarMode === 'boolean') {
            contract.GAMEPLAY.PLANAR_MODE = runtimeConfig.gameplay.planarMode;
        }
        contract.GAMEPLAY.PORTAL_COUNT = toFiniteNumber(runtimeConfig.gameplay.portalCount, contract.GAMEPLAY.PORTAL_COUNT);
        contract.GAMEPLAY.PLANAR_LEVEL_COUNT = toFiniteNumber(runtimeConfig.gameplay.planarLevelCount, contract.GAMEPLAY.PLANAR_LEVEL_COUNT);
    }

    if (runtimeConfig?.trail) {
        contract.TRAIL.WIDTH = toFiniteNumber(runtimeConfig.trail.width, contract.TRAIL.WIDTH);
        contract.TRAIL.MAX_SEGMENTS = toFiniteNumber(runtimeConfig.trail.maxSegments, contract.TRAIL.MAX_SEGMENTS);
        contract.TRAIL.GAP_CHANCE = toFiniteNumber(runtimeConfig.trail.gapChance, contract.TRAIL.GAP_CHANCE);
        contract.TRAIL.GAP_DURATION = toFiniteNumber(runtimeConfig.trail.gapDuration, contract.TRAIL.GAP_DURATION);
    }

    if (runtimeConfig?.arcade) {
        contract.TRAIL.GHOST_COLLISION_ENABLED = runtimeConfig.arcade.ghostTrailCollisionEnabled === true;
    }

    if (runtimeConfig?.powerup) {
        contract.POWERUP.MAX_ON_FIELD = toFiniteNumber(runtimeConfig.powerup.maxOnField, contract.POWERUP.MAX_ON_FIELD);
    }

    if (runtimeConfig?.projectile) {
        contract.PROJECTILE.COOLDOWN = toFiniteNumber(runtimeConfig.projectile.cooldown, contract.PROJECTILE.COOLDOWN);
    }

    if (runtimeConfig?.homing) {
        contract.HOMING.LOCK_ON_ANGLE = toFiniteNumber(runtimeConfig.homing.lockOnAngle, contract.HOMING.LOCK_ON_ANGLE);
    }

    if (runtimeConfig?.session) {
        contract.HUNT.ACTIVE_MODE = String(
            runtimeConfig.session.activeGameMode
            || contract.HUNT.ACTIVE_MODE
            || DEFAULT_ENTITY_RUNTIME_CONFIG.HUNT.ACTIVE_MODE
        ).trim().toUpperCase();
    }

    if (runtimeConfig?.hunt) {
        if (typeof runtimeConfig.hunt.enabled === 'boolean') {
            contract.HUNT.ENABLED = runtimeConfig.hunt.enabled;
        }
        if (typeof runtimeConfig.hunt.respawnEnabled === 'boolean') {
            contract.HUNT.RESPAWN_ENABLED = runtimeConfig.hunt.respawnEnabled;
        }
    }

    if (runtimeConfig?.huntCombat) {
        contract.HUNT.MG = cloneObject(contract.HUNT.MG, {});
        contract.HUNT.TARGETING = cloneObject(contract.HUNT.TARGETING, {});
        contract.HUNT.MG.TRAIL_HIT_RADIUS = toFiniteNumber(
            runtimeConfig.huntCombat.mgTrailAimRadius,
            contract.HUNT.MG.TRAIL_HIT_RADIUS
        );
        if (runtimeConfig.huntCombat.fightTuningEnabled === true) {
            contract.HUNT.PLAYER_MAX_HP = toFiniteNumber(runtimeConfig.huntCombat.fightPlayerHp, contract.HUNT.PLAYER_MAX_HP);
            contract.HUNT.MG.DAMAGE = toFiniteNumber(runtimeConfig.huntCombat.fightMgDamage, contract.HUNT.MG.DAMAGE);
        }
    }

    if (runtimeConfig?.bot) {
        contract.BOT.ACTIVE_DIFFICULTY = String(
            runtimeConfig.bot.activeDifficulty
            || contract.BOT.ACTIVE_DIFFICULTY
            || DEFAULT_ENTITY_RUNTIME_CONFIG.BOT.ACTIVE_DIFFICULTY
        ).trim().toUpperCase();
        contract.BOT.POLICY_TYPE = String(runtimeConfig.bot.policyType || contract.BOT.POLICY_TYPE || '').trim();
        contract.BOT.TRAINER_BRIDGE_ENABLED = runtimeConfig.bot.trainerBridgeEnabled === true;
    }

    return contract;
}

export function resolveEntityRuntimeConfig(source, fallback = DEFAULT_ENTITY_RUNTIME_CONFIG) {
    // If source IS already a resolved entityRuntimeConfig (has both POWERUP and PLAYER sections),
    // return it directly instead of looking for a nested property.
    if (source && typeof source === 'object' && 'POWERUP' in source && 'PLAYER' in source) {
        return source;
    }
    const candidate = source?.entityRuntimeConfig
        || source?.services?.entityRuntimeConfig
        || source?.runtime?.services?.entityRuntimeConfig
        || source?.entityManager?.entityRuntimeConfig
        || source?.arena?.entityRuntimeConfig
        || source?.runtimeContext?.services?.entityRuntimeConfig
        || source?.owner?.entityRuntimeConfig
        || null;
    return candidate && typeof candidate === 'object' ? candidate : fallback;
}

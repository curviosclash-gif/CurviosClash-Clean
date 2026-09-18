import { WEAPON_FAN_PICKUP_DEFINITIONS } from '../shared/contracts/WeaponFanPickupDefinitionsContract.js';
import { FLAMETHROWER_TARGET_SPAWN_WEIGHTS } from '../shared/contracts/FlamethrowerPickupDefinitionsContract.js';
import { LIGHTNING_SPAWN_WEIGHTS } from '../shared/contracts/LightningPickupDefinitionsContract.js';
import { RAILGUN_SPAWN_WEIGHTS } from '../shared/contracts/RailgunPickupDefinitionsContract.js';

export const HUNT_CONFIG = Object.freeze({
    DEFAULT_MODE: 'HUNT',
    DEFAULT_RESPAWN_ENABLED: true,
    DEATHMATCH_KILL_LIMIT: 10,
    DEATHMATCH_TIME_LIMIT_SECONDS: 300,
    PLAYER_MAX_HP: 100,
    PLAYER_REGEN_PER_SECOND: 2.0,
    PLAYER_REGEN_DELAY: 3.0,
    SHIELD_MAX_HP: 40,
    ITEM_USE_COOLDOWN_SECONDS: 0.15,
    SHIELD_USE_COOLDOWN_SECONDS: 0.65,
    COLLISION_DAMAGE: Object.freeze({
        WALL: 20,
        TRAIL: 28,
        PLAYER_CRASH: 40,
    }),
    // Minimum seconds between two collision hits of the same kind on one player. Without
    // it a player stuck inside geometry takes the full wall damage on every single frame.
    COLLISION_COOLDOWN: Object.freeze({
        WALL: 0.6,
        PLAYER_CRASH: 0.5,
    }),
    // A frontal crash is not the same event as scraping along geometry. Above this share
    // of the vehicle base speed - measured as the closing speed into the surface - a wall
    // bills WALL_DAMAGE instead of the cooldown-limited COLLISION_DAMAGE tick. 120 kills
    // an unshielded vehicle outright and leaves a shielded one at 20 structure.
    COLLISION_IMPACT: Object.freeze({
        WALL_SPEED_RATIO: 0.6,
        WALL_DAMAGE: 120,
    }),
    MG: Object.freeze({
        DAMAGE: 7.75,
        COOLDOWN: 0.08,
        OVERHEAT_PER_SHOT: 9,
        COOLING_PER_SECOND: 20,
        LOCKOUT_THRESHOLD: 96,
        LOCKOUT_SECONDS: 0.75,
        RANGE: 152,
        MIN_FALLOFF: 0.5,
        AIM_DOT_MIN: 0.965,
        HUMAN_AIM_ASSIST_ENABLED: true,
        HUMAN_AIM_ASSIST_ACQUIRE_ANGLE_DEG: 19.2,
        HUMAN_AIM_ASSIST_RELEASE_ANGLE_DEG: 28.8,
        HUMAN_AIM_ASSIST_LOCK_SECONDS: 0.4,
        TRAIL_SAMPLE_STEP: 0.45,
        TRAIL_HIT_RADIUS: 0.78,
        TRAIL_SELF_SKIP_RECENT: 8,
        TRACER_BEAM_RADIUS: 0.16,
        TRACER_BULLET_RADIUS: 0.42,
    }),
    MG_TURRET: Object.freeze({
        RANGE: 58,
        COOLDOWN: 0.24,
        DAMAGE: 3,
        DURATION_SECONDS: 20,
        MAX_HP: 45,
        HIT_RADIUS: 2.2,
        MAX_PER_OWNER: 1,
        DEPLOY_OFFSET: 3.2,
        TARGET_HOLD_SECONDS: 0.3,
        TARGET_REACQUIRE_SECONDS: 0.12,
        LOS_SAMPLE_STEP: 0.5,
        ACQUIRE_DELAY_SECONDS: 0.22,
        TURN_RATE_RADIANS_PER_SECOND: 8,
        FIRE_DOT_MIN: 0.985,
        AUDIO_RANGE: 80,
    }),
    ROCKET_TURRET: Object.freeze({
        RANGE: 90,
        COOLDOWN: 3.4,
        DAMAGE: 3,
        DURATION_SECONDS: 20,
        MAX_HP: 45,
        HIT_RADIUS: 2.2,
        MAX_PER_OWNER: 1,
        DEPLOY_OFFSET: 3.2,
        TARGET_HOLD_SECONDS: 0.3,
        TARGET_REACQUIRE_SECONDS: 0.12,
        LOS_SAMPLE_STEP: 0.5,
        ACQUIRE_DELAY_SECONDS: 0.22,
        TURN_RATE_RADIANS_PER_SECOND: 8,
        FIRE_DOT_MIN: 0.985,
        AUDIO_RANGE: 80,
    }),
    TARGETING: Object.freeze({
        MUZZLE_OFFSET: 2.1,
        PROJECTILE_SPAWN_OFFSET: 2.2,
        TRAIL_DESCRIPTOR_MAX_DRIFT: 1.25,
        TRAIL_PROBE_MIN_STEP: 0.01,
        TRAIL_LINE_MIN_SAMPLE_STEP: 0.2,
        TRAIL_HIT_RADIUS_MIN: 0.12,
        TRAIL_DENSE_SCAN_STEP_SCALE: 0.5,
        TRAIL_DENSE_SCAN_MIN_STEP: 0.12,
        PLAYER_HITBOX_MIN_RADIUS: 0.2,
        GEOMETRY_EPSILON: 0.000001,
        OPTIMIZED_SCAN_ENABLED: true,
        OPTIMIZED_SCAN_STEP_MULTIPLIER: 2.0,
        OPTIMIZED_SCAN_MAX_STEP: 1.1,
    }),
    ROCKET: Object.freeze({
        VISUAL_SCALE_WEAK: 1.7,
        VISUAL_SCALE_MEDIUM: 1.95,
        VISUAL_SCALE_HEAVY: 2.2,
        VISUAL_SCALE_MEGA: 2.6,
        COLLISION_RADIUS_MULTIPLIER: 1.65,
        HOMING_TURN_RATE: 10,
        HOMING_MIN_TURN_RATE: 0.1,
        HOMING_LOCK_ON_ANGLE: 48,
        HOMING_MIN_LOCK_ON_ANGLE: 5,
        HOMING_REACQUIRE_INTERVAL: 0.08,
        HOMING_MIN_REACQUIRE_INTERVAL: 0.04,
        HOMING_FALLBACK_REACQUIRE_INTERVAL: 0.2,
        HOMING_RANGE: 140,
        HOMING_MIN_RANGE: 10,
        // How close a locked-on rocket has to be before its target is warned.
        WARNING_RANGE: 140,
        // How close a defence rocket has to pass its target to destroy it (E35). Both
        // rockets are fast, so the check sweeps the whole frame, not just end points.
        INTERCEPT_HIT_RADIUS: 3,
        HOMING_SPEED_EPSILON: 0.0001,
        HOMING_LEAD_TIME_MAX: 0.45,
        HOMING_FALLBACK_ANGLE_SCALE: 1.75,
        HOMING_FALLBACK_ANGLE_MAX: 90,
        HOMING_TRAIL_PRIORITY_RATIO: 0.85,
        HOMING_TURN_DOT_BLEND: 0.35,
        PORTAL_EXIT_FORWARD_OFFSET: 1.5,
        FOAM_BOUNCE_MAX_COUNT: 3,
        FOAM_BOUNCE_NORMAL_BIAS: 0.08,
        FOAM_BOUNCE_SPEED_MULTIPLIER: 1.02,
        FOAM_BOUNCE_POSITION_MIN_OFFSET: 0.2,
        FOAM_BOUNCE_POSITION_RADIUS_SCALE: 1.25,
        FOAM_BOUNCE_COOLDOWN: 0.045,
        FOAM_BOUNCE_TTL_PENALTY: 0.02,
        FLAME_FLICKER_BASE: 0.7,
        FLAME_FLICKER_AMPLITUDE: 0.3,
        FLAME_FLICKER_SPEED: 30,
        FLAME_FLICKER_INDEX_PHASE: 7,
        EXPLOSION_RADIUS: 25,
        EXPLOSION_DAMAGE_FALLOFF: 0.5,
        // Shared with a map structure's blast (see MapDestructibleBlastSystem): both push a
        // caught vehicle away from the same center for the same felt reason, so one strength
        // is enough rather than tuning two nearly identical knobs in lockstep.
        EXPLOSION_KNOCKBACK_IMPULSE: 22,
        EXPLOSION_KNOCKBACK_LIFT: 6,
        EXPLOSION_KNOCKBACK_DURATION: 0.6,
        TRAIL_OVERFLOW_DAMAGE_PER_METER: 2.5,
    }),
    FEEDBACK: Object.freeze({
        MG_IMPACT: Object.freeze({
            count: 16,
            speed: 8.5,
            size: 0.38,
            life: 0.24,
            gravity: -4.0,
            color: 0xffb347,
        }),
        TRAIL_IMPACT: Object.freeze({
            count: 20,
            speed: 7.6,
            size: 0.44,
            life: 0.32,
            gravity: -4.8,
            color: 0x33a8ff,
            destroyedColor: 0x66ddff,
        }),
        SHIELD_IMPACT: Object.freeze({
            count: 22,
            speed: 6.6,
            size: 0.52,
            life: 0.4,
            gravity: -1.2,
            color: 0x66d9ff,
            breakColor: 0xb8f6ff,
        }),
        ROCKET_IMPACT: Object.freeze({
            count: 42,
            speed: 13.5,
            size: 0.92,
            life: 0.68,
            gravity: -6.4,
            weakColor: 0xffcc66,
            mediumColor: 0xff8844,
            heavyColor: 0xff3344,
            megaColor: 0xcc11ff,
        }),
        TRAIL_EXPLOSION: Object.freeze({
            countPerSegment: 8,
            speed: 10.0,
            size: 0.6,
            life: 0.45,
            gravity: -5.0,
            color: 0x44ccff,
            // Total particles one burst may spend. A mega rocket destroys far more
            // segments than countPerSegment can afford against the shared buffer,
            // so beyond this the segments are thinned instead of the burst eating
            // its own particles. 240 is 30 groups - a readable chain along 90 m
            // that still leaves three quarters of the buffer for everything else.
            maxParticlesPerBurst: 240,
        }),
        // A death is the loudest moment in the game and used to be the only
        // effect without a config block, so clipping a wall looked exactly like
        // taking a mega rocket to the cockpit. The values below are the baseline
        // burst; one scale factor grows the whole event from there - particle
        // count, debris size, throw speed, burn time and shockwave radius alike -
        // so a wreck reads as big as whatever caused it.
        DEATH_EXPLOSION: Object.freeze({
            count: 30,
            speed: 12.0,
            size: 0.7,
            life: 0.6,
            gravity: -6.0,
            minScale: 0.6,
            maxScale: 1.6,
            causeScale: Object.freeze({
                WALL: 0.8,
                TRAIL: 0.9,
                TRAIL_SELF: 0.8,
                TRAIL_OTHER: 0.9,
                PLAYER_CRASH: 1.15,
                PROJECTILE: 1.0,
                // A turret is a deployed machine, not a crewed vehicle.
                TURRET: 0.7,
            }),
            // Rocket tiers already encode damage (30/60/120/210 against 100 HP),
            // so the tier is the damage step - a separate damage lookup would
            // only restate what the type already says.
            projectileScale: Object.freeze({
                MG_BULLET: 0.9,
                ROCKET_WEAK: 1.1,
                ROCKET_MEDIUM: 1.25,
                ROCKET_HEAVY: 1.42,
                ROCKET_MEGA: 1.6,
            }),
        }),
    }),
    ROCKET_TIERS: Object.freeze({
        WEAK: Object.freeze({ damage: 30, spawnChance: 0.5, trailBlastMeters: 6 }),
        MEDIUM: Object.freeze({ damage: 60, spawnChance: 0.28, trailBlastMeters: 12 }),
        HEAVY: Object.freeze({ damage: 120, spawnChance: 0.18, trailBlastMeters: 30 }),
        MEGA: Object.freeze({ damage: 210, spawnChance: 0.03, trailBlastMeters: 90 }),
    }),
    // Previously fans occupied 0.30 * 1 / 31.7 of all spawns. Reserve 12 percent
    // for them now and scale every other pickup, including rockets, equally.
    ROCKET_PICKUP_SPAWN_CHANCE: 0.70 * 0.88 / (1 - 0.30 / 31.7),
    PICKUP_WEIGHTS: Object.freeze({
        SHIELD: 1.0,
        HEALTH: 1.0,
        MG_TURRET: 10,
        ROCKET_TURRET: 5,
        SPEED_UP: 1.0,
        GHOST: 1.0,
        THICK: 1.0,
        THIN: 1.0,
        SLOW_TIME: 1.0,
        SLOW_DOWN: 1.0,
        INVERT: 1.0,
        FOG: 0.7,
        FAN_3: WEAPON_FAN_PICKUP_DEFINITIONS.FAN_3.spawnWeights.HUNT,
        FAN_4: WEAPON_FAN_PICKUP_DEFINITIONS.FAN_4.spawnWeights.HUNT,
        FAN_5: WEAPON_FAN_PICKUP_DEFINITIONS.FAN_5.spawnWeights.HUNT,
        // Hunt picks from this table, not from the registry spawn weights, so the rarity of
        // the flamethrower has to be kept in step with its definition by hand.
        FLAMETHROWER: FLAMETHROWER_TARGET_SPAWN_WEIGHTS.HUNT,
        LIGHTNING: LIGHTNING_SPAWN_WEIGHTS.HUNT,
        RAILGUN: RAILGUN_SPAWN_WEIGHTS.HUNT,
    }),
    // Lightning (E23-E32): warning over the whole map, then a strike on the highest flyers.
    LIGHTNING: Object.freeze({
        WARNING_SECONDS: 2,
        DAMAGE: 35,
        // Below this many hit points the strike kills; at or above it the target keeps 1 HP.
        LETHAL_BELOW_HP: 30,
        // Share of the other living players that is hit, rounded up, at least one.
        TARGET_SHARE: 0.2,
    }),
    // Railgun (E48, E81): hold to charge, release to fire.
    RAILGUN: Object.freeze({
        SHOTS: 5,
        CHARGE_SECONDS: 1.5,
        MIN_DAMAGE: 20,
        MAX_DAMAGE: 70,
        RANGE: 250,
        MAX_TARGETS: 3,
        // Added to a target's hitbox: the beam is thin, but it should not need pixel precision.
        BEAM_RADIUS: 0.5,
    }),
    FLAMETHROWER: Object.freeze({
        FUEL_SECONDS: 6,
        RANGE: 18,
        // Full opening angle of the cone, so the flame reaches 15 degrees to either side.
        CONE_DEGREES: 30,
        DAMAGE_PER_SECOND: 30,
        // Seconds a trail segment has to sit in the flame before the gap opens.
        TRAIL_BURN_SECONDS: 0.3,
        // Afterburn: a hit target keeps burning for a fixed time. A later hit restarts
        // the clock instead of extending it, so the fire never outlasts these seconds.
        AFTERBURN_SECONDS: 3,
        AFTERBURN_DAMAGE_PER_SECOND: 5,
    }),
    TRAIL_SEGMENT_HP: 3,
    RESPAWN: Object.freeze({
        DELAY_SECONDS: 3.0,
        INVULNERABILITY_SECONDS: 1.25,
        MIN_ENEMY_DISTANCE: 18,
        RESET_INVENTORY: true,
        START_LOADOUT: Object.freeze(['ROCKET_WEAK']),
        RECOVERY_SHIELD_HP: 18,
    }),
});

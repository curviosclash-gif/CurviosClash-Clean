import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG, CONFIG_BASE } from '../src/core/Config.js';
import { EntityManager } from '../src/entities/EntityManager.js';
import { applyPlayerPowerup, updatePlayerEffects } from '../src/entities/player/PlayerEffectOps.js';
import { applyEmpPulse } from '../src/entities/systems/EmpPulseOps.js';
import { HuntCombatSystem } from '../src/entities/systems/HuntCombatSystem.js';
import { ProjectileSystem } from '../src/entities/systems/ProjectileSystem.js';
import { ITEM_PROJECTILE_TARGETING_PROFILE } from '../src/entities/systems/projectile/ItemProjectileTargetingOps.js';
import { ProjectileSimulationOps } from '../src/entities/systems/projectile/ProjectileSimulationOps.js';
import { ClassicModeStrategy } from '../src/modes/ClassicModeStrategy.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { resolveInventoryActionAvailability } from '../src/shared/contracts/GameplayActionAvailabilityContract.js';
import {
    getPickupDefinition,
    isPickupTypeAllowedForMode,
    isPickupTypeSelfUsable,
    isPickupTypeShootable,
    isRocketPickupType,
} from '../src/shared/contracts/PickupRegistryContract.js';

const CLASSIC_CONFIG = { ...CONFIG_BASE, HUNT: { ...CONFIG_BASE.HUNT, ACTIVE_MODE: 'CLASSIC', DEFAULT_MODE: 'CLASSIC' } };

function createEffectPlayer(index, position, extra = {}) {
    const player = {
        index,
        alive: true,
        position: new THREE.Vector3(...position),
        entityRuntimeConfig: CLASSIC_CONFIG,
        activeEffects: [],
        inventory: [],
        rocketInventory: [],
        selectedItemIndex: 0,
        baseSpeed: CONFIG_BASE.PLAYER.SPEED,
        speed: CONFIG_BASE.PLAYER.SPEED,
        trail: null,
        hasShield: false,
        shieldHP: 0,
        getAimDirection(out) { return out.set(1, 0, 0); },
        applyPowerup(type, options) { applyPlayerPowerup(this, type, options); },
        ...extra,
    };
    return player;
}

test('pickup registry matches the agreed item actions and values', () => {
    for (const type of ['SPEED_UP', 'SLOW_DOWN', 'THIN', 'INVERT', 'TRAIL_GAP', 'SWAP']) {
        assert.equal(isPickupTypeShootable(type, 'CLASSIC'), true, `${type} is an attack projectile`);
        assert.equal(isPickupTypeSelfUsable(type, 'CLASSIC'), false, `${type} is not self-usable`);
    }
    for (const [type, mode] of [
        ['THICK', 'CLASSIC'], ['SHIELD', 'CLASSIC'], ['SLOW_TIME', 'HUNT'], ['GHOST', 'CLASSIC'], ['FOG', 'CLASSIC'],
        ['EMP', 'CLASSIC'], ['MAGNET', 'CLASSIC'], ['DECOY', 'CLASSIC'], ['HEALTH', 'ARCADE'], ['FAN_3', 'HUNT'],
        ['MINE', 'CLASSIC'], ['MG_TURRET', 'HUNT'], ['ROCKET_TURRET', 'HUNT'],
    ]) {
        assert.equal(isPickupTypeSelfUsable(type, mode), true, `${type} is used directly in ${mode}`);
        assert.equal(isPickupTypeShootable(type, mode), false, `${type} never becomes a projectile`);
    }

    const expected = {
        SPEED_UP: { duration: 8, multiplier: 1.6 },
        SLOW_DOWN: { duration: 8, multiplier: 0.5 },
        THICK: { duration: 10, trailWidth: 3 },
        THIN: { duration: 10, trailWidth: 0.2 },
        SLOW_TIME: { duration: 10, timeScale: 0.4 },
        GHOST: { duration: 10 },
        INVERT: { duration: 8 },
        TRAIL_GAP: { duration: 10 },
        EMP: { duration: 15, pulseRadius: 20 },
        MAGNET: { duration: 6, pickupRadiusMultiplier: 5 },
        DECOY: { duration: 10 },
        FOG: { duration: 8 },
    };
    for (const [type, values] of Object.entries(expected)) {
        for (const [key, value] of Object.entries(values)) {
            assert.equal(getPickupDefinition(type)[key], value, `${type}.${key}`);
        }
    }
    assert.equal(getPickupDefinition('SPEED_UP').actionRole, 'debuff');
    assert.equal(getPickupDefinition('TRAIL_GAP').actionRole, 'debuff');
    assert.equal(isPickupTypeAllowedForMode('SLOW_TIME', 'HUNT'), true);

    assert.ok(getPickupDefinition('PURGE'), 'old data still resolves the retired type');
    for (const mode of ['CLASSIC', 'ARCADE', 'HUNT']) {
        assert.equal(isPickupTypeAllowedForMode('PURGE', mode), false);
    }
});

test('slow time lasts ten real seconds in Hunt and trail gap blocks the victim trail for ten seconds', () => {
    const huntConfig = { ...CONFIG_BASE, HUNT: { ...CONFIG_BASE.HUNT, ENABLED: true, ACTIVE_MODE: 'HUNT', DEFAULT_MODE: 'HUNT' } };
    const player = createEffectPlayer(0, [0, 0, 0], { entityRuntimeConfig: huntConfig });
    player.entityManager = { players: [player] };
    applyPlayerPowerup(player, 'SLOW_TIME');
    assert.equal(player.hasSlowTime, true);
    // The loop hands effects a dt already scaled to 40 percent: 0.4 per real second.
    for (let second = 0; second < 9; second += 1) updatePlayerEffects(player, 0.4);
    assert.equal(player.hasSlowTime, true, 'still active after nine real seconds');
    updatePlayerEffects(player, 0.4);
    assert.equal(player.hasSlowTime, false, 'gone after ten, not stretched to 25');

    const victim = createEffectPlayer(1, [0, 0, 0]);
    victim.entityManager = { players: [victim] };
    applyPlayerPowerup(victim, 'TRAIL_GAP', { sourcePlayerIndex: 0 });
    assert.equal(victim.trailGapActive, true);
    updatePlayerEffects(victim, 9.9);
    assert.equal(victim.trailGapActive, true);
    updatePlayerEffects(victim, 0.2);
    assert.equal(victim.trailGapActive, false);
});

test('EMP pulse hits every other living player inside the inclusive radius once', () => {
    const hits = [];
    const target = (index, position, alive = true) => ({
        index,
        alive,
        position: new THREE.Vector3(...position),
        applyPowerup(type, options) { hits.push({ index, type, source: options?.sourcePlayerIndex }); },
    });
    const owner = target(0, [0, 0, 0]);
    const players = [
        owner,
        target(1, [20, 0, 0]),
        target(2, [20.01, 0, 0]),
        target(3, [5, 0, 0], false),
        target(4, [12, 30, 16]),
    ];

    assert.equal(applyEmpPulse({ owner, players }), 1);
    assert.deepEqual(hits, [{ index: 1, type: 'EMP', source: 0 }]);

    hits.length = 0;
    assert.equal(applyEmpPulse({ owner, players, planar: true }), 2, 'planar radius ignores height');
    assert.deepEqual(hits.map((hit) => hit.index), [1, 4]);
});

test('using EMP pulses nearby enemies, spares the user and consumes exactly one item', () => {
    const entityRuntimeConfig = CLASSIC_CONFIG;
    const owner = createEffectPlayer(0, [0, 0, 0], { inventory: ['EMP', 'SHIELD'], rocketInventory: ['ROCKET_WEAK'] });
    const enemy = createEffectPlayer(1, [0, 0, 12]);
    const distant = createEffectPlayer(2, [0, 0, 40]);
    for (const player of [owner, enemy, distant]) {
        player.entityManager = { players: [owner, enemy, distant] };
        applyPlayerPowerup(player, 'GHOST');
        player.hasShield = true;
        player.shieldHP = 20;
    }
    const combat = new HuntCombatSystem({
        entityRuntimeConfig,
        players: [owner, enemy, distant],
        callbacks: { getStrategy: () => new ClassicModeStrategy({ entityRuntimeConfig }) },
    });

    const result = combat.useInventoryItem(owner, 0);
    assert.equal(result.ok, true);
    assert.deepEqual(owner.inventory, ['SHIELD']);
    assert.deepEqual(owner.rocketInventory, ['ROCKET_WEAK']);
    assert.equal(owner.isGhost, true, 'the user keeps its buffs');
    assert.equal(owner.hasShield, true, 'the user keeps its shield');
    assert.equal(owner.itemActionsDisabled, false, 'the user is not locked');

    assert.equal(enemy.isGhost, false);
    assert.equal(enemy.hasShield, false);
    assert.equal(enemy.itemActionsDisabled, true);
    assert.equal(enemy.activeEffects.find((effect) => effect.type === 'EMP').remaining, 15);
    assert.equal(distant.itemActionsDisabled, false);
    assert.equal(distant.hasShield, true);

    updatePlayerEffects(enemy, 5);
    applyPlayerPowerup(enemy, 'EMP', { sourcePlayerIndex: 0 });
    const empEffects = enemy.activeEffects.filter((effect) => effect.type === 'EMP');
    assert.equal(empEffects.length, 1, 'a second EMP refreshes instead of stacking');
    assert.equal(empEffects[0].remaining, 15);
});

test('use item fires attack items through the projectile path and never touches rockets', () => {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const shots = [];
    const player = {
        index: 0,
        inventory: ['SLOW_DOWN', 'SHIELD'],
        rocketInventory: ['ROCKET_HEAVY'],
        selectedItemIndex: 0,
        itemUseCooldownRemaining: 2,
    };
    const combat = new HuntCombatSystem({
        entityRuntimeConfig,
        players: [player],
        callbacks: { getStrategy: () => new HuntModeStrategy({ entityRuntimeConfig }) },
        combat: {
            shootItemProjectile: (shooter, index, rocketOnly) => {
                shots.push({ index, rocketOnly });
                return { ok: true, type: shooter.inventory[index] };
            },
        },
    });

    const result = combat.useInventoryItem(player, 0);
    assert.equal(result.ok, true, 'the item cooldown does not gate projectile items');
    assert.deepEqual(shots, [{ index: 0, rocketOnly: false }]);
    assert.deepEqual(player.rocketInventory, ['ROCKET_HEAVY']);

    const blocked = combat.useInventoryItem(player, 1);
    assert.equal(blocked.ok, false, 'self-used items still respect the item cooldown');
    assert.equal(shots.length, 1);
});

test('item lock-on prefers vehicles near the aim line, ignores rear targets and respects decoys', () => {
    const owner = createEffectPlayer(0, [0, 0, 0]);
    const cone = createEffectPlayer(1, [40, 0, 30]);
    const behind = createEffectPlayer(2, [-20, 0, 0]);
    const decoy = createEffectPlayer(3, [30, 0, 1], { decoyActive: true });
    const combat = new HuntCombatSystem({ players: [owner, cone, behind, decoy] });
    assert.equal(combat.checkItemLockOn(owner), cone);

    cone.position.set(20, 0, 24);
    assert.equal(combat.checkItemLockOn(owner), null, 'targets beyond 45 degrees are not locked');
});

test('the HUD lock marker shows the item target only while an attack item is selected', () => {
    const owner = createEffectPlayer(0, [0, 0, 0], { inventory: ['SLOW_DOWN', 'SHIELD'] });
    const itemTarget = createEffectPlayer(1, [40, 0, 10]);
    const rocketTarget = createEffectPlayer(2, [60, 0, -40]);
    const combat = new HuntCombatSystem({ players: [owner, itemTarget, rocketTarget] });
    // Stands in for the Hunt rocket/MG lock, which picks a different vehicle here.
    combat.checkLockOn = () => rocketTarget;
    const entityManager = {
        players: [owner, itemTarget, rocketTarget],
        _huntCombatSystem: combat,
        _lockOnCache: new Map(),
        _checkLockOn: (player) => combat.checkLockOn(player),
    };
    const getLockOnTarget = (index) => EntityManager.prototype.getLockOnTarget.call(entityManager, index);

    assert.equal(getLockOnTarget(0), itemTarget, 'the marker shows the vehicle the item shot will lock');
    owner.selectedItemIndex = 1;
    assert.equal(getLockOnTarget(0), rocketTarget, 'other items keep the rocket and MG marker');
    owner.alive = false;
    assert.equal(getLockOnTarget(0), null);
});

test('inventory availability maps every item to use and the shoot action to the rocket queue', () => {
    const attack = resolveInventoryActionAvailability({
        player: {
            inventory: ['SLOW_DOWN'],
            rocketInventory: ['ROCKET_WEAK'],
            selectedItemIndex: 0,
            shootCooldown: 0.4,
            itemUseCooldownRemaining: 0,
        },
        modeType: 'HUNT',
    });
    assert.equal(attack.canUse, true);
    assert.equal(attack.useFiresProjectile, true);
    assert.equal(attack.canUseNow, false, 'attack items wait for the shoot cooldown');
    assert.equal(attack.canShootRocket, true);
    assert.equal(attack.canShootRocketNow, false);
    assert.equal(attack.actionHintLabel, 'SHOT');

    const shield = resolveInventoryActionAvailability({
        player: { inventory: ['SHIELD'], rocketInventory: [], selectedItemIndex: 0, shootCooldown: 0.4 },
        modeType: 'HUNT',
    });
    assert.equal(shield.canUseNow, true);
    assert.equal(shield.useFiresProjectile, false);
    assert.equal(shield.canShootRocket, false);
    assert.equal(shield.actionHintLabel, 'USE');
});

test('hunt fan pickups keep their 5/4/3 percent base chances after purge left the pool', () => {
    const strategy = new HuntModeStrategy({ entityRuntimeConfig: CONFIG });
    const types = CONFIG.POWERUP.TYPES;
    const pool = strategy.filterSpawnableTypes(Object.keys(types), types).filter((type) => !isRocketPickupType(type));
    assert.equal(pool.includes('PURGE'), false);
    assert.equal(pool.includes('SLOW_TIME'), true);

    const weights = CONFIG.HUNT.PICKUP_WEIGHTS;
    const weightOf = (type) => (Number.isFinite(Number(weights[type])) ? Number(weights[type]) : 1);
    const total = pool.reduce((sum, type) => sum + weightOf(type), 0);
    const nonRocketShare = 1 - CONFIG.HUNT.ROCKET_PICKUP_SPAWN_CHANCE;
    // The flamethrower, the lightning and the railgun joined the pool after the fan percentages were tuned. A new
    // item takes its share from everyone, so the three targets shrink by the same factor.
    assert.equal(pool.includes('FLAMETHROWER'), true);
    assert.equal(pool.includes('LIGHTNING'), true);
    assert.equal(pool.includes('RAILGUN'), true);
    const dilution = (total - weightOf('FLAMETHROWER') - weightOf('LIGHTNING') - weightOf('RAILGUN')) / total;
    for (const [type, percent] of [['FAN_3', 5], ['FAN_4', 4], ['FAN_5', 3]]) {
        assert.ok(
            Math.abs((weightOf(type) / total) * nonRocketShare * 100 - percent * dilution) < 1e-9,
            `${type} spawns at ${percent} percent`
        );
    }
});

test('the item targeting profile hits crossing vehicles the old shared homing missed', () => {
    const config = createEntityRuntimeConfig(null, CONFIG_BASE);
    const ops = new ProjectileSimulationOps({ entityRuntimeConfig: config });
    const hitDistance = config.PROJECTILE.RADIUS + config.PLAYER.HITBOX_RADIUS;
    // Values the shared homing handed every non-rocket Hunt item shot before the item profile.
    const previousProfile = {
        itemHomingProfile: false,
        homingTurnRate: config.HOMING.TURN_RATE,
        homingLockOnAngle: config.HOMING.LOCK_ON_ANGLE,
        homingRange: config.HOMING.MAX_LOCK_RANGE,
        homingReacquireInterval: 0.08,
    };
    const itemProfile = {
        itemHomingProfile: true,
        homingTurnRate: ITEM_PROJECTILE_TARGETING_PROFILE.turnRate,
        homingLockOnAngle: ITEM_PROJECTILE_TARGETING_PROFILE.lockOnAngleDegrees,
        homingRange: ITEM_PROJECTILE_TARGETING_PROFILE.range,
        homingReacquireInterval: ITEM_PROJECTILE_TARGETING_PROFILE.reacquireInterval,
    };
    const closestApproach = (profile, start, lateralSpeed) => {
        const owner = { index: 0, alive: true, position: new THREE.Vector3(), velocity: new THREE.Vector3() };
        const enemy = {
            index: 1,
            alive: true,
            position: new THREE.Vector3(...start),
            velocity: new THREE.Vector3(0, 0, lateralSpeed),
            hitboxRadius: config.PLAYER.HITBOX_RADIUS,
        };
        const projectile = {
            owner,
            target: enemy,
            huntRocket: false,
            homingEnabled: true,
            position: new THREE.Vector3(),
            previousPosition: new THREE.Vector3(),
            velocity: new THREE.Vector3(config.PROJECTILE.SPEED, 0, 0),
            radius: config.PROJECTILE.RADIUS,
            ttl: config.PROJECTILE.LIFE_TIME,
            traveled: 0,
            foamBounceCooldown: 0,
            mesh: { position: new THREE.Vector3(), lookAt() {} },
            flame: null,
            ...profile,
        };
        const dt = 1 / 120;
        let closest = Infinity;
        for (let time = 0; time < config.PROJECTILE.LIFE_TIME; time += dt) {
            enemy.position.addScaledVector(enemy.velocity, dt);
            ops.stepProjectile(projectile, 0, dt, null, [owner, enemy], null, time);
            closest = Math.min(closest, projectile.position.distanceTo(enemy.position));
        }
        return closest;
    };

    let previousHits = 0;
    let itemHits = 0;
    let scenarios = 0;
    for (const distance of [30, 45, 60]) {
        for (const offset of [0, 8, -12]) {
            for (const speed of [10, 20, 30]) {
                const lateralSpeed = offset > 0 ? -speed : speed;
                scenarios += 1;
                if (closestApproach(previousProfile, [distance, 0, offset], lateralSpeed) <= hitDistance) previousHits += 1;
                if (closestApproach(itemProfile, [distance, 0, offset], lateralSpeed) <= hitDistance) itemHits += 1;
            }
        }
    }
    assert.equal(itemHits, scenarios, `item profile hits every crossing vehicle (${itemHits}/${scenarios})`);
    assert.ok(previousHits <= scenarios / 2, `the previous homing missed most of them (${previousHits}/${scenarios})`);
});

test('item projectiles use their own targeting profile while rockets keep theirs', () => {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const strategy = new HuntModeStrategy({ entityRuntimeConfig });
    const owner = {
        index: 0,
        alive: true,
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        shootCooldown: 0,
        activeEffects: [],
        inventory: ['SLOW_DOWN'],
        rocketInventory: ['ROCKET_WEAK'],
        selectedItemIndex: 0,
        getAimDirection(out) { return out.set(1, 0, 0); },
    };
    const target = { index: 1, alive: true, position: new THREE.Vector3(30, 0, 0), velocity: new THREE.Vector3() };
    const profiles = [];
    const system = new ProjectileSystem({
        entityRuntimeConfig,
        players: [owner, target],
        arena: { getCollisionInfo: () => null },
        peekInventoryItem: (player, index) => ({ ok: true, type: player.inventory[index], meta: { index } }),
        takeInventoryItem: (player, index) => ({ ok: true, type: player.inventory.splice(index, 1)[0] }),
        resolveLockOn: (_player, profile) => {
            profiles.push(profile);
            return target;
        },
        getStrategy: () => strategy,
    });

    const itemShot = system.shootItemProjectile(owner, 0);
    assert.equal(itemShot.ok, true);
    const itemProjectile = system.projectiles.at(-1);
    assert.equal(itemProjectile.itemHomingProfile, true);
    assert.equal(itemProjectile.ignoresTrails, true);
    assert.equal(itemProjectile.ignoresTurrets, true);
    assert.equal(itemProjectile.homingTurnRate, 8);
    assert.equal(itemProjectile.homingLockOnAngle, 45);

    owner.shootCooldown = 0;
    const rocketShot = system.shootItemProjectile(owner, -1, true);
    assert.equal(rocketShot.ok, true);
    const rocket = system.projectiles.at(-1);
    const rocketParams = strategy.resolveRocketProjectileParams('ROCKET_WEAK', entityRuntimeConfig);
    assert.equal(rocket.itemHomingProfile, false);
    assert.equal(rocket.ignoresTrails, false);
    assert.equal(rocket.homingTurnRate, Math.max(Number(entityRuntimeConfig.HOMING.TURN_RATE || 3), rocketParams.homingTurnRate));
    assert.equal(rocket.homingLockOnAngle, Math.max(Number(entityRuntimeConfig.HOMING.LOCK_ON_ANGLE || 15), rocketParams.homingLockOnAngle));
    assert.deepEqual(profiles, ['item', 'rocket']);
    system.dispose();
});

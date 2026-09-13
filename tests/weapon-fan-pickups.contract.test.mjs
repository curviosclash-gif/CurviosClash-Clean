import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { createGameStateSnapshot } from '../src/core/GameStateSnapshot.js';
import { PowerupModelFactory } from '../src/entities/PowerupModelFactory.js';
import {
    applyPlayerPowerup,
    recomputePlayerEffectState,
    updatePlayerEffects,
} from '../src/entities/player/PlayerEffectOps.js';
import { HuntCombatSystem } from '../src/entities/systems/HuntCombatSystem.js';
import { ProjectileSystem } from '../src/entities/systems/ProjectileSystem.js';
import { OverheatGunSystem } from '../src/hunt/OverheatGunSystem.js';
import { resolveHuntFallbackItemAction } from '../src/hunt/HuntBotPolicy.js';
import { resolveRocketTierDamage } from '../src/hunt/RocketPickupSystem.js';
import {
    WEAPON_FAN_MAX_PROJECTILES,
    resolveWeaponFanAngleRadians,
    resolveWeaponFanProjectileCount,
} from '../src/hunt/WeaponFanOps.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { StateReconciler } from '../src/network/StateReconciler.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { resolveFightMachineGunConfig } from '../src/shared/contracts/FightMachineGunContract.js';
import {
    getPickupDefinition,
    isPickupTypeAllowedForMode,
    isPickupTypeSelfUsable,
} from '../src/shared/contracts/PickupRegistryContract.js';

const FAN_TYPES = ['FAN_3', 'FAN_4', 'FAN_5'];
const ROCKET_TYPES = ['ROCKET_WEAK', 'ROCKET_MEDIUM', 'ROCKET_HEAVY', 'ROCKET_MEGA'];

function createEffectPlayer() {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const manager = {
        entityRuntimeConfig,
        gameModeStrategy: { getPickupModeType: () => 'HUNT' },
        players: [],
    };
    const player = {
        index: 0,
        alive: true,
        isBot: false,
        entityManager: manager,
        entityRuntimeConfig,
        activeEffects: [],
        inventory: [],
        baseSpeed: entityRuntimeConfig.PLAYER.SPEED,
        speed: entityRuntimeConfig.PLAYER.SPEED,
        trail: null,
        hasShield: false,
        shieldHP: 0,
        boostPortalTimer: 0,
        slingshotTimer: 0,
    };
    manager.players.push(player);
    return { player, manager, entityRuntimeConfig };
}

function signedFanAngle(direction) {
    return Math.atan2(-direction.z, direction.x);
}

test('fan pickup registry is Hunt-only with approved durations, weights, colors and additive stacking', () => {
    const expected = [
        ['FAN_3', 3, 0.6],
        ['FAN_4', 4, 0.3],
        ['FAN_5', 5, 0.1],
    ];
    const colors = new Set();
    for (const [type, projectileCount, weight] of expected) {
        const definition = getPickupDefinition(type);
        assert.equal(definition.duration, 40);
        assert.equal(definition.fanProjectiles, projectileCount);
        assert.equal(definition.spawnWeights.HUNT, weight);
        assert.equal(CONFIG_BASE.HUNT.PICKUP_WEIGHTS[type], weight);
        assert.equal(definition.stackPolicy, 'add-instance');
        assert.equal(isPickupTypeAllowedForMode(type, 'HUNT'), true);
        assert.equal(isPickupTypeAllowedForMode(type, 'CLASSIC'), false);
        assert.equal(isPickupTypeAllowedForMode(type, 'ARCADE'), false);
        assert.equal(isPickupTypeSelfUsable(type, 'HUNT'), true);
        colors.add(definition.color);
    }
    assert.equal(colors.size, 3);
});

test('fan activations add as independent timers, cap only output at twelve, and expire on schedule', () => {
    const { player } = createEffectPlayer();
    applyPlayerPowerup(player, 'FAN_3');
    applyPlayerPowerup(player, 'FAN_3');
    assert.equal(player.activeEffects.length, 2);
    assert.equal(resolveWeaponFanProjectileCount(player.activeEffects), 6);

    applyPlayerPowerup(player, 'FAN_4');
    applyPlayerPowerup(player, 'FAN_5');
    assert.equal(player.activeEffects.length, 4, 'effects above the cap keep their own timers');
    assert.equal(resolveWeaponFanProjectileCount(player.activeEffects), WEAPON_FAN_MAX_PROJECTILES);

    const staggered = createEffectPlayer().player;
    applyPlayerPowerup(staggered, 'FAN_3');
    updatePlayerEffects(staggered, 10);
    applyPlayerPowerup(staggered, 'FAN_4');
    assert.equal(resolveWeaponFanProjectileCount(staggered.activeEffects), 7);
    updatePlayerEffects(staggered, 30);
    assert.deepEqual(staggered.activeEffects.map((effect) => [effect.type, effect.remaining]), [['FAN_4', 10]]);
    assert.equal(resolveWeaponFanProjectileCount(staggered.activeEffects), 4);
    updatePlayerEffects(staggered, 10);
    assert.equal(resolveWeaponFanProjectileCount(staggered.activeEffects), 1);
});

test('fan effects follow zero-delta pause, EMP, mode changes and reset semantics', () => {
    const { player, manager } = createEffectPlayer();
    applyPlayerPowerup(player, 'FAN_5');
    updatePlayerEffects(player, 0);
    assert.equal(player.activeEffects[0].remaining, 40);

    applyPlayerPowerup(player, 'EMP');
    assert.deepEqual(player.activeEffects.map((effect) => effect.type), ['EMP']);
    assert.equal(resolveWeaponFanProjectileCount(player.activeEffects), 1);

    player.activeEffects.length = 0;
    applyPlayerPowerup(player, 'FAN_4');
    manager.gameModeStrategy.getPickupModeType = () => 'CLASSIC';
    updatePlayerEffects(player, 0);
    assert.deepEqual(player.activeEffects, []);

    manager.gameModeStrategy.getPickupModeType = () => 'HUNT';
    applyPlayerPowerup(player, 'FAN_3');
    player.activeEffects.length = 0;
    recomputePlayerEffectState(player);
    assert.equal(resolveWeaponFanProjectileCount(player.activeEffects), 1);
});

test('inventory activation and bot policy use fan pickups through existing contracts', () => {
    const { player, entityRuntimeConfig } = createEffectPlayer();
    player.inventory = ['FAN_3', 'FAN_4'];
    player.selectedItemIndex = 0;
    player.itemUseCooldownRemaining = 0;
    player.applyPowerup = (type) => applyPlayerPowerup(player, type);
    const combat = new HuntCombatSystem({
        services: { entityRuntimeConfig },
        callbacks: { getStrategy: () => ({ modeType: 'HUNT', hasMachineGun: () => true }) },
    });

    assert.equal(combat.useInventoryItem(player, 0).ok, true);
    player.itemUseCooldownRemaining = 0;
    assert.equal(combat.useInventoryItem(player, 0).ok, true);
    assert.equal(resolveWeaponFanProjectileCount(player.activeEffects), 7);
    assert.deepEqual(player.inventory, []);

    const botAction = resolveHuntFallbackItemAction(
        { inventory: ['FAN_5'] },
        { healthRatio: 1, shieldRatio: 0, pressureLevel: 0, aggression: 0.5 }
    );
    assert.equal(botAction.useItem, 0);
    assert.equal(botAction.type, 'FAN_5');
});

test('fan pickup model exposes its visible multiplier and distinct projectile markers', () => {
    const factory = new PowerupModelFactory(1.5);
    try {
        for (const type of FAN_TYPES) {
            const definition = getPickupDefinition(type);
            const model = factory.createModel(type, definition);
            assert.equal(model.userData.markerText, definition.icon);
            assert.equal(model.userData.fanProjectiles, definition.fanProjectiles);
            assert.ok(model.children.length >= definition.fanProjectiles + 1);
        }
    } finally {
        factory.dispose();
    }
});

test('all rocket variants emit a symmetric fan while consuming one item and one cooldown', () => {
    for (const type of ROCKET_TYPES) {
        const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
        let consumed = 0;
        let shootEvents = 0;
        let lockOnResolutions = 0;
        const owner = {
            index: 0,
            alive: true,
            position: new THREE.Vector3(),
            quaternion: new THREE.Quaternion(),
            activeEffects: [{ type: 'FAN_4', remaining: 40 }],
            shootCooldown: 0,
            getAimDirection: (out) => out.set(1, 0, 0),
        };
        const system = new ProjectileSystem({
            entityRuntimeConfig,
            players: [owner],
            peekInventoryItem: () => ({ ok: true, type }),
            takeInventoryItem: () => { consumed += 1; return { ok: true, type }; },
            resolveLockOn: () => { lockOnResolutions += 1; return null; },
            getStrategy: () => new HuntModeStrategy({ entityRuntimeConfig }),
            onShoot: () => { shootEvents += 1; },
        });
        try {
            const result = system.shootItemProjectile(owner, 0);
            assert.equal(result.ok, true);
            assert.equal(result.meta.projectileCount, 4);
            assert.equal(system.projectiles.length, 4);
            assert.equal(consumed, 1);
            assert.equal(shootEvents, 1);
            assert.equal(lockOnResolutions, 1);
            assert.equal(owner.shootCooldown, entityRuntimeConfig.PROJECTILE.COOLDOWN);
            const angles = system.projectiles.map((projectile) => signedFanAngle(projectile.velocity));
            for (let i = 0; i < angles.length; i += 1) {
                assert.ok(Math.abs(angles[i] - resolveWeaponFanAngleRadians(i, 4)) < 1e-10);
            }
            assert.ok(angles.every((angle) => Math.abs(angle) > 1e-6), 'even fans have no center shot');
            assert.ok(system.projectiles.every((projectile) => projectile.type === type));
            const tier = type.slice('ROCKET_'.length);
            const expectedDamage = Number(entityRuntimeConfig.HUNT.ROCKET_TIERS[tier].damage);
            assert.equal(resolveRocketTierDamage(type, entityRuntimeConfig), expectedDamage);
            assert.ok(system.projectiles.every(
                (projectile) => resolveRocketTierDamage(projectile.type, entityRuntimeConfig) === expectedDamage
            ));
            const snapshot = createGameStateSnapshot({ players: [owner], projectiles: system.projectiles }, null);
            assert.equal(snapshot.projectiles.length, 4);
            assert.equal(new Set(snapshot.projectiles.map((projectile) => projectile.id)).size, 4);
        } finally {
            system.dispose();
        }
    }
});

test('static turret external rockets stay single even when their owner has a fan effect', () => {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const owner = {
        index: 0,
        alive: true,
        activeEffects: [{ type: 'FAN_5', remaining: 40 }],
    };
    const system = new ProjectileSystem({
        entityRuntimeConfig,
        players: [owner],
        getStrategy: () => new HuntModeStrategy({ entityRuntimeConfig }),
    });
    try {
        assert.ok(system.spawnExternalProjectile({
            owner,
            type: 'ROCKET_WEAK',
            position: new THREE.Vector3(),
            direction: new THREE.Vector3(1, 0, 0),
        }));
        assert.equal(system.projectiles.length, 1);
    } finally {
        system.dispose();
    }
});

test('MG resolves every fan ray through normal damage with one heat, cooldown and audio charge', () => {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const player = {
        index: 0,
        alive: true,
        isBot: false,
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        activeEffects: [{ type: 'FAN_5', remaining: 40 }],
        shootCooldown: 0,
        getAimDirection: (out) => out.set(1, 0, 0),
    };
    let audioCount = 0;
    const manager = {
        entityRuntimeConfig,
        players: [player],
        gameModeStrategy: { hasMachineGun: () => true },
        audio: { play: () => { audioCount += 1; } },
    };
    const gun = new OverheatGunSystem(manager, {
        players: [player],
        services: { entityRuntimeConfig },
        getTrailSpatialIndex: () => null,
    });
    const directions = [];
    const damage = [];
    gun._hitResolver = {
        resolveAimDirection: (_player, out) => out.set(1, 0, 0),
        resolveHit: (_player, _mg, _muzzle, outAim, aimDirection) => {
            outAim.copy(aimDirection);
            directions.push(aimDirection.clone());
            return { target: { alive: true }, trail: null, turret: null, distance: 5, point: null };
        },
        applyHit: (_player, _target, _distance, mg) => { damage.push(mg.DAMAGE); },
        applyTrailHit: () => assert.fail('unexpected trail hit'),
        applyTurretHit: () => assert.fail('unexpected turret hit'),
    };

    const result = gun.tryFire(player);
    const mg = resolveFightMachineGunConfig(entityRuntimeConfig.HUNT.MG);
    assert.equal(result.ok, true);
    assert.equal(result.projectileCount, 5);
    assert.equal(result.hitCount, 5);
    assert.equal(directions.length, 5);
    assert.ok(Math.abs(signedFanAngle(directions[0]) + Math.PI / 12) < 1e-10);
    assert.ok(Math.abs(signedFanAngle(directions[2])) < 1e-10);
    assert.ok(Math.abs(signedFanAngle(directions[4]) - Math.PI / 12) < 1e-10);
    assert.deepEqual(damage, Array(5).fill(mg.DAMAGE));
    assert.equal(gun.getOverheatValue(0), mg.OVERHEAT_PER_SHOT);
    assert.equal(player.shootCooldown, mg.COOLDOWN);
    assert.equal(audioCount, 1);
});

test('network reconciliation preserves duplicate fan instances and staggered timers', () => {
    const host = {
        id: 'host',
        index: 0,
        alive: true,
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        velocity: new THREE.Vector3(),
        activeEffects: [
            { type: 'FAN_3', remaining: 30, sourcePlayerIndex: null },
            { type: 'FAN_3', remaining: 40, sourcePlayerIndex: null },
            { type: 'FAN_4', remaining: 12.5, sourcePlayerIndex: null },
        ],
        inventory: [],
    };
    const snapshot = createGameStateSnapshot({ players: [host] }, null);
    assert.deepEqual(snapshot.players[0].effects.map((effect) => [effect.type, effect.remaining]), [
        ['FAN_3', 30],
        ['FAN_3', 40],
        ['FAN_4', 12.5],
    ]);

    const client = {
        index: 0,
        alive: true,
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        velocity: new THREE.Vector3(),
        activeEffects: [],
        inventory: [],
    };
    const reconciler = new StateReconciler();
    reconciler.receiveServerState({ state: snapshot });
    reconciler.reconcile([client], {});
    assert.deepEqual(client.activeEffects, snapshot.players[0].effects);
    assert.equal(resolveWeaponFanProjectileCount(client.activeEffects), 10);
});

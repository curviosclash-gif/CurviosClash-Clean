import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { HUNT_CONFIG } from '../src/hunt/HuntConfig.js';
import { applyDamage, updatePlayerHealthRegen } from '../src/hunt/HealthSystem.js';
import { FlamethrowerSystem } from '../src/hunt/FlamethrowerSystem.js';
import {
    applyPlayerPowerup,
    extinguishBurning,
    igniteBurning,
    updatePlayerEffects,
} from '../src/entities/player/PlayerEffectOps.js';
import { updatePlayerCharges } from '../src/entities/player/PlayerChargeOps.js';
import { PlayerInteractionPhase } from '../src/entities/systems/lifecycle/PlayerInteractionPhase.js';
import { getPickupDefinition } from '../src/shared/contracts/PickupRegistryContract.js';
import { serializePlayer } from '../src/core/GameStateSnapshot.js';

const BURNING = 'BURNING';

const HUNT_MODE_CONFIG = {
    ...CONFIG_BASE,
    HUNT: { ...CONFIG_BASE.HUNT, ENABLED: true, ACTIVE_MODE: 'HUNT', DEFAULT_MODE: 'HUNT' },
};

const CLASSIC_MODE_CONFIG = {
    ...CONFIG_BASE,
    HUNT: { ...CONFIG_BASE.HUNT, ENABLED: false, ACTIVE_MODE: 'CLASSIC', DEFAULT_MODE: 'CLASSIC' },
};

function createPlayer(index, position, config) {
    return {
        index,
        alive: true,
        isBot: false,
        position: new THREE.Vector3(position[0], position[1], position[2]),
        quaternion: new THREE.Quaternion(),
        entityRuntimeConfig: config,
        activeEffects: [],
        inventory: [],
        rocketInventory: [],
        selectedItemIndex: 0,
        baseSpeed: CONFIG_BASE.PLAYER.SPEED,
        speed: CONFIG_BASE.PLAYER.SPEED,
        trail: null,
        hp: 100,
        maxHp: 100,
        shieldHP: 0,
        maxShieldHp: 40,
        hasShield: false,
        shieldHitFeedback: 0,
        spawnProtectionTimer: 0,
        hitboxRadius: 0.8,
        lastDamageTimestamp: -Infinity,
        boostPortalTimer: 0,
        boostPortalDir: new THREE.Vector3(),
        slingshotTimer: 0,
        aimDirection: new THREE.Vector3(0, 0, -1),
        getAimDirection(out = null) {
            const target = out || new THREE.Vector3();
            return target.copy(this.aimDirection);
        },
        takeDamage(amount, options = {}) {
            if ((this.spawnProtectionTimer || 0) > 0) {
                return { applied: 0, absorbedByShield: 0, hpApplied: 0, remainingHp: this.hp, isDead: this.hp <= 0 };
            }
            const clockMs = this.entityManager?._simulationClockMs;
            const nowSeconds = Number.isFinite(clockMs) ? Math.max(0, clockMs) * 0.001 : 0;
            return applyDamage(this, amount, { nowSeconds, ...options }, this.entityRuntimeConfig);
        },
        activateBoostPortal(params, forward) {
            this.boostPortalTimer = params?.duration || 1.5;
            this.boostPortalParams = params;
            this.boostPortalDir.copy(forward);
            this.isBoosting = true;
        },
    };
}

function createWorld({ mode = 'HUNT', isFightOutcomeAuthority = true } = {}) {
    const config = mode === 'HUNT' ? HUNT_MODE_CONFIG : CLASSIC_MODE_CONFIG;
    const shooter = createPlayer(0, [0, 0, 0], config);
    const damageEvents = [];
    const kills = [];
    const entityManager = {
        players: [shooter],
        arena: null,
        isFightOutcomeAuthority,
        entityRuntimeConfig: config,
        _simulationClockMs: 0,
        gameModeStrategy: { hasMachineGun: () => mode === 'HUNT' },
        _targetableRegistry: { collect: () => [] },
        _emitHuntDamageEvent(event) { damageEvents.push(event); },
        _killPlayer(player, cause, options = {}) {
            player.alive = false;
            player.hp = 0;
            kills.push({ player, cause, options });
        },
    };
    shooter.entityManager = entityManager;
    const system = new FlamethrowerSystem(entityManager);
    entityManager._flamethrowerSystem = system;
    return { config, entityManager, shooter, system, damageEvents, kills };
}

function addTarget(world, index, position) {
    const target = createPlayer(index, position, world.config);
    target.entityManager = world.entityManager;
    world.entityManager.players.push(target);
    return target;
}

function findBurning(player) {
    return player.activeEffects.find((effect) => effect?.type === BURNING) || null;
}

function armFlamethrower(player) {
    applyPlayerPowerup(player, 'FLAMETHROWER');
    return player;
}

test('afterburn balancing values live in the hunt config', () => {
    assert.equal(HUNT_CONFIG.FLAMETHROWER.AFTERBURN_SECONDS, 3);
    assert.equal(HUNT_CONFIG.FLAMETHROWER.AFTERBURN_DAMAGE_PER_SECOND, 5);
});

test('a flame hit sets the target alight for three seconds', () => {
    const world = createWorld();
    armFlamethrower(world.shooter);
    const target = addTarget(world, 1, [0, 0, -6]);

    world.system.fire(world.shooter, 1 / 60);

    const burning = findBurning(target);
    assert.ok(burning, 'the hit target carries the burning effect');
    assert.equal(burning.remaining, 3);
    assert.equal(burning.sourcePlayerIndex, 0, 'the shooter stays the source of the fire');
    assert.equal(findBurning(world.shooter), null, 'the shooter does not set itself alight');
});

test('spawn protection keeps a target from catching fire', () => {
    const world = createWorld();
    armFlamethrower(world.shooter);
    const target = addTarget(world, 1, [0, 0, -6]);
    target.spawnProtectionTimer = 2;

    world.system.fire(world.shooter, 1 / 60);
    assert.equal(findBurning(target), null);
});

test('the afterburn costs 15 hp over three seconds at any frame rate', () => {
    for (const fps of [30, 60, 144]) {
        const world = createWorld();
        const target = addTarget(world, 1, [0, 0, -6]);
        igniteBurning(target, world.shooter);
        const dt = 1 / fps;

        for (let frame = 0; frame < fps * 3; frame += 1) updatePlayerEffects(target, dt);
        const applied = 100 - target.hp;
        assert.ok(
            Math.abs(applied - 15) <= 1,
            `three seconds of afterburn cost 15 (+-1) at ${fps} fps, got ${applied.toFixed(3)}`,
        );

        updatePlayerEffects(target, dt);
        assert.equal(findBurning(target), null, 'the fire goes out on its own');
        const afterEnd = target.hp;
        updatePlayerEffects(target, dt);
        assert.equal(target.hp, afterEnd, 'a burnt out fire costs nothing more');
    }
});

test('a new hit restarts the three seconds instead of extending them', () => {
    const world = createWorld();
    armFlamethrower(world.shooter);
    const target = addTarget(world, 1, [0, 0, -6]);
    igniteBurning(target, world.shooter);

    for (let frame = 0; frame < 120; frame += 1) updatePlayerEffects(target, 1 / 60);
    assert.ok(Math.abs(findBurning(target).remaining - 1) < 0.05, 'one second is left');

    world.system.fire(world.shooter, 1 / 60);
    assert.equal(findBurning(target).remaining, 3, 'the new hit restarts the fixed time');
    assert.equal(
        target.activeEffects.filter((effect) => effect?.type === BURNING).length,
        1,
        'a second hit never stacks a second fire',
    );
});

test('a burning target does not regenerate health', () => {
    const world = createWorld();
    const target = addTarget(world, 1, [0, 0, -6]);
    target.hp = 50;
    igniteBurning(target, world.shooter);

    const dt = 1 / 60;
    let previousHp = target.hp;
    for (let frame = 0; frame < 180; frame += 1) {
        world.entityManager._simulationClockMs += dt * 1000;
        const nowSeconds = world.entityManager._simulationClockMs * 0.001;
        updatePlayerEffects(target, dt);
        updatePlayerHealthRegen(target, dt, world.config, nowSeconds);
        assert.ok(target.hp <= previousHp, 'health never climbs while the fire burns');
        previousHp = target.hp;
    }
    assert.ok(Math.abs(target.hp - 35) <= 1, `15 damage land despite regen, got ${target.hp.toFixed(3)}`);
});

test('a kill by afterburn goes to the source, a vanished source kills without a killer', () => {
    const world = createWorld();
    const target = addTarget(world, 1, [0, 0, -6]);
    target.hp = 4;
    igniteBurning(target, world.shooter);

    for (let frame = 0; frame < 120; frame += 1) updatePlayerEffects(target, 1 / 60);
    assert.equal(target.alive, false, 'the afterburn may kill');
    assert.equal(world.kills.length, 1, 'exactly one kill is booked');
    assert.equal(world.kills[0].options.killer, world.shooter, 'the fire is booked for its source');
    assert.equal(world.damageEvents.at(-1).cause, BURNING);

    const orphan = createWorld();
    const lonely = addTarget(orphan, 1, [0, 0, -6]);
    lonely.hp = 4;
    igniteBurning(lonely, orphan.shooter);
    findBurning(lonely).sourcePlayerIndex = 7;
    for (let frame = 0; frame < 120; frame += 1) updatePlayerEffects(lonely, 1 / 60);
    assert.equal(orphan.kills.length, 1, 'a lost source still books the kill');
    assert.equal(orphan.kills[0].options.killer, null, 'without a source there is no killer');
});

test('the boost key puts the fire out the moment the boost starts', () => {
    const world = createWorld();
    const target = addTarget(world, 1, [0, 0, -6]);
    igniteBurning(target, world.shooter);

    updatePlayerCharges(target, 1 / 60, { boost: true, boostPressed: true });
    assert.equal(target.manualBoostActive, true, 'the key starts the boost');
    assert.equal(findBurning(target), null, 'the boost blows the fire out');
});

test('the speed up item puts the fire out', () => {
    const world = createWorld();
    const target = addTarget(world, 1, [0, 0, -6]);
    igniteBurning(target, world.shooter);

    applyPlayerPowerup(target, 'SPEED_UP');
    assert.equal(findBurning(target), null);
});

test('the boost gate and the portal put the fire out', () => {
    const world = createWorld();
    const target = addTarget(world, 1, [0, 0, -6]);
    const forward = new THREE.Vector3(0, 0, -1);
    world.entityManager._tmpDir = new THREE.Vector3();
    world.entityManager._tmpPrevPlayerPosition = new THREE.Vector3();
    world.entityManager.powerupManager = { checkPickup: () => null };
    target.trail = { forceGap() {}, setWidth() {}, resetWidth() {} };

    world.entityManager.arena = {
        checkSpecialGates: () => ({ ok: true, type: 'boost', params: { duration: 1.5 }, forward }),
        checkPortal: () => null,
        checkExitPortal: () => null,
    };
    const phase = new PlayerInteractionPhase(world.entityManager);
    igniteBurning(target, world.shooter);
    phase.runSpecialGates(target, target.position);
    assert.equal(findBurning(target), null, 'the boost gate blows the fire out');

    world.entityManager.arena = {
        checkSpecialGates: () => null,
        checkPortal: () => ({ target: new THREE.Vector3(20, 0, 20) }),
        checkExitPortal: () => null,
    };
    igniteBurning(target, world.shooter);
    phase.runPortalAndPickup(target, target.position);
    assert.equal(findBurning(target), null, 'the portal jump blows the fire out');
});

test('putting out a fire nobody lit changes nothing', () => {
    const world = createWorld();
    const target = addTarget(world, 1, [0, 0, -6]);
    applyPlayerPowerup(target, 'SHIELD');
    const before = target.activeEffects.length;

    assert.equal(extinguishBurning(target), false, 'nothing to put out');
    updatePlayerCharges(target, 1 / 60, { boost: true, boostPressed: true });
    assert.equal(target.activeEffects.length, before, 'other effects survive an empty extinguish');
});

test('a replica shows the fire but books no damage', () => {
    const world = createWorld({ isFightOutcomeAuthority: false });
    const target = addTarget(world, 1, [0, 0, -6]);
    igniteBurning(target, world.shooter);

    for (let frame = 0; frame < 60; frame += 1) updatePlayerEffects(target, 1 / 60);
    assert.equal(target.hp, 100, 'the host books the afterburn damage');
    assert.ok(findBurning(target), 'the replica still carries the fire for the display');
});

test('classic knows no afterburn', () => {
    const world = createWorld({ mode: 'CLASSIC' });
    armFlamethrower(world.shooter);
    const target = addTarget(world, 1, [0, 0, -6]);

    world.system.fire(world.shooter, 1 / 60);
    assert.equal(findBurning(target), null, 'without hunt health nobody catches fire');
});

test('the burning effect travels in the snapshot and is no item bar badge', () => {
    const world = createWorld();
    const target = addTarget(world, 1, [0, 0, -6]);
    igniteBurning(target, world.shooter);

    const effects = serializePlayer(target).effects;
    const burning = effects.find((effect) => effect.type === BURNING);
    assert.ok(burning, 'the snapshot keeps an effect the pickup registry does not know');
    assert.equal(burning.remaining, 3);
    assert.equal(burning.sourcePlayerIndex, 0);
    // The item bar renders only effects with a registry definition, so the fire needs no entry there.
    assert.equal(getPickupDefinition(BURNING), null);
});

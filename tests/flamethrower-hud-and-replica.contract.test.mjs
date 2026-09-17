import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { serializePlayer } from '../src/core/GameStateSnapshot.js';
import { applyDamage } from '../src/hunt/HealthSystem.js';
import { FLAME_JET_PARTICLE_BUDGET, spawnFlameJet } from '../src/hunt/FlamethrowerFlameEffect.js';
import { FlamethrowerSystem } from '../src/hunt/FlamethrowerSystem.js';
import { applyPlayerPowerup, recomputePlayerEffectState } from '../src/entities/player/PlayerEffectOps.js';
import { StateReconciler } from '../src/network/StateReconciler.js';
import { resolveActiveEffectTimeLabel } from '../src/ui/ItemBarPresenter.js';

const HUNT_MODE_CONFIG = {
    ...CONFIG_BASE,
    HUNT: { ...CONFIG_BASE.HUNT, ENABLED: true, ACTIVE_MODE: 'HUNT', DEFAULT_MODE: 'HUNT' },
};

/**
 * Counts what the flame asks the particle system for. The real Particles instance needs a
 * Three.js mesh, and the only thing this package promises about it is the budget per tick.
 */
function createParticles() {
    return {
        calls: 0,
        spawned: 0,
        spawnDirectional(position, direction, count) {
            this.calls += 1;
            this.spawned += Math.max(0, Number(count) || 0);
        },
    };
}

/**
 * Stands for Player: enough of it that the snapshot, the reconciler and the flame jet can all
 * work on the same object, which is exactly the path a tank value takes from host to replica.
 */
function createPlayer(index, position) {
    return {
        index,
        id: `p-${index}`,
        alive: true,
        isBot: false,
        position: new THREE.Vector3(position[0], position[1], position[2]),
        quaternion: new THREE.Quaternion(),
        velocity: new THREE.Vector3(),
        entityRuntimeConfig: HUNT_MODE_CONFIG,
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
        lastDamageTimestamp: -Infinity,
        aimDirection: new THREE.Vector3(0, 0, -1),
        getAimDirection(out = null) {
            const target = out || new THREE.Vector3();
            return target.copy(this.aimDirection);
        },
        takeDamage(amount, options = {}) {
            return applyDamage(this, amount, { nowSeconds: 0, ...options }, this.entityRuntimeConfig);
        },
    };
}

function createWorld({ isFightOutcomeAuthority = true } = {}) {
    const shooter = createPlayer(0, [0, 0, 0]);
    const particles = createParticles();
    const entityManager = {
        players: [shooter],
        arena: null,
        particles,
        isFightOutcomeAuthority,
        entityRuntimeConfig: HUNT_MODE_CONFIG,
        gameModeStrategy: { hasMachineGun: () => true, getPickupModeType: () => 'HUNT' },
        _staticTurretSystem: { getDestructibleTargets: () => [] },
        _emitHuntDamageEvent() {},
        _killPlayer(player) { player.alive = false; },
    };
    shooter.entityManager = entityManager;
    const system = new FlamethrowerSystem(entityManager);
    entityManager._flamethrowerSystem = system;
    return { entityManager, shooter, particles, system };
}

function armFlamethrower(player) {
    applyPlayerPowerup(player, 'FLAMETHROWER');
    assert.equal(player.hasFlamethrower, true, 'the item arms the flamethrower');
    return player;
}

test('the item bar badge shows the flamethrower tank, not its expiry', () => {
    const label = resolveActiveEffectTimeLabel({ type: 'FLAMETHROWER', remaining: 27.4, fuelSeconds: 3 }, null);
    assert.ok(label.includes('3.0'), `the badge counts the 3 s of fuel left, got "${label}"`);
    assert.ok(!label.includes('27'), `the 30 s expiry never decides the next press, got "${label}"`);

    assert.equal(
        resolveActiveEffectTimeLabel({ type: 'SPEED_UP', remaining: 4.25 }, null),
        '4.3s',
        'every other effect keeps its plain expiry countdown',
    );
    assert.equal(
        resolveActiveEffectTimeLabel({ type: 'SHIELD', remaining: 5 }, { hasShield: true, shieldHP: 12 }),
        '12 HP',
        'the hunt shield keeps showing hit points',
    );
});

test('the player snapshot carries the tank and marks only the ticks that burned', () => {
    const world = createWorld();
    armFlamethrower(world.shooter);

    let snapshot = serializePlayer(world.shooter);
    assert.equal(snapshot.effects[0].fuelSeconds, 6, 'the full tank travels with the effect entry');
    assert.equal(snapshot.flameActive, false, 'an armed but silent player shows no flame');

    world.system.fire(world.shooter, 0.5, true);
    snapshot = serializePlayer(world.shooter);
    assert.equal(snapshot.flameActive, true, 'the tick that really burned shows the flame');
    assert.ok(
        Math.abs(snapshot.effects[0].fuelSeconds - 5.5) < 1e-6,
        `the drained tank travels too, got ${snapshot.effects[0].fuelSeconds}`,
    );

    world.system.fire(world.shooter, 0.5, false);
    assert.equal(serializePlayer(world.shooter).flameActive, false, 'a released key ends the jet at once');
});

test('a replica takes tank and flame from the host snapshot without burning anyone', () => {
    const host = createWorld();
    armFlamethrower(host.shooter);
    host.system.fire(host.shooter, 0.5, true);
    const hostState = { players: [serializePlayer(host.shooter)] };

    const replica = createWorld({ isFightOutcomeAuthority: false });
    const bystander = createPlayer(1, [0, 0, -6]);
    replica.entityManager.players.push(bystander);
    replica.particles.spawned = 0;

    const reconciler = new StateReconciler();
    reconciler.receiveServerState({ state: hostState });
    reconciler.reconcile([replica.shooter], replica.entityManager);

    assert.ok(
        Math.abs(replica.shooter.activeEffects[0].fuelSeconds - 5.5) < 1e-6,
        'the tank reaches the replica so its badge can show the same number',
    );
    assert.equal(replica.shooter.flameActive, true, 'the replica shows the flame the host is spraying');
    assert.ok(replica.particles.spawned > 0, 'the replica really spawns a jet instead of staying dark');
    assert.equal(bystander.hp, 100, 'the replica never burns anyone - the host owns the damage');

    recomputePlayerEffectState(replica.shooter);
    assert.equal(replica.shooter.hasFlamethrower, true, 'the replica derives the armed state from the tank');
});

test('a broken tank is dropped and snapshots without the fields still load', () => {
    const client = createPlayer(0, [0, 0, 0]);
    const reconciler = new StateReconciler();
    reconciler.receiveServerState({
        state: {
            players: [{
                index: 0,
                effects: [
                    { type: 'FLAMETHROWER', remaining: 20, fuelSeconds: 'viel' },
                    { type: 'FLAMETHROWER', remaining: 20, fuelSeconds: -2 },
                    { type: 'SPEED_UP', remaining: 3 },
                ],
            }],
        },
    });
    reconciler.reconcile([client], {});

    assert.equal('fuelSeconds' in client.activeEffects[0], false, 'a tank that is not a number is dropped');
    assert.equal('fuelSeconds' in client.activeEffects[1], false, 'a negative tank is dropped');
    assert.equal('fuelSeconds' in client.activeEffects[2], false, 'effects without a tank stay as they were');
    assert.equal(client.activeEffects[2].remaining, 3, 'the old fields keep working');
    assert.equal(client.flameActive, false, 'a snapshot without flameActive means no flame');
});

test('the flame jet keeps a fixed particle budget per tick', () => {
    assert.ok(FLAME_JET_PARTICLE_BUDGET > 0, 'the jet is visible at all');
    assert.ok(FLAME_JET_PARTICLE_BUDGET <= 8, 'a held burst must not flood the shared particle buffer');

    const world = createWorld();
    armFlamethrower(world.shooter);
    world.system.fire(world.shooter, 1 / 60, true);
    assert.ok(world.particles.spawned > 0, 'firing shows a flame');
    assert.ok(
        world.particles.spawned <= FLAME_JET_PARTICLE_BUDGET,
        `one tick stays inside the budget, got ${world.particles.spawned} of ${FLAME_JET_PARTICLE_BUDGET}`,
    );

    world.particles.spawned = 0;
    world.system.fire(world.shooter, 1 / 60, false);
    assert.equal(world.particles.spawned, 0, 'a released key spawns nothing');

    const silent = createPlayer(2, [0, 0, 0]);
    silent.aimDirection.set(0, 0, 0);
    assert.equal(spawnFlameJet(world.particles, silent), 0, 'without an aim direction there is no jet');
});

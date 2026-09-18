import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { serializePlayer } from '../src/core/GameStateSnapshot.js';
import { BURNING_FLAME_PARTICLE_BUDGET, spawnBurningFlames } from '../src/hunt/FlamethrowerFlameEffect.js';
import { igniteBurning, isPlayerBurning } from '../src/entities/player/PlayerEffectOps.js';
import { StateReconciler } from '../src/network/StateReconciler.js';

const HUNT_MODE_CONFIG = {
    ...CONFIG_BASE,
    HUNT: { ...CONFIG_BASE.HUNT, ENABLED: true, ACTIVE_MODE: 'HUNT', DEFAULT_MODE: 'HUNT' },
};

/**
 * Counts what the afterburn asks the particle system for and keeps the last options object,
 * so the test can prove the render loop hands over the same frozen constant every frame.
 */
function createParticles() {
    return {
        calls: 0,
        spawned: 0,
        lastOptions: null,
        optionsIdentities: new Set(),
        spawnDirectional(position, direction, count, color, speed, size, life, options) {
            this.calls += 1;
            this.spawned += Math.max(0, Number(count) || 0);
            this.lastOptions = options;
            this.optionsIdentities.add(options);
        },
    };
}

function createPlayer(index) {
    return {
        index,
        id: `p-${index}`,
        alive: true,
        isBot: false,
        position: new THREE.Vector3(index * 4, 0, 0),
        quaternion: new THREE.Quaternion(),
        velocity: new THREE.Vector3(),
        entityRuntimeConfig: HUNT_MODE_CONFIG,
        activeEffects: [],
        inventory: [],
        rocketInventory: [],
        selectedItemIndex: 0,
        trail: null,
        hp: 100,
        maxHp: 100,
        shieldHP: 0,
        maxShieldHp: 40,
        hasShield: false,
    };
}

test('a burning vehicle spawns its afterburn flames, a cold or dead one stays dark', () => {
    const particles = createParticles();
    const player = createPlayer(0);

    assert.equal(spawnBurningFlames(particles, player), 0, 'nothing burns before the fire is lit');
    assert.equal(particles.spawned, 0, 'a cold vehicle asks for no particles at all');

    igniteBurning(player);
    assert.equal(isPlayerBurning(player), true, 'the afterburn effect is on the vehicle');
    assert.equal(
        spawnBurningFlames(particles, player),
        BURNING_FLAME_PARTICLE_BUDGET,
        'the burning vehicle spawns its fixed budget',
    );
    assert.equal(particles.spawned, BURNING_FLAME_PARTICLE_BUDGET, 'and asks the system for exactly that many');
    assert.ok(BURNING_FLAME_PARTICLE_BUDGET <= 2, 'two particles a frame keep the shared buffer free');

    particles.spawned = 0;
    player.alive = false;
    assert.equal(spawnBurningFlames(particles, player), 0, 'a wreck shows no flames');
    assert.equal(particles.spawned, 0, 'and spawns nothing');
});

test('the afterburn reuses one frozen options object instead of building one per frame', () => {
    const particles = createParticles();
    const player = createPlayer(0);
    igniteBurning(player);

    spawnBurningFlames(particles, player);
    spawnBurningFlames(particles, player);

    assert.equal(particles.optionsIdentities.size, 1, 'every frame hands over the very same options object');
    assert.equal(Object.isFrozen(particles.lastOptions), true, 'the options constant cannot be changed by a caller');
});

test('a replica burns from the snapshot alone, without any damage of its own', () => {
    const host = createPlayer(0);
    igniteBurning(host);

    const replica = createPlayer(0);
    const particles = createParticles();
    const reconciler = new StateReconciler();
    reconciler.receiveServerState({ state: { players: [serializePlayer(host)] } });
    reconciler.reconcile([replica], {});

    assert.equal(isPlayerBurning(replica), true, 'the afterburn travels in the snapshot');
    assert.equal(
        spawnBurningFlames(particles, replica),
        BURNING_FLAME_PARTICLE_BUDGET,
        'so the replica shows the same flames as the host',
    );
    assert.equal(replica.hp, 100, 'the replica only draws the fire, the host owns the damage');
});

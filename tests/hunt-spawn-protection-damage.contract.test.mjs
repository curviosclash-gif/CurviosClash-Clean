import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { Player } from '../src/entities/Player.js';
import { ProjectileHitResolver } from '../src/entities/systems/projectile/ProjectileHitResolver.js';
import { MGHitResolver } from '../src/hunt/mg/MGHitResolver.js';
import { resetPlayerHealth } from '../src/hunt/HealthSystem.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

const HUNT_RUNTIME_CONFIG = createEntityRuntimeConfig(null, CONFIG_BASE);

function createRenderer() {
    return { addToScene() {}, removeFromScene() {} };
}

// Real vehicles in a Fight round: full health, placed apart, nothing else attached.
function createFightPlayer(index, position) {
    const entityManager = {
        entityRuntimeConfig: HUNT_RUNTIME_CONFIG,
        _simulationClockMs: 5000,
        getTrailSpatialIndex() { return null; },
    };
    const player = new Player(createRenderer(), index, 0x33aaff, false, { entityManager });
    player.spawn(position, new THREE.Vector3(0, 0, -1));
    resetPlayerHealth(player, HUNT_RUNTIME_CONFIG);
    return player;
}

function createMgRuntime(players, kills) {
    return {
        players,
        events: { emitHuntDamageEvent() {} },
        lifecycle: { killPlayer(target, cause) { kills.push({ target, cause }); } },
    };
}

test('the respawn protection swallows machine gun hits', () => {
    const shooter = createFightPlayer(0, new THREE.Vector3(0, 20, 40));
    const target = createFightPlayer(1, new THREE.Vector3(0, 20, 0));
    target.spawnProtectionTimer = HUNT_RUNTIME_CONFIG.HUNT.RESPAWN.INVULNERABILITY_SECONDS;
    const kills = [];
    const resolver = new MGHitResolver(createMgRuntime([shooter, target], kills));

    // Twenty hits at point blank are far beyond 100 structure without protection.
    for (let i = 0; i < 20; i++) {
        resolver.applyHit(shooter, target, 5, HUNT_RUNTIME_CONFIG.HUNT.MG);
    }

    assert.equal(target.hp, target.maxHp, 'a protected vehicle must not lose structure');
    assert.equal(kills.length, 0, 'a protected vehicle must not be shot down');
});

test('the machine gun hurts again once the protection has run out', () => {
    const shooter = createFightPlayer(0, new THREE.Vector3(0, 20, 40));
    const target = createFightPlayer(1, new THREE.Vector3(0, 20, 0));
    target.spawnProtectionTimer = 0;
    const resolver = new MGHitResolver(createMgRuntime([shooter, target], []));

    resolver.applyHit(shooter, target, 5, HUNT_RUNTIME_CONFIG.HUNT.MG);

    assert.ok(target.hp < target.maxHp, `an unprotected hit has to cost structure, hp ${target.hp}`);
});

test('the respawn protection swallows rocket blasts', () => {
    const shooter = createFightPlayer(0, new THREE.Vector3(0, 20, 60));
    const target = createFightPlayer(1, new THREE.Vector3(0, 20, 0));
    target.spawnProtectionTimer = HUNT_RUNTIME_CONFIG.HUNT.RESPAWN.INVULNERABILITY_SECONDS;
    const resolver = new ProjectileHitResolver({ entityRuntimeConfig: HUNT_RUNTIME_CONFIG });
    const projectile = {
        type: 'ROCKET_MEGA',
        owner: shooter,
        position: new THREE.Vector3(0, 20, 1),
    };

    resolver._applyRocketExplosion(projectile, [shooter, target], null);

    assert.equal(target.hp, target.maxHp, 'a mega rocket next to a protected vehicle must not hurt it');
    assert.equal(target.alive, true);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { Player } from '../src/entities/Player.js';
import { ProjectileHitResolver } from '../src/entities/systems/projectile/ProjectileHitResolver.js';
import { applyHit } from '../src/entities/combat/CombatPipeline.js';
import { resetPlayerHealth } from '../src/hunt/HealthSystem.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

// The default runtime config runs HUNT, where the shield is a pool (shieldHP) and not a flag.
const HUNT_RUNTIME_CONFIG = createEntityRuntimeConfig(null, CONFIG_BASE);

function createRenderer() {
    return { addToScene() {}, removeFromScene() {} };
}

function createFightPlayer(index, position) {
    const entityManager = {
        entityRuntimeConfig: HUNT_RUNTIME_CONFIG,
        _simulationClockMs: 5000,
        getTrailSpatialIndex() { return null; },
    };
    const player = new Player(createRenderer(), index, 0x33aaff, false, { entityManager });
    player.spawn(position, new THREE.Vector3(0, 0, -1));
    resetPlayerHealth(player, HUNT_RUNTIME_CONFIG);
    player.spawnProtectionTimer = 0;
    return player;
}

// The resolver reaches the pipeline only through runtimeContext.combat, as in the live
// ProjectileSystem; the world records damage events so a swallowed hit stays visible.
function createResolver(players) {
    const strategy = new HuntModeStrategy({ entityRuntimeConfig: HUNT_RUNTIME_CONFIG });
    const events = [];
    const world = {
        players,
        gameModeStrategy: strategy,
        _emitHuntDamageEvent(event) { events.push(event); },
        _killPlayer(target) { target.alive = false; },
    };
    const resolver = new ProjectileHitResolver({
        entityRuntimeConfig: HUNT_RUNTIME_CONFIG,
        _tmpVec: new THREE.Vector3(),
        runtimeContext: {
            players,
            callbacks: { getSimulationNowMs: () => 5000 },
            combat: { applyPlayerHit: (hit) => applyHit(world, hit) },
        },
    });
    return { resolver, strategy, events };
}

function shootAt(resolver, owner, target, type, players) {
    const projectile = {
        type,
        owner,
        radius: 1,
        position: target.position.clone(),
    };
    return resolver.resolveProjectileOutcome(projectile, players, null, {});
}

test('a mine against a shielded hunt vehicle drains the shield pool instead of hiding it', () => {
    const owner = createFightPlayer(0, new THREE.Vector3(0, 20, 60));
    const target = createFightPlayer(1, new THREE.Vector3(0, 20, 0));
    const players = [owner, target];
    const { resolver, strategy, events } = createResolver(players);
    strategy.grantShield(target, HUNT_RUNTIME_CONFIG);
    const shieldBefore = target.shieldHP;
    assert.ok(shieldBefore > 0, 'the granted shield has a pool');

    assert.equal(shootAt(resolver, owner, target, 'MINE', players), true, 'the mine reaches the target');

    assert.ok(target.shieldHP < shieldBefore, `the mine has to cost shield, shieldHP ${target.shieldHP} of ${shieldBefore}`);
    assert.equal(target.hasShield, target.shieldHP > 0, 'the shield flag and the shield pool agree after the mine');
    assert.equal(events.length, 1, 'the absorbed mine is published as one damage event');
});

test('after a mine no ghost shield swallows the next rocket', () => {
    const owner = createFightPlayer(0, new THREE.Vector3(0, 20, 60));
    const target = createFightPlayer(1, new THREE.Vector3(0, 20, 0));
    const players = [owner, target];
    const { resolver, strategy } = createResolver(players);
    strategy.grantShield(target, HUNT_RUNTIME_CONFIG);

    shootAt(resolver, owner, target, 'MINE', players);
    // Break whatever shield is still shown, then the next hit must reach the structure.
    while (target.hasShield && target.alive) shootAt(resolver, owner, target, 'MINE', players);
    const hpBefore = target.hp;
    shootAt(resolver, owner, target, 'ROCKET_WEAK', players);

    assert.equal(target.shieldHP, 0, 'no shield pool is left behind once the HUD shows no shield');
    assert.ok(target.hp < hpBefore, `a rocket on an unshielded vehicle costs structure, hp ${target.hp} of ${hpBefore}`);
});

test('a non-damaging item projectile that breaks a hunt shield also empties its pool', () => {
    const owner = createFightPlayer(0, new THREE.Vector3(0, 20, 60));
    const target = createFightPlayer(1, new THREE.Vector3(0, 20, 0));
    const players = [owner, target];
    const { resolver, strategy } = createResolver(players);
    strategy.grantShield(target, HUNT_RUNTIME_CONFIG);
    // The live callback logs ITEM_HIT_SUCCESS; a blocked item must not count as a hit.
    const itemHits = [];
    resolver.system.onProjectileDamage = (_target, _owner, type) => itemHits.push(type);

    shootAt(resolver, owner, target, 'INVERT', players);

    assert.equal(target.hasShield, false, 'the shield blocks the item and is used up');
    assert.equal(target.shieldHP, 0, 'a broken shield keeps no hidden pool');
    assert.notEqual(target.invertControls, true, 'the shield kept the item effect away');
    assert.deepEqual(itemHits, [], 'an item the shield stopped is not reported as a successful item hit');
});

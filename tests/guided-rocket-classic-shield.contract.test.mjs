import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { Player } from '../src/entities/Player.js';
import { ProjectileHitResolver } from '../src/entities/systems/projectile/ProjectileHitResolver.js';
import { applyHit } from '../src/entities/combat/CombatPipeline.js';
import { ClassicModeStrategy } from '../src/modes/ClassicModeStrategy.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

// User decision 19.10.2026: in Classic the shield also stops the guided rocket once,
// like every other hit, instead of the rocket killing straight through it.
const CLASSIC_RUNTIME_CONFIG = createEntityRuntimeConfig(null, {
    ...CONFIG_BASE,
    HUNT: { ...CONFIG_BASE.HUNT, ENABLED: false, ACTIVE_MODE: 'CLASSIC', DEFAULT_MODE: 'CLASSIC' },
});

function createClassicPlayer(strategy, index, position) {
    const entityManager = {
        entityRuntimeConfig: CLASSIC_RUNTIME_CONFIG,
        gameModeStrategy: strategy,
        _simulationClockMs: 5000,
        getTrailSpatialIndex() { return null; },
    };
    const player = new Player(createRenderer(), index, 0x33aaff, false, { entityManager });
    player.spawn(position, new THREE.Vector3(0, 0, -1));
    strategy.resetPlayerHealth(player);
    player.spawnProtectionTimer = 0;
    return player;
}

function createRenderer() {
    return { addToScene() {}, removeFromScene() {} };
}

// Wired like the live ProjectileSystem: the resolver reaches the pipeline via runtimeContext.
function createResolver(strategy, players, kills) {
    const world = {
        players,
        gameModeStrategy: strategy,
        _emitHuntDamageEvent() {},
        _killPlayer(target) { target.alive = false; kills.push(target); },
    };
    return new ProjectileHitResolver({
        entityRuntimeConfig: CLASSIC_RUNTIME_CONFIG,
        _tmpVec: new THREE.Vector3(),
        runtimeContext: {
            players,
            callbacks: { getSimulationNowMs: () => 5000 },
            combat: { applyPlayerHit: (hit) => applyHit(world, hit) },
        },
    });
}

function fireGuidedRocket(resolver, owner, target, players) {
    const projectile = { type: 'ROCKET_GUIDED', owner, radius: 1, position: target.position.clone() };
    return resolver.resolveProjectileOutcome(projectile, players, null, {});
}

test('a Classic shield stops the guided rocket once and breaks', () => {
    const strategy = new ClassicModeStrategy({ random: () => 0.5, nowMs: () => 5000 });
    const owner = createClassicPlayer(strategy, 0, new THREE.Vector3(0, 20, 80));
    const target = createClassicPlayer(strategy, 1, new THREE.Vector3(0, 20, 0));
    const players = [owner, target];
    const kills = [];
    const resolver = createResolver(strategy, players, kills);
    strategy.grantShield(target);

    assert.equal(fireGuidedRocket(resolver, owner, target, players), true, 'the rocket reaches the target');

    assert.equal(target.alive, true, 'the shield saved the target from the guided rocket');
    assert.equal(kills.length, 0);
    assert.equal(target.hasShield, false, 'the shield is used up by the rocket');
    assert.equal(target.shieldHP, 0, 'no hidden shield remainder is left for a later shield contact');
});

test('a shielded Classic bystander is also saved once by its shield from the guided rocket blast', () => {
    const strategy = new ClassicModeStrategy({ random: () => 0.5, nowMs: () => 5000 });
    const owner = createClassicPlayer(strategy, 0, new THREE.Vector3(0, 20, 80));
    const target = createClassicPlayer(strategy, 1, new THREE.Vector3(0, 20, 0));
    const bystander = createClassicPlayer(strategy, 2, new THREE.Vector3(3, 20, 0));
    const players = [owner, target, bystander];
    const kills = [];
    const resolver = createResolver(strategy, players, kills);
    strategy.grantShield(bystander);

    fireGuidedRocket(resolver, owner, target, players);

    assert.deepEqual(kills.map((player) => player.index), [1], 'only the unshielded direct target dies');
    assert.equal(bystander.alive, true, 'the bystander shield stopped the blast');
    assert.equal(bystander.hasShield, false, 'the blast used up the bystander shield');
});

test('a second guided rocket on the now unshielded Classic target still kills it', () => {
    const strategy = new ClassicModeStrategy({ random: () => 0.5, nowMs: () => 5000 });
    const owner = createClassicPlayer(strategy, 0, new THREE.Vector3(0, 20, 80));
    const target = createClassicPlayer(strategy, 1, new THREE.Vector3(0, 20, 0));
    const players = [owner, target];
    const kills = [];
    const resolver = createResolver(strategy, players, kills);
    strategy.grantShield(target);

    fireGuidedRocket(resolver, owner, target, players);
    fireGuidedRocket(resolver, owner, target, players);

    assert.deepEqual(kills.map((player) => player.index), [1], 'without a shield the guided rocket is lethal as before');
});

test('the guided rocket still explodes on a Classic shield and hits an unshielded bystander', () => {
    const strategy = new ClassicModeStrategy({ random: () => 0.5, nowMs: () => 5000 });
    const owner = createClassicPlayer(strategy, 0, new THREE.Vector3(0, 20, 80));
    const target = createClassicPlayer(strategy, 1, new THREE.Vector3(0, 20, 0));
    const bystander = createClassicPlayer(strategy, 2, new THREE.Vector3(3, 20, 0));
    const players = [owner, target, bystander];
    const kills = [];
    const resolver = createResolver(strategy, players, kills);
    strategy.grantShield(target);

    fireGuidedRocket(resolver, owner, target, players);

    assert.equal(target.alive, true, 'the shielded target survives');
    assert.deepEqual(kills.map((player) => player.index), [2], 'the blast around the shield keeps its area effect');
});

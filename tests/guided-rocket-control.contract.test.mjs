import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CONFIG_BASE } from '../src/core/Config.js';
import { createGameStateSnapshot } from '../src/core/GameStateSnapshot.js';
import { ProjectileSystem } from '../src/entities/systems/ProjectileSystem.js';
import { PlayerInputSystem } from '../src/entities/systems/PlayerInputSystem.js';
import { normalizeNetworkInputState } from '../src/ui/NetworkMatchInputSources.js';
import { applyGuidedRocketInput, stepGuidedRocket } from '../src/entities/systems/projectile/GuidedRocketControlOps.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

function createShot() {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const owner = {
        index: 0, alive: true, isBot: false, position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(), shootCooldown: 0, activeEffects: [],
        inventory: [], rocketInventory: ['ROCKET_GUIDED'],
        getAimDirection(out) { return out.set(1, 0, 0); },
    };
    const system = new ProjectileSystem({
        entityRuntimeConfig, players: [owner],
        getStrategy: () => new HuntModeStrategy({ entityRuntimeConfig }),
    });
    assert.equal(system.shootItemProjectile(owner, -1, true).ok, true);
    return { owner, system, projectile: system.projectiles[0], entityRuntimeConfig };
}

test('one guided rocket takes only its owner input and forwards host input fields', () => {
    const { owner, system, projectile } = createShot();
    assert.equal(projectile.guidedActive, true);
    assert.equal(projectile.homingEnabled, false);
    assert.equal(system.applyGuidedInput({ index: 1 }, { yawAxis: 1 }), false);
    const entityManager = { humanPlayers: [owner], _projectileSystem: system };
    const inputSystem = new PlayerInputSystem(entityManager);
    const remoteInput = normalizeNetworkInputState({ yawAxis: 0.7, pitchAxis: -0.3,
        boostPressed: true, shootRocket: true });
    const flightInput = inputSystem.resolvePlayerInput(owner, 0.1, { getPlayerInput: () => remoteInput });
    assert.equal(projectile.steerYaw, 0.7);
    assert.equal(projectile.steerPitch, -0.3);
    assert.equal(projectile.boostRemaining, 2);
    assert.equal(flightInput.shootRocket, false, 'rocket control cannot fire or cancel early');
    assert.equal(flightInput.boost, false, 'pilot does not consume the boost');
    const snapshot = createGameStateSnapshot({ players: [owner], projectiles: [projectile] });
    assert.equal(snapshot.projectiles[0].guided, true);
    const replica = new ProjectileSystem({ entityRuntimeConfig: system.entityRuntimeConfig, players: [owner] });
    replica.applyNetworkSnapshot(snapshot.projectiles, [owner]);
    assert.equal(replica.projectiles[0].guidedActive, true);
    replica.dispose();
    system.dispose();
});

test('boost is 1.5x for exactly two seconds and turns more slowly', () => {
    const config = { GUIDED_SPEED: 70, GUIDED_TURN_RATE: 2.5,
        GUIDED_BOOST_MULTIPLIER: 1.5, GUIDED_BOOST_SECONDS: 2, GUIDED_BOOST_TURN_RATE: 1.8 };
    const normal = { velocity: new THREE.Vector3(70, 0, 0), steerYaw: 1, steerPitch: 0,
        boostRemaining: 0, boostUsed: false };
    const boosted = { velocity: new THREE.Vector3(70, 0, 0), steerYaw: 1, steerPitch: 0,
        boostRemaining: 0, boostUsed: false };
    const scratch = new THREE.Vector3();
    applyGuidedRocketInput(boosted, { yawAxis: 1, boostPressed: true }, config);
    stepGuidedRocket(boosted, 0.1, config, scratch);
    stepGuidedRocket(normal, 0.1, config, scratch);
    assert.ok(Math.abs(Math.atan2(boosted.velocity.z, boosted.velocity.x))
        < Math.abs(Math.atan2(normal.velocity.z, normal.velocity.x)));
    for (let index = 1; index < 20; index += 1) {
        stepGuidedRocket(boosted, 0.1, config, scratch);
        stepGuidedRocket(normal, 0.1, config, scratch);
    }
    assert.equal(boosted.boostRemaining, 0);
    assert.ok(boosted.velocity.length() > 104.9 && boosted.velocity.length() < 105.1);
    applyGuidedRocketInput(boosted, { boostPressed: true }, config);
    stepGuidedRocket(boosted, 0.1, config, scratch);
    assert.equal(boosted.boostRemaining, 0);
    assert.ok(boosted.velocity.length() > 69.9 && boosted.velocity.length() < 70.1);
    assert.equal(boosted.boostUsed, true);
});

test('guided projectile state is cleared when the rocket is recycled', () => {
    const { owner, system, projectile } = createShot();
    system.applyGuidedInput(owner, { yawAxis: 1, boostPressed: true });
    system._removeProjectileAt(0);
    assert.equal(system.getGuidedProjectileForOwner(owner), null);
    const recycled = system._acquireProjectileState();
    assert.equal(recycled.guidedActive, false);
    assert.equal(recycled.boostUsed, false);
    assert.equal(recycled.steerYaw, 0);
    system.dispose();
});

test('time expiry removes the rocket and returns its input route', () => {
    const { owner, system, projectile } = createShot();
    projectile.ttl = 0.01;
    system.update(0.02);
    assert.equal(system.getGuidedProjectileForOwner(owner), null);
    system.dispose();
});

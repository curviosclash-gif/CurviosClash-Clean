import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CONFIG_BASE } from '../src/core/Config.js';
import { ProjectileSystem } from '../src/entities/systems/ProjectileSystem.js';
import { PlayerInputSystem } from '../src/entities/systems/PlayerInputSystem.js';
import { applyGuidedRocketInput } from '../src/entities/systems/projectile/GuidedRocketControlOps.js';
import { KillcamSystem } from '../src/hunt/KillcamSystem.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

function createPlayer(index, x, extra = {}) {
    return {
        index, alive: true, isBot: index !== 0, hp: 100, maxHp: 100, hitboxRadius: 0.8,
        position: new THREE.Vector3(x, 0, 0), velocity: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(), shootCooldown: 0, activeEffects: [],
        inventory: [], rocketInventory: [],
        getAimDirection(out) { return out.set(1, 0, 0); },
        getDirection(out) { return out.set(1, 0, 0); },
        ...extra,
    };
}

function createMatch({ killcam = false } = {}) {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const owner = createPlayer(0, 0, { rocketInventory: ['ROCKET_GUIDED', 'ROCKET_WEAK'] });
    const enemy = createPlayer(1, 60);
    const manager = {
        players: [owner, enemy], humanPlayers: [owner], botByPlayer: new Map(),
        entityRuntimeConfig, runtimeConfig: { session: {} },
        renderer: { cameraModes: [0], cycleCamera() {} },
        botPolicyRegistry: { create: () => ({ type: 'heuristic', update: () => ({ yawAxis: -0.4 }) }) },
        createBotRuntimeContext: () => ({}),
    };
    owner.entityManager = manager;
    if (killcam) {
        manager._killcamSystem = new KillcamSystem({
            entityManager: manager, renderer: { cameras: [new THREE.PerspectiveCamera()] },
        });
    }
    const system = new ProjectileSystem({
        entityRuntimeConfig, players: manager.players,
        getStrategy: () => new HuntModeStrategy({ entityRuntimeConfig }),
        onGuidedRocketImpact: (projectile) => manager._killcamSystem?.onGuidedRocketImpact(
            projectile.owner, projectile.position, projectile.velocity) === true,
    });
    manager._projectileSystem = system;
    assert.equal(system.shootItemProjectile(owner, -1, true).ok, true);
    const inputSystem = new PlayerInputSystem(manager);
    const frame = (input) => inputSystem.resolvePlayerInput(owner, 1 / 60, { getPlayerInput: () => input });
    return { owner, enemy, manager, system, frame, projectile: system.projectiles[0] };
}

test('the rocket pitches like the ship: menu inversion, INVERT item and planar mode apply', () => {
    const rocket = (owner) => ({ velocity: new THREE.Vector3(70, 0, 0), owner });
    const plain = rocket({});
    applyGuidedRocketInput(plain, { pitchUp: true, yawLeft: true });
    assert.equal(plain.steerPitch, 1);
    const inverted = rocket({ invertPitchBase: true });
    applyGuidedRocketInput(inverted, { pitchUp: true, yawLeft: true });
    assert.equal(inverted.steerPitch, -1, 'the pitch inversion from the settings reaches the rocket');
    assert.equal(inverted.steerYaw, 1, 'yaw stays untouched by the pitch inversion');
    const itemInverted = rocket({ invertControls: true });
    applyGuidedRocketInput(itemInverted, { pitchAxis: 0.5, yawAxis: 0.5 });
    assert.deepEqual([itemInverted.steerPitch, itemInverted.steerYaw], [-0.5, -0.5]);
    const planar = rocket({ config: { GAMEPLAY: { ...CONFIG_BASE.GAMEPLAY, PLANAR_MODE: true } } });
    applyGuidedRocketInput(planar, { pitchUp: true });
    assert.equal(planar.steerPitch, 0);
});

test('pressing fire again lets go: the rocket homes on its own and the ship gets its pilot back', () => {
    const { owner, enemy, manager, system, frame, projectile } = createMatch();
    frame({ yawAxis: 0.5 });
    assert.equal(projectile.steerYaw, 0.5);

    const releaseFrame = frame({ shootRocket: true });
    assert.equal(projectile.guidedActive, false, 'the fire key releases the rocket');
    assert.equal(projectile.homingEnabled, true);
    assert.equal(projectile.targetReacquireDisabled, false);
    assert.equal(projectile.target?.playerIndex, enemy.index, 'it picks the enemy ahead by itself');
    assert.equal(releaseFrame.shootRocket, false, 'the releasing press does not fire the next rocket');
    assert.deepEqual(owner.rocketInventory, ['ROCKET_WEAK']);
    assert.equal(system.projectiles.length, 1);

    const next = frame({ yawAxis: 0.25 });
    assert.equal(owner.autopilotActive, false, 'control returns the frame after the release');
    assert.equal(manager.botByPlayer.has(owner), false);
    assert.equal(next.yawAxis, 0.25, 'the ship obeys the player again');
    assert.equal(projectile.steerYaw, 0, 'the free rocket no longer takes stick input');
    system.dispose();
});

test('a rocket steered into its blast shows the impact killcam while the autopilot keeps flying', () => {
    const { owner, manager, system, frame } = createMatch({ killcam: true });
    const killcam = manager._killcamSystem;
    system._removeProjectileAt(0);
    assert.equal(killcam.ownsCamera(0), true, 'the owner camera films the explosion');
    assert.equal(owner.autopilotActive, true, 'the ship is not left without a pilot mid-flight');
    assert.equal(frame({ yawAxis: 0.9 }).yawAxis, -0.4, 'the autopilot flies while the killcam runs');

    for (let step = 0; step < 150; step += 1) killcam.update(1 / 60);
    assert.equal(killcam.isActive(), false, 'the impact killcam ends by itself');
    assert.equal(frame({ yawAxis: 0.9 }).yawAxis, 0.9, 'control returns after the killcam');
    assert.equal(owner.autopilotActive, false);
    killcam.dispose();
    system.dispose();
});

test('a released rocket shows no killcam, and neither bots nor a second human get one', () => {
    const { owner, manager, system, frame } = createMatch({ killcam: true });
    frame({ shootRocket: true });
    system._removeProjectileAt(0);
    assert.equal(manager._killcamSystem.isActive(), false, 'only a rocket steered all the way in');

    const killcam = manager._killcamSystem;
    const point = new THREE.Vector3(10, 0, 0);
    assert.equal(killcam.onGuidedRocketImpact({ ...owner, isBot: true }, point), false);
    assert.equal(killcam.onGuidedRocketImpact({ ...owner, alive: false }, point), false);
    manager.humanPlayers = [owner, { index: 1 }];
    assert.equal(killcam.onGuidedRocketImpact(owner, point), false, 'split screen keeps both views live');
    manager.humanPlayers = [owner];
    assert.equal(killcam.onGuidedRocketImpact(owner, point), true);
    assert.equal(killcam.onGuidedRocketImpact(owner, point), false, 'a running killcam is never replaced');
    killcam.dispose();
    system.dispose();
});

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { HUNT_CONFIG } from '../src/hunt/HuntConfig.js';
import { OverheatGunSystem } from '../src/hunt/OverheatGunSystem.js';
import { resolvePlayerMachineGunConfig } from '../src/hunt/mg/MGConfigResolver.js';
import { GAMEPLAY_ACTION_RESULT_CODES } from '../src/shared/contracts/GameplayActionResultContract.js';

function createCombat(machineGunId, distance = 20, angleDegrees = 10) {
    const player = {
        index: 0,
        alive: true,
        isBot: false,
        shootCooldown: 0,
        position: new THREE.Vector3(),
        arcadeWeaponLoadout: { machineGunId, mgLevel: 1, mgDamagePct: 100, masterCount: 0 },
        getAimDirection(out) { return out.set(0, 0, -1); },
    };
    const target = {
        index: 1,
        alive: true,
        hp: 500,
        hitboxRadius: 1.5,
        damage: [],
        position: new THREE.Vector3(),
        takeDamage(amount) {
            this.damage.push(amount);
            this.hp -= amount;
            return { isDead: this.hp <= 0 };
        },
    };
    const manager = { players: [player], gameModeStrategy: { hasMachineGun: () => true } };
    const runtime = {
        players: [player, target],
        services: { entityRuntimeConfig: { HUNT: { MG: HUNT_CONFIG.MG } } },
    };
    const system = new OverheatGunSystem(manager, runtime);
    const moveTarget = (range = distance, angle = angleDegrees) => {
        const radians = THREE.MathUtils.degToRad(angle);
        target.position.set(Math.sin(radians) * range, 0, -Math.cos(radians) * range);
    };
    moveTarget();
    return { player, target, manager, runtime, system, moveTarget };
}

function fireReady(system, player) {
    player.shootCooldown = 0;
    return system.tryFire(player);
}

test('Puls uses three burst intervals, then the configured pause, and heat drives overheat lockout', () => {
    const { player, system } = createCombat('pulse_p3', 20, 0);
    const config = resolvePlayerMachineGunConfig(HUNT_CONFIG.MG, player);
    const first = fireReady(system, player);
    assert.equal(first.ok, true);
    assert.equal(player.arcadeBurstShots, 1);
    assert.equal(player.shootCooldown, config.BURST_INTERVAL);

    const second = fireReady(system, player);
    assert.equal(second.ok, true);
    assert.equal(player.arcadeBurstShots, 2);
    assert.equal(player.shootCooldown, config.BURST_INTERVAL);

    const third = fireReady(system, player);
    assert.equal(third.ok, true);
    assert.equal(player.arcadeBurstShots, 0);
    assert.equal(player.shootCooldown, config.BURST_PAUSE);
    assert.ok(config.BURST_PAUSE > config.BURST_INTERVAL);
    const heatBeforeCooling = system.getOverheatValue(player.index);
    system.update(0.1);
    assert.ok(system.getOverheatValue(player.index) < heatBeforeCooling);

    let lockout = null;
    for (let shot = 0; shot < 9; shot += 1) {
        const result = fireReady(system, player);
        if (result.code === GAMEPLAY_ACTION_RESULT_CODES.MG_SHOOT_OVERHEATED) {
            lockout = result;
            break;
        }
    }
    assert.ok(lockout, 'continued burst firing reaches the existing heat lockout');
    assert.equal(player.arcadeBurstShots, 0, 'forced lockout closes the partial burst');
    assert.ok(Number.isFinite(system.getOverheatValue(player.index)));
});

test('MG reset and player reset clear Puls burst progress before a restarted burst', () => {
    const { player, system } = createCombat('pulse_p3', 20, 0);
    const config = resolvePlayerMachineGunConfig(HUNT_CONFIG.MG, player);

    fireReady(system, player);
    assert.equal(player.arcadeBurstShots, 1);
    const cooldownBeforePlayerReset = player.shootCooldown;
    system.resetPlayer(player.index);
    assert.equal(system.getOverheatValue(player.index), 0);
    assert.equal(player.arcadeBurstShots, 0);
    assert.equal(player.shootCooldown, cooldownBeforePlayerReset);
    assert.equal(fireReady(system, player).ok, true);
    assert.equal(player.arcadeBurstShots, 1);
    assert.equal(player.shootCooldown, config.BURST_INTERVAL);

    const cooldownBeforeRunReset = player.shootCooldown;
    system.reset();
    assert.equal(system.getOverheatValue(player.index), 0);
    assert.equal(player.arcadeBurstShots, 0);
    assert.equal(player.shootCooldown, cooldownBeforeRunReset);
    assert.equal(fireReady(system, player).ok, true);
    assert.equal(player.arcadeBurstShots, 1);
    assert.equal(player.shootCooldown, config.BURST_INTERVAL);
});

test('real MG aim assist tracks moving targets and real spatial hits use gun falloff at 20, 60, and 100', () => {
    const observations = [];
    for (const machineGunId of ['vector_m7', 'ember_g5', 'lance_p4']) {
        const damagesByDistance = new Map();
        for (const distance of [20, 60, 100]) {
            const { player, target, system, moveTarget } = createCombat(machineGunId, distance, 10);
            const config = resolvePlayerMachineGunConfig(HUNT_CONFIG.MG, player);
            const acquired = fireReady(system, player);
            assert.equal(player.fightAimAssistTarget, target, `${machineGunId} acquired a valid target at ${distance}`);
            assert.equal(acquired.hit, true);
            assert.equal(target.damage.length, 1);
            assert.ok(Number.isFinite(target.damage[0]));
            damagesByDistance.set(distance, target.damage[0]);

            moveTarget(distance, 15);
            const moved = fireReady(system, player);
            assert.equal(player.fightAimAssistTarget, target, `${machineGunId} retained the moving target at ${distance}`);
            assert.equal(moved.hit, true);
            assert.equal(target.damage.length, 2);
            assert.ok(target.damage.every(Number.isFinite));
            observations.push({ machineGunId, distance, effectiveRange: config.RANGE, damage: [...target.damage] });
        }
        assert.ok(damagesByDistance.get(20) > damagesByDistance.get(100), `${machineGunId} applies actual falloff`);
    }
    assert.equal(observations.length, 9);
});

test('real acquisition rejects invalid or out-of-range targets; Lance reaches farther than Vector', () => {
    const vector = createCombat('vector_m7', 60, 30);
    const vectorMiss = fireReady(vector.system, vector.player);
    assert.equal(vector.player.fightAimAssistTarget, null);
    assert.equal(vectorMiss.hit, false);
    assert.equal(vector.target.damage.length, 0);

    const vectorConfig = resolvePlayerMachineGunConfig(HUNT_CONFIG.MG, vector.player);
    vector.moveTarget(vectorConfig.RANGE + 5, 0);
    assert.equal(fireReady(vector.system, vector.player).hit, false);
    assert.equal(vector.target.damage.length, 0);

    const lance = createCombat('lance_p4', 170, 10);
    const lanceConfig = resolvePlayerMachineGunConfig(HUNT_CONFIG.MG, lance.player);
    assert.ok(lanceConfig.RANGE > vectorConfig.RANGE);
    const lanceHit = fireReady(lance.system, lance.player);
    assert.equal(lance.player.fightAimAssistTarget, lance.target);
    assert.equal(lanceHit.hit, true);
    assert.equal(lance.target.damage.length, 1);

    lance.moveTarget(lanceConfig.RANGE + 5, 0);
    assert.equal(fireReady(lance.system, lance.player).hit, false);
    assert.equal(lance.target.damage.length, 1);

    const invalid = createCombat('vector_m7', 40, 0);
    invalid.target.alive = false;
    assert.equal(fireReady(invalid.system, invalid.player).hit, false);
    assert.equal(invalid.target.damage.length, 0);
});

test('Glut overheat rises more slowly than Vector in actual player firing', () => {
    const vector = createCombat('vector_m7', 20, 0);
    const ember = createCombat('ember_g5', 20, 0);
    const vectorResult = fireReady(vector.system, vector.player);
    const emberResult = fireReady(ember.system, ember.player);
    assert.ok(Number.isFinite(vectorResult.overheat));
    assert.ok(Number.isFinite(emberResult.overheat));
    assert.ok(emberResult.overheat < vectorResult.overheat);
});

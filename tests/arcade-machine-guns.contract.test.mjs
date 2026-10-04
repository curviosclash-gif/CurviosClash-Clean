import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { HUNT_CONFIG } from '../src/hunt/HuntConfig.js';
import { OverheatGunSystem } from '../src/hunt/OverheatGunSystem.js';
import { advanceShootCooldown } from '../src/entities/player/PlayerShootCooldownOps.js';
import { resolvePlayerMachineGunConfig } from '../src/hunt/mg/MGConfigResolver.js';
import {
    ARCADE_MACHINE_GUN_IDS,
    arcadeWeaponLevelCostXp,
    evaluateArcadeWeaponLevelPurchase,
    normalizeArcadeWeaponProfileFields,
    resolveArcadeMachineGunLevelEffects,
    resolveArcadeMachineGunUnlockLevel,
    resolveArcadeOwnedMachineGuns,
    selectArcadeMachineGun,
} from '../src/shared/contracts/ArcadeMachineGunContract.js';
import { resolveArcadeVehicleActiveStats } from '../src/shared/contracts/ArcadeVehicleActiveStatsContract.js';

test('the seven guns unlock by role and every tenth vehicle level', () => {
    assert.deepEqual(ARCADE_MACHINE_GUN_IDS, [
        'vector_m7', 'raptor_r9', 'bastion_h3', 'lance_p4', 'swarm_s2', 'ember_g5', 'pulse_p3',
    ]);
    assert.deepEqual(resolveArcadeOwnedMachineGuns('arrow', 1), ['vector_m7', 'raptor_r9']);
    assert.deepEqual(resolveArcadeOwnedMachineGuns('manta', 9), ['vector_m7', 'bastion_h3']);
    assert.deepEqual(resolveArcadeOwnedMachineGuns('manta', 10), ['vector_m7', 'bastion_h3', 'raptor_r9']);
    assert.equal(resolveArcadeMachineGunUnlockLevel('manta', 'ember_g5'), 40);
    assert.equal(resolveArcadeOwnedMachineGuns('ship5', 50).length, 7);
    const profile = { vehicleId: 'arrow', level: 1, mgLevel: 5 };
    assert.equal(selectArcadeMachineGun(profile, 'bastion_h3').reason, 'not_owned');
    const selected = selectArcadeMachineGun({ ...profile, level: 10 }, 'bastion_h3');
    assert.equal(selected.next.mgLevel, 5);
    assert.equal(normalizeArcadeWeaponProfileFields({ ...profile, selectedMachineGunId: 'bastion_h3' }).selectedMachineGunId, 'vector_m7');
});

test('unbounded levels, costs, XP debit and one source for active damage', () => {
    assert.deepEqual([2, 3, 5, 10, 30, 60].map(arcadeWeaponLevelCostXp), [150, 369, 909, 2610, 11946, 30075]);
    assert.equal(arcadeWeaponLevelCostXp(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
    assert.equal(resolveArcadeMachineGunLevelEffects(10).damage, 72);
    assert.ok(Math.abs(resolveArcadeMachineGunLevelEffects(10).rate - 0.3697505902753909) < 1e-9);
    assert.ok(resolveArcadeMachineGunLevelEffects(1e6).rate <= 1);
    const profile = { vehicleId: 'arrow', level: 10, xpBank: 149, spentUpgradeXp: 0, mgLevel: 1 };
    const rejected = evaluateArcadeWeaponLevelPurchase(profile, 'mg');
    assert.equal(rejected.reason, 'insufficient_xp');
    assert.equal(profile.xpBank, 149);
    const bought = evaluateArcadeWeaponLevelPurchase({ ...profile, xpBank: 150 }, 'mg');
    assert.equal(bought.next.mgLevel, 2);
    assert.equal(bought.next.xpBank, 0);
    const stats = resolveArcadeVehicleActiveStats('arrow', { ...profile, mgLevel: 2, rocketLevel: 3, shieldLevel: 2 });
    assert.equal(stats.mgDamagePct, 108);
    assert.equal(stats.rocketDamagePct, 120);
    assert.equal(stats.shieldPct, 110);
    assert.deepEqual(stats.weaponLoadout, { machineGunId: 'vector_m7', mgLevel: 2, mgDamagePct: 108, masterCount: 0 });
    assert.equal(Object.isFrozen(stats.weaponLoadout), true);
});

test('nose damage counts once and dynamic visibility changes cached range', () => {
    let fog = 200;
    const loadout = Object.freeze({ machineGunId: 'vector_m7', mgLevel: 1, mgDamagePct: 103, masterCount: 0 });
    const player = { arcadeWeaponLoadout: loadout, arcadeDamageMultiplier: 1.03, arcadeRangeMultiplier: 1.02,
        position: new THREE.Vector3(), entityManager: { getVisibilityRange: () => fog } };
    const config = resolvePlayerMachineGunConfig(HUNT_CONFIG.MG, player);
    assert.equal(config.DAMAGE, 7.9825);
    assert.equal(config.FALLOFF_RANGE, 152);
    assert.equal(config.RANGE, 155.04);
    fog = 153;
    assert.equal(resolvePlayerMachineGunConfig(HUNT_CONFIG.MG, player), config);
    assert.equal(config.RANGE, 153);
    const bot = { arcadeDamageMultiplier: 1.2 };
    const boosted = resolvePlayerMachineGunConfig(HUNT_CONFIG.MG, bot);
    assert.ok(Math.abs(boosted.DAMAGE - 9.3) < 1e-12);
    assert.equal(resolvePlayerMachineGunConfig(HUNT_CONFIG.MG, bot), boosted);
    bot.arcadeDamageMultiplier = 1.3;
    assert.notEqual(resolvePlayerMachineGunConfig(HUNT_CONFIG.MG, bot), boosted);
});

/** Actual gun state, cooldown and hit falloff. Only the spatial query is fixed to 60 units. */
export function fiveSecondDamage(id, level, hz, adjust = null) {
    let damage = 0;
    const player = { index: 0, alive: true, isBot: false, shootCooldown: 0, position: new THREE.Vector3(),
        arcadeWeaponLoadout: Object.freeze({ machineGunId: id, mgLevel: level, mgDamagePct: 100 + 8 * (level - 1), masterCount: 0 }) };
    const target = { index: 1, alive: true, position: new THREE.Vector3(0, 0, -60),
        takeDamage(amount) { damage += amount; return { isDead: false }; } };
    const entityManager = { players: [player], gameModeStrategy: { hasMachineGun: () => true } };
    const runtime = { players: [player, target], services: { entityRuntimeConfig: { HUNT: { MG: HUNT_CONFIG.MG } } } };
    const system = new OverheatGunSystem(entityManager, runtime);
    if (adjust) adjust(resolvePlayerMachineGunConfig(HUNT_CONFIG.MG, player));
    system._hitResolver.resolveAimDirection = (_player, out) => out.set(0, 0, -1);
    system._hitResolver.resolveHit = (_player, _mg, muzzle, aim) => {
        muzzle.set(0, 0, 0); aim.set(0, 0, -1);
        return { target, distance: 60, point: null };
    };
    system._tracerFx = { spawnTracer() {}, update() {}, clear() {} };
    const dt = 1 / hz;
    for (let frame = 0; frame < hz * 5; frame += 1) {
        system.update(dt);
        advanceShootCooldown(player, dt);
        system.tryFire(player);
    }
    return damage;
}

test('each gun stays within five percent of Vector over five real combat seconds', () => {
    for (const hz of [60, 120]) {
        for (const level of [1, 10, 30, 60]) {
            const reference = fiveSecondDamage('vector_m7', level, hz);
            for (const id of ARCADE_MACHINE_GUN_IDS) {
                const actual = fiveSecondDamage(id, level, hz);
                const relative = actual / reference - 1;
                assert.ok(Math.abs(relative) <= 0.05, `${id} level ${level} at ${hz} Hz: ${relative.toFixed(4)} (${actual}/${reference})`);
            }
        }
    }
});

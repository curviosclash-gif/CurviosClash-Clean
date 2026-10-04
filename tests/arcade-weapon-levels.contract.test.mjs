import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { applyArcadeBuildToPlayer } from '../src/modes/ArcadeVehicleStatOps.js';
import { GameRuntimeArcadeSupport } from '../src/core/runtime/GameRuntimeArcadeSupport.js';
import { HUNT_CONFIG } from '../src/hunt/HuntConfig.js';
import { grantShield } from '../src/hunt/HealthSystem.js';
import { resolvePlayerMachineGunConfig } from '../src/hunt/mg/MGConfigResolver.js';
import { ProjectileHitResolver } from '../src/entities/systems/projectile/ProjectileHitResolver.js';
import { DEFAULT_ENTITY_RUNTIME_CONFIG } from '../src/shared/contracts/EntityRuntimeConfig.js';
import {
    ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
    createArcadeVehicleProfileRecord,
    normalizeArcadeVehicleProfileRecord,
} from '../src/shared/contracts/ArcadeVehicleProfileContract.js';
import { getArcadeRunVehicleBonuses } from '../src/state/arcade/ArcadeVehicleProfile.js';

const arcadeConfig = { ...DEFAULT_ENTITY_RUNTIME_CONFIG,
    HUNT: { ...DEFAULT_ENTITY_RUNTIME_CONFIG.HUNT, ACTIVE_MODE: 'ARCADE' } };

function rocketHit(ownerExtra = {}) {
    const system = { entityRuntimeConfig: arcadeConfig, getTurrets: () => [],
        onProjectileHit() {}, onProjectilePowerup() {}, onProjectileDamage() {} };
    const resolver = new ProjectileHitResolver(system);
    const hits = { direct: [], blast: [] };
    const target = (index, x, list) => ({ alive: true, index, hitboxRadius: 1.5,
        position: new THREE.Vector3(x, 0, 0),
        takeDamage(amount) { list.push(amount); return { isDead: false }; } });
    const owner = { index: 0, isBot: false, alive: true, position: new THREE.Vector3(-50, 0, 0), ...ownerExtra };
    const projectile = { type: 'ROCKET_MEDIUM', owner, radius: 0.5, ignoresTrails: true,
        position: new THREE.Vector3(), velocity: new THREE.Vector3(1, 0, 0) };
    resolver.resolveProjectileOutcome(projectile, [owner, target(1, 0, hits.direct), target(2, 5, hits.blast)], null, {});
    return hits;
}

test('rocket level adds to nose damage in the real direct and blast paths; bot factor remains', () => {
    const profile = { ...createArcadeVehicleProfileRecord('manta', 0), rocketLevel: 3,
        sizeWorkshopUnlocked: true, purchasedSizeSteps: 1,
        partSizes: { hull: 100, nose: 105, wings: 100, engines: 100, utility: 100 } };
    const strategy = new ArcadeModeStrategy({ runType: 'arena_waves', combatProfile: 'hunt' });
    strategy.applyVehicleUpgrades(getArcadeRunVehicleBonuses(profile));
    const player = { vehicleId: 'manta', isBot: false };
    strategy.applySpawnStatBonuses(player);
    assert.equal(player.arcadeDamageMultiplier, 1.03);
    assert.equal(player.arcadeRocketDamageMultiplier, 1.23);
    const plain = rocketHit();
    const built = rocketHit(player);
    assert.ok(Math.abs(built.direct[0] - plain.direct[0] * 1.23) < 1e-9);
    assert.ok(built.blast[0] > plain.blast[0]);
    const bot = { vehicleId: 'ship1', isBot: true };
    applyArcadeBuildToPlayer(bot, null, true);
    assert.equal(bot.arcadeRocketDamageMultiplier, undefined);
    assert.equal(bot.arcadeWeaponLoadout, null);
    assert.ok(Math.abs(rocketHit({ arcadeDamageMultiplier: 1.2 }).direct[0] - plain.direct[0] * 1.2) < 1e-9);
});

test('shield level adds to utility and survives both shield paths', () => {
    const profile = { ...createArcadeVehicleProfileRecord('manta', 0), shieldLevel: 2,
        sizeWorkshopUnlocked: true, purchasedSizeSteps: 1,
        partSizes: { hull: 100, nose: 100, wings: 100, engines: 100, utility: 105 } };
    const strategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    strategy.applyVehicleUpgrades(getArcadeRunVehicleBonuses(profile));
    const player = { vehicleId: 'manta', isBot: false, maxHp: 100, hp: 100 };
    strategy.resetPlayerHealth(player);
    strategy.applySpawnStatBonuses(player);
    assert.ok(Math.abs(player.arcadeShieldMultiplier - 1.14) < 1e-12);
    strategy.grantShield(player);
    assert.ok(Math.abs(player.maxShieldHp - 45.6) < 1e-12);
    grantShield(player, arcadeConfig);
    assert.ok(Math.abs(player.maxShieldHp - 45.6) < 1e-12);
});

test('optional v3 weapon fields normalize safely and survive JSON; rebuild keeps the start values', () => {
    const raw = { ...createArcadeVehicleProfileRecord('manta', 0), level: 40,
        selectedMachineGunId: 'ember_g5', mgLevel: 5, rocketLevel: 3, shieldLevel: 2 };
    const normalized = normalizeArcadeVehicleProfileRecord('manta', JSON.parse(JSON.stringify(raw)));
    assert.equal(normalized.selectedMachineGunId, 'ember_g5');
    assert.deepEqual([normalized.mgLevel, normalized.rocketLevel, normalized.shieldLevel], [5, 3, 2]);
    const first = getArcadeRunVehicleBonuses(normalized).build;
    assert.equal(first.level, 40);
    const snapshot = Object.freeze({ vehicleLevel: first.level, mgLevel: first.mgLevel,
        rocketLevel: first.rocketLevel, shieldLevel: first.shieldLevel,
        selectedMachineGunId: first.selectedMachineGunId });
    const edited = { ...normalized, level: 50, selectedMachineGunId: 'pulse_p3', mgLevel: 9 };
    const rebuilt = getArcadeRunVehicleBonuses(edited, null, first.stoneSteps, snapshot).build;
    assert.equal(rebuilt.level, 40);
    assert.equal(rebuilt.selectedMachineGunId, 'ember_g5');
    assert.equal(rebuilt.mgLevel, 5);
    assert.deepEqual(normalizeArcadeVehicleProfileRecord('manta', { ...raw, mgLevel: NaN, rocketLevel: -2 }).mgLevel, 1);
});

test('Arena starts on the selected Hangar gun and applies tuning to damage and cooling', () => {
    const profile = { ...createArcadeVehicleProfileRecord('manta', 0), level: 40,
        selectedMachineGunId: 'ember_g5', mgLevel: 2 };
    const store = { loadJsonRecord(key, fallback) {
        return key === ARCADE_VEHICLE_PROFILE_STORAGE_KEY ? { manta: profile } : fallback;
    } };
    const strategy = new ArcadeModeStrategy({ runType: 'arena_waves', combatProfile: 'hunt' });
    const human = { index: 0, vehicleId: 'manta', isBot: false, alive: true, baseSpeed: 40,
        speed: 40, maxHp: 100, hp: 100 };
    const runtimeState = { runtimeConfig: { arcade: { enabled: true, runType: 'arena_waves' },
        player: { vehicles: { PLAYER_1: 'manta' } } },
    entityManager: { players: [human], humanPlayers: [human], bots: [], gameModeStrategy: strategy } };
    const support = new GameRuntimeArcadeSupport({ getRuntimeState: () => runtimeState,
        getGame: () => ({ settingsManager: { getPlayerRecordStorePort: () => store } }) });
    support.startRunIfEnabled();
    assert.equal(support.arenaWavesRuntime.upgrades.machineGunId, 'ember_g5');
    strategy.resetPlayerHealth(human);
    strategy.applySpawnStatBonuses(human);
    assert.equal(human.arcadeWeaponLoadout.machineGunId, 'ember_g5');
    assert.equal(human.arcadeWeaponLoadout.mgLevel, 2);
    const before = resolvePlayerMachineGunConfig(HUNT_CONFIG.MG, human);
    assert.equal(before.MACHINE_GUN_ID, 'ember_g5');
    support.arenaWavesRuntime.upgrades.mgTuning = 1;
    support.arenaWavesRuntime._applyHumanUpgrades();
    const after = resolvePlayerMachineGunConfig(HUNT_CONFIG.MG, human);
    assert.ok(Math.abs(after.DAMAGE / before.DAMAGE - 1.06) < 1e-12);
    assert.ok(Math.abs(after.COOLING_PER_SECOND / before.COOLING_PER_SECOND - 1.08) < 1e-12);
});

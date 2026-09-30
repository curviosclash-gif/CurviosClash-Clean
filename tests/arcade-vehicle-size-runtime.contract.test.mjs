// ============================================
// arcade-vehicle-size-runtime.contract.test.mjs - Paket 2a: der Größen-Build kommt über die
// echten Laufzeitwege im Run an (Run-Start je Run-Art, Spawn, Schild-Pickup, Respawn-Schild,
// Raketentreffer, Boost-Tank, Splitscreen, Sichtweite, Werte-Banner).
// ============================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { GameRuntimeArcadeSupport } from '../src/core/runtime/GameRuntimeArcadeSupport.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { ARENA_WAVES_COMBAT_PROFILE } from '../src/shared/contracts/ArenaWavesContract.js';
import {
    ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
    createArcadeVehicleProfileRecord,
} from '../src/shared/contracts/ArcadeVehicleProfileContract.js';
import * as BuildContract from '../src/shared/contracts/ArcadeVehicleBuildContract.js';
import { DEFAULT_ENTITY_RUNTIME_CONFIG } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { getArcadeRunVehicleBonuses } from '../src/state/arcade/ArcadeVehicleProfile.js';
import { createArcadeVehicleUpgradeBonusMap } from '../src/core/arcade/ArcadeRunVehicleRewardOps.js';
import { applyArcadeRuntimeCosmetics } from '../src/core/arcade/ArcadeRuntimeCosmeticOps.js';
import { listPlayerShipPartDonors } from '../src/shared/vehicle-lab/player-ships/index.js';
import { RuntimeModularVehicleMesh } from '../src/entities/runtime-modular-vehicle-mesh.js';
import { buildArcadeHitboxShape } from '../src/shared/contracts/ArcadeVehicleHitboxContract.js';
import { applyPlayerPowerup } from '../src/entities/player/PlayerEffectOps.js';
import { resetPlayerCharges } from '../src/entities/player/PlayerChargeOps.js';
import { grantShield } from '../src/hunt/HealthSystem.js';
import { ProjectileHitResolver } from '../src/entities/systems/projectile/ProjectileHitResolver.js';
import { NEON_ABYSS_MAP } from '../src/core/config/maps/presets/neon_abyss.js';
import { MAP_PRESET_CATALOG_BASE_DATA } from '../src/core/config/maps/MapPresetCatalogBaseData.js';

const ARCADE_CONFIG = Object.freeze({
    ...DEFAULT_ENTITY_RUNTIME_CONFIG,
    HUNT: { ...DEFAULT_ENTITY_RUNTIME_CONFIG.HUNT, ACTIVE_MODE: 'ARCADE' },
});

function sizes(partial = {}) {
    return { hull: 100, nose: 100, wings: 100, engines: 100, utility: 100, ...partial };
}

function mantaProfile(partSizes, extra = {}) {
    return {
        ...createArcadeVehicleProfileRecord('manta', 0),
        xpBank: 1_000_000,
        sizeWorkshopUnlocked: true,
        purchasedSizeSteps: 25,
        partSizes: sizes(partSizes),
        ...extra,
    };
}

function makePlayer(vehicleId, extra = {}) {
    return {
        index: 0, vehicleId, isBot: false, alive: true, baseSpeed: 40, speed: 40, turnSpeed: 2, hasShield: false,
        maxHp: 1, hp: 1, maxShieldHp: 1, shieldHP: 0, inventory: [], rocketInventory: [], activeEffects: [],
        entityRuntimeConfig: ARCADE_CONFIG,
        ...extra,
    };
}

// --- A: Fünf Portale und Arena-Wellen bekommen den Größen-Build vor dem Spawn ---

for (const [runType, combatProfile] of [['five_portals', undefined], ['arena_waves', ARENA_WAVES_COMBAT_PROFILE]]) {
    test(`A: ${runType} fliegt den Größen-Build, den das Schiff sichtbar zeigt`, () => {
        const profile = mantaProfile({ hull: 125, utility: 125, engines: 110 }, { purchasedItemSlots: 3 });
        const store = {
            loadJsonRecord: (key, fallback) => (key === ARCADE_VEHICLE_PROFILE_STORAGE_KEY ? { manta: profile } : fallback),
        };
        const strategy = new ArcadeModeStrategy({ runType, combatProfile });
        const manta = listPlayerShipPartDonors().find((donor) => donor.id === 'manta');
        const human = makePlayer('manta', { vehicleMesh: new RuntimeModularVehicleMesh(0x3366ff, manta) });
        const runtimeState = {
            runtimeConfig: { arcade: { enabled: true, runType }, player: { vehicles: { PLAYER_1: 'manta' } } },
            entityManager: { players: [human], humanPlayers: [human], bots: [], gameModeStrategy: strategy },
        };
        const support = new GameRuntimeArcadeSupport({
            getRuntimeState: () => runtimeState,
            getGame: () => ({ settingsManager: { getPlayerRecordStorePort: () => store } }),
        });

        support.startRunIfEnabled();
        // Spawn in der Reihenfolge von EntitySpawnOps.spawnPlayerAt.
        strategy.resetPlayerHealth(human);
        strategy.applySpawnStatBonuses(human);

        const hull = human.vehicleMesh.children.find((child) => child.name === 'Rumpf');
        assert.ok(Math.abs(hull.scale.x - 1.25) < 1e-6, 'sichtbar: Rumpf 125 %');
        const utility = human.vehicleMesh.children.find((child) => child.userData?.config?.role === 'utility');
        assert.ok(utility, 'die Manta zeigt ein Utility-Bauteil');
        const factoryScaleX = manta.parts.find((part) => part.role === 'utility').scale?.[0] ?? 1;
        assert.ok(Math.abs(utility.scale.x / factoryScaleX - 1.25) < 1e-6, 'sichtbar: Utility 125 %');
        // Der größere Rumpf nimmt das Heckmodul mit, statt es zu verschlucken (Drehpunkt des Rumpfs x 1,25).
        const hullPivot = manta.parts.find((part) => part.role === 'core').pos;
        const utilityPivot = manta.parts.find((part) => part.role === 'utility').pos;
        utility.position.toArray().forEach((value, axis) => {
            const expected = hullPivot[axis] + (utilityPivot[axis] - hullPivot[axis]) * 1.25;
            assert.ok(Math.abs(value - expected) < 1e-6, `sichtbar: Heckmodul fährt mit dem Rumpf (Achse ${axis}: ${value} statt ${expected})`);
        });
        assert.equal(human.maxHp, 180, 'funktional: Manta 150 * 1,2');
        assert.equal(human.itemCapacity, 10, '7 + 3 gekaufte Plätze bei Utility 125 %');
        assert.deepEqual(human.arcadePartSizes, profile.partSizes);
        assert.equal(human.arcadeShieldMultiplier, 1.2);
    });
}

// --- B: Schild-Pickup und Respawn-Schild behalten den Utility-Bonus ---

test('B: ein aufgesammelter Schild und das Respawn-Schild haben den Utility-Bonus', () => {
    const strategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    strategy.applyVehicleUpgrades(getArcadeRunVehicleBonuses(mantaProfile({ utility: 125 })));
    const human = makePlayer('manta');
    strategy.resetPlayerHealth(human);
    strategy.applySpawnStatBonuses(human);

    applyPlayerPowerup(human, 'SHIELD');
    assert.equal(human.maxShieldHp, 48, 'Pickup: 40 * 1,2');
    assert.equal(human.shieldHP, 48);

    const respawned = makePlayer('manta', { arcadeShieldMultiplier: 1.2 });
    grantShield(respawned, ARCADE_CONFIG);
    assert.equal(respawned.maxShieldHp, 48, 'Respawn-Schild nutzt denselben Weg');

    const other = makePlayer('manta');
    grantShield(other, ARCADE_CONFIG);
    assert.equal(other.maxShieldHp, 40, 'ohne Arcade-Feld exakt wie bisher');
});

test('Arcade profile builds and visible part sizes stay keyed to each human pilot vehicle', () => {
    const donors = listPlayerShipPartDonors();
    const vehicles = ['spaceship', 'arrow', 'manta'];
    const partSizes = [
        sizes({ hull: 105 }),
        sizes({ nose: 110 }),
        sizes({ utility: 115 }),
    ];
    const upgrades = [{ core: 'T2' }, { wing_left: 'T2' }, { engine_left: 'T2' }];
    const profiles = Object.fromEntries(vehicles.map((vehicleId, index) => [vehicleId, {
        ...createArcadeVehicleProfileRecord(vehicleId, 0),
        upgrades: upgrades[index],
        sizeWorkshopUnlocked: true,
        purchasedSizeSteps: index + 1,
        partSizes: partSizes[index],
    }]));
    const store = {
        loadJsonRecord: (key, fallback) => (key === ARCADE_VEHICLE_PROFILE_STORAGE_KEY ? profiles : fallback),
    };
    const players = vehicles.map((vehicleId) => {
        const donor = donors.find((entry) => entry.id === vehicleId);
        return makePlayer(vehicleId, { vehicleMesh: new RuntimeModularVehicleMesh(0x3366ff, donor) });
    });
    const strategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    const runtimeConfig = { arcade: { enabled: true, runType: 'gauntlet' } };
    const runtimeState = {
        runtimeConfig,
        entityManager: { players, humanPlayers: players, bots: [], gameModeStrategy: strategy },
    };
    const support = {
        _resolveActiveVehicleId: () => vehicles[0],
        game: { settingsManager: { getPlayerRecordStorePort: () => store } },
    };

    applyArcadeRuntimeCosmetics(support, runtimeState, runtimeConfig);
    strategy.applyVehicleUpgrades(createArcadeVehicleUpgradeBonusMap(profiles, players));
    for (let index = 0; index < players.length; index += 1) {
        const player = players[index];
        const vehicleId = vehicles[index];
        strategy.resetPlayerHealth(player);
        strategy.applySpawnStatBonuses(player);
        assert.deepEqual(player.arcadePartSizes, partSizes[index], `${vehicleId}: functional build uses its profile`);

        const vehicle = donors.find((donor) => donor.id === vehicleId);
        const role = ['core', 'nose', 'utility'][index];
        const sizeGroup = role === 'core' ? 'hull' : role;
        const sourcePart = vehicle.parts.find((part) => part.role === role);
        const renderedPart = player.vehicleMesh.children.find((child) => child.userData?.config?.role === role);
        assert.ok(renderedPart, `${vehicleId}: actual modular mesh has its ${role} part`);
        const factor = partSizes[index][sizeGroup] / 100;
        const factoryScale = sourcePart.scale?.[0] ?? 1;
        assert.ok(Math.abs(renderedPart.scale.x / factoryScale - factor) < 1e-6,
            `${vehicleId}: rendered ${role} scale follows its independent profile`);

        const hitbox = buildArcadeHitboxShape(vehicle.parts, player.arcadePartSizes);
        const roleIndex = hitbox.roles.indexOf(role);
        assert.ok(roleIndex >= 0, `${vehicleId}: its scaled part remains in the collision shape`);
        assert.ok(Math.abs(hitbox.boxes[roleIndex * 6 + 3] / buildArcadeHitboxShape(vehicle.parts, null).boxes[roleIndex * 6 + 3] - factor) < 1e-6,
            `${vehicleId}: functional hitbox follows the same profile size`);
    }
    assert.notEqual(players[0].maxHp, players[1].maxHp, 'T2 hull/core progression is applied to the selected vehicle only');
    assert.notEqual(players[1].speed, players[2].speed, 'different selected vehicle upgrades do not collapse onto P1');
});

// --- C: Nasen-Raketenschaden über den echten Trefferweg ---

function rocketHit(ownerExtra) {
    const system = {
        entityRuntimeConfig: ARCADE_CONFIG,
        getTurrets: () => [],
        onProjectileHit() {},
        onProjectilePowerup() {},
        onProjectileDamage() {},
    };
    const resolver = new ProjectileHitResolver(system);
    const hits = { direct: [], blast: [] };
    const target = (list, x) => ({
        alive: true, index: list === hits.direct ? 1 : 2, hitboxRadius: 1.5,
        position: new THREE.Vector3(x, 0, 0),
        takeDamage: (amount) => { list.push(amount); return { isDead: false }; },
    });
    const owner = { index: 0, isBot: false, alive: true, position: new THREE.Vector3(-50, 0, 0), ...ownerExtra };
    const projectile = {
        type: 'ROCKET_MEDIUM', owner, radius: 0.5, ignoresTrails: true,
        position: new THREE.Vector3(0, 0, 0), velocity: new THREE.Vector3(1, 0, 0),
    };
    const players = [owner, target(hits.direct, 0), target(hits.blast, 5)];
    resolver.resolveProjectileOutcome(projectile, players, null, {});
    return hits;
}

test('C: der Nasen-Raketenschaden wirkt im echten Treffer- und Explosionsweg', () => {
    const plain = rocketHit({});
    const built = rocketHit({ arcadeDamageMultiplier: 1.15 });
    assert.equal(plain.direct.length, 1);
    assert.ok(Math.abs(built.direct[0] - plain.direct[0] * 1.15) < 1e-9, 'Direkttreffer * 1,15');
    assert.ok(built.blast[0] > plain.blast[0], 'Druckwelle wächst mit');
    assert.deepEqual(rocketHit({ arcadeDamageMultiplier: 1 }), plain, 'Faktor 1 (Bots, andere Modi) wie bisher');
});

// --- E: Boost-Tank ist nach Spawn und Respawn voll ---

test('E: mit größeren Antrieben startet der Boost nach Spawn und Respawn voll', () => {
    const strategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    strategy.applyVehicleUpgrades(getArcadeRunVehicleBonuses(mantaProfile({ engines: 125 })));
    const human = makePlayer('manta');
    const capacity = DEFAULT_ENTITY_RUNTIME_CONFIG.PLAYER.BOOST_DURATION * 1.15;
    for (const label of ['Spawn', 'Respawn']) {
        // Player.spawn füllt die Reserven mit seiner PLAYER-Konfiguration, danach setzt die Strategie den Build.
        resetPlayerCharges(human, DEFAULT_ENTITY_RUNTIME_CONFIG.PLAYER);
        strategy.resetPlayerHealth(human);
        strategy.applySpawnStatBonuses(human);
        assert.ok(Math.abs(human.boostCharge - capacity) < 1e-9, `${label}: Tank voll (${human.boostCharge} von ${capacity})`);
    }
    const plain = makePlayer('manta');
    resetPlayerCharges(plain, DEFAULT_ENTITY_RUNTIME_CONFIG.PLAYER);
    assert.equal(plain.boostCharge, DEFAULT_ENTITY_RUNTIME_CONFIG.PLAYER.BOOST_DURATION, 'ohne Build wie bisher');
});

// --- F: Splitscreen - der Build gilt nur für das Fahrzeug des Profils ---

test('F: Tempo und Wendigkeit des Builds gelten nicht für einen Menschen in einem anderen Fahrzeug', () => {
    const strategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    strategy.applyVehicleUpgrades(getArcadeRunVehicleBonuses(mantaProfile({ wings: 125, engines: 125 })));
    const manta = makePlayer('manta');
    const drone = makePlayer('drone', { index: 1 });
    for (const player of [manta, drone]) {
        strategy.resetPlayerHealth(player);
        strategy.applySpawnStatBonuses(player);
    }
    assert.ok(Math.abs(strategy.getTurnRateMultiplier(manta) - 0.8625) < 1e-9, 'Manta: 75 * 1,15');
    assert.ok(Math.abs(manta.baseSpeed - 40 * 0.9) < 1e-9, 'Manta: 80 * 1,125');
    assert.ok(Math.abs(strategy.getTurnRateMultiplier(drone) - 1.3) < 1e-9, 'Drohne: Werkswert 130 %');
    assert.ok(Math.abs(drone.baseSpeed - 40 * 1.15) < 1e-9, 'Drohne: Werkswert 115 %');
});

// --- G: Die Nasen-Reichweite endet an der Sichtweite ---

function sightPlayer(rangeMultiplier, visibilityRange = Infinity, map = null) {
    return {
        arcadeRangeMultiplier: rangeMultiplier,
        position: new THREE.Vector3(),
        entityManager: { getVisibilityRange: () => visibilityRange, arena: { currentMapDefinition: map } },
    };
}

test('G: die verlängerte MG-Flugweite endet an der Sichtweite, nie unter der eigenen MG-Reichweite', () => {
    const mg = { DAMAGE: 10, RANGE: 95 };
    const apply = BuildContract.applyArcadeBuildToMachineGunConfig;
    assert.ok(Math.abs(apply(mg, sightPlayer(1.1)).RANGE - 104.5) < 1e-9, 'klare Sicht: volle Verlängerung');
    assert.equal(apply(mg, sightPlayer(1.1, 100)).RANGE, 100, 'Nebel bei 100: Schuss endet an der Sichtgrenze');
    assert.equal(apply(mg, sightPlayer(1.1, 60)).RANGE, 95, 'die eigene MG-Reichweite bleibt');
    assert.equal(apply({ DAMAGE: 10, RANGE: 190 }, sightPlayer(1.1)).RANGE, 200, 'ohne Karte: Rückfallwert 200');
    assert.equal(apply({ DAMAGE: 10, RANGE: 100 }, sightPlayer(0.9, 50)).RANGE, 90, 'Verkürzen wird nicht gekappt');
});

test('G: die verlängerte Raketen-Aufschaltweite endet ebenso an der Sichtweite', () => {
    const resolve = BuildContract.resolveArcadeNoseRange;
    assert.equal(typeof resolve, 'function', 'Raketenweg nutzt dieselbe Kappung');
    assert.equal(resolve(140, sightPlayer(1.1, 150)), 150);
    assert.ok(Math.abs(resolve(140, sightPlayer(1.1)) - 154) < 1e-9);
    assert.equal(resolve(140, {}), 140, 'ohne Arcade-Feld exakt wie bisher');
});

test('G: die Nasen-Reichweite endet am Nebel der aktuellen Karte, nicht an einer festen 200', () => {
    const apply = BuildContract.applyArcadeBuildToMachineGunConfig;
    const neon = sightPlayer(1.1, Infinity, NEON_ABYSS_MAP.neon_abyss);
    assert.equal(apply({ DAMAGE: 10, RANGE: 152 }, neon).RANGE, 152, 'neon_abyss (Nebel endet bei 110): MG bleibt bei 152');
    assert.equal(BuildContract.resolveArcadeNoseRange(140, neon), 140, 'neon_abyss: Raketen-Aufschaltung bleibt bei 140');
    const pyramid = MAP_PRESET_CATALOG_BASE_DATA.pyramid;
    assert.ok(Math.abs(apply({ DAMAGE: 10, RANGE: 190 }, sightPlayer(1.1, Infinity, pyramid)).RANGE - 209) < 1e-9,
        'pyramid (Nebel endet bei 560): volle Verlängerung auf 209');
    assert.equal(apply({ DAMAGE: 10, RANGE: 190 }, sightPlayer(1.1, 195, pyramid)).RANGE, 195,
        'Nebel-Item oder Sandsturm kappen zusätzlich');
});

// --- L: Werte-Banner zum Sektorstart zeigt den Wertesatz mit Größen-Wirkung ---

test('L: das Werte-Banner zeigt Tempo, Wendigkeit und Leben aus dem Größen-Build', () => {
    const runtime = new ArcadeRunRuntime({ now: () => 1000 });
    runtime._enabled = true;
    runtime._activeVehicleId = 'manta';
    runtime._vehicleProfiles = { manta: { ...mantaProfile({ hull: 125, wings: 125, engines: 80 }), level: 7 } };
    runtime._state = { phase: 'sector_active', sectorIndex: 1, config: { comboWindowMs: 5000 }, score: { breakdown: {} } };
    const hud = runtime.getHudState();
    assert.deepEqual(hud.vehicleStats, { level: 7, speedBonusPct: -8, turningBonusPct: 11.25, maxHpBonus: 30 });
    assert.equal(runtime.getHudState().vehicleStats, hud.vehicleStats, 'pro Profil gecacht, keine Neuberechnung je Bild');
});

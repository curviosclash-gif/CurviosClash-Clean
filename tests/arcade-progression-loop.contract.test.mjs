import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
} from '../src/shared/contracts/ArcadeVehicleProfileContract.js';
import {
    addXp,
    createArcadeVehicleProfile,
    getArcadeRunVehicleBonuses,
    getOrCreateProfile,
    loadVehicleProfiles,
    saveVehicleProfiles,
    XP_REWARD_TABLE,
} from '../src/state/arcade/ArcadeVehicleProfile.js';
import {
    ARCADE_STONE_WORKSHOP_STORAGE_KEY,
    commitArcadeStoneWorkshopResult,
    evaluateArcadeStonePurchase,
    readArcadeStoneWorkshopRecord,
} from '../src/shared/contracts/ArcadeStoneWorkshopContract.js';
import { applyArcadeStonePlacement, listArcadeStonesForVehicle } from '../src/shared/contracts/ArcadeStonePlacementContract.js';
import { applyMenuCompatibilityRules } from '../src/ui/menu/MenuCompatibilityRules.js';
import { createGameModeStrategy } from '../src/modes/GameModeRegistry.js';

const VEHICLE_ID = 'ship5';

/** Stands in for the settings record store: survives a "restart" as a plain object. */
function createDisk() {
    const disk = new Map();
    return {
        disk,
        store: {
            loadJsonRecord(key, fallback) {
                return disk.has(key) ? JSON.parse(disk.get(key)) : fallback;
            },
            readJsonRecordResult(key) {
                return disk.has(key)
                    ? { ok: true, status: 'found', value: JSON.parse(disk.get(key)) }
                    : { ok: true, status: 'missing', value: null };
            },
            saveJsonRecord(key, value) {
                disk.set(key, JSON.stringify(value));
                return { ok: true };
            },
        },
    };
}

/** One parcours: eleven checkpoints and a finish, the same rewards the run runtime pays. */
function flyParcours(profile) {
    let current = profile;
    for (let i = 0; i < 11; i += 1) {
        current = addXp(current, XP_REWARD_TABLE.parcoursCheckpoint, 0).profile;
    }
    return addXp(current, XP_REWARD_TABLE.parcoursFinish, 0).profile;
}

test('one parcours pays the checkpoint and finish rewards into the profile', () => {
    const earned = flyParcours(createArcadeVehicleProfile(VEHICLE_ID, 0));
    assert.equal(earned.xp, 11 * XP_REWARD_TABLE.parcoursCheckpoint + XP_REWARD_TABLE.parcoursFinish);
    assert.equal(earned.xpBank, earned.xp, 'earned xp is spendable in the hangar');
});

test('flying, levelling, buying and placing a stone survives a restart and reaches the player', () => {
    const { store } = createDisk();

    // 1. Fliegen: mehrere Parcours ueber den echten Belohnungspfad.
    let profile = createArcadeVehicleProfile(VEHICLE_ID, 0);
    for (let run = 0; run < 12; run += 1) profile = flyParcours(profile);
    const afterFlying = { xp: profile.xp, level: profile.level, xpBank: profile.xpBank };
    assert.ok(afterFlying.level >= 5, `twelve parcours reach at least level 5 (got ${afterFlying.level})`);

    // 2. Speichern und "Neustart": alles kommt aus dem Speicher zurueck.
    saveVehicleProfiles(store, { [VEHICLE_ID]: profile });
    assert.ok(store.loadJsonRecord(ARCADE_VEHICLE_PROFILE_STORAGE_KEY, null), 'the profile record is written');
    const reloaded = getOrCreateProfile(loadVehicleProfiles(store), VEHICLE_ID);
    assert.equal(reloaded.xp, afterFlying.xp);
    assert.equal(reloaded.level, afterFlying.level);
    assert.equal(reloaded.xpBank, afterFlying.xpBank);

    // 3. Kaufen: der Stein landet im Werkstatt-Pool, bezahlt vom Fahrzeug; erst Pool, dann Profil.
    const purchase = evaluateArcadeStonePurchase(readArcadeStoneWorkshopRecord(store, 0).pool, reloaded, 0);
    assert.equal(purchase.ok, true, `the stone purchase is allowed (${purchase.reason})`);
    assert.equal(purchase.next.xpBank, reloaded.xpBank - 200);
    const written = [];
    const committed = commitArcadeStoneWorkshopResult(store, purchase, (next) => {
        written.push('profile');
        saveVehicleProfiles(store, { [VEHICLE_ID]: next });
    });
    assert.equal(committed.ok, true);
    assert.deepEqual(written, ['profile']);

    // 4. Einsetzen und fuer den Run aktivieren: nur die Aktivierung schreibt die Belegung in den Pool.
    const paid = getOrCreateProfile(loadVehicleProfiles(store), VEHICLE_ID);
    const activated = applyArcadeStonePlacement(readArcadeStoneWorkshopRecord(store, 0).pool, VEHICLE_ID,
        { core: 'stone-0004', nose: 'stone-0001' }, paid, { nowMs: 0 });
    assert.equal(activated.ok, true);
    assert.equal(commitArcadeStoneWorkshopResult(store, activated, null).ok, true);

    // 5. Zweiter "Neustart": XP, Bestand und Belegung sind noch da.
    const afterRestart = getOrCreateProfile(loadVehicleProfiles(store), VEHICLE_ID);
    assert.equal(afterRestart.xpBank, reloaded.xpBank - 200, 'spent points stay spent');
    const pool = readArcadeStoneWorkshopRecord(store, 0);
    assert.equal(pool.status, 'ok');
    assert.equal(pool.pool.stones.length, 4);
    assert.deepEqual(listArcadeStonesForVehicle(pool.pool, VEHICLE_ID).map((entry) => entry.slotId), ['core', 'nose']);
    assert.ok(store.loadJsonRecord(ARCADE_STONE_WORKSHOP_STORAGE_KEY, null), 'the pool record is written');

    // 6. Wirkung: der naechste Lauf spawnt mit mehr Leben als ein Lauf ohne Steine.
    const settings = {
        gameMode: 'CLASSIC',
        mapKey: 'parcours_rift',
        hunt: { respawnEnabled: false },
        localSettings: { sessionType: 'single', modePath: 'arcade' },
    };
    applyMenuCompatibilityRules(settings, {});
    const strategy = createGameModeStrategy(settings.gameMode, { random: () => 0.5 });

    const plain = { vehicleId: VEHICLE_ID, hasShield: false, baseSpeed: 18, speed: 18 };
    strategy.applyVehicleUpgrades?.(null);
    strategy.resetPlayerHealth(plain);

    const upgraded = { vehicleId: VEHICLE_ID, hasShield: false, baseSpeed: 18, speed: 18 };
    strategy.applyVehicleUpgrades?.(getArcadeRunVehicleBonuses(afterRestart, store));
    strategy.resetPlayerHealth(upgraded);
    strategy.applySpawnStatBonuses?.(upgraded);

    assert.ok(
        upgraded.maxHp > plain.maxHp,
        `the placed core stone reaches the player (${plain.maxHp} -> ${upgraded.maxHp})`
    );
});

test('a purchase the player cannot afford leaves profile and pool untouched', () => {
    const { store } = createDisk();
    const profile = { ...createArcadeVehicleProfile(VEHICLE_ID, 0), level: 9, xpBank: 10 };
    const pool = readArcadeStoneWorkshopRecord(store, 0).pool;
    const purchase = evaluateArcadeStonePurchase(pool, profile, 0);
    assert.equal(purchase.ok, false);
    assert.equal(purchase.reason, 'insufficient_xp');
    assert.equal(profile.xpBank, 10);
    assert.equal(pool.stones.length, 3);
    assert.equal(commitArcadeStoneWorkshopResult(store, purchase, () => assert.fail('nothing is saved')).ok, false);
    assert.equal(store.loadJsonRecord(ARCADE_STONE_WORKSHOP_STORAGE_KEY, null), null);
});

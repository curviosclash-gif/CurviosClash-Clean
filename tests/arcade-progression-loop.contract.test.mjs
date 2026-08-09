import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
} from '../src/shared/contracts/ArcadeVehicleProfileContract.js';
import {
    addXp,
    createArcadeVehicleProfile,
    getOrCreateProfile,
    getSlotStatBonuses,
    loadVehicleProfiles,
    saveVehicleProfiles,
    XP_REWARD_TABLE,
} from '../src/state/arcade/ArcadeVehicleProfile.js';
import { purchaseHangarStone } from '../src/ui/hangar/HangarStoneInventory.js';
import { hangarBuildToProfileBonuses } from '../src/ui/hangar/HangarBuildValidation.js';
import { createDefaultHangarBuild } from '../src/ui/hangar/HangarBuildDraftState.js';
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

test('flying, levelling, buying and equipping survives a restart and reaches the player', () => {
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

    // 3. Kaufen: der Hangar-Kauf zieht Punkte ab und legt den Stein in den Bestand.
    const purchase = purchaseHangarStone(reloaded, 'stone_gold_t1', 0);
    assert.equal(purchase.ok, true, `the stone purchase is allowed (code ${purchase.code})`);
    assert.equal(purchase.profile.xpBank, reloaded.xpBank - 100);
    assert.ok(purchase.profile.hangarStoneInventory.counts.stone_gold_t1 > 0);

    // 4. Einsetzen und fuer den Run aktivieren.
    const build = createDefaultHangarBuild(VEHICLE_ID);
    build.slots.core = 'stone_gold_t1';
    build.slots.wing_left = 'stone_gold_t1';
    build.slots.wing_right = 'stone_gold_t1';
    const activated = { ...purchase.profile, hangarBonuses: hangarBuildToProfileBonuses(build) };
    assert.ok(activated.hangarBonuses.maxHpBonus > 0, 'armour stones raise the health bonus');
    saveVehicleProfiles(store, { [VEHICLE_ID]: activated });

    // 5. Zweiter "Neustart": Kauf, Bestand und Boni sind noch da.
    const afterRestart = getOrCreateProfile(loadVehicleProfiles(store), VEHICLE_ID);
    assert.equal(afterRestart.xpBank, activated.xpBank, 'spent points stay spent');
    assert.deepEqual(afterRestart.hangarBonuses, activated.hangarBonuses);
    assert.equal(afterRestart.hangarStoneInventory.counts.stone_gold_t1, purchase.profile.hangarStoneInventory.counts.stone_gold_t1);

    // 6. Wirkung: der naechste Lauf spawnt mit mehr Leben als ein Lauf ohne Boni.
    const settings = {
        gameMode: 'CLASSIC',
        mapKey: 'parcours_rift',
        hunt: { respawnEnabled: false },
        localSettings: { sessionType: 'single', modePath: 'arcade' },
    };
    applyMenuCompatibilityRules(settings, {});
    const strategy = createGameModeStrategy(settings.gameMode, { random: () => 0.5 });

    const plain = { hasShield: false, baseSpeed: 18, speed: 18 };
    strategy.applyVehicleUpgrades?.(null);
    strategy.resetPlayerHealth(plain);

    const upgraded = { hasShield: false, baseSpeed: 18, speed: 18 };
    strategy.applyVehicleUpgrades?.(getSlotStatBonuses(afterRestart.upgrades, afterRestart.hangarBonuses));
    strategy.resetPlayerHealth(upgraded);
    strategy.applySpawnStatBonuses?.(upgraded);

    assert.ok(
        upgraded.maxHp > plain.maxHp,
        `the equipped armour reaches the player (${plain.maxHp} -> ${upgraded.maxHp})`
    );
});

test('a purchase the player cannot afford leaves the profile untouched', () => {
    const profile = { ...createArcadeVehicleProfile(VEHICLE_ID, 0), level: 9, xpBank: 10 };
    const purchase = purchaseHangarStone(profile, 'stone_gold_t1', 0);
    assert.equal(purchase.ok, false);
    assert.equal(purchase.code, 'insufficient_xrp');
    assert.equal(purchase.profile.xpBank, 10);
});

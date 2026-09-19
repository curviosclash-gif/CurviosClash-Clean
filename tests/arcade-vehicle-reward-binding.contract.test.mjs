import assert from 'node:assert/strict';
import test from 'node:test';

import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { ArenaWavesRuntime } from '../src/core/arcade/ArenaWavesRuntime.js';
import { FivePortalsRuntime } from '../src/core/arcade/FivePortalsRuntime.js';
import {
    collectEndlessRunXp,
    setEndlessRunProfile,
} from '../src/entities/endless/EndlessParcoursProgressionOps.js';
import { ARCADE_VEHICLE_PROFILE_STORAGE_KEY } from '../src/shared/contracts/ArcadeVehicleProfileContract.js';
import {
    ARCADE_VEHICLE_XP_RUN_TYPES,
    awardBoundArcadeVehicleXp,
    bindArcadeVehicleRewards,
} from '../src/state/arcade/ArcadeVehicleRewardBinding.js';
import {
    createArcadeVehicleProfile,
    purchaseUpgrade,
    xpForLevel,
} from '../src/state/arcade/ArcadeVehicleProfile.js';

const CURRENT_RUN_TYPES = Object.freeze([
    'gauntlet',
    'endless_parcours',
    'five_portals',
    'arena_waves',
]);

function createProfiles() {
    return {
        ship1: {
            ...createArcadeVehicleProfile('ship1', 0),
            xp: xpForLevel(15),
            totalXpEarned: xpForLevel(15),
            level: 15,
            xpBank: 2500,
        },
        ship2: {
            ...createArcadeVehicleProfile('ship2', 0),
            xp: 300,
            totalXpEarned: 300,
            level: 2,
            xpBank: 175,
        },
    };
}

function createStore(profiles = createProfiles()) {
    const data = new Map([[ARCADE_VEHICLE_PROFILE_STORAGE_KEY, structuredClone(profiles)]]);
    return {
        data,
        loadJsonRecord(key, fallback) {
            return data.has(key) ? structuredClone(data.get(key)) : fallback;
        },
        saveJsonRecord(key, value) {
            data.set(key, structuredClone(value));
            return true;
        },
    };
}

test('W7.2 every current Arcade run type binds rewards to the deployed vehicle', () => {
    assert.deepEqual(ARCADE_VEHICLE_XP_RUN_TYPES, CURRENT_RUN_TYPES);

    for (const runType of CURRENT_RUN_TYPES) {
        const profiles = createProfiles();
        const beforeShip1 = structuredClone(profiles.ship1);
        const beforeShip2 = structuredClone(profiles.ship2);
        const binding = bindArcadeVehicleRewards({ runType, vehicleId: 'ship1' });

        const selectedVehicleIdAfterStart = 'ship2';
        const result = awardBoundArcadeVehicleXp(profiles, binding, 15, 1000);

        assert.equal(selectedVehicleIdAfterStart, 'ship2');
        assert.equal(binding.vehicleId, 'ship1', `${runType} keeps the start vehicle`);
        assert.equal(result.earned, 15, `${runType} does not apply an XP multiplier`);
        assert.equal(profiles.ship1.xp, beforeShip1.xp + 15, `${runType} credits total XP`);
        assert.equal(profiles.ship1.xpBank, beforeShip1.xpBank + 15, `${runType} credits bank XP equally`);
        assert.deepEqual(profiles.ship2, beforeShip2, `${runType} does not mutate the later selection`);
    }
});

test('W7.2 a max-level vehicle keeps earning spendable XP up to the existing cap', () => {
    const profiles = {
        ship1: {
            ...createArcadeVehicleProfile('ship1', 0),
            xp: xpForLevel(30),
            level: 30,
            xpBank: 9_999_990,
        },
    };
    const binding = bindArcadeVehicleRewards({ runType: 'gauntlet', vehicleId: 'ship1' });

    awardBoundArcadeVehicleXp(profiles, binding, 20, 1000);

    assert.equal(profiles.ship1.level, 30);
    assert.equal(profiles.ship1.xp, xpForLevel(30) + 20);
    assert.equal(profiles.ship1.xpBank, 9_999_999);
});

test('W7.2 a Hangar purchase spends only the selected vehicle bank', () => {
    const profiles = createProfiles();
    const beforeShip1Xp = profiles.ship1.xp;
    const beforeShip1Level = profiles.ship1.level;
    const beforeShip2 = structuredClone(profiles.ship2);

    const purchase = purchaseUpgrade(profiles.ship1, 'core', 'T2', 1000);
    assert.equal(purchase.ok, true);
    profiles.ship1 = purchase.profile;

    assert.ok(profiles.ship1.xpBank < 2500);
    assert.equal(profiles.ship1.xp, beforeShip1Xp);
    assert.equal(profiles.ship1.level, beforeShip1Level);
    assert.deepEqual(profiles.ship2, beforeShip2);
});

test('W7.2 non-Arcade modes cannot create or apply a vehicle reward binding', () => {
    const profiles = createProfiles();
    const before = structuredClone(profiles);
    const binding = bindArcadeVehicleRewards({ runType: 'hunt', vehicleId: 'ship1' });

    assert.equal(binding, null);
    assert.equal(awardBoundArcadeVehicleXp(profiles, binding, 50, 1000), null);
    assert.deepEqual(profiles, before);
});

test('W7.2 changing the menu selection during a gauntlet cannot retarget checkpoint XP', () => {
    const store = createStore();
    const runtime = new ArcadeRunRuntime({
        now: () => 1000,
        settingsManager: { getPlayerRecordStorePort: () => store },
    });
    runtime.configure({ arcade: { enabled: true, runType: 'gauntlet' } });
    runtime.setActiveVehicle('ship1');
    runtime.startRun();
    const beforeShip1 = structuredClone(runtime._vehicleProfiles.ship1);
    const beforeShip2 = structuredClone(runtime._vehicleProfiles.ship2);

    runtime.setActiveVehicle('ship2');
    const result = runtime.applyParcoursXpEvent('checkpoint');

    assert.equal(result.earned, 10);
    assert.equal(runtime._vehicleProfiles.ship1.xp, beforeShip1.xp + 10);
    assert.equal(runtime._vehicleProfiles.ship1.xpBank, beforeShip1.xpBank + 10);
    assert.deepEqual(runtime._vehicleProfiles.ship2, beforeShip2);
    assert.equal(runtime.getVehicleProfile().vehicleId, 'ship1');
});

test('W7.2 Fünf Portale keeps its first vehicle across rebuilt map sessions', () => {
    const store = createStore();
    const runtime = new FivePortalsRuntime({ getRecordStore: () => store });
    runtime.start(null, { vehicleId: 'ship1' });
    const beforeShip2 = structuredClone(store.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).ship2);

    runtime.start(null, { vehicleId: 'ship2' });
    const result = runtime.handleXpEvent('checkpoint', 0);
    const saved = store.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY);

    assert.equal(result.vehicleId, 'ship1');
    assert.equal(saved.ship1.xpBank, 2510);
    assert.deepEqual(saved.ship2, beforeShip2);
});

test('W7.2 Arena-Wellen credits a human kill to the vehicle bound at run start', () => {
    const store = createStore();
    const human = { index: 0, isBot: false, baseSpeed: 1, maxHp: 100, hp: 100, fightLoadout: {} };
    const bot = { index: 1, isBot: true, maxHp: 100, hp: 100 };
    const entityManager = {
        players: [human, bot],
        humanPlayers: [human],
        bots: [{ player: bot }],
        deactivateBotSlot() {},
    };
    const runtime = new ArenaWavesRuntime({ getRecordStore: () => store, now: () => 1000 });
    runtime.start({ entityManager, vehicleId: 'ship1' });
    runtime.start({ entityManager, vehicleId: 'ship2' });
    runtime.phase = 'combat';
    runtime._activeSlots.add(0);
    runtime._slotWave.set(0, 1);
    runtime._waveStatus.set(1, { alive: 1, evicted: false });
    const beforeShip2 = structuredClone(store.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY).ship2);

    runtime.handleGameplayEvent({ type: 'kill', playerIndex: 0, victimIndex: 1 });
    const saved = store.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY);

    assert.equal(runtime.rewardBinding.vehicleId, 'ship1');
    assert.equal(saved.ship1.xpBank, 2515);
    assert.deepEqual(saved.ship2, beforeShip2);
});

test('W7.2 Endlos-Parcours binds once and never applies the retired mastery XP multiplier', () => {
    const store = createStore();
    const runtime = {
        _recordStore: store,
        startProfile: null,
        startVehicleId: '',
        startBonuses: null,
        entityManager: null,
        runXp: 0,
        _xpBonusPct: 100,
    };

    setEndlessRunProfile(runtime, { recordStore: store, vehicleId: 'ship1' });
    setEndlessRunProfile(runtime, { recordStore: store, vehicleId: 'ship2' });
    const earned = collectEndlessRunXp(runtime, 'kill', 1);

    assert.equal(runtime.rewardBinding.vehicleId, 'ship1');
    assert.equal(runtime.startVehicleId, 'ship1');
    assert.equal(earned, 15);
    assert.equal(runtime.runXp, 15);
});

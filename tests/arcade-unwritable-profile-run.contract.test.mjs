// A damaged vehicle profile record blocks every profile save on purpose (nothing may overwrite it).
// Such a save can never succeed, so the next arcade start used to throw forever and locked arcade for
// that profile. Now the run starts without saving, the damaged record stays untouched and the result
// screen says why. A save that may still succeed later (full storage) keeps blocking the next start.
import assert from 'node:assert/strict';
import test from 'node:test';

import '../src/core/Config.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { scheduleArcadeVehicleProfilesSave } from '../src/core/arcade/ArcadeRunPersistenceOps.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { buildArcadeSectorPlan } from '../src/entities/directors/ArcadeEncounterCatalog.js';
import { ARCADE_VEHICLE_PROFILE_STORAGE_KEY as KEY } from '../src/shared/contracts/ArcadeVehicleProfileContract.js';
import {
    addXp,
    createArcadeVehicleProfile,
    getOrCreateProfile,
    loadVehicleProfiles,
} from '../src/state/arcade/ArcadeVehicleProfile.js';
import { createArcadeRunBlocks } from '../src/ui/arcade/postrun/ArcadePostRunBlocks.js';

const CONFIG = { arcade: { enabled: true, seed: 5, sectorCount: 2 } };

// Raw strings like localStorage, read through readJsonRecordResult like the player record store port.
function createStore(raw, { full = false } = {}) {
    const records = new Map(Object.entries(raw));
    return {
        records,
        full,
        readJsonRecordResult(key) {
            if (!records.has(key)) return { ok: true, status: 'missing', value: null };
            const text = records.get(key);
            try { return { ok: true, status: 'found', value: JSON.parse(text), raw: text }; }
            catch { return { ok: false, status: 'invalid', value: null, raw: text }; }
        },
        loadJsonRecord(key, fallback = null) {
            const result = this.readJsonRecordResult(key);
            return result.status === 'found' ? result.value : fallback;
        },
        saveJsonRecord(key, value) {
            if (this.full) return { success: false, reason: 'quota_exceeded' };
            records.set(key, JSON.stringify(value));
            return true;
        },
    };
}

function playOneRun(store) {
    const strategy = new ArcadeModeStrategy();
    const runtime = new ArcadeRunRuntime({ settingsManager: { getPlayerRecordStorePort: () => store },
        now: () => 100000, strategy, arcadePersistenceSaveThrottleMs: 0, ghostLibrarySaveThrottleMs: 0,
        logger: { warn() {}, info() {}, error() {} } });
    runtime.configure(CONFIG);
    runtime.setActiveVehicle('ship5');
    runtime.startRun({ strategy, encounterPlan: buildArcadeSectorPlan({ seed: 5, sectorCount: 2 }) });
    runtime._vehicleProfiles = { ship5: { vehicleId: 'ship5', xp: 40 } };
    scheduleArcadeVehicleProfilesSave(runtime);
    return runtime;
}

test('a damaged profile record lets the next arcade run start without saving and stays untouched', () => {
    const store = createStore({ [KEY]: '"kaputt"' });
    const runtime = playOneRun(store);

    assert.doesNotThrow(() => runtime.configure(CONFIG), 'arcade stays playable for this profile');
    assert.equal(store.records.get(KEY), '"kaputt"', 'the damaged record is never overwritten');

    runtime._state = { ...(runtime._state || {}), postRunSummary: { score: 1 } };
    scheduleArcadeVehicleProfilesSave(runtime);
    assert.deepEqual(runtime._state.postRunSummary.saveFailures, ['vehicleProfiles']);
    assert.deepEqual(runtime._state.postRunSummary.saveBlockedKinds, ['vehicleProfiles'],
        'the result screen learns that this save cannot succeed');
    assert.equal(store.records.get(KEY), '"kaputt"');
});

test('a full storage still blocks the next start so the unsaved run progress is not dropped', () => {
    const store = createStore({}, { full: true });
    const runtime = playOneRun(store);
    assert.throws(() => runtime.configure(CONFIG), /konnte noch nicht gespeichert werden/);
});

test('the result screen explains a damaged record instead of blaming full storage', () => {
    const blocks = createArcadeRunBlocks({ score: 10, saveFailures: ['vehicleProfiles'], saveBlockedKinds: ['vehicleProfiles'] });
    const notice = blocks.find((block) => block.id === 'arcade-save-failure');
    assert.ok(notice, 'the failed save keeps its own card');
    const text = notice.rows.map((row) => String(row.value)).join(' ');
    assert.match(text, /beschädigt/);
    assert.doesNotMatch(text, /vermutlich voll/);
});

test('progress for a vehicle held back as a preserved record does not lock arcade for the next run', () => {
    const future = { schemaVersion: 'arcade-vehicle-profile.v99', vehicleId: 'ship5', xp: 100 };
    const store = createStore({ [KEY]: JSON.stringify({ ship5: future }) });
    const runtime = playOneRun(store);
    const profiles = loadVehicleProfiles(store);
    profiles.ship5 = addXp(getOrCreateProfile(profiles, 'ship5', 1), 250, 2).profile;
    profiles.ship1 = addXp(createArcadeVehicleProfile('ship1', 1), 40, 2).profile;
    runtime._vehicleProfiles = profiles;
    scheduleArcadeVehicleProfilesSave(runtime);

    assert.doesNotThrow(() => runtime.configure(CONFIG), 'arcade stays playable');
    const stored = JSON.parse(store.records.get(KEY));
    assert.deepEqual(stored.ship5, future, 'the preserved record stays untouched');
    assert.equal(stored.ship1?.xp, 40, 'the other vehicle keeps its XP');

    runtime._state = { ...(runtime._state || {}), postRunSummary: { score: 1 } };
    runtime._vehicleProfiles = profiles;
    scheduleArcadeVehicleProfilesSave(runtime);
    assert.deepEqual(runtime._state.postRunSummary.saveBlockedKinds, ['vehicleProfiles']);
});
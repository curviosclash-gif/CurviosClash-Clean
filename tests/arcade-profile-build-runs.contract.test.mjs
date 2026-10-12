// Which Arcade runs fly the pilot's profile build (stones, size, weapons) is decided once, by the
// rank contract's build-run list. Daily and the factory-size runs (weapon race, demolition) never
// get profile build bonuses from the shared Arcade run runtime.

import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/core/Config.js';
import { arcadeRunUsesProfileBuild } from '../src/shared/contracts/ArcadeDifficultyContract.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';

test('the build-run list alone decides which runs use the profile build', () => {
    for (const runType of ['gauntlet', 'endless_parcours', 'arena_waves', 'five_portals', 'hangar_test']) {
        assert.equal(arcadeRunUsesProfileBuild(runType), true, runType);
        assert.equal(arcadeRunUsesProfileBuild(runType, { dailyChallenge: true }), false, `${runType} as Daily`);
    }
    for (const runType of ['weapon_race', 'demolition', '', 'unknown_mode', undefined]) {
        assert.equal(arcadeRunUsesProfileBuild(runType), false, String(runType));
    }
});

test('the run runtime hands out no profile build for weapon race and demolition', () => {
    const store = { loadJsonRecord: (_key, fallback) => fallback, readJsonRecordResult: () => ({ status: 'missing' }) };
    const runtime = new ArcadeRunRuntime({ now: () => 1000, settingsManager: { getPlayerRecordStorePort: () => store } });
    const profile = { vehicleId: 'ship5', level: 12 };
    runtime._enabled = true;
    runtime._activeVehicleId = 'ship5';
    runtime._vehicleProfiles = { ship5: profile };
    runtime._state = { phase: 'sector_active', sectorIndex: 1, config: { comboWindowMs: 5000 }, score: { breakdown: {} } };

    runtime._config = { ...runtime._config, runType: 'gauntlet', dailyChallenge: false };
    assert.notEqual(runtime._getVehicleBonuses(profile), null, 'a gauntlet run keeps the profile build');
    for (const runType of ['weapon_race', 'demolition']) {
        runtime._config = { ...runtime._config, runType, dailyChallenge: false };
        assert.equal(runtime._getVehicleBonuses(profile), null, runType);
    }
});

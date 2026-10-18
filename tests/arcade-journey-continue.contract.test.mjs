import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ARCADE_LAST_RUN_SCHEMA_VERSION,
    ARCADE_LAST_RUN_STORAGE_KEY,
    createArcadeLastRunRecord,
    readArcadeLastRunRecord,
} from '../src/shared/contracts/ArcadeMenuPersistenceContract.js';
import { emptyProgress } from '../src/shared/contracts/ArcadeJourneyProgressContract.js';
import { resolveArcadeJourneyContinue } from '../src/shared/contracts/ArcadeJourneyContinueContract.js';
import { startMatchWithBorrowedSettings } from '../src/core/runtime/BorrowedMatchSettingsOps.js';
import { handleQuickStartLastStartAction } from '../src/core/runtime/MenuRuntimeQuickStartService.js';
import { PLATFORM_PRODUCT_SURFACE_IDS } from '../src/shared/contracts/PlatformCapabilityRegistry.js';
import { syncArcadeJourneyContinueSummary } from '../src/ui/arcade/ArcadeJourneyContinueMenuView.js';
import { menuScreenPanelId } from './support/menu-screens.js';
import { ARCADE_JOURNEY_STAGES, getArcadeJourneyStars, resolveArcadeJourneyAccess } from '../src/shared/contracts/ArcadeJourneyContract.js';

function memoryStore(initial = null) {
    const records = new Map(initial === null ? [] : [[ARCADE_LAST_RUN_STORAGE_KEY, initial]]);
    return {
        readJsonRecordResult(key) {
            return records.has(key) ? { status: 'found', value: structuredClone(records.get(key)) } : { status: 'missing' };
        },
        loadJsonRecord(key, fallback = null) { return records.has(key) ? structuredClone(records.get(key)) : fallback; },
        saveJsonRecord(key, value) {
            records.set(key, structuredClone(value));
            return true;
        },
        read() { return records.get(ARCADE_LAST_RUN_STORAGE_KEY) ?? null; },
    };
}

function makeGame({ profileId = 'pilot-a', store = memoryStore(), settings = null } = {}) {
    const profile = { id: profileId, displayName: profileId };
    const game = {
        settings: settings || {
            mode: '1p', gameMode: 'ARCADE', mapKey: 'standard', numBots: 3, botDifficulty: 'NORMAL',
            vehicles: { PLAYER_1: 'ship5' }, arcade: { seed: 42, difficultyTierId: 'normal' },
            localSettings: { sessionType: 'single', modePath: 'arcade' },
        },
        playerProfileManager: {
            getProfiles: () => [profile],
            getActiveProfile: () => profile,
            getRecordStorePort: () => store,
        },
        uiManager: { _runtimeFeatureFlags: { surfacePolicy: { productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP } } },
        _showStatusToast() {},
    };
    return { game, store };
}

test('an explicit profile unlock grants stages without medals and keeps player-count restrictions', () => {
    const ordinary = emptyProgress();
    const unlocked = { ...ordinary, allStagesUnlocked: true };
    for (const stage of ARCADE_JOURNEY_STAGES) {
        assert.equal(resolveArcadeJourneyAccess(stage.id, unlocked, { playerCount: 1 }).unlocked, true);
    }
    assert.equal(getArcadeJourneyStars(unlocked), 0);
    assert.equal(resolveArcadeJourneyAccess('five_portals', ordinary).unlocked, false);
    assert.equal(resolveArcadeJourneyAccess('flight_school', unlocked, { playerCount: 2 }).unlocked, false);
    assert.equal(resolveArcadeJourneyAccess('five_portals', { ...ordinary, allStagesUnlocked: 'true' }).unlocked, false);
    assert.equal(resolveArcadeJourneyAccess('five_portals', { ...unlocked, schema: 'future.v99' }).unlocked, false);
});

test('journey continuation is bound to one profile and current stage access', () => {
    const record = createArcadeLastRunRecord({ at: '2026-10-15T10:00:00.000Z', seed: 42,
        profileId: 'pilot-a', journeyStageId: 'five_portals' });
    assert.equal(resolveArcadeJourneyContinue(record, {
        profileId: 'pilot-a', progress: emptyProgress(), playerCount: 1,
    }).status, 'locked');
    assert.equal(resolveArcadeJourneyContinue(record, {
        profileId: 'pilot-b', progress: emptyProgress(), playerCount: 1,
    }).status, 'profile_mismatch');
    assert.equal(resolveArcadeJourneyContinue(record, {
        profileId: 'pilot-a', progress: emptyProgress(), playerCount: 1, legacyAccess: true,
    }).stageId, 'five_portals');
});

test('legacy records parse without a journey and future records are not accepted', () => {
    const legacy = { schemaVersion: ARCADE_LAST_RUN_SCHEMA_VERSION, at: '2026-10-15T10:00:00.000Z', seed: 7 };
    assert.equal(readArcadeLastRunRecord(legacy).record.journeyStageId, '');
    assert.equal(readArcadeLastRunRecord({ ...legacy, schemaVersion: 'arcade-last-run.v99' }).reason, 'unsupported_schema');
});

test('a failed borrowed journey start does not persist a continuation', async () => {
    const { game, store } = makeGame();
    assert.equal(await startMatchWithBorrowedSettings({ game, startMatch: () => false }, { journeyStageId: 'flight_school' }), false);
    assert.equal(store.read(), null);
});

test('a borrowed daily challenge is temporary, overrides Journey context, and restores after failed start', async () => {
    const { game, store } = makeGame();
    game.settings.arcade.dailyChallenge = false;
    game.settings.arcade.journeyStageId = 'first_run';
    const baseline = structuredClone(game.settings);
    let sawDailySettings = false;
    const started = await startMatchWithBorrowedSettings({
        game,
        startMatch: () => {
            sawDailySettings = game.settings.gameMode === 'ARCADE'
                && game.settings.localSettings.modePath === 'arcade'
                && game.settings.arcade.dailyChallenge === true
                && game.settings.arcade.journeyStageId === '';
            return false;
        },
        settingsHandler: { restoreSessionSettings: () => Object.assign(game.settings, structuredClone(baseline)) },
    }, { dailyChallenge: true, journeyStageId: 'first_run' });
    assert.equal(started, false);
    assert.equal(sawDailySettings, true);
    assert.deepEqual(game.settings, baseline);
    assert.equal(store.read(), null);
});

test('a successful borrowed daily challenge clears any old Journey continuation', async () => {
    const oldRecord = createArcadeLastRunRecord({ at: '2026-10-15T10:00:00.000Z', seed: 42,
        profileId: 'pilot-a', journeyStageId: 'first_run' });
    const store = memoryStore(oldRecord);
    const { game } = makeGame({ store });
    assert.equal(await startMatchWithBorrowedSettings({ game, startMatch: () => true }, { dailyChallenge: true }), true);
    assert.equal(store.read().journeyStageId, '');
    assert.equal(store.read().profileId, 'pilot-a');
});

test('a successful borrowed journey start saves continuation only to the active profile', async () => {
    const storeA = memoryStore();
    const storeB = memoryStore();
    const { game } = makeGame({ store: storeA });
    const profiles = [{ id: 'pilot-a', displayName: 'pilot-a' }, { id: 'pilot-b', displayName: 'pilot-b' }];
    let activeProfile = profiles[0];
    game.playerProfileManager.getProfiles = () => profiles;
    game.playerProfileManager.getActiveProfile = () => activeProfile;
    game.playerProfileManager.getRecordStorePort = id => id === 'pilot-a' ? storeA : id === 'pilot-b' ? storeB : null;
    assert.equal(await startMatchWithBorrowedSettings({ game, startMatch: () => true }, { journeyStageId: 'flight_school' }), true);
    assert.equal(storeA.read().profileId, 'pilot-a');
    assert.equal(storeA.read().journeyStageId, 'flight_school');
    assert.equal(storeB.read(), null);
    activeProfile = profiles[1];
    assert.equal(await startMatchWithBorrowedSettings({ game, startMatch: () => true }, { journeyStageId: 'first_run' }), true);
    assert.equal(storeB.read().profileId, 'pilot-b');
    assert.equal(storeB.read().journeyStageId, 'first_run');
    assert.equal(storeA.read().journeyStageId, 'flight_school');
});

test('a borrowed journey start never overwrites corrupt or future last-run data', async () => {
    for (const invalid of [
        { schemaVersion: ARCADE_LAST_RUN_SCHEMA_VERSION, at: '', seed: 0 },
        { schemaVersion: 'arcade-last-run.v99', at: '2026-10-15T10:00:00.000Z', seed: 4 },
    ]) {
        const store = memoryStore(invalid);
        const { game } = makeGame({ store });
        assert.equal(await startMatchWithBorrowedSettings({ game, startMatch: () => true }, { journeyStageId: 'flight_school' }), true);
        assert.deepEqual(store.read(), invalid);
    }
});

test('Weiterspielen starts an accessible profile journey through borrowed settings', async () => {
    const lastRun = createArcadeLastRunRecord({ at: '2026-10-15T10:00:00.000Z', seed: 42,
        profileId: 'pilot-a', journeyStageId: 'flight_school' });
    const store = memoryStore(lastRun);
    const { game } = makeGame({ store });
    const startedWith = [];
    const ctx = {
        game, recordMenuTelemetry() {}, getMultiplayerSessionState: () => null,
        startMatch: () => { startedWith.push({ mapKey: game.settings.mapKey, gameMode: game.settings.gameMode }); return true; },
        holdSessionSettingsRestore() {}, restoreSessionSettings() {},
    };
    assert.equal(await handleQuickStartLastStartAction(ctx), true);
    assert.deepEqual(startedWith, [{ mapKey: 'tutorial_classic', gameMode: 'CLASSIC' }]);
});

test('generic Weiterspielen remains available for a last run without journey context', async () => {
    const store = memoryStore(createArcadeLastRunRecord({ at: '2026-10-15T10:00:00.000Z', seed: 42 }));
    const { game } = makeGame({ store });
    let starts = 0;
    const ctx = { game, recordMenuTelemetry() {}, getMultiplayerSessionState: () => null, startMatch: () => { starts += 1; return true; } };
    assert.equal(await handleQuickStartLastStartAction(ctx), true);
    assert.equal(starts, 1);
});

test('a fresh profile opens the journey hub without starting a different profile selection', async () => {
    const { game } = makeGame();
    const panels = [];
    game.uiManager.menuNavigationRuntime = { showPanel: panel => panels.push(panel) };
    let starts = 0;
    const ctx = { game, recordMenuTelemetry() {}, getMultiplayerSessionState: () => null, startMatch: () => { starts += 1; return true; } };
    assert.equal(await handleQuickStartLastStartAction(ctx), false);
    assert.equal(starts, 0);
    assert.deepEqual(panels, [menuScreenPanelId('modeChoice')]);
});

test('the continue summary names the active profile journey and preserves a joined lobby', () => {
    const label = { textContent: 'Weiterspielen' };
    const ui = { quickStartLastTitle: {}, quickStartLastSummary: {}, quickStartLastButton: { querySelector: () => label } };
    const { game, store } = makeGame();
    const runtimeAccess = { getSettingsStore: () => store };
    const profile = { id: 'pilot-a', displayName: 'Pilot A' };
    const sync = options => syncArcadeJourneyContinueSummary({ ui, settings: game.settings, runtimeAccess, profile, ...options });
    sync();
    assert.equal(label.textContent, 'Losfliegen');
    assert.match(ui.quickStartLastSummary.textContent, /Pilot A/);
    store.saveJsonRecord(ARCADE_LAST_RUN_STORAGE_KEY, createArcadeLastRunRecord({ at: '2026-10-15T10:00:00.000Z', seed: 42, profileId: 'pilot-a', journeyStageId: 'flight_school' }));
    sync();
    assert.equal(label.textContent, 'Weiterspielen');
    assert.equal(ui.quickStartLastTitle.textContent, 'Flugschule · Etappe 1');
    label.textContent = 'Zur Lobby';
    sync({ hasActiveLobbySession: true });
    assert.equal(label.textContent, 'Zur Lobby');
});

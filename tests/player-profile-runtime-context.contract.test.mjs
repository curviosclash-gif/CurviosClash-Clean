import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlayerProfileMenuRuntimeAccess, resolveHangarPlayerProfileContext } from '../src/core/runtime/PlayerProfileRuntimeAccess.js';
import { createBrowserHangarPagePort } from '../src/platform/browser/BrowserHangarPagePort.js';
import { createBrowserPageHangarAdapter } from '../src/platform/browser/BrowserPlatformAdapters.js';
import { createArcadeRunRecords } from '../src/state/arcade/ArcadeRunState.js';
import { GAUNTLET_FREE_RUN_PROFILE_STORAGE_KEY } from '../src/shared/contracts/ArcadeRunSettingsContract.js';

function harness() {
    const profiles = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const stores = Object.fromEntries(profiles.map(profile => [profile.id, { id: profile.id }]));
    const manager = { getProfiles: () => profiles, getActiveProfile: () => profiles[0], getRecordStorePort: id => stores[id] };
    const game = { playerProfileManager: manager, settingsManager: { getPlayerRecordStorePort: () => stores.a },
        settings: { localSettings: { sessionType: 'splitscreen', startSetup: { arcadePlayerProfileIds: ['b', 'c', 'a'] } } } };
    return { profiles, stores, manager, game, access: createPlayerProfileMenuRuntimeAccess(game) };
}

test('Arcade menu and the requested hangar share P1 B while general settings keep active A', () => {
    const { access, manager, stores } = harness();
    assert.equal(access.getSettingsStore(), stores.a);
    assert.equal(access.getActivePlayerProfile().id, 'a');
    assert.equal(access.getArcadePrimaryPlayerProfile().id, 'b');
    assert.equal(access.getArcadeSettingsStore(), stores.b);
    assert.deepEqual(resolveHangarPlayerProfileContext(manager, 'b'), { profile: { id: 'b' }, store: stores.b });
    assert.equal(manager.getActiveProfile().id, 'a');
    assert.equal(resolveHangarPlayerProfileContext(manager, 'deleted'), null);
});

test('profile selection follows solo defaults and rejects stale explicit split IDs', () => {
    const { access, game, stores } = harness();
    game.settings.localSettings.startSetup.arcadePlayerProfileIds[0] = 'deleted';
    assert.equal(access.getArcadeSettingsStore(), null);
    game.settings.localSettings.sessionType = 'single';
    assert.equal(access.getArcadeSettingsStore(), stores.a);
});

test('personal menu records follow the selected primary store before a run has started', () => {
    const { access, stores, game } = harness();
    stores.a.loadJsonRecord = key => key === GAUNTLET_FREE_RUN_PROFILE_STORAGE_KEY ? { ...createArcadeRunRecords(), bestScore: 111 } : null;
    stores.b.loadJsonRecord = key => key === GAUNTLET_FREE_RUN_PROFILE_STORAGE_KEY ? { ...createArcadeRunRecords(), bestScore: 333 } : null;
    assert.equal(access.getArcadePrimaryProfileRecords().records.bestScore, 333);
    game.settings.localSettings.startSetup.arcadePlayerProfileIds[0] = 'deleted';
    assert.equal(access.getArcadePrimaryProfileRecords().records.bestScore, 0, 'a missing profile never shows active A records');
});

test('browser hangar navigation encodes the profile independently of its mode', async () => {
    let destination;
    const adapter = createBrowserPageHangarAdapter({ location: { assign: url => { destination = url; } } });
    await adapter.openWindow({ mode: 'arcade', profileId: 'b&mode=fight' });
    const url = new URL(destination, 'https://local.invalid/');
    assert.equal(url.searchParams.get('mode'), 'arcade');
    assert.equal(url.searchParams.get('profileId'), 'b&mode=fight');
    const page = createBrowserHangarPagePort({ location: { search: url.search } });
    assert.equal(page.getPlayerProfileId(), 'b&mode=fight');
    await adapter.openWindow({ mode: 'fight', profileId: 'b' });
    assert.equal(new URL(destination, 'https://local.invalid/').searchParams.has('profileId'), false);
});

test('the vehicle workshop writes into the arcade primary profile, not into the active profile', () => {
    const { access, stores, game } = harness();
    for (const store of Object.values(stores)) {
        const records = new Map();
        store.records = records;
        store.loadJsonRecord = (key, fallback = null) => (records.has(key) ? structuredClone(records.get(key)) : fallback);
        store.readJsonRecordResult = (key) => (records.has(key)
            ? { ok: true, status: 'found', value: structuredClone(records.get(key)) }
            : { ok: true, status: 'missing', value: null });
        store.saveJsonRecord = (key, value) => { records.set(key, structuredClone(value)); return true; };
    }
    const workshop = access.arcadeVehicleProfileWorkshop;
    const profiles = workshop.load();
    profiles.ship1 = { ...workshop.getOrCreate(profiles, 'ship1'), xp: 70 };
    workshop.save(profiles);
    assert.equal(stores.b.records.size > 0, true, 'split-screen P1 B receives the workshop save');
    assert.equal(stores.a.records.size, 0, 'the active profile A stays untouched');

    game.settings.localSettings.startSetup.arcadePlayerProfileIds[0] = 'deleted';
    assert.equal(workshop.save(workshop.load()) === true, false, 'a stale P1 never falls back to active A');
    assert.equal(stores.a.records.size, 0);
});
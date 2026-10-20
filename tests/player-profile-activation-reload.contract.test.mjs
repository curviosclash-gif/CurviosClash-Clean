import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import test from 'node:test';

import { EDITOR_VIEW_PATHS } from '../src/shared/contracts/EditorPathContract.js';
import { PlayerProfileManager } from '../src/application/player-profile/PlayerProfileManager.js';
import { CONFIG } from '../src/core/Config.js';
import { ProfileManager } from '../src/core/ProfileManager.js';
import { SettingsManager } from '../src/core/SettingsManager.js';
import { GameRuntimeSettingsHandler } from '../src/core/runtime/GameRuntimeSettingsHandler.js';
import { GAME_STATE_IDS } from '../src/shared/contracts/GameStateIds.js';
import { STORAGE_KEYS } from '../src/shared/storage/StorageKeys.js';
import { PlayerProfileUiController } from '../src/ui/PlayerProfileUiController.js';
import { ProfileUiController } from '../src/ui/ProfileUiController.js';

const require = createRequire(import.meta.url);
const windowSecurity = require('../electron/window-security-options.cjs');

const APP_URL = 'http://127.0.0.1:38765/';

registerHooks({
    load(url, context, nextLoad) {
        if (url.endsWith('.css')) return { format: 'module', source: 'export default "";', shortCircuit: true };
        return nextLoad(url, context);
    },
});
const previousWindow = globalThis.window;
const previousDocument = globalThis.document;
globalThis.window = { addEventListener() {}, removeEventListener() {}, location: { search: '' } };
globalThis.document = { readyState: 'loading', addEventListener() {} };
const { Game } = await import('../src/core/main.js');
if (previousWindow === undefined) delete globalThis.window;
else globalThis.window = previousWindow;
if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;

function navigate(guard, url) {
    let prevented = false;
    guard({ preventDefault() { prevented = true; } }, url);
    return prevented ? 'blocked' : 'allowed';
}

test('the main window guard lets the game reload its own page', () => {
    // Activating a player profile reloads the page; Electron reports that as will-navigate.
    const guard = windowSecurity.createMainWindowNavigationGuard?.(APP_URL);
    assert.equal(typeof guard, 'function', 'createMainWindowNavigationGuard is exported');
    assert.equal(navigate(guard, APP_URL), 'allowed');
    assert.equal(navigate(guard, 'http://127.0.0.1:38765/index.html'), 'allowed');
});

test('the main window guard still blocks every other target', () => {
    const guard = windowSecurity.createMainWindowNavigationGuard(APP_URL);
    assert.equal(navigate(guard, 'https://example.com/'), 'blocked');
    assert.equal(navigate(guard, 'http://127.0.0.1:9999/'), 'blocked');
    assert.equal(navigate(guard, new URL(EDITOR_VIEW_PATHS.MAP_EDITOR, APP_URL).href), 'blocked');
    assert.equal(navigate(guard, 'file:///C:/Windows/win.ini'), 'blocked');
    assert.equal(navigate(guard, 'not a url'), 'blocked');
});

test('the Electron main window installs the app-url guard instead of a blanket block', () => {
    const source = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
    assert.match(source, /mainWindow\.webContents\.on\('will-navigate',\s*createMainWindowNavigationGuard\(appServer\.url\)\)/);
});

function createFakeElement() {
    const listeners = new Map();
    return {
        value: '',
        disabled: false,
        textContent: '',
        dataset: {},
        children: [],
        classList: { add() {}, remove() {} },
        addEventListener(name, handler) {
            const current = listeners.get(name) || [];
            current.push(handler);
            listeners.set(name, current);
        },
        removeEventListener(name, handler) {
            listeners.set(name, (listeners.get(name) || []).filter((entry) => entry !== handler));
        },
        replaceChildren() { this.children = []; },
        appendChild(child) { this.children.push(child); },
        matches: () => false,
        removeAttribute() {},
        async fire(name) {
            let result;
            for (const handler of listeners.get(name) || []) result = await handler({ target: this });
            return result;
        },
    };
}

function createController({ activateResult }) {
    const elements = new Map();
    const profiles = [
        { id: 'p1', displayName: 'Spieler 1' },
        { id: 'p2', displayName: 'Blitz' },
    ];
    let activeId = 'p1';
    const timers = [];
    const toasts = [];
    const controller = new PlayerProfileUiController({
        playerProfileManager: {
            getProfiles: () => profiles,
            getActiveProfile: () => profiles.find((profile) => profile.id === activeId),
            getDefaultProfile: () => profiles[0],
        },
        activateProfile: async (id) => {
            if (activateResult.ok) activeId = id;
            return activateResult;
        },
        showStatusToast: (message, duration, tone) => toasts.push({ message, tone }),
        setTimeout: (callback, delayMs) => timers.push({ callback, delayMs }),
        document: {
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, createFakeElement());
                return elements.get(id);
            },
            createElement: () => createFakeElement(),
        },
    });
    controller.init();
    return { controller, elements, timers, toasts };
}

test('a successful activation refreshes the list and reports a missing reload', async () => {
    const { controller, elements, timers, toasts } = createController({ activateResult: { ok: true } });
    elements.get('player-profile-select').value = 'p2';
    await controller._activateSelected();
    assert.equal(elements.get('player-profile-summary').textContent, 'Spieler: Blitz');
    assert.equal(timers.length, 1, 'a reload watchdog is armed');
    assert.equal(timers[0].delayMs, 2000);
    timers[0].callback();
    assert.equal(toasts.at(-1).tone, 'error');
    assert.match(toasts.at(-1).message, /neu starten/);
});

test('a refused activation arms no watchdog', async () => {
    const { controller, elements, timers, toasts } = createController({
        activateResult: { ok: false, reason: 'match_active' },
    });
    elements.get('player-profile-select').value = 'p2';
    await controller._activateSelected();
    assert.equal(timers.length, 0);
    assert.equal(toasts.at(-1).tone, 'error');
});

test('a partial player-profile activation stays visible and can retry settings before reload', async () => {
    const records = new Map();
    let denySettingsWrites = true;
    const storage = {
        getItem(key) { return records.get(key) ?? null; },
        setItem(key, value) {
            if (key === STORAGE_KEYS.settings && denySettingsWrites) {
                const error = new Error('storage denied');
                error.name = 'SecurityError';
                throw error;
            }
            records.set(String(key), String(value));
        },
        removeItem(key) { records.delete(key); },
    };
    const settingsManager = new SettingsManager({ storage });
    const profileManager = new ProfileManager(settingsManager.getProfileStorePort());
    const preferredSettings = settingsManager.createDefaultSettings();
    const initialMapKey = preferredSettings.mapKey;
    preferredSettings.mapKey = Object.keys(CONFIG.MAPS).find((mapKey) => mapKey !== initialMapKey);
    assert.ok(preferredSettings.mapKey);
    assert.equal(profileManager.saveProfile('Retry settings', preferredSettings, profileManager.getActiveProfileName()).success, true);

    let profileIdSequence = 70;
    const playerProfileManager = new PlayerProfileManager({
        recordStore: settingsManager.getSettingsRecordStorePort(),
        getPreferredSettingsProfileName: () => profileManager.getActiveProfileName(),
        createId: () => `00000000-0000-4000-8000-${String(++profileIdSequence).padStart(12, '0')}`,
    });
    assert.equal(playerProfileManager.bootstrap().ok, true);
    const targetProfile = playerProfileManager.createProfile('Retry player').profile;

    const game = Object.create(Game.prototype);
    game.settingsManager = settingsManager;
    game.settings = settingsManager.loadSettings();
    game.settingsDirty = false;
    game.state = GAME_STATE_IDS.MENU;
    game.playerProfileManager = playerProfileManager;
    game.profileManager = profileManager;
    const toasts = [];
    const settingsHandler = new GameRuntimeSettingsHandler({ facade: { game } });
    game.runtimeCoordinator = {
        getRuntimeFacade: () => ({ settingsHandler }),
        getUiManager: () => ({ showToast: (...args) => toasts.push(args) }),
        markSettingsDirty: (dirty) => { game.settingsDirty = dirty; },
        onSettingsChanged() {},
    };
    settingsManager.setPlayerProfileManager(playerProfileManager);
    game.profileUiController = new ProfileUiController({
        profileManager,
        settingsManager,
        getUi: () => ({}),
        getUiManager: () => null,
        getSettings: () => game.settings,
        setSettings: (settings) => { game.settings = settings; },
        showStatusToast: (...args) => game._showStatusToast(...args),
        onSettingsChanged: () => game._onSettingsChanged(),
        markSettingsDirty: (dirty) => game._markSettingsDirty(dirty),
        profileDataOps: profileManager.getProfileDataOps(),
        profileControlStateOps: profileManager.getProfileControlStateOps(),
        profileUiStateOps: profileManager.getProfileUiStateOps(),
    });

    const elements = new Map();
    const timers = [];
    const controller = new PlayerProfileUiController({
        playerProfileManager,
        activateProfile: (profileId) => game._activatePlayerProfile(profileId),
        showStatusToast: (...args) => toasts.push(args),
        setTimeout: (callback, delayMs) => { timers.push({ callback, delayMs }); return timers.length; },
        document: {
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, createFakeElement());
                return elements.get(id);
            },
            createElement: () => createFakeElement(),
        },
    });
    controller.init();
    const select = elements.get('player-profile-select');
    const activate = elements.get('btn-player-profile-activate');
    const status = elements.get('player-profile-status');
    select.value = targetProfile.id;
    await select.fire('change');

    const reloadJobs = [];
    const originalSetTimeout = globalThis.setTimeout;
    const originalLocation = globalThis.location;
    let reloadCount = 0;
    globalThis.setTimeout = (callback, delay) => { reloadJobs.push({ callback, delay }); return reloadJobs.length; };
    globalThis.location = { reload: () => { reloadCount += 1; } };
    try {
        assert.equal(activate.disabled, false);
        await activate.fire('click');
        assert.equal(playerProfileManager.getActiveProfile().id, targetProfile.id);
        assert.equal(elements.get('player-profile-summary').textContent, `Spieler: ${targetProfile.displayName}`);
        assert.equal(select.children.find((option) => option.value === targetProfile.id).textContent.includes('aktiv'), true);
        assert.equal(select.value, targetProfile.id);
        assert.equal(activate.disabled, false, 'partial activation leaves an explicit settings retry available');
        assert.equal(activate.textContent, 'Einstellungen erneut speichern');
        assert.match(status.textContent, /aktiv.*Einstellungen konnten nicht gespeichert werden.*erneut speichern/i);
        assert.equal(status.dataset.tone, 'error');
        assert.equal(game.settingsDirty, true);
        assert.equal(records.has(STORAGE_KEYS.settings), false);
        assert.equal(toasts.some(([message]) => message.startsWith('Spielerprofil wird geladen:')), false);
        assert.equal(timers.length, 0, 'partial activation does not arm the reload watchdog');
        assert.equal(reloadJobs.length, 0);
        assert.equal(reloadCount, 0);

        const otherProfileId = select.children.find((option) => option.value && option.value !== targetProfile.id)?.value;
        assert.ok(otherProfileId, 'the fixture lists a second profile');
        select.value = otherProfileId;
        await select.fire('change');
        assert.equal(activate.textContent, 'Aktivieren', 'another profile shows the normal action');
        select.value = targetProfile.id;
        await select.fire('change');
        assert.equal(activate.disabled, false, 'looking at another profile does not drop the retry');
        assert.equal(activate.textContent, 'Einstellungen erneut speichern');

        denySettingsWrites = false;
        const retryResult = await activate.fire('click');
        assert.equal(retryResult.ok, true);
        assert.equal(game.settingsDirty, false);
        assert.equal(JSON.parse(records.get(STORAGE_KEYS.settings)).mapKey, preferredSettings.mapKey);
        assert.equal(activate.disabled, true, 'successful retry restores the normal active-profile button state');
        assert.equal(activate.textContent, 'Aktivieren');
        assert.equal(status.textContent, `Spielerprofil wird geladen: ${targetProfile.displayName}`);
        assert.equal(status.dataset.tone, 'success');
        assert.equal(timers.length, 1);
        assert.equal(timers[0].delayMs, 2000);
        assert.equal(reloadJobs.length, 1);
        assert.equal(reloadJobs[0].delay, 40);
        reloadJobs[0].callback();
        assert.equal(reloadCount, 1);
    } finally {
        globalThis.setTimeout = originalSetTimeout;
        if (originalLocation === undefined) delete globalThis.location;
        else globalThis.location = originalLocation;
        controller.dispose();
    }
});

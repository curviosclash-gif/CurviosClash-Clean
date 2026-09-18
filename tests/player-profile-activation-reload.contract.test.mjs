import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

import { EDITOR_VIEW_PATHS } from '../src/shared/contracts/EditorPathContract.js';
import { PlayerProfileUiController } from '../src/ui/PlayerProfileUiController.js';

const require = createRequire(import.meta.url);
const windowSecurity = require('../electron/window-security-options.cjs');

const APP_URL = 'http://127.0.0.1:38765/';

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
        addEventListener(name, handler) { listeners.set(name, handler); },
        removeEventListener(name) { listeners.delete(name); },
        replaceChildren() {},
        appendChild() {},
        matches: () => false,
        fire: (name) => listeners.get(name)?.(),
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { EDITOR_VIEW_PATHS } from '../src/shared/contracts/EditorPathContract.js';

const require = createRequire(import.meta.url);
const {
    createEditorWindowOpenHandler,
    createPlaytestWindowOpenHandler,
    createSecureWindowWebPreferences,
} = require('../electron/window-security-options.cjs');

function readSource(relativePath) {
    return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

test('every Electron window uses the executable renderer security policy', () => {
    for (const relativePath of [
        '../electron/main.cjs',
        '../electron/tuning-window.cjs',
        '../electron/hangar-window.cjs',
        '../electron/settings-studio/main.cjs',
    ]) {
        const source = readSource(relativePath);
        assert.match(source, /createSecureWindowWebPreferences\s*\(/);
    }

    const auxiliary = createSecureWindowWebPreferences({ preload: 'aux-preload.cjs' });
    assert.deepEqual(auxiliary, {
        preload: 'aux-preload.cjs',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
    });

    const main = createSecureWindowWebPreferences({ preload: 'main-preload.cjs', sandbox: false });
    assert.equal(main.sandbox, false);
    assert.equal(main.contextIsolation, true);
    assert.equal(main.nodeIntegration, false);
});

test('auxiliary game windows deny renderer navigation and popups', () => {
    for (const relativePath of [
        '../electron/tuning-window.cjs',
        '../electron/hangar-window.cjs',
    ]) {
        const source = readSource(relativePath);
        assert.match(source, /webContents(?:\?\.|\.)on(?:\?\.)?\('will-navigate',[\s\S]*event\.preventDefault\(\)/);
        assert.match(source, /webContents(?:\?\.|\.)setWindowOpenHandler(?:\?\.)?\(\(\)\s*=>\s*\(\{\s*action:\s*'deny'\s*\}\)\)/);
    }
});

test('main window allows only same-origin editor popups with isolated renderers', () => {
    const appUrl = 'http://127.0.0.1:38765/';
    const handleWindowOpen = createEditorWindowOpenHandler(appUrl);
    const resolveAppUrl = (viewPath, baseUrl = appUrl) => new URL(viewPath, baseUrl).href;
    for (const url of [EDITOR_VIEW_PATHS.MAP_EDITOR, EDITOR_VIEW_PATHS.VEHICLE_LAB].map((viewPath) => resolveAppUrl(viewPath))) {
        const result = handleWindowOpen({ url });
        assert.equal(result.action, 'allow');
        assert.equal(result.overrideBrowserWindowOptions.webPreferences.contextIsolation, true);
        assert.equal(result.overrideBrowserWindowOptions.webPreferences.nodeIntegration, false);
        assert.equal(result.overrideBrowserWindowOptions.webPreferences.sandbox, true);
    }

    for (const url of [
        resolveAppUrl(EDITOR_VIEW_PATHS.MAP_EDITOR, 'https://example.com/'),
        `${resolveAppUrl(EDITOR_VIEW_PATHS.MAP_EDITOR)}.evil`,
        appUrl,
        'not-a-url',
    ]) {
        assert.deepEqual(handleWindowOpen({ url }), { action: 'deny' });
    }

    const source = readSource('../electron/main.cjs');
    assert.match(source, /setWindowOpenHandler\(createEditorWindowOpenHandler\(appServer\.url\)\)/);
    assert.match(source, /'did-create-window'[\s\S]*createPlaytestWindowOpenHandler\(appServer\.url\)/);
    assert.match(source, /playtestWindow\.webContents\.setWindowOpenHandler\(\(\)\s*=>\s*\(\{\s*action:\s*'deny'\s*\}\)\)/);
});

test('map editor allows only its same-origin playtest popup', () => {
    const handleWindowOpen = createPlaytestWindowOpenHandler('http://127.0.0.1:38765/');
    for (const url of [
        'http://127.0.0.1:38765/?playtest=1&planar=0',
        'http://127.0.0.1:38765/index.html?playtest=1&planar=0',
    ]) {
        const result = handleWindowOpen({ url });
        assert.equal(result.action, 'allow');
        assert.equal(result.overrideBrowserWindowOptions.webPreferences.sandbox, true);
    }

    for (const url of [
        'http://127.0.0.1:38765/',
        'http://127.0.0.1:38765/?playtest=0',
        'https://example.com/?playtest=1',
    ]) {
        assert.deepEqual(handleWindowOpen({ url }), { action: 'deny' });
    }
});

test('desktop capability IPC remains bound to the owning window main frame', () => {
    const source = readSource('../electron/main.cjs');
    const guardSource = readSource('../electron/ipc-sender-guard.cjs');
    assert.match(source, /assertTrustedWindowSender\(event,\s*mainWindow\)/);
    assert.match(guardSource, /event\.senderFrame\s*===\s*webContents\.mainFrame/);
    assert.match(source, /ipcMain\.handle\('start-lan-server',\s*withTrustedMainWindowSender\(/);
    assert.match(source, /ipcMain\.handle\('save-replay',\s*withTrustedMainWindowSender\(/);
    assert.match(source, /ipcMain\.handle\('save-recording-video-export',\s*withTrustedMainWindowSender\(/);
});

test('Settings Studio IPC remains bound to its owning window main frame', () => {
    const mainSource = readSource('../electron/settings-studio/main.cjs');
    const ipcSource = readSource('../electron/settings-studio/ipc/settings-studio-ipc.cjs');
    assert.match(mainSource, /getWindow:\s*\(\)\s*=>\s*mainWindow/);
    assert.match(mainSource, /isTrustedWindowSender\(event,\s*mainWindow\)/);
    assert.match(ipcSource, /assertTrustedWindowSender\(event,\s*getWindow\?\.\(\)\)/);
    assert.match(ipcSource, /registerTrustedHandler\(CHANNELS\.save/);
    assert.match(ipcSource, /registerTrustedHandler\(CHANNELS\.restoreBackup/);
});

test('Settings Studio denies renderer navigation, popups, and remote content', () => {
    const mainSource = readSource('../electron/settings-studio/main.cjs');
    const htmlSource = readSource('../electron/settings-studio/ui/settings-studio.html');
    assert.match(mainSource, /webContents\.on\('will-navigate',[\s\S]*event\.preventDefault\(\)/);
    assert.match(mainSource, /setWindowOpenHandler\(\(\)\s*=>\s*\(\{\s*action:\s*'deny'\s*\}\)\)/);
    assert.match(htmlSource, /Content-Security-Policy/);
    assert.match(htmlSource, /default-src 'self'/);
    assert.match(htmlSource, /connect-src 'none'/);
});

test('Settings Studio treats legacy profile migration as best effort', () => {
    const source = readSource('../electron/settings-studio/main.cjs');
    assert.match(source, /try\s*\{[\s\S]*fs\.mkdirSync\(sharedUserDataPath/);
    assert.match(source, /try\s*\{[\s\S]*fs\.cpSync\(sourcePath, targetPath/);
    assert.match(source, /Legacy data migration skipped/);
});

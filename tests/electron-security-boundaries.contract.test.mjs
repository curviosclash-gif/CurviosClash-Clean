import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function readSource(relativePath) {
    return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

test('every Electron window explicitly isolates its renderer from Node.js', () => {
    for (const relativePath of [
        '../electron/main.cjs',
        '../electron/tuning-window.cjs',
        '../electron/hangar-window.cjs',
        '../electron/settings-studio/main.cjs',
    ]) {
        const source = readSource(relativePath);
        assert.match(source, /contextIsolation:\s*true/);
        assert.match(source, /nodeIntegration:\s*false/);
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

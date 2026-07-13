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

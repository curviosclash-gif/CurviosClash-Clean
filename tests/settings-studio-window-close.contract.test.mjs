import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Loads the real Settings Studio main process against a fake Electron, so close and quit
// paths run in Node: a hung or crashed Studio UI must never trap the window.
const require = createRequire(import.meta.url);
const STUDIO_MAIN = require.resolve('../electron/settings-studio/main.cjs');
const scratchRoots = [];

class FakeWebContents extends EventEmitter {
    constructor() { super(); this.mainFrame = {}; this.sent = []; }
    send(channel, ...args) { this.sent.push([channel, ...args]); }
    setWindowOpenHandler() {}
}

class FakeWindow extends EventEmitter {
    constructor() { super(); this.webContents = new FakeWebContents(); this.destroyed = false; FakeWindow.created.push(this); }
    async loadFile() {}
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    focus() {}
    close() {
        const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
        this.emit('close', event);
        if (event.defaultPrevented) return false;
        this.destroyed = true;
        this.emit('closed');
        return true;
    }
}
FakeWindow.created = [];

async function loadStudio({ dialogAnswer = 0 } = {}) {
    const appData = mkdtempSync(path.join(tmpdir(), 'curvios-studio-close-'));
    scratchRoots.push(appData);
    const app = new EventEmitter();
    let ready;
    const readyPromise = new Promise((resolve) => { ready = resolve; });
    Object.assign(app, {
        isPackaged: false,
        quitCalls: 0,
        getPath: (name) => path.join(appData, name),
        setPath() {},
        setAppUserModelId() {},
        requestSingleInstanceLock: () => true,
        whenReady: () => readyPromise,
        quit() { this.quitCalls += 1; },
    });
    const ipcMain = new EventEmitter();
    const handlers = new Map();
    ipcMain.handle = (channel, handler) => handlers.set(channel, handler);
    ipcMain.removeHandler = (channel) => handlers.delete(channel);
    const dialogCalls = [];
    const dialog = {
        showErrorBox() {},
        showMessageBox: async (_window, options) => { dialogCalls.push(options); return { response: dialogAnswer }; },
    };
    const electronPath = createRequire(STUDIO_MAIN).resolve('electron');
    const previous = require.cache[electronPath];
    require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: { app, BrowserWindow: FakeWindow, dialog, ipcMain } };
    delete require.cache[STUDIO_MAIN];
    FakeWindow.created = [];
    // this test process only: no real profile folder and no visible window
    process.env.CURVIOS_USER_DATA_ROOT = appData;
    process.env.CURVIOS_ELECTRON_SHOW_WINDOW = '0';
    try {
        require(STUDIO_MAIN);
    } finally {
        if (previous) require.cache[electronPath] = previous;
        else delete require.cache[electronPath];
    }
    ready();
    await readyPromise;
    for (let i = 0; i < 20 && FakeWindow.created.length === 0; i++) await new Promise((resolve) => setImmediate(resolve));
    const window = FakeWindow.created[0];
    await new Promise((resolve) => setImmediate(resolve));
    const trusted = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
    ipcMain.emit('settings-studio:set-dirty-state', trusted, true);
    return { app, ipcMain, handlers, window, dialogCalls, trusted };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test.after(() => {
    delete require.cache[STUDIO_MAIN];
    for (const root of scratchRoots) rmSync(root, { recursive: true, force: true });
});

test('S2: unsaved changes still ask the Studio UI before the window closes', async () => {
    const { window, ipcMain, trusted } = await loadStudio();
    assert.equal(window.close(), false, 'the close waits for the UI answer');
    assert.deepEqual(window.webContents.sent.at(-1), ['settings-studio:close-request']);
    ipcMain.emit('settings-studio:close-request', trusted, true);
    assert.equal(window.isDestroyed(), true);
});

test('S2: a crashed Studio UI cannot answer, so the window closes anyway', async () => {
    const { window } = await loadStudio();
    assert.equal(window.close(), false);
    window.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    await flush();
    assert.equal(window.isDestroyed(), true, 'the pending close completes once the UI is gone');
});

test('S2: a hung Studio UI is replaced by a native question in the main process', async () => {
    const studio = await loadStudio({ dialogAnswer: 1 });
    studio.window.emit('unresponsive');
    assert.equal(studio.window.close(), false);
    await flush();
    assert.equal(studio.dialogCalls.length, 1, 'the main process asks itself');
    assert.equal(studio.window.isDestroyed(), true, '"Verwerfen und schließen" closes the window');

    const keep = await loadStudio({ dialogAnswer: 0 });
    assert.equal(keep.window.close(), false, 'the close request goes to the UI first');
    keep.window.emit('unresponsive');
    await flush();
    assert.equal(keep.dialogCalls.length, 1, 'a UI that hangs while asked gets the native question too');
    assert.equal(keep.window.isDestroyed(), false, '"Weiterbearbeiten" keeps the window and its changes');
});

test('S2: after "Weiterbearbeiten" in the native question, a recovered UI may still discard and close', async () => {
    const { window, ipcMain, trusted, dialogCalls } = await loadStudio({ dialogAnswer: 0 });
    assert.equal(window.close(), false);
    window.emit('unresponsive');
    await flush();
    assert.equal(dialogCalls.length, 1);
    window.emit('responsive');
    ipcMain.emit('settings-studio:close-request', trusted, true);
    assert.equal(window.isDestroyed(), true, 'the late "Verwerfen und schließen" of the UI still counts');
});

test('S3: a quit cancelled by unsaved changes keeps the Studio able to save', async () => {
    const { app, handlers, window } = await loadStudio();
    app.emit('before-quit', { preventDefault() {} });
    assert.equal(window.close(), false, 'the quit is cancelled by the unsaved changes');
    assert.equal(handlers.has('settings-studio:save'), true, '"Weiterbearbeiten" must still be able to save');
    app.emit('will-quit', { preventDefault() {} });
    await flush();
    assert.equal(handlers.has('settings-studio:save'), false, 'the real quit tears the IPC down');
});

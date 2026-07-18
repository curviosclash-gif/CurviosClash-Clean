import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { registerTuningIpc } = require('../electron/tuning-ipc.cjs');

function createIpcHarness() {
    const handlers = new Map();
    const listeners = new Map();
    const harness = {
        tuningWindow: {
            isDestroyed: () => false,
            webContents: { mainFrame: {} },
        },
        ipcMain: {
            handle(channel, handler) {
                handlers.set(channel, handler);
            },
            removeHandler(channel) {
                handlers.delete(channel);
            },
            on(channel, listener) {
                if (!listeners.has(channel)) {
                    listeners.set(channel, new Set());
                }
                listeners.get(channel).add(listener);
            },
            removeListener(channel, listener) {
                listeners.get(channel)?.delete(listener);
            },
            emit(channel, ...args) {
                const channelListeners = listeners.get(channel);
                if (!channelListeners) return;
                for (const listener of channelListeners) {
                    listener(...args);
                }
            },
        },
        async invoke(channel, payload = undefined) {
            return harness.invokeAs(channel, harness.eventFor(harness.tuningWindow), payload);
        },
        async invokeAs(channel, event, payload = undefined) {
            const handler = handlers.get(channel);
            assert.equal(typeof handler, 'function', `missing IPC handler: ${channel}`);
            return handler(event, payload);
        },
        eventFor(windowRef) {
            return {
                sender: windowRef.webContents,
                senderFrame: windowRef.webContents.mainFrame,
            };
        },
    };
    return harness;
}

test('tuning IPC rejects calls from renderers other than the tuning window', async () => {
    const harness = createIpcHarness();
    const dispose = registerTuningIpc({
        ipcMain: harness.ipcMain,
        dialog: null,
        resolveTuningWindow: () => harness.tuningWindow,
    });

    await assert.rejects(
        harness.invokeAs('tuning:get-capability', { sender: {}, senderFrame: {} }),
        { code: 'ERR_CURVIOS_UNTRUSTED_IPC_SENDER' },
    );
    dispose();
});

test('tuning IPC forwards get-all requests to game window runtime bridge', async () => {
    const harness = createIpcHarness();
    const requests = [];
    const gameWindow = {
        isDestroyed: () => false,
        webContents: {
            mainFrame: {},
            send(channel, payload) {
                requests.push({ channel, payload });
                if (channel !== 'tuning-runtime:request') return;
                harness.ipcMain.emit('tuning-runtime:response', harness.eventFor(gameWindow), {
                    requestId: payload.requestId,
                    ok: true,
                    value: { 'PLAYER.SPEED': 20 },
                });
            },
        },
    };
    const dispose = registerTuningIpc({
        ipcMain: harness.ipcMain,
        dialog: null,
        resolveGameWindow: () => gameWindow,
        resolveTuningWindow: () => harness.tuningWindow,
    });

    const result = await harness.invoke('tuning:get-all');
    assert.equal(result.ok, true);
    assert.deepEqual(result.value, { 'PLAYER.SPEED': 20 });
    assert.equal(requests[0].payload.action, 'tuning:get-all');

    dispose();
});

test('tuning IPC emits update event after successful set-value', async () => {
    const harness = createIpcHarness();
    const updateEvents = [];
    const gameWindow = {
        isDestroyed: () => false,
        webContents: {
            mainFrame: {},
            send(channel, payload) {
                if (channel !== 'tuning-runtime:request') return;
                if (payload.action === 'tuning:set-value') {
                    harness.ipcMain.emit('tuning-runtime:response', harness.eventFor(gameWindow), {
                        requestId: payload.requestId,
                        ok: true,
                        value: {
                            ok: true,
                            path: payload.payload.path,
                            value: payload.payload.value,
                        },
                    });
                    return;
                }
                if (payload.action === 'tuning:get-all') {
                    harness.ipcMain.emit('tuning-runtime:response', harness.eventFor(gameWindow), {
                        requestId: payload.requestId,
                        ok: true,
                        value: {
                            'PLAYER.SPEED': 30,
                        },
                    });
                }
            },
        },
    };
    const tuningWindow = {
        isDestroyed: () => false,
        webContents: {
            mainFrame: {},
            send(channel, payload) {
                updateEvents.push({ channel, payload });
            },
        },
    };
    harness.tuningWindow = tuningWindow;
    const dispose = registerTuningIpc({
        ipcMain: harness.ipcMain,
        dialog: null,
        resolveGameWindow: () => gameWindow,
        resolveTuningWindow: () => harness.tuningWindow,
    });

    const result = await harness.invoke('tuning:set-value', {
        path: 'PLAYER.SPEED',
        value: 30,
    });
    assert.equal(result.ok, true);
    assert.equal(updateEvents.length, 1);
    assert.equal(updateEvents[0].channel, 'tuning:update');
    assert.equal(updateEvents[0].payload.trigger, 'set-value');
    assert.equal(updateEvents[0].payload.snapshot.ok, true);
    assert.deepEqual(updateEvents[0].payload.snapshot.value, { 'PLAYER.SPEED': 30 });

    dispose();
});

test('tuning IPC blocks operations when capability is unavailable', async () => {
    const harness = createIpcHarness();
    const dispose = registerTuningIpc({
        ipcMain: harness.ipcMain,
        dialog: null,
        resolveGameWindow: () => null,
        resolveTuningWindow: () => harness.tuningWindow,
        resolveCapabilityState: () => ({
            available: false,
            reason: 'blocked_for_test',
        }),
    });

    const result = await harness.invoke('tuning:get-all');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'capability_blocked');
    assert.equal(result.capability.available, false);

    dispose();
});

test('tuning IPC exports and imports preset json via dialog channels', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'curvios-tuning-ipc-'));
    const filePath = path.join(tempDir, 'preset.json');
    const harness = createIpcHarness();
    const dialog = {
        async showSaveDialog() {
            return { canceled: false, filePath };
        },
        async showOpenDialog() {
            return { canceled: false, filePaths: [filePath] };
        },
    };
    const dispose = registerTuningIpc({
        ipcMain: harness.ipcMain,
        dialog,
        resolveGameWindow: () => null,
        resolveTuningWindow: () => harness.tuningWindow,
    });

    const exportResult = await harness.invoke('tuning:export-preset-json', {
        fileName: 'example-preset.json',
        presetData: {
            contractVersion: 'tuning-preset-document.v1',
            preset: { id: 'example', name: 'Example', delta: { 'PLAYER.SPEED': 25 } },
        },
    });
    assert.equal(exportResult.ok, true);
    const writtenRaw = readFileSync(filePath, 'utf-8');
    assert.match(writtenRaw, /PLAYER\.SPEED/);

    const importResult = await harness.invoke('tuning:import-preset-json');
    assert.equal(importResult.ok, true);
    assert.equal(importResult.value.presetData.preset.id, 'example');

    dispose();
    rmSync(tempDir, { recursive: true, force: true });
});

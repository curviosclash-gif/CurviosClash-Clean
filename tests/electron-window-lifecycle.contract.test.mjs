import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createMainWindowCloseLifecycle } = require('../electron/main-window-lifecycle.cjs');

function readSource(relativePath) {
    return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

function createFakeTimers() {
    const scheduled = new Map();
    let nextId = 1;
    return {
        scheduled,
        setTimeoutFn(handler, delay) {
            const id = nextId++;
            scheduled.set(id, { handler, delay });
            return id;
        },
        clearTimeoutFn(id) {
            scheduled.delete(id);
        },
        pendingCount() {
            return scheduled.size;
        },
        runAll() {
            const entries = [...scheduled.entries()];
            scheduled.clear();
            for (const [, entry] of entries) entry.handler();
        },
    };
}

function createFakeWindow() {
    const state = {
        closeAttempts: 0,
        destroyed: false,
        destroyCalls: 0,
        onClose: null,
    };
    const window = {
        isDestroyed: () => state.destroyed,
        close() {
            state.closeAttempts += 1;
            const event = {
                defaultPrevented: false,
                preventDefault() {
                    this.defaultPrevented = true;
                },
            };
            if (state.onClose) state.onClose(event);
            if (!event.defaultPrevented) state.destroyed = true;
        },
        destroy() {
            state.destroyCalls += 1;
            state.destroyed = true;
        },
    };
    return { state, window };
}

function createLifecycleHarness(overrides = {}) {
    const timers = createFakeTimers();
    const { state, window } = createFakeWindow();
    const listeners = [];
    const calls = { cancelExport: [], gracefulCloseRequests: 0 };
    const options = {
        getWindow: () => (state.destroyed ? null : window),
        isExportActive: () => false,
        cancelExport: async (payload) => {
            calls.cancelExport.push(payload);
        },
        confirmExportClose: async () => 'stay',
        requestGracefulClose: () => {
            calls.gracefulCloseRequests += 1;
        },
        addReadyListener: (handler) => listeners.push(handler),
        removeReadyListener: (handler) => {
            const index = listeners.indexOf(handler);
            if (index >= 0) listeners.splice(index, 1);
        },
        timeoutMs: 30000,
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn,
        ...overrides,
    };
    const lifecycle = createMainWindowCloseLifecycle(options);
    state.onClose = (event) => lifecycle.handleClose(event);
    return { lifecycle, timers, state, window, listeners, calls };
}

test('the graceful close handshake always arms its timeout, even after an approved export close', async () => {
    let exportActive = true;
    const harness = createLifecycleHarness({
        isExportActive: () => exportActive,
        confirmExportClose: async () => 'wait',
    });

    harness.window.close();
    assert.equal(harness.state.destroyed, false, 'the export dialog must keep the window alive');
    await new Promise((resolve) => setImmediate(resolve));

    // The dialog was confirmed with "wait for the export", so the handshake now runs.
    assert.equal(harness.calls.gracefulCloseRequests, 1);
    assert.equal(harness.timers.pendingCount(), 1, 'an approved export close must still arm the fallback timeout');

    // The renderer never answers: the fallback timeout has to finish the close.
    exportActive = false;
    harness.timers.runAll();
    assert.equal(harness.state.destroyed, true, 'the fallback timeout must close the window');
});

test('repeated close clicks reuse the running handshake instead of stacking listeners', () => {
    const harness = createLifecycleHarness();

    harness.window.close();
    harness.window.close();
    harness.window.close();

    assert.equal(harness.calls.gracefulCloseRequests, 1);
    assert.equal(harness.listeners.length, 1, 'only one graceful-close-ready listener may be registered');
    assert.equal(harness.timers.pendingCount(), 1, 'only one fallback timeout may be pending');

    harness.timers.runAll();
    assert.equal(harness.state.destroyed, true);
    assert.equal(harness.listeners.length, 0, 'the handshake listener must be removed again');
});

test('a graceful-close-ready answer from the trusted renderer closes the window once', () => {
    const harness = createLifecycleHarness();

    harness.window.close();
    assert.equal(harness.listeners.length, 1);
    harness.listeners[0]({ sender: 'main-window' });

    assert.equal(harness.state.destroyed, true);
    assert.equal(harness.timers.pendingCount(), 0, 'the fallback timeout must be cleared');
    assert.equal(harness.listeners.length, 0);
});

test('an untrusted graceful-close-ready sender cannot close the window', () => {
    const harness = createLifecycleHarness({ isTrustedReadySender: () => false });

    harness.window.close();
    harness.listeners[0]({ sender: 'foreign-frame' });

    assert.equal(harness.state.destroyed, false);
    assert.equal(harness.timers.pendingCount(), 1);
});

test('a dead renderer cancels the running export and tears the window down', async () => {
    const harness = createLifecycleHarness({
        isExportActive: () => true,
        confirmExportClose: async () => 'stay',
    });

    await harness.lifecycle.handleRenderProcessGone({ reason: 'crashed' });

    assert.deepEqual(harness.calls.cancelExport, [{ reason: 'render_process_gone' }]);
    assert.equal(harness.state.destroyCalls, 1, 'a crashed renderer must be torn down without a handshake');
    assert.equal(harness.state.destroyed, true);
});

test('a renderer that dies during the handshake still releases the window', async () => {
    const harness = createLifecycleHarness();

    harness.window.close();
    assert.equal(harness.state.destroyed, false);

    await harness.lifecycle.handleRenderProcessGone({ reason: 'killed' });

    assert.equal(harness.state.destroyed, true);
    assert.equal(harness.timers.pendingCount(), 0);
    assert.equal(harness.listeners.length, 0);
});

test('cancelling the export from the close dialog still closes the window', async () => {
    let exportActive = true;
    const harness = createLifecycleHarness({
        isExportActive: () => exportActive,
        confirmExportClose: async () => 'cancel-export',
    });

    harness.window.close();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(harness.calls.cancelExport, [{ reason: 'application_close_confirmed' }]);
    exportActive = false;
    harness.timers.runAll();
    assert.equal(harness.state.destroyed, true);
});

test('choosing "back to the application" keeps the window open and stays reusable', async () => {
    let decision = 'stay';
    const harness = createLifecycleHarness({
        isExportActive: () => true,
        confirmExportClose: async () => decision,
    });

    harness.window.close();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(harness.state.destroyed, false);
    assert.equal(harness.calls.gracefulCloseRequests, 0);

    decision = 'wait';
    harness.window.close();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(harness.calls.gracefulCloseRequests, 1, 'a later close must re-open the decision');
});

test('the Electron main process wires the window lifecycle instead of its own close plumbing', () => {
    const source = readSource('../electron/main.cjs');

    assert.match(source, /main-window-lifecycle\.cjs/, 'main.cjs must use the extracted lifecycle module');
    assert.match(source, /render-process-gone/, 'a dead renderer must be handled');
    assert.doesNotMatch(
        source,
        /exportCloseApproved\s*\n?\s*\?\s*null/,
        'the graceful close timeout must never be skipped',
    );
});

test('the packaged Electron app ships the window lifecycle module', () => {
    const packageJson = JSON.parse(readSource('../electron/package.json'));
    assert.ok(packageJson.build.files.includes('main-window-lifecycle.cjs'));
});

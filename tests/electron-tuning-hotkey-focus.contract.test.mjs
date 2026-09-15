import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFocusScopedShortcut } = require('../electron/focus-scoped-shortcut.cjs');

function readSource(relativePath) {
    return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

function createShortcutHarness(registerResult = true) {
    const appListeners = new Map();
    const calls = { register: [], unregister: [], triggers: 0 };
    let focused = false;
    const shortcut = createFocusScopedShortcut({
        globalShortcut: {
            register(accelerator, handler) {
                calls.register.push(accelerator);
                if (registerResult) calls.handler = handler;
                return registerResult;
            },
            unregister(accelerator) {
                calls.unregister.push(accelerator);
            },
            isRegistered: () => calls.register.length > calls.unregister.length,
        },
        appEvents: {
            on(name, handler) {
                if (!appListeners.has(name)) appListeners.set(name, []);
                appListeners.get(name).push(handler);
            },
            off(name, handler) {
                const list = appListeners.get(name) || [];
                const index = list.indexOf(handler);
                if (index >= 0) list.splice(index, 1);
            },
        },
        accelerator: 'F7',
        onTrigger: () => {
            calls.triggers += 1;
        },
        isAnyWindowFocused: () => focused,
        logger: { warn() {} },
    });
    return {
        shortcut,
        calls,
        emit(name) {
            for (const handler of appListeners.get(name) || []) handler();
        },
        listenerCount(name) {
            return (appListeners.get(name) || []).length;
        },
        setFocused(value) {
            focused = value;
        },
    };
}

test('the tuning hotkey is only registered while an application window has focus', () => {
    const harness = createShortcutHarness();

    harness.shortcut.start();
    assert.equal(harness.shortcut.isRegistered(), false, 'an unfocused app must not hold the system-wide hotkey');
    assert.equal(harness.calls.register.length, 0);

    harness.emit('browser-window-focus');
    assert.equal(harness.shortcut.isRegistered(), true);
    assert.deepEqual(harness.calls.register, ['F7']);

    harness.emit('browser-window-blur');
    assert.equal(harness.shortcut.isRegistered(), false, 'blurring the app must release the hotkey for other programs');
    assert.ok(harness.calls.unregister.includes('F7'));
});

test('the focus-scoped hotkey registers immediately when the app is already focused', () => {
    const harness = createShortcutHarness();
    harness.setFocused(true);

    harness.shortcut.start();
    assert.equal(harness.shortcut.isRegistered(), true);

    harness.shortcut.stop();
    assert.equal(harness.shortcut.isRegistered(), false);
    assert.equal(harness.listenerCount('browser-window-focus'), 0, 'stop must drop the focus listeners');
    assert.equal(harness.listenerCount('browser-window-blur'), 0);
});

test('repeated focus events do not re-register the hotkey', () => {
    const harness = createShortcutHarness();
    harness.shortcut.start();

    harness.emit('browser-window-focus');
    harness.emit('browser-window-focus');
    harness.emit('browser-window-focus');

    assert.equal(harness.calls.register.length, 1);
});

test('a hotkey the operating system refuses is reported as unregistered', () => {
    const harness = createShortcutHarness(false);
    harness.shortcut.start();

    harness.emit('browser-window-focus');
    assert.equal(harness.shortcut.isRegistered(), false);

    harness.emit('browser-window-blur');
    assert.equal(harness.calls.register.length, 1);
});

test('the Electron main process scopes the tuning hotkey to application focus', () => {
    const source = readSource('../electron/main.cjs');

    assert.match(source, /focus-scoped-shortcut\.cjs/, 'main.cjs must use the extracted shortcut module');
    assert.match(source, /createFocusScopedShortcut\s*\(/);
    assert.doesNotMatch(
        source,
        /globalShortcut\.register\s*\(/,
        'main.cjs must not hold a system-wide accelerator outside the focus scope',
    );

    const shortcutSource = readSource('../electron/focus-scoped-shortcut.cjs');
    assert.match(shortcutSource, /browser-window-focus/);
    assert.match(shortcutSource, /browser-window-blur/);
});

test('the packaged Electron app ships the focus-scoped shortcut module', () => {
    const packageJson = JSON.parse(readSource('../electron/package.json'));
    assert.ok(packageJson.build.files.includes('focus-scoped-shortcut.cjs'));
});

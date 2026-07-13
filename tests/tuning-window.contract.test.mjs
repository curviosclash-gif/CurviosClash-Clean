import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTuningWindowController } = require('../electron/tuning-window.cjs');

class FakeBrowserWindow {
    constructor(options) {
        this.options = options;
        this._destroyed = false;
        this._minimized = false;
        this._events = new Map();
        this.loadedFile = null;
        this.loadedUrl = null;
        this.focused = false;
    }

    isDestroyed() {
        return this._destroyed;
    }

    isMinimized() {
        return this._minimized;
    }

    restore() {
        this._minimized = false;
    }

    focus() {
        this.focused = true;
    }

    close() {
        this._destroyed = true;
        this._events.get('closed')?.forEach((handler) => handler());
    }

    on(eventName, handler) {
        if (!this._events.has(eventName)) {
            this._events.set(eventName, []);
        }
        this._events.get(eventName).push(handler);
    }

    async loadFile(filePath) {
        this.loadedFile = filePath;
    }

    async loadURL(url) {
        this.loadedUrl = url;
    }

    setAlwaysOnTop(enabled) {
        this.options.alwaysOnTop = enabled === true;
    }
}

test('tuning window controller creates 420x800 window and toggles close/open', async () => {
    const controller = createTuningWindowController({
        BrowserWindow: FakeBrowserWindow,
        resolveCapabilityState: () => ({ available: true }),
        htmlPath: '__missing__.html',
    });

    const firstOpen = await controller.createTuningWindow();
    assert.equal(firstOpen.ok, true);
    assert.equal(firstOpen.window.options.width, 420);
    assert.equal(firstOpen.window.options.height, 800);
    assert.equal(firstOpen.window.options.webPreferences.contextIsolation, true);
    assert.match(String(firstOpen.window.loadedUrl || ''), /^data:text\/html/);

    const toggleClosed = await controller.toggleTuningWindow();
    assert.equal(toggleClosed.ok, true);
    assert.equal(toggleClosed.action, 'closed');

    const toggleOpen = await controller.toggleTuningWindow();
    assert.equal(toggleOpen.ok, true);
    assert.equal(toggleOpen.action, 'opened');
});

test('tuning window controller reports blocked capability state', async () => {
    const controller = createTuningWindowController({
        BrowserWindow: FakeBrowserWindow,
        resolveCapabilityState: () => ({
            available: false,
            reason: 'blocked_for_test',
        }),
    });

    const openResult = await controller.createTuningWindow();
    assert.equal(openResult.ok, false);
    assert.equal(openResult.reason, 'capability_blocked');
    assert.equal(openResult.window, null);
});

test('main process keeps F7 hotkey wired to tuning window toggle', () => {
    const mainSource = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf-8');
    assert.match(mainSource, /const TUNING_CONSOLE_HOTKEY = 'F7';/);
    assert.match(mainSource, /globalShortcut\.register\(TUNING_CONSOLE_HOTKEY,\s*\(\)\s*=>\s*\{/);
    assert.match(mainSource, /toggleTuningWindow\(\{ focus: true \}\)/);
});

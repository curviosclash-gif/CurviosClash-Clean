import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createHangarWindowController } = require('../electron/hangar-window.cjs');

class FakeBrowserWindow {
    constructor(options) { this.options = options; this.events = new Map(); this.destroyed = false; this.focused = false; }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    on(name, handler) { this.events.set(name, handler); }
    once(name, handler) { this.events.set(name, handler); }
    async loadURL(url) { this.url = url; this.events.get('ready-to-show')?.(); }
    maximize() { this.maximized = true; }
    show() { this.shown = true; }
    focus() { this.focused = true; }
    close() {
        let prevented = false;
        this.events.get('close')?.({ preventDefault() { prevented = true; } });
        if (prevented) return;
        this.destroyed = true;
        this.events.get('closed')?.();
    }
}

test('desktop hangar opens once in a maximized secure window', async () => {
    const controller = createHangarWindowController({
        BrowserWindow: FakeBrowserWindow,
        resolveWindowUrl: () => 'http://127.0.0.1/hangar.html?mode=arcade',
    });
    const opened = await controller.openHangarWindow({ focus: true });
    assert.equal(opened.ok, true);
    assert.equal(opened.window.maximized, true);
    assert.equal(opened.window.shown, true);
    assert.equal(opened.window.options.minWidth, 1100);
    assert.equal(opened.window.options.webPreferences.contextIsolation, true);
    assert.equal(opened.window.options.webPreferences.nodeIntegration, false);
    assert.equal(opened.window.options.webPreferences.sandbox, true);
    assert.match(opened.window.url, /hangar\.html/);
    assert.equal((await controller.openHangarWindow()).reused, true);
    assert.equal(controller.closeHangarWindow(), true);
});

test('desktop hangar explains that closing keeps the automatically saved draft', async () => {
    const responses = [1, 0];
    const dialogs = [];
    const controller = createHangarWindowController({
        BrowserWindow: FakeBrowserWindow,
        dialog: {
            showMessageBoxSync(_window, options) {
                dialogs.push(options);
                return responses.shift();
            },
        },
        resolveWindowUrl: () => 'http://127.0.0.1/hangar.html?mode=arcade',
    });
    await controller.openHangarWindow();
    assert.equal(controller.setUnsavedChanges(true), true);
    assert.equal(controller.closeHangarWindow(), false);
    assert.ok(controller.getWindow());
    assert.equal(dialogs[0].buttons[0], 'Schließen · Entwurf behalten');
    assert.match(dialogs[0].detail, /automatische Sicherung bleibt erhalten/);
    assert.equal(controller.closeHangarWindow(), true);
    assert.equal(controller.getWindow(), null);
});

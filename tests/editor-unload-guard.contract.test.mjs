import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { installEditorUnloadGuard } = require('../electron/editor-unload-guard.cjs');

function createFakeWindow() {
    const listeners = new Map();
    return {
        destroyed: false,
        isDestroyed() { return this.destroyed; },
        webContents: {
            on(name, handler) { listeners.set(name, handler); },
        },
        // Spielt nach, was Electron tut: preventDefault() heisst hier
        // "Sperre uebergehen und die Seite verlassen".
        triggerPreventUnload() {
            let leave = false;
            listeners.get('will-prevent-unload')?.({ preventDefault() { leave = true; } });
            return leave;
        },
    };
}

test('editor unload guard asks before discarding unsaved changes', () => {
    const window = createFakeWindow();
    const dialogs = [];
    const responses = [1, 0];
    installEditorUnloadGuard(window, {
        dialog: {
            showMessageBoxSync(parent, options) {
                assert.equal(parent, window);
                dialogs.push(options);
                return responses.shift();
            },
        },
    });

    assert.equal(window.triggerPreventUnload(), false, 'Abbrechen keeps the window open');
    assert.equal(window.triggerPreventUnload(), true, 'Verlassen lets the unload proceed');
    assert.equal(dialogs.length, 2);
    assert.equal(dialogs[0].cancelId, 1);
    assert.equal(dialogs[0].defaultId, 1);
    assert.match(dialogs[0].buttons[0], /Verlassen/);
});

test('editor unload guard keeps the window open when the dialog fails', () => {
    const window = createFakeWindow();
    installEditorUnloadGuard(window, {
        dialog: { showMessageBoxSync() { throw new Error('no display'); } },
    });
    assert.equal(window.triggerPreventUnload(), false);
});

test('editor unload guard ignores a destroyed window', () => {
    const window = createFakeWindow();
    let asked = false;
    installEditorUnloadGuard(window, {
        dialog: { showMessageBoxSync() { asked = true; return 0; } },
    });
    window.destroyed = true;
    assert.equal(window.triggerPreventUnload(), false);
    assert.equal(asked, false);
});

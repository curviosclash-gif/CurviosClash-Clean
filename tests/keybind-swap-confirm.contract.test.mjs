import assert from 'node:assert/strict';
import test from 'node:test';

import { KeybindEditorController, createKeybindEditorRuntimeAccess } from '../src/ui/KeybindEditorController.js';

function classList(initial = []) {
    const classes = new Set(initial);
    return {
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
        contains(name) { return classes.has(name); },
    };
}

function createEditor(state = 'MENU', warningOverride = null) {
    const controls = { PLAYER_1: { UP: 'KeyW' }, PLAYER_2: { DOWN: 'ArrowDown' }, GLOBAL: {} };
    const warning = warningOverride || { classList: classList(['hidden']), textContent: '' };
    const calls = { changed: 0, applied: 0 };
    const runtime = {
        state, keyCapture: { playerKey: 'PLAYER_2', actionKey: 'DOWN' },
        settings: { controls },
        ui: { mainMenu: { classList: classList() }, keybindWarning: warning },
        input: { setBindings() { calls.applied += 1; } },
        _onSettingsChanged() { calls.changed += 1; },
        _showStatusToast() {},
    };
    const controller = new KeybindEditorController(createKeybindEditorRuntimeAccess(runtime));
    const press = (code) => controller.handleKeyCapture({ code, preventDefault() {}, stopPropagation() {} });
    return { controller, runtime, controls, warning, calls, press };
}

test('the inline prompt exposes clickable confirm and cancel actions', () => {
    const makeNode = () => ({
        children: [], handlers: {}, textContent: '',
        append(...nodes) { this.children.push(...nodes); },
        appendChild(node) { this.children.push(node); },
        addEventListener(type, handler) { this.handlers[type] = handler; },
        focus() {},
        click() { this.handlers.click?.(); },
    });
    const warning = {
        ...makeNode(), classList: classList(['hidden']),
        ownerDocument: { createElement: makeNode },
    };
    const { controls, press } = createEditor('MENU', warning);
    press('KeyW');
    const [confirm, cancel] = warning.children[0].children;
    assert.equal(confirm.textContent, 'Tauschen');
    assert.equal(cancel.textContent, 'Abbrechen');
    confirm.click();
    assert.equal(controls.PLAYER_1.UP, 'ArrowDown');
    assert.equal(controls.PLAYER_2.DOWN, 'KeyW');
});

test('a conflicting key asks before changing either action, then confirmation swaps them', () => {
    const { controller, controls, warning, calls, press } = createEditor('PAUSED');
    assert.equal(press('KeyW'), true);
    assert.equal(controls.PLAYER_1.UP, 'KeyW');
    assert.equal(controls.PLAYER_2.DOWN, 'ArrowDown');
    assert.equal(calls.changed, 0);
    assert.match(warning.textContent, /Taste W ist mit .*Nase senken.* belegt\. Tauschen\?/);

    assert.equal(controller.confirmPendingSwap(), true);
    assert.equal(controls.PLAYER_1.UP, 'ArrowDown');
    assert.equal(controls.PLAYER_2.DOWN, 'KeyW');
    assert.equal(calls.changed, 1);
    assert.equal(calls.applied, 1);
});

test('Escape and explicit cancellation leave both bindings unchanged', () => {
    for (const cancelWithEscape of [true, false]) {
        const { controller, controls, calls, press } = createEditor();
        press('KeyW');
        if (cancelWithEscape) assert.equal(press('Escape'), true);
        else assert.equal(controller.cancelPendingSwap(), true);
        assert.equal(controls.PLAYER_1.UP, 'KeyW');
        assert.equal(controls.PLAYER_2.DOWN, 'ArrowDown');
        assert.equal(calls.changed, 0);
        assert.equal(controller.confirmPendingSwap(), false);
    }
});

test('a stale confirmation cannot overwrite controls changed after the prompt', () => {
    const { controller, controls, calls, press } = createEditor();
    press('KeyW');
    controls.PLAYER_1.UP = 'KeyT';
    assert.equal(controller.confirmPendingSwap(), false);
    assert.equal(controls.PLAYER_1.UP, 'KeyT');
    assert.equal(controls.PLAYER_2.DOWN, 'ArrowDown');
    assert.equal(calls.changed, 0);
});

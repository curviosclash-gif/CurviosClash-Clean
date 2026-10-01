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

class FocusTestElement {
    constructor(ownerDocument, tagName = 'div') {
        this.ownerDocument = ownerDocument;
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.dataset = {};
        this.handlers = {};
        this.attributes = {};
        this.parentNode = null;
        this._classNames = new Set();
        this.classList = {
            add: (name) => this._classNames.add(name),
            remove: (name) => this._classNames.delete(name),
            contains: (name) => this._classNames.has(name),
        };
        this.style = {};
        this._textContent = '';
    }

    set className(value) { this._classNames = new Set(String(value).split(/\s+/u).filter(Boolean)); }
    get className() { return Array.from(this._classNames).join(' '); }
    set textContent(value) {
        this._textContent = String(value);
        this.children = [];
        if (this.ownerDocument.activeElement && this.contains(this.ownerDocument.activeElement)) {
            this.ownerDocument.activeElement = this.ownerDocument.body;
        }
    }
    get textContent() { return this._textContent; }
    append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
    appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
    replaceChildren(...nodes) {
        if (this.ownerDocument.activeElement && nodes.length === 0 && this.contains(this.ownerDocument.activeElement)) {
            this.ownerDocument.activeElement = this.ownerDocument.body;
        }
        this.children = [];
        nodes.forEach((node) => this.appendChild(node));
    }
    contains(node) { return this === node || this.children.some((child) => child.contains?.(node)); }
    querySelectorAll(selector) {
        const className = selector.slice(1);
        return this.children.flatMap((child) => [
            ...(child.classList?.contains(className) ? [child] : []),
            ...(child.querySelectorAll?.(selector) || []),
        ]);
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    addEventListener(type, handler) { this.handlers[type] = handler; }
    focus() { this.ownerDocument.activeElement = this; }
    click() { this.handlers.click?.(); }
}

function withFocusDocument(callback) {
    const previousDocument = globalThis.document;
    const doc = {
        activeElement: null,
        createElement(tagName) { return new FocusTestElement(this, tagName); },
    };
    doc.body = new FocusTestElement(doc, 'body');
    globalThis.document = doc;
    try {
        return callback(doc);
    } finally {
        if (typeof previousDocument === 'undefined') delete globalThis.document;
        else globalThis.document = previousDocument;
    }
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

test('capture and swap rebuilds restore focus to the same player/action without stealing outside focus', () => {
    withFocusDocument((doc) => {
        const p1 = new FocusTestElement(doc);
        const p2 = new FocusTestElement(doc);
        const p3 = new FocusTestElement(doc);
        const warning = new FocusTestElement(doc);
        warning.classList.add('hidden');
        const controls = {
            PLAYER_1: { UP: 'KeyW', DOWN: 'KeyS' },
            PLAYER_2: { UP: 'ArrowUp', DOWN: 'ArrowDown' },
            PLAYER_3: { UP: 'KeyI', DOWN: 'KeyK' },
            GLOBAL: {},
        };
        const runtime = {
            state: 'PAUSED',
            keyCapture: null,
            settings: { controls },
            ui: {
                mainMenu: { classList: classList() },
                keybindP1: p1, keybindP2: p2, keybindP3: p3, keybindWarning: warning,
            },
            _onSettingsChanged() {},
            _showStatusToast() {},
        };
        const controller = new KeybindEditorController(createKeybindEditorRuntimeAccess(runtime));
        controller.renderEditor();
        const actionButton = (container, action) => container.querySelectorAll('.keybind-btn')
            .find((button) => button.dataset.action === action);

        const p2Down = actionButton(p2, 'DOWN');
        p2Down.focus();
        controller.startKeyCapture('PLAYER_2', 'DOWN');
        assert.equal(doc.activeElement, actionButton(p2, 'DOWN'), 'capture rebuild returns to player 2 DOWN');
        assert.equal(actionButton(p2, 'DOWN').getAttribute('aria-label'), 'Nase heben: Taste');
        controller.handleKeyCapture({ code: 'Escape', preventDefault() {}, stopPropagation() {} });
        assert.equal(doc.activeElement, actionButton(p2, 'DOWN'), 'Escape rebuild returns to the captured action');

        const p3Down = actionButton(p3, 'DOWN');
        p3Down.focus();
        controller.startKeyCapture('PLAYER_3', 'DOWN');
        assert.equal(doc.activeElement, actionButton(p3, 'DOWN'), 'same action key remains scoped to player 3');
        controller.handleKeyCapture({ code: 'Escape', preventDefault() {}, stopPropagation() {} });

        actionButton(p2, 'DOWN').focus();
        controller.startKeyCapture('PLAYER_2', 'DOWN');
        controller.handleKeyCapture({ code: 'KeyW', preventDefault() {}, stopPropagation() {} });
        assert.equal(doc.activeElement.classList.contains('keybind-swap-confirm'), true);
        warning.querySelectorAll('.keybind-swap-cancel')[0].click();
        assert.equal(doc.activeElement, actionButton(p2, 'DOWN'), 'swap cancellation returns to its initiating action');

        actionButton(p2, 'DOWN').focus();
        controller.startKeyCapture('PLAYER_2', 'DOWN');
        controller.handleKeyCapture({ code: 'KeyW', preventDefault() {}, stopPropagation() {} });
        warning.querySelectorAll('.keybind-swap-confirm')[0].click();
        assert.equal(doc.activeElement, actionButton(p2, 'DOWN'), 'swap confirmation returns to its initiating action');
        assert.equal(controls.PLAYER_2.DOWN, 'KeyW');

        const outsideButton = new FocusTestElement(doc, 'button');
        outsideButton.focus();
        controller.renderEditor();
        assert.equal(doc.activeElement, outsideButton, 'rerender does not steal focus from outside the editor');
    });
});

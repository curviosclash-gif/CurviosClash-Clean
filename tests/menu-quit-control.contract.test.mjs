import assert from 'node:assert/strict';
import test from 'node:test';

import { bindMenuQuitControl } from '../src/ui/menu/MenuQuitBindings.js';

function fakeButton() {
    const attrs = new Map();
    const listeners = new Map();
    const button = {
        textContent: 'Beenden',
        hidden: true,
        disabled: false,
        setAttribute: (name, value) => attrs.set(name, String(value)),
        getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
        removeAttribute: (name) => attrs.delete(name),
        addEventListener: (type, handler) => listeners.set(type, handler),
        removeEventListener: (type) => listeners.delete(type),
        click: () => listeners.get('click')?.(),
    };
    attrs.set('data-menu-visibility-key', 'quitButton');
    button.parentElement = { querySelectorAll: () => [button] };
    return button;
}

function bind(productSurfaceId) {
    const button = fakeButton();
    const closes = [];
    const disposers = [];
    bindMenuQuitControl({
        ui: { quitGameButton: button },
        featureFlags: { surfacePolicy: { productSurfaceId } },
        registerDisposer: (dispose) => disposers.push(dispose),
        closeWindow: () => closes.push('closed'),
    });
    return { button, closes, disposers };
}

test('quitting needs two clicks on the desktop app and closes the window on the second', () => {
    const { button, closes, disposers } = bind('desktop-app');
    assert.equal(button.hidden, false);
    button.click();
    assert.deepEqual(closes, []);
    assert.equal(button.textContent, 'Wirklich beenden? Erneut klicken');
    button.click();
    assert.deepEqual(closes, ['closed']);
    assert.equal(button.textContent, 'Beenden');
    disposers.forEach((dispose) => dispose());
});

test('browser and mobile builds have no quit button', () => {
    for (const surface of ['browser-demo', 'mobile-classic', '']) {
        const { button, closes } = bind(surface);
        assert.equal(button.hidden, true, `${surface || 'unknown'} hides the quit button`);
        button.click();
        assert.deepEqual(closes, []);
    }
});

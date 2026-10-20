import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveEffectiveHudScale } from '../src/shared/contracts/HudAppearanceContract.js';
import { applyRuntimeHudAppearance, formatHudAppearanceHint } from '../src/ui/HudAppearance.js';

// Measured in Electron (paused fight match, innermost HUD blocks): overlap-free up to
// 1.3 at 1920x1080, only 1.0 at 1280x720 and 1264x655.
test('the HUD grows only as far as the window leaves room', () => {
    assert.equal(resolveEffectiveHudScale(1.4, { width: 1920, height: 1080 }), 1.3);
    assert.equal(resolveEffectiveHudScale(1.2, { width: 1920, height: 1080 }), 1.2);
    assert.equal(resolveEffectiveHudScale(1.4, { width: 1280, height: 720 }), 1);
    assert.equal(resolveEffectiveHudScale(1.4, { width: 1264, height: 655 }), 1);
    assert.equal(resolveEffectiveHudScale(1.4, { width: 2560, height: 1440 }), 1.4);
});

test('a smaller HUD and an unknown window stay as chosen', () => {
    assert.equal(resolveEffectiveHudScale(0.8, { width: 1264, height: 655 }), 0.8);
    assert.equal(resolveEffectiveHudScale(1.4, null), 1.4);
});

function createElement(ownerDocument) {
    const values = new Map();
    return {
        ownerDocument,
        style: {
            getPropertyValue: (name) => values.get(name) || '',
            setProperty: (name, value) => values.set(name, value),
        },
        read: (name) => values.get(name),
    };
}

test('the HUD hint says when the window is too small for the chosen size', () => {
    const small = { innerWidth: 1280, innerHeight: 720 };
    const large = { innerWidth: 1920, innerHeight: 1080 };
    assert.match(formatHudAppearanceHint({ scale: 1.4 }, small), /zu groß, angezeigt 100%/);
    assert.doesNotMatch(formatHudAppearanceHint({ scale: 1.2 }, large), /zu groß/);
});

test('the runtime HUD writes the fitted scale onto the page', () => {
    const view = { innerWidth: 1280, innerHeight: 720, addEventListener() {} };
    const documentStub = { defaultView: view };
    documentStub.documentElement = createElement(documentStub);
    const hud = createElement(documentStub);
    applyRuntimeHudAppearance(hud, { scale: 1.4, opacity: 1, colorPreset: 'green' });
    assert.equal(hud.read('--hud-scale'), '1');
    assert.equal(documentStub.documentElement.read('--hud-scale'), '1');
});

test('same-window updates reuse one resize listener and a window switch detaches the old owner', () => {
    const makeView = (innerWidth, innerHeight) => {
        const listeners = new Set();
        return {
            innerWidth,
            innerHeight,
            listeners,
            addEventListener(type, listener) { if (type === 'resize') listeners.add(listener); },
            removeEventListener(type, listener) { if (type === 'resize') listeners.delete(listener); },
            dispatchResize() { for (const listener of [...listeners]) listener(); },
        };
    };
    const makeDocument = (view) => {
        const document = { defaultView: view };
        document.documentElement = createElement(document);
        return document;
    };
    const oldView = makeView(1280, 720);
    const oldDocument = makeDocument(oldView);
    const oldHud = createElement(oldDocument);
    const newView = makeView(1920, 1080);
    const newDocument = makeDocument(newView);
    const newHud = createElement(newDocument);

    try {
        applyRuntimeHudAppearance(oldHud, { scale: 1.4, opacity: 1, colorPreset: 'green' });
        const oldHandler = [...oldView.listeners][0];
        assert.equal(oldView.listeners.size, 1);

        applyRuntimeHudAppearance(oldHud, { scale: 1.2, opacity: 0.8, colorPreset: 'amber' });
        assert.equal(oldView.listeners.size, 1, 'same-window settings update does not register another listener');
        oldView.innerWidth = 1920;
        oldView.innerHeight = 1080;
        oldView.dispatchResize();
        assert.equal(oldHud.read('--hud-scale'), '1.2', 'resize uses the latest appearance');
        assert.equal(oldDocument.documentElement.read('--hud-color'), '#ffd28d');

        applyRuntimeHudAppearance(newHud, { scale: 1.4, opacity: 0.7, colorPreset: 'cyan' });
        assert.equal(oldView.listeners.size, 0, 'switching windows unregisters the old view');
        assert.equal(newView.listeners.size, 1);
        const oldHudBeforeStaleDispatch = oldHud.read('--hud-scale');
        const newHudBeforeStaleDispatch = newHud.read('--hud-scale');
        oldView.innerWidth = 1280;
        oldView.dispatchResize();
        assert.equal(oldHud.read('--hud-scale'), oldHudBeforeStaleDispatch, 'old view resize has no owner');
        oldHandler();
        assert.equal(oldHud.read('--hud-scale'), oldHudBeforeStaleDispatch, 'queued old callback no longer writes to old view');
        assert.equal(newHud.read('--hud-scale'), newHudBeforeStaleDispatch, 'queued old callback cannot act as the new owner');

        newView.innerWidth = 1280;
        newView.dispatchResize();
        assert.equal(newHud.read('--hud-scale'), '1');
        assert.equal(newDocument.documentElement.read('--hud-color'), '#8ddcff');
    } finally {
        const detachedDocument = { defaultView: null, documentElement: null };
        applyRuntimeHudAppearance(createElement(detachedDocument), { scale: 1, opacity: 1 });
    }
});

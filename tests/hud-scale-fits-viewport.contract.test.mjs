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

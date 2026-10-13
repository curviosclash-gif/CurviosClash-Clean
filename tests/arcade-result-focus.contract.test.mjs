// The normal Arcade post-run screen left the focus wherever it was, unlike the victory and the
// special run result panels. It now puts the focus on the board's main action, the continue button
// of the result prompt (a press on it still counts as "any key continues"), and falls back to the
// panel heading while that button is locked. "Fünf Portale" said "Schließen" and only hid the
// panel, leaving an empty screen; like the other run results it now says "Zum Menü" and goes there.
import assert from 'node:assert/strict';
import test from 'node:test';

const { MatchFlowArcadeOverlayController } = await import('../src/ui/MatchFlowArcadeOverlayController.js');

function element(tagName = 'div', doc = null) {
    const classes = new Set();
    return {
        tagName, id: '', textContent: '', className: '', attributes: {}, children: [], style: {}, listeners: {},
        disabled: false, tabIndex: 0,
        classList: { add: (n) => classes.add(n), remove: (n) => classes.delete(n), contains: (n) => classes.has(n), toggle() {} },
        appendChild(child) { this.children.push(child); return child; },
        append(...nodes) { this.children.push(...nodes); },
        replaceChildren() { this.children.length = 0; },
        removeChild(child) { this.children = this.children.filter((node) => node !== child); return child; },
        get firstChild() { return this.children[0] || null; },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return this.attributes[name] ?? null; },
        addEventListener(type, handler) { this.listeners[type] = handler; },
        focus() { if (!this.disabled && doc) doc.activeElement = this; },
        querySelector() { return null; },
    };
}

function walk(node, visit) {
    for (const child of node.children || []) { visit(child); walk(child, visit); }
}

function withDocument(run) {
    const saved = { document: globalThis.document, requestAnimationFrame: globalThis.requestAnimationFrame };
    const doc = { activeElement: null };
    doc.createElement = (tag) => element(tag, doc);
    globalThis.document = doc;
    globalThis.requestAnimationFrame = () => 0;
    try {
        return run(doc);
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete globalThis[key];
            else globalThis[key] = value;
        }
    }
}

function makeController(doc, { continueDisabled = false } = {}) {
    const continueButton = element('button', doc);
    continueButton.disabled = continueDisabled;
    const messageActions = element('div', doc);
    messageActions.querySelector = (selector) => (selector.includes('data-postmatch-action="continue"') ? continueButton : null);
    const calls = [];
    const controller = new MatchFlowArcadeOverlayController({
        runtime: { ui: { messageOverlay: element('div', doc), messageActions } },
        runtimePort: { returnToMenu: (options) => calls.push(options) },
    });
    return { controller, continueButton, calls };
}

const postRun = { postRunSummary: { score: 900, xpEarned: 40 }, replay: { payloadAvailable: false } };

test('the arcade post-run screen focuses the continue button of the result board', () => {
    withDocument((doc) => {
        const { controller, continueButton } = makeController(doc);
        controller._renderArcadePostRunPanel(postRun);
        assert.equal(doc.activeElement, continueButton);
    });
});

test('while the continue button is locked the panel heading takes the focus', () => {
    withDocument((doc) => {
        const { controller } = makeController(doc, { continueDisabled: true });
        controller._renderArcadePostRunPanel(postRun);
        assert.equal(doc.activeElement?.tagName, 'h3');
        assert.equal(doc.activeElement?.tabIndex, -1, 'the heading is focusable by script only');
    });
});

test('the five portals result says "Zum Menü" and returns to the menu like the other runs', () => {
    withDocument((doc) => {
        const { controller, calls } = makeController(doc);
        controller._renderFivePortalsPostRunPanel({
            runType: 'five_portals',
            postRunSummary: { maps: [{ mapKey: 'standard', timeMs: 9000 }], totalMs: 9000 },
        });
        const buttons = [];
        walk(controller._arcadeOverlayPanel, (node) => { if (node.tagName === 'button') buttons.push(node); });
        assert.deepEqual(buttons.map((button) => button.textContent), ['Zum Menü']);
        buttons[0].listeners.click();
        assert.equal(calls.length, 1, 'the button leads to the menu instead of an empty screen');
        assert.equal(doc.activeElement, buttons[0]);
    });
});

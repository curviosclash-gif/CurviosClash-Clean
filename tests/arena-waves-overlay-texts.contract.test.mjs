// Five Fronts screens in the 17.09.2026 playtest: after a death the board said "Bot 2 gewinnt die
// Runde / Nächste Runde in 3…" (and never counted), the upgrade buttons read "mg tuning", "speed",
// "MG: bastion h3", and "Schließen" on the final list left the player on an empty screen.

import assert from 'node:assert/strict';
import test from 'node:test';

import { MatchFlowArcadeOverlayController } from '../src/ui/MatchFlowArcadeOverlayController.js';

function stubElement(tagName = 'div') {
    const classes = new Set();
    const listeners = {};
    return {
        tagName, id: '', className: '', textContent: '', children: [], style: {}, attributes: {},
        appendChild(child) { this.children.push(child); return child; },
        append(...nodes) { this.children.push(...nodes); },
        replaceChildren() { this.children.length = 0; },
        removeChild(child) { this.children = this.children.filter((node) => node !== child); return child; },
        get firstChild() { return this.children[0] || null; },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return this.attributes[name] ?? null; },
        addEventListener(type, handler) { listeners[type] = handler; },
        click() { listeners.click?.(); },
        focus() {},
        querySelector(selector) { return selector === 'button' ? findButtons(this)[0] || null : null; },
        classList: {
            add: (...names) => names.forEach((name) => classes.add(name)),
            remove: (...names) => names.forEach((name) => classes.delete(name)),
            toggle: (name, force) => (force ? classes.add(name) : classes.delete(name)),
            contains: (name) => classes.has(name),
        },
    };
}

function findButtons(node, found = []) {
    for (const child of node.children || []) {
        if (child.tagName === 'button') found.push(child);
        findButtons(child, found);
    }
    return found;
}

function setup(surfaceState) {
    const previousDocument = globalThis.document;
    globalThis.document = { createElement: (tagName) => stubElement(tagName) };
    const ui = { messageOverlay: stubElement(), messageText: stubElement(), messageSub: stubElement() };
    ui.messageText.textContent = 'Bot 2 gewinnt die Runde';
    ui.messageSub.textContent = 'Nächste Runde in 3...';
    const calls = [];
    const controller = new MatchFlowArcadeOverlayController({
        runtime: { state: 'ROUND_END', roundPause: 3, ui },
        runtimePort: {
            getMatchRuntimeProjection: () => ({ arcade: { enabled: true } }),
            getArcadeMenuSurfaceState: () => surfaceState,
            returnToMenu: (options) => calls.push(options),
        },
    });
    controller.syncArcadeOverlayPanel();
    return { controller, ui, calls, restore: () => { globalThis.document = previousDocument; } };
}

test('the upgrade choice after a death names the next map instead of a round winner', () => {
    const { ui, controller, restore } = setup({
        runType: 'arena_waves', phase: 'upgrade', mapIndex: 1, mapCount: 5,
        choices: ['mg_tuning', 'speed', 'machine_gun:bastion_h3', 'supply:health'],
    });
    try {
        assert.equal(ui.messageText.textContent, 'Abgeschossen');
        assert.equal(ui.messageSub.textContent, 'Wähle einen Vorteil für Karte 2/5.');
        const labels = findButtons(controller._arcadeOverlayPanel).map((button) => button.textContent);
        assert.equal(labels.length, 4);
        for (const label of labels) {
            assert.doesNotMatch(label, /mg tuning|^speed$|bastion h3|_/, `readable label, got "${label}"`);
        }
        assert.ok(labels.some((label) => /Bastion H3/.test(label)), labels.join(' / '));
    } finally {
        restore();
    }
});

test('the final Five Fronts list leads back to the menu', () => {
    const { ui, controller, calls, restore } = setup({
        runType: 'arena_waves', phase: 'finished',
        postRunSummary: { total: 420, maps: [{ mapKey: 'notre_dame_arena', score: 420 }] },
    });
    try {
        assert.equal(ui.messageText.textContent, 'Fünf Fronten beendet');
        assert.equal(ui.messageSub.textContent, '');
        const [close] = findButtons(controller._arcadeOverlayPanel);
        close.click();
        assert.equal(calls.length, 1, 'the button returns to the menu instead of leaving an empty screen');
    } finally {
        restore();
    }
});

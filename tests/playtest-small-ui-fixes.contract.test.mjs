// Two small findings of the playtest on 02.10.2026.

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDefaultMultiplayerPlayerName } from '../src/shared/contracts/MultiplayerSessionContract.js';
import { MatchFlowArcadeOverlayController } from '../src/ui/MatchFlowArcadeOverlayController.js';

test('an untouched default profile name takes the seat number instead of getting it appended', () => {
    // Two app windows both named "Spieler 1" showed up as "Spieler 1 1" and "Spieler 1 2".
    assert.equal(resolveDefaultMultiplayerPlayerName('Spieler 1', 2), 'Spieler 2');
    assert.equal(resolveDefaultMultiplayerPlayerName('Spieler 1', 1), 'Spieler 1');
    assert.equal(resolveDefaultMultiplayerPlayerName('Spieler 4', 3), 'Spieler 3');
    assert.equal(resolveDefaultMultiplayerPlayerName('Mika', 2), 'Mika 2', 'a chosen profile name keeps the seat suffix');
    assert.equal(resolveDefaultMultiplayerPlayerName('Spieler 1 Pro', 2), 'Spieler 1 Pro 2');
});

function stubElement() {
    const classes = new Set();
    return {
        textContent: '', children: [], style: {}, attributes: {},
        appendChild(child) { this.children.push(child); return child; }, append(...nodes) { this.children.push(...nodes); },
        replaceChildren() { this.children.length = 0; }, setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return this.attributes[name] ?? null; }, addEventListener() {}, focus() {}, querySelector() { return null; },
        classList: { add: (...n) => n.forEach((x) => classes.add(x)), remove: (...n) => n.forEach((x) => classes.delete(x)),
            toggle: (n, f) => (f ? classes.add(n) : classes.delete(n)), contains: (n) => classes.has(n) },
    };
}

test('a finished portal chain does not leave the last map loading text behind its results', () => {
    const previousDocument = globalThis.document;
    globalThis.document = { createElement: () => stubElement() };
    try {
        const ui = { messageOverlay: stubElement(), messageText: stubElement(), messageSub: stubElement() };
        ui.messageOverlay.classList.add('hidden');
        ui.messageText.textContent = 'Lade Himmelsleiter IV: Sternenbrunnen...';
        ui.messageSub.textContent = 'Arena wird vorbereitet';
        const controller = new MatchFlowArcadeOverlayController({
            runtime: { state: 'PLAYING', roundPause: 0, ui },
            runtimePort: {
                getMatchRuntimeProjection: () => ({ arcade: { enabled: true } }),
                getArcadeMenuSurfaceState: () => ({ runType: 'five_portals', postRunSummary: { maps: [] } }),
            },
        });
        controller.syncArcadeOverlayPanel();
        assert.equal(ui.messageOverlay.classList.contains('hidden'), false, 'the results show');
        assert.doesNotMatch(ui.messageText.textContent, /^Lade /, 'no stale loading title behind the results');
        assert.doesNotMatch(ui.messageSub.textContent, /Arena wird vorbereitet/);
    } finally {
        globalThis.document = previousDocument;
    }
});

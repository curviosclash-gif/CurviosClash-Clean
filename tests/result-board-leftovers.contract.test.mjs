// Leftovers of the German result board (review of plan ET, 18.09.2026): a few texts still wrote
// numbers with a decimal point and no thousands dot, the arcade intermission showed the raw map key,
// and the arcade finish subtitle repeated the key hint the continue prompt already shows.
//
// Product names that the menu and the HUD share (Run, Daily, Sudden Death, Replay, Modifier) are
// deliberately out of scope: renaming them only here would split one thing into two names.

import assert from 'node:assert/strict';
import test from 'node:test';

import { registerMapCatalogConfigSource } from '../src/shared/contracts/RuntimeMapCatalogContract.js';
import { deriveRoundEndOutcome } from '../src/state/RoundStateOps.js';

registerMapCatalogConfigSource({
    MAPS: { burg: { name: 'Burghof', size: [80, 30, 80] } },
});

const { MatchFlowArcadeOverlayController } = await import('../src/ui/MatchFlowArcadeOverlayController.js');

function createStubElement(tagName = 'div') {
    const element = {
        tagName,
        className: '',
        textContent: '',
        attributes: {},
        children: [],
        listeners: {},
        style: {},
        appendChild(child) { this.children.push(child); return child; },
        append(...nodes) { this.children.push(...nodes); },
        replaceChildren() { this.children.length = 0; },
        removeChild(child) { this.children = this.children.filter((node) => node !== child); return child; },
        get firstChild() { return this.children[0] || null; },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; },
        addEventListener(type, handler) { this.listeners[type] = handler; },
        focus() {},
        querySelector(selector) {
            const match = selector.startsWith('#')
                ? (node) => node.id === selector.slice(1)
                : (node) => node.tagName === selector;
            return findFirst(this, match);
        },
    };
    const classes = new Set();
    element.classList = {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        toggle: (name, force) => (force ? classes.add(name) : classes.delete(name)),
        contains: (name) => classes.has(name),
    };
    return element;
}

function findFirst(root, predicate) {
    for (const child of root.children || []) {
        if (predicate(child)) return child;
        const nested = findFirst(child, predicate);
        if (nested) return nested;
    }
    return null;
}

function textOf(node) {
    if (!node) return '';
    return [node.textContent || '', ...(node.children || []).map(textOf)].join('\n');
}

// The xp counter animates over requestAnimationFrame; the stub jumps straight to the last frame.
function withDocument(run) {
    const saved = { document: globalThis.document, raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame };
    globalThis.document = { createElement: (tagName) => createStubElement(tagName) };
    globalThis.requestAnimationFrame = (step) => { step(Number.MAX_SAFE_INTEGER); return 0; };
    globalThis.cancelAnimationFrame = () => {};
    try {
        return run();
    } finally {
        if (saved.document === undefined) delete globalThis.document;
        else globalThis.document = saved.document;
        globalThis.requestAnimationFrame = saved.raf;
        globalThis.cancelAnimationFrame = saved.caf;
    }
}

function makeController(runtimePort = {}, matchFlowUiController = null) {
    const overlay = createStubElement('div');
    const controller = new MatchFlowArcadeOverlayController({
        runtime: { ui: { messageOverlay: overlay } },
        runtimePort,
        matchFlowUiController,
    });
    return { controller, panel: () => controller._arcadeOverlayPanel };
}

const parcoursInputs = (completionTimeMs) => ({
    winner: { index: 0, isBot: false, score: 1 },
    reason: 'PARCOURS_COMPLETE',
    parcours: { completionTimeMs },
    humanPlayerCount: 1,
    totalBots: 1,
    winsNeeded: 3,
});

test('the parcours title writes its time like the board below it', () => {
    const short = deriveRoundEndOutcome([], parcoursInputs(12500));
    assert.equal(short.messageText, 'Parcours abgeschlossen: Spieler 1 (12,5 s)');
    const long = deriveRoundEndOutcome([], parcoursInputs(75430));
    assert.equal(long.messageText, 'Parcours abgeschlossen: Spieler 1 (1:15)');
});

test('the endless title groups thousands and uses a dash', () => {
    const endless = (isNewRecord) => deriveRoundEndOutcome([], {
        reason: 'ENDLESS_DEATH',
        parcours: { endlessSummary: { score: 12345, isNewRecord } },
    }).messageText;
    assert.equal(endless(false), 'Endlosjagd beendet – 12.345 Punkte');
    assert.equal(endless(true), 'Neuer Rekord – 12.345 Punkte');
});

test('finishing an arcade run does not repeat the key hint of the continue prompt', () => {
    withDocument(() => {
        const applied = [];
        const { controller, panel } = makeController(
            { resolveArcadeVictoryChoice: () => ({ ok: true }), applyRoundEndTransition: () => {} },
            { applyMatchUiState: (state) => applied.push(state) }
        );
        controller.syncArcadeOverlayPanel = () => {};
        controller._renderArcadeVictoryPanel({ phase: 'victory', victory: { score: 10, xpEarned: 1 } });
        findFirst(panel(), (node) => node.id === 'btn-arcade-victory-finish').listeners.click();
        assert.equal(applied.length, 1);
        assert.doesNotMatch(applied[0].messageSub, /ENTER|ESC/i);
    });
});

test('the arcade xp counter ends on a German grouped number', () => {
    withDocument(() => {
        const { controller, panel } = makeController();
        controller._renderArcadePostRunPanel({ postRunSummary: { score: 10, xpEarned: 1250 } });
        assert.equal(findFirst(panel(), (node) => node.id === 'arcade-overlay-xp-counter').textContent, '1.250 XP');
    });
});

test('the five fronts title groups thousands', () => {
    withDocument(() => {
        const { controller, panel } = makeController();
        controller._renderArenaWavesPostRunPanel({ runType: 'arena_waves', postRunSummary: { total: 4200, maps: [] } });
        assert.match(textOf(panel()), /Fünf Fronten abgeschlossen – 4\.200 Punkte/);
    });
});

test('the intermission route choice names the map instead of its key', () => {
    withDocument(() => {
        const { controller, panel } = makeController();
        controller._renderArcadeIntermissionPanel({
            intermission: { nextSectorIndex: 2, choices: [{ id: 'a', mapKey: 'burg' }], rewardChoices: [] },
        });
        const choice = findFirst(panel(), (node) => node.id === 'arcade-choice-a');
        assert.equal(choice.children[0].textContent, 'Burghof');
    });
});

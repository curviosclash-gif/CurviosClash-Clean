// P8: the arcade result panels must read like the new post-match board — values as cards with a
// label and a number instead of one long line glued together with "|", the map name instead of the
// internal key, kills split into regular enemies and leaders, every sector visible in a scrollable
// list and one shared German number format.
//
// Node has no browser, so a small document stub records what the panels build. The stub is the one
// from post-match-board-dom.contract.test.mjs plus the few extras the arcade controller needs
// (append, removeChild/firstChild, querySelector, focus, event listeners).

import assert from 'node:assert/strict';
import test from 'node:test';

import { registerMapCatalogConfigSource } from '../src/shared/contracts/RuntimeMapCatalogContract.js';

// The label lookup reads the runtime map catalog, so the test registers a tiny one: "burg" has a
// name, "geheimgang" is missing on purpose to prove the key survives as the fallback.
registerMapCatalogConfigSource({
    MAPS: {
        burg: { name: 'Burghof', size: [80, 30, 80] },
        standard: { name: 'Standardarena', size: [80, 30, 80] },
    },
});

const { MatchFlowArcadeOverlayController } = await import('../src/ui/MatchFlowArcadeOverlayController.js');

// ---------------------------------------------------------------------------
// Document stub
// ---------------------------------------------------------------------------

function createStubClassList(element) {
    const values = new Set();
    return {
        add(...names) { for (const name of names) values.add(name); element.className = [...values].join(' '); },
        remove(...names) { for (const name of names) values.delete(name); element.className = [...values].join(' '); },
        toggle(name, force) { if (force) this.add(name); else this.remove(name); },
        contains(name) { return values.has(name); },
    };
}

function createStubElement(tagName = 'div') {
    const element = {
        tagName,
        className: '',
        textContent: '',
        attributes: {},
        children: [],
        style: {},
        focusCount: 0,
        appendChild(child) { this.children.push(child); return child; },
        append(...nodes) { for (const node of nodes) this.children.push(node); },
        replaceChildren() { this.children.length = 0; },
        removeChild(child) { this.children = this.children.filter((node) => node !== child); return child; },
        get firstChild() { return this.children[0] || null; },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; },
        hasAttribute(name) { return Object.hasOwn(this.attributes, name); },
        addEventListener() {},
        focus() { this.focusCount += 1; },
        querySelector(selector) {
            const match = selector.startsWith('#')
                ? (node) => node.id === selector.slice(1)
                : (node) => node.tagName === selector;
            return findFirst(this, match);
        },
    };
    element.classList = createStubClassList(element);
    return element;
}

function withDocument(run) {
    const previousDocument = globalThis.document;
    const previousRaf = globalThis.requestAnimationFrame;
    const previousCancel = globalThis.cancelAnimationFrame;
    globalThis.document = { createElement: (tagName) => createStubElement(tagName) };
    globalThis.requestAnimationFrame = () => 0;
    globalThis.cancelAnimationFrame = () => {};
    try {
        return run();
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        globalThis.requestAnimationFrame = previousRaf;
        globalThis.cancelAnimationFrame = previousCancel;
    }
}

// ---------------------------------------------------------------------------
// Tiny query helpers
// ---------------------------------------------------------------------------

function walk(node, visit) {
    for (const child of node.children || []) {
        visit(child);
        walk(child, visit);
    }
}

function findAll(root, predicate) {
    const found = [];
    walk(root, (node) => { if (predicate(node)) found.push(node); });
    return found;
}

function findFirst(root, predicate) {
    return findAll(root, predicate)[0] || null;
}

function textOf(node) {
    if (!node) return '';
    let text = node.textContent || '';
    for (const child of node.children || []) text += `\n${textOf(child)}`;
    return text;
}

function rowKeys(root) {
    return findAll(root, (node) => node.getAttribute('data-stats-row-key') !== null)
        .map((node) => node.getAttribute('data-stats-row-key'));
}

function valueOf(root, rowKey) {
    const row = findFirst(root, (node) => node.getAttribute('data-stats-row-key') === rowKey);
    if (!row) return null;
    return findFirst(row, (node) => String(node.className).includes('message-stats-value'))?.textContent ?? null;
}

function scrollers(root) {
    return findAll(root, (node) => node.getAttribute('data-arcade-scroll') !== null);
}

function makeController() {
    const overlay = createStubElement('div');
    const controller = new MatchFlowArcadeOverlayController({
        runtime: { ui: { messageOverlay: overlay } },
        runtimePort: {},
    });
    return { controller, overlay, panel: () => controller._arcadeOverlayPanel };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function sectorList(count) {
    return Array.from({ length: count }, (_, index) => ({
        sectorIndex: index + 1,
        mapKey: index === 0 ? 'burg' : 'geheimgang',
        awardedPoints: 100 + index,
        comboAtSectorEnd: index,
    }));
}

function postRunState(overrides = {}) {
    return {
        postRunSummary: {
            score: 1250,
            xpEarned: 420,
            bestCombo: 7,
            peakMultiplier: 2.5,
            missionCompletionRate: 0.75,
            missionsCompleted: 3,
            missionsTotal: 4,
            scorePerSector: sectorList(12),
            breakdown: { base: 800, kills: 300, penalty: 50 },
            xpAnimation: { durationMs: 300 },
            ...overrides,
        },
        replay: { payloadAvailable: true },
    };
}

// ---------------------------------------------------------------------------
// Post-run panel
// ---------------------------------------------------------------------------

test('the arcade post-run panel shows cards instead of pipe separated lines', () => {
    withDocument(() => {
        const { controller, panel } = makeController();
        assert.equal(controller._renderArcadePostRunPanel(postRunState()), true);

        const root = panel();
        assert.ok(!textOf(root).includes('|'), `no visible text may glue values with "|":\n${textOf(root)}`);

        const keys = rowKeys(root);
        assert.ok(keys.includes('score'), `the score is a card row, got: ${keys.join(', ')}`);
        assert.equal(valueOf(root, 'score'), '1.250');
        assert.equal(valueOf(root, 'best-combo'), '7');
        assert.equal(valueOf(root, 'mission-rate'), '75 %');
        assert.equal(valueOf(root, 'peak-multiplier'), '2,5');
    });
});

test('a failed run is not called finished', () => {
    withDocument(() => {
        const { controller, panel } = makeController();
        controller._renderArcadePostRunPanel(postRunState({ succeeded: false }));
        assert.match(textOf(panel()), /Arcade Run gescheitert/);
        controller._renderArcadePostRunPanel(postRunState({ succeeded: true }));
        assert.match(textOf(panel()), /Arcade Run abgeschlossen/);
    });
});

test('the run summary tells the result board whether the run succeeded', async () => {
    const { finalizeArcadeRun } = await import('../src/core/arcade/ArcadeRunCompletionOps.js');
    const { ArcadeRunRuntime } = await import('../src/core/arcade/ArcadeRunRuntime.js');
    const runtime = new ArcadeRunRuntime({ now: () => 1000 });
    runtime.configure({ arcade: { enabled: true, seed: 3, sectorCount: 3 } });
    runtime.startRun({});
    finalizeArcadeRun(runtime, 2000);
    assert.equal(runtime.getPostRunSummary()?.succeeded, false);
});

test('every sector is listed with its map name in one scrollable container', () => {
    withDocument(() => {
        const { controller, panel } = makeController();
        controller._renderArcadePostRunPanel(postRunState());
        const root = panel();

        const scroller = scrollers(root)[0];
        assert.ok(scroller, 'the sector list lives in a scrollable container');
        assert.equal(scroller.getAttribute('tabindex'), '0', 'the container is reachable by keyboard');

        const sectorRows = rowKeys(scroller);
        assert.equal(sectorRows.length, 12, `all 12 sectors stay visible, got ${sectorRows.length}`);

        const listed = textOf(scroller);
        assert.match(listed, /Burghof/, 'a known map shows its name');
        assert.match(listed, /geheimgang/, 'an unknown map falls back to its key');
        assert.ok(!listed.includes('burg\n') && !/\bburg\b/.test(listed), 'the known map key is not shown raw');
    });
});

test('the post-run panel keeps its replay button and xp counter hooks', () => {
    withDocument(() => {
        const { controller, panel } = makeController();
        controller._renderArcadePostRunPanel(postRunState());
        const root = panel();
        assert.ok(findFirst(root, (node) => node.id === 'btn-arcade-overlay-replay'), 'replay button stays');
        assert.ok(findFirst(root, (node) => node.id === 'arcade-overlay-xp-counter'), 'xp counter stays');
    });
});

test('a missing or empty summary leaves the panel empty instead of crashing', () => {
    withDocument(() => {
        const { controller, panel } = makeController();
        assert.equal(controller._renderArcadePostRunPanel({}), false);
        assert.equal(controller._renderArcadePostRunPanel(null), false);
        assert.equal(controller._renderArcadePostRunPanel({ postRunSummary: {} }), true);
        assert.ok(!textOf(panel()).includes('NaN'));
        assert.ok(!textOf(panel()).includes('|'));
    });
});

// ---------------------------------------------------------------------------
// Arena waves ("Fünf Fronten")
// ---------------------------------------------------------------------------

test('the arena waves panel splits kills into regular enemies and leaders', () => {
    withDocument(() => {
        const { controller, panel } = makeController();
        const state = {
            runType: 'arena_waves',
            postRunSummary: {
                total: 4200,
                maps: [{
                    mapKey: 'burg',
                    score: 1500,
                    survivalSeconds: 12.5,
                    regularKills: 12,
                    eliteKills: 3,
                    completedWaves: [1, 2, 3],
                }],
            },
        };
        assert.equal(controller._renderArenaWavesPostRunPanel(state), true);
        const root = panel();

        assert.ok(!textOf(root).includes('|'), `no pipe separated rows:\n${textOf(root)}`);
        assert.equal(valueOf(root, 'kills'), '12');
        assert.equal(valueOf(root, 'elite-kills'), '3');
        assert.equal(valueOf(root, 'survival'), '12,5 s');
        assert.equal(valueOf(root, 'wave'), '3');
        assert.match(textOf(root), /Burghof/);
        assert.ok(scrollers(root)[0], 'the map list is scrollable');
        assert.ok(findFirst(root, (node) => node.tagName === 'button'), 'the close button stays');
    });
});

// ---------------------------------------------------------------------------
// Five portals
// ---------------------------------------------------------------------------

test('the five portals panel formats times in german and names the maps', () => {
    withDocument(() => {
        const { controller, panel } = makeController();
        const state = {
            runType: 'five_portals',
            postRunSummary: {
                maps: [{ mapKey: 'burg', timeMs: 12500 }, { mapKey: 'standard', timeMs: 9000 }],
                totalMs: 21500,
                bestTotalMs: 20000,
            },
        };
        assert.equal(controller._renderFivePortalsPostRunPanel(state), true);
        const root = panel();

        assert.ok(!textOf(root).includes('|'), `no pipe separated rows:\n${textOf(root)}`);
        assert.equal(rowKeys(root).length, 4, 'two map rows plus total and record');
        assert.match(textOf(root), /Burghof/);
        assert.match(textOf(root), /Standardarena/);
        assert.equal(valueOf(root, 'total'), '21,50 s');
        assert.equal(valueOf(root, 'record'), '20,00 s');
    });
});

// ---------------------------------------------------------------------------
// Victory panel
// ---------------------------------------------------------------------------

test('the victory panel keeps both action buttons and drops the pipe line', () => {
    withDocument(() => {
        const { controller, panel } = makeController();
        const state = {
            phase: 'victory',
            victory: {
                score: 1250,
                xpEarned: 420,
                lastSector: { awardedPoints: 340, scoreFactor: 1.25, missionBonus: 50, breakdown: { base: 300 } },
            },
        };
        assert.equal(controller._renderArcadeVictoryPanel(state), true);
        const root = panel();

        assert.ok(!textOf(root).includes('|'), `no pipe separated rows:\n${textOf(root)}`);
        assert.equal(valueOf(root, 'score'), '1.250');
        assert.equal(valueOf(root, 'xp'), '420');
        assert.ok(findFirst(root, (node) => node.id === 'btn-arcade-victory-finish'));
        assert.ok(findFirst(root, (node) => node.id === 'btn-arcade-victory-continue'));
    });
});

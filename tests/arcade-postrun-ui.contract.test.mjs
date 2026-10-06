// Arcade after-run displays: what the intermission and the result board show the player besides
// points (route risk against reward, whose XP the sector counts, the next goal after a run).
// Node has no browser, so a small document stub records what the panels build.

import assert from 'node:assert/strict';
import test from 'node:test';

import { registerMapCatalogConfigSource } from '../src/shared/contracts/RuntimeMapCatalogContract.js';

registerMapCatalogConfigSource({ MAPS: { burg: { name: 'Burghof', size: [80, 30, 80] } } });

const { MatchFlowArcadeOverlayController } = await import('../src/ui/MatchFlowArcadeOverlayController.js');

function createStubElement(tagName = 'div') {
    const classes = new Set();
    const element = {
        tagName,
        id: '',
        className: '',
        textContent: '',
        attributes: {},
        children: [],
        style: {},
        appendChild(child) { this.children.push(child); return child; },
        append(...nodes) { this.children.push(...nodes); },
        replaceChildren(...nodes) { this.children = [...nodes]; },
        removeChild(child) { this.children = this.children.filter((node) => node !== child); return child; },
        get firstChild() { return this.children[0] || null; },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; },
        addEventListener() {},
        focus() {},
        querySelector() { return null; },
    };
    element.classList = {
        add(...names) { names.forEach((name) => classes.add(name)); element.className = [...classes].join(' '); },
        remove(...names) { names.forEach((name) => classes.delete(name)); element.className = [...classes].join(' '); },
        toggle() {},
        contains: (name) => classes.has(name),
    };
    return element;
}

function withDocument(run) {
    const previous = globalThis.document;
    globalThis.document = { createElement: (tagName) => createStubElement(tagName) };
    try {
        return run();
    } finally {
        if (previous === undefined) delete globalThis.document;
        else globalThis.document = previous;
    }
}

function walk(node, visit) {
    for (const child of node.children || []) {
        visit(child);
        walk(child, visit);
    }
}

function findFirst(root, predicate) {
    let found = null;
    walk(root, (node) => { if (!found && predicate(node)) found = node; });
    return found;
}

function textOf(node) {
    let text = node?.textContent || '';
    for (const child of node?.children || []) text += `\n${textOf(child)}`;
    return text;
}

function renderIntermission(intermission, runtimeExtras = {}) {
    return withDocument(() => {
        const overlay = createStubElement('div');
        const controller = new MatchFlowArcadeOverlayController({ runtime: { ...runtimeExtras, ui: { messageOverlay: overlay } }, runtimePort: {} });
        assert.equal(controller._renderArcadeIntermissionPanel({ intermission }), true);
        return overlay.children[0];
    });
}

const BASE_INTERMISSION = { nextSectorIndex: 2, lastSectorPoints: 300, lastSectorXp: 90, missionsCompleted: 1, missionsTotal: 1 };

test('each route button names its score bonus and pressure', () => {
    const panel = renderIntermission({
        ...BASE_INTERMISSION,
        choices: [
            { id: 'risky', mapKey: 'burg', modifierLabel: 'Boost Tax', scoreBonus: 0.18, pressure: 0.88 },
            { id: 'calm', mapKey: 'burg', modifierLabel: 'Tight Turns', scoreBonus: 0.08, pressure: 0.42 },
        ],
    });
    const risky = findFirst(panel, (node) => node.id === 'arcade-choice-risky');
    const calm = findFirst(panel, (node) => node.id === 'arcade-choice-calm');
    assert.match(textOf(risky), /\+18 % Punkte · Druck hoch/);
    assert.match(textOf(calm), /\+8 % Punkte · Druck niedrig/);
});

test('a route without bonus or pressure values shows no risk line', () => {
    const panel = renderIntermission({
        ...BASE_INTERMISSION,
        choices: [{ id: 'plain', mapKey: 'burg', modifierLabel: 'Kein Modifikator' }],
    });
    const plain = findFirst(panel, (node) => node.id === 'arcade-choice-plain');
    assert.ok(plain, 'the route button is still drawn');
    assert.doesNotMatch(textOf(plain), /Punkte|Druck/);
});

// Since the split-screen XP fix the run's xpEarned adds up every local pilot, and the sector XP is
// a difference of that sum. Without a per-ship sector start value the share of one ship is not
// known here, so with two or more pilots the row says that it is the total.
test('split screen labels the sector XP as the total of all pilots', () => {
    const panel = renderIntermission({ ...BASE_INTERMISSION, choices: [] }, { numHumans: 2 });
    assert.match(textOf(panel), /XP gesamt \(alle Spieler\)/);
});

test('a single pilot keeps the plain sector XP label', () => {
    const panel = renderIntermission({ ...BASE_INTERMISSION, choices: [] }, { numHumans: 1 });
    assert.doesNotMatch(textOf(panel), /alle Spieler/);
    assert.match(textOf(panel), /\nXP\n/);
});
test('the next sector card says Modifikator, not Modifier', () => {
    const panel = renderIntermission({ ...BASE_INTERMISSION, choices: [], nextSectorPreview: { mapKey: 'burg' } });
    const text = textOf(panel);
    assert.match(text, /\nModifikator\n/);
    assert.match(text, /Kein Modifikator/);
    assert.doesNotMatch(text, /Modifier/);
});

test('the arcade best chain metric is called Beste Kombo', async () => {
    const { MENU_TEXT_CATALOG } = await import('../src/ui/menu/MenuTextCatalog.js');
    assert.equal(MENU_TEXT_CATALOG['menu.arcade.hud.chain.label'], 'Beste Kombo');
});
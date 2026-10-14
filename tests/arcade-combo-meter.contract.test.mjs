// The combo bar was the only hint how long a combo lasts: it drained during the 3 s freeze after
// all missions, sat empty while the combo was still decaying, and the factor read "×3,0" although
// it is always whole. The HUD now says how long the combo holds and when the next factor comes.
import assert from 'node:assert/strict';
import test from 'node:test';

import { ArcadeScoreHUD } from '../src/ui/arcade/ArcadeScoreHUD.js';

function createStubElement() {
    return {
        className: '',
        textContent: '',
        dataset: {},
        children: [],
        style: { setProperty() {}, removeProperty() {} },
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
        removeChild(child) { this.children.splice(this.children.indexOf(child), 1); return child; },
        getBoundingClientRect() { return { bottom: 0 }; },
    };
}

function findByClass(root, className) {
    if (String(root.className || '').split(' ').includes(className)) return root;
    for (const child of root.children || []) {
        const found = findByClass(child, className);
        if (found) return found;
    }
    return null;
}

/** Renders one HUD frame of a gauntlet sector with the given combo timing and returns the nodes. */
function renderCombo(timing) {
    const previousDocument = globalThis.document;
    const previousObserver = globalThis.ResizeObserver;
    globalThis.document = { createElement: () => createStubElement() };
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
    try {
        const hud = new ArcadeScoreHUD(createStubElement());
        hud.update({
            phase: 'sector_active', sectorIndex: 2, comboWindowMs: 5000, comboDecayPerSecond: 1, maxMultiplier: 8,
            comboFreezeUntilMs: 0, ...timing,
            score: { total: 1200, combo: 4, multiplier: 3, lastComboAtMs: 0, breakdown: {}, ...timing.score },
        });
        return {
            bar: hud._comboDecayValue.style.transform,
            factor: hud._multiplierValue.textContent,
            hint: findByClass(hud._container, 'arcade-score-hud-combo-hint')?.textContent ?? null,
        };
    } finally {
        globalThis.document = previousDocument;
        globalThis.ResizeObserver = previousObserver;
    }
}

test('a frozen combo keeps a full bar and says so', () => {
    const frame = renderCombo({ nowMs: 1800, comboFreezeUntilMs: 3000 });
    assert.equal(frame.bar, 'scaleX(1.000)', 'the bar does not drain while the combo is frozen');
    assert.match(frame.hint ?? '', /Eingefroren/);
});

test('inside the window the hint counts the seconds the combo still holds', () => {
    const frame = renderCombo({ nowMs: 3800 });
    assert.equal(frame.bar, 'scaleX(0.240)');
    assert.match(frame.hint ?? '', /1,2 s/);
});

test('after the window the hint says the combo is decaying', () => {
    const frame = renderCombo({ nowMs: 6500 });
    assert.equal(frame.bar, 'scaleX(0.000)');
    assert.match(frame.hint ?? '', /Verfällt/);
});

test('the factor is whole and the hint names the combo for the next factor', () => {
    const frame = renderCombo({ nowMs: 1000 });
    assert.equal(frame.factor, '×3');
    assert.match(frame.hint ?? '', /×4 bei Kombo 6/);
});

test('at the factor cap the hint names no further factor', () => {
    const frame = renderCombo({ nowMs: 1000, score: { combo: 15, multiplier: 8 } });
    assert.equal(frame.factor, '×8');
    assert.doesNotMatch(frame.hint ?? '', /bei Kombo/);
});

test('without a combo there is no hint', () => {
    const frame = renderCombo({ nowMs: 1000, score: { combo: 0, multiplier: 1 } });
    assert.equal(frame.hint?.trim(), '', 'the line stays, but empty');
});

test('a zero decay rate keeps the combo and meter full after the hold window', () => {
    const frame = renderCombo({ nowMs: 6500, comboDecayPerSecond: 0 });
    assert.equal(frame.bar, 'scaleX(1.000)');
    assert.match(frame.hint ?? '', /Hält dauerhaft/);
});

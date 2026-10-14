// The gap to the personal best flashed for 1.2 s at each checkpoint and was gone long before the
// player could read it in a turn. It now stays until the next checkpoint (at most 15 s) and leaves
// with the sector, so "ahead or behind my best" can be checked at any moment of the flight.
import assert from 'node:assert/strict';
import test from 'node:test';

import { ParcoursOverlayController } from '../src/ui/arcade/ParcoursOverlayController.js';

function createStubElement() {
    const classes = new Set();
    return {
        id: '', className: '', textContent: '', style: {}, children: [],
        classList: {
            add: (...names) => names.forEach((name) => classes.add(name)),
            remove: (...names) => names.forEach((name) => classes.delete(name)),
            contains: (name) => classes.has(name),
            toggle: (name, force) => (force ?? !classes.has(name)) ? classes.add(name) : classes.delete(name),
        },
        appendChild(child) { this.children.push(child); return child; },
        setAttribute() {},
    };
}

function withDom(run) {
    const previous = globalThis.document;
    const byId = new Map();
    const body = createStubElement();
    globalThis.document = {
        body,
        getElementById: (id) => byId.get(id) || null,
        createElement: () => {
            const el = createStubElement();
            queueMicrotask(() => byId.set(el.id, el));
            return el;
        },
    };
    try { run(); } finally { globalThis.document = previous; }
}

const split = (sequence, deltaMs) => ({ type: 'parcours_split', sequence, deltaMs, isBetter: deltaMs < 0, checkpointIndex: sequence - 1 });

test('the gap to the best time stays readable until the next checkpoint', () => {
    withDom(() => {
        const overlay = new ParcoursOverlayController();
        overlay.tickSplitDelta({ sectorIndex: 1, events: [split(1, -840)] }, 1000);
        const el = overlay._splitDeltaOverlay;
        assert.equal(el.classList.contains('hidden'), false);
        assert.match(el.textContent, /−0,84 s/, 'a lead shows with a real minus and a decimal comma');

        overlay.tickSplitDelta({ sectorIndex: 1, events: [split(1, -840)] }, 6000);
        assert.equal(el.classList.contains('hidden'), false, 'five seconds later the gap is still shown');

        overlay.tickSplitDelta({ sectorIndex: 1, events: [split(1, -840), split(2, 1250)] }, 9000);
        assert.match(el.textContent, /\+1,25 s/, 'the next checkpoint replaces it');
        assert.equal(el.classList.contains('split-worse'), true);

        overlay.tickSplitDelta({ sectorIndex: 2, events: [split(1, -840), split(2, 1250)] }, 9500);
        assert.equal(el.classList.contains('hidden'), true, 'a new sector clears the old gap');
    });
});

test('a gap without a following checkpoint fades after fifteen seconds', () => {
    withDom(() => {
        const overlay = new ParcoursOverlayController();
        overlay.tickSplitDelta({ sectorIndex: 1, events: [split(1, 300)] }, 1000);
        overlay.tickSplitDelta({ sectorIndex: 1, events: [split(1, 300)] }, 16_500);
        assert.equal(overlay._splitDeltaOverlay.classList.contains('hidden'), true);
    });
});

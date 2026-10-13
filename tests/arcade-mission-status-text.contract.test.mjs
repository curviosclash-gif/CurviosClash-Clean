// The mission list told "erfüllt" (#44ff44) and "aktiv" (#00ff88) apart only by two almost equal
// greens, and "gescheitert" only by red. Each card now carries a status symbol (✓ / ✗ / •) and an
// aria-label with the status word. The HUD also rewrote every text on every frame; it now writes a
// text only when it changes.
import assert from 'node:assert/strict';
import test from 'node:test';

import { ArcadeMissionHUD } from '../src/ui/arcade/ArcadeMissionHUD.js';

function element() {
    let text = '';
    const node = {
        writes: 0, attributes: {}, children: [], style: {}, className: '',
        get textContent() { return text; },
        set textContent(value) { node.writes += 1; text = String(value); },
        appendChild(child) { node.children.push(child); child.parentElement = node; return child; },
        replaceChildren() { node.children.length = 0; },
        setAttribute(name, value) { node.attributes[name] = String(value); },
        getAttribute(name) { return node.attributes[name] ?? null; },
    };
    return node;
}

function textOf(node) {
    return [node.textContent, ...(node.children || []).map(textOf)].join(' ');
}

function withDom(run) {
    const previous = globalThis.document;
    globalThis.document = { createElement: () => element(), body: element() };
    try {
        run();
    } finally {
        if (previous === undefined) delete globalThis.document;
        else globalThis.document = previous;
    }
}

const missions = (overrides) => ({
    missions: [
        { type: 'KILL_COUNT', progress: { kills: 5, target: 5 }, completed: true, ...overrides[0] },
        { type: 'COLLECT_ITEMS', progress: { collected: 1, target: 3 }, ...overrides[1] },
        { type: 'SURVIVE_DURATION', progress: { survived: 4, target: 45 }, failed: true, ...overrides[2] },
    ],
});

test('done, active and failed missions differ by symbol and status word, not only by colour', () => {
    withDom(() => {
        const parent = element();
        const hud = new ArcadeMissionHUD(parent);
        hud.update(missions([{}, {}, {}]));
        const [done, active, failed] = hud._container.children;
        assert.match(textOf(done), /✓/);
        assert.match(textOf(failed), /✗/);
        assert.match(textOf(active), /•/);
        assert.doesNotMatch(textOf(active), /[✓✗]/);
        assert.match(done.getAttribute('aria-label') || '', /erfüllt/);
        assert.match(active.getAttribute('aria-label') || '', /aktiv/);
        assert.match(failed.getAttribute('aria-label') || '', /gescheitert/);
        assert.match(active.getAttribute('aria-label') || '', /1\/3/, 'the label also names the progress');
    });
});

test('an unchanged frame writes no mission text again', () => {
    withDom(() => {
        const hud = new ArcadeMissionHUD(element());
        const state = missions([{}, {}, {}]);
        hud.update(state);
        const nodes = [];
        const collect = (node) => { nodes.push(node); node.children.forEach(collect); };
        hud._container.children.forEach(collect);
        const before = nodes.map((node) => node.writes);
        hud.update(state);
        hud.update(state);
        assert.deepEqual(nodes.map((node) => node.writes), before);
    });
});

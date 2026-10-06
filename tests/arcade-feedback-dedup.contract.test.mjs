// Each new sector was announced twice: once in the centre of the screen and once more inside the
// score box, which grew for 1.4 s and pushed the player bars (they follow --arcade-score-hud-bottom)
// down and back up. Only the centred banner stays. In sudden death the score box, its banner and
// the screen edge pulsed at the same time; only the screen edge pulses now, and not at all while
// prefers-reduced-motion is on. The camera option cameraPerspective.reduceMotion does not count.
import assert from 'node:assert/strict';
import test from 'node:test';
import '../src/core/Config.js';

import { HudRuntimeSystem } from '../src/ui/HudRuntimeSystem.js';

function createStubElement(tagName = 'div') {
    const classes = new Set();
    return {
        tagName, className: '', id: '', style: {}, dataset: {}, children: [], textContent: '', parentElement: null,
        classList: {
            add: (...names) => names.forEach((name) => classes.add(name)),
            remove: (...names) => names.forEach((name) => classes.delete(name)),
            contains: (name) => classes.has(name),
            toggle(name, force) { const on = force === undefined ? !classes.has(name) : !!force; if (on) classes.add(name); else classes.delete(name); return on; },
        },
        appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
        removeChild(child) { this.children.splice(this.children.indexOf(child), 1); return child; },
        replaceChildren() { this.children.length = 0; },
        querySelector() { return null; },
        setAttribute() {},
    };
}

function withDom(run, { systemReduced = false } = {}) {
    const saved = { document: globalThis.document, matchMedia: globalThis.matchMedia };
    globalThis.document = { body: createStubElement('body'), getElementById: () => null, createElement: (tag) => createStubElement(tag) };
    globalThis.matchMedia = () => ({ matches: systemReduced });
    try {
        run();
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete globalThis[key];
            else globalThis[key] = value;
        }
    }
}

function findAll(node, predicate, found = []) {
    for (const child of node.children || []) {
        if (predicate(child)) found.push(child);
        findAll(child, predicate, found);
    }
    return found;
}

function arcadeFrame(runtime, arcade) {
    runtime._updateArcadeHud({ arcade: { nowMs: 100, sectorIndex: 1, currentMapKey: 'standard', score: { total: 0, breakdown: {} }, ...arcade } });
}

test('a new sector is announced once, by the centred banner only', () => {
    withDom(() => {
        const runtime = new HudRuntimeSystem({ game: { ui: { hud: createStubElement('hud') } } });
        arcadeFrame(runtime, { phase: 'playing', sectorIndex: 2 });
        assert.equal(runtime._arcadeSectorTransitionOverlay.classList.contains('hidden'), false);
        assert.match(runtime._arcadeSectorTransitionOverlay.textContent, /Sektor 2/);
        const inBox = findAll(runtime._arcadeScoreHud._container, (node) => String(node.className).includes('arcade-score-hud-transition')
            || /Sektor 2/.test(node.textContent));
        assert.deepEqual(inBox, [], 'the score box carries no second sector banner');
    });
});

function suddenDeathOverlay(runtimeConfig, options) {
    let overlay = null;
    withDom(() => {
        const runtime = new HudRuntimeSystem({ game: { ui: { hud: createStubElement('hud') }, runtimeConfig } });
        arcadeFrame(runtime, { phase: 'sudden_death' });
        overlay = runtime._arcadeSuddenDeathOverlay;
    }, options);
    return overlay;
}

test('the sudden death edge pulse stops while prefers-reduced-motion is on', () => {
    const calm = suddenDeathOverlay({ cameraPerspective: { reduceMotion: false } }, { systemReduced: true });
    assert.equal(calm.classList.contains('hidden'), false, 'the edge still marks sudden death');
    assert.equal(calm.classList.contains('reduced-motion'), true);
    for (const reduceMotion of [true, false]) {
        assert.equal(suddenDeathOverlay({ cameraPerspective: { reduceMotion } })
            .classList.contains('reduced-motion'), false, `the camera option (${reduceMotion}) alone keeps the pulse`);
    }
});

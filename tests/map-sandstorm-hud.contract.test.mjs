import assert from 'node:assert/strict';
import test from 'node:test';

import { MapSandstormHud } from '../src/ui/MapSandstormHud.js';

/** Just enough of an element for the HUD: classes, attributes, inline style and children. */
function createStubElement() {
    const classes = new Set();
    const element = {
        children: [],
        style: {},
        textContent: '',
        attributes: {},
        set className(value) { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach((name) => classes.add(name)); },
        get className() { return [...classes].join(' '); },
        classList: {
            add: (name) => classes.add(name),
            remove: (name) => classes.delete(name),
            contains: (name) => classes.has(name),
            toggle: (name, force) => ((force ?? !classes.has(name)) ? classes.add(name) : classes.delete(name)),
        },
        setAttribute(name, value) { element.attributes[name] = String(value); },
        append(...nodes) { element.children.push(...nodes); },
        appendChild(node) { element.children.push(node); return node; },
        remove() {},
    };
    return element;
}

function withStubDocument(run) {
    const previous = globalThis.document;
    globalThis.document = { createElement: createStubElement, body: createStubElement() };
    try {
        return run();
    } finally {
        if (previous === undefined) delete globalThis.document;
        else globalThis.document = previous;
    }
}

const ACTIVE = { enabled: true, phase: 'ACTIVE', remainingSeconds: 40, intensity: 1 };
const CUE = { active: true, angleDegrees: 30 };

function cueAnchors(localHumanCount, viewportLayout) {
    return withStubDocument(() => {
        const parent = createStubElement();
        const hud = new MapSandstormHud(parent);
        hud.update(ACTIVE, { getSandstormProximityCue: () => CUE }, { localHumanCount, viewportLayout });
        return hud.cues.map((cue) => [cue.root.style.left, cue.root.style.top]);
    });
}

test('the storm motion cue sits over its own player view in every screen layout', () => {
    assert.deepEqual(cueAnchors(1, 'single'), [['50%', '18%']], 'one player: centred, not in the left half');
    assert.deepEqual(cueAnchors(2, 'two_columns'), [['25%', '18%'], ['75%', '18%']]);
    assert.deepEqual(cueAnchors(3, 'three_columns').map(([left]) => left), ['16.67%', '50%', '83.33%']);
    assert.deepEqual(cueAnchors(3, 'three_rows'), [['50%', '6%'], ['50%', '39.33%'], ['50%', '72.67%']]);
    assert.deepEqual(cueAnchors(4, 'four_grid'), [['25%', '9%'], ['75%', '9%'], ['25%', '59%'], ['75%', '59%']]);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { createMouseSteeringInputSource, createPreferredMatchInputSource } from '../src/ui/MatchInputSourceResolver.js';
import { VIEWPORT_LAYOUTS, resolveFirstViewportFraction } from '../src/shared/contracts/ViewportLayoutContract.js';

function createTarget() {
    const handlers = new Map();
    return {
        style: {},
        handlers,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 500 }),
        addEventListener: (type, handler) => handlers.set(type, handler),
        removeEventListener: (type) => handlers.delete(type),
        fire(type, event) { handlers.get(type)?.({ preventDefault() {}, ...event }); },
    };
}

const inputManager = { getKeyboardInput: () => ({ yawAxis: 0, pitchAxis: 0, shootMG: false }) };

test('two-player mouse steering is centred on player one\'s own half of the screen', () => {
    const target = createTarget();
    const source = createMouseSteeringInputSource(inputManager, false, {
        keyboardPlayerIndex: 0,
        target,
        viewportFraction: resolveFirstViewportFraction(VIEWPORT_LAYOUTS.TWO_COLUMNS),
    });
    source.bind(0);

    target.fire('pointermove', { clientX: 250, clientY: 250 });
    assert.equal(source.poll().yawAxis, 0, 'the middle of the left half is neutral');

    target.fire('pointermove', { clientX: 125, clientY: 250 });
    assert.ok(source.poll().yawAxis > 0.4, 'left of that centre steers left');

    target.fire('pointermove', { clientX: 750, clientY: 250 });
    assert.equal(source.poll().yawAxis, 0, 'the other player\'s half does not steer player one');

    target.fire('mousedown', { button: 2, clientX: 750, clientY: 250 });
    assert.equal(source.poll().shootMG, false, 'a click on the other half does not fire for player one');

    target.fire('mousedown', { button: 2, clientX: 250, clientY: 250 });
    assert.equal(source.poll().shootMG, true);
});

test('the preferred source hands the split layout to player one\'s mouse', () => {
    const target = createTarget();
    const previousDocument = globalThis.document;
    globalThis.document = { getElementById: () => target, documentElement: { dataset: {} } };
    try {
        const source = createPreferredMatchInputSource({
            inputManager,
            playerIndex: 0,
            localHumanCount: 2,
            game: {
                settings: { localSettings: { mouseSteering: true }, controls: {} },
                runtimeConfig: { session: { viewportLayout: VIEWPORT_LAYOUTS.TWO_COLUMNS } },
            },
        });
        assert.equal(source.type, 'mouse');
        source.bind(0);
        target.fire('pointermove', { clientX: 250, clientY: 250 });
        assert.equal(source.poll().yawAxis, 0);
    } finally {
        globalThis.document = previousDocument;
    }
});

test('single player keeps the whole canvas as steering area', () => {
    assert.deepEqual(resolveFirstViewportFraction(VIEWPORT_LAYOUTS.SINGLE), { x: 0, y: 0, width: 1, height: 1 });
    assert.deepEqual(resolveFirstViewportFraction(VIEWPORT_LAYOUTS.THREE_ROWS), { x: 0, y: 0, width: 1, height: 1 / 3 });
});

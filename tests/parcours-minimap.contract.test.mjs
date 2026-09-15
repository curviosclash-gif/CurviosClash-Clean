import assert from 'node:assert/strict';
import test from 'node:test';

import { ParcoursMinimapRenderer } from '../src/ui/arcade/ParcoursMinimapRenderer.js';

function createRecordingCanvasContext(recordedArcs, recordedText = []) {
    let currentArc = null;
    return {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
        font: '',
        textAlign: '',
        clearRect() {},
        beginPath() {
            currentArc = null;
        },
        roundRect() {},
        rect() {},
        fill() {
            if (currentArc) {
                recordedArcs.push({
                    x: currentArc.x,
                    y: currentArc.y,
                    r: currentArc.r,
                    fillStyle: this.fillStyle,
                });
            }
        },
        moveTo() {},
        lineTo() {},
        stroke() {},
        arc(x, y, r) {
            currentArc = { x, y, r };
        },
        save() {},
        translate() {},
        rotate() {},
        closePath() {},
        restore() {},
        fillText(text, x, y) {
            recordedText.push({ text, x, y, fillStyle: this.fillStyle });
        },
    };
}

test('ParcoursMinimapRenderer keeps untaken branch siblings unpassed', () => {
    const recordedArcs = [];
    const fakeCanvas = {
        id: '',
        width: 0,
        height: 0,
        style: {},
        getContext() {
            return createRecordingCanvasContext(recordedArcs);
        },
    };

    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    globalThis.document = {
        body: {
            appendChild() {},
        },
        createElement(tagName) {
            if (tagName !== 'canvas') {
                throw new Error(`unexpected element request: ${tagName}`);
            }
            return fakeCanvas;
        },
    };
    globalThis.window = {
        addEventListener() {},
        removeEventListener() {},
    };

    try {
        const renderer = new ParcoursMinimapRenderer();
        const routeSnapshot = {
            enabled: true,
            routeId: 'branch_probe',
            totalCheckpoints: 4,
            checkpoints: [
                { id: 'CP01', routeIndex: 0, pos: [0, 0, 0], nextCheckpointIds: ['CP02'], isBranchOption: false },
                { id: 'CP02', routeIndex: 1, pos: [10, 0, 0], nextCheckpointIds: ['CP03A', 'CP03B'], isBranchOption: false },
                { id: 'CP03A', routeIndex: 2, pos: [20, 0, -6], nextCheckpointIds: ['CP04'], isBranchOption: true },
                { id: 'CP03B', routeIndex: 2, pos: [20, 0, 6], nextCheckpointIds: ['CP04'], isBranchOption: true },
                { id: 'CP04', routeIndex: 3, pos: [30, 0, 0], nextCheckpointIds: [], isBranchOption: false },
            ],
            finish: { id: 'FINISH', pos: [40, 0, 0] },
        };

        renderer.update(routeSnapshot, 3, ['CP01', 'CP02', 'CP03A'], null, null);

        const checkpointCache = renderer._cpById;
        const passedCheckpointCache = renderer._passedCheckpointIds;
        renderer.update(routeSnapshot, 3, ['CP01', 'CP02', 'CP03A'], null, null);
        assert.equal(renderer._cpById, checkpointCache);
        assert.equal(renderer._passedCheckpointIds, passedCheckpointCache);

        const checkpointDots = recordedArcs.filter((entry) => entry.r === 4 || entry.r === 5);
        assert.equal(checkpointDots.length, 12);

        const [cp01, cp02, cp03a, cp03b, cp04] = checkpointDots.slice(-6);
        assert.equal(cp01.fillStyle, '#00cc00');
        assert.equal(cp02.fillStyle, '#00cc00');
        assert.equal(cp03a.fillStyle, '#00cc00');
        assert.equal(cp03b.fillStyle, '#00e5ff');
        assert.equal(cp04.fillStyle, '#aaff00');
    } finally {
        globalThis.document = originalDocument;
        globalThis.window = originalWindow;
    }
});

test('ParcoursMinimapRenderer shows vertical distance to the next checkpoint', () => {
    const recordedText = [];
    const fakeCanvas = {
        style: {},
        getContext() {
            return createRecordingCanvasContext([], recordedText);
        },
    };
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    globalThis.document = {
        body: { appendChild() {} },
        createElement: () => fakeCanvas,
    };
    globalThis.window = { addEventListener() {}, removeEventListener() {} };

    try {
        const renderer = new ParcoursMinimapRenderer();
        renderer.update({
            enabled: true,
            routeId: 'vertical_probe',
            totalCheckpoints: 1,
            checkpoints: [{ id: 'CP01', routeIndex: 0, pos: [0, 42, 0], nextCheckpointIds: [] }],
            finish: { id: 'FINISH', pos: [10, 42, 0] },
        }, 0, [], { x: 0, y: 12, z: 0 }, null);

        assert.equal(recordedText.at(-1)?.text, '\u2191 30 m');
    } finally {
        globalThis.document = originalDocument;
        globalThis.window = originalWindow;
    }
});

test('ParcoursMinimapRenderer toggles with M only during a run and outside text fields', () => {
    const fakeCanvas = {
        style: {},
        getContext() {
            return createRecordingCanvasContext([]);
        },
    };
    const listeners = [];
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    globalThis.document = {
        body: { appendChild() {} },
        createElement: () => fakeCanvas,
    };
    globalThis.window = {
        addEventListener(type, handler) {
            listeners.push({ type, handler });
        },
        removeEventListener() {},
    };

    const routeSnapshot = {
        enabled: true,
        routeId: 'toggle_probe',
        totalCheckpoints: 1,
        checkpoints: [{ id: 'CP01', routeIndex: 0, pos: [0, 0, 0], nextCheckpointIds: [] }],
        finish: { id: 'FINISH', pos: [10, 0, 0] },
    };

    try {
        const renderer = new ParcoursMinimapRenderer();
        renderer.update(routeSnapshot, 0, [], null, null);
        const keyDown = listeners.find((entry) => entry.type === 'keydown')?.handler;
        assert.equal(typeof keyDown, 'function');

        keyDown({ code: 'KeyM', target: { tagName: 'INPUT' } });
        assert.equal(renderer._visible, true, 'typing M into a field must not toggle the minimap');

        keyDown({ code: 'KeyM', target: { tagName: 'DIV', isContentEditable: true } });
        assert.equal(renderer._visible, true, 'typing M into an editable must not toggle the minimap');

        keyDown({ code: 'KeyM', target: { tagName: 'CANVAS' } });
        assert.equal(renderer._visible, false, 'M must toggle the minimap during a run');
        assert.equal(fakeCanvas.style.display, 'none');

        // Back in the menu the route is gone: M must not bring the overlay back.
        renderer.update({ enabled: false }, 0, [], null, null);
        keyDown({ code: 'KeyM', target: { tagName: 'CANVAS' } });
        assert.equal(fakeCanvas.style.display, 'none', 'M must not show the minimap outside a run');
    } finally {
        globalThis.document = originalDocument;
        globalThis.window = originalWindow;
    }
});

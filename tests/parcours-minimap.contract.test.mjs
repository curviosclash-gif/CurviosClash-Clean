import assert from 'node:assert/strict';
import test from 'node:test';

import { ParcoursMinimapRenderer } from '../src/ui/arcade/ParcoursMinimapRenderer.js';

function createRecordingCanvasContext(recordedArcs) {
    let currentArc = null;
    return {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
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

        const checkpointDots = recordedArcs.filter((entry) => entry.r === 4 || entry.r === 5);
        assert.equal(checkpointDots.length, 6);

        const [cp01, cp02, cp03a, cp03b, cp04] = checkpointDots;
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

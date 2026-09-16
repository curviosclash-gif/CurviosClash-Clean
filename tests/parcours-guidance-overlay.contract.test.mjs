import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { ParcoursOverlayController, resolveGuidanceEdgeNdc } from '../src/ui/arcade/ParcoursOverlayController.js';

function installDom() {
    const body = {
        children: [],
        appendChild(el) { el.parentElement = this; this.children.push(el); },
        removeChild(el) { this.children.splice(this.children.indexOf(el), 1); el.parentElement = null; },
    };
    globalThis.document = {
        body,
        createElement() { return { style: {}, setAttribute() {}, parentElement: null }; },
    };
    globalThis.window = { innerWidth: 800, innerHeight: 600 };
    return body;
}

function makeCamera() {
    const camera = new THREE.PerspectiveCamera(70, 4 / 3, 0.1, 1000);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld(true);
    return camera;
}

test('Parcours guidance edge cues hide on-screen targets, use viewport edges off-screen, and clean up', () => {
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    const body = installDom();
    try {
        const controller = new ParcoursOverlayController();
        const target = { checkpointId: 'FINISH', pos: { x: 0, y: 0, z: -10 }, mesh: { userData: { checkpointColor: 0xffd700 } } };
        const view = { active: true, intensity: 2, targets: [target] };
        const camera = makeCamera();
        const entityManager = {
            arena: { _portalGateSystem: { checkpointRingRuntime: { getGuidanceView: () => view } } },
            renderer: { cameras: [camera], viewportSystem: { width: 800, height: 600, layout: 'single' } },
        };

        controller._tickGuidanceEdges(entityManager);
        const first = controller._guidanceEdges.get('0:FINISH');
        assert.equal(first.style.display, 'none');

        target.pos.x = 100;
        controller._tickGuidanceEdges(entityManager);
        assert.equal(first.style.display, 'block');
        assert.equal(first.style.left, '784px');
        assert.match(first.style.background, /#ffd700/i);
        assert.equal(first.style.opacity, '0.3');

        target.pos.x = 0;
        target.pos.z = 10;
        controller._tickGuidanceEdges(entityManager);
        assert.equal(first.style.left, '784px');

        entityManager.renderer.cameras = [camera, makeCamera()];
        entityManager.renderer.viewportSystem.layout = 'two_columns';
        target.pos.x = 100;
        target.pos.z = -10;
        controller._tickGuidanceEdges(entityManager);
        assert.equal(controller._guidanceEdges.get('0:FINISH').style.left, '384px');
        assert.equal(controller._guidanceEdges.get('1:FINISH').style.left, '784px');

        entityManager.renderer.cameras = [makeCamera(), makeCamera(), makeCamera(), makeCamera()];
        entityManager.renderer.viewportSystem.layout = 'four_grid';
        entityManager.renderer.viewportSystem.height = 601;
        controller._tickGuidanceEdges(entityManager);
        assert.equal(controller._guidanceEdges.get('0:FINISH').style.left, '384px');
        assert.equal(controller._guidanceEdges.get('0:FINISH').style.top, '150.5px');
        assert.equal(controller._guidanceEdges.get('1:FINISH').style.left, '784px');
        assert.equal(controller._guidanceEdges.get('1:FINISH').style.top, '150.5px');
        assert.equal(controller._guidanceEdges.get('2:FINISH').style.left, '384px');
        assert.equal(controller._guidanceEdges.get('2:FINISH').style.top, '451px');
        assert.equal(controller._guidanceEdges.get('3:FINISH').style.left, '784px');
        assert.equal(controller._guidanceEdges.get('3:FINISH').style.top, '451px');

        controller.dispose();
        assert.equal(body.children.length, 0);
    } finally {
        globalThis.document = previousDocument;
        globalThis.window = previousWindow;
    }
});

test('resolveGuidanceEdgeNdc normalizes off-screen directions and has a deterministic behind fallback', () => {
    assert.deepEqual(resolveGuidanceEdgeNdc(4, -2, true), { x: 1, y: -0.5 });
    assert.deepEqual(resolveGuidanceEdgeNdc(0, 0, false), { x: 1, y: 0 });
});

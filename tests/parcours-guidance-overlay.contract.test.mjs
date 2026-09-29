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

function assertNear(actual, expected) {
    assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${actual} to be close to ${expected}`);
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
        const view = { active: true, intensity: 1, pulse: 0, targets: [target] };
        const camera = makeCamera();
        const entityManager = {
            arena: { _portalGateSystem: { checkpointRingRuntime: { getGuidanceView: () => view } } },
            renderer: { cameras: [camera], viewportSystem: { width: 800, height: 600, layout: 'single' } },
        };

        controller._tickGuidanceEdges(entityManager);
        const first = controller._guidanceEdges.get('0:FINISH');
        assert.equal(first.style.display, 'none');

        // Outside the breath (pulse 0) the arrow stays visible at the resting opacity.
        target.pos.x = 100;
        controller._tickGuidanceEdges(entityManager);
        assert.equal(first.style.display, 'block');
        assert.equal(first.style.left, '784px');
        assert.match(first.style.clipPath, /polygon/);
        assert.match(first.style.background, /#ffd700/i);
        assertNear(Number(first.style.opacity), 0.45);
        assert.equal(first.style.transform, 'rotate(0rad)');

        view.pulse = 1;
        controller._tickGuidanceEdges(entityManager);
        assertNear(Number(first.style.opacity), 0.75);

        view.intensity = 3 / 1.35;
        view.pulse = 0;
        controller._tickGuidanceEdges(entityManager);
        assert.ok(Number(first.style.opacity) > 0.9 && Number(first.style.opacity) <= 0.95);
        view.intensity = 1;

        // Target straight above: the arrow points up (screen y grows downwards).
        target.pos.x = 0;
        target.pos.y = 100;
        controller._tickGuidanceEdges(entityManager);
        assert.match(first.style.transform, /^rotate\(-1\.5707963\d*rad\)$/);
        target.pos.y = 0;
        target.pos.x = 100;

        // The colour is only written when it changes.
        first.style.background = 'stale';
        controller._tickGuidanceEdges(entityManager);
        assert.equal(first.style.background, 'stale');
        target.mesh.userData.checkpointColor = 0x00ff00;
        controller._tickGuidanceEdges(entityManager);
        assert.match(first.style.background, /#00ff00/i);

        view.intensity = 0;
        controller._tickGuidanceEdges(entityManager);
        assert.equal(first.style.display, 'none');
        view.intensity = 1;

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

test('Parcours guidance edge arrows only show in the viewport of the guided player on a shared screen', () => {
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    installDom();
    try {
        const controller = new ParcoursOverlayController();
        const target = { checkpointId: 'CP01', pos: { x: 100, y: 0, z: -10 }, mesh: { userData: { checkpointColor: 0xffd700 } } };
        const view = { active: true, intensity: 1, pulse: 0, player: { index: 1 }, targets: [target] };
        const entityManager = {
            arena: { _portalGateSystem: { checkpointRingRuntime: { getGuidanceView: () => view } } },
            renderer: { cameras: [makeCamera(), makeCamera()], viewportSystem: { width: 800, height: 600, layout: 'two_columns' } },
        };
        controller._tickGuidanceEdges(entityManager);
        assert.notEqual(controller._guidanceEdges.get('0:CP01')?.style.display, 'block');
        assert.equal(controller._guidanceEdges.get('1:CP01').style.display, 'block');
        controller.dispose();
    } finally {
        globalThis.document = previousDocument;
        globalThis.window = previousWindow;
    }
});

test('resolveGuidanceEdgeNdc normalizes off-screen directions and has a deterministic behind fallback', () => {
    assert.deepEqual(resolveGuidanceEdgeNdc(4, -2, true), { x: 1, y: -0.5 });
    assert.deepEqual(resolveGuidanceEdgeNdc(0, 0, false), { x: 1, y: 0 });
});

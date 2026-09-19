import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CrosshairSystem } from '../src/ui/CrosshairSystem.js';

function createElement(ownerDocument = null) {
    return {
        ownerDocument,
        parentElement: null,
        isConnected: true,
        style: { setProperty() {} },
        classList: { toggle() {} },
        setAttribute() {},
    };
}

test('MG aim dot follows the acquired target and hides outside combat', () => {
    const previousWindow = globalThis.window;
    globalThis.window = { innerWidth: 1000, innerHeight: 600 };
    try {
        const document = { createElement: () => createElement(document) };
        const container = {
            children: [],
            querySelector() { return null; },
            appendChild(element) {
                element.parentElement = this;
                this.children.push(element);
            },
        };
        const crosshair = createElement(document);
        crosshair.parentElement = container;

        const camera = new THREE.PerspectiveCamera(60, 1000 / 600, 0.1, 1000);
        camera.updateMatrixWorld(true);
        const game = {
            numHumans: 1,
            runtimeConfig: { session: {} },
            renderer: { cameras: [camera] },
            ui: { crosshairP1: crosshair, crosshairP2: null },
        };
        const system = new CrosshairSystem({ game });
        const player = {
            playerIndex: 0,
            alive: true,
            planarMode: false,
            cameraModeId: 'FIRST_PERSON',
            position: { x: 0, y: 0, z: 0 },
            aimDirection: { x: 0, y: 0, z: -1 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
        };
        const projection = {
            localHumanCount: 1,
            isNetworkSession: false,
            players: [player],
            hunt: { active: true, overheatByPlayer: {} },
            lockTargets: [{
                playerIndex: 0,
                alive: true,
                position: { x: 5, y: 0, z: -20 },
            }],
        };

        system.updateCrosshairs(projection);

        const dot = container.children[0];
        assert.equal(dot.id, 'mg-aim-dot-p1');
        assert.equal(dot.style.display, 'block');
        assert.ok(Number.parseFloat(dot.style.left) > 500, 'target right of center moves the dot right');
        assert.equal(dot.style.top, '300px');
        assert.equal(crosshair.style.display, 'none', 'normal crosshair visibility remains unchanged');

        projection.hunt.active = false;
        system.updateCrosshairs(projection);
        assert.equal(dot.style.display, 'none');
    } finally {
        globalThis.window = previousWindow;
    }
});

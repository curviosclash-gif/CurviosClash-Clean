import assert from 'node:assert/strict';
import test from 'node:test';

import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';

const BOMBER = {
    id: 'moving_bomber', kind: 'bomber', loop: false,
    path: [[-30, 45, 0], [30, 45, 0]], speed: 30,
    weapons: { mg: false, rocket: false, bomb: false },
};

function createHarness() {
    const scene = new Set();
    const owner = {
        gameModeStrategy: { modeType: 'HUNT', getPickupModeType: () => 'HUNT' },
        arena: { currentMapDefinition: { mapUnits: [BOMBER] } },
        renderer: {
            addToScene(object) { scene.add(object); },
            removeFromScene(object) { scene.delete(object); },
        },
    };
    return { scene, system: new MapUnitSystem(owner) };
}

test('a bomber uses one lightweight airframe rooted at its authored flight height', () => {
    const { scene, system } = createHarness();
    assert.equal(system.startRound(), 1);
    const [bomber] = system.units;

    assert.equal(bomber.root.userData.bomber, true);
    assert.equal(bomber.root.children.length, 5);
    assert.deepEqual(bomber.position.toArray(), [-30, 45, 0]);
    assert.equal(scene.size, 1);
});

test('the bomber follows its fixed path and releases its shared visual on restart', () => {
    const { scene, system } = createHarness();
    system.startRound();
    const first = system.units[0];

    system.update(0.5);
    assert.equal(first.position.x, -15);
    assert.equal(first.position.y, 45);
    assert.equal(first.position.z, 0);

    system.startRound();
    assert.equal(scene.size, 1);
    assert.notEqual(system.units[0], first);
    system.dispose();
    assert.equal(scene.size, 0);
});

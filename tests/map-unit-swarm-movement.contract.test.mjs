import assert from 'node:assert/strict';
import test from 'node:test';

import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';

const SWARM = {
    id: 'moving_swarm',
    kind: 'swarm',
    path: [[0, 6, 0], [36, 6, 0]],
    speed: 18,
    memberCount: 8,
    memberHp: 8,
    formationRadius: 5,
    weapons: { mg: false, rocket: false },
};

function createHarness() {
    const scene = new Set();
    const owner = {
        gameModeStrategy: { modeType: 'HUNT', getPickupModeType: () => 'HUNT' },
        arena: { currentMapDefinition: { mapUnits: [SWARM] } },
        renderer: {
            addToScene(object) { scene.add(object); },
            removeFromScene(object) { scene.delete(object); },
        },
    };
    const system = new MapUnitSystem(owner);
    return { owner, scene, system };
}

test('a swarm builds eight lightweight members around its path centre', () => {
    const { scene, system } = createHarness();
    assert.equal(system.startRound(), 1);
    const [swarm] = system.units;

    assert.equal(swarm.kind, 'swarm');
    assert.equal(swarm.members.length, 8);
    assert.equal(swarm.root.userData.swarm, true);
    assert.equal(swarm.root.children.length, 8);
    assert.equal(scene.size, 1, 'the swarm is one scene root');
    for (const member of swarm.members) {
        assert.equal(member.position.distanceTo(swarm.position) <= 5.001, true);
    }
});

test('swarm movement reuses member state and removes its visual on restart', () => {
    const { scene, system } = createHarness();
    system.startRound();
    const firstUnit = system.units[0];
    const memberArray = firstUnit.members;
    const positions = memberArray.map((member) => member.position);

    system.update(0.5);
    assert.equal(firstUnit.position.x, 9);
    assert.equal(firstUnit.position.y, 6, 'the authored air height is the swarm centre');
    for (let tick = 0; tick < 100; tick += 1) system.update(1 / 60);
    assert.equal(firstUnit.members, memberArray);
    assert.deepEqual(firstUnit.members.map((member) => member.position), positions);

    system.startRound();
    assert.equal(scene.size, 1, 'the previous root was removed before the new one was added');
    assert.notEqual(system.units[0], firstUnit);
    system.dispose();
    assert.equal(scene.size, 0);
});

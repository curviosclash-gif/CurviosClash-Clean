import assert from 'node:assert/strict';
import test from 'node:test';

import { LastRoundGhostSystem } from '../src/entities/LastRoundGhostSystem.js';

// three.js deletes a shader program when the last material using it is disposed. The killcam
// materials remain owned while the following replay renders, then are released when it clears.

function createRendererStub() {
    return { addToScene() {}, removeFromScene() {} };
}

function sceneFrame(time, x) {
    return {
        time,
        players: [{ idx: 0, alive: true, x, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }],
        projectiles: [{ id: 'rocket:1', type: 'ROCKET_MEDIUM', x: 2, y: 3, z: 4, vx: 0, vy: 0, vz: -10, radius: 0.4 }],
        powerups: [{ id: 'powerup:1', x: 5, y: 2, z: 6, visible: true }],
        turrets: [{ id: 'turret:1', weapon: 'mg', x: 9, y: 0, z: 2, ax: 1, ay: 0, az: 0 }],
    };
}

function playReplay(system) {
    assert.equal(system.playClip({
        routeId: 'route',
        sourceDuration: 1,
        displayDuration: 1,
        players: [{ idx: 0, color: 0x2299ff }],
        frames: [sceneFrame(0, 0), sceneFrame(1, 1)],
    }, { loop: false }), true);
    system.seekSourceTime(0.5);
    const materials = new Set();
    system.root.traverse((object) => { if (object.material) materials.add(object.material); });
    for (const entry of system._entries) {
        for (const material of entry.materials || []) materials.add(material);
        const trail = entry.trail;
        for (const material of [trail?.material, trail?.glowMaterial, trail?.headMaterial, trail?.glowHeadMaterial]) {
            if (material) materials.add(material);
        }
    }
    const disposed = new Set();
    for (const material of materials) material.addEventListener('dispose', () => disposed.add(material));
    return { materials, disposed };
}

test('a replay keeps its materials alive until the next replay has been cleared', () => {
    const system = new LastRoundGhostSystem(createRendererStub(), { presentationKind: 'killcam-replay' });
    const first = playReplay(system);
    assert.ok(first.materials.size >= 6, `trail, ghost and proxy materials expected (${first.materials.size})`);

    system.clear();
    assert.equal(first.disposed.size, 0, 'the end of a replay keeps its programs alive');
    system.clear();
    system.clear();
    assert.equal(first.disposed.size, 0, 'empty clears do not release the retained generation');

    const second = playReplay(system);
    assert.equal(first.disposed.size, 0, 'the next replay starts while the previous materials still hold the programs');

    system.clear();
    assert.equal(first.disposed.size, first.materials.size, 'the previous replay is released once the next one ended');
    assert.equal(second.disposed.size, 0);

    system.dispose();
    assert.equal(second.disposed.size, second.materials.size, 'disposing the system releases everything');
    assert.equal(system._retiredMaterials.length, 0);
    system.dispose();
    assert.equal(system._retiredMaterials.length, 0, 'repeated disposal retains nothing');
});

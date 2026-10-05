import assert from 'node:assert/strict';
import test from 'node:test';

import { ModularVehicleMesh } from '../src/shared/vehicle-lab/ModularVehicleMeshBridge.js';

/**
 * The game (PlayerView.updateVisuals) and the arcade hangar preview
 * (VehicleManagerPreview3d) drive vehicle meshes with tick(dt) only, like every
 * other runtime vehicle mesh that keeps its own clock. Only the Vehicle Lab passes
 * an explicit elapsed time. These parts mirror what hangar-built ships contain.
 */
function createAnimatedShip() {
    return new ModularVehicleMesh({
        parts: [
            { name: 'Helix Ring', geo: 'torus', rot: [0, 10, 0], anim: { type: 'rotate', axis: 'y', speed: 2 } },
            { name: 'Bobbing Pod', geo: 'box', pos: [0, 3, 0], anim: { type: 'bob', speed: 1, amount: 1 } },
            { name: 'Ion Flame', geo: 'flame', size: [0.2, 0.01, 1], anim: { type: 'pulse', speed: 6, amount: 0.4 } },
            { name: 'Shield Field', geo: 'forcefield' },
        ],
    });
}

function readAnimatedState(mesh) {
    const [ring, pod, flame, field] = mesh.children;
    return {
        ringRotationY: ring.rotation.y,
        podY: pod.position.y,
        flameScale: flame.scale.toArray(),
        fieldOpacity: field.material.opacity,
    };
}

test('a modular ship ticked with dt only keeps every animated part finite', () => {
    const mesh = createAnimatedShip();
    mesh.tick(0.016);
    mesh.tick(0.016);
    const state = readAnimatedState(mesh);

    assert.ok(Number.isFinite(state.ringRotationY), `helix ring rotation became ${state.ringRotationY}`);
    assert.ok(Number.isFinite(state.podY), `bobbing part height became ${state.podY}`);
    assert.ok(state.flameScale.every(Number.isFinite), `flame scale became ${state.flameScale}`);
    assert.ok(Number.isFinite(state.fieldOpacity), `force field opacity became ${state.fieldOpacity}`);
    mesh.dispose();
});

test('a modular ship ticked with dt only advances its own animation clock', () => {
    const mesh = createAnimatedShip();
    mesh.tick(0.25);
    const first = readAnimatedState(mesh).ringRotationY;
    mesh.tick(0.25);
    const second = readAnimatedState(mesh).ringRotationY;

    assert.notEqual(second, first, 'the helix ring keeps turning from frame to frame');
    assert.equal(
        Number(mesh.children[0].userData.vehicleLabAnimationState.rotationOffset[1].toFixed(8)),
        1,
        'two 0.25 s ticks at speed 2 rotate by 1 rad',
    );
    mesh.dispose();
});

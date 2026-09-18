import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyGuidedRocketCameras, ownsGuidedRocketCamera } from '../src/entities/runtime/GuidedRocketCameraOps.js';
import { updateEntityCameras } from '../src/entities/runtime/EntityCameraUpdateOps.js';

function camera() {
    return { position: new THREE.Vector3(), lookAt(target) { this.target = target.clone(); } };
}

function manager() {
    const cameras = [camera(), camera()];
    const owner = { index: 0, alive: true, isBot: false };
    const rocket = { guidedActive: true, owner,
        position: new THREE.Vector3(30, 12, 5), velocity: new THREE.Vector3(70, 0, 0) };
    return {
        players: [owner], _projectileSystem: { projectiles: [rocket] },
        _killcamSystem: { ownsCamera: () => false, applyCinematicCamera() {} },
        renderer: { cameras, getCameraMode: () => 'THIRD_PERSON' },
        _tmpCamRenderPos: new THREE.Vector3(), _tmpDir2: new THREE.Vector3(),
        _tmpVec2: new THREE.Vector3(), _tmpCamRenderQuat: new THREE.Quaternion(),
        _tmpCamAnchor: new THREE.Vector3(), _cameraContext: { playerState: {} },
    };
}

test('only the owning split-screen view follows the rocket', () => {
    const state = manager();
    assert.equal(ownsGuidedRocketCamera(state, 0), true);
    assert.equal(ownsGuidedRocketCamera(state, 1), false);
    assert.equal(applyGuidedRocketCameras(state, 1), 1);
    assert.ok(state.renderer.cameras[0].position.distanceToSquared(new THREE.Vector3()) > 1);
    assert.ok(state.renderer.cameras[0].target.x > 30);
    assert.deepEqual(state.renderer.cameras[1].position.toArray(), [0, 0, 0]);
});

test('killcam and dead pilots take precedence, and removal gives the camera back', () => {
    const state = manager();
    state._killcamSystem.ownsCamera = (index) => index === 0;
    assert.equal(ownsGuidedRocketCamera(state, 0), false);
    assert.equal(applyGuidedRocketCameras(state, 1), 0);
    state._killcamSystem.ownsCamera = () => false;
    state.players[0].alive = false;
    assert.equal(ownsGuidedRocketCamera(state, 0), false);
    state.players[0].alive = true;
    state._projectileSystem.projectiles.length = 0;
    assert.equal(ownsGuidedRocketCamera(state, 0), false);
    assert.equal(applyGuidedRocketCameras(state, 1), 0);
});

test('camera update pipeline applies rocket view after normal and cinematic updates', () => {
    const state = manager();
    let normalUpdates = 0;
    state.renderer.updateCamera = () => { normalUpdates += 1; };
    const projection = { players: [{ playerIndex: 0, alive: true,
        position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 },
        direction: { x: 1, y: 0, z: 0 } }] };
    updateEntityCameras(state, 0.1, 1, false, projection);
    assert.equal(normalUpdates, 0);
    assert.ok(state.renderer.cameras[0].target.x > 30);
    state._projectileSystem.projectiles.length = 0;
    updateEntityCameras(state, 0.1, 1, false, projection);
    assert.equal(normalUpdates, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCameraVisibilitySampler, checkCameraVisibility } from '../src/core/recording/MarketingCameraQuality.js';
import { createMarketingCamera } from '../src/core/recording/MarketingReplayRender.js';

test('visibility rejects an occluding wall, an offscreen subject and a distant subject', () => {
    const inspect = createCameraVisibilitySampler();
    const pose = { position: { x: 0, y: 0, z: 10 }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, fov: 60, far: 2000 };
    const players = [-1, 1].map((x, playerIndex) => ({ playerIndex, position: { x, y: 0, z: 0 }, modelScale: 1 }));
    const clear = inspect(pose, players, [0, 1], { raycast: () => ({ hit: false }) });
    assert.deepEqual(checkCameraVisibility([{ timeMs: 100, subjects: clear }], [100]), []);
    const wall = inspect(pose, players, [0, 1], { raycast: () => ({ hit: true }) });
    assert.ok(checkCameraVisibility([{ timeMs: 100, subjects: wall }], [100]).length);
    players[1].position.x = 500;
    assert.equal(inspect(pose, players, [0, 1])[1].visible, false);
    players[1].position = { x: 0, y: 0, z: -1800 };
    assert.equal(inspect(pose, players, [0, 1])[1].visible, false);
    assert.ok(checkCameraVisibility([{ timeMs: 100, subjects: clear }], [200]).length);
});

test('cinematic handoff matches the recorded camera pose at both ends of the following section', () => {
    const camera = createMarketingCamera(new THREE.PerspectiveCamera(), [0, 1], 1000, 28000);
    const recorded = { position: { x: 4, y: 6, z: 8 }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, fov: 67 };
    const projection = { recordedCamera: recorded,
        players: [0, 1].map((playerIndex) => ({ playerIndex, position: { x: playerIndex * 10, y: 0, z: 0 } })) };
    for (const progress of [0.35, 0.5, 0.7]) {
        const pose = camera(projection, 1000 + 28000 * progress);
        assert.deepEqual(pose.position, recorded.position);
        assert.deepEqual(pose.quaternion, recorded.quaternion);
        assert.equal(pose.fov, recorded.fov);
    }
});

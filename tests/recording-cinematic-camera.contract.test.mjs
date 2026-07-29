import test from 'node:test';
import assert from 'node:assert/strict';
import * as ThreeModule from 'three';

globalThis.THREE = ThreeModule;
const { RecordingOrbitCameraDirector } = await import(
    '../src/core/renderer/camera/RecordingOrbitCameraDirector.js'
);
const { CinematicCaptureSubjectSelector } = await import(
    '../src/core/renderer/RecordingCaptureProjectionOps.js'
);

test('cinematic camera keeps immutable base FOV when caller passes mutated frame FOV', () => {
    const director = new RecordingOrbitCameraDirector();
    const camera = {
        position: new ThreeModule.Vector3(0, 3, 8),
        fov: 60,
        lookAt() {},
        updateProjectionMatrix() {},
    };
    const playerPosition = new ThreeModule.Vector3(0, 0, 0);
    const playerDirection = new ThreeModule.Vector3(0, 0, -1);
    const fallbackTarget = { lookAt: new ThreeModule.Vector3(0, 0, -5) };

    for (let frame = 0; frame < 240; frame++) {
        director.apply({
            playerIndex: 0,
            camera,
            fallbackTarget,
            playerPosition,
            playerDirection,
            dt: 1 / 60,
            playerState: {
                hp: 100,
                maxHp: 100,
                score: 0,
                speed: frame < 60 ? 30 : 5,
                isBoosting: frame < 60,
            },
            // This reproduces the old caller bug. The director must ignore
            // the mutated value after the first frame.
            baseFov: camera.fov,
        });
        assert.ok(camera.fov >= 45 && camera.fov <= 85);
    }
    assert.ok(Math.abs(camera.fov - 60) < 0.5, `expected FOV near 60, got ${camera.fov}`);

    director.reset();
    camera.fov = 72;
    director.apply({
        playerIndex: 0,
        camera,
        fallbackTarget,
        playerPosition,
        playerDirection,
        dt: 1 / 60,
        baseFov: 72,
    });
    assert.ok(Math.abs(camera.fov - 72) < 0.5);
});

test('cinematic capture includes bots and follows recent combat activity', () => {
    const selector = new CinematicCaptureSubjectSelector();
    const human = {
        playerIndex: 0,
        isBot: false,
        alive: true,
        hp: 100,
        score: 0,
        isBoosting: false,
        position: { x: 0, y: 0, z: 0 },
    };
    const bot = {
        playerIndex: 1,
        isBot: true,
        alive: true,
        hp: 100,
        score: 0,
        isBoosting: false,
        position: { x: 4, y: 0, z: 0 },
    };

    assert.equal(selector.select([human, bot], 2, 1 / 60), human);
    bot.hp = 60;
    assert.equal(selector.select([human, bot], 2, 1 / 60), bot);
    assert.equal(selector.findNearest([human, bot], human, 2), bot);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as ThreeModule from 'three';

globalThis.THREE = ThreeModule;
const { RecordingOrbitCameraDirector } = await import(
    '../src/core/renderer/camera/RecordingOrbitCameraDirector.js'
);
const { CameraCollisionSolver } = await import(
    '../src/core/renderer/camera/CameraCollisionSolver.js'
);
const { CameraRigSystem } = await import('../src/core/renderer/CameraRigSystem.js');
const { RecordingCapturePipeline } = await import(
    '../src/core/renderer/RecordingCapturePipeline.js'
);
const { CinematicCameraSystem } = await import(
    '../src/entities/systems/CinematicCameraSystem.js'
);
const { CinematicCaptureSubjectSelector } = await import(
    '../src/core/renderer/RecordingCaptureProjectionOps.js'
);
const {
    findNearestLiveCameraOpponentPosition,
    findNearestProjectedCameraOpponentPosition,
} = await import('../src/entities/runtime/EntityCameraContext.js');
const { syncCinematicCaptureSubject } = await import(
    '../src/core/renderer/RecordingCaptureCameraUpdateOps.js'
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

test('camera collision solver blocks obstacles between subject and clear endpoint', () => {
    const solver = new CameraCollisionSolver();
    const origin = new ThreeModule.Vector3(0, 5, 0);
    const desired = new ThreeModule.Vector3(10, 5, 0);
    const arena = {
        checkCollision(position, radius = 0) {
            return position.x + radius >= 4 && position.x - radius <= 6;
        },
    };

    solver.resolve(0, 'recording-orbit-cinematic', origin, desired, arena);

    assert.ok(desired.x < 4, `expected camera before wall, got x=${desired.x}`);
    assert.ok(desired.x > origin.x);
});

test('invalid orbit shots return toward fallback and honor scalar arena bounds', () => {
    const director = new RecordingOrbitCameraDirector();
    const initialPosition = new ThreeModule.Vector3(25, 5, 25);
    const camera = {
        position: initialPosition.clone(),
        fov: 75,
        lookAt() {},
        updateProjectionMatrix() {},
    };
    const playerPosition = new ThreeModule.Vector3(0, 5, 0);
    const fallbackPosition = new ThreeModule.Vector3(0, 8, 10);

    assert.equal(director._isWithinArenaBounds(
        new ThreeModule.Vector3(0, 5, 0),
        { bounds: { minX: -10, maxX: 10, minY: 0, maxY: 10, minZ: -10, maxZ: 10 } }
    ), true);
    assert.equal(director._isWithinArenaBounds(
        new ThreeModule.Vector3(20, 5, 0),
        { bounds: { minX: -10, maxX: 10, minY: 0, maxY: 10, minZ: -10, maxZ: 10 } }
    ), false);

    director.apply({
        playerIndex: 0,
        camera,
        fallbackTarget: { position: fallbackPosition, lookAt: playerPosition },
        playerPosition,
        playerDirection: new ThreeModule.Vector3(0, 0, -1),
        dt: 1 / 60,
        arena: { checkCollision: () => true },
        baseFov: 75,
    });

    assert.ok(camera.position.distanceTo(initialPosition) > 0.1);
    assert.ok(camera.position.distanceTo(fallbackPosition) < initialPosition.distanceTo(fallbackPosition));
});

test('recording orbit camera preserves pose history and converges toward its shot', () => {
    const pipeline = new RecordingCapturePipeline({
        sourceCanvas: null,
        sourceRenderer: null,
        scene: null,
    });
    pipeline.setCameraPerspectiveSettings({
        normal: 'cinematic_soft',
        reduceMotion: false,
    });
    pipeline._ensureShortsCameraCount(1, 16 / 9);
    const player = {
        playerIndex: 0,
        alive: true,
        hp: 100,
        maxHp: 100,
        score: 0,
        speed: 18,
        isBoosting: false,
        position: { x: 0, y: 5, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        direction: { x: 0, y: 0, z: -1 },
    };

    for (let frame = 0; frame < 180; frame++) {
        pipeline._updateShortsCamera({
            slotIndex: 0,
            player,
            otherPlayer: null,
            renderDelta: 1 / 60,
            arena: null,
        });
    }

    const camera = pipeline._shortsCameraRig.cameras[0];
    const fallback = pipeline._shortsCameraRig.cameraTargets[0].position;
    const desired = pipeline._orbitDirector._tmpDesiredPosition;
    const fallbackDistance = fallback.distanceTo(desired);
    const progress = 1 - (camera.position.distanceTo(desired) / fallbackDistance);
    assert.ok(progress > 0.4, `expected accumulated orbit progress, got ${progress}`);
});

test('cinematic perspectives honor disabled speed FOV in live and capture cameras', () => {
    const playerPosition = new ThreeModule.Vector3(0, 5, 0);
    const playerDirection = new ThreeModule.Vector3(0, 0, -1);
    const playerQuaternion = new ThreeModule.Quaternion();
    const rig = new CameraRigSystem({ cinematicEnabled: true, livePerspectiveEnabled: true });
    rig.createCamera(16 / 9);
    rig.setCameraPerspectiveSettings({
        normal: 'cinematic_soft',
        reduceMotion: false,
        speedFovEnabled: false,
        speedFovIntensity: 0,
    });

    for (let frame = 0; frame < 120; frame++) {
        rig.setFrameTiming({ rawDt: 1 / 60, dt: 1 / 60 });
        rig.updateCamera(
            0,
            playerPosition,
            playerDirection,
            1 / 60,
            playerQuaternion,
            false,
            true,
            null,
            null,
            { playerState: { hp: 100, maxHp: 100, score: 0, speed: 40, isBoosting: true } }
        );
    }
    assert.equal(rig.cameras[0].fov, 75);

    const pipeline = new RecordingCapturePipeline({
        sourceCanvas: null,
        sourceRenderer: null,
        scene: null,
    });
    pipeline.setCameraPerspectiveSettings({
        normal: 'cinematic_action',
        reduceMotion: true,
        speedFovEnabled: false,
        speedFovIntensity: 0,
    });
    pipeline._ensureShortsCameraCount(1, 16 / 9);
    const projectedPlayer = {
        playerIndex: 0,
        alive: true,
        hp: 100,
        maxHp: 100,
        score: 0,
        speed: 40,
        isBoosting: true,
        position: { x: 0, y: 5, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        direction: { x: 0, y: 0, z: -1 },
    };
    for (let frame = 0; frame < 120; frame++) {
        pipeline._updateShortsCamera({
            slotIndex: 0,
            player: projectedPlayer,
            otherPlayer: null,
            renderDelta: 1 / 60,
            arena: null,
        });
    }
    assert.equal(pipeline._shortsCameraRig.cameras[0].fov, 75);

    pipeline.setCameraPerspectiveSettings({
        normal: 'cinematic_action',
        reduceMotion: false,
        speedFovEnabled: true,
        speedFovIntensity: 1,
    });
    for (let frame = 0; frame < 240; frame++) {
        pipeline._updateShortsCamera({
            slotIndex: 0,
            player: projectedPlayer,
            otherPlayer: null,
            renderDelta: 1 / 60,
            arena: null,
        });
    }
    const boostedCaptureFov = pipeline._shortsCameraRig.cameras[0].fov;
    assert.ok(boostedCaptureFov > 90);
    assert.ok(boostedCaptureFov <= 97.01, `expected bounded capture FOV, got ${boostedCaptureFov}`);
});

test('cinematic subject activity is cleared while a player waits to respawn', () => {
    const selector = new CinematicCaptureSubjectSelector();
    const player = {
        playerIndex: 0,
        alive: true,
        hp: 100,
        score: 0,
        isBoosting: false,
        position: { x: 0, y: 0, z: 0 },
    };
    const opponent = {
        playerIndex: 1,
        alive: true,
        hp: 100,
        score: 0,
        isBoosting: false,
        position: { x: 4, y: 0, z: 0 },
    };

    selector.select([player, opponent], 2, 1 / 60);
    opponent.hp = 50;
    assert.equal(selector.select([player, opponent], 2, 1 / 60), opponent);
    opponent.alive = false;
    for (let frame = 0; frame < 120; frame++) {
        selector.select([player, opponent], 1, 1 / 60);
    }
    opponent.alive = true;
    opponent.hp = 100;

    assert.equal(selector.activity[1], 0);
    assert.equal(selector.select([player, opponent], 2, 1 / 60), player);
});

test('cinematic camera supports every configured network player slot', () => {
    const cinematic = new CinematicCameraSystem({ enabled: true });
    for (const playerIndex of [8, 9]) {
        const target = {
            position: new ThreeModule.Vector3(),
            lookAt: new ThreeModule.Vector3(),
        };
        cinematic.apply({
            playerIndex,
            mode: 'THIRD_PERSON',
            target,
            playerDirection: new ThreeModule.Vector3(0, 0, -1),
            playerPosition: new ThreeModule.Vector3(),
            dt: 1 / 60,
            speed: 20,
        });
        assert.ok(cinematic.getPlayerBlend(playerIndex) > 0);
    }
});

test('third-person cameras resolve walls after cinematic offsets and smoothing', () => {
    for (const cockpitCamera of [false, true]) {
        const rig = new CameraRigSystem({ cinematicEnabled: true, livePerspectiveEnabled: true });
        rig.createCamera(16 / 9);
        rig.setCameraPerspectiveSettings({ normal: 'classic', reduceMotion: false });
        let collisionChecks = 0;
        const arena = {
            checkCollision(position, radius = 0) {
                collisionChecks++;
                return position.z + radius >= 4 && position.z - radius <= 6;
            },
        };

        rig.updateCamera(
            0,
            new ThreeModule.Vector3(0, 5, 0),
            new ThreeModule.Vector3(0, 0, -1),
            1 / 60,
            new ThreeModule.Quaternion(),
            cockpitCamera,
            false,
            arena,
            null,
            { playerState: { hp: 100, maxHp: 100, score: 0, speed: 18, isBoosting: false } }
        );

        assert.ok(collisionChecks > 0);
        assert.ok(
            rig.cameras[0].position.z < 4,
            `expected ${cockpitCamera ? 'cockpit' : 'standard'} camera before wall`
        );
    }
});

test('cinematic duel focus selects the nearest living human or bot', () => {
    const out = new ThreeModule.Vector3();
    const subject = { playerIndex: 0, alive: true, position: { x: 0, y: 5, z: 0 } };
    const farHuman = { playerIndex: 1, alive: true, position: { x: 100, y: 5, z: 0 } };
    const nearHuman = { playerIndex: 2, alive: true, position: { x: 2, y: 5, z: 0 } };
    const nearestBot = { playerIndex: 3, isBot: true, alive: true, position: { x: 1, y: 5, z: 0 } };

    assert.equal(
        findNearestProjectedCameraOpponentPosition(
            [subject, farHuman, nearHuman, nearestBot],
            subject,
            out
        ),
        out
    );
    assert.deepEqual(out.toArray(), [1, 5, 0]);

    const liveSubject = { alive: true };
    const deadOpponent = { alive: false, position: { x: 0.5, y: 5, z: 0 } };
    assert.equal(
        findNearestLiveCameraOpponentPosition(
            [liveSubject, farHuman, nearestBot, deadOpponent],
            liveSubject,
            new ThreeModule.Vector3(0, 5, 0),
            1,
            out
        ),
        out
    );
    assert.deepEqual(out.toArray(), [1, 5, 0]);
});

test('cinematic orbit snaps to the safe fallback after a respawn-sized teleport', () => {
    const rig = new CameraRigSystem({ cinematicEnabled: true, livePerspectiveEnabled: true });
    rig.createCamera(16 / 9);
    rig.setCameraPerspectiveSettings({ normal: 'cinematic_soft', reduceMotion: false });
    const position = new ThreeModule.Vector3(0, 5, 0);
    const direction = new ThreeModule.Vector3(0, 0, -1);
    const quaternion = new ThreeModule.Quaternion();
    const cameraContext = {
        playerState: { hp: 100, maxHp: 100, score: 0, speed: 18, isBoosting: false },
        otherPlayerPosition: null,
    };

    for (let frame = 0; frame < 180; frame++) {
        rig.setFrameTiming({ rawDt: 1 / 60, dt: 1 / 60 });
        rig.updateCamera(
            0, position, direction, 1 / 60, quaternion, false, false, null, null, cameraContext
        );
    }
    position.set(80, 5, 0);
    rig.setFrameTiming({ rawDt: 1 / 60, dt: 1 / 60 });
    rig.updateCamera(
        0, position, direction, 1 / 60, quaternion, false, false, null, null, cameraContext
    );

    assert.ok(
        rig.cameras[0].position.distanceTo(position) < 14,
        `expected camera at respawn fallback, got ${rig.cameras[0].position.distanceTo(position)}`
    );
});

test('cinematic orbit honors explicit discontinuities below the distance threshold', () => {
    const director = new RecordingOrbitCameraDirector();
    const camera = new ThreeModule.PerspectiveCamera(75, 16 / 9, 0.1, 200);
    const playerPosition = new ThreeModule.Vector3(0, 5, 0);
    const playerDirection = new ThreeModule.Vector3(0, 0, -1);
    const fallbackTarget = {
        position: new ThreeModule.Vector3(0, 10, 9),
        lookAt: playerPosition,
    };

    for (let frame = 0; frame < 180; frame++) {
        director.apply({
            playerIndex: 0,
            camera,
            fallbackTarget,
            playerPosition,
            playerDirection,
            dt: 1 / 60,
            baseFov: 75,
            discontinuityVersion: 0,
        });
    }

    playerPosition.x = 10;
    fallbackTarget.position.x = 10;
    director.apply({
        playerIndex: 0,
        camera,
        fallbackTarget,
        playerPosition,
        playerDirection,
        dt: 1 / 60,
        baseFov: 75,
        discontinuityVersion: 1,
    });

    assert.ok(camera.position.distanceTo(fallbackTarget.position) < 0.5);
    assert.ok(director._phaseByPlayer[0] < 0.1);
});

test('capture perspective and subject switches discard inactive cinematic events', () => {
    const pipeline = new RecordingCapturePipeline({
        sourceCanvas: null,
        sourceRenderer: null,
        scene: null,
    });
    pipeline._ensureShortsCameraCount(1, 16 / 9);
    const player = {
        playerIndex: 0,
        alive: true,
        hp: 100,
        maxHp: 100,
        score: 0,
        speed: 10,
        isBoosting: false,
        position: { x: 0, y: 5, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        direction: { x: 0, y: 0, z: -1 },
    };

    pipeline.setCameraPerspectiveSettings({ normal: 'cinematic_soft', reduceMotion: false });
    pipeline._updateShortsCamera({
        slotIndex: 0, player, otherPlayer: null, renderDelta: 1 / 60, arena: null,
    });
    pipeline.setCameraPerspectiveSettings({ normal: 'classic', reduceMotion: false });
    player.hp = 10;
    pipeline._updateShortsCamera({
        slotIndex: 0, player, otherPlayer: null, renderDelta: 1 / 60, arena: null,
    });
    pipeline.setCameraPerspectiveSettings({ normal: 'cinematic_soft', reduceMotion: false });
    pipeline._updateShortsCamera({
        slotIndex: 0, player, otherPlayer: null, renderDelta: 1 / 60, arena: null,
    });
    assert.equal(pipeline._orbitDirector._eventOverrideTimer[0] || 0, 0);
    assert.equal(pipeline._orbitDirector._shakeIntensity[0] || 0, 0);

    syncCinematicCaptureSubject(pipeline, { playerIndex: 0 });
    pipeline._cinematicOrbitDirector._eventOverrideTimer[0] = 1.8;
    pipeline._cinematicOrbitDirector._shakeIntensity[0] = 0.8;
    pipeline._cinematicOrbitPoseReady = true;
    syncCinematicCaptureSubject(pipeline, { playerIndex: 1 });
    assert.equal(pipeline._cinematicOrbitPoseReady, false);
    pipeline._cinematicOrbitPoseReady = true;
    syncCinematicCaptureSubject(pipeline, { playerIndex: 0 });
    assert.equal(pipeline._cinematicOrbitPoseReady, false);
    assert.equal(pipeline._cinematicOrbitDirector._eventOverrideTimer[0], undefined);
    assert.equal(pipeline._cinematicOrbitDirector._shakeIntensity[0], undefined);
});

test('cockpit top-down keeps the subject centered independently of vehicle attitude', () => {
    const rig = new CameraRigSystem({ cinematicEnabled: true, livePerspectiveEnabled: true });
    rig.createCamera(16 / 9);
    rig.cameraModes[0] = 2;
    const position = new ThreeModule.Vector3(3, 5, -2);
    const direction = new ThreeModule.Vector3(0, 0, -1);
    const quaternion = new ThreeModule.Quaternion().setFromEuler(
        new ThreeModule.Euler(Math.PI * 0.45, Math.PI * 0.6, Math.PI * 0.35)
    );

    rig.setFrameTiming({ rawDt: 1 / 60, dt: 1 / 60 });
    rig.updateCamera(0, position, direction, 1 / 60, quaternion, true);

    const camera = rig.cameras[0];
    const forward = new ThreeModule.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const towardSubject = position.clone().sub(camera.position).normalize();
    assert.ok(forward.dot(towardSubject) > 0.9999);
    assert.ok(camera.position.y > position.y + 35);
});

test('cockpit third-person snaps on initialization and render discontinuities', () => {
    const rig = new CameraRigSystem({ cinematicEnabled: true, livePerspectiveEnabled: true });
    rig.createCamera(16 / 9);
    const position = new ThreeModule.Vector3(0, 5, 0);
    const direction = new ThreeModule.Vector3(0, 0, -1);
    const quaternion = new ThreeModule.Quaternion();
    const cameraContext = {
        discontinuityVersion: 0,
        playerState: { hp: 100, maxHp: 100, score: 0, speed: 18, isBoosting: false },
    };

    rig.setFrameTiming({ rawDt: 1 / 60, dt: 1 / 60 });
    rig.updateCamera(0, position, direction, 1 / 60, quaternion, true, false, null, null, cameraContext);
    assert.ok(rig.cameras[0].position.distanceTo(rig.cameraTargets[0].position) < 0.0001);

    position.x = 10;
    cameraContext.discontinuityVersion++;
    rig.setFrameTiming({ rawDt: 1 / 60, dt: 1 / 60 });
    rig.updateCamera(0, position, direction, 1 / 60, quaternion, true, false, null, null, cameraContext);
    assert.ok(rig.cameras[0].position.distanceTo(rig.cameraTargets[0].position) < 0.0001);
});

test('shorts capture camera advances by wall time at 30, 60 and 120 FPS', () => {
    const elapsedByFps = [];
    const xByFps = [];
    for (const fps of [30, 60, 120]) {
        const pipeline = new RecordingCapturePipeline({
            sourceCanvas: null,
            sourceRenderer: null,
            scene: null,
        });
        pipeline._ensureShortsCameraCount(1, 16 / 9);
        const player = {
            playerIndex: 0,
            alive: true,
            hp: 100,
            maxHp: 100,
            score: 0,
            speed: 18,
            isBoosting: false,
            position: { x: 0, y: 5, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
            direction: { x: 0, y: 0, z: -1 },
        };
        for (let frame = 0; frame < fps; frame++) {
            pipeline._updateShortsCamera({
                slotIndex: 0,
                player,
                otherPlayer: null,
                renderDelta: 1 / fps,
                arena: null,
            });
        }
        elapsedByFps.push(pipeline._shortsCameraRig.cinematicCameraSystem._timeByPlayer[0]);
        xByFps.push(pipeline._shortsCameraRig.cameras[0].position.x);
    }

    for (const elapsed of elapsedByFps) assert.ok(Math.abs(elapsed - 1) < 0.0001);
    assert.ok(Math.max(...xByFps) - Math.min(...xByFps) < 0.0001);
});

test('classic shorts camera reuses player state for speed FOV and cinematic sway', () => {
    const pipeline = new RecordingCapturePipeline({
        sourceCanvas: null,
        sourceRenderer: null,
        scene: null,
    });
    pipeline.setCameraPerspectiveSettings({
        normal: 'classic',
        reduceMotion: false,
        speedFovEnabled: true,
        speedFovIntensity: 1,
    });
    pipeline._ensureShortsCameraCount(1, 16 / 9);
    const player = {
        playerIndex: 0,
        alive: true,
        hp: 100,
        maxHp: 100,
        score: 0,
        speed: 40,
        isBoosting: true,
        renderDiscontinuityVersion: 3,
        position: { x: 0, y: 5, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        direction: { x: 0, y: 0, z: -1 },
    };

    pipeline._updateShortsCamera({
        slotIndex: 0,
        player,
        otherPlayer: null,
        renderDelta: 1 / 60,
        arena: null,
    });
    const cameraContext = pipeline._shortsCameraContexts[0];
    for (let frame = 1; frame < 120; frame++) {
        pipeline._updateShortsCamera({
            slotIndex: 0,
            player,
            otherPlayer: null,
            renderDelta: 1 / 60,
            arena: null,
        });
    }

    assert.equal(pipeline._shortsCameraContexts[0], cameraContext);
    assert.equal(cameraContext.playerState.speed, 40);
    assert.equal(cameraContext.discontinuityVersion, 3);
    assert.ok(pipeline._shortsCameraRig.cameras[0].fov > 75);
    assert.ok(pipeline._shortsCameraRig.cameraSpeedFovOffsets[0] > 0);
});

test('standard network recording uses the rendered local player for its single HUD segment', () => {
    const pipeline = new RecordingCapturePipeline({
        sourceCanvas: { width: 640, height: 360 },
        sourceRenderer: null,
        scene: null,
    });
    pipeline._captureCanvas = { width: 640, height: 360 };
    pipeline._captureCtx = {
        clearRect() {},
        drawImage() {},
    };
    pipeline._ensureCaptureCanvas = () => pipeline._captureCanvas;
    pipeline._prepareStandardSurface({
        renderProjection: {
            localPlayerIndex: 8,
            players: Array.from({ length: 10 }, (_value, playerIndex) => ({
                playerIndex,
                isBot: false,
                speed: 10 + playerIndex,
            })),
        },
        splitScreen: false,
    });

    assert.equal(pipeline.getLastMeta().segments[0].playerIndex, 8);
    assert.equal(pipeline.getLastMeta().segments[0].label, 'P9');
});

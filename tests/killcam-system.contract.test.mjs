import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { EntityManager } from '../src/entities/EntityManager.js';
import { ParticleSystem } from '../src/entities/Particles.js';
import { KillcamSystem } from '../src/hunt/KillcamSystem.js';

function createKillcamFixture({
    humanRemaining = 2.55,
    remainingByPlayer = { 0: 2.55 },
    reduceMotion = false,
    arena = null,
    pixelReplayBuffer = null,
} = {}) {
    const playbackCalls = [];
    const seekCalls = [];
    const clipRequests = [];
    const explosionCalls = [];
    const directionalCalls = [];
    const shakeCalls = [];
    let replaySourceTime = 0;
    const cameraTargets = [];
    const camera = {
        fov: 75,
        position: new THREE.Vector3(0, 4, 12),
        lookAt(target) { cameraTargets.push(target.clone()); },
        updateProjectionMatrix() {},
    };
    const player = {
        index: 0,
        isBot: false,
        alive: false,
        color: 0xffffff,
        position: new THREE.Vector3(3, 2, 1),
        quaternion: new THREE.Quaternion(),
        view: { group: { visible: false } },
        trail: {},
    };
    const killer = {
        index: 1,
        isBot: true,
        alive: true,
        position: new THREE.Vector3(5, 2, 1),
        view: { group: { visible: true } },
        trail: {},
    };
    const clip = {
        sourceDuration: 1,
        displayDuration: 2.5,
        players: [{ idx: 0 }, { idx: 1 }],
        frames: [
            { time: 0, players: [{ idx: 0 }, { idx: 1, x: 0, y: 0, z: 0, qw: 1 }] },
            { time: 1, players: [{ idx: 0 }, { idx: 1, x: 5, y: 2, z: 1, qw: 1 }] },
        ],
    };
    const entityManager = {
        humanPlayers: [player],
        players: [player, killer],
        particles: {
            _suppressed: false,
            clear() {},
            setPresentationSuppressed(value) { this._suppressed = value === true; },
            isPresentationSuppressed() { return this._suppressed; },
            spawnExplosion(...args) { explosionCalls.push(args); },
            spawnDirectional(...args) { directionalCalls.push(args); },
        },
        audio: { play() {} },
        projectiles: [],
        arena,
        playKillcamReplay(nextClip, options) {
            playbackCalls.push({ clip: nextClip, options });
            return true;
        },
        clearKillcamReplay() {},
    };
    const replaySystem = {
        seekSourceTime(sourceTime) {
            seekCalls.push(sourceTime);
            replaySourceTime = sourceTime;
            return true;
        },
        copyPlayerPose(playerIdx, positionOut, quaternionOut) {
            if (playerIdx === player.index) {
                positionOut.set(3, 2, 11 - replaySourceTime * 10);
                quaternionOut.identity();
                return true;
            }
            if (playerIdx !== killer.index) return false;
            positionOut.set(0, 2, 6 - replaySourceTime * 5);
            quaternionOut.identity();
            return true;
        },
    };
    const killcam = new KillcamSystem({
        renderer: {
            cameras: [camera],
            getCameraPerspectiveSettings: () => ({ reduceMotion }),
            triggerCameraShake(...args) { shakeCalls.push(args); },
            resolveCameraCollision(_playerIndex, _mode, _origin, desiredPosition, collisionArena) {
                collisionArena?.checkCollision?.(desiredPosition, 0.45);
            },
        },
        entityManager,
        recorder: {
            getKillcamReplayClip(_entityManager, options) {
                clipRequests.push(options);
                return clip;
            },
        },
        respawnSystem: {
            isEnabled: () => true,
            isRespawnPending: () => true,
            getRemainingForPlayer: () => humanRemaining,
            getRemainingByPlayer: () => remainingByPlayer,
        },
        replaySystem,
        pixelReplayBuffer,
    });
    return {
        camera,
        cameraTargets,
        clipRequests,
        directionalCalls,
        entityManager,
        explosionCalls,
        replaySystem,
        killcam,
        killer,
        player,
        playbackCalls,
        seekCalls,
        shakeCalls,
    };
}

test('killcam keeps scene replay aligned with its source-time camera pose', () => {
    const {
        camera,
        cameraTargets,
        clipRequests,
        directionalCalls,
        explosionCalls,
        killcam,
        killer,
        player,
        playbackCalls,
        seekCalls,
        shakeCalls,
    } = createKillcamFixture();
    assert.equal(killcam.onPlayerDied(player, { killer }), true);
    assert.equal(playbackCalls[0]?.options?.loop, false);
    assert.equal(playbackCalls[0]?.options?.useLivePlayerViews, true);
    assert.equal(playbackCalls[0]?.options?.terminalDeathPlayerIndex, player.index);
    assert.equal(clipRequests[0]?.maxSourceDuration, 2);
    assert.equal(clipRequests[0]?.displayDuration, 2.5);
    assert.equal(killcam._focusPoint.z, 11);
    killcam.applyCinematicCamera(1 / 60);
    const initialCameraPosition = camera.position.clone();
    assert.ok(camera.position.distanceTo(killcam._focusPoint) > 5);
    assert.ok(cameraTargets.at(-1)?.z < killcam._focusPoint.z);

    killcam.advanceReplayPlayback(0.1);
    assert.ok(killcam._focusPoint.z > player.position.z);
    killcam.applyCinematicCamera(1 / 60);
    assert.ok(camera.position.z < initialCameraPosition.z);

    while (killcam._elapsed < killcam._displayDuration * 0.86) {
        const dt = 0.005;
        const scaledDt = dt * killcam.getTimeScale();
        killcam.advanceReplayPlayback(scaledDt);
        killcam.update(dt);
    }

    assert.ok(Math.abs(killcam._replayElapsed - killcam._replaySourceDuration) < 0.01);
    assert.ok(Math.abs(seekCalls.at(-1) - killcam._replaySourceDuration) < 0.01);
    assert.ok(Math.abs(killcam._focusPoint.z - player.position.z) < 0.01);
    assert.equal(explosionCalls.length, 1);
    assert.equal(directionalCalls.length, 1);
    assert.deepEqual(shakeCalls, [[0, 0.32, 0.24]]);
    assert.equal(killcam._hasDeadPlayerPose, true);
    killcam.update(killcam._displayDuration * 0.1);
    assert.equal(explosionCalls.length, 1);
    killcam.dispose();
});

test('pixel killcam records the live death frame before starting lossless playback', async () => {
    const calls = [];
    const terminalFrame = { time: 2000, width: 8, height: 4 };
    const pixelReplayBuffer = {
        canReplay: () => true,
        captureFrame: async (options) => {
            calls.push(['capture', options]);
            return terminalFrame;
        },
        beginPlayback: async (options) => {
            calls.push(['begin', options]);
            return { sourceDuration: 2, frameCount: 60, width: 8, height: 4 };
        },
        seekSourceTime: (time) => calls.push(['seek', time]),
        clearPlayback: () => calls.push(['clear']),
        getState: () => ({ supported: true, playbackFrameCount: 60 }),
        dispose() {},
    };
    const { killcam, player } = createKillcamFixture({ pixelReplayBuffer });

    assert.equal(killcam.onPlayerDied(player), true);
    assert.equal(killcam.isActive(), false);
    assert.equal(killcam.shouldSuppressLiveDeathEffects(), false);
    await killcam.captureRenderedFrame();

    assert.equal(killcam.isActive(), true);
    assert.equal(killcam.getPixelReplayState().active, true);
    assert.equal(calls[0]?.[0], 'capture');
    assert.equal(calls[0]?.[1]?.force, true);
    assert.equal(calls[1]?.[0], 'begin');

    killcam.advanceReplayPlayback(0.5);
    assert.deepEqual(calls.at(-1), ['seek', 0.4]);
    killcam.dispose();
});

test('killcam requests full scene replay with all live vehicle views', () => {
    let playbackOptions = null;
    const { killcam, entityManager, player } = createKillcamFixture();
    entityManager.playKillcamReplay = (_clip, options) => {
        playbackOptions = options;
        return true;
    };

    assert.equal(killcam.onPlayerDied(player), true);
    assert.equal(playbackOptions?.useLivePlayerViews, true);
    assert.equal(playbackOptions?.livePlayers, entityManager.players);
    assert.equal(playbackOptions?.loop, false);
    assert.equal(playbackOptions?.terminalDeathPlayerIndex, player.index);
    killcam.dispose();
});

test('EntityManager suppresses immediate death effects when a killcam starts', () => {
    let particleExplosions = 0;
    let explosionSounds = 0;
    let capturedSnapshots = 0;
    const player = {
        index: 0,
        isBot: false,
        alive: true,
        color: 0xffffff,
        position: new THREE.Vector3(1, 2, 3),
        kill() { this.alive = false; },
    };
    const owner = {
        players: [player],
        gameModeStrategy: { hasScoring: () => false },
        isFightOutcomeAuthority: true,
        _parcoursProgressSystem: null,
        _projectileSystem: { clearRocketTrailsForOwner() {} },
        _respawnSystem: { onPlayerDied() {} },
        _killcamSystem: { onPlayerDied: () => true },
        particles: { spawnExplosion: () => { particleExplosions += 1; } },
        audio: { play: () => { explosionSounds += 1; } },
        recorder: {
            captureSnapshotNow() { capturedSnapshots += 1; },
            markPlayerDeath() {},
            logEvent() {},
        },
        _eventBus: { emitPlayerDied() {} },
        onArcadeGameplayEvent: null,
    };

    EntityManager.prototype._killPlayer.call(owner, player, 'WALL');
    assert.equal(particleExplosions, 0);
    assert.equal(explosionSounds, 0);
    assert.equal(capturedSnapshots, 2);
});

test('pending pixel killcam preserves the live terminal explosion for framebuffer capture', () => {
    let particleExplosions = 0;
    let explosionSounds = 0;
    const player = {
        index: 0,
        isBot: false,
        alive: true,
        color: 0x44aaff,
        position: new THREE.Vector3(1, 2, 3),
        kill() { this.alive = false; },
    };
    const owner = {
        players: [player],
        gameModeStrategy: { hasScoring: () => false },
        isFightOutcomeAuthority: true,
        _parcoursProgressSystem: null,
        _projectileSystem: { clearRocketTrailsForOwner() {} },
        _respawnSystem: { onPlayerDied() {} },
        _killcamSystem: {
            onPlayerDied: () => true,
            shouldSuppressLiveDeathEffects: () => false,
        },
        particles: { spawnExplosion: () => { particleExplosions++; } },
        audio: { play: () => { explosionSounds++; } },
        recorder: {
            captureSnapshotNow() {},
            markPlayerDeath() {},
            logEvent() {},
        },
        _eventBus: { emitPlayerDied() {} },
        onArcadeGameplayEvent: null,
    };

    EntityManager.prototype._killPlayer.call(owner, player, 'WALL');
    assert.equal(particleExplosions, 1);
    assert.equal(explosionSounds, 1);
});

test('killcam stays disabled for network sessions', () => {
    const { killcam, killer, player, playbackCalls } = createKillcamFixture();
    killcam.entityManager.runtimeConfig = { session: { networkEnabled: true } };

    assert.equal(killcam.onPlayerDied(player, { killer }), false);
    assert.equal(playbackCalls.length, 0);
});

test('killcam triggers death effects at the world origin', () => {
    const { killcam } = createKillcamFixture();
    let particleExplosions = 0;
    let explosionSounds = 0;
    killcam.entityManager.particles.spawnExplosion = () => { particleExplosions += 1; };
    killcam.entityManager.audio.play = () => { explosionSounds += 1; };
    killcam._deadPlayerIndex = 0;
    killcam._focusPoint.set(0, 0, 0);

    killcam._triggerDeathExplosion();

    assert.equal(particleExplosions, 1);
    assert.equal(explosionSounds, 1);
});

test('bot deaths do not interrupt an active human killcam', () => {
    const { killcam, killer, player } = createKillcamFixture();
    assert.equal(killcam.onPlayerDied(player, { killer }), true);

    assert.equal(killcam.onPlayerDied(killer, { killer: player }), false);
    assert.equal(killcam.isActive(), true);
    killcam.dispose();
});

test('killcam duration uses only the displayed player respawn timer', () => {
    const { killcam, killer, player } = createKillcamFixture({
        humanRemaining: 1.05,
        remainingByPlayer: { 0: 1.05, 1: 2.55 },
    });

    assert.equal(killcam.onPlayerDied(player, { killer }), true);
    assert.ok(Math.abs(killcam._displayDuration - 1) < 0.001);
    killcam.dispose();
});

test('killcam restores exact live visibility and keeps newly visible objects hidden', () => {
    const { entityManager, killcam, killer, player } = createKillcamFixture();
    const projectileMesh = { visible: true };
    entityManager.projectiles.push({ mesh: projectileMesh });

    assert.equal(killcam.onPlayerDied(player, { killer }), true);
    assert.equal(killer.view.group.visible, false);
    assert.equal(projectileMesh.visible, false);
    assert.equal(entityManager.particles.isPresentationSuppressed(), true);

    killer.view.group.visible = true;
    killcam.update(0.01);
    assert.equal(killer.view.group.visible, false);

    killcam.clear();
    assert.equal(player.view.group.visible, false);
    assert.equal(killer.view.group.visible, true);
    assert.equal(projectileMesh.visible, true);
    assert.equal(entityManager.particles.isPresentationSuppressed(), false);
});

test('reduced-motion killcam uses a stable collision-checked camera', () => {
    let collisionChecks = 0;
    const { camera, killcam, killer, player } = createKillcamFixture({
        reduceMotion: true,
    });
    killcam.renderer.resolveCameraCollision = (_playerIndex, mode, origin, desiredPosition) => {
        collisionChecks += 1;
        if (mode === 'killcam-reduced-motion') desiredPosition.copy(origin);
    };
    assert.equal(killcam.onPlayerDied(player, { killer }), true);
    killcam.applyCinematicCamera(1 / 60);

    assert.equal(killcam._reduceMotion, true);
    assert.equal(camera.fov, 75);
    assert.ok(camera.position.distanceTo(killcam._focusPoint) > 8);
    assert.equal(collisionChecks, 2);
    killcam.dispose();
});

test('killcam suppresses gameplay HUD only while replay presentation is active', () => {
    const previousDocument = globalThis.document;
    const hudClasses = new Set();
    const overlayClasses = new Set(['killcam-letterbox', 'hidden']);
    const createClassList = (classes) => ({
        toggle(name, force) {
            if (force) classes.add(name);
            else classes.delete(name);
        },
    });
    const hud = { classList: createClassList(hudClasses) };
    const overlay = {
        classList: createClassList(overlayClasses),
        setAttribute() {},
    };
    globalThis.document = {
        body: {},
        getElementById(id) {
            if (id === 'hud') return hud;
            if (id === 'killcam-letterbox') return overlay;
            return null;
        },
    };

    try {
        const { killcam, player } = createKillcamFixture();
        assert.equal(killcam.onPlayerDied(player), true);
        assert.equal(hudClasses.has('killcam-active'), true);
        assert.equal(overlayClasses.has('hidden'), false);

        killcam.clear();
        assert.equal(hudClasses.has('killcam-active'), false);
        assert.equal(overlayClasses.has('hidden'), true);
        killcam.dispose();
    } finally {
        globalThis.document = previousDocument;
    }
});

test('EntityManager owns killcam playback and camera updates behind public seams', () => {
    const calls = [];
    const manager = Object.assign(Object.create(EntityManager.prototype), {
        _killcamSystem: {
            isActive: () => true,
            getTimeScale: () => 0.5,
            advanceReplayPlayback: (dt) => calls.push(['replay', dt]),
            update: (dt) => calls.push(['update', dt]),
            applyCinematicCamera: (dt) => calls.push(['camera', dt]),
        },
        _lastRoundGhostSystem: { update: () => calls.push(['legacy']) },
        renderer: { cameras: [] },
        players: [],
        humanPlayers: [],
    });

    manager.updateLastRoundGhostPlayback(0.2);
    manager.updateCameras(0.1);

    assert.deepEqual(calls, [
        ['replay', 0.1],
        ['update', 0.2],
        ['camera', 0.1],
    ]);
});

test('EntityManager render interpolation does not overwrite live vehicle killcam poses', () => {
    const replayGroup = {};
    const calls = [];
    const manager = Object.assign(Object.create(EntityManager.prototype), {
        _killcamSystem: { isActive: () => true },
        _killcamReplaySystem: {
            usesReplayPresentationObject: (object) => object === replayGroup,
        },
        players: [
            {
                alive: false,
                view: {
                    group: replayGroup,
                    applyRenderTransform: () => calls.push('replay-transform'),
                    updateVisuals: () => calls.push('replay-visuals'),
                },
            },
            {
                alive: true,
                view: {
                    group: {},
                    applyRenderTransform: () => calls.push('live-transform'),
                    updateVisuals: () => calls.push('live-visuals'),
                },
            },
        ],
    });

    manager.renderInterpolatedTransforms(0.5, 1 / 60);

    assert.deepEqual(calls, ['live-transform', 'live-visuals']);
});

test('particle presentation suppression admits only the authored killcam effect', () => {
    const particles = new ParticleSystem({
        addToScene() {},
        removeFromScene() {},
        getGraphicsStyle: () => 'classic',
    });
    const origin = new THREE.Vector3();

    particles.setPresentationSuppressed(true);
    particles.spawnExplosion(origin, 0xffffff);
    assert.equal(particles.count, 0);

    particles.spawnExplosion(origin, 0xffffff, { presentationOverride: true });
    assert.equal(particles.count, 30);
    particles.dispose();
});

test('inactive killcam disposal does not create a letterbox DOM resource', () => {
    const previousDocument = globalThis.document;
    let createdElements = 0;
    globalThis.document = {
        body: {},
        createElement() {
            createdElements += 1;
            return {};
        },
        getElementById() {
            return null;
        },
    };
    try {
        const killcam = new KillcamSystem();
        killcam.dispose();
        assert.equal(createdElements, 0);
    } finally {
        globalThis.document = previousDocument;
    }
});

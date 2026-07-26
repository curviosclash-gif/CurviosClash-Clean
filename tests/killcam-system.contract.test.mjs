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
} = {}) {
    const playbackCalls = [];
    const seekCalls = [];
    const camera = {
        fov: 75,
        position: new THREE.Vector3(0, 4, 12),
        lookAt() {},
        updateProjectionMatrix() {},
    };
    const player = {
        index: 0,
        isBot: false,
        alive: false,
        color: 0xffffff,
        position: new THREE.Vector3(3, 2, 1),
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
            spawnExplosion() {},
        },
        audio: { play() {} },
        projectiles: [],
        arena,
        playLastRoundGhost(nextClip, options) {
            playbackCalls.push({ clip: nextClip, options });
            return true;
        },
        clearLastRoundGhost() {},
    };
    const ghostSystem = {
        seekSourceTime(sourceTime) {
            seekCalls.push(sourceTime);
            return true;
        },
        copyPlayerPose(playerIdx, positionOut, quaternionOut) {
            if (playerIdx !== killer.index) return false;
            positionOut.set(0, 0, 0);
            quaternionOut.identity();
            return true;
        },
    };
    const killcam = new KillcamSystem({
        renderer: {
            cameras: [camera],
            getCameraPerspectiveSettings: () => ({ reduceMotion }),
            resolveCameraCollision(_playerIndex, _mode, _origin, desiredPosition, collisionArena) {
                collisionArena?.checkCollision?.(desiredPosition, 0.45);
            },
        },
        entityManager,
        recorder: { getLastRoundGhostClip: () => clip },
        respawnSystem: {
            isEnabled: () => true,
            isRespawnPending: () => true,
            getRemainingForPlayer: () => humanRemaining,
            getRemainingByPlayer: () => remainingByPlayer,
        },
        ghostSystem,
    });
    return { camera, entityManager, ghostSystem, killcam, killer, player, playbackCalls, seekCalls };
}

test('killcam keeps visible ghost playback aligned with its source-time camera pose', () => {
    const { killcam, killer, player, playbackCalls, seekCalls } = createKillcamFixture();
    assert.equal(killcam.onPlayerDied(player, { killer }), true);
    assert.equal(playbackCalls[0]?.options?.loop, false);
    assert.equal(playbackCalls[0]?.options?.useLivePlayerViews, true);

    while (killcam._elapsed < killcam._displayDuration * 0.86) {
        const dt = 0.005;
        const scaledDt = dt * killcam.getTimeScale();
        killcam.advanceGhostPlayback(scaledDt);
        killcam.update(dt);
    }

    assert.ok(Math.abs(killcam._ghostElapsed - killcam._ghostSourceDuration) < 0.01);
    assert.ok(Math.abs(seekCalls.at(-1) - killcam._ghostSourceDuration) < 0.01);
    assert.equal(killcam._hasKillerPose, true);
    killcam.dispose();
});

test('killcam requests real live vehicle views instead of ghost bodies', () => {
    let playbackOptions = null;
    const { killcam, entityManager, player } = createKillcamFixture();
    entityManager.playLastRoundGhost = (_clip, options) => {
        playbackOptions = options;
        return true;
    };

    assert.equal(killcam.onPlayerDied(player), true);
    assert.equal(playbackOptions?.useLivePlayerViews, true);
    assert.equal(playbackOptions?.livePlayers, entityManager.players);
    assert.equal(playbackOptions?.loop, false);
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
    const arena = {
        checkCollision() {
            collisionChecks += 1;
            return false;
        },
    };
    const { camera, killcam, killer, player } = createKillcamFixture({
        reduceMotion: true,
        arena,
    });
    assert.equal(killcam.onPlayerDied(player, { killer }), true);
    killcam.applyCinematicCamera(1 / 60);

    assert.equal(killcam._reduceMotion, true);
    assert.equal(camera.fov, 75);
    assert.ok(collisionChecks > 0);
    killcam.dispose();
});

test('EntityManager owns killcam playback and camera updates behind public seams', () => {
    const calls = [];
    const manager = Object.assign(Object.create(EntityManager.prototype), {
        _killcamSystem: {
            isActive: () => true,
            getTimeScale: () => 0.5,
            advanceGhostPlayback: (dt) => calls.push(['ghost', dt]),
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
        ['ghost', 0.1],
        ['update', 0.2],
        ['camera', 0.1],
    ]);
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

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { EntityManager } from '../src/entities/EntityManager.js';
import { KillcamSystem } from '../src/hunt/KillcamSystem.js';

function createKillcamFixture() {
    const playbackCalls = [];
    const player = {
        index: 0,
        isBot: false,
        alive: false,
        color: 0xffffff,
        position: new THREE.Vector3(3, 2, 1),
        view: { setVisible() {} },
    };
    const killer = {
        index: 1,
        isBot: true,
        alive: true,
        position: new THREE.Vector3(5, 2, 1),
        view: { setVisible() {} },
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
        particles: { spawnExplosion() {} },
        audio: { play() {} },
        playLastRoundGhost(nextClip, options) {
            playbackCalls.push({ clip: nextClip, options });
            return true;
        },
        clearLastRoundGhost() {},
    };
    const killcam = new KillcamSystem({
        renderer: { cameras: [] },
        entityManager,
        recorder: { getLastRoundGhostClip: () => clip },
        respawnSystem: {
            isEnabled: () => true,
            isRespawnPending: () => true,
            getRemainingByPlayer: () => ({ 0: 2.55 }),
        },
    });
    return { killcam, killer, player, playbackCalls };
}

test('killcam keeps visible ghost playback aligned with its source-time camera pose', () => {
    const { killcam, killer, player, playbackCalls } = createKillcamFixture();
    assert.equal(killcam.onPlayerDied(player, { killer }), true);
    assert.deepEqual(playbackCalls[0]?.options, { loop: false });

    let visualElapsed = 0;
    while (killcam._elapsed < killcam._displayDuration * 0.86) {
        const dt = 0.005;
        const scaledDt = dt * killcam.getTimeScale();
        visualElapsed += killcam.getVisualGhostPlaybackDelta(scaledDt);
        killcam.advanceGhostPlayback(scaledDt);
        killcam.update(dt);
    }

    assert.ok(Math.abs(killcam._ghostElapsed - killcam._ghostSourceDuration) < 0.01);
    assert.ok(Math.abs(visualElapsed - killcam._displayDuration) < 0.03);
    killcam.dispose();
});

test('EntityManager suppresses immediate death effects when a killcam starts', () => {
    let particleExplosions = 0;
    let explosionSounds = 0;
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
        recorder: null,
        _eventBus: { emitPlayerDied() {} },
        onArcadeGameplayEvent: null,
    };

    EntityManager.prototype._killPlayer.call(owner, player, 'WALL');
    assert.equal(particleExplosions, 0);
    assert.equal(explosionSounds, 0);
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

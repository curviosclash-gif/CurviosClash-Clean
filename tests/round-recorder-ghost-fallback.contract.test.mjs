import test from 'node:test';
import assert from 'node:assert/strict';

import { RoundRecorder } from '../src/state/RoundRecorder.js';

function createPlayer(index, isBot, x, y, z) {
    return {
        index,
        isBot,
        color: 0xffffff,
        modelScale: 1,
        alive: true,
        position: { x, y, z },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        trail: { width: 0.7, inGap: false },
    };
}

test('RoundRecorder captures replay poses densely enough for a smooth two-second killcam', () => {
    const recorder = new RoundRecorder();
    const players = [createPlayer(0, false, 0, 0, 0)];

    recorder.startRound(players);
    recorder.recordFrame(players);
    recorder.recordFrame(players);
    assert.equal(recorder.snapshotCount, 0);
    recorder.recordFrame(players);
    assert.equal(recorder.snapshotCount, 1);
});

test('RoundRecorder erzeugt Ghost-Clip auch bei stark gedrosselter Frame-Aufnahme', () => {
    const recorder = new RoundRecorder();
    recorder._snapshotInterval = 1000;

    const players = [
        createPlayer(0, false, 10, 1, 2),
        createPlayer(1, true, -4, 1, -8),
    ];

    recorder.startRound(players);
    recorder.captureSnapshotNow(players);

    players[0].position.x = 14;
    players[0].position.z = 6;
    players[1].position.x = -1;

    const clip = recorder.getLastRoundGhostClip(players, {
        maxSourceDuration: Number.POSITIVE_INFINITY,
        displayDuration: 3,
    });

    assert.ok(clip, 'expected fallback ghost clip');
    assert.ok(Array.isArray(clip.frames), 'frames must be an array');
    assert.ok(clip.frames.length >= 2, 'clip requires at least two frames');
    assert.ok(Number(clip.sourceDuration) > 0, 'clip requires positive source duration');
    assert.equal(Array.isArray(clip.players) ? clip.players.length : 0, 1);
    assert.equal(clip.players[0]?.idx, 0);
    for (const frame of clip.frames) {
        assert.deepEqual(frame.players.map((player) => player.idx), [0]);
    }
});

test('RoundRecorder kann Bot-Ghost-Clips nur explizit fuer Debug-Pfade einschliessen', () => {
    const recorder = new RoundRecorder();
    recorder._snapshotInterval = 1000;

    const players = [
        createPlayer(0, false, 10, 1, 2),
        createPlayer(1, true, -4, 1, -8),
    ];

    recorder.startRound(players);
    recorder.captureSnapshotNow(players);

    players[0].position.x = 14;
    players[1].position.x = -1;

    const clip = recorder.getLastRoundGhostClip(players, {
        includeBots: true,
        maxSourceDuration: Number.POSITIVE_INFINITY,
        displayDuration: 3,
    });

    assert.ok(clip, 'expected debug ghost clip');
    assert.equal(Array.isArray(clip.players) ? clip.players.length : 0, players.length);
    assert.deepEqual(clip.players.map((player) => player.idx), [0, 1]);
});

test('RoundRecorder captures the complete dynamic scene for killcam playback', () => {
    const recorder = new RoundRecorder();
    const player = createPlayer(0, false, 0, 2, 4);
    player.color = 0x22aaff;
    const projectile = {
        traversalId: 'rocket:1',
        type: 'ROCKET_MEDIUM',
        owner: player,
        position: { x: 1, y: 2, z: 3 },
        velocity: { x: 0, y: 0, z: -10 },
        radius: 0.4,
    };
    const entityManager = {
        players: [player],
        projectiles: [projectile],
        powerupManager: {
            items: [{
                networkId: 'powerup:1',
                type: 'SPEED_UP',
                baseY: 2,
                mesh: { visible: true, position: { x: 5, y: 2, z: 6 } },
            }],
        },
        particles: {
            count: 1,
            positions: new Float32Array([7, 8, 9]),
            velocities: new Float32Array([1, 2, 3]),
            lifetimes: new Float32Array([0.5]),
            maxLifetimes: new Float32Array([1]),
            gravities: new Float32Array([-5]),
            scales: new Float32Array([0.4]),
            colors: new Float32Array([1, 0.5, 0.25]),
        },
        entityRuntimeConfig: {
            POWERUP: { TYPES: { SPEED_UP: { color: 0x44ff88 } } },
        },
    };

    recorder.startRound([player]);
    recorder.captureSnapshotNow(entityManager);
    player.position.z = 0;
    projectile.position.z = -2;
    recorder.captureSnapshotNow(entityManager);

    const clip = recorder.getKillcamReplayClip(entityManager, {
        includeBots: true,
        maxSourceDuration: 2,
        displayDuration: 2.5,
    });

    assert.ok(clip);
    assert.equal(clip.frames.at(-1)?.players[0]?.trailWidth, 0.7);
    assert.equal(clip.frames.at(-1)?.projectiles[0]?.id, 'rocket:1');
    assert.equal(clip.frames.at(-1)?.projectiles[0]?.z, -2);
    assert.equal(clip.frames.at(-1)?.powerups[0]?.id, 'powerup:1');
    assert.equal(clip.frames.at(-1)?.powerups[0]?.color, 0x44ff88);
    assert.equal(clip.frames.at(-1)?.particles?.count, 1);
    assert.equal(clip.frames.at(-1)?.particles?.values?.length, 13);
});

test('RoundRecorder schneidet das Killcam-Quellfenster exakt am Todeszeitpunkt zu', () => {
    const recorder = new RoundRecorder();
    const player = createPlayer(0, false, 0, 0, 0);
    const samples = [
        { time: 0, x: 0, alive: true },
        { time: 0.75, x: 3, alive: true },
        { time: 1.5, x: 6, alive: true },
        { time: 2.25, x: 9, alive: true },
        { time: 2.75, x: 11, alive: true },
        { time: 2.75, x: 11, alive: false },
    ];

    for (let index = 0; index < samples.length; index++) {
        const sample = samples[index];
        const snapshot = recorder.snapshots[index];
        snapshot.time = sample.time;
        snapshot.playerCount = 1;
        snapshot.players[0] = {
            idx: 0,
            alive: sample.alive,
            x: sample.x,
            y: 0,
            z: 0,
            qx: 0,
            qy: 0,
            qz: 0,
            qw: 1,
            bot: false,
        };
    }
    recorder.snapshotCount = samples.length;
    recorder.snapshotIndex = samples.length;

    const clip = recorder.getLastRoundGhostClip([player], {
        maxSourceDuration: 2,
        displayDuration: 2.5,
    });

    assert.ok(clip);
    assert.equal(clip.sourceDuration, 2);
    assert.equal(clip.displayDuration, 2.5);
    assert.equal(clip.frames[0]?.time, 0);
    assert.equal(clip.frames[0]?.players[0]?.x, 3);
    assert.deepEqual(clip.frames.slice(-2).map((frame) => frame.time), [2, 2]);
    assert.deepEqual(
        clip.frames.slice(-2).map((frame) => frame.players[0]?.alive),
        [true, false]
    );
});

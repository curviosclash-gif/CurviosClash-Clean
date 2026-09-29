import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { createRocketDuelCamera, installRocketDuelFlight, ROCKET_DUEL,
    rocketDuelShotAt, sampleRocketDuelRecordedCamera } from '../scripts/marketing/rocket-duel-scene.mjs';

test('rocket duel has a two minute preroll and camera shots through both pilots and the shared fight', () => {
    assert.equal(ROCKET_DUEL.prerollSeconds, 120);
    assert.equal(ROCKET_DUEL.durationSeconds, 40);
    assert.deepEqual(ROCKET_DUEL.cameraShots.map((shot) => shot.player ?? 'both'),
        [0, 'both', 1, 'both', 0, 'both', 1, 'both']);
    assert.equal(rocketDuelShotAt(31).player, 1);
});

test('cinematic handoffs begin at the previous pose and end at the recorded next pose', () => {
    const template = new PerspectiveCamera(75);
    const director = createRocketDuelCamera(template);
    const projection = { players: [
        { playerIndex: 0, position: new Vector3(-20, 45, 0) },
        { playerIndex: 1, position: new Vector3(20, 55, 0) },
    ] };
    const recorded = [
        { position: { x: -25, y: 50, z: 15 }, quaternion: new Quaternion(), fov: 75 },
        { position: { x: 25, y: 60, z: 15 }, quaternion: new Quaternion(), fov: 75 },
    ];
    const before = { ...director.sample(projection, recorded, 5.999).position };
    const at = { ...director.sample(projection, recorded, 6).position };
    assert.ok(Math.hypot(at.x - before.x, at.y - before.y, at.z - before.z) < 0.01);
    const final = director.sample(projection, recorded, 10.5);
    assert.deepEqual(final.position, recorded[1].position);
    assert.equal(final.fov, 75);
    const sampled = sampleRocketDuelRecordedCamera(
        { cameras: [{ index: 1, position: [0, 2, 4], quaternion: [0, 0, 0, 1], fov: 70 }] },
        { cameras: [{ index: 1, position: [10, 2, 4], quaternion: [0, 0, 0, 1], fov: 80 }] },
        0.5, 1);
    assert.equal(sampled.position.x, 5);
    assert.equal(sampled.fov, 75);
    const reused = sampleRocketDuelRecordedCamera(
        { cameras: [{ index: 1, position: [0, 2, 4], quaternion: [0, 0, 0, 1], fov: 70 }] },
        { cameras: [{ index: 1, position: [10, 2, 4], quaternion: [0, 0, 0, 1], fov: 80 }] },
        1, 1, sampled);
    assert.equal(reused, sampled);
    assert.equal(reused.position.x, 10);
});

test('scripted flight controls two non-bot slots alongside three bots and fires a rocket', () => {
    const players = Array.from({ length: 5 }, (_, index) => ({
        index, isBot: index >= 2, alive: true, hp: 100, score: 0,
        position: new Vector3(index * 5 + 10, 50, 0), quaternion: new Quaternion(),
        rocketInventory: index === 0 ? ['ROCKET_WEAK'] : [],
    }));
    const sources = new Map();
    const pickups = [];
    const gameEvents = [];
    const game = {
        recorder: { logEvent(type, player, data) { gameEvents.push({ type, player, data }); } },
        entityManager: { players,
            _spawnOps: { spawnPlayerAt(player, position) { player.position.copy(position); } },
            powerupManager: {
            items: pickups,
            spawnAtAnchor(anchor) {
                const item = { mesh: { position: new Vector3(anchor.x, anchor.y, anchor.z) } };
                pickups.push(item);
                return item;
            },
        } },
        input: { clearPlayerSources() {}, setPlayerSource(index, source) { sources.set(index, source); } },
        renderer: { setSplitScreen() {}, cameraModes: [1, 1], cameras: [],
            viewportSystem: { setNetworkMode() {} } },
    };
    const run = installRocketDuelFlight(game);
    assert.equal(sources.size, 2);
    assert.equal(run.sources.length, 2);
    run.sources[0].time = 27.99;
    const input = run.sources[0].poll({ dt: 0.02 });
    assert.equal(input.shootRocket, true);
    assert.equal(run.state.shots.length, 1);
    assert.equal(run.state.pickups.length, 1);
    game.recorder.logEvent('ITEM_USE', 0, 'mode=shoot type=ROCKET_WEAK code=item.shoot.success ok=1');
    assert.equal(run.state.events.length, 1);
    assert.equal(gameEvents.length, 1);
    for (const axis of ['pitchAxis', 'yawAxis', 'rollAxis']) {
        assert.ok(Number.isFinite(input[axis]) && Math.abs(input[axis]) <= 1);
    }
    assert.throws(() => installRocketDuelFlight({ ...game,
        entityManager: { ...game.entityManager, players: players.slice(0, 4) } }), /two players and three bots/);
});

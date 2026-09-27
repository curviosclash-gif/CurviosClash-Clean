import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import {
    createTrailShortCamera,
    installTrailShortFlight,
    resolveTrailFlightTarget,
    resolveTrailShortShot,
    sampleTrailShortRecordedCamera,
    trailShortHudOpacity,
    trailShortSubject,
    TRAIL_SHORT,
} from '../scripts/marketing/trail-short-scene.mjs';

const projection = (first, second) => ({ players: [
    { playerIndex: 0, position: first },
    { playerIndex: 1, position: second },
] });

test('shot handoffs cover the 16-second footage without gaps', () => {
    assert.equal(TRAIL_SHORT.fps, 60);
    assert.equal(TRAIL_SHORT.shots[0].start, 0);
    assert.equal(TRAIL_SHORT.shots.at(-1).end, TRAIL_SHORT.duration);
    for (let index = 1; index < TRAIL_SHORT.shots.length; index += 1) {
        assert.equal(TRAIL_SHORT.shots[index].start, TRAIL_SHORT.shots[index - 1].end);
    }
    assert.equal(resolveTrailShortShot(3).kind, 'third-person');
    assert.equal(resolveTrailShortShot(7).kind, 'cinematic');
    assert.equal(resolveTrailShortShot(10).player, 0);
    assert.equal(trailShortSubject(10, 'thick'), 0);
    assert.equal(trailShortSubject(10, 'ghost'), 1);
});

test('the live HUD fades in after arrival and out before the return camera move', () => {
    assert.equal(trailShortHudOpacity(2.99), 0);
    assert.equal(trailShortHudOpacity(3), 0);
    assert.equal(trailShortHudOpacity(3.25), 0.5);
    assert.equal(trailShortHudOpacity(3.5), 1);
    assert.equal(trailShortHudOpacity(6.75), 0.5);
    assert.equal(trailShortHudOpacity(7), 0);
    assert.equal(trailShortHudOpacity(10), 0);
    assert.equal(trailShortHudOpacity(10.25), 0.5);
    assert.equal(trailShortHudOpacity(10.5), 1);
});

test('camera poses stay finite, level enough to see the duel, and continuous in both formats', () => {
    for (const portrait of [false, true]) {
        const rig = createTrailShortCamera(new PerspectiveCamera(70, portrait ? 9 / 16 : 16 / 9, 0.1, 1000));
        let previous;
        for (let frame = 0; frame <= 240; frame += 1) {
            const time = frame / 60;
            const first = { x: -16 + time * 0.4, y: 10 + time * 0.2, z: -5 + time * 0.3 };
            const second = { x: 16 - time * 0.3, y: 8 + time * 0.25, z: 5 - time * 0.2 };
            const pose = rig.sample(projection(first, second), time, portrait);
            assert.equal(pose.fov, 55);
            assert.ok(Object.values(pose.position).every(Number.isFinite));
            assert.ok(Object.values(pose.quaternion).every(Number.isFinite));
            const middle = new Vector3().addVectors(new Vector3(...Object.values(first)),
                new Vector3(...Object.values(second))).multiplyScalar(0.5);
            const camera = new Vector3(pose.position.x, pose.position.y, pose.position.z);
            const offset = camera.sub(middle);
            assert.ok(Math.hypot(offset.x, offset.z) > Math.abs(offset.y) * 2,
                'camera must remain oblique, not overhead');
            if (previous) assert.ok(camera.distanceTo(previous) < 0.1, 'camera should not jump between frames');
            previous = camera.clone();
        }
    }
});

test('camera restores its lens after the native replay mutates the returned pose', () => {
    const rig = createTrailShortCamera(new PerspectiveCamera(70, 16 / 9, 0.1, 1000));
    const subjects = projection({ x: -15, y: 10, z: 0 }, { x: 15, y: 12, z: 4 });
    const pose = rig.sample(subjects, 1);
    pose.fov = 75;
    pose.zoom = 2;
    const next = rig.sample(subjects, 1 + 1 / 60);
    assert.equal(next.fov, 55);
    assert.equal(next.zoom, 1);
});

test('optional handoff flight meets both third-person camera positions at the shot cuts', () => {
    for (const portrait of [false, true]) {
        const rig = createTrailShortCamera(new PerspectiveCamera(70, portrait ? 9 / 16 : 16 / 9, 0.1, 1000),
            { handoff: true });
        let previous = null;
        let previousStep = null;
        for (let frame = 0; frame <= 600; frame += 1) {
            const time = frame / 60;
            const first = { x: -16 + time * 0.4, y: 10 + time * 0.2, z: -5 + time * 0.3 };
            const second = { x: 16 - time * 0.3, y: 8 + time * 0.25, z: 5 - time * 0.2 };
            const pose = rig.sample(projection(first, second), time, portrait);
            const camera = new Vector3(pose.position.x, pose.position.y, pose.position.z);
            const openingBlend = portrait ? Math.max(0, Math.min((time - 1.25) / 1.75, 1))
                : Math.min(time / 3, 1);
            const amount = time < 7 ? openingBlend
                : time < 8 ? 8 - time : Math.min((time - 8) / 2, 1);
            const blend = amount * amount * (3 - 2 * amount);
            assert.ok(Math.abs(pose.fov - (55 + 20 * blend)) < 1e-9);
            assert.ok(Object.values(pose.quaternion).every(Number.isFinite));
            if (previous) {
                const step = camera.distanceTo(previous);
                assert.ok(step < 1.7, 'handoff flight must not teleport');
                if (previousStep !== null) {
                    assert.ok(Math.abs(step - previousStep) < 0.2, 'handoff flight must not jerk');
                }
                previousStep = step;
            }
            if ([180, 420, 600].includes(frame)) {
                const subject = first;
                assert.ok(camera.distanceTo(new Vector3(subject.x, subject.y + 5, subject.z + 9)) < 1e-9,
                    'handoff must reach the native follow position');
            }
            previous = camera;
        }
    }
});

test('handoff samples the selected pilot camera instead of the other pilot', () => {
    const left = { cameras: [
        { index: 0, position: [0, 0, 0], quaternion: [0, 0, 0, 1], fov: 70 },
        { index: 1, position: [20, 5, 10], quaternion: [0, 0, 0, 1], fov: 75 },
    ] };
    const right = { cameras: [
        { index: 0, position: [1, 0, 0], quaternion: [0, 0, 0, 1], fov: 70 },
        { index: 1, position: [22, 7, 12], quaternion: [0, 0, 0, 1], fov: 75 },
    ] };
    const selected = sampleTrailShortRecordedCamera(left, right, 0.5, trailShortSubject(3, 'ghost'));
    assert.deepEqual(selected.position, { x: 21, y: 6, z: 11 });
    assert.equal(selected.fov, 75);
    assert.throws(() => sampleTrailShortRecordedCamera(left, right, 0.5, 2), /missing/);
});

test('handoff uses the actual camera recorded with gameplay when available', () => {
    const rig = createTrailShortCamera(new PerspectiveCamera(70, 16 / 9, 0.1, 1000),
        { handoff: true });
    const scene = projection({ x: -15, y: 10, z: 0 }, { x: 15, y: 12, z: 4 });
    scene.recordedCamera = {
        position: { x: 22, y: 18, z: 7 },
        quaternion: { x: 0, y: 0.3, z: 0, w: Math.sqrt(0.91) },
        fov: 68,
    };
    for (const time of [3, 7, 10]) {
        const pose = rig.sample(scene, time);
        assert.deepEqual(pose.position, scene.recordedCamera.position);
        assert.deepEqual(pose.quaternion, scene.recordedCamera.quaternion);
        assert.equal(pose.fov, scene.recordedCamera.fov);
    }
});

function verticalLegs(points, minChange = 6) {
    const legs = [];
    let pivot = points[0].y;
    let extreme = pivot;
    let direction = 0;
    for (const point of points) {
        if (direction === 0) {
            if (point.y - pivot >= minChange) { direction = 1; extreme = point.y; }
            if (pivot - point.y >= minChange) { direction = -1; extreme = point.y; }
        } else if (direction === 1) {
            if (point.y > extreme) extreme = point.y;
            else if (extreme - point.y >= minChange) {
                legs.push(1);
                direction = -1;
                extreme = point.y;
            }
        } else if (point.y < extreme) extreme = point.y;
        else if (point.y - extreme >= minChange) {
            legs.push(-1);
            direction = 1;
            extreme = point.y;
        }
    }
    if (direction) legs.push(direction);
    return legs;
}

function horizontalTurnSigns(points, window = 10) {
    const headings = [];
    for (let index = 1; index < points.length; index += 1) {
        const delta = points[index].clone().sub(points[index - 1]);
        headings.push(Math.atan2(delta.z, delta.x));
    }
    const signs = [];
    for (let index = 0; index + window < headings.length; index += window) {
        let turn = 0;
        for (let step = index + 1; step <= index + window; step += 1) {
            let delta = headings[step] - headings[step - 1];
            if (delta > Math.PI) delta -= 2 * Math.PI;
            if (delta < -Math.PI) delta += 2 * Math.PI;
            turn += delta;
        }
        if (Math.abs(turn) >= 0.2) signs.push(Math.sign(turn));
    }
    return signs;
}

test('both flight targets weave through substantial climbs, dives, and reversing turns', () => {
    const stationaryPlayer = new Vector3(0, 35, 0);
    for (const player of [0, 1]) {
        const points = [];
        for (let sample = 0; sample <= 111; sample += 1) {
            points.push(resolveTrailFlightTarget(player, sample * 0.2,
                stationaryPlayer, new Vector3()).clone());
        }
        points.push(resolveTrailFlightTarget(player, 22.3, stationaryPlayer, new Vector3()).clone());
        assert.ok(points.every((point) => [point.x, point.y, point.z].every(Number.isFinite)));
        assert.ok(Math.max(...points.map((point) => point.y))
            - Math.min(...points.map((point) => point.y)) >= 20,
        `player ${player} needs at least 20 m of altitude range`);
        const legs = verticalLegs(points);
        assert.ok(legs.filter((direction) => direction === 1).length >= 2
            && legs.filter((direction) => direction === -1).length >= 2,
        `player ${player} needs repeated climbs and dives of at least 6 m; got ${legs}`);
        const turns = horizontalTurnSigns(points);
        const reversals = turns.slice(1).filter((sign, index) => sign !== turns[index]).length;
        assert.ok(reversals >= 2,
            `player ${player} needs at least two substantial yaw reversals; got ${turns}`);
    }
    assert.deepEqual(stationaryPlayer.toArray(), [0, 35, 0], 'target calculation must not move a player');
});

test('flight controller steers within input limits without changing player transforms after spawn', () => {
    const players = [0, 1].map((index) => ({
        position: new Vector3(index, 0, 0), quaternion: new Quaternion(),
        alive: true, isBot: false, inventory: index === 0 ? ['THICK'] : [], trail: { segmentCount: 0 },
    }));
    const sources = new Map();
    let spawns = 0;
    const game = {
        entityManager: {
            players,
            _spawnOps: { spawnPlayerAt(player, start) { spawns += 1; player.position.copy(start); } },
        },
        powerupManager: { spawnAtAnchor(anchor) { assert.equal(anchor.type, 'THICK'); return {}; } },
        input: { clearPlayerSources() {}, setPlayerSource(index, source) { sources.set(index, source); } },
        renderer: {
            setSplitScreen() {}, cameraModes: [1, 1], cameras: [],
            viewportSystem: { setNetworkMode() {} },
        },
    };
    const previousDocument = globalThis.document;
    globalThis.document = { getElementById: () => null };
    try {
        const flight = installTrailShortFlight(game);
        assert.equal(spawns, 2);
        assert.equal(sources.size, 2);
        const spawnPositions = players.map((player) => player.position.clone());
        const spawnRotations = players.map((player) => player.quaternion.clone());
        let itemUses = 0;
        for (let step = 0; step < 22 * 60; step += 1) {
            for (const source of flight.sources) {
                const input = source.poll({ dt: 1 / 60 });
                if (input.useItem) itemUses += 1;
                for (const axis of ['pitchAxis', 'yawAxis', 'rollAxis']) {
                    assert.ok(Number.isFinite(input[axis]) && Math.abs(input[axis]) <= 1, axis);
                }
            }
        }
        const rollAxis = new Vector3(0, 0, 1);
        players[0].quaternion.setFromAxisAngle(rollAxis, 0.3);
        const bankRight = players[0].quaternion.clone();
        assert.ok(flight.sources[0].poll({ dt: 0 }).rollAxis < 0,
            'positive Z bank needs negative corrective roll');
        assert.ok(players[0].quaternion.equals(bankRight), 'poll must not change the bank');
        players[0].quaternion.setFromAxisAngle(rollAxis, -0.3);
        const bankLeft = players[0].quaternion.clone();
        assert.ok(flight.sources[0].poll({ dt: 0 }).rollAxis > 0,
            'negative Z bank needs positive corrective roll');
        assert.ok(players[0].quaternion.equals(bankLeft), 'poll must not change the bank');
        players[0].quaternion.copy(spawnRotations[0]);
        assert.equal(spawns, 2);
        assert.equal(itemUses, 1);
        assert.equal(flight.state.itemCollected, true);
        players.forEach((player, index) => {
            assert.ok(player.position.equals(spawnPositions[index]));
            assert.ok(player.quaternion.equals(spawnRotations[index]));
        });
        assert.ok(flight.state.clipStartedAt !== null);
        assert.ok(flight.state.finishedAt !== null);
    } finally {
        globalThis.document = previousDocument;
    }
});

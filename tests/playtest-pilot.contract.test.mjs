// The test pilot in a small simulated world: real three.js vectors, a ship that flies at
// constant speed and turns at the game's rate, sphere-vs-box collision. This checks the
// controller itself (direction of commands, invert compensation, goal changes, flying
// around a wall, following a checkpoint route) without starting the game.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { installPilotRuntime, PILOT_VERSION } from '../scripts/playtest/playtest-pilot-runtime.mjs';

const DT = 1 / 60;

function tubeHit(point, radius, tube) {
    const a = new THREE.Vector3(tube.ax, tube.ay, tube.az);
    const b = new THREE.Vector3(tube.bx, tube.by, tube.bz);
    const ab = b.clone().sub(a);
    const t = point.clone().sub(a).dot(ab) / ab.lengthSq();
    if (t < 0 || t > 1) return false;
    const distance = point.distanceTo(a.clone().addScaledVector(ab, t));
    return distance <= tube.outerRadius + radius && distance >= tube.innerRadius - radius;
}

// A tunnel box is solid except for a round bore along its axis (like isInsideTunnel).
function tunnelHit(position, radius, obstacle) {
    if (!obstacle.box.intersectsSphere(new THREE.Sphere(position, radius))) return false;
    const center = obstacle.box.getCenter(new THREE.Vector3());
    const axis = obstacle.tunnel.axis;
    const off = position.clone().sub(center);
    off[axis] = 0;
    return off.length() > obstacle.tunnel.radius - radius;
}

function createWorld({ boxes = [], tubes = [], tunnels = [], route = null, invertPitch = true, start = [0, 0, 0] } = {}) {
    const player = {
        index: 0, alive: true, hp: 90, maxHp: 90, speed: 22, turnSpeed: 2.4, hitboxRadius: 1,
        invertPitchBase: invertPitch, invertControls: false,
        position: new THREE.Vector3(...start), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(),
    };
    const obstacles = [
        ...boxes.map(([min, max]) => ({ box: new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)) })),
        ...tubes.map((tube) => ({ tube })),
        ...tunnels.map(({ min, max, axis, radius }) => ({ box: new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)), tunnel: { axis, radius } })),
    ];
    const sphere = new THREE.Sphere();
    const arena = {
        obstacles,
        checkCollisionFast(position, radius) {
            sphere.center.copy(position);
            sphere.radius = radius;
            return obstacles.some((obstacle) => {
                if (obstacle.tube) return tubeHit(position, radius, obstacle.tube);
                if (obstacle.tunnel) return tunnelHit(position, radius, obstacle);
                return obstacle.box.intersectsSphere(sphere);
            });
        },
        raycast(origin, direction, maxDistance) {
            const ray = new THREE.Ray(origin, direction);
            let best = null;
            for (const obstacle of obstacles) {
                if (!obstacle.box) continue;
                const hit = ray.intersectBox(obstacle.box, new THREE.Vector3());
                if (hit) {
                    const distance = hit.distanceTo(origin);
                    if (distance <= maxDistance && (!best || distance < best.distance)) best = { hit: true, distance };
                }
            }
            return best || { hit: false };
        },
    };
    const progress = route ? { index: 0, completed: false } : null;
    const entityManager = {
        players: [player], humanPlayers: [player], runtimeConfig: { session: { localPlayerIndex: 0 } }, arena,
        getParcoursRouteSnapshot: () => route,
        _parcoursProgressSystem: route ? {
            getPlayerProgressSnapshot: () => ({
                completed: progress.completed,
                expectedCheckpointIds: progress.completed ? [] : [progress.index < route.checkpoints.length ? route.checkpoints[progress.index].id : 'FINISH'],
                passedCheckpointIds: route.checkpoints.slice(0, progress.index).map((checkpoint) => checkpoint.id),
            }),
        } : null,
    };
    globalThis.window = { GAME_INSTANCE: { state: 'PLAYING', entityManager, arena } };
    delete globalThis.window.__playtestPilotRuntime;
    installPilotRuntime(PILOT_VERSION);
    const pilot = globalThis.window.__playtestPilotRuntime;
    const euler = new THREE.Euler();
    const turn = new THREE.Quaternion();
    let crashed = 0;
    return {
        player, pilot, progress,
        /** One simulation step: pilot decides, the ship turns and moves like PlayerMotionOps. */
        step() {
            pilot.tick();
            const raw = pilot.inputFor(0) || {};
            const pitch = (raw.pitchAxis || 0) * (player.invertPitchBase ? -1 : 1);
            euler.set(pitch * player.turnSpeed * DT, (raw.yawAxis || 0) * player.turnSpeed * DT, (raw.rollAxis || 0) * 3 * DT, 'YXZ');
            turn.setFromEuler(euler);
            player.quaternion.multiply(turn);
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(player.quaternion);
            player.velocity.copy(forward).multiplyScalar(player.speed);
            player.position.addScaledVector(forward, player.speed * DT);
            if (arena.checkCollisionFast(player.position, player.hitboxRadius)) crashed += 1;
            if (route && !progress.completed) {
                const target = progress.index < route.checkpoints.length ? route.checkpoints[progress.index] : route.finish;
                if (player.position.distanceTo(new THREE.Vector3(...target.pos)) <= target.radius + player.hitboxRadius) {
                    progress.index += 1;
                    if (progress.index > route.checkpoints.length) progress.completed = true;
                }
            }
            return raw;
        },
        crashes: () => crashed,
        heading: () => {
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(player.quaternion);
            return { yaw: Math.atan2(-forward.x, -forward.z), pitch: Math.asin(forward.y) };
        },
    };
}

test('a maneuver turns the asked way and compensates the inverted pitch like a person would', () => {
    const world = createWorld({ invertPitch: true });
    world.pilot.configure({ mode: 'maneuver', input: { turn: 1, climb: 0, roll: 0 }, frames: 30 });
    let raw = null;
    for (let index = 0; index < 30; index += 1) raw = world.step();
    assert.ok(raw.yawAxis < 0, 'turn right is a negative yaw axis on the device');
    assert.ok(world.heading().yaw < -0.9, `turned right by ${world.heading().yaw} rad`);
    assert.equal(world.pilot.describe().status, 'done');

    world.pilot.configure({ mode: 'maneuver', input: { turn: 0, climb: 1, roll: 0 }, frames: 20 });
    for (let index = 0; index < 20; index += 1) raw = world.step();
    assert.ok(raw.pitchAxis < 0, 'with inverted pitch the device must push the stick the other way');
    assert.ok(world.heading().pitch > 0.5, 'and the nose still goes up');
});

test('buttons of a maneuver are a single tap, the machine gun is held', () => {
    const world = createWorld();
    world.pilot.configure({ mode: 'maneuver', input: { turn: 0, climb: 0, roll: 0, boost: true, fireMG: true }, frames: 5 });
    const first = world.step();
    const second = world.step();
    assert.equal(first.boostPressed, true);
    assert.equal(second.boostPressed, false, 'boost is a press edge, not a hold');
    assert.equal(second.shootMG, true);
});

test('a changed goal changes the commands at once', () => {
    const world = createWorld();
    world.pilot.configure({ mode: 'waypoints', points: [[80, 0, -10]], arriveRadius: 3 });
    for (let index = 0; index < 5; index += 1) world.step();
    const towardRight = world.pilot.describe().lastCommand.turn;
    world.pilot.update({ points: [[-80, 0, -10]] });
    for (let index = 0; index < 5; index += 1) world.step();
    const towardLeft = world.pilot.describe().lastCommand.turn;
    assert.ok(towardRight > 0.5 && towardLeft < -0.5, `turn ${towardRight} then ${towardLeft}`);
});

test('a goal behind a wall is reached around it without touching the wall', () => {
    const world = createWorld({ boxes: [[[-30, -30, -42], [30, 30, -32]]] });
    world.pilot.configure({ mode: 'waypoints', points: [[0, 0, -90]], arriveRadius: 8 });
    let frames = 0;
    while (world.pilot.describe().status === 'active' && frames < 60 * 30) { world.step(); frames += 1; }
    const described = world.pilot.describe();
    assert.equal(described.status, 'done', `still ${described.status} after ${frames} frames at ${world.player.position.toArray().map(Math.round)}`);
    assert.equal(world.crashes(), 0, 'no frame inside the wall');
    assert.ok(described.counters.replans > 0 || described.counters.avoidances > 0, 'the wall changed the plan');
});

test('the parcours mode flies an ordered checkpoint route to the finish', () => {
    const route = {
        enabled: true,
        checkpoints: [
            { id: 'CP01', pos: [0, 0, -60], radius: 12, forward: [0, 0, -1] },
            { id: 'CP02', pos: [60, 10, -120], radius: 12, forward: [1, 0, 0] },
            { id: 'CP03', pos: [140, 10, -100], radius: 10, forward: [1, 0, 0] },
        ],
        finish: { pos: [200, 0, -60], radius: 14 },
    };
    const world = createWorld({ route, boxes: [[[90, -40, -150], [100, 40, -126]]] });
    world.pilot.configure({ mode: 'parcours' });
    let frames = 0;
    while (world.pilot.describe().status === 'active' && frames < 60 * 60) { world.step(); frames += 1; }
    assert.equal(world.progress.completed, true, `stopped at checkpoint ${world.progress.index}`);
    assert.equal(world.pilot.describe().status, 'done');
    assert.equal(world.crashes(), 0);
});

test('a checkpoint inside a hollow tube is entered through the mouth on the ship side', () => {
    // A tube along +x from x=60 to x=220 (inner radius 12); the checkpoint sits 30 units inside.
    const tube = { ax: 60, ay: 0, az: -100, bx: 220, by: 0, bz: -100, innerRadius: 12.3, outerRadius: 14.3 };
    const route = {
        enabled: true,
        checkpoints: [{ id: 'CP01', pos: [90, 0, -100], radius: 15, forward: [1, 0, 0] }],
        finish: { pos: [260, 0, -100], radius: 15 },
    };
    const world = createWorld({ route, tubes: [tube], start: [0, 0, -40] });
    world.pilot.configure({ mode: 'parcours' });
    let frames = 0;
    while (world.pilot.describe().status === 'active' && frames < 60 * 40) { world.step(); frames += 1; }
    assert.equal(world.crashes(), 0, 'never touched the tube shell');
    assert.equal(world.progress.completed, true, `stopped at checkpoint ${world.progress.index}`);
    assert.ok(world.pilot.describe().decisions.some((entry) => entry.kind === 'checkpoint-target' && entry.id === 'CP01:approach'));
});

test('a dead ship gets neutral input and the pilot waits for the respawn', () => {
    const world = createWorld();
    world.pilot.configure({ mode: 'waypoints', points: [[0, 0, -200]] });
    world.player.alive = false;
    const raw = world.step();
    assert.equal(raw.pitchAxis, undefined);
    assert.equal(raw.shootMG, false);
    assert.equal(world.pilot.describe().status, 'active');
});

test('after a checkpoint inside a tunnel the ship flies out of the tunnel before turning', () => {
    // Tunnel along x from x=40 to x=124 (bore radius 14); CP01 in its middle, CP02 beside the far mouth.
    const route = {
        enabled: true,
        checkpoints: [
            { id: 'CP01', pos: [82, 0, -60], radius: 14, forward: [1, 0, 0] },
            { id: 'CP02', pos: [124, 30, -20], radius: 15, forward: [1, 0, 0] },
        ],
        finish: { pos: [60, 30, 40], radius: 18 },
    };
    const world = createWorld({ route, tunnels: [{ min: [40, -60, -78], max: [124, 60, -42], axis: 'x', radius: 14 }], start: [0, 0, -60] });
    world.pilot.configure({ mode: 'parcours' });
    let frames = 0;
    while (world.pilot.describe().status === 'active' && frames < 60 * 60) { world.step(); frames += 1; }
    assert.equal(world.crashes(), 0, 'no frame inside the tunnel walls');
    assert.equal(world.progress.completed, true, `stopped at checkpoint ${world.progress.index}`);
    assert.ok(world.pilot.describe().decisions.some((entry) => entry.kind === 'checkpoint-target' && entry.id === 'CP01:exit'), 'flew the tunnel to its end');
});

/**
 * Stands for the input system and policy registry the bot mode borrows: the policy only
 * reports what the pilot handed it, so the test sees which flags the pilot set.
 */
function attachBotPolicy(world) {
    const seen = [];
    const em = globalThis.window.GAME_INSTANCE.entityManager;
    em.botPolicyRegistry = { create: () => ({ update: (_dt, player) => { seen.push(player.botTargetsMapUnits === true); return { shootMG: false }; } }) };
    em._playerInputSystem = { _resolveRuntimeContext: () => ({}), _buildBotObservation: () => null };
    return seen;
}

test('the bot pilot hunts map units only when asked and hands the flag back when it stops', () => {
    const world = createWorld();
    const seen = attachBotPolicy(world);
    world.pilot.configure({ mode: 'bot' });
    world.step();
    assert.equal(seen.at(-1), false, 'a plain bot pilot leaves map units alone');
    world.pilot.configure({ mode: 'bot', huntMapUnits: true });
    world.step();
    assert.equal(seen.at(-1), true, 'the asked-for bot pilot chases map units');
    world.pilot.stop('done');
    assert.equal(world.player.botTargetsMapUnits, false, 'stopping hands the ship back without the flag');
    world.pilot.configure({ mode: 'bot', huntMapUnits: true });
    world.step();
    world.pilot.configure({ mode: 'waypoints', points: [[0, 0, -200]] });
    assert.equal(world.player.botTargetsMapUnits, false, 'another goal also clears the flag');
});

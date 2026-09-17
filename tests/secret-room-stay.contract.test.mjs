import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { PortalLayoutBuilder } from '../src/entities/arena/portal/PortalLayoutBuilder.js';
import { PortalRuntimeSystem } from '../src/entities/arena/portal/PortalRuntimeSystem.js';
import { SecretRoomSystem } from '../src/entities/systems/SecretRoomSystem.js';
import { createMatchRuntimePlayerProjection } from '../src/shared/contracts/MatchRuntimeProjectionContract.js';
import { formatSecretRoomStatus } from '../src/ui/SecretRoomStatusText.js';
import { SecretRoomAnnouncer } from '../src/ui/SecretRoomAnnouncer.js';

const MAP_SCALE = 3;

// Authored in map units, exactly as a preset writes them; the runtime multiplies by the map scale.
const ROOM = Object.freeze({
    id: 'vault',
    modes: ['HUNT'],
    entryPortal: { pos: [40, 10, 0], color: 0x44ddff },
    roomPortal: { pos: [0, -60, 0] },
    bounds: { min: [-20, -80, -20], max: [20, -40, 20] },
    ejectPoint: { pos: [0, 12, 0], yawDeg: 90 },
    stayLimitSeconds: 20,
    refillSeconds: 30,
    items: [],
    unlock: { destructible: 'reactor', when: 'anyBreak', delaySeconds: 4 },
});

// World place well inside the room: bounds x scale is min [-60,-240,-60], max [60,-120,60].
const INSIDE = Object.freeze([0, -180, 0]);
const OUTSIDE = Object.freeze([0, 30, 0]);
const EJECT_WORLD = Object.freeze([0, 36, 0]);

function createArena() {
    const scene = new THREE.Scene();
    return {
        renderer: {
            addToScene(object) { scene.add(object); },
            removeFromScene(object) { scene.remove(object); },
        },
        scene,
        portals: [],
        exitPortals: [],
        specialGates: [],
        checkpointRings: [],
        checkpointRingSpinEnabled: true,
        portalsEnabled: true,
        portalLayoutWarnings: [],
        runtimeConfig: null,
        currentMapKey: 'secret_room_stay_test',
        currentMapDefinition: null,
        bounds: { minX: -300, maxX: 300, minY: 0, maxY: 180, minZ: -300, maxZ: 300 },
        glbAnimationElapsedSeconds: 0,
        checkCollision(position) { return position.y < 0; },
        checkCollisionFast(position) { return position.y < 0; },
    };
}

function createDestructible({ active = true, events = [], sealed = false } = {}) {
    const state = {
        segments: ['leg_a', 'leg_b'].map((id) => ({ id, hp: 100, destroyed: false })),
        events,
        sealed,
    };
    return { state, isActive: () => active, getState: () => state };
}

function createPlayer(index, position = OUTSIDE) {
    return {
        index,
        isBot: false,
        alive: true,
        hitboxRadius: 0.8,
        position: new THREE.Vector3(...position),
        quaternion: new THREE.Quaternion(),
        spawnProtectionTimer: 0,
        gapCalls: 0,
        obbRefreshes: 0,
        trail: { forceGap() { this.owner.gapCalls += 1; } },
        refreshObbCollisionQuery() { this.obbRefreshes += 1; },
    };
}

function createHarness({ rooms = [ROOM], mode = 'HUNT', destructible = createDestructible(), playerCount = 1 } = {}) {
    const arena = createArena();
    const map = { size: [200, 120, 200], secretRooms: rooms.map((room) => ({ ...room })) };
    arena.currentMapDefinition = map;
    const builder = new PortalLayoutBuilder(arena);
    builder.build(map, MAP_SCALE);
    const portalRuntime = new PortalRuntimeSystem(arena);
    const players = [];
    for (let index = 0; index < playerCount; index += 1) {
        const player = createPlayer(index);
        player.trail.owner = player;
        players.push(player);
    }
    const entityManager = {
        arena,
        players,
        gameModeStrategy: { modeType: mode, getPickupModeType: () => mode },
        _mapDestructibleSystem: destructible,
    };
    const system = new SecretRoomSystem(entityManager);
    return { arena, map, portalRuntime, entityManager, destructible, system, players };
}

/** Opens the room by recording a break and letting the map clock pass the authored delay. */
function openRoom(harness) {
    harness.destructible.state.events.push({ segmentId: 'leg_a', kind: 'leg_low', atSeconds: 0, yaw: 0 });
    harness.arena.glbAnimationElapsedSeconds = 10;
    harness.system.update(0);
}

function moveTo(player, position) {
    player.position.set(position[0], position[1], position[2]);
}

function tick(harness, dt, steps = 1) {
    for (let step = 0; step < steps; step += 1) harness.system.update(dt);
}

test('the stay clock only runs inside an open room', () => {
    const harness = createHarness();
    harness.system.startRound();
    const [player] = harness.players;

    moveTo(player, INSIDE);
    tick(harness, 1);
    assert.equal(harness.system.getHudStateForPlayer(0).inside, false, 'a shut room holds nobody');

    openRoom(harness);
    tick(harness, 1);
    const state = harness.system.getHudStateForPlayer(0);
    assert.equal(state.inside, true);
    assert.equal(state.roomId, 'vault');
    assert.equal(Math.round(state.remainingSeconds * 100) / 100, 19);
});

test('the clock counts down from dt, not from a frame count', () => {
    const harness = createHarness();
    harness.system.startRound();
    openRoom(harness);
    const [player] = harness.players;
    moveTo(player, INSIDE);

    harness.system.update(0.25);
    harness.system.update(2.5);
    harness.system.update(0.05);
    assert.equal(
        Math.round(harness.system.getHudStateForPlayer(0).remainingSeconds * 100) / 100,
        17.2,
        'uneven steps add up exactly'
    );
});

test('every visitor carries his own clock', () => {
    const harness = createHarness({ playerCount: 2 });
    harness.system.startRound();
    openRoom(harness);
    const [first, second] = harness.players;

    moveTo(first, INSIDE);
    tick(harness, 1, 5);
    moveTo(second, INSIDE);
    tick(harness, 1, 2);

    assert.equal(Math.round(harness.system.getHudStateForPlayer(0).remainingSeconds), 13);
    assert.equal(Math.round(harness.system.getHudStateForPlayer(1).remainingSeconds), 18);
});

test('leaving stops the clock and coming back starts a new one', () => {
    const harness = createHarness();
    harness.system.startRound();
    openRoom(harness);
    const [player] = harness.players;

    moveTo(player, INSIDE);
    tick(harness, 1, 8);
    moveTo(player, OUTSIDE);
    tick(harness, 1, 3);
    assert.equal(harness.system.getHudStateForPlayer(0).inside, false);
    assert.equal(harness.system.getHudStateForPlayer(0).remainingSeconds, 0);

    moveTo(player, INSIDE);
    tick(harness, 1);
    assert.equal(Math.round(harness.system.getHudStateForPlayer(0).remainingSeconds), 19, 'the full stay again');
});

test('a death inside the room ends the clock', () => {
    const harness = createHarness();
    harness.system.startRound();
    openRoom(harness);
    const [player] = harness.players;

    moveTo(player, INSIDE);
    tick(harness, 1, 4);
    player.alive = false;
    tick(harness, 1);
    assert.equal(harness.system.getHudStateForPlayer(0).inside, false);

    player.alive = true;
    tick(harness, 1);
    assert.equal(Math.round(harness.system.getHudStateForPlayer(0).remainingSeconds), 19);
});

test('a paused clock freezes instead of ejecting', () => {
    const harness = createHarness();
    harness.system.startRound();
    openRoom(harness);
    const [player] = harness.players;
    moveTo(player, INSIDE);
    tick(harness, 1, 2);

    const [room] = harness.system.getRooms();
    assert.equal(room.clockPaused, false, 'rooms run by default');
    room.clockPaused = true;
    tick(harness, 5, 20);
    assert.equal(Math.round(harness.system.getHudStateForPlayer(0).remainingSeconds), 18);
    assert.equal(player.position.y, INSIDE[1], 'a paused room never throws anyone out');
});

test('a spent clock puts the visitor on the authored eject point', () => {
    const harness = createHarness();
    harness.system.startRound();
    openRoom(harness);
    const [player] = harness.players;
    const [portal] = harness.arena.portals;
    moveTo(player, INSIDE);

    tick(harness, 1, 19);
    assert.deepEqual(player.position.toArray(), [...INSIDE], 'still inside one second before the limit');

    tick(harness, 1);
    assert.deepEqual(player.position.toArray(), [...EJECT_WORLD], 'eject point in world units');
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(player.quaternion);
    // yawDeg 90 turns the default heading (0,0,-1) onto (-1,0,0).
    assert.ok(Math.abs(forward.x - -1) < 1e-6 && Math.abs(forward.z) < 1e-6, `heading follows yawDeg: ${forward.toArray()}`);
    assert.equal(player.gapCalls, 1, 'the trail is cut at the jump');
    assert.equal(player.obbRefreshes, 1, 'the collision query is rebuilt at the new place');
    assert.ok(player.spawnProtectionTimer > 0, 'a short shield covers the landing');
    assert.ok(portal.cooldowns.get(0) > 0, 'the entry portal will not swallow him again right away');
    assert.equal(harness.system.getHudStateForPlayer(0).inside, false);
});

test('a replica shows the countdown but never ejects', () => {
    const harness = createHarness();
    harness.system.setNetworkReplica(true);
    harness.system.startRound();
    openRoom(harness);
    const [player] = harness.players;
    moveTo(player, INSIDE);

    tick(harness, 1, 25);
    assert.deepEqual(player.position.toArray(), [...INSIDE], 'only the host moves players');
    assert.equal(player.gapCalls, 0);
    assert.equal(harness.system.getHudStateForPlayer(0).inside, true, 'the HUD still counts');
    assert.equal(harness.system.getHudStateForPlayer(0).remainingSeconds, 0);
});

test('the HUD state object is reused and the room list does not grow', () => {
    const harness = createHarness();
    harness.system.startRound();
    openRoom(harness);
    const [player] = harness.players;
    moveTo(player, INSIDE);

    const first = harness.system.getHudStateForPlayer(0);
    tick(harness, 0.016, 400);
    assert.equal(harness.system.getHudStateForPlayer(0), first, 'no object per frame');
    assert.equal(harness.system.getRooms().length, 1);
});

test('the HUD line names the room and rounds the seconds up', () => {
    assert.equal(formatSecretRoomStatus(null), '');
    assert.equal(formatSecretRoomStatus({ inside: false, remainingSeconds: 12 }), '');
    assert.equal(formatSecretRoomStatus({ inside: true, remainingSeconds: 11.2 }), 'GEHEIMRAUM · NOCH 12 s');
    assert.equal(formatSecretRoomStatus({ inside: true, remainingSeconds: -3 }), 'GEHEIMRAUM · NOCH 0 s');
});

test('the projection reads a missing or broken secret room state as outside', () => {
    const empty = createMatchRuntimePlayerProjection({ playerIndex: 0 });
    assert.deepEqual(empty.secretRoom, { inside: false, remainingSeconds: 0, roomId: '' });
    assert.equal(empty.secretRoomsOpen, 0);

    const junk = createMatchRuntimePlayerProjection({
        playerIndex: 0,
        secretRoom: { inside: 'yes', remainingSeconds: 'soon', roomId: 42 },
        secretRoomsOpen: -4,
    });
    assert.deepEqual(junk.secretRoom, { inside: false, remainingSeconds: 0, roomId: '' });
    assert.equal(junk.secretRoomsOpen, 0);

    const live = createMatchRuntimePlayerProjection({
        playerIndex: 0,
        secretRoom: { inside: true, remainingSeconds: 7.5, roomId: 'vault' },
        secretRoomsOpen: 1,
    });
    assert.deepEqual(live.secretRoom, { inside: true, remainingSeconds: 7.5, roomId: 'vault' });
    assert.equal(live.secretRoomsOpen, 1);
});

test('the opened room count only counts rooms that had to be unlocked', () => {
    const harness = createHarness();
    harness.system.startRound();
    assert.equal(harness.system.getOpenedRoomCount(), 0);
    openRoom(harness);
    assert.equal(harness.system.getOpenedRoomCount(), 1);

    const alwaysOpen = createHarness({ rooms: [{ ...ROOM, unlock: undefined }] });
    alwaysOpen.system.startRound();
    assert.equal(alwaysOpen.system.getOpenedRoomCount(), 0, 'a room open from the start is no news');
});

test('the announcer speaks once per opening and stays quiet on a restart', () => {
    const announcer = new SecretRoomAnnouncer();
    assert.equal(announcer.consume(0), null, 'the first look only records');
    assert.equal(announcer.consume(1), 'Ein Portal hat sich geöffnet!');
    assert.equal(announcer.consume(1), null, 'no repeat while it stays open');
    assert.equal(announcer.consume(0), null, 'a round restart is silent');
    assert.equal(announcer.consume(1), 'Ein Portal hat sich geöffnet!');

    const joined = new SecretRoomAnnouncer();
    assert.equal(joined.consume(1), null, 'joining a match with an open room announces nothing');
    announcer.reset();
    assert.equal(announcer.consume(1), null, 'a reset records again before it speaks');
});

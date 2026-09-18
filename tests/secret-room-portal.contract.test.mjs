import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { PortalLayoutBuilder } from '../src/entities/arena/portal/PortalLayoutBuilder.js';
import { PortalRuntimeSystem } from '../src/entities/arena/portal/PortalRuntimeSystem.js';
import { SecretRoomSystem } from '../src/entities/systems/SecretRoomSystem.js';
import { PlayerCollisionPhase } from '../src/entities/systems/lifecycle/PlayerCollisionPhase.js';
import { PlayerInteractionPhase } from '../src/entities/systems/lifecycle/PlayerInteractionPhase.js';
import { evaluatePortalIntent } from '../src/entities/ai/BotPortalOps.js';

const MAP_SCALE = 3;

// Authored in map units, exactly as a preset writes them. The room sits below the arena floor,
// which is where the portal rescue of the authored pairs would drag an endpoint back up.
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

function createMap(rooms = [ROOM]) {
    return { size: [200, 120, 200], secretRooms: rooms.map((room) => ({ ...room })) };
}

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
        currentMapKey: 'secret_room_test',
        currentMapDefinition: null,
        bounds: { minX: -300, maxX: 300, minY: 0, maxY: 180, minZ: -300, maxZ: 300 },
        glbAnimationElapsedSeconds: 0,
        // Everything below the arena floor is solid, so a rescued endpoint could never stay put.
        checkCollision(position) { return position.y < 0; },
        checkCollisionFast(position) { return position.y < 0; },
    };
}

function createDestructible({ active = true, events = [], sealed = false, segmentIds = ['leg_a', 'leg_b'] } = {}) {
    const state = { segments: segmentIds.map((id) => ({ id, hp: 100, destroyed: false })), events, sealed };
    return {
        state,
        isActive: () => active,
        getState: () => state,
    };
}

function createHarness({ rooms = [ROOM], mode = 'HUNT', destructible = createDestructible() } = {}) {
    const arena = createArena();
    const map = createMap(rooms);
    arena.currentMapDefinition = map;
    const builder = new PortalLayoutBuilder(arena);
    builder.build(map, MAP_SCALE);
    const portalRuntime = new PortalRuntimeSystem(arena);
    arena.checkPortal = (position, radius, entityId, previousPosition = null) => (
        portalRuntime.checkPortal(position, radius, entityId, previousPosition)
    );
    arena.checkExitPortal = () => null;
    const entityManager = {
        arena,
        gameModeStrategy: { modeType: mode, getPickupModeType: () => mode },
        _mapDestructibleSystem: destructible,
        _tmpDir: new THREE.Vector3(),
        powerupManager: { checkPickup: () => null },
        audio: null,
        recorder: null,
    };
    const system = new SecretRoomSystem(entityManager);
    return { arena, builder, map, portalRuntime, entityManager, destructible, system };
}

function secretPortals(arena) {
    return arena.portals.filter((portal) => portal.secret === true);
}

function tick(harness, seconds) {
    harness.arena.glbAnimationElapsedSeconds = seconds;
    harness.system.update();
}

test('a secret room builds one portal pair at the authored place, floor or not', () => {
    const { arena } = createHarness();
    const pairs = secretPortals(arena);

    assert.equal(arena.portals.length, 1, 'exactly one pair belongs to the room');
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].roomId, 'vault');
    assert.deepEqual(pairs[0].posA.toArray(), [120, 30, 0]);
    // The way back is below the floor on purpose and must not be rescued back into the arena.
    assert.deepEqual(pairs[0].posB.toArray(), [0, -180, 0]);
    assert.equal(pairs[0].color, 0x44ddff);
});

test('a locked pair teleports neither players nor projectiles and stays invisible', () => {
    const harness = createHarness();
    harness.system.startRound();
    const [portal] = secretPortals(harness.arena);

    assert.equal(portal.active, false);
    assert.equal(portal.meshA.visible, false);
    assert.equal(portal.meshB.visible, false);
    assert.equal(harness.arena.checkPortal(portal.posA.clone(), 0.8, 0), null, 'no player travel');
    assert.equal(harness.arena.checkPortal(portal.posB.clone(), 0.5, 'proj:7'), null, 'no projectile travel');
});

test('a break plus the authored delay opens the pair for good', () => {
    const harness = createHarness();
    harness.system.startRound();
    const [portal] = secretPortals(harness.arena);

    harness.destructible.state.events.push({ segmentId: 'leg_a', kind: 'leg_low', atSeconds: 10, yaw: 0 });
    tick(harness, 13.9);
    assert.equal(portal.active, false, 'still shut one tenth before the delay is over');
    assert.equal(harness.arena.checkPortal(portal.posA.clone(), 0.8, 0), null);

    tick(harness, 14);
    assert.equal(portal.active, true);
    assert.equal(portal.meshA.visible, true);
    assert.equal(portal.meshB.visible, true);
    const travel = harness.arena.checkPortal(portal.posA.clone(), 0.8, 0);
    assert.equal(travel?.ok, true);
    assert.deepEqual(travel.target.toArray(), [0, -180, 0]);

    tick(harness, 400);
    assert.equal(portal.active, true, 'an open portal stays open until the round ends');
});

test('a named segment and a sealed structure each drive their own second', () => {
    const named = createHarness({
        rooms: [{ ...ROOM, unlock: { destructible: 'reactor', when: { segmentId: 'leg_b' }, delaySeconds: 2 } }],
    });
    named.system.startRound();
    named.destructible.state.events.push({ segmentId: 'leg_a', kind: 'leg_low', atSeconds: 5, yaw: 0 });
    tick(named, 8);
    assert.equal(secretPortals(named.arena)[0].active, false, 'another part does not count');
    named.destructible.state.events.push({ segmentId: 'leg_b', kind: 'leg_low', atSeconds: 9, yaw: 0 });
    tick(named, 10.9);
    assert.equal(secretPortals(named.arena)[0].active, false);
    tick(named, 11);
    assert.equal(secretPortals(named.arena)[0].active, true);

    const sealed = createHarness({
        rooms: [{ ...ROOM, unlock: { destructible: 'reactor', when: 'sealed', delaySeconds: 1 } }],
    });
    sealed.system.startRound();
    sealed.destructible.state.events.push({ segmentId: 'leg_a', kind: 'leg_low', atSeconds: 6, yaw: 0 });
    tick(sealed, 30);
    assert.equal(secretPortals(sealed.arena)[0].active, false, 'a single break does not seal the structure');
    sealed.destructible.state.sealed = true;
    sealed.destructible.state.events.push({ segmentId: 'leg_b', kind: 'summit', atSeconds: 12, yaw: 0 });
    tick(sealed, 13);
    assert.equal(secretPortals(sealed.arena)[0].active, true);
});

test('a room opens from the start when nothing can unlock it', () => {
    const withoutUnlock = createHarness({ rooms: [{ ...ROOM, unlock: undefined }] });
    withoutUnlock.system.startRound();
    assert.equal(secretPortals(withoutUnlock.arena)[0].active, true, 'no unlock means open');

    const inactiveInMode = createHarness({ destructible: createDestructible({ active: false }) });
    inactiveInMode.system.startRound();
    assert.equal(secretPortals(inactiveInMode.arena)[0].active, true, 'A5: nothing destructible in this mode');

    const unknownSegment = createHarness({
        rooms: [{ ...ROOM, unlock: { destructible: 'reactor', when: { segmentId: 'ghost_leg' }, delaySeconds: 4 } }],
    });
    unknownSegment.system.startRound();
    assert.equal(secretPortals(unknownSegment.arena)[0].active, true, 'A5: the named part does not exist');
});

// The pair is not removed: a built arena can be played again in another mode without a rebuild,
// and a pair spliced away once would then be missing for good. It simply stays shut and hidden.
test('a room that is not active in this mode stays shut for the whole round', () => {
    const harness = createHarness({ rooms: [{ ...ROOM, modes: ['ARCADE'] }], mode: 'HUNT' });
    harness.system.startRound();
    harness.destructible.state.events.push({ segmentId: 'leg_a', kind: 'leg_low', atSeconds: 1, yaw: 0 });
    tick(harness, 60);

    const [portal] = secretPortals(harness.arena);
    assert.equal(portal.active, false);
    assert.equal(portal.meshA.visible, false);
    assert.equal(harness.system.getRooms().length, 0);

    // The same arena, now played in the room's own mode.
    harness.entityManager.gameModeStrategy = { modeType: 'ARCADE', getPickupModeType: () => 'ARCADE' };
    harness.system.startRound();
    assert.equal(harness.system.getRooms().length, 1, 'the pair is still there for the next mode');
});

test('a round restart shuts the pair again and builds nothing twice', () => {
    const harness = createHarness();
    harness.system.startRound();
    harness.destructible.state.events.push({ segmentId: 'leg_a', kind: 'leg_low', atSeconds: 1, yaw: 0 });
    tick(harness, 20);
    assert.equal(secretPortals(harness.arena)[0].active, true);

    harness.destructible.state.events.length = 0;
    harness.arena.glbAnimationElapsedSeconds = 0;
    harness.system.startRound();
    assert.equal(secretPortals(harness.arena).length, 1, 'the restart adds no second pair');
    assert.equal(secretPortals(harness.arena)[0].active, false);

    // Rebuilding the arena hands the old meshes back and starts from one pair again.
    const firstBatch = harness.arena.scene.children[0];
    harness.builder.build(harness.map, MAP_SCALE);
    assert.equal(secretPortals(harness.arena).length, 1);
    assert.equal(harness.arena.scene.children.includes(firstBatch), false, 'the old instanced mesh is released');
});

test('a replica opens the portal in the very same second as the host', () => {
    const host = createHarness();
    const replicaState = [{ segmentId: 'leg_a', kind: 'leg_low', atSeconds: 10, yaw: 0 }];
    const replica = createHarness({ destructible: createDestructible({ events: replicaState }) });
    host.system.startRound();
    replica.system.startRound();
    host.destructible.state.events.push(...replicaState.map((event) => ({ ...event })));

    tick(host, 13.9);
    tick(replica, 13.9);
    assert.equal(secretPortals(host.arena)[0].active, secretPortals(replica.arena)[0].active);
    tick(host, 14);
    tick(replica, 14);
    assert.equal(secretPortals(replica.arena)[0].active, true);
});

test('bots never pick a secret portal as their target', () => {
    const harness = createHarness();
    harness.system.startRound();
    tick(harness, 0);
    harness.destructible.state.events.push({ segmentId: 'leg_a', kind: 'leg_low', atSeconds: 0, yaw: 0 });
    tick(harness, 4);
    assert.equal(secretPortals(harness.arena)[0].active, true, 'an open portal is the hard case');

    const probed = [];
    harness.arena.checkCollisionFast = (position) => {
        probed.push(position.clone());
        return false;
    };
    const player = {
        position: new THREE.Vector3(110, 30, 0),
        hitboxRadius: 0.8,
        getDirection: (target) => target.set(1, 0, 0),
    };
    const bot = {
        profile: {
            portalInterest: 1,
            portalSeekDistance: 60,
            portalEntryDotMin: -1,
            portalIntentThreshold: -999,
            portalIntentDuration: 1,
        },
        state: {},
        sense: { forwardRisk: 1, mapPortalBias: 1 },
        _tmpVec: new THREE.Vector3(),
        _tmpVec3: new THREE.Vector3(),
        _tmpForward: new THREE.Vector3(),
        _portalEntry: new THREE.Vector3(),
        _portalExit: new THREE.Vector3(),
        checkTrailHit: () => false,
    };

    evaluatePortalIntent(bot, player, harness.arena, [player]);
    assert.equal(bot.state.portalIntentActive, false);
    assert.equal(probed.length, 0, 'a secret portal is not even measured');
});

test('travelling into the room is no wall death', () => {
    const harness = createHarness({ rooms: [{ ...ROOM, unlock: undefined }] });
    harness.system.startRound();
    const [portal] = secretPortals(harness.arena);

    const interaction = new PlayerInteractionPhase(harness.entityManager);
    harness.entityManager._tmpPrevPlayerPosition = new THREE.Vector3();
    const player = {
        index: 0,
        isBot: false,
        hitboxRadius: 0.8,
        position: portal.posA.clone(),
        quaternion: new THREE.Quaternion(),
        getAimDirection: (target) => target.set(0, -1, 0),
        trail: { gaps: 0, forceGap() { this.gaps += 1; } },
        pickupRadiusMultiplier: 1,
    };
    interaction.runPortalAndPickup(player, portal.posA.clone());

    assert.ok(player.position.y < -100, 'the player arrives inside the room');
    assert.equal(player.trail.gaps, 1, 'the trail is cut at the jump');

    // The next tick starts its sweep at the arrival point, so the jump itself is never swept.
    const prevPos = interaction.capturePreviousPosition(player);
    assert.deepEqual(prevPos.toArray(), player.position.toArray());
    const collision = new PlayerCollisionPhase(harness.entityManager);
    assert.equal(collision._probeSweptArenaCollision(player, prevPos, player.hitboxRadius), null);
});

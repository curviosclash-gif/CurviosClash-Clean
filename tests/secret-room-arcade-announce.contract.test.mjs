import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { PortalLayoutBuilder } from '../src/entities/arena/portal/PortalLayoutBuilder.js';
import { MapDestructibleSystem } from '../src/entities/systems/MapDestructibleSystem.js';
import { SecretRoomSystem } from '../src/entities/systems/SecretRoomSystem.js';
import { SecretRoomAnnouncer } from '../src/ui/SecretRoomAnnouncer.js';
import {
    REACTOR_SITE_DESTRUCTIBLES,
} from '../src/core/config/maps/presets/reactor_site/ReactorSiteDestructibles.js';
import {
    REACTOR_SITE_SECRET_ROOM,
} from '../src/core/config/maps/presets/reactor_site/ReactorSiteSecretRoom.js';

const MAP_SCALE = 3;

/**
 * Why this test exists: the portal announcement hangs on the Hunt HUD, and the arcade HUD has none.
 * That is only acceptable while an arcade run can never see a portal open mid match. The two systems
 * below decide that between them - the destructible block is gated on the raw mode, the room on the
 * combat mode - so the guard belongs here and not in any HUD.
 */
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
        currentMapKey: 'reactor_site',
        currentMapDefinition: null,
        bounds: { minX: -600, maxX: 600, minY: 0, maxY: 400, minZ: -600, maxZ: 600 },
        glbAnimationElapsedSeconds: 0,
        checkCollision: () => false,
        checkCollisionFast: () => false,
    };
}

/**
 * @param {{ modeType: string, combatModeType: string }} modes
 */
function createHarness({ modeType, combatModeType }) {
    const arena = createArena();
    const map = {
        size: [200, 120, 200],
        secretRooms: [REACTOR_SITE_SECRET_ROOM],
        destructibles: REACTOR_SITE_DESTRUCTIBLES,
    };
    arena.currentMapDefinition = map;
    new PortalLayoutBuilder(arena).build(map, MAP_SCALE);

    const entityManager = {
        arena,
        players: [],
        gameModeStrategy: { modeType, getPickupModeType: () => combatModeType },
        _mapDestructibleSystem: null,
    };
    const destructible = new MapDestructibleSystem(entityManager);
    entityManager._mapDestructibleSystem = destructible;
    destructible.startRound();

    const rooms = new SecretRoomSystem(entityManager);
    rooms.startRound();
    return { arena, destructible, rooms };
}

test('an arcade run never sees a secret room open, so it needs no announcement', () => {
    const harness = createHarness({ modeType: 'ARCADE', combatModeType: 'HUNT' });
    const announcer = new SecretRoomAnnouncer();

    assert.equal(harness.destructible.isActive(), false, 'the plant cannot be broken in arcade');
    assert.deepEqual(harness.rooms.getRooms().map((entry) => entry.open), [true],
        'a room that can never be earned stands open from the first second');

    announcer.consume(harness.rooms.getOpenedRoomCount());
    for (let second = 1; second <= 30; second += 1) {
        harness.arena.glbAnimationElapsedSeconds = second;
        harness.rooms.update(1);
        assert.equal(harness.rooms.getOpenedRoomCount(), 0, `nothing opens at second ${second}`);
        assert.equal(announcer.consume(harness.rooms.getOpenedRoomCount()), null);
    }
});

test('a hunt run does see it open, which is the case the announcement is for', () => {
    const harness = createHarness({ modeType: 'HUNT', combatModeType: 'HUNT' });
    const announcer = new SecretRoomAnnouncer();

    assert.equal(harness.destructible.isActive(), true);
    assert.deepEqual(harness.rooms.getRooms().map((entry) => entry.open), [false],
        'the room stays shut until something breaks');
    announcer.consume(harness.rooms.getOpenedRoomCount());

    harness.destructible.getState().events.push({ segmentId: 'reactor_hall', kind: 'hall', atSeconds: 2, yaw: 0 });
    harness.arena.glbAnimationElapsedSeconds = 12;
    harness.rooms.update(1);

    assert.equal(harness.rooms.getOpenedRoomCount(), 1);
    assert.equal(announcer.consume(harness.rooms.getOpenedRoomCount()), 'Ein Portal hat sich geöffnet!');
});

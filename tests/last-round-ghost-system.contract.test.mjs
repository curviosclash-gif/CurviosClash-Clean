import assert from 'node:assert/strict';
import test from 'node:test';

import { LastRoundGhostSystem } from '../src/entities/LastRoundGhostSystem.js';
import {
    hideKillcamLivePresentation,
    restoreKillcamLivePresentation,
} from '../src/hunt/KillcamPresentationOps.js';

function createRendererStub() {
    return {
        addToScene() {},
        removeFromScene() {},
    };
}

function createTrailCollisionEntityManagerStub() {
    const registrations = [];
    const unregistrations = [];
    const trailSpatialIndex = {
        registerTrailSegment(playerIndex, segmentIdx, data, reusableRef = null) {
            const entry = { playerIndex, segmentIdx, ...data };
            const ref = reusableRef || { key: `${playerIndex}:${segmentIdx}`, entry };
            ref.entry = entry;
            registrations.push({ playerIndex, segmentIdx, data, ref });
            return ref;
        },
        unregisterTrailSegment(key, entry) {
            unregistrations.push({ key, entry });
        },
    };

    return {
        registrations,
        unregistrations,
        entityManager: {
            entityRuntimeConfig: {
                TRAIL: {
                    WIDTH: 0.6,
                    UPDATE_INTERVAL: 0.07,
                    GAP_CHANCE: 0,
                    GAP_DURATION: 0.5,
                    MAX_SEGMENTS: 1400,
                    GHOST_COLLISION_ENABLED: true,
                },
                HUNT: {
                    TRAIL_SEGMENT_HP: 3,
                },
            },
            getTrailSpatialIndex() {
                return trailSpatialIndex;
            },
        },
    };
}

function createPlayableClip() {
    return {
        routeId: 'route_collision',
        sourceDuration: 1,
        displayDuration: 1,
        players: [{ idx: 0, color: 0xffffff }],
        frames: [
            { time: 0, players: [{ idx: 0, x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }] },
            { time: 1, players: [{ idx: 0, x: 4, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }] },
        ],
    };
}

test('LastRoundGhostSystem renders ghost trails in white independent of player color', () => {
    const system = new LastRoundGhostSystem(createRendererStub());

    assert.equal(system.playClip({
        ...createPlayableClip(),
        players: [{ idx: 0, color: 0x00aaff }],
    }), true);

    const trail = system._entries[0]?.trail;
    assert.equal(trail?.color, 0xffffff);
    assert.equal(trail?.material?.color?.getHex(), 0xffffff);
    assert.equal(trail?.material?.emissive?.getHex(), 0xffffff);

    system.dispose();
});

test('LastRoundGhostSystem replays live vehicle views for the immediate killcam only', () => {
    const system = new LastRoundGhostSystem(createRendererStub());
    const liveGroup = new system.root.constructor();
    liveGroup.visible = false;
    let syncCount = 0;
    const livePlayer = {
        index: 0,
        alive: false,
        group: liveGroup,
        view: {
            group: liveGroup,
            syncFromState() {
                syncCount += 1;
            },
        },
    };

    assert.equal(system.playClip(createPlayableClip(), {
        loop: false,
        useLivePlayerViews: true,
        livePlayers: [livePlayer],
    }), true);
    assert.equal(system._entries[0]?.group, liveGroup);
    assert.equal(system._entries[0]?.usesLivePresentation, true);
    assert.equal(system.usesReplayPresentationObject(liveGroup), true);
    assert.equal(liveGroup.visible, true);

    const liveTrail = { visible: true };
    livePlayer.trail = { mesh: liveTrail };
    const presentation = {
        ghostSystem: system,
        entityManager: { projectiles: [] },
        _presentationEntries: [],
    };
    hideKillcamLivePresentation(presentation, [livePlayer]);
    assert.equal(liveGroup.visible, true);
    assert.equal(liveTrail.visible, false);
    restoreKillcamLivePresentation(presentation);
    assert.equal(liveTrail.visible, true);

    system.clear();
    assert.equal(syncCount, 1);
    assert.equal(liveGroup.visible, false);
    assert.equal(system.usesReplayPresentationObject(liveGroup), false);
    system.dispose();
});

test('LastRoundGhostSystem normalizes broken time and pose data without destabilizing playback', () => {
    const system = new LastRoundGhostSystem(createRendererStub());
    const playable = system.playClip({
        routeId: 'route_alpha',
        sourceDuration: 2,
        displayDuration: 1,
        frames: [
            { time: 0, players: [{ idx: 0, x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }] },
            { time: 0.7, players: [{ idx: 0, x: Number.POSITIVE_INFINITY, y: 0, z: 0, qx: Number.NaN, qy: 0, qz: 0, qw: 0 }] },
            { time: 0.4, players: [{ idx: 0, x: 4, y: 0, z: 1, qx: 0, qy: 0.5, qz: 0, qw: 0.5 }] },
            { time: 2, players: [{ idx: 0, x: 8, y: 0, z: 2, qx: 0, qy: 0, qz: 0, qw: 0 }] },
        ],
    });

    assert.equal(playable, true);
    const initialState = system.getState();
    assert.equal(initialState.trailCount, 1);
    assert.equal(initialState.trailPointCount, 0);
    assert.equal(initialState.trailSegmentCount, 0);
    assert.equal(initialState.ghosts[0]?.trailSegments, 0);
    assert.doesNotThrow(() => system.update(0.25));
    assert.doesNotThrow(() => system.update(0.5));

    const state = system.getState();
    assert.equal(state.active, true);
    assert.equal(state.routeId, 'route_alpha');
    assert.equal(state.frameCount, 4);
    assert.equal(state.trailCount, 1);
    assert.equal(state.trailPointCount > 1, true);
    assert.equal(state.trailSegmentCount > 0, true);
    assert.equal(state.ghosts[0]?.trailPoints > 1, true);
    assert.equal(state.ghosts[0]?.trailSegments > 0, true);
    assert.equal(Number.isFinite(state.ghosts[0]?.x), true);
    assert.equal(Number.isFinite(state.ghosts[0]?.y), true);
    assert.equal(Number.isFinite(state.ghosts[0]?.z), true);
    assert.equal(system._entries[0]?.trail?.mesh?.isInstancedMesh, true);
    assert.equal(Number.isFinite(system._entries[0]?.group?.quaternion?.x), true);
    assert.equal(Number.isFinite(system._entries[0]?.group?.quaternion?.w), true);

    system.update(0.3);
    const loopedState = system.getState();
    assert.equal(loopedState.trailSegmentCount, 0);
    assert.equal(loopedState.ghosts[0]?.trailSegments, 0);

    system.dispose();
});

test('LastRoundGhostSystem holds the final frame when looping is disabled', () => {
    const system = new LastRoundGhostSystem(createRendererStub());
    assert.equal(system.playClip(createPlayableClip(), { loop: false }), true);

    system.update(1.25);
    const finalState = system.getState();
    assert.equal(finalState.loopPlayback, false);
    assert.equal(finalState.frameCursor, 1);
    assert.equal(finalState.ghosts[0]?.x, 4);

    system.update(1);
    const heldState = system.getState();
    assert.equal(heldState.frameCursor, 1);
    assert.equal(heldState.ghosts[0]?.x, 4);
    system.dispose();
});

test('LastRoundGhostSystem seeks explicit source time without display-time remapping', () => {
    const system = new LastRoundGhostSystem(createRendererStub());
    assert.equal(system.playClip({
        ...createPlayableClip(),
        displayDuration: 2.5,
    }, { loop: false }), true);

    assert.equal(system.seekSourceTime(0.8), true);
    assert.equal(system.getState().ghosts[0]?.x, 3.2);

    assert.equal(system.seekSourceTime(0.2), true);
    assert.equal(system.getState().ghosts[0]?.x, 0.8);
    system.dispose();
});

test('LastRoundGhostSystem preserves a valid 180-degree quaternion with w zero', () => {
    const system = new LastRoundGhostSystem(createRendererStub());
    assert.equal(system.playClip({
        routeId: 'route_half_turn',
        sourceDuration: 1,
        displayDuration: 1,
        players: [{ idx: 0, color: 0xffffff }],
        frames: [
            { time: 0, players: [{ idx: 0, alive: true, x: 0, y: 0, z: 0, qx: 0, qy: 1, qz: 0, qw: 0 }] },
            { time: 1, players: [{ idx: 0, alive: true, x: 1, y: 0, z: 0, qx: 0, qy: 1, qz: 0, qw: 0 }] },
        ],
    }), true);

    system.update(0.25);
    assert.equal(Math.abs(system._entries[0].group.quaternion.w) < 0.000001, true);
    assert.equal(Math.abs(system._entries[0].group.quaternion.y - 1) < 0.000001, true);
    system.dispose();
});

test('LastRoundGhostSystem keeps ghost trail visual-only by default', () => {
    const collision = createTrailCollisionEntityManagerStub();
    const system = new LastRoundGhostSystem(createRendererStub(), {
        entityManager: collision.entityManager,
    });

    assert.equal(system.playClip(createPlayableClip()), true);
    system.update(0.25);
    system.update(0.25);

    const state = system.getState();
    assert.equal(collision.registrations.length, 0);
    assert.equal(state.configuredTrailCollisionEnabled, false);
    assert.equal(state.trailCollisionEnabled, false);
    assert.equal(state.ghosts[0]?.trailCollisionEnabled, false);

    system.dispose();
});

test('LastRoundGhostSystem registers ghost trail as collidable with a non-player owner id when enabled', () => {
    const collision = createTrailCollisionEntityManagerStub();
    const system = new LastRoundGhostSystem(createRendererStub(), {
        entityManager: collision.entityManager,
        ghostTrailCollisionEnabled: true,
    });

    assert.equal(system.playClip(createPlayableClip()), true);
    system.update(0.25);
    system.update(0.25);

    const firstRegistration = collision.registrations[0];
    const state = system.getState();
    assert.ok(firstRegistration);
    assert.equal(firstRegistration.playerIndex >= 10000, true);
    assert.notEqual(firstRegistration.playerIndex, 0);
    assert.equal(state.configuredTrailCollisionEnabled, true);
    assert.equal(state.trailCollisionEnabled, true);
    assert.equal(state.ghosts[0]?.trailCollisionEnabled, true);

    system.dispose();
});

test('LastRoundGhostSystem unregisters collidable ghost trail segments when cleared', () => {
    const collision = createTrailCollisionEntityManagerStub();
    const system = new LastRoundGhostSystem(createRendererStub(), {
        entityManager: collision.entityManager,
        ghostTrailCollisionEnabled: true,
    });

    assert.equal(system.playClip(createPlayableClip()), true);
    system.update(0.25);
    system.update(0.25);

    const registrationCount = collision.registrations.length;
    assert.equal(registrationCount > 0, true);

    system.clear();

    assert.equal(collision.unregistrations.length, registrationCount);
    assert.equal(system.getState().active, false);

    system.dispose();
});

test('LastRoundGhostSystem rejects ghost clips that are not renderable', () => {
    const system = new LastRoundGhostSystem(createRendererStub());
    const playable = system.playClip({
        sourceDuration: 1,
        displayDuration: 1,
        frames: [
            { time: 0, players: [{ idx: 0, x: 0, y: 0, z: 0, alive: false }] },
            { time: 1, players: [{ idx: 0, x: 1, y: 0, z: 0, alive: false }] },
        ],
    });

    assert.equal(playable, false);
    assert.equal(system.getState().active, false);

    system.dispose();
});

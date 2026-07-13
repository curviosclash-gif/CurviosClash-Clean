import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { createGameStateSnapshot } from '../src/core/GameStateSnapshot.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { GameRuntimeArcadeSupport } from '../src/core/runtime/GameRuntimeArcadeSupport.js';
import { Arena } from '../src/entities/Arena.js';
import { EntityManager } from '../src/entities/EntityManager.js';
import { Trail } from '../src/entities/Trail.js';
import { PlayerInteractionPhase } from '../src/entities/systems/lifecycle/PlayerInteractionPhase.js';
import { StateReconciler } from '../src/network/StateReconciler.js';
import { GAMEPLAY_CAMERA_MODE_ID } from '../src/shared/contracts/CameraModeContract.js';
import {
    beginArcadeSector,
    createArcadeRunState,
} from '../src/state/arcade/ArcadeRunState.js';
import {
    checkMissionComplete,
    createMissionInstance,
    createSectorMissionState,
    updateSectorMissionState,
} from '../src/state/arcade/ArcadeMissionState.js';
import { RoundSnapshotStore } from '../src/state/recorder/RoundSnapshotStore.js';
import { CrosshairSystem } from '../src/ui/CrosshairSystem.js';
import { HUD } from '../src/ui/HUD.js';

function createVector(x = 0, y = 0, z = 0) {
    return { x, y, z };
}

test('network snapshot reconciles Player hp, shield, inventory, alive state and a zero quaternion w', () => {
    const hostPlayer = {
        id: 'host-player',
        index: 0,
        isBot: false,
        alive: false,
        position: createVector(4, 5, 6),
        quaternion: { x: 0, y: 1, z: 0, w: 0 },
        velocity: createVector(1, 0, 0),
        hp: 23,
        score: 12,
        inventory: ['SHIELD'],
        activeEffects: [],
        hasShield: true,
        shieldHP: 7,
        speed: 18,
    };
    const snapshot = createGameStateSnapshot({ players: [hostPlayer] }, { frame: 9 });

    assert.equal(snapshot.players[0].health, 23);
    assert.deepEqual(snapshot.players[0].rot, [0, 1, 0, 0]);

    const visibility = [];
    const clientPlayer = {
        index: 0,
        alive: true,
        position: createVector(),
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        velocity: createVector(),
        activeEffects: [],
        hp: 99,
        health: 99,
        shieldHP: 40,
        hasShield: false,
        inventory: ['ROCKET'],
        view: { setVisible(value) { visibility.push(value); } },
    };
    const reconciler = new StateReconciler({
        positionSnapThreshold: 0,
        rotationSnapThreshold: 0,
        velocitySnapThreshold: 0,
    });
    reconciler.receiveServerState({ state: snapshot });
    reconciler.reconcile([clientPlayer], {});

    assert.equal(clientPlayer.hp, 23);
    assert.equal(clientPlayer.health, 23);
    assert.equal(clientPlayer.shieldHP, 7);
    assert.equal(clientPlayer.hasShield, true);
    assert.deepEqual(clientPlayer.inventory, ['SHIELD']);
    assert.equal(clientPlayer.alive, false);
    assert.deepEqual(visibility, [false]);
    assert.equal(clientPlayer.quaternion.w, 0);
});

test('round snapshots and HUD consumers preserve a valid quaternion w of zero', () => {
    const store = new RoundSnapshotStore({ maxSnapshots: 2, timeProvider: () => 1 });
    store.capture([{
        index: 0,
        alive: true,
        isBot: false,
        position: createVector(),
        quaternion: { x: 0, y: 1, z: 0, w: 0 },
    }]);
    assert.equal(store.getOrderedSnapshots()[0].players[0].qw, 0);

    const classNames = new Set(['hidden']);
    const hud = Object.assign(Object.create(HUD.prototype), {
        visible: false,
        container: {
            classList: {
                add(value) { classNames.add(value); },
                remove(value) { classNames.delete(value); },
            },
        },
        configSource: null,
        boostFill: null,
        lifeBar: null,
        lifeFill: null,
        horizon: null,
        pitchLadder: null,
        bankLine: null,
        bankAngle: null,
        centerCrosshair: null,
        speedValue: null,
        altValue: null,
        speedScale: null,
        altScale: null,
        headingValue: null,
        headingScale: null,
        lockTarget: null,
        lockReticle: null,
        lockDist: null,
        _quat: new THREE.Quaternion(),
        _euler: new THREE.Euler(),
        _playerPosition: new THREE.Vector3(),
        _targetPosition: new THREE.Vector3(),
    });
    const player = {
        alive: true,
        cameraModeId: GAMEPLAY_CAMERA_MODE_ID,
        quaternion: { x: 0, y: 1, z: 0, w: 0 },
        position: createVector(),
    };
    hud.update(player, 0);
    assert.equal(hud._quat.w, 0);

    const previousWindow = globalThis.window;
    globalThis.window = { innerWidth: 800, innerHeight: 600 };
    try {
        const camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 1000);
        camera.updateMatrixWorld(true);
        const crosshair = new CrosshairSystem({
            game: {
                renderer: { cameras: [camera] },
                numHumans: 1,
                runtimeConfig: { session: { networkEnabled: false } },
            },
        });
        const element = {
            style: {},
            classList: { toggle() {} },
        };
        crosshair._updateCrosshairPosition({
            ...player,
            index: 0,
            aimDirection: { x: 0, y: 0, z: -1 },
        }, element);
        assert.equal(crosshair._tmpQuat.w, 0);
    } finally {
        if (previousWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = previousWindow;
        }
    }
});

test('NO_DAMAGE completes only at sector completion and remains failed after a hit', () => {
    const pristine = createMissionInstance('NO_DAMAGE');
    assert.equal(checkMissionComplete(pristine), false);

    const completedState = updateSectorMissionState(
        createSectorMissionState([pristine]),
        { type: 'sector_complete', elapsed: 12 }
    );
    assert.equal(completedState.missions[0].completed, true);

    let damagedState = updateSectorMissionState(
        createSectorMissionState([createMissionInstance('NO_DAMAGE')]),
        { type: 'damage', hp: 50, maxHp: 100 }
    );
    damagedState = updateSectorMissionState(damagedState, { type: 'sector_complete', elapsed: 12 });
    assert.equal(damagedState.missions[0].progress.hitCount, 1);
    assert.equal(damagedState.missions[0].completed, false);
});

test('Arcade runtime advances survival missions and finalizes sector-bound missions', () => {
    const runtime = new ArcadeRunRuntime({ now: () => 1000 });
    runtime._enabled = true;
    runtime._state = beginArcadeSector(createArcadeRunState({
        config: { enabled: true, sectorCount: 2 },
        nowMs: 0,
        runId: 'mission-runtime-test',
    }), 0);
    const missions = [
        createMissionInstance('SURVIVE_DURATION', { target: 1 }),
        createMissionInstance('NO_DAMAGE'),
    ];
    runtime._missionState = createSectorMissionState(missions);
    runtime._state.missions = runtime._missionState;
    runtime._prepareIntermission = () => null;

    runtime.tickGameplay(1.1);
    assert.equal(runtime._missionState.missions[0].completed, true);
    assert.equal(runtime._missionState.missions[1].completed, false);

    runtime.deriveRoundEndPlan({
        players: [{ index: 0, isBot: false, alive: true, hp: 100 }],
        inputs: { reason: 'SURVIVAL' },
        baseController: { defaultRoundPause: 3 },
    });
    assert.equal(runtime._missionState.missions[1].completed, true);
    assert.equal(runtime._missionState.allCompleted, true);
});

test('Arcade support binds the productive entity gameplay-event seam', () => {
    const entityManager = {};
    const support = new GameRuntimeArcadeSupport({
        getRuntimeState: () => ({ entityManager }),
        getGame: () => null,
    });
    const received = [];
    support.arcadeRunRuntime = {
        applyGameplayEvent(event) { received.push(event); },
    };

    support._bindGameplayCallback({ entityManager });
    entityManager.onArcadeGameplayEvent({ type: 'kill', count: 1 });
    assert.deepEqual(received, [{ type: 'kill', count: 1 }]);

    support._unbindGameplayCallback();
    assert.equal(entityManager.onArcadeGameplayEvent, null);
});

test('entity gameplay sources emit damage, kill, self-collision, trail and interaction events', () => {
    const events = [];
    const target = {
        index: 0,
        isBot: false,
        alive: true,
        hp: 15,
        maxHp: 100,
        position: createVector(),
        kill() { this.alive = false; this.hp = 0; },
    };
    const killer = { index: 1, isBot: false, alive: true };
    const manager = Object.assign(Object.create(EntityManager.prototype), {
        players: [target, killer],
        onArcadeGameplayEvent(event) { events.push(event); },
        recorder: null,
        particles: null,
        audio: null,
        gameModeStrategy: {
            hasDamageEvents: () => false,
            hasScoring: () => false,
        },
        _eventBus: {
            emitHuntDamageEvent() {},
            emitPlayerDied() {},
        },
        _parcoursProgressSystem: null,
        _respawnSystem: { onPlayerDied() {} },
    });

    manager._emitHuntDamageEvent({
        target,
        damageResult: { applied: 10 },
    });
    manager._killPlayer(target, 'PROJECTILE', { killer });
    target.alive = true;
    manager._killPlayer(target, 'TRAIL_SELF');

    const interactionManager = {
        arena: {
            checkExitPortal: () => ({ triggered: true, ok: true, code: 'portal.exit.trigger', type: 'EXIT_PORTAL' }),
            checkPortal: () => null,
        },
        powerupManager: {
            checkPickup: () => ({ ok: true, code: 'item.pickup.success', type: 'SHIELD' }),
        },
        audio: null,
        particles: null,
        recorder: { logEvent() {} },
        _emitArcadeGameplayEvent(event) { events.push(event); },
    };
    new PlayerInteractionPhase(interactionManager).runPortalAndPickup({
        index: 0,
        position: createVector(),
        hitboxRadius: 1,
        addToInventory() {},
    });

    const trailSpatialIndex = {
        registerTrailSegment(_playerIndex, _segmentIndex, data) {
            return { key: 'segment', entry: data };
        },
        unregisterTrailSegment() {},
    };
    const trailEntityManager = {
        onArcadeGameplayEvent() {},
        entityRuntimeConfig: {
            TRAIL: { WIDTH: 0.6, MAX_SEGMENTS: 2, UPDATE_INTERVAL: 0.07, GAP_CHANCE: 0, GAP_DURATION: 0.5 },
            HUNT: { TRAIL_SEGMENT_HP: 3 },
        },
        getTrailSpatialIndex: () => trailSpatialIndex,
        _emitArcadeGameplayEvent(event) { events.push(event); },
    };
    const trail = new Trail({ addToScene() {}, removeFromScene() {} }, 0xffffff, 0, trailEntityManager);
    trail._addSegment(0, 0, 0, 2, 0, 0);
    trail.dispose();

    assert.deepEqual(events.map((event) => event.type), [
        'damage',
        'kill',
        'self_collision',
        'exit_portal',
        'collect',
        'trail_extend',
    ]);
});

test('Arena forwards exit-portal checks through its portal system', () => {
    const calls = [];
    const arena = Object.assign(Object.create(Arena.prototype), {
        _portalGateSystem: {
            checkExitPortal(position, radius, entityId) {
                calls.push({ position, radius, entityId });
                return { triggered: true };
            },
        },
    });
    const position = createVector(1, 2, 3);
    assert.deepEqual(arena.checkExitPortal(position, 2, 7), { triggered: true });
    assert.deepEqual(calls, [{ position, radius: 2, entityId: 7 }]);
});

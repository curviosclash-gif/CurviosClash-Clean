import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { createGameStateSnapshot } from '../src/core/GameStateSnapshot.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { updateReplayProjection } from '../src/core/recording/CinematicReplayProjection.js';
import { resolveMapSandstormLighting, resolveSandstormLighting } from '../src/core/renderer/SandstormLightingOps.js';
import { isTargetVisibleToPlayer } from '../src/entities/ai/BotTargetingOps.js';
import { EntityTickPipeline } from '../src/entities/runtime/EntityTickPipeline.js';
import { MapSandstormSystem } from '../src/entities/systems/MapSandstormSystem.js';
import {
    MAP_SANDSTORM_PHASES,
    createMapSandstormState,
    isPositionInSandstormShelter,
    normalizeMapSandstorm,
    resolveMapSandstormIntensity,
} from '../src/shared/contracts/MapSandstormContract.js';
import { createMatchRuntimeProjection } from '../src/shared/contracts/MatchRuntimeProjectionContract.js';
import { createRuntimeRng } from '../src/shared/contracts/RuntimeRngContract.js';

const CONFIG = {
    enabled: true,
    initialDelaySeconds: [45, 90],
    repeatDelaySeconds: [90, 150],
    warningSeconds: 20,
    activeSeconds: 60,
    ingressSeconds: 4,
    egressSeconds: 4,
    outdoorNear: 8,
    outdoorFar: 40,
    shelterNear: 18,
    shelterFar: 85,
    proximityCueRange: 18,
    shelterVolumes: [{ id: 'hall', min: [-10, 0, -10], max: [10, 20, 10] }],
};

function createOwner(seed = 123) {
    const rendered = [];
    const owner = {
        matchSeed: seed,
        runtimeRng: createRuntimeRng({ seed }),
        runtimeConfig: { gameplay: {} },
        players: [],
        arena: {
            currentMapDefinition: {
                size: [260, 160, 260],
                scaleAuthoredAnchors: true,
                sandstorm: CONFIG,
            },
            raycast: () => ({ hit: false }),
        },
        renderer: {
            cameras: [new THREE.PerspectiveCamera(), new THREE.PerspectiveCamera()],
            addToScene() {},
            removeFromScene() {},
            getBaseFogVisibilityRange: () => 560,
            setMapSandstormEffect: (state) => rendered.push(state),
        },
    };
    return { owner, system: new MapSandstormSystem(owner), rendered };
}

test('sandstorm contract normalizes timing, ranges, state and shelter bounds', () => {
    const normalized = normalizeMapSandstorm({
        enabled: true,
        initialDelaySeconds: [90, 45],
        repeatDelaySeconds: [-2, 900],
        warningSeconds: 999,
        activeSeconds: 60,
        ingressSeconds: 50,
        egressSeconds: 50,
        outdoorFar: 40,
        shelterFar: 12,
        shelterVolumes: [{ id: 'reverse', min: [10, 20, 30], max: [-10, 0, -30] }],
    });
    assert.deepEqual(normalized.initialDelaySeconds, [90, 90]);
    assert.deepEqual(normalized.repeatDelaySeconds, [0, 600]);
    assert.equal(normalized.warningSeconds, 60);
    assert.equal(normalized.ingressSeconds, 30);
    assert.equal(normalized.egressSeconds, 30);
    assert.equal(normalized.shelterFar, 40);
    assert.deepEqual(normalized.shelterVolumes[0].min, [-10, 0, -30]);
    assert.deepEqual(normalized.shelterVolumes[0].max, [10, 20, 30]);
    assert.equal(isPositionInSandstormShelter(new THREE.Vector3(20, 20, 30), normalized, 2), true);
    assert.equal(isPositionInSandstormShelter(new THREE.Vector3(21, 20, 30), normalized, 2), false);
    assert.deepEqual(createMapSandstormState({ enabled: true, phase: 'INVALID', remainingSeconds: -5 }), {
        enabled: true, phase: 'CALM', remainingSeconds: 0, eventIndex: 0, directionIndex: 0, intensity: 0,
    });
    const spoofed = normalizeMapSandstorm({
        contractVersion: 'map-sandstorm.v1', enabled: true,
        warningSeconds: 999, outdoorFar: -100,
    });
    assert.equal(spoofed.warningSeconds, 60);
    assert.equal(spoofed.outdoorFar, 12);
});

test('known match seeds cover early and late starts and later rounds consume new draws', () => {
    const early = createOwner(1);
    const late = createOwner(15955);
    early.system.startRound();
    late.system.startRound();
    assert.ok(early.system.getState().remainingSeconds < 46);
    assert.ok(late.system.getState().remainingSeconds > 89);
    const firstRoundDelay = early.system.getState().remainingSeconds;
    early.system.startRound();
    assert.notEqual(early.system.getState().remainingSeconds, firstRoundDelay);
});

test('sandstorm timing is seeded, exact and survives large simulation steps', () => {
    const first = createOwner(456);
    const second = createOwner(456);
    assert.equal(first.system.startRound(), true);
    assert.equal(second.system.startRound(), true);
    assert.equal(first.system.getState().remainingSeconds, second.system.getState().remainingSeconds);
    const initialDelay = first.system.getState().remainingSeconds;
    assert.ok(initialDelay >= 45 && initialDelay <= 90);

    first.system.update(initialDelay);
    assert.equal(first.system.getState().phase, MAP_SANDSTORM_PHASES.WARNING);
    assert.equal(first.system.getState().remainingSeconds, 20);
    first.system.update(20);
    assert.equal(first.system.getState().phase, MAP_SANDSTORM_PHASES.ACTIVE);
    assert.equal(first.system.getState().remainingSeconds, 60);
    first.system.update(4);
    assert.equal(first.system.getState().intensity, 1);
    first.system.update(52);
    assert.equal(first.system.getState().intensity, 1);
    first.system.update(4);
    assert.equal(first.system.getState().phase, MAP_SANDSTORM_PHASES.CALM);
    assert.ok(first.system.getState().remainingSeconds >= 90 && first.system.getState().remainingSeconds <= 150);

    const jumped = createOwner(789);
    jumped.system.startRound();
    const firstDelay = jumped.system.getState().remainingSeconds;
    jumped.system.update(firstDelay + 20 + 60 + 150 + 20 + 1);
    assert.equal(jumped.system.getState().phase, MAP_SANDSTORM_PHASES.ACTIVE);
    assert.ok(jumped.system.getState().eventIndex >= 2);
    assert.ok(resolveMapSandstormIntensity(CONFIG, 59) > 0);
    assert.equal(resolveMapSandstormIntensity(CONFIG, 30), 1);
});

test('replicas never schedule weather and restore late-join state exactly', () => {
    const { system } = createOwner(42);
    system.setNetworkReplica(true);
    system.startRound();
    const before = system.getState();
    assert.equal(before.enabled, false);
    system.update(999);
    assert.deepEqual(system.getState(), before);
    const snapshot = {
        enabled: true,
        phase: MAP_SANDSTORM_PHASES.ACTIVE,
        remainingSeconds: 31.5,
        eventIndex: 3,
        directionIndex: 2,
        intensity: 1,
    };
    assert.deepEqual(system.applyNetworkSnapshot(snapshot), snapshot);
    const warning = { ...snapshot, phase: 'WARNING', remainingSeconds: 7, intensity: 0 };
    assert.deepEqual(system.applyNetworkSnapshot(warning), warning);
    assert.equal(system.applyNetworkSnapshot(undefined).enabled, false);
});

test('replay interpolates time only within one event and keeps phases and directions discrete', () => {
    const projection = { players: [], localPlayerIndex: 0, localHumanCount: 1 };
    const warning = {
        enabled: true, phase: 'WARNING', remainingSeconds: 20,
        eventIndex: 1, directionIndex: 3, intensity: 0,
    };
    const laterWarning = { ...warning, remainingSeconds: 19 };
    updateReplayProjection(
        projection,
        { timeMs: 0, players: [], cameras: [], sandstorm: warning },
        { timeMs: 1000, players: [], cameras: [], sandstorm: laterWarning },
        .25,
        {}
    );
    assert.equal(projection.sandstorm.phase, 'WARNING');
    assert.equal(projection.sandstorm.directionIndex, 3);
    assert.equal(projection.sandstorm.remainingSeconds, 19.75);

    const active = {
        enabled: true, phase: 'ACTIVE', remainingSeconds: 60,
        eventIndex: 1, directionIndex: 3, intensity: 0,
    };
    updateReplayProjection(
        projection,
        { timeMs: 0, players: [], cameras: [], sandstorm: { ...warning, remainingSeconds: 1 } },
        { timeMs: 1000, players: [], cameras: [], sandstorm: active },
        .49,
        {}
    );
    assert.equal(projection.sandstorm.phase, 'WARNING');
    assert.equal(projection.sandstorm.remainingSeconds, 1);
    updateReplayProjection(
        projection,
        { timeMs: 0, players: [], cameras: [], sandstorm: { ...warning, remainingSeconds: 1 } },
        { timeMs: 1000, players: [], cameras: [], sandstorm: active },
        .5,
        {}
    );
    assert.equal(projection.sandstorm.phase, 'ACTIVE');
    assert.equal(projection.sandstorm.remainingSeconds, 60);
});

test('active storm uses shelter range, filters targets and never reveals through walls', () => {
    const { owner, system } = createOwner(42);
    system.startRound();
    system.applyNetworkSnapshot({
        enabled: true, phase: 'ACTIVE', remainingSeconds: 30, eventIndex: 1, directionIndex: 0, intensity: 1,
    });
    const outside = new THREE.Vector3(100, 10, 100);
    const inside = new THREE.Vector3(0, 30, 0);
    assert.equal(system.getVisibilityRange(outside), 40);
    assert.equal(system.getVisibilityRange(inside), 85);
    assert.equal(system.isPositionVisible(outside, new THREE.Vector3(140, 10, 100)), true);
    assert.equal(system.isPositionVisible(outside, new THREE.Vector3(140.01, 10, 100)), false);

    const observer = { alive: true, index: 0, position: new THREE.Vector3(100, 10, 100), teamId: 'alpha' };
    const near = { alive: true, index: 1, position: new THREE.Vector3(110, 10, 100), teamId: 'bravo', hitboxRadius: 1 };
    const far = { alive: true, index: 2, position: new THREE.Vector3(145, 10, 100), teamId: 'bravo' };
    owner.players = [observer, near, far];
    assert.deepEqual(system.filterVisiblePlayers(observer, owner.players), [observer, near]);
    assert.ok(system.getProximityCue(observer, owner.players));
    owner.arena.raycast = () => ({ hit: true });
    assert.equal(system.getProximityCue(observer, owner.players), null);
});

test('storm ingress keeps gameplay visibility aligned with rendered intensity', () => {
    const { system } = createOwner(42);
    system.startRound();
    system.applyNetworkSnapshot({
        enabled: true, phase: 'ACTIVE', remainingSeconds: 58,
        eventIndex: 1, directionIndex: 0, intensity: .5,
    });
    assert.equal(system.getVisibilityRange(new THREE.Vector3(100, 10, 100)), 300);
    assert.equal(system.getVisibilityRange(new THREE.Vector3(0, 10, 0)), 322.5);
    const clear = resolveSandstormLighting({
        key: { color: 0xffffff, intensity: 2 }, fill: { color: 0xffffff, intensity: 1 },
        rim: { color: 0xffffff, intensity: 1 }, hemisphere: { skyColor: 0xffffff, groundColor: 0xffffff },
        fog: { color: 0xffffff, colorHigh: 0xffffff, colorLow: 0xffffff },
        skyDome: { zenithColor: 0xffffff, horizonColor: 0xffffff, nadirColor: 0xffffff },
    }, 0);
    assert.equal(clear.key.color, 0xffffff);
    assert.equal(clear.key.intensity, 2);
    assert.equal(resolveMapSandstormLighting(clear, { phase: 'CALM', intensity: 1 }), clear);
    assert.equal(resolveMapSandstormLighting(clear, { phase: 'WARNING', intensity: 1 }), clear);
    assert.equal(resolveMapSandstormLighting(clear, null), clear);
    assert.deepEqual(resolveMapSandstormLighting(clear, { phase: 'ACTIVE', intensity: 0.5 }),
        resolveSandstormLighting(clear, 0.5));
});

test('shelter volumes follow the narrowing king pyramid and bots use composite sight', () => {
    const config = MAP_PRESET_CATALOG.pyramid.sandstorm;
    assert.equal(isPositionInSandstormShelter(new THREE.Vector3(0, 90, -60), config), true);
    assert.equal(isPositionInSandstormShelter(new THREE.Vector3(0, 90, -85), config), false);
    let compositeCalls = 0;
    const manager = {
        isPositionVisible() { compositeCalls += 1; return false; },
        isPositionVisibleDuringGlobalFog() { throw new Error('legacy fog-only path used'); },
    };
    const player = { position: new THREE.Vector3(), entityManager: manager };
    assert.equal(isTargetVisibleToPlayer(player, { position: new THREE.Vector3(10, 0, 0) }), false);
    assert.equal(compositeCalls, 1);
});

test('authoritative round end clears sandstorm ambience before later ticks return early', () => {
    let ambienceSyncs = 0;
    let ambienceClears = 0;
    const owner = {
        _simulationClockMs: 0,
        _lockOnCache: new Map(),
        _roundEnded: false,
        players: [],
        _mapSandstormSystem: { state: { enabled: true, phase: 'ACTIVE' }, update() {}, reset() {} },
        _projectileSystem: { update() {} },
        _overheatGunSystem: { update() {} },
        _respawnSystem: { update() {} },
        _playerInputSystem: { beginFrame() {}, endFrame() {} },
        audio: {
            stopEngine() {},
            syncEngineFromPlayers() {},
            syncMapAmbienceFromPlayers() { ambienceSyncs += 1; },
            clearMapAmbience() { ambienceClears += 1; },
        },
        renderer: { viewportSystem: { localPlayerIndex: 0 } },
        arena: { currentMapDefinition: null, glbAnimationElapsedSeconds: 0 },
        entityRuntimeConfig: { ARENA: { MAP_SCALE: 1 } },
        _roundOutcomeSystem: { resolve: () => ({ shouldEnd: true, winner: null, reason: 'TEST' }) },
        onAuthoritativeFightStateChanged() {},
        _eventBus: { emitRoundEnd() {} },
    };
    const pipeline = new EntityTickPipeline(owner);
    pipeline.update(1 / 60, null);
    pipeline.update(1 / 60, null);
    assert.equal(owner._roundEnded, true);
    assert.equal(ambienceSyncs, 1);
    assert.equal(ambienceClears, 2);
});

test('pyramid preset and network projections expose the authored storm', () => {
    const map = MAP_PRESET_CATALOG.pyramid;
    assert.equal(map.name, 'Krone des Sonnengottes');
    assert.deepEqual(map.size, [260, 160, 260]);
    assert.equal(map.glbModels.length, 7);
    assert.equal(map.botSpawns.length, 7);
    assert.equal(map.items.length, 8);
    assert.equal(map.sandstorm.warningSeconds, 20);
    assert.equal(map.sandstorm.activeSeconds, 60);

    const state = {
        enabled: true, phase: 'WARNING', remainingSeconds: 12, eventIndex: 1, directionIndex: 3, intensity: 0,
    };
    const snapshot = createGameStateSnapshot({
        players: [], projectiles: [], powerupManager: { items: [] },
        getMapSandstormState: () => state,
    }, { frame: 1 });
    assert.deepEqual(snapshot.sandstorm, state);
    assert.deepEqual(createMatchRuntimeProjection({ sandstorm: snapshot.sandstorm }).sandstorm, state);
});

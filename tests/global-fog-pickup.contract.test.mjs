import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG, CONFIG_BASE } from '../src/core/Config.js';
import { createGameStateSnapshot } from '../src/core/GameStateSnapshot.js';
import { SceneLightingRig } from '../src/core/renderer/SceneLightingRig.js';
import { getAtmosphericFogSettings } from '../src/core/renderer/AtmosphericFogShaderPatch.js';
import { createBotRuntimeContext } from '../src/entities/ai/BotRuntimeContextFactory.js';
import { selectTarget } from '../src/entities/ai/BotTargetingOps.js';
import { EntitySpawnOps } from '../src/entities/runtime/EntitySpawnOps.js';
import { EntityTickPipeline } from '../src/entities/runtime/EntityTickPipeline.js';
import { PowerupModelFactory } from '../src/entities/PowerupModelFactory.js';
import { GlobalFogEffectSystem } from '../src/entities/systems/GlobalFogEffectSystem.js';
import { HuntCombatSystem } from '../src/entities/systems/HuntCombatSystem.js';
import { HUNT_CONFIG } from '../src/hunt/HuntConfig.js';
import { StateReconciler } from '../src/network/StateReconciler.js';
import {
    getPickupDefinition,
    getPickupObservationSlotIndex,
    getPickupSpawnWeight,
    isPickupTypeAllowedForMode,
    isPickupTypeSelfUsable,
    isPickupTypeShootable,
} from '../src/entities/PickupRegistry.js';
import {
    resolveGlobalFogMapRange,
    resolveGlobalFogRenderRange,
} from '../src/shared/contracts/GlobalFogEffectContract.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { createMatchRenderProjection } from '../src/shared/contracts/MatchRenderProjectionContract.js';
import { createMatchRuntimeProjection } from '../src/shared/contracts/MatchRuntimeProjectionContract.js';

function createFogSystem(mapLighting = { fog: { near: 60, far: 150 } }) {
    const rendered = [];
    const manager = {
        arena: { currentMapDefinition: { lighting: mapLighting } },
        renderer: { setGlobalFogEffect: (state) => rendered.push({ ...state }) },
    };
    const system = new GlobalFogEffectSystem(manager);
    manager._globalFogEffectSystem = system;
    manager.getGlobalFogState = () => system.getState();
    manager.isPositionVisibleDuringGlobalFog = (observerPosition, targetPosition) => (
        system.isPositionVisible(observerPosition, targetPosition)
    );
    return { manager, system, rendered };
}

function createTargetingPlayer(index, position) {
    const forward = new THREE.Vector3(1, 0, 0);
    return {
        index,
        alive: true,
        hp: 100,
        maxHp: 100,
        position: new THREE.Vector3(...position),
        getDirection(out) { return out.copy(forward); },
    };
}

function createTargetingBot(previousTarget = null) {
    return {
        profile: {},
        state: { targetPlayer: previousTarget },
        sense: { targetDistanceSq: Infinity, targetInFront: false },
        _tmpForward: new THREE.Vector3(),
        _tmpVec: new THREE.Vector3(),
        _tmpVec2: new THREE.Vector3(),
        _tmpVec3: new THREE.Vector3(),
    };
}

test('FOG is a direct global pickup in every item-enabled mode without changing observation slots', () => {
    const definition = getPickupDefinition('FOG');

    assert.equal(definition?.name, 'Nebel');
    assert.equal(definition?.icon, '☁');
    assert.match(definition?.description || '', /aller Spieler.*8 Sekunden/i);
    assert.equal(definition?.visualKind, 'fog');
    assert.equal(definition?.color, 0xd7dce2);
    assert.equal(isPickupTypeSelfUsable('FOG'), true);
    assert.equal(isPickupTypeShootable('FOG'), false);
    for (const mode of ['CLASSIC', 'ARCADE', 'HUNT']) {
        assert.equal(isPickupTypeAllowedForMode('FOG', mode), true);
        assert.equal(getPickupSpawnWeight('FOG', mode), 0.7);
    }
    assert.equal(HUNT_CONFIG.PICKUP_WEIGHTS.FOG, 0.7);
    assert.equal(getPickupObservationSlotIndex('FOG'), 19);
    assert.equal(getPickupObservationSlotIndex('UNKNOWN_PICKUP'), 19);
});

test('FOG uses the pickup model factory to build a light-gray cloud', () => {
    const definition = getPickupDefinition('FOG');
    const factory = new PowerupModelFactory();
    const model = factory.createModel('FOG', definition);
    try {
        assert.equal(model.children.length, 3);
        assert.ok(model.children.every((child) => child.geometry?.type === 'SphereGeometry'));
        assert.ok(model.children.every((child) => child.material?.color?.getHex() === definition.color));
    } finally {
        model.traverse((node) => node.material?.dispose?.());
        factory.dispose();
    }
});

test('map visibility uses one third of authored fog, while clear maps use 5 to 20 units', () => {
    assert.deepEqual(resolveGlobalFogMapRange({ fog: { near: 60, far: 150 } }), {
        clearMap: false,
        near: 20,
        far: 50,
        normalNear: 60,
        normalFar: 150,
    });
    assert.deepEqual(resolveGlobalFogMapRange({ fog: { near: 90, far: 200 } }), {
        clearMap: true,
        near: 5,
        far: 20,
        normalNear: 90,
        normalFar: 200,
    });

    const shortened = resolveGlobalFogRenderRange({
        mapLighting: { fog: { near: 60, far: 150 } },
        viewDistance: 20,
    });
    const cannotExtend = resolveGlobalFogRenderRange({
        mapLighting: { fog: { near: 60, far: 150 } },
        viewDistance: 190,
    });
    assert.deepEqual({ near: shortened.near, far: shortened.far }, { near: 8, far: 20 });
    assert.deepEqual({ near: cannotExtend.near, far: cannotExtend.far }, { near: 20, far: 50 });
});

test('global fog duration is additive, simulation-driven, trigger-independent and fully resettable', () => {
    const { system, rendered } = createFogSystem();
    const trigger = { alive: true };

    assert.equal(system.activate(), true);
    assert.deepEqual(system.getState(), { active: true, remainingSeconds: 8, visibilityRange: 50 });
    system.update(2);
    assert.equal(system.getState().remainingSeconds, 6);
    trigger.alive = false;
    assert.equal(system.activate(), true);
    assert.equal(system.getState().remainingSeconds, 14);

    const pausedTime = system.getState().remainingSeconds;
    assert.equal(system.getState().remainingSeconds, pausedTime, 'no simulation update means no timer progress');
    assert.equal(system.getState().active, true, 'the trigger death is not part of effect state');

    system.update(14);
    assert.deepEqual(system.getState(), { active: false, remainingSeconds: 0, visibilityRange: 0 });
    system.activate();
    system.reset();
    assert.deepEqual(system.getState(), { active: false, remainingSeconds: 0, visibilityRange: 0 });
    assert.equal(rendered.at(-1).active, false);
});

test('FOG consumption activates exactly once, and failed or replica activation preserves inventory', () => {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const { system } = createFogSystem({ fog: { near: 90, far: 200 } });
    let activationCalls = 0;
    const runtime = {
        services: { entityRuntimeConfig },
        callbacks: {
            getStrategy: () => ({ modeType: 'CLASSIC', hasMachineGun: () => false }),
            globalEffects: {
                canActivateFog: () => system.networkReplica !== true,
                activateFog: () => {
                    activationCalls += 1;
                    return system.activate();
                },
            },
        },
    };
    const player = {
        inventory: ['FOG', 'SHIELD'],
        selectedItemIndex: 0,
        itemUseCooldownRemaining: 0,
        applyPowerup() { assert.fail('FOG must not become a per-player effect'); },
    };
    const combat = new HuntCombatSystem(runtime);

    const used = combat.useInventoryItem(player, 0);
    assert.equal(used.ok, true);
    assert.equal(activationCalls, 1);
    assert.deepEqual(player.inventory, ['SHIELD']);
    assert.deepEqual(system.getState(), { active: true, remainingSeconds: 8, visibilityRange: 20 });

    player.inventory = ['FOG'];
    system.setNetworkReplica(true);
    const rejectedReplica = combat.useInventoryItem(player, 0);
    assert.equal(rejectedReplica.ok, false);
    assert.equal(activationCalls, 1);
    assert.deepEqual(player.inventory, ['FOG']);

    system.setNetworkReplica(false);
    runtime.callbacks.globalEffects.activateFog = () => false;
    const rejectedActivation = combat.useInventoryItem(player, 0);
    assert.equal(rejectedActivation.ok, false);
    assert.deepEqual(player.inventory, ['FOG']);
    assert.equal(player.selectedItemIndex, 0);
});

test('bot perception includes targets and pickups on the boundary, hides those outside, and keeps navigation inputs', () => {
    const { manager, system } = createFogSystem({ fog: { near: 90, far: 200 } });
    const observer = createTargetingPlayer(0, [0, 0, 0]);
    const inside = createTargetingPlayer(1, [19, 0, 0]);
    const boundary = createTargetingPlayer(2, [20, 0, 0]);
    const outside = createTargetingPlayer(3, [20.01, 0, 0]);
    for (const player of [observer, inside, boundary, outside]) player.entityManager = manager;

    const insidePickup = { type: 'FOG', mesh: { position: new THREE.Vector3(20, 0, 0) } };
    const outsidePickup = { type: 'HEALTH', mesh: { position: new THREE.Vector3(20.01, 0, 0) } };
    const projectiles = [{ id: 'navigation-projectile' }];
    const trailSpatialIndex = { id: 'navigation-trails' };
    manager.players = [observer, inside, boundary, outside];
    manager.projectiles = projectiles;
    manager.powerupManager = { items: [insidePickup, outsidePickup] };
    manager.activeGameMode = 'CLASSIC';
    manager.runtimeConfig = { gameplay: { planarMode: false }, arcade: { enabled: false }, bot: {} };
    manager.getTrailSpatialIndex = () => trailSpatialIndex;
    manager.arena.bounds = { minX: -100, maxX: 100, minY: -100, maxY: 100, minZ: -100, maxZ: 100 };

    system.activate();
    const context = createBotRuntimeContext(manager, observer, 1 / 60, { includeObservationContext: false });
    assert.equal(context.navigationPlayers, manager.players, 'spacing and navigation retain all players');
    assert.deepEqual(context.players, [observer, inside, boundary], 'target-facing context exposes no outside positions');
    assert.deepEqual(context.visiblePlayers, [observer, inside, boundary]);
    assert.deepEqual(context.powerups, [insidePickup]);
    assert.equal(context.projectiles, projectiles);
    assert.equal(context.trailSpatialIndex, trailSpatialIndex);
    assert.equal(context.arena, manager.arena);

    const bot = createTargetingBot(outside);
    selectTarget(bot, observer, [observer, outside]);
    assert.equal(bot.state.targetPlayer, null, 'an existing target is dropped outside the fog range');
    selectTarget(bot, observer, [observer, boundary, outside]);
    assert.equal(bot.state.targetPlayer, boundary, 'the exact boundary remains visible');
});

test('global fog is present in snapshots, projections, repeated reconciliation and late-join state', () => {
    const host = createFogSystem({ fog: { near: 60, far: 150 } });
    host.system.activate();
    host.system.update(1.5);
    host.manager.players = [];
    const snapshot = createGameStateSnapshot(host.manager, { frame: 4 });

    assert.deepEqual(snapshot.globalFog, { active: true, remainingSeconds: 6.5, visibilityRange: 50 });
    assert.deepEqual(createMatchRuntimeProjection({ globalFog: snapshot.globalFog }).globalFog, snapshot.globalFog);
    assert.deepEqual(createMatchRenderProjection({ globalFog: snapshot.globalFog }).globalFog, snapshot.globalFog);

    const lateJoin = createFogSystem({ fog: { near: 60, far: 150 } });
    const reconciler = new StateReconciler();
    reconciler.receiveServerState({ state: snapshot });
    reconciler.reconcile(null, {
        applyNetworkSnapshot: (state) => lateJoin.system.applyNetworkSnapshot(state.globalFog),
    });
    assert.deepEqual(lateJoin.system.getState(), snapshot.globalFog);

    lateJoin.system.applyNetworkSnapshot(snapshot.globalFog);
    assert.deepEqual(lateJoin.system.getState(), snapshot.globalFog, 'repeated snapshots do not add duration');
    lateJoin.system.applyNetworkSnapshot(undefined);
    assert.deepEqual(lateJoin.system.getState(), { active: false, remainingSeconds: 0, visibilityRange: 0 });
    assert.deepEqual(createMatchRuntimeProjection({}).globalFog, {
        active: false,
        remainingSeconds: 0,
        visibilityRange: 0,
    });
});

test('temporary fog keeps atmospheric color, reaches high altitude and restores authored fog', () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0, 1, 2);
    const rig = new SceneLightingRig({ scene, renderer: { toneMappingExposure: 1 }, config: CONFIG });
    const mapLighting = {
        fog: { color: 0x8899aa, near: 60, far: 150, height: 12, heightFalloff: 0.2, skyBlend: 0 },
    };

    rig.apply({
        graphicsStyle: 'modern',
        mapLighting,
        brightnessFactors: { exposure: 1, ambient: 1, fog: 1 },
        viewDistance: 0,
        globalFogRange: resolveGlobalFogMapRange(mapLighting),
    });
    assert.deepEqual({ near: scene.fog.near, far: scene.fog.far }, { near: 20, far: 50 });
    assert.equal(scene.fog.color.getHex(), 0x8899aa);
    assert.equal(getAtmosphericFogSettings().heightFalloff, 0, 'zero falloff keeps fog active at altitude');

    rig.apply({
        graphicsStyle: 'modern',
        mapLighting,
        brightnessFactors: { exposure: 1, ambient: 1, fog: 1 },
        viewDistance: 0,
        globalFogRange: null,
    });
    assert.deepEqual({ near: scene.fog.near, far: scene.fog.far }, { near: 60, far: 150 });
    assert.equal(getAtmosphericFogSettings().heightFalloff, 0.2);
    rig.dispose();
});

test('round restart and authoritative round end remove fog before state publication', () => {
    let resetCount = 0;
    const spawnOwner = {
        _roundEnded: true,
        _simulationClockMs: 4,
        arena: { setGlbAnimationElapsedSeconds() {} },
        _respawnSystem: { reset() {} },
        _huntScoring: { reset() {} },
        _roundOutcomeSystem: { reset() {} },
        _globalFogEffectSystem: { reset() { resetCount += 1; } },
        _lastRoundOutcome: {},
        _authoritativeHuntState: {},
        _lastAppliedAuthoritativeOutcomeKey: 'old',
        _parcoursProgressSystem: { startRound() {} },
        _mapHazardSystem: { startRound() {} },
        _spawnPlacementSystem: { resetAssignments() {} },
        _staticTurretSystem: { startRound() {} },
        players: [],
        gameModeStrategy: { isEndlessParcours: () => false },
    };
    new EntitySpawnOps(spawnOwner).spawnAll();
    assert.equal(resetCount, 1);

    let statePublishedWhileActive = null;
    const tickOwner = {
        _simulationClockMs: 0,
        _lockOnCache: new Map(),
        _roundEnded: false,
        players: [],
        _globalFogEffectSystem: {
            active: true,
            update() {},
            reset() { this.active = false; },
        },
        _staticTurretSystem: { update() {} },
        _projectileSystem: { update() {} },
        _overheatGunSystem: { update() {} },
        _respawnSystem: { update() {} },
        _playerInputSystem: { beginFrame() {}, endFrame() {} },
        audio: { stopEngine() {}, syncEngineFromPlayers() {}, syncMapAmbienceFromPlayers() {} },
        renderer: { viewportSystem: { localPlayerIndex: 0 } },
        arena: { currentMapDefinition: null, glbAnimationElapsedSeconds: 0 },
        entityRuntimeConfig: { ARENA: { MAP_SCALE: 1 } },
        _roundOutcomeSystem: { resolve: () => ({ shouldEnd: true, winner: null, reason: 'TEST' }) },
        onAuthoritativeFightStateChanged() {
            statePublishedWhileActive = this._globalFogEffectSystem.active;
        },
        _eventBus: { emitRoundEnd() {} },
    };
    new EntityTickPipeline(tickOwner).update(1 / 60, null);
    assert.equal(tickOwner._roundEnded, true);
    assert.equal(tickOwner._globalFogEffectSystem.active, false);
    assert.equal(statePublishedWhileActive, false);
});

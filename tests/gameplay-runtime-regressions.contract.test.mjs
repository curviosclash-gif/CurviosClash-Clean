import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG } from '../src/core/Config.js';
import { createGameStateSnapshot } from '../src/core/GameStateSnapshot.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { GameRuntimeArcadeSupport } from '../src/core/runtime/GameRuntimeArcadeSupport.js';
import {
    resolveArcadeEndlessSectorDescriptor,
    resolveArcadeSectorRuntimeProfile,
} from '../src/entities/directors/ArcadeEncounterCatalog.js';
import { Arena } from '../src/entities/Arena.js';
import { EntityManager } from '../src/entities/EntityManager.js';
import { Player } from '../src/entities/Player.js';
import { PowerupManager } from '../src/entities/Powerup.js';
import { Trail } from '../src/entities/Trail.js';
import {
    applyPlayerPowerup,
    updatePlayerEffects,
} from '../src/entities/player/PlayerEffectOps.js';
import { PlayerInteractionPhase } from '../src/entities/systems/lifecycle/PlayerInteractionPhase.js';
import { ProjectileSystem } from '../src/entities/systems/ProjectileSystem.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { StateReconciler } from '../src/network/StateReconciler.js';
import { GAMEPLAY_CAMERA_MODE_ID } from '../src/shared/contracts/CameraModeContract.js';
import {
    beginArcadeSector,
    createArcadeRunState,
} from '../src/state/arcade/ArcadeRunState.js';
import { mergeArcadeRunRecords } from '../src/state/arcade/ArcadeScoreOps.js';
import {
    checkMissionComplete,
    createMissionInstance,
    createSectorMissionState,
    updateSectorMissionState,
} from '../src/state/arcade/ArcadeMissionState.js';
import { RoundSnapshotStore } from '../src/state/recorder/RoundSnapshotStore.js';
import { CrosshairSystem } from '../src/ui/CrosshairSystem.js';
import { HUD } from '../src/ui/HUD.js';
import { HuntHUD } from '../src/ui/HuntHUD.js';

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
        activeEffects: [{ type: 'INVERT', remaining: 1.75, sourcePlayerIndex: 2 }],
        hasShield: true,
        shieldHP: 7,
        speed: 18,
    };
    const snapshot = createGameStateSnapshot({
        players: [hostPlayer],
        arena: { glbAnimationElapsedSeconds: 12.75 },
    }, { frame: 9 });

    assert.equal(snapshot.players[0].health, 23);
    assert.deepEqual(snapshot.players[0].rot, [0, 1, 0, 0]);
    assert.equal(snapshot.mapElapsedSeconds, 12.75);

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
    // An alive-false transition the local simulation never saw itself replays presentation
    // only; the authoritative host remains responsible for lifecycle and respawn timing.
    const manager = {
        _killPlayer(player) {
            player.alive = false;
            player.view?.setVisible?.(false);
        },
    };
    reconciler.reconcile([clientPlayer], manager);

    assert.equal(clientPlayer.hp, 23);
    assert.equal(clientPlayer.health, 23);
    assert.equal(clientPlayer.shieldHP, 7);
    assert.equal(clientPlayer.hasShield, true);
    assert.deepEqual(clientPlayer.inventory, ['SHIELD']);
    assert.deepEqual(clientPlayer.activeEffects, [{
        type: 'INVERT',
        remaining: 1.75,
        sourcePlayerIndex: 2,
    }]);
    assert.equal(clientPlayer.alive, false);
    assert.deepEqual(visibility, [false]);
    assert.equal(clientPlayer.quaternion.w, 0);
});

test('network snapshot serializes and applies authoritative projectiles and powerups', () => {
    const snapshot = createGameStateSnapshot({
        players: [],
        projectiles: [{
            traversalId: 'projectile:7',
            position: new THREE.Vector3(1, 2, 3),
            velocity: new THREE.Vector3(4, 0, 0),
            owner: { index: 2 },
            type: 'SPEED_UP',
            ttl: 3,
            radius: 0.5,
        }],
        powerupManager: {
            items: [{
                networkId: 'powerup:4',
                mesh: { position: new THREE.Vector3(8, 9, 10) },
                baseY: 7,
                type: 'SHIELD',
            }],
        },
        _staticTurretSystem: {
            createNetworkSnapshot: () => [{
                id: 'turret:1',
                pos: [12, 0, 4],
                aim: [1, 0, 0],
                owner: 0,
                deployed: true,
                hp: 45,
                maxHp: 45,
            }],
        },
    }, null);

    assert.deepEqual(snapshot.projectiles[0], {
        id: 'projectile:7',
        pos: [1, 2, 3],
        vel: [4, 0, 0],
        owner: 2,
        type: 'SPEED_UP',
        ttl: 3,
        radius: 0.5,
    });
    assert.deepEqual(snapshot.powerups[0], {
        id: 'powerup:4',
        pos: [8, 7, 10],
        type: 'SHIELD',
        visible: true,
        telegraphRemaining: 0,
    });
    assert.equal(snapshot.turrets[0].id, 'turret:1');
    assert.equal(snapshot.turrets[0].hp, 45);

    const applied = [];
    const reconciler = new StateReconciler();
    reconciler.receiveServerState({ state: snapshot });
    reconciler.reconcile([], {
        applyNetworkSnapshot(value) { applied.push(value); },
    });
    assert.equal(applied[0], snapshot);
});

test('network replica managers spawn, update and remove authoritative entities', () => {
    const added = [];
    const removed = [];
    const renderer = {
        addToScene(mesh) { added.push(mesh); },
        removeFromScene(mesh) { removed.push(mesh); },
    };
    const projectileSystem = new ProjectileSystem({ renderer, entityRuntimeConfig: CONFIG });
    projectileSystem.applyNetworkSnapshot([{
        id: 'projectile:1',
        pos: [1, 0, 0],
        vel: [2, 0, 0],
        owner: 0,
        type: 'SPEED_UP',
        ttl: 2,
        radius: 0.5,
    }], [{ index: 0 }]);
    projectileSystem.update(0.5);
    assert.equal(projectileSystem.projectiles.length, 1);
    assert.equal(projectileSystem.projectiles[0].position.x, 2);
    projectileSystem.applyNetworkSnapshot([]);
    assert.equal(projectileSystem.projectiles.length, 0);

    const powerupManager = new PowerupManager(renderer, {}, CONFIG);
    powerupManager.applyNetworkSnapshot([{
        id: 'powerup:1',
        pos: [3, 4, 5],
        type: 'SHIELD',
    }]);
    assert.equal(powerupManager.items.length, 1);
    assert.deepEqual(powerupManager.items[0].mesh.position.toArray(), [3, 4, 5]);
    assert.equal(powerupManager.checkPickup(new THREE.Vector3(3, 4, 5), 1), null);
    assert.equal(powerupManager.items.length, 1);
    const predicted = powerupManager.checkPickup(new THREE.Vector3(3, 4, 5), 1, () => true);
    assert.equal(predicted.meta.predicted, true);
    assert.equal(powerupManager.items[0].mesh.visible, false);
    powerupManager.update(0.4);
    powerupManager.applyNetworkSnapshot([{
        id: 'powerup:1', pos: [3, 4, 5], type: 'SHIELD',
    }]);
    assert.equal(powerupManager.items[0].mesh.visible, true);
    powerupManager.applyNetworkSnapshot([]);
    assert.equal(powerupManager.items.length, 0);
    assert.equal(added.length, 2);
    assert.equal(removed.length, 2);
    projectileSystem.dispose();
    powerupManager.dispose();
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

test('round snapshots preserve static turrets for killcam scene playback', () => {
    const store = new RoundSnapshotStore({ maxSnapshots: 2, timeProvider: () => 1 });
    store.capture({
        players: [],
        _staticTurretSystem: {
            turrets: [{
                id: 'turret:replay',
                weapon: 'rocket',
                rocketType: 'ROCKET_MEDIUM',
                ownerIndex: 2,
                deployed: true,
                position: new THREE.Vector3(4, 1, 7),
                aimDirection: new THREE.Vector3(0, 0, -1),
                hp: 31,
                maxHp: 45,
                expiresRemaining: 8,
                ownerPlayer: { color: 0x44aaff },
            }],
        },
    });

    const turret = store.getOrderedSnapshots()[0].turrets[0];
    assert.deepEqual(turret, {
        id: 'turret:replay', weapon: 'rocket', rocketType: 'ROCKET_MEDIUM', owner: 2, deployed: true,
        x: 4, y: 1, z: 7, ax: 0, ay: 0, az: -1, hp: 31, maxHp: 45, ttl: 8, color: 0x44aaff,
    });
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

test('HuntHUD skips projection work outside Hunt and reuses a provided projection', () => {
    let projectionReads = 0;
    let hidden = false;
    const runtime = { activeGameMode: 'CLASSIC', state: 'MENU' };
    const hud = new HuntHUD({
        runtime,
        ports: {
            runtimeProjectionPort: {
                getMatchRuntimeProjection() {
                    projectionReads += 1;
                    return null;
                },
            },
        },
        refs: {
            root: {
                classList: {
                    add() {},
                    toggle(_name, value) {
                        hidden = value === true;
                    },
                },
            },
        },
    });

    hud.update(1 / 60);
    assert.equal(projectionReads, 0);
    assert.equal(hidden, true);

    runtime.activeGameMode = 'HUNT';
    runtime.state = 'PLAYING';
    hud.update(1 / 60, {
        hunt: { active: true, killFeed: [], overheatByPlayer: {}, damageIndicatorsByPlayer: {} },
        players: [],
    });
    assert.equal(projectionReads, 0);
});

test('Arcade runtime decays an idle combo during gameplay but respects combo freeze', () => {
    let nowMs = 1000;
    const runtime = new ArcadeRunRuntime({ now: () => nowMs });
    runtime._enabled = true;
    runtime._state = beginArcadeSector(createArcadeRunState({
        config: {
            enabled: true,
            comboWindowMs: 1000,
            comboDecayPerSecond: 2,
        },
        nowMs: 0,
        runId: 'combo-decay-test',
    }), 0);
    runtime._state.score = {
        ...runtime._state.score,
        combo: 6,
        multiplier: 4,
        lastComboAtMs: 1000,
    };

    nowMs = 6000;
    runtime.tickGameplay(6);
    assert.ok(runtime._state.score.combo < 6);
    assert.ok(runtime._state.score.multiplier < 4);

    runtime._state.score = {
        ...runtime._state.score,
        combo: 6,
        multiplier: 4,
        lastComboAtMs: 1000,
    };
    runtime._state.comboFreezeUntilMs = 7000;
    runtime.applyGameplayEvent({ type: 'tick' });
    assert.equal(runtime._state.score.combo, 6);
    assert.equal(runtime._state.score.multiplier, 4);
});

test('Arcade intermission restores carried vitals without a one-off combo freeze', () => {
    const runtime = new ArcadeRunRuntime({ now: () => 5000 });
    runtime._enabled = true;
    runtime._state = createArcadeRunState({
        config: { enabled: true },
        nowMs: 0,
        runId: 'intermission-effects-test',
    });
    runtime._pendingIntermissionEffects = {
        selectedRewardId: 'run_combo_t1',
        selectedChoiceId: 'choice-1',
        missionsCompleted: 1,
        missionsTotal: 2,
        humanVitals: [{
            playerIndex: 0,
            hp: 40,
            maxHp: 100,
            shieldHP: 5,
            maxShieldHp: 40,
            hasShield: true,
        }],
    };
    runtime.setStrategy({
        applyIntermissionHealing(player) {
            player.hp += 10;
            return { healed: 10, shieldGranted: 0 };
        },
    });
    const player = {
        index: 0,
        isBot: false,
        alive: true,
        hp: 100,
        maxHp: 100,
        shieldHP: 0,
        maxShieldHp: 40,
    };

    const result = runtime.applyPendingIntermissionEffects({ players: [player] });

    assert.equal(player.hp, 50);
    assert.equal(player.shieldHP, 5);
    assert.equal(player.hasShield, true);
    assert.equal(result.playersRestored, 1);
    assert.equal(result.healedTotal, 10);
    assert.equal(result.comboFreezeGrantedMs, 0);
    assert.equal(runtime._state.comboFreezeUntilMs, undefined);
});

test('Arcade sector profiles apply authored squad pressure and request session rebuilds', () => {
    const profile = resolveArcadeSectorRuntimeProfile({
        sectorNumber: 6,
        templateId: 'sector_hazard',
        squadId: 'elite_lance',
        pressure: 0.9,
        isBoss: true,
    }, {
        mapKey: 'complex',
        fallbackBotCount: 1,
        fallbackDifficulty: 'EASY',
    });
    assert.deepEqual(profile, {
        sectorIndex: 6,
        mapKey: 'complex',
        templateId: 'sector_hazard',
        squadId: 'elite_lance',
        botCount: 5,
        botDifficulty: 'HARD',
        pressure: 0.9,
        aggressiveness: 0.85,
        parcoursEnabled: false,
        isBoss: true,
    });

    const appliedProfiles = [];
    const runtimeState = {
        runtimeConfig: {
            arcade: { enabled: true, seed: 12, sectorCount: 6 },
            bot: { activeDifficulty: 'EASY' },
            session: { mapKey: 'standard', numBots: 1 },
            player: { vehicles: { PLAYER_1: 'ship2' } },
        },
    };
    const support = new GameRuntimeArcadeSupport({
        getRuntimeState: () => runtimeState,
        applySectorRuntimeProfile: (value) => appliedProfiles.push(value),
    });
    const initialProfile = support.prepareMatchStartRuntime();
    assert.equal(appliedProfiles[0], initialProfile);
    assert.equal(support.arcadeRunRuntime._activeVehicleId, 'ship2');
    assert.ok(initialProfile.mapKey);
    assert.ok(initialProfile.botCount >= 2);

    support._pendingSectorTransition = profile;
    const transition = support.consumePendingSectorTransition();
    assert.equal(transition.requiresSessionRebuild, true);
    assert.equal(transition.mapKey, 'complex');
    assert.equal(transition.botCount, 5);
    assert.equal(appliedProfiles.at(-1).botDifficulty, 'HARD');
});

test('Arcade endless sectors resolve deterministic combat descriptors beyond the authored plan', () => {
    const first = [];
    const second = [];
    for (let sectorIndex = 3; sectorIndex <= 10; sectorIndex += 1) {
        first.push(resolveArcadeEndlessSectorDescriptor({ seed: 4815, sectorIndex, difficulty: 'hard' }));
        second.push(resolveArcadeEndlessSectorDescriptor({ seed: 4815, sectorIndex, difficulty: 'hard' }));
    }

    assert.deepEqual(first, second);
    for (const descriptor of first) {
        const profile = resolveArcadeSectorRuntimeProfile(descriptor, {
            sectorIndex: descriptor.sectorNumber,
            fallbackBotCount: 0,
            fallbackDifficulty: 'normal',
        });
        assert.ok(descriptor.mapKey);
        assert.ok(descriptor.objectiveId);
        assert.ok(descriptor.squadId);
        assert.equal(descriptor.parcoursEnabled, false);
        assert.ok(profile.botCount >= 1);
    }
});

test('Arcade runtime caches an endless descriptor when entering sudden death', () => {
    const transitions = [];
    const runtime = new ArcadeRunRuntime({ now: () => 5000 });
    runtime._enabled = true;
    runtime._config = { intermissionSeconds: 1 };
    runtime._state = {
        runId: 'endless-runtime',
        config: { enabled: true, seed: 91, sectorCount: 2 },
        phase: 'intermission',
        sectorIndex: 2,
        completedSectors: 2,
        encounterSequence: [
            { sectorNumber: 1, templateId: 'sector_intro', squadId: 'scout_duo', mapKey: 'standard' },
            { sectorNumber: 2, templateId: 'sector_intro', squadId: 'elite_lance', mapKey: 'crossfire', isBoss: true },
        ],
        mapSequence: ['standard', 'crossfire'],
        currentMapKey: 'crossfire',
        score: { total: 0, combo: 0, multiplier: 1 },
    };
    runtime.setMapTransitionHandler((transition) => transitions.push(transition));

    runtime.beginNextSector();

    assert.equal(runtime._state.sectorIndex, 3);
    assert.equal(runtime._state.phase, 'sudden_death');
    assert.equal(runtime._state.encounterSequence.length, 3);
    assert.equal(runtime._state.mapSequence.length, 3);
    assert.ok(transitions[0]?.botCount >= 1);
    assert.ok(transitions[0]?.mapKey);
});

test('Arcade replay fallback exports the captured run instead of reporting no player', () => {
    const runtime = new ArcadeRunRuntime();
    runtime._state = createArcadeRunState({ config: { enabled: true } });
    runtime._state.replay.playbackEnabled = true;
    runtime._latestReplaySnapshot = {
        initialState: { mapKey: 'standard' },
        actions: [{ type: 'boost', timestamp: 12 }],
    };

    const result = runtime.requestReplayPlayback();

    assert.equal(result.ok, true);
    assert.equal(result.code, 'replay_export_ready');
    assert.deepEqual(JSON.parse(result.replayJson), runtime._latestReplaySnapshot);
});

test('Arcade records retain kill score totals and isolate each daily seed', () => {
    const first = mergeArcadeRunRecords(null, {
        score: 900,
        peakMultiplier: 3,
        peakCombo: 5,
        completedSectors: 4,
        finishedAtIso: '2026-07-14T10:00:00.000Z',
        isDailyChallenge: true,
        seed: 20260714,
        breakdown: { kills: 70, total: 900 },
    });
    assert.equal(first.breakdownTotals.kills, 70);
    assert.equal(first.daily.seed, 20260714);
    assert.equal(first.daily.runsPlayed, 1);
    assert.equal(first.daily.bestScore, 900);

    const second = mergeArcadeRunRecords(first, {
        score: 400,
        finishedAtIso: '2026-07-15T10:00:00.000Z',
        isDailyChallenge: true,
        seed: 20260715,
        breakdown: { kills: 35, total: 400 },
    });
    assert.equal(second.breakdownTotals.kills, 105);
    assert.equal(second.daily.seed, 20260715);
    assert.equal(second.daily.runsPlayed, 1);
    assert.equal(second.daily.bestScore, 400);
});

test('selecting Portal Line no longer applies a one-off shield conversion bonus', () => {
    const strategy = new ArcadeModeStrategy();
    const basePlayer = {
        alive: true,
        hp: 100,
        maxHp: 100,
        shieldHP: 0,
        maxShieldHp: 40,
    };
    const portalPlayer = { ...basePlayer };

    const base = strategy.applyIntermissionHealing(basePlayer, {});
    const portal = strategy.applyIntermissionHealing(portalPlayer, {
        selectedRewardId: 'run_portal_t1',
    });

    assert.equal(base.shieldGranted, 6);
    assert.equal(portal.shieldGranted, 6);
});

test('temporary speed effects preserve Arcade vehicle and Fight loadout speed bonuses', () => {
    const strategy = new ArcadeModeStrategy();
    strategy.applyVehicleUpgrades({ speedBonusPct: 25, turningBonusPct: 0, maxHpBonus: 0 });
    const player = {
        entityRuntimeConfig: {
            PLAYER: { SPEED: 35 },
            POWERUP: {},
            TRAIL: {},
            HUNT: { ENABLED: true, ACTIVE_MODE: 'ARCADE', DEFAULT_MODE: 'ARCADE' },
        },
        activeEffects: [],
        baseSpeed: 35,
        speed: 35,
        hasShield: false,
        shieldHP: 0,
        trail: null,
    };

    strategy.applySpawnStatBonuses(player);
    assert.equal(player.baseSpeed, 43.75);
    strategy.applySpawnStatBonuses(player);
    assert.equal(player.baseSpeed, 43.75);

    updatePlayerEffects(player, 1 / 60);
    assert.equal(player.baseSpeed, 43.75);

    applyPlayerPowerup(player, 'SLOW_DOWN');
    assert.equal(player.baseSpeed, 21.875);
    player.activeEffects.find((effect) => effect.type === 'SLOW_DOWN').remaining = 0;
    updatePlayerEffects(player, 1 / 60);

    assert.equal(player.baseSpeed, 43.75);
    assert.equal(player._speedEffectBaseSpeed, null);

    strategy.applyVehicleUpgrades(null);
    strategy.applySpawnStatBonuses(player);
    assert.equal(player.baseSpeed, 35);

    const liveConfigPlayer = {
        _arcadeBaseSpeed: 35,
        _speedEffectBaseSpeed: 43.75,
        baseSpeed: 21.875,
        speed: 21.875,
        isBoosting: false,
        controlRampRates: {},
        controller: null,
    };
    Player.prototype.setControlOptions.call(liveConfigPlayer, { speed: 40 });
    assert.equal(liveConfigPlayer._arcadeBaseSpeed, 40);
    assert.equal(liveConfigPlayer._speedEffectBaseSpeed, 50);
    assert.equal(liveConfigPlayer.baseSpeed, 25);
    assert.equal(liveConfigPlayer.speed, 25);

    const huntStrategy = new HuntModeStrategy();
    const huntPlayer = {
        ...player,
        entityRuntimeConfig: {
            ...player.entityRuntimeConfig,
            HUNT: { ENABLED: true, ACTIVE_MODE: 'HUNT', DEFAULT_MODE: 'HUNT' },
        },
        activeEffects: [],
        baseSpeed: 35,
        speed: 35,
        maxHp: 100,
        hp: 100,
        fightLoadout: { speedBonusPct: 25, turningBonusPct: 0, maxHpBonus: 0 },
    };
    huntStrategy.applySpawnStatBonuses(huntPlayer);
    updatePlayerEffects(huntPlayer, 1 / 60);
    assert.equal(huntPlayer.baseSpeed, 43.75);
});

test('direct Arcade shields survive effect updates while pickup shields still expire', () => {
    const strategy = new ArcadeModeStrategy();
    const createPlayer = () => ({
        entityRuntimeConfig: {
            PLAYER: { SPEED: 35 },
            POWERUP: {},
            TRAIL: {},
            HUNT: { ENABLED: true, ACTIVE_MODE: 'ARCADE', DEFAULT_MODE: 'ARCADE', SHIELD_MAX_HP: 40 },
        },
        activeEffects: [],
        baseSpeed: 35,
        speed: 35,
        alive: true,
        hp: 100,
        maxHp: 100,
        hasShield: false,
        shieldHP: 0,
        maxShieldHp: 40,
        shieldHitFeedback: 0,
        trail: null,
    });
    const intermissionPlayer = createPlayer();

    const intermission = strategy.applyIntermissionHealing(intermissionPlayer, {});
    assert.ok(intermission.shieldGranted > 0);
    updatePlayerEffects(intermissionPlayer, 1 / 60);
    assert.equal(intermissionPlayer.hasShield, true);
    assert.equal(intermissionPlayer.shieldHP, intermission.shieldGranted);

    const recoveryShieldPlayer = createPlayer();
    recoveryShieldPlayer.entityRuntimeConfig.HUNT.ACTIVE_MODE = 'HUNT';
    recoveryShieldPlayer.entityRuntimeConfig.HUNT.DEFAULT_MODE = 'HUNT';
    recoveryShieldPlayer.hasShield = true;
    recoveryShieldPlayer.shieldHP = 18;
    updatePlayerEffects(recoveryShieldPlayer, 1 / 60);
    assert.equal(recoveryShieldPlayer.hasShield, true);
    assert.equal(recoveryShieldPlayer.shieldHP, 18);

    const pickupPlayer = createPlayer();
    applyPlayerPowerup(pickupPlayer, 'SHIELD');
    pickupPlayer.activeEffects.find((effect) => effect.type === 'SHIELD').remaining = 0;
    updatePlayerEffects(pickupPlayer, 1 / 60);
    assert.equal(pickupPlayer.hasShield, false);
    assert.equal(pickupPlayer.shieldHP, 0);
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
    const clearedRocketTrailOwners = [];
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
        _projectileSystem: {
            clearRocketTrailsForOwner(player) {
                clearedRocketTrailOwners.push(player);
            },
        },
    });

    manager._emitHuntDamageEvent({
        target,
        cause: 'TRAIL_SELF',
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
        'self_collision',
        'kill',
        'exit_portal',
        'collect',
        'trail_extend',
    ]);
    assert.deepEqual(clearedRocketTrailOwners, [target, target]);
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

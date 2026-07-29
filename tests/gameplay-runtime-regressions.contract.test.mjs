import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG } from '../src/core/Config.js';
import { createGameStateSnapshot } from '../src/core/GameStateSnapshot.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { GameRuntimeArcadeSupport } from '../src/core/runtime/GameRuntimeArcadeSupport.js';
import { resolveArcadeSectorRuntimeProfile } from '../src/entities/directors/ArcadeEncounterCatalog.js';
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
    runtime.applyGameplayEvent({ type: 'tick' });
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

test('Arcade intermission restores carried vitals before healing and grants combo buffer', () => {
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
    assert.equal(result.comboFreezeGrantedMs, 1200);
    assert.equal(runtime._state.comboFreezeUntilMs, 6200);
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

test('Portal Line adds ten percentage points to intermission shield conversion', () => {
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
    assert.equal(portal.shieldGranted, 7);
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

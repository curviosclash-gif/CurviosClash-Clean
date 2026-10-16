import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HeuristicBotPolicy } from '../src/entities/ai/HeuristicBotPolicy.js';
import { applyHuntParcoursRivalSpawnBonuses } from '../src/entities/ai/HeuristicHuntParcoursModifierOps.js';
import { resolveArcadeRankKey, insertArcadeRankedResult, normalizeArcadeRankedLeaderboard } from '../src/shared/contracts/ArcadeRankedLeaderboardContract.js';
import { createArcadeRoundStateController } from '../src/state/arcade/ArcadeRoundStateController.js';
import { HuntParcoursRuntime } from '../src/core/arcade/HuntParcoursRuntime.js';
import { GameDebugApi } from '../src/core/GameDebugApi.js';
import * as O from '../src/entities/ai/observation/ObservationSchemaV1.js';

function scenario({ enemyZ = -25, weight = 0.6, blocked = false } = {}) {
    const bot = { index: 1, alive: true, isBot: true, isArcadeParcoursCompetitor: true,
        isHuntParcoursCompetitor: true, position: new THREE.Vector3(), hp: 100, maxHp: 100,
        speed: 18, baseSpeed: 18, hitboxRadius: 0.8, inventory: [], rocketInventory: [],
        getDirection: out => out.set(0, 0, -1) };
    const human = { ...bot, index: 0, isBot: false, position: new THREE.Vector3(0, 0, enemyZ) };
    const observation = new Array(O.OBSERVATION_LENGTH_V1).fill(0);
    for (const index of [O.WALL_DISTANCE_FRONT, O.WALL_DISTANCE_LEFT, O.WALL_DISTANCE_RIGHT,
        O.WALL_DISTANCE_UP, O.WALL_DISTANCE_DOWN, O.LOCAL_OPENNESS_RATIO]) observation[index] = 1;
    observation[O.TARGET_DISTANCE_RATIO] = 0; // Route observation must not masquerade as a close enemy.
    const context = { dt: 1 / 60, observation, players: [bot, human], visiblePlayers: [bot, human],
        projectiles: [], powerups: [], visiblePowerups: [],
        runtimeConfig: { arcade: { enabled: true, runType: 'hunt_parcours', huntParcoursRaceWeight: weight } },
        arena: { checkpointRings: [], checkCollision: () => blocked },
        parcoursRoute: { enabled: true, totalCheckpoints: 1, checkpoints: [{ id: 'cp1', routeIndex: 0, pos: [0, 0, -100] }] },
        parcoursProgress: { nextCheckpointIndex: 0 } };
    return { bot, human, context, policy: new HeuristicBotPolicy({ difficulty: 'HARD' }) };
}

test('Nemesis fights a nearby real enemy and retains MG fire through the policy bridge', () => {
    const { policy, bot, context } = scenario();
    const input = policy.update(1 / 60, bot, context);
    assert.equal(policy.getDecisionSnapshot().mode, 'RACE_HUNT');
    assert.equal(policy.getDecisionSnapshot().intent, 'race-hunt-combat');
    assert.equal(input.shootMG, true);
    assert.equal(bot.fightTargetPlayerIndex, 0);
});

test('a close ring observation never substitutes for enemy distance', () => {
    const { policy, bot, context } = scenario({ enemyZ: -200 });
    assert.equal(policy.update(1 / 60, bot, context).shootMG, false);
    assert.equal(policy.getDecisionSnapshot().intent, 'race-hunt-route');
});

test('the rival returns to its route after a bounded combat detour, then can engage again', () => {
    const { policy, bot, human, context } = scenario();
    const advance = () => { bot.position.z -= 1.8; human.position.z -= 1.8; policy.update(0.1, bot, context); };
    for (let index = 0; index < 21; index++) advance();
    assert.equal(policy.getDecisionSnapshot().intent, 'race-hunt-route');
    for (let index = 0; index < 14; index++) advance();
    assert.equal(policy.getDecisionSnapshot().intent, 'race-hunt-combat');
    policy.resetRound();
    assert.deepEqual(policy._raceHuntState, { combatSeconds: 0, routeSeconds: 0 });
});

test('pure racing remains unarmed and ordinary Arcade bots retain their existing route policy', () => {
    for (const ordinary of [false, true]) {
        const { policy, bot, context } = scenario({ weight: 1 });
        if (ordinary) bot.isHuntParcoursCompetitor = false;
        assert.equal(policy.update(1 / 60, bot, context).shootMG, false);
        assert.equal(policy.getDecisionSnapshot().mode, ordinary ? 'ARCADE' : 'RACE_HUNT');
    }
});

test('blocked firing corridors remain protected during Nemesis combat', () => {
    const { policy, bot, context } = scenario({ blocked: true });
    assert.equal(policy.update(1 / 60, bot, context).shootMG, false);
});

test('rival bonuses are re-applied after each ordinary spawn reset without stacking', () => {
    const player = { huntParcoursRival: true, huntParcoursRivalModifiers: {
        healthMultiplier: 1.75, speedMultiplier: 1.08, turnMultiplier: 1.1, shieldBonus: 40 } };
    for (let index = 0; index < 3; index++) {
        Object.assign(player, { maxHp: 100, hp: 100, baseSpeed: 20, shieldHP: 10, maxShieldHp: 30 });
        if (index === 0) player.turnSpeed = 2;
        applyHuntParcoursRivalSpawnBonuses(player);
        assert.equal(player.maxHp, 175);assert.equal(player.baseSpeed, 21.6);
        assert.equal(player.turnSpeed, 2.2);assert.equal(player.shieldHP, 50);assert.equal(player.maxShieldHp, 70);
    }
});

const context = { ranked: true, runType: 'hunt_parcours', scoreModel: 'hunt-score.v1',
    huntParcoursVariantId: 'nemesis', rivalTierGroup: '0-1', vehicleLevel: 1, tierId: 'normal',
    runId: 'a', vehicleId: 'ship1' };

test('Nemesis ranking separates model, variant, rival tier and vehicle level', () => {
    const key = resolveArcadeRankKey(context);
    assert.equal(key, 'hunt_parcours:hunt-score.v1:nemesis:0-1:normal:1-5');
    assert.notEqual(resolveArcadeRankKey({ ...context, rivalTierGroup: '2-3' }), key);
    assert.notEqual(resolveArcadeRankKey({ ...context, vehicleLevel: 6 }), key);
    assert.equal(resolveArcadeRankKey({ ...context, scoreModel: 'arcade-score.v2' }), '');
    assert.equal(resolveArcadeRankKey({ ...context, huntParcoursVariantId: 'bogus' }), '');
    const inserted = insertArcadeRankedResult(null, context, { score: 2200 }, 0);
    const next = insertArcadeRankedResult(inserted.leaderboard, { ...context, runId: 'b' }, { score: 2500 }, 1);
    assert.deepEqual(next.leaderboard.boards[key].map(row => row.runId), ['b', 'a']);
    const normalized = normalizeArcadeRankedLeaderboard({ ...next.leaderboard, boards: { [key]: [
        ...next.leaderboard.boards[key], { ...next.leaderboard.boards[key][0], runId: 'legacy', scoreModel: '' },
    ] } });
    assert.equal(normalized.boards[key].length, 2);
});

test('Nemesis round countdown advances through the shared controller without a missing hook', () => {
    const runtime = new HuntParcoursRuntime();
    runtime.phase = 'transition';runtime.mapIndex = 1;
    const controller = createArcadeRoundStateController({ arcadeRuntime: runtime,
        baseController: { deriveRoundEndTick: () => ({ action: 'START_ROUND' }) } });
    assert.equal(controller.deriveRoundEndTick().action, 'START_ROUND');
    assert.equal(runtime.mapIndex, 1, 'consuming countdown must not advance the already queued map twice');
});

test('developer Nemesis start remains unavailable in a release runtime', () => {
    let calls = 0;
    const release = new GameDebugApi({ isDevelopmentEnvironment: () => false, startHuntParcours: () => ++calls });
    assert.equal(release.startHuntParcours(), false);assert.equal(calls, 0);
    const developer = new GameDebugApi({ isDevelopmentEnvironment: () => true, startHuntParcours: () => ++calls });
    assert.equal(developer.startHuntParcours(), 1);
});
import { CONFIG_BASE } from '../src/core/Config.js';
import { Player } from '../src/entities/Player.js';
import { EntitySpawnOps } from '../src/entities/runtime/EntitySpawnOps.js';
import { RespawnSystem } from '../src/hunt/RespawnSystem.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

test('real Arcade Hunt respawns retain learned rival stats exactly after repeated deaths', () => {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const runtimeConfig = { arcade: { enabled: true, runType: 'hunt_parcours', combatProfile: 'hunt' } };
    const strategy = new ArcadeModeStrategy({ entityRuntimeConfig, runType: 'hunt_parcours', combatProfile: 'hunt', random: () => 0.5 });
    const manager = { entityRuntimeConfig, runtimeConfig, gameModeStrategy: strategy, _simulationClockMs: 0,
        getTrailSpatialIndex: () => null };
    const player = new Player({ addToScene() {}, removeFromScene() {} }, 1, 0xffaa33, true, { entityManager: manager });
    new EntitySpawnOps(manager).spawnPlayerAt(player, new THREE.Vector3(0, 20, 0), new THREE.Vector3(0, 0, -1));
    player.huntParcoursRival = true;
    player.huntParcoursRivalModifiers = { healthMultiplier: 1.75, speedMultiplier: 1.08, turnMultiplier: 1.1, shieldBonus: 40 };
    applyHuntParcoursRivalSpawnBonuses(player);
    const before = { hp: player.maxHp, speed: player.baseSpeed, turn: player.turnSpeed, shield: player.maxShieldHp };
    const respawns = new RespawnSystem({ entityRuntimeConfig,
        callbacks: { getStrategy: () => strategy, getSimulationNowMs: () => 0, parcours: {
            isRespawnEnabled: () => true, takeRespawnPlan: () => ({ position: [20, 20, 0], forward: [0, 0, -1], delaySeconds: 0.2 }),
        } },
        spawn: { findSpawnPosition: () => new THREE.Vector3(20, 20, 0), findSafeSpawnDirection: () => new THREE.Vector3(0, 0, -1) },
        events: { emitHuntFeed() {} } });
    for (let index = 0; index < 3; index++) {
        player.alive = false;
        assert.equal(respawns.onPlayerDied(player), true);
        respawns.update(60);assert.equal(player.alive, true);
        assert.deepEqual({ hp: player.maxHp, speed: player.baseSpeed, turn: player.turnSpeed, shield: player.maxShieldHp }, before);
    }
});
import { GameRuntimeHuntParcoursSupport } from '../src/core/runtime/GameRuntimeHuntParcoursSupport.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';

test('a nearby opponent behind the route cannot pull the rival beyond its detour budget', () => {
    const { policy, bot, human, context } = scenario({ enemyZ: 25 });
    policy.update(1 / 60, bot, context);
    assert.equal(policy.getDecisionSnapshot().intent, 'race-hunt-route');
    assert.ok(policy._raceHuntState.routeSeconds > 0);
    human.position.z = -25;
    policy.update(1 / 60, bot, context);
    assert.equal(policy.getDecisionSnapshot().intent, 'race-hunt-route', 'detour cancellation keeps its route cooldown');
});

test('Nemesis callbacks reject old entity managers and earlier bindings on the same manager', () => {
    const human = { index: 0, alive: true, isBot: false };
    const rival = { index: 1, alive: true, isBot: true, maxHp: 100, hp: 100, baseSpeed: 20, turnSpeed: 2 };
    const first = { players: [human, rival], humanPlayers: [human] };
    let state = { entityManager: first, runtimeConfig: { arcade: { enabled: true, runType: 'hunt_parcours' } } };
    const support = { getRuntimeState: () => state, game: {} };
    const bridge = new GameRuntimeHuntParcoursSupport(support);
    const callbacks = bridge.createParcoursCallbacks(first);
    const handle = bridge.createGameplayHandler(first);
    bridge.runtime.start(first);
    const kill = { type: 'kill', playerIndex: 0, victimIndex: 1, count: 1 };
    handle(kill);handle(kill);handle(kill);bridge.runtime.getRoundOutcome();
    const second = { players: [{ ...human }, { ...rival }], humanPlayers: [{ ...human }] };
    state = { ...state, entityManager: second };
    const freshCallbacks = bridge.createParcoursCallbacks(second), freshHandle = bridge.createGameplayHandler(second);
    bridge.runtime.start(second);
    let xp = 0;bridge.runtime.handleXpEvent = () => ++xp;
    const before = bridge.getState();
    handle(kill);callbacks.xp('checkpoint', 0);
    callbacks.leaderboard({ type: 'finish', playerIndex: 0, totalTimeMs: 1000 });
    callbacks.leaderboard({ type: 'round_outcome' });
    assert.deepEqual(bridge.getState(), before);assert.equal(xp, 0);
    freshCallbacks.xp('checkpoint', 0);freshHandle(kill);
    assert.equal(xp, 1);assert.equal(bridge.runtime.humanKills, 1);
    bridge.createParcoursCallbacks(second);
    const latestHandle = bridge.createGameplayHandler(second);
    freshHandle(kill);freshCallbacks.xp('checkpoint', 0);
    assert.equal(bridge.runtime.humanKills, 1);assert.equal(xp, 1);
    latestHandle(kill);assert.equal(bridge.runtime.humanKills, 2);
});

test('both Nemesis duelists start at the course grid on all three maps', () => {
    for (const mapKey of ['mirror_docks', 'glass_serpent', 'wind_cathedral']) {
        const route = MAP_PRESET_CATALOG[mapKey].parcours;
        const players = [0, 1].map(index => ({ index, isBot: index === 1, hitboxRadius: 0.8, position: new THREE.Vector3() }));
        const manager = { players, runtimeConfig: { arcade: { enabled: true, runType: 'hunt_parcours' } },
            arena: { checkCollision: () => false }, _parcoursProgressSystem: { getRouteSnapshot: () => route },
            _findSpawnPosition: () => { throw new Error('Combat separation must not scatter duel racers'); } };
        const ops = new EntitySpawnOps(manager), spawns = [];
        ops.spawnPlayerAt = (player, position, direction) => spawns.push({ player, position, direction });
        for (const player of players) ops.spawnPlayer(player);
        assert.equal(spawns.length, 2);
        for (const spawn of spawns) {
            assert.ok(spawn.position.distanceTo(new THREE.Vector3(...route.checkpoints[0].pos)) < 20);
            assert.ok(spawn.direction.dot(new THREE.Vector3(...route.checkpoints[0].forward)) > 0);
        }
        assert.ok(spawns[0].position.distanceTo(spawns[1].position) >= 4);
    }
});
import { createGameDebugRuntimeAccess } from '../src/core/GameDebugApi.js';

test('a missing active profile blocks developer start before any mutation or match start', async () => {
    for (const profile of [null, { id: '' }, { id: '   ' }]) {
        let calls = 0;
        const settings = { arcade: {}, localSettings: {}, mode: 'preserve' };
        const game = { state: 'MENU', settings, playerProfileManager: { getActiveProfile: () => profile },
            _onSettingsChanged: () => ++calls,
            runtimeCoordinator: { getRuntimeFacade: () => ({ startMatch: () => ++calls }) } };
        const access = createGameDebugRuntimeAccess(game);
        assert.equal(await access.startHuntParcours('nemesis'), false);
        assert.deepEqual(settings, { arcade: {}, localSettings: {}, mode: 'preserve' });assert.equal(calls, 0);
    }
});

test('developer start freezes the active UUID and exact Nemesis seed before entering the match', async () => {
    const id = '967cd1ac-811a-46fd-bb39-a246f545f532';
    const settings = { arcade: {}, localSettings: {} };let starts = 0;
    const game = { state: 'MENU', settings, playerProfileManager: { getActiveProfile: () => ({ id }) },
        _onSettingsChanged: async () => { assert.deepEqual(settings.arcade.playerProfileIds, [id, '', '']); },
        runtimeCoordinator: { getRuntimeFacade: () => ({ startMatch: () => { starts++;return true; } }) } };
    assert.equal(await createGameDebugRuntimeAccess(game).startHuntParcours('nemesis'), true);
    assert.equal(starts, 1);assert.equal(settings.arcade.seed, 130101);assert.equal(settings.mapKey, 'mirror_docks');
    assert.equal(settings.localSettings.sessionType, 'single');
});

test('an explicit per-rival race weight can keep a close encounter on the route', () => {
    const { policy, bot, context } = scenario();bot.huntParcoursRaceWeight = 1;
    assert.equal(policy.update(1 / 60, bot, context).shootMG, false);
    assert.equal(policy.getDecisionSnapshot().intent, 'race-hunt-route');
});

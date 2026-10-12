import assert from 'node:assert/strict';
import test from 'node:test';

import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { resolveArcadeParcoursRespawnFallback } from '../src/modes/ArcadeRunRulesOps.js';
import {
    WEAPON_RACE_FINISH_XP,
    WEAPON_RACE_GHOST_ROUTE_ID,
    WEAPON_RACE_NEW_BEST_XP,
    WEAPON_RACE_WEAPON_STAGES,
} from '../src/shared/contracts/WeaponRaceContract.js';
import { createPlayerProgressState } from '../src/entities/systems/ParcoursProgressUtils.js';
import { applyParcoursDeathRespawn } from '../src/entities/systems/ParcoursRespawnOps.js';
import {
    applyWeaponRaceStage,
    clearWeaponRaceLoadout,
} from '../src/entities/arcade/WeaponRaceLoadoutOps.js';
import { createWeaponRaceRoute } from '../src/entities/arcade/WeaponRaceRouteOps.js';
import { resolveWeaponRaceGridSpawn } from '../src/entities/arcade/WeaponRaceSpawnOps.js';
import { WeaponRaceRuntime } from '../src/core/arcade/WeaponRaceRuntime.js';
import { XP_REWARD_TABLE } from '../src/state/arcade/ArcadeVehicleProfile.js';
import { handleWeaponRaceLeaderboard } from '../src/core/runtime/GameRuntimeArcadeSupportOps.js';
import { RoundOutcomeSystem } from '../src/entities/systems/RoundOutcomeSystem.js';

function player(index, isBot = false) {
    return {
        index,
        isBot,
        inventory: ['SHIELD', 'LIGHTNING'],
        rocketInventory: ['ROCKET_GUIDED'],
        activeEffects: [
            { type: 'FLAMETHROWER', remaining: 20, fuelSeconds: 1 },
            { type: 'RAILGUN', remaining: 20, shots: 1 },
            { type: 'SPEED_UP', remaining: 4 },
        ],
        applyPowerup(type) {
            this.activeEffects.push({ type, remaining: 30 });
        },
    };
}

test('W7.5 every fixed checkpoint grants a fresh exclusive race weapon to humans and bots', () => {
    for (const isBot of [false, true]) {
        const racer = player(isBot ? 1 : 0, isBot);
        for (const stage of WEAPON_RACE_WEAPON_STAGES) {
            const result = applyWeaponRaceStage(racer, stage);
            assert.equal(result.applied, true);
            assert.equal(racer.weaponRaceWeaponId, stage.weaponId);
            assert.equal(racer.rocketInventory.length, stage.weaponId === 'rocket_medium' ? 3 : 0);
            assert.equal(racer.inventory.includes('LIGHTNING'), stage.weaponId === 'lightning');
            assert.ok(!racer.rocketInventory.includes('ROCKET_GUIDED'));
        }
        clearWeaponRaceLoadout(racer);
        assert.equal(racer.weaponRaceWeaponId, '');
        assert.deepEqual(racer.rocketInventory, []);
        assert.deepEqual(racer.inventory, ['SHIELD']);
        assert.deepEqual(racer.activeEffects, [{ type: 'SPEED_UP', remaining: 4 }]);
    }
});

test('W7.5 weapon race route keeps the assault map but separates its ghost and race rules', () => {
    const original = {
        routeId: 'assault_mg_rockets_v2',
        rules: { ordered: true, showGhost: false, wrongOrderPenaltyMs: 2000 },
        checkpoints: [{ id: 'CP01_START' }],
    };
    const route = createWeaponRaceRoute(original);

    assert.equal(route.routeId, WEAPON_RACE_GHOST_ROUTE_ID);
    assert.equal(route.rules.showGhost, true);
    assert.equal(route.rules.finishGraceMs, 15_000);
    assert.equal(route.rules.wrongOrderPenaltyMs, 0);
    assert.notEqual(route, original);
    assert.equal(original.routeId, 'assault_mg_rockets_v2');
});

test('W7.5 all five racers start on a fair grid behind the first checkpoint', () => {
    const route = { checkpoints: [{ id: 'CP01_START', routeIndex: 0, pos: [10, 5, 20], forward: [1, 0, 0] }] };
    const makeVector = () => ({ x: 0, y: 0, z: 0, clone: makeVector, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } });
    const spawns = Array.from({ length: 5 }, (_, index) => resolveWeaponRaceGridSpawn(route, { position: makeVector() }, index));
    assert.deepEqual(spawns.map((entry) => entry.position.x), [-1, -1, -1, -1, -1]);
    assert.equal(new Set(spawns.map((entry) => entry.position.z)).size, 5);
    assert.ok(spawns.every((entry) => entry.direction.x === 1));
});

test('W7.5 death returns to the last checkpoint after two seconds without exhausting progress', () => {
    const rules = resolveArcadeParcoursRespawnFallback('weapon_race', true);
    const route = {
        rules,
        totalCheckpoints: 5,
        checkpoints: [
            { id: 'CP01_START', pos: [0, 0, 0], forward: [1, 0, 0], radius: 5 },
            { id: 'CP03_MG', pos: [20, 0, 0], forward: [1, 0, 0], radius: 5 },
        ],
        entriesByCheckpointIndex: [[{ id: 'CP01_START', pos: [0, 0, 0], forward: [1, 0, 0], radius: 5 }], [], [{ id: 'CP03_MG', pos: [20, 0, 0], forward: [1, 0, 0], radius: 5 }]],
    };
    const state = createPlayerProgressState(5);
    state.nextCheckpointIndex = 3;
    state.stageCheckpointIds[2] = 'CP03_MG';

    const result = applyParcoursDeathRespawn(route, state, { hitboxRadius: 1 }, { now: 1000 });

    assert.equal(result.plan.checkpointId, 'CP03_MG');
    assert.equal(result.plan.delaySeconds, 2);
    assert.equal(result.plan.restartAtFirstCheckpoint, false);
    assert.equal(state.nextCheckpointIndex, 3);
});

test('W7.5 runtime awards checkpoint XP once, refreshes checkpoint weapons and ranks after grace', () => {
    const human = player(0, false);
    const bot = player(1, true);
    const records = new Map();
    const store = {
        loadJsonRecord: (key, fallback) => records.has(key) ? structuredClone(records.get(key)) : fallback,
        saveJsonRecord: (key, value) => { records.set(key, structuredClone(value)); return true; },
    };
    const runtime = new WeaponRaceRuntime({ now: () => 1000, getRecordStore: () => store });
    runtime.start({ entityManager: { players: [human, bot], humanPlayers: [human], _projectileSystem: { clearForOwner() {} } } });

    const first = runtime.handleCheckpoint({ playerIndex: 0, checkpointId: 'CP03_MG' });
    const repeat = runtime.handleCheckpoint({ playerIndex: 0, checkpointId: 'CP03_MG' });
    runtime.handleCheckpoint({ playerIndex: 1, checkpointId: 'CP05_ROCKET' });
    runtime.handleDeath({ playerIndex: 0 });

    assert.equal(first.awardedXp, 10);
    assert.equal(repeat.awardedXp, 0);
    assert.equal(human.weaponRaceWeaponId, 'flamethrower');
    assert.equal(bot.weaponRaceWeaponId, 'rocket_medium');
    runtime.handleFinish({ playerIndex: 1, finishedAtMs: 5000 });
    runtime.handleFinish({ playerIndex: 0, finishedAtMs: 6000 });
    assert.equal(runtime.handleNewBest(0).awardedXp, 0);
    assert.equal(runtime.handleNewBest(0).awardedXp, 0);
    assert.equal(runtime.getRoundOutcome(19_999), null);
    const outcome = runtime.getRoundOutcome(20_000);
    assert.equal(outcome.winner.index, 1);
    assert.deepEqual(outcome.standings.map((row) => row.playerId), ['1', '0']);
});

test('W7.5 finish XP waits for the settled human winner and is awarded only once', () => {
    const makeRuntime = () => {
        const records = new Map();
        const store = {
            loadJsonRecord: (key, fallback) => records.has(key) ? structuredClone(records.get(key)) : fallback,
            saveJsonRecord: (key, value) => { records.set(key, structuredClone(value)); return true; },
        };
        const human = player(0, false);
        const bot = player(1, true);
        const runtime = new WeaponRaceRuntime({ now: () => 1000, getRecordStore: () => store });
        runtime.start({ entityManager: { players: [human, bot], humanPlayers: [human], _projectileSystem: { clearForOwner() {} } } });
        return { runtime, human, bot };
    };

    const botFirst = makeRuntime();
    botFirst.runtime.handleCheckpoint({ playerIndex: 0, checkpointId: 'CP02_MG' });
    botFirst.runtime.handleGameplayEvent({ playerIndex: 0, type: 'kill' });
    const earnedDuringPlay = botFirst.runtime.xpEarned;
    botFirst.runtime.handleFinish({ playerIndex: 1, finishedAtMs: 5000 });
    const humanSecond = botFirst.runtime.handleFinish({ playerIndex: 0, finishedAtMs: 6000 });
    assert.equal(humanSecond.awardedXp, 0);
    assert.equal(humanSecond.pendingXp, WEAPON_RACE_FINISH_XP);
    const bestResult = handleWeaponRaceLeaderboard({
        weaponRaceRuntime: botFirst.runtime,
        arcadeRunRuntime: { applyParcoursLeaderboardEvent: () => ({ isBestTime: true }) },
    }, { entityManager: { humanPlayers: [botFirst.human] } }, { type: 'finish', playerIndex: 0 });
    assert.equal(bestResult.isBestTime, true);
    assert.equal(botFirst.runtime.bestXpPending, true);
    assert.equal(botFirst.runtime.xpEarned, earnedDuringPlay, 'checkpoint and gameplay XP remain while finish XP is pending');
    assert.equal(botFirst.runtime.getRoundOutcome(20_000).winner.index, 1);
    assert.equal(botFirst.runtime.xpEarned, earnedDuringPlay, 'a bot winner receives no human finish prize');
    assert.equal(botFirst.runtime.bestXpAwarded, false, 'a bot winner receives no best-time prize');

    const humanFirst = makeRuntime();
    const humanFinish = humanFirst.runtime.handleFinish({ playerIndex: 0, finishedAtMs: 5000 });
    assert.equal(humanFinish.pendingXp, WEAPON_RACE_FINISH_XP);
    assert.equal(humanFirst.runtime.xpEarned, 0, 'the human finish prize waits for the race outcome');
    const botFinish = humanFirst.runtime.handleFinish({ playerIndex: 1, finishedAtMs: 6000 });
    assert.equal(botFinish.pendingXp, 0);
    humanFirst.runtime.handleNewBest(0);
    const outcome = humanFirst.runtime.getRoundOutcome(20_000);
    assert.equal(outcome.winner.index, 0);
    assert.equal(outcome.awardedXp, WEAPON_RACE_FINISH_XP + WEAPON_RACE_NEW_BEST_XP);
    assert.equal(humanFirst.runtime.xpEarned, WEAPON_RACE_FINISH_XP + WEAPON_RACE_NEW_BEST_XP);
    humanFirst.runtime.getRoundOutcome(20_001);
    assert.equal(humanFirst.runtime.xpEarned, WEAPON_RACE_FINISH_XP + WEAPON_RACE_NEW_BEST_XP,
        'repeated outcome reads must not duplicate finish or best-time XP');
});

test('W7.5 a structured failed finish-XP save stays pending and retries after storage recovers', () => {
    const records = new Map();
    let saveCalls = 0;
    const store = {
        loadJsonRecord: (key, fallback) => records.has(key) ? structuredClone(records.get(key)) : fallback,
        saveJsonRecord: (key, value) => {
            saveCalls += 1;
            if (saveCalls === 1) return { ok: false, status: 'write_failed' };
            records.set(key, structuredClone(value));
            return { ok: true, status: 'saved' };
        },
    };
    const human = { ...player(0, false), alive: true };
    const bot = { ...player(1, true), alive: true };
    const runtime = new WeaponRaceRuntime({ now: () => 1000, getRecordStore: () => store });
    runtime.start({ entityManager: { players: [human, bot], humanPlayers: [human], _projectileSystem: { clearForOwner() {} } } });
    runtime.handleFinish({ playerIndex: 0, finishedAtMs: 5000 });
    runtime.handleFinish({ playerIndex: 1, finishedAtMs: 6000 });

    const outcomeSystem = new RoundOutcomeSystem({
        getPlayers: () => [human, bot],
        getHumanPlayers: () => [human],
        getBots: () => [bot],
        getObjectiveOutcome: () => handleWeaponRaceLeaderboard({ weaponRaceRuntime: runtime }, null, {
            type: 'round_outcome', now: 20_000,
        }),
    });
    human.alive = false;
    human.hp = 0;
    const firstPoll = outcomeSystem.resolve();
    assert.equal(firstPoll.shouldEnd, false, 'failed persistence keeps the normal round-end poll open');
    assert.equal(runtime.xpEarned, 0);
    assert.equal(runtime.state.racers['0'].finishXpAwarded, false);

    const retryPoll = outcomeSystem.resolve();
    assert.equal(retryPoll.shouldEnd, true);
    assert.equal(retryPoll.reason, 'WEAPON_RACE_COMPLETE');
    assert.equal(runtime.xpEarned, WEAPON_RACE_FINISH_XP);
    assert.equal(runtime.state.racers['0'].finishXpAwarded, true);
    assert.equal(saveCalls, 2);
});

test('W7.5 a structured failed checkpoint-XP save is not acknowledged and retries safely', () => {
    const records = new Map();
    let saveCalls = 0;
    const store = {
        loadJsonRecord: (key, fallback) => records.has(key) ? structuredClone(records.get(key)) : fallback,
        saveJsonRecord: (key, value) => {
            saveCalls += 1;
            if (saveCalls === 1) return { ok: false, status: 'write_failed' };
            records.set(key, structuredClone(value));
            return { ok: true, status: 'saved' };
        },
    };
    const human = player(0, false);
    const runtime = new WeaponRaceRuntime({ now: () => 1000, getRecordStore: () => store });
    runtime.start({ entityManager: { players: [human], humanPlayers: [human], _projectileSystem: { clearForOwner() {} } } });

    const failed = runtime.handleCheckpoint({ playerIndex: 0, checkpointId: 'CP02_MG' });
    const racer = runtime.state.racers['0'];
    assert.equal(failed.awardedXp, 0);
    assert.equal(failed.rewardPending, true);
    assert.equal(runtime.pendingCheckpointRewards.length, 1);
    assert.equal(racer.checkpointId, 'CP02_MG', 'the reached checkpoint and weapon stage remain active');
    assert.deepEqual(racer.awardedCheckpointIds, [], 'failed persistence must not mark the reward as paid');
    assert.equal(racer.checkpointXp, 0);
    assert.equal(runtime.xpEarned, 0);

    runtime.update(1001);
    assert.equal(runtime.pendingCheckpointRewards.length, 0);
    assert.deepEqual(racer.awardedCheckpointIds, ['CP02_MG']);
    assert.equal(racer.checkpointXp, 10);
    assert.equal(runtime.xpEarned, 10);
    assert.equal(runtime.getHudState(1001).xpEarned, 10, 'the HUD only reflects the reward after the store acknowledges it');
    assert.equal(saveCalls, 2);
});

test('W7.5 failed gameplay XP stays pending until the normal runtime tick persists it', () => {
    const records = new Map();
    let saveCalls = 0;
    const store = {
        loadJsonRecord: (key, fallback) => records.has(key) ? structuredClone(records.get(key)) : fallback,
        saveJsonRecord: (key, value) => {
            saveCalls += 1;
            if (saveCalls === 1) return { ok: false, status: 'write_failed' };
            records.set(key, structuredClone(value));
            return { ok: true, status: 'saved' };
        },
    };
    const human = player(0, false);
    const runtime = new WeaponRaceRuntime({ now: () => 1000, getRecordStore: () => store });
    runtime.start({ entityManager: { players: [human], humanPlayers: [human], _projectileSystem: { clearForOwner() {} } } });

    const failed = runtime.handleGameplayEvent({ playerIndex: 0, type: 'kill' });
    assert.equal(failed.rewardPending, true);
    assert.equal(runtime.xpEarned, 0);
    assert.equal(runtime.getHudState().xpEarned, 0);
    assert.equal(runtime.pendingGameplayRewards.length, 1);

    runtime.update(1001);
    assert.equal(runtime.pendingGameplayRewards.length, 0);
    assert.equal(runtime.xpEarned, XP_REWARD_TABLE.killBase);
    assert.equal(runtime.getHudState(1001).xpEarned, XP_REWARD_TABLE.killBase);
    assert.equal(saveCalls, 2);
});

test('W7.5 repeated gameplay XP failures coalesce into one pending receipt', () => {
    let saveCalls = 0;
    const store = {
        loadJsonRecord: (_key, fallback) => fallback,
        saveJsonRecord: () => { saveCalls += 1; return { ok: false, status: 'write_failed' }; },
    };
    const human = player(0, false);
    const runtime = new WeaponRaceRuntime({ now: () => 1000, getRecordStore: () => store });
    runtime.start({ entityManager: { players: [human], humanPlayers: [human], _simulationClockMs: 0 } });

    for (let event = 0; event < 100; event += 1) {
        assert.equal(runtime.handleGameplayEvent({ playerIndex: 0, type: 'kill' }).rewardPending, true);
    }
    assert.equal(saveCalls, 1, 'only the first event attempts an immediate write');
    assert.equal(runtime.pendingGameplayRewards.length, 1);
    assert.equal(runtime.pendingGameplayRewards[0].amount, XP_REWARD_TABLE.killBase * 100);

    runtime.dispose();
    assert.equal(runtime.pendingSettlementBatches.length, 1);
    assert.equal(runtime.pendingSettlementBatches[0].items.length, 1);
    assert.equal(runtime.pendingSettlementBatches[0].items[0].amount, XP_REWARD_TABLE.killBase * 100);
});

test('W7.5 checkpoint weapons stay visible as non-consumable scene markers', () => {
    const human = player(0, false);
    let added = null;
    let removed = null;
    const route = {
        checkpoints: WEAPON_RACE_WEAPON_STAGES.map((stage, index) => ({ id: stage.checkpointId, pos: [index * 10, 5, 0] })),
    };
    const entityManager = {
        players: [human], humanPlayers: [human],
        renderer: { addToScene(root) { added = root; }, removeFromScene(root) { removed = root; } },
        _projectileSystem: { clearForOwner() {} },
        _parcoursProgressSystem: { getRouteSnapshot: () => route },
    };
    const runtime = new WeaponRaceRuntime({ now: () => 1000 });
    runtime.start({ entityManager });
    assert.equal(added.children.length, WEAPON_RACE_WEAPON_STAGES.length);
    assert.ok(added.children.every((mesh) => mesh.name.startsWith('weapon-race-pickup:')));
    runtime.dispose();
    assert.equal(removed, added);
});

test('W7.5 Arcade strategy composes Hunt combat for weapon race bots', () => {
    const strategy = new ArcadeModeStrategy({ runType: 'weapon_race', combatProfile: 'hunt' });
    assert.equal(strategy.getCombatProfile(), 'hunt');
    assert.equal(strategy.getParcoursRespawnFallback().respawnDelaySeconds, 2);
    assert.deepEqual(strategy.filterSpawnableTypes(['ROCKET_HEAVY', 'SHIELD', 'SPEED_UP', 'LIGHTNING'], {}), ['SHIELD', 'SPEED_UP']);
});

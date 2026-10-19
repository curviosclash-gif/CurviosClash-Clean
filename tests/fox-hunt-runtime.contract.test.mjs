import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { HuntParcoursRuntime } from '../src/core/arcade/HuntParcoursRuntime.js';
import { createFoxHuntStartOrder, resolveFoxHuntLeaders, resolveFoxHuntMap } from '../src/shared/contracts/FoxHuntContract.js';
import { emitArcadeEliminationEvents } from '../src/entities/runtime/EntityArcadeGameplayEvents.js';
import { getPreferredFightEnemy } from '../src/hunt/FightTargetSelector.js';
import { resolveOpportunisticEnemy } from '../src/entities/ai/HeuristicHuntTargetingOps.js';
import { applyParcoursDeathRespawn, resolveModeParcoursRoute } from '../src/entities/systems/ParcoursRespawnOps.js';
import { MAP_PRESETS } from '../src/core/config/MapPresets.js';
import { ParcoursProgressSystem } from '../src/entities/systems/ParcoursProgressSystem.js';
import { resolveArcadeRankKey } from '../src/shared/contracts/ArcadeRankedLeaderboardContract.js';
import { HUNT_PARCOURS_MEDAL_RECORD_STORAGE_KEY } from '../src/shared/contracts/HuntParcoursMedalRecordContract.js';
import { ARCADE_VEHICLE_PROFILE_STORAGE_KEY } from '../src/shared/contracts/ArcadeVehicleProfileContract.js';
import { XP_REWARD_TABLE } from '../src/state/arcade/ArcadeVehicleProfile.js';

const config = { arcade: { enabled: true, runType: 'hunt_parcours', huntParcoursVariantId: 'fox_hunt' } };
function fixture(humans = 1, seed = 130202) {
    const data = new Map(), transitions = [];
    const store = { readJsonRecordResult: key => data.has(key) ? { status: 'found', value: data.get(key) } : { status: 'missing' },
        saveJsonRecord(key, value) { data.set(key, structuredClone(value)); return true; } };
    const runtime = new HuntParcoursRuntime({ getRecordStore: () => store, requestMapTransition: value => transitions.push(value) });
    function manager() {
        const players = Array.from({ length: humans + 4 }, (_, index) => ({ index, alive: true, isBot: index >= humans,
            position: new THREE.Vector3(index, 12, 0), entitySlotActive: true }));
        const em = { players, humanPlayers: players.slice(0, humans), runtimeConfig: config, _simulationClockMs: 1000 };
        em.onArcadeGameplayEvent = event => runtime.handleGameplayEvent(event);
        return em;
    }
    runtime.start(manager(), { variantId: 'fox_hunt', seed });
    const time = ms => { runtime.entityManager._simulationClockMs = runtime.foxHunt.clockStart + ms; };
    const kill = (killer, victim = runtime.foxHunt.foxIndex, cause = 'PROJECTILE', extra = {}) => {
        emitArcadeEliminationEvents(runtime.entityManager, runtime.entityManager.players[victim], cause,
            { killer: runtime.entityManager.players[killer], ...extra });
    };
    const ring = (index, checkpointIndex = 0) => runtime.handleParcoursEvent({ type: 'checkpoint', playerIndex: index, checkpointIndex });
    const finish = index => runtime.handleParcoursEvent({ type: 'finish', playerIndex: index });
    return { runtime, store, data, manager, transitions, time, kill, ring, finish };
}

test('seeded start order treats all slots equally and never repeats across three maps', () => {
    for (const humans of [1, 2, 3]) {
        const indices = Array.from({ length: humans + 4 }, (_, i) => i);
        assert.deepEqual(createFoxHuntStartOrder(indices, 130202), createFoxHuntStartOrder([...indices].reverse(), 130202));
        assert.equal(new Set(createFoxHuntStartOrder(indices, 130202).slice(0, 3)).size, 3);
        const w = fixture(humans), starts = [];
        for (let map = 0; map < 3; map++) {
            starts.push(w.runtime.foxHunt.foxIndex);
            assert.equal(w.runtime.entityManager.players.filter(p => p.isBot).length, 4);
            w.finish(w.runtime.foxHunt.foxIndex); w.runtime.getRoundOutcome();
            if (map < 2) w.runtime.start(w.manager());
        }
        assert.equal(new Set(starts).size, 3);
        assert.equal(w.runtime.phase, 'finished');
    }
});

test('real elimination seam supports human→bot, bot→human and bot→bot role transfers once', () => {
    const w = fixture();
    w.runtime.foxHunt.setFox(1); w.kill(0);
    assert.equal(w.runtime.foxHunt.foxIndex, 0);
    w.kill(2); assert.equal(w.runtime.foxHunt.foxIndex, 2);
    w.kill(3); assert.equal(w.runtime.foxHunt.foxIndex, 3);
    assert.deepEqual(w.runtime.getHudState().pointsByPlayer, { 0: 250, 1: 0, 2: 250, 3: 250, 4: 0 });
    const duplicate = { type: 'fox_hunt_elimination', playerIndex: 2, victimIndex: 3, sequence: 3 };
    w.runtime.handleGameplayEvent(duplicate);
    assert.equal(w.runtime.foxHunt.foxIndex, 3);
    for (const p of w.runtime.entityManager.players.filter(p => p.isBot)) {
        assert.equal(p.huntParcoursRaceWeight, p.index === 3 ? 1 : 0);
        assert.equal(p.huntParcoursFoxTargetIndex, p.index === 3 ? undefined : 3);
    }
});

test('self, environment credit, foreign killer and nonfox kills never transfer the role', () => {
    const w = fixture(); w.runtime.foxHunt.setFox(1);
    w.kill(1); w.kill(0, 1, 'WALL'); w.kill(0, 1, 'PROJECTILE', { environmentCredit: true }); w.kill(0, 2);
    emitArcadeEliminationEvents(w.runtime.entityManager, w.runtime.entityManager.players[1], 'PROJECTILE', { killer: { index: 9 } });
    assert.equal(w.runtime.foxHunt.foxIndex, 1);
    assert.equal(w.runtime.getHudState().score, 0);
});

test('own ordered progress persists across roles; only fox crossings score and cannot repeat', () => {
    const w = fixture(); w.runtime.foxHunt.setFox(1);
    w.ring(0, 0); w.ring(1, 0); w.ring(1, 0); w.ring(1, 2);
    w.kill(0); w.ring(0, 0); w.ring(0, 1); w.ring(0, 1); w.ring(0, 3);
    assert.deepEqual(w.runtime.foxHunt.mapScores.get(0), { points: 350, rings: 1, kills: 1 });
    assert.deepEqual(w.runtime.foxHunt.mapScores.get(1), { points: 100, rings: 1, kills: 0 });
    w.runtime.start(w.runtime.entityManager);
    assert.equal(w.runtime.getHudState().score, 350, 'rebinding the same session cannot reset roles or scoring');
});

test('hunter finish is inert; fox finish wins that map even with fewer points', () => {
    const w = fixture(); w.runtime.foxHunt.setFox(1);
    w.finish(0); assert.equal(w.runtime.getRoundOutcome(), null);
    w.runtime.foxHunt.addScore(0, 2000); w.finish(1);
    assert.equal(w.runtime.getRoundOutcome().winner.index, 1);
    assert.deepEqual(w.runtime.mapResults[0].leaders, [1]);
    assert.equal(w.runtime.mapResults[0].scoresByPlayer[1].points, 1000);
});

test('timeout includes respawning pilots and applies rings, then kills, then shared victory', () => {
    const rows = new Map([[0, { points: 500, rings: 2, kills: 1 }], [1, { points: 500, rings: 3, kills: 0 }]]);
    assert.deepEqual(resolveFoxHuntLeaders(rows), [1]);
    rows.get(0).rings = 3; assert.deepEqual(resolveFoxHuntLeaders(rows), [0]);
    rows.get(1).kills = 1; assert.deepEqual(resolveFoxHuntLeaders(rows), [0, 1]);
    const w = fixture(); w.runtime.foxHunt.addScore(0, 500); w.runtime.entityManager.players[0].alive = false;
    w.time(300000); assert.equal(w.runtime.getRoundOutcome().winner.index, 0);
    assert.equal(w.runtime.mapResults[0].reason, 'timeout');
    const tie = fixture(); tie.time(300000);
    assert.equal(tie.runtime.getRoundOutcome().winner, null);
    assert.deepEqual(tie.runtime.mapResults[0].leaders, [0, 1, 2, 3, 4]);
});

test('deadline includes exact fox finish, processes earlier role change, and closes later events', () => {
    const w = fixture(); w.runtime.foxHunt.setFox(1); w.time(299999); w.kill(0);
    w.time(300000); w.finish(1); w.finish(0);
    const outcome = w.runtime.getRoundOutcome(); assert.equal(outcome.winner.index, 0);
    assert.equal(w.runtime.mapResults[0].reason, 'finish');
    w.kill(2, 0); w.ring(0, 0); assert.equal(w.runtime.getRoundOutcome(), outcome);
    const late = fixture(); late.time(300001); late.finish(late.runtime.foxHunt.foxIndex);
    assert.equal(late.runtime.getRoundOutcome().parcours.result, 'timeout');
});

test('all maps count and total points rather than two early map wins determine the final winner', () => {
    const w = fixture();
    for (let i = 0; i < 3; i++) {
        w.runtime.foxHunt.setFox(i === 2 ? 1 : 0);
        if (i === 2) w.runtime.foxHunt.addScore(1, 3000);
        w.finish(w.runtime.foxHunt.foxIndex); w.runtime.getRoundOutcome();
        if (i < 2) { assert.equal(w.runtime.phase, 'transition'); w.runtime.start(w.manager()); }
    }
    assert.equal(w.runtime.phase, 'finished'); assert.deepEqual(w.runtime.foxHunt.leaders(), [1]);
    assert.equal(w.runtime.getHudState().postRunSummary.maps.length, 3);
    assert.equal(w.runtime.getHudState().postRunSummary.score, 2000);
});

test('strict hunters ignore near wounded bystanders and obsolete target locks', () => {
    const w = fixture(), players = w.runtime.entityManager.players;
    w.runtime.foxHunt.setFox(4); players[4].position.x = 100; players[0].hp = 1; players[0].maxHp = 100;
    players[1].fightTargetPlayerIndex = 0; players[1].fightLastAttackerIndex = 0; players[1].fightTargetLockRemaining = 1;
    const selected = getPreferredFightEnemy(players[1], players, new THREE.Vector3(), 0.016);
    assert.equal(selected.enemy.index, 4); assert.equal(selected.candidateCount, 1);
    assert.equal(resolveOpportunisticEnemy({ profile: { opportunistBias: 1 } }, players[1], players, selected.enemy).index, 4);
});

test('all three routes enforce unlimited three-second respawns without changing free play', () => {
    for (const key of ['neon_carnival', 'kinetic_tide', 'orbital_shipyard']) {
        const map = MAP_PRESETS[key], before = JSON.stringify(map);
        const dedicated = resolveFoxHuntMap(map, key, config);
        assert.ok(dedicated.parcours.gameModes.includes('HUNT'));
        const route = { ...dedicated.parcours, totalCheckpoints: 2, checkpoints: [{ id: 'CP01', pos: [0, 10, 0] }, { id: 'CP02', pos: [20, 10, 0] }],
            entriesByCheckpointIndex: [[{ id: 'CP01', pos: [0, 10, 0] }], [{ id: 'CP02', pos: [20, 10, 0] }]] };
        const state = { nextCheckpointIndex: 2, checkpointRespawnsUsed: 7, stageCheckpointIds: ['CP01', 'CP02'] };
        const effective = resolveModeParcoursRoute({ runtimeConfig: config }, route);
        const result = applyParcoursDeathRespawn(effective, state, { hitboxRadius: 0.8 });
        assert.equal(result.plan.checkpointId, 'CP02'); assert.equal(result.plan.delaySeconds, 3);
        assert.equal(result.plan.restartAtFirstCheckpoint, false); assert.equal(state.nextCheckpointIndex, 2);
        assert.equal(JSON.stringify(map), before);
    }
});

test('real progress system leaves hunter finish open for a later fox role', () => {
    const w = fixture(); w.runtime.foxHunt.setFox(1);
    const em = w.runtime.entityManager;
    em.arena = { currentMapDefinition: { parcours: { enabled: true, gameModes: ['HUNT'], checkpoints: [
        { id: 'CP01', pos: [0, 12, 0], radius: 4 }], finish: { id: 'FINISH', pos: [20, 12, 0], radius: 4 } } },
        currentMapKey: 'fixture', scale: 1 };
    const system = new ParcoursProgressSystem(em);
    system._route = { totalCheckpoints: 1, checkpoints: [], finish: { id: 'FINISH', pos: [20, 12, 0], radius: 4 },
        rules: {}, routeId: 'fixture' };
    const player = em.players[0];
    const state = system._ensurePlayerState(0); state.nextCheckpointIndex = 1; player.position.set(20, 12, 0);
    system._leaderboardCallback = event => w.runtime.handleParcoursEvent(event);
    assert.equal(system.updatePlayerProgress(player, new THREE.Vector3(10, 12, 0), 1000), null);
    assert.equal(state.completed, false);
    w.kill(0); system.updatePlayerProgress(player, new THREE.Vector3(10, 12, 0), 1100);
    assert.equal(state.completed, true); assert.equal(w.runtime.getRoundOutcome().winner.index, 0);
});

test('shared first place grants each human Bronze progression and boards separate human counts', () => {
    const w = fixture(3);
    for (let map = 0; map < 3; map++) {
        w.time(300000); w.runtime.getRoundOutcome();
        if (map < 2) w.runtime.start(w.manager());
    }
    const result = w.runtime.getHudState().postRunSummary;
    assert.deepEqual(w.runtime.foxHunt.leaders(), [0, 1, 2, 3, 4, 5, 6]);
    assert.equal(result.medal, 'bronze');
    assert.ok(result.participants.every(p => p.succeeded && p.medal === 'bronze'));
    assert.equal(w.data.get(HUNT_PARCOURS_MEDAL_RECORD_STORAGE_KEY).variants.fox_hunt.bestMedal, 'bronze');
    const context = { ranked: true, runType: 'hunt_parcours', scoreModel: 'hunt-score.v1', huntParcoursVariantId: 'fox_hunt',
        vehicleLevel: 1, tierId: 'normal' };
    const keys = [1, 2, 3].map(huntParcoursHumanCount => resolveArcadeRankKey({ ...context, huntParcoursHumanCount }));
    assert.equal(new Set(keys).size, 3); assert.ok(keys.every(key => /fox_hunt:humans-[123]:normal:1-5$/.test(key)));
});

test('partner profile, plane and pending XP remain bound across map/profile changes and abort', () => {
    function target() {
        const data = new Map();
        return { data, writable: false, readJsonRecordResult: key => data.has(key) ? { status: 'found', value: structuredClone(data.get(key)) } : { status: 'missing' },
            loadJsonRecord: (key, fallback) => structuredClone(data.get(key) ?? fallback),
            saveJsonRecord(key, value) { if (!this.writable) return false; data.set(key, structuredClone(value)); return true; } };
    }
    const primary = target(), partner = target(), replacement = target();
    primary.writable = true; replacement.writable = true;
    let activeTarget = { store: partner, vehicleId: 'ship2' };
    const r = new HuntParcoursRuntime({ getRecordStore: () => primary, getPlayerRewardTarget: () => activeTarget });
    const m = { players: [{ index: 0, alive: true }, { index: 1, alive: true }], _simulationClockMs: 0, runtimeConfig: config };
    m.humanPlayers = m.players;
    r.start(m, { variantId: 'fox_hunt', vehicleId: 'ship1' });
    assert.equal(r.handleXpEvent('checkpoint', 1).rewardPending, true);
    activeTarget = { store: replacement, vehicleId: 'ship3' };
    r.handleXpEvent('finish', 1);
    assert.equal(replacement.data.has(ARCADE_VEHICLE_PROFILE_STORAGE_KEY), false);
    assert.equal(r.vehicleXpEarned, 0);
    r.dispose(); partner.writable = true;
    r.maintainPendingSettlements(Infinity); r.maintainPendingSettlements(Infinity);
    const saved = partner.data.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY);
    assert.equal(saved.ship2.totalXpEarned, XP_REWARD_TABLE.parcoursCheckpoint + XP_REWARD_TABLE.parcoursFinish);
    assert.equal(saved.ship3, undefined); assert.equal(replacement.data.size, 0);
});

test('P2 victory or a P2/bot shared victory is human-sided without granting P1 unearned success', () => {
    for (const shared of [false, true]) {
        const w = fixture(2);
        for (let map = 0; map < 3; map++) {
            if (map === 0) {
                w.runtime.foxHunt.addScore(1, 100);
                if (shared) w.runtime.foxHunt.addScore(2, 100);
            }
            w.time(300000); w.runtime.getRoundOutcome();
            assert.equal(w.runtime.mapResults[map].winnerSide, 'human');
            if (map < 2) w.runtime.start(w.manager());
        }
        const summary = w.runtime.getHudState().postRunSummary;
        assert.equal(summary.runWinnerSide, 'human');
        assert.equal(summary.participants[1].succeeded, true);
        assert.equal(summary.participants[1].medal, 'bronze');
        assert.equal(summary.participants[0].succeeded, false);
        assert.equal(summary.medal, '');
        assert.equal(w.data.get(HUNT_PARCOURS_MEDAL_RECORD_STORAGE_KEY).variants.fox_hunt.bestMedal, '');
    }
});

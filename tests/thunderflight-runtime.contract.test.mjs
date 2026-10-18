import assert from 'node:assert/strict';
import test from 'node:test';
import { HuntParcoursRuntime } from '../src/core/arcade/HuntParcoursRuntime.js';
import { HUNT_PARCOURS_MEDAL_RECORD_STORAGE_KEY } from '../src/shared/contracts/HuntParcoursMedalRecordContract.js';
import { resolveThunderflightMultiplier, resolveThunderflightMap } from '../src/shared/contracts/ThunderflightContract.js';
import { MAP_PRESETS } from '../src/core/config/MapPresets.js';
import { buildRouteFromParcours } from '../src/entities/systems/ParcoursProgressUtils.js';
import { GameRuntimeHuntParcoursSupport } from '../src/core/runtime/GameRuntimeHuntParcoursSupport.js';
import { listRingsInsideObstacles } from '../scripts/parcours-ring-clearance.mjs';
import { syncHuntParcoursStatus } from '../src/ui/arcade/HuntParcoursHud.js';
import { ParcoursProgressSystem } from '../src/entities/systems/ParcoursProgressSystem.js';
import { completeParcours } from '../src/entities/systems/ParcoursProgressCompletionOps.js';

function fixture(readOverride = null) {
    const data = new Map(), transitions = [], writes = [], strikes = [];
    const store = { readJsonRecordResult: key => readOverride || (data.has(key) ? { status: 'found', value: data.get(key) } : { status: 'missing' }),
        saveJsonRecord(key, value) { writes.push(key); data.set(key, structuredClone(value)); return true; } };
    const runtime = new HuntParcoursRuntime({ getRecordStore: () => store, requestMapTransition: value => transitions.push(value) });
    const makeManager = () => {
        const players = [0, 1, 2, 3, 4].map(index => ({ index, alive: true, isBot: index > 0, position: { y: 10 + index * 10 } }));
        return { players, humanPlayers: [players[0]], arena: { bounds: { minY: 0, maxY: 120 } },
            _lightningStrikeSystem: { activateEnvironment: () => strikes.push('cast'), getWarningState: () => null } };
    };
    runtime.start(makeManager(), { variantId: 'thunderflight', seed: 130909 });
    return { runtime, data, transitions, writes, strikes, makeManager };
}
function ring(w, index, height, checkpointIndex = 0) {
    w.runtime.entityManager.players[index].position.y = height;
    return w.runtime.handleParcoursEvent({ type: 'checkpoint', playerIndex: index, checkpointIndex });
}
function finish(w, index = 1) {
    w.runtime.handleParcoursEvent({ type: 'finish', playerIndex: index, totalTimeMs: 25000 });
    return w.runtime.getRoundOutcome();
}

test('dedicated runs replace the false elimination objective and hide kill-target scores, then restore ordinary Hunt', () => {
    const hud = { runtime: { runtimeConfig: { arcade: { enabled: true, runType: 'hunt_parcours', huntParcoursVariantId: 'thunderflight' } } },
        objective: { textContent: '' }, scoreboard: { hidden: false }, targetProgress: { classList: { toggle: (_name, hidden) => assert.equal(hidden, true) } } };
    assert.equal(syncHuntParcoursStatus(hud), true); assert.equal(hud.scoreboard.hidden, true);
    assert.match(hud.objective.textContent, /Ringpunkte/); assert.doesNotMatch(hud.objective.textContent, /Elimination|Abschüsse/);
    hud.runtime.runtimeConfig.arcade.enabled = false;
    assert.equal(syncHuntParcoursStatus(hud), false); assert.equal(hud.scoreboard.hidden, false);
});

test('height bands use world bounds at both boundaries and handle invalid bounds conservatively', () => {
    const bounds = { minY: 0, maxY: 120 };
    assert.deepEqual([-1, 0, 39.9, 40, 79.9, 80, 121].map(y => resolveThunderflightMultiplier(y, bounds)), [1, 1, 1, 2, 2, 4, 4]);
    assert.equal(resolveThunderflightMultiplier(30, { minY: 10, maxY: 40 }), 4);
    assert.equal(resolveThunderflightMultiplier(NaN, bounds), 1);
    assert.equal(resolveThunderflightMultiplier(10, { minY: 10, maxY: 10 }), 1);
});

test('every run map has a dedicated real route while free combat definitions stay unchanged', () => {
    const config = { arcade: { enabled: true, runType: 'hunt_parcours', huntParcoursVariantId: 'thunderflight' } };
    assert.equal(MAP_PRESETS.spiral_tower.parcours, undefined);
    for (const key of ['sky_islands', 'spiral_tower', 'abyssal_descent']) {
        const original = MAP_PRESETS[key], before = JSON.stringify(original);
        const map = resolveThunderflightMap(original, key, config);
        const route = buildRouteFromParcours(map.parcours, { positionScale: 3 });
        assert.ok(route.routeId && route.totalCheckpoints >= 8 && route.finish, key);
        assert.deepEqual(listRingsInsideObstacles(map, 3), [], `${key}: no ring centre inside an obstacle`);
        assert.ok(map.parcours.gameModes.includes('HUNT'));
        assert.equal(JSON.stringify(original), before);
        assert.equal(resolveThunderflightMap(original, key, { arcade: { ...config.arcade, huntParcoursVariantId: 'nemesis' } }), original);
    }
});

test('ring points count once per ordered checkpoint, remain with their player, and ignore kills', () => {
    const w = fixture(); ring(w, 0, 10); ring(w, 0, 119, 0); ring(w, 0, 119, 2);
    ring(w, 0, 40, 1); ring(w, 0, 80, 2); ring(w, 2, 119);
    assert.deepEqual(w.runtime.getHudState().pointsByPlayer, { 0: 700, 1: 0, 2: 400, 3: 0, 4: 0 });
    w.runtime.handleGameplayEvent({ type: 'kill', playerIndex: 0, victimIndex: 2, count: 99 });
    assert.equal(w.runtime.getHudState().score, 700);
    assert.equal(w.runtime.ringClaims, 3);
    assert.ok(w.runtime.entityManager.players.filter(p => p.isBot).every(p => p.huntParcoursRaceWeight === 1));
    w.runtime.start(w.runtime.entityManager);
    assert.equal(w.runtime.getHudState().score, 700, 'same manager rebind does not erase scoring');
});

test('three real session rebuilds preserve points and finish by total score rather than the finisher', () => {
    const w = fixture();
    for (let map = 0; map < 3; map++) {
        ring(w, 0, 100); ring(w, 1, 10);
        const outcome = finish(w, 1);
        assert.equal(outcome.winner.index, 1, 'ordinary round boundary consumes the live finisher');
        assert.equal(w.runtime.mapResults[map].won, true, 'human has the greater ring score');
        assert.equal(w.runtime.mapResults[map].pointsByPlayer[0], 400);
        assert.equal(w.runtime.getRoundOutcome(), outcome, 'same event settles once');
        if (map < 2) { assert.equal(w.runtime.phase, 'transition'); w.runtime.start(w.makeManager()); }
    }
    assert.equal(w.runtime.phase, 'finished'); assert.equal(w.transitions.length, 2);
    const summary = w.runtime.getHudState().postRunSummary;
    assert.equal(summary.score, 1200); assert.equal(summary.runWinnerSide, 'human');
    assert.equal(summary.maps.length, 3);
    assert.equal(w.data.get(HUNT_PARCOURS_MEDAL_RECORD_STORAGE_KEY).variants.thunderflight.plays, 1);
    assert.equal(w.writes.filter(key => key === HUNT_PARCOURS_MEDAL_RECORD_STORAGE_KEY).length, 1);
    assert.ok(!w.writes.some(key => key.includes('rival')));
});

test('a draw stays a draw and the match winner follows points rather than finish position', () => {
    const w = fixture(); let winsNeeded;
    const baseController = { deriveOnRoundEndPlan(_players, inputs) { winsNeeded = inputs.winsNeeded; return { outcome: { state: 'ROUND_END' } }; },
        deriveRoundEndTransition: outcome => ({ state: outcome.state }) };
    ring(w, 0, 100); ring(w, 1, 100); finish(w);
    assert.equal(w.runtime.mapResults[0].winnerSide, 'draw');
    const players = w.runtime.entityManager.players;
    assert.equal(w.runtime.deriveRoundEndPlan({ players, inputs: { winner: players[1] }, baseController }).outcome.state, 'ROUND_END');
    assert.equal(winsNeeded, 4, 'never terminate this three-map run after two round wins');
    w.runtime.phase = 'finished';
    const plan = w.runtime.deriveRoundEndPlan({ players, inputs: { winner: players[1] }, baseController });
    assert.equal(plan.outcome.matchWinner, null); assert.match(plan.outcome.messageText, /unentschieden/);
});

test('a finisher killed later in the same simulation tick still closes the map exactly once', () => {
    const w = fixture(); ring(w, 0, 100);
    w.runtime.handleParcoursEvent({ type: 'finish', playerIndex: 1, totalTimeMs: 25000 });
    w.runtime.entityManager.players[1].alive = false;
    const outcome = w.runtime.getRoundOutcome();
    assert.equal(outcome.shouldEnd, true); assert.equal(outcome.winner.index, 1);
    assert.equal(w.runtime.mapResults[0].won, true); assert.equal(w.transitions.length, 1);
    assert.equal(w.runtime.getRoundOutcome(), outcome);
});

test('weather ticks once after a delayed frame, does not run during transitions, and restarts per map', () => {
    const w = fixture(); w.runtime.update(11.9); assert.equal(w.strikes.length, 0);
    w.runtime.update(0.1); assert.equal(w.strikes.length, 1);
    w.runtime.update(60); assert.equal(w.strikes.length, 2);
    finish(w); w.runtime.update(60); assert.equal(w.strikes.length, 2);
    w.runtime.start(w.makeManager()); w.runtime.update(12); assert.equal(w.strikes.length, 3);
    w.runtime.dispose(); w.runtime.update(99); assert.equal(w.strikes.length, 3);
});

for (const read of [{ status: 'unavailable' }, { status: 'read_failed' }, { status: 'found', value: { version: 999 } }]) {
    test(`weather-run results do not overwrite unreadable or future profile data: ${read.status}/${read.value?.version || ''}`, () => {
        const w = fixture(read);
        for (let map = 0; map < 3; map++) { finish(w); if (map < 2) w.runtime.start(w.makeManager()); }
        assert.deepEqual(w.writes, []);
    });
}

test('session-scoped callbacks ignore retired managers and support startup without a Nemesis rival', () => {
    const config = { arcade: { enabled: true, runType: 'hunt_parcours', huntParcoursVariantId: 'thunderflight' } };
    const w = fixture(), state = { runtimeConfig: config, entityManager: w.runtime.entityManager };
    const support = { getRuntimeState: () => state, _bindGameplayCallback() {} };
    const hunt = new GameRuntimeHuntParcoursSupport(support);
    hunt.runtime = w.runtime;
    const old = hunt.createParcoursCallbacks(state.entityManager);
    state.entityManager = w.makeManager(); w.runtime.entityManager = state.entityManager;
    old.leaderboard({ type: 'checkpoint', playerIndex: 0, checkpointIndex: 0 });
    assert.equal(w.runtime.getHudState().score, 0);
    assert.equal(hunt.prepare(config).botCount, 4);
});

test('real parcours callbacks award human checkpoint and finish XP while bots only publish race progress', () => {
    const w = fixture(), m = w.runtime.entityManager, xp = [], events = [];
    m.activeGameMode = 'ARCADE'; m.entityRuntimeConfig = { ARENA: { MAP_SCALE: 1 } };
    m.arena.currentMapDefinition = resolveThunderflightMap(MAP_PRESETS.spiral_tower, 'spiral_tower',
        { arcade: { enabled: true, runType: 'hunt_parcours', huntParcoursVariantId: 'thunderflight' } });
    for (const bot of m.players.filter(p => p.isBot)) {
        bot.isArcadeParcoursCompetitor = true; bot.isHuntParcoursCompetitor = true;
    }
    const system = new ParcoursProgressSystem(m, { nowProvider: () => 1000 });
    system.setXpEventCallback((type, index) => { xp.push({ type, index }); return null; });
    system.setLeaderboardCallback(event => events.push(event)); system.startRound(m.players);
    for (const player of [m.players[0], m.players[1]]) {
        const state = system._playerStates.get(player.index);
        system._acceptCheckpoint(player, state, system._route.checkpoints[0], 1000);
        completeParcours(system, player, state, 2000);
    }
    assert.deepEqual(xp, [{ type: 'checkpoint', index: 0 }, { type: 'finish', index: 0 }]);
    assert.deepEqual(events.filter(e => e.type === 'checkpoint').map(e => e.playerIndex), [0, 1]);
    assert.deepEqual(events.filter(e => e.type === 'finish').map(e => e.playerIndex), [0, 1]);
});

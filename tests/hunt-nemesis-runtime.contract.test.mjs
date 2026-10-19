import assert from 'node:assert/strict';
import test from 'node:test';
import { HuntParcoursRuntime } from '../src/core/arcade/HuntParcoursRuntime.js';
import { HUNT_PARCOURS_RIVAL_STORAGE_KEY } from '../src/shared/contracts/HuntParcoursRivalContract.js';
import { HUNT_PARCOURS_MEDAL_RECORD_STORAGE_KEY } from '../src/shared/contracts/HuntParcoursMedalRecordContract.js';

function fixture(readOverride = null, saveResult = true) {
    const records = new Map(), writes = [], transitions = [];
    const store = {
        readJsonRecordResult(key) {
            return readOverride || (records.has(key) ? { status: 'found', value: structuredClone(records.get(key)) } : { status: 'missing' });
        },
        saveJsonRecord(key, value) { writes.push(key); if (saveResult === true) records.set(key, structuredClone(value)); return saveResult; },
    };
    const human = { index: 0, isBot: false, alive: true };
    const rival = { index: 1, isBot: true, alive: true, maxHp: 100, hp: 100, baseSpeed: 20, speed: 20, turnSpeed: 2 };
    const manager = { humanPlayers: [human], players: [human, rival] };
    const runtime = new HuntParcoursRuntime({ getRecordStore: () => store, requestMapTransition: transition => transitions.push(transition),
        requestAdvance() { assert.fail('the ordinary round-end lifecycle advances maps'); } });
    runtime.start(manager, { variantId: 'nemesis', seed: 130101 });
    return { runtime, manager, human, rival, records, store, writes, transitions };
}

function kills(world, side = 'human') {
    const humanWins = side === 'human';
    for (let i = 0; i < 3; i += 1) world.runtime.handleGameplayEvent({
        type: humanWins ? 'kill' : 'bot_kill', playerIndex: humanWins ? 0 : 1, victimIndex: humanWins ? 1 : 0, count: 1,
    });
    return world.runtime.getRoundOutcome();
}

test('only implemented variants start; an unavailable variant is never silently Nemesis', () => {
    for (const id of ['trail_scent', 'grand_loop', 'unknown']) {
        assert.throws(() => new HuntParcoursRuntime().start(null, { variantId: id }), /not implemented/);
    }
});

test('a named rival receives its profile modifiers once, including rebinds', () => {
    const world = fixture();
    assert.ok(world.rival.botDisplayName);
    assert.equal(world.rival.maxHp, 160);
    world.runtime.start(world.manager);
    assert.equal(world.rival.maxHp, 160);
});

test('uncredited kills, companions, self kills and unrelated victims never reach the target', () => {
    const world = fixture();
    for (const event of [
        { type: 'kill', playerIndex: 0, victimIndex: 1, count: 0 },
        { type: 'kill', playerIndex: 0, victimIndex: 0, count: 3 },
        { type: 'kill', playerIndex: 0, victimIndex: 1, count: 3, companion: true },
        { type: 'kill', playerIndex: 0, victimIndex: 9, count: 3 },
        { type: 'bot_kill', playerIndex: 1, victimIndex: 0, count: 0 },
        { type: 'bot_kill', playerIndex: 1, victimIndex: 9, count: 3 },
    ]) world.runtime.handleGameplayEvent(event);
    assert.equal(world.runtime.getRoundOutcome(), null);
    assert.equal(world.runtime.humanKills, 0);
    assert.equal(world.runtime.rivalKills, 0);
});

test('three credited kills queue exactly one transition and preserve real elapsed time', () => {
    const world = fixture(); world.runtime.update(12.5);
    const outcome = kills(world);
    assert.equal(outcome.winner, world.human);
    assert.equal(world.runtime.getRoundOutcome(), outcome);
    assert.equal(world.transitions.length, 1);
    assert.equal(world.transitions[0].mapKey, 'glass_serpent');
    assert.equal(world.runtime.mapResults[0].totalTimeMs, 12500);
    assert.equal(world.runtime.phase, 'transition');
    assert.deepEqual(world.writes, []);
});

for (const side of ['human', 'rival']) test(`best-of-three closes after two ${side} map wins and settles once`, () => {
    const world = fixture();
    kills(world, side);
    world.runtime.start(world.manager);
    const outcome = kills(world, side);
    assert.equal(outcome.winner, world[side]);
    assert.equal(world.runtime.phase, 'finished');
    assert.equal(world.transitions.length, 1);
    assert.equal(world.runtime.mapResults.length, 2);
    assert.equal(world.records.get(HUNT_PARCOURS_MEDAL_RECORD_STORAGE_KEY).variants.nemesis.plays, 1);
    assert.equal(world.records.get(HUNT_PARCOURS_RIVAL_STORAGE_KEY).stage, side === 'human' ? 1 : 0);
    assert.equal(world.records.get(HUNT_PARCOURS_RIVAL_STORAGE_KEY).rivalWins, side === 'rival' ? 1 : 0);
    world.runtime.getRoundOutcome();
    assert.equal(world.writes.length, 2);
});

test('one win each reaches wind cathedral and keeps the first terminal event in a tick', () => {
    const world = fixture();
    kills(world);world.runtime.start(world.manager);kills(world, 'rival');world.runtime.start(world.manager);
    assert.equal(world.runtime.getHudState().currentMapKey, 'wind_cathedral');
    world.runtime.handleParcoursEvent({ type: 'finish', playerIndex: 1, totalTimeMs: 12000 });
    kills(world);
    assert.equal(world.runtime.getRoundOutcome().winner, world.rival);
    assert.equal(world.runtime.getHudState().mapWins.rival, 2);
    assert.equal(world.runtime.mapResults[2].reason, 'finish');
});

test('the first human finish wins over later rival kills in the same tick', () => {
    const world = fixture();
    world.runtime.handleParcoursEvent({ type: 'finish', playerIndex: 0, totalTimeMs: 22000 });
    kills(world, 'rival');
    assert.equal(world.runtime.getRoundOutcome().winner, world.human);
    assert.equal(world.runtime.mapResults[0].reason, 'finish');
    assert.equal(world.runtime.mapResults[0].totalTimeMs, 22000);
});

for (const read of [{ status: 'read_failed' }, { status: 'unavailable' }, { status: 'found', value: { version: 999, future: true } }]) {
    test(`profile records stay untouched on ${read.status}/${read.value?.version || ''}`, () => {
        const world = fixture(read);kills(world);world.runtime.start(world.manager);kills(world);
        assert.deepEqual(world.writes, []);
        assert.equal(world.runtime.getHudState().phase, 'finished');
    });
}

test('save failures are explicit and no record is retried as another played run', () => {
    const world = fixture(null, null);kills(world);world.runtime.start(world.manager);kills(world);
    assert.equal(world.runtime.getHudState().postRunSummary.saveFailures.length, 2);
    world.runtime.getRoundOutcome();
    assert.equal(world.writes.length, 2);
});

test('aborting resets run context without settling profile records', () => {
    const world = fixture();kills(world);world.runtime.rankContext = { ranked: true };
    world.runtime.dispose();
    assert.equal(world.runtime.phase, 'idle');assert.equal(world.runtime.rankContext, null);
    assert.deepEqual(world.writes, []);
});

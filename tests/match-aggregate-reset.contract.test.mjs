import assert from 'node:assert/strict';
import test from 'node:test';

import { RoundRecorder } from '../src/state/RoundRecorder.js';
import { wireMatchSessionRuntime } from '../src/state/MatchSessionFactory.js';
import { buildPostMatchStatsSummary } from '../src/state/PostMatchStatsAggregator.js';

function createRendererStub() {
    return {
        cameras: [],
        createCamera() {},
    };
}

function createPlayers() {
    return [
        { index: 0, isBot: false, score: 0 },
        { index: 1, isBot: true, score: 0 },
    ];
}

function readRoundsRow(recorder, players) {
    const summary = buildPostMatchStatsSummary({
        recorder,
        players,
        outcome: { state: 'ROUND_END', requiredWins: 5 },
    });
    const matchBlock = summary?.blocks?.find((block) => block.id === 'match') || null;
    return matchBlock?.rows?.find((row) => row.key === 'rounds')?.value ?? null;
}

// Ein Match: Session verdrahten (Matchstart), eine Runde spielen und beenden.
function playOneRoundInFreshMatch(recorder, renderer) {
    const players = createPlayers();
    wireMatchSessionRuntime({
        renderer,
        entityManager: { players, recorder },
        numHumans: 1,
    });
    recorder.startRound(players);
    recorder.finalizeRound(players[1], players, { reason: 'ELIMINATION' });
    return players;
}

test('a new match restarts the aggregate round counter', () => {
    const recorder = new RoundRecorder();
    const renderer = createRendererStub();

    const firstMatchPlayers = playOneRoundInFreshMatch(recorder, renderer);
    assert.equal(readRoundsRow(recorder, firstMatchPlayers), '1');

    const secondMatchPlayers = playOneRoundInFreshMatch(recorder, renderer);
    assert.equal(readRoundsRow(recorder, secondMatchPlayers), '1');
});

test('a new match also restarts the values derived from the round count', () => {
    const recorder = new RoundRecorder();
    const renderer = createRendererStub();

    playOneRoundInFreshMatch(recorder, renderer);
    playOneRoundInFreshMatch(recorder, renderer);

    const aggregate = recorder.getAggregateMetrics();
    assert.equal(aggregate.rounds, 1);
    assert.equal(aggregate.botWinRate, 1);
});

test('rounds inside the same match keep accumulating', () => {
    const recorder = new RoundRecorder();
    const renderer = createRendererStub();
    const players = createPlayers();

    wireMatchSessionRuntime({
        renderer,
        entityManager: { players, recorder },
        numHumans: 1,
    });
    for (let round = 0; round < 3; round += 1) {
        recorder.startRound(players);
        recorder.finalizeRound(players[1], players, { reason: 'ELIMINATION' });
    }

    assert.equal(recorder.getAggregateMetrics().rounds, 3);
});

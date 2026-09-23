import assert from 'node:assert/strict';
import test from 'node:test';

import { buildStandingsBlock } from '../src/ui/postmatch/PostMatchStandingsBlock.js';
import { buildMatchDetailBlock, buildRoundDetailBlock } from '../src/ui/postmatch/PostMatchDetailBlocks.js';

const players = [
    { index: 0, isBot: false, score: 3, entitySlotActive: true },
    { index: 1, isBot: true, score: 2, entitySlotActive: true },
];

test('match point belongs only to an unfinished series', () => {
    const active = buildStandingsBlock({ players, outcome: { state: 'ROUND_END', requiredWins: 3 } });
    assert.equal(active.entries[1].isMatchPoint, true);

    const finished = buildStandingsBlock({ players, outcome: { state: 'MATCH_END', requiredWins: 3 } });
    assert.equal(finished.entries[1].isMatchPoint, false);
});

test('classic post-match standings give tied players the same competition rank', () => {
    const block = buildStandingsBlock({
        players: [
            { index: 2, isBot: true, score: 1, entitySlotActive: true },
            { index: 0, isBot: false, score: 3, entitySlotActive: true },
            { index: 1, isBot: false, score: 3, entitySlotActive: true },
            { index: 3, isBot: true, score: 0, entitySlotActive: true },
        ],
        outcome: { state: 'ROUND_END', requiredWins: 5 },
    });

    assert.deepEqual(block.entries.map((entry) => entry.playerIndex), [0, 1, 2, 3]);
    assert.deepEqual(block.entries.map((entry) => entry.rank), [1, 1, 3, 4]);
});

test('post-match details use player-readable totals instead of tuning metrics', () => {
    const round = buildRoundDetailBlock({
        duration: 42,
        itemPickupTypeCounts: { SHIELD: 2, ROCKET: 1 },
        selfCollisions: 1,
        botSurvivalAverage: 12,
        stuckPerMinute: 3,
    });
    assert.deepEqual(round.rows.map((row) => row.key), ['duration', 'item-pickups', 'self-collisions']);
    assert.deepEqual(round.rows.map((row) => row.value), [42, 3, 1]);

    const match = buildMatchDetailBlock({
        rounds: 2,
        totalDuration: 90,
        itemPickupTypeTotals: { SHIELD: 3, ROCKET: 2 },
        totalSelfCollisions: 4,
        botWinRate: 0.5,
        bounceWallPerRound: 6,
    }, { state: 'MATCH_END' }, [{ kills: 2 }, { kills: 3 }]);
    assert.deepEqual(match.rows.map((row) => row.key), ['rounds', 'duration', 'item-pickups', 'self-collisions', 'kills']);
    assert.deepEqual(match.rows.map((row) => row.value), [2, 90, 5, 4, 5]);
});

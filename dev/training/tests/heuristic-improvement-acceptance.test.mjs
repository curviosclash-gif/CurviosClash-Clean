import assert from 'node:assert/strict';
import test from 'node:test';

import { judgeCandidate } from '../scripts/heuristic-improvement-acceptance.mjs';

// One benchmark match per seed/slot pair, as evaluateVariant records it.
function match(seed, slot, lifeSeconds, kills) {
    return { seed, slot, candidateLifeSeconds: lifeSeconds, candidateLives: 1, candidateKills: kills };
}

function evaluation(matches) {
    const lifeSeconds = matches.reduce((sum, row) => sum + row.candidateLifeSeconds, 0);
    const lives = matches.reduce((sum, row) => sum + row.candidateLives, 0);
    const kills = matches.reduce((sum, row) => sum + row.candidateKills, 0) / matches.length;
    const survival = lifeSeconds / lives;
    // Comparison bots fixed at 10 s and 1 kill, so the ratios follow the candidate.
    return {
        candidateSurvival: survival,
        candidateKills: kills,
        survivalRatio: survival / 10,
        killRatio: kills,
        matches,
    };
}

const CURRENT = evaluation([
    match(3, 0, 10, 1), match(3, 1, 10, 1), match(7, 0, 10, 1), match(7, 1, 10, 1),
]);

test('a candidate that is only slightly better on average stays out', () => {
    const slightly = evaluation(CURRENT.matches.map((row) => ({
        ...row, candidateLifeSeconds: row.candidateLifeSeconds * 1.01, candidateKills: row.candidateKills * 1.01,
    })));
    assert.equal(judgeCandidate(slightly, CURRENT).accepted, false);
});

test('a clear gain in every match is accepted', () => {
    const clear = evaluation(CURRENT.matches.map((row) => ({
        ...row, candidateLifeSeconds: row.candidateLifeSeconds * 1.2, candidateKills: row.candidateKills * 1.2,
    })));
    const verdict = judgeCandidate(clear, CURRENT);
    assert.equal(verdict.accepted, true);
    assert.deepEqual(verdict.failed, []);
    assert.deepEqual(verdict.pairs.survival, { better: 4, equal: 0, worse: 0 });
});

test('one lucky match cannot carry a candidate that is worse in most matches', () => {
    const lucky = evaluation([
        match(3, 0, 60, 6), match(3, 1, 9, 0.9), match(7, 0, 9, 0.9), match(7, 1, 9, 0.9),
    ]);
    assert.ok(lucky.candidateSurvival > CURRENT.candidateSurvival * 1.05);
    assert.ok(lucky.candidateKills > CURRENT.candidateKills * 1.05);
    const verdict = judgeCandidate(lucky, CURRENT);
    assert.equal(verdict.accepted, false);
    assert.deepEqual(verdict.failed, ['survival-pairs', 'kill-pairs']);
});

test('ties count as not worse, so a candidate that changes only some matches can win', () => {
    const partial = evaluation([
        match(3, 0, 14, 2), match(3, 1, 10, 1), match(7, 0, 12, 1.5), match(7, 1, 10, 1),
    ]);
    assert.equal(judgeCandidate(partial, CURRENT).accepted, true);
});

test('from zero kills any kill is a gain, but zero stays zero', () => {
    const noKills = evaluation(CURRENT.matches.map((row) => ({ ...row, candidateKills: 0 })));
    const stillNoKills = evaluation(noKills.matches.map((row) => ({ ...row, candidateLifeSeconds: 20 })));
    assert.equal(judgeCandidate(stillNoKills, noKills).accepted, false);
});

test('paired comparison refuses results from different seeds or slots', () => {
    const shifted = evaluation(CURRENT.matches.map((row) => ({ ...row, seed: row.seed + 1 })));
    assert.throws(() => judgeCandidate(shifted, CURRENT), /pair/);
});

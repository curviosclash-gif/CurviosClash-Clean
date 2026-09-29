import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFIG_BASE } from '../../../src/core/Config.js';
import { createRuntimeConfigSnapshot } from '../../../src/core/RuntimeConfig.js';
import { HEURISTIC_PROFILES } from '../../../src/entities/ai/HeuristicBotPolicyOps.js';
import { HEURISTIC_IMPROVEMENT_BASELINE, resolveHeuristicBenchmarkSetup } from '../scripts/heuristic-improvement-baseline.mjs';
import {
    clampProfile, createBenchmarkFightSettings, resolveOpponentFields, runMatch,
} from '../scripts/heuristic-improvement-match.mjs';
import { createTeamSettings } from '../scripts/team-objective-improvement-loop.mjs';

const GAME_RULES = Object.freeze({
    fightPlayerHp: CONFIG_BASE.HUNT.PLAYER_MAX_HP,
    fightMgDamage: CONFIG_BASE.HUNT.MG.DAMAGE,
    mgTrailAimRadius: CONFIG_BASE.HUNT.MG.TRAIL_HIT_RADIUS,
});

function combatOf(settings) {
    const { fightPlayerHp, fightMgDamage, mgTrailAimRadius } = createRuntimeConfigSnapshot(settings).huntCombat;
    return { fightPlayerHp, fightMgDamage, mgTrailAimRadius };
}

test('heuristic benchmark fights with the hit points and gun the game ships with', () => {
    const settings = createBenchmarkFightSettings('balanced', true, 7, { difficulty: 'NORMAL', mapKey: 'standard' });
    assert.deepEqual(combatOf(settings), GAME_RULES);
});

test('team objective benchmark fights with the hit points and gun the game ships with', () => {
    assert.deepEqual(combatOf(createTeamSettings('FLAGS', 7331, 'NORMAL')), GAME_RULES);
});

test('product opponents play the shipped profile, baseline opponents the frozen one', () => {
    assert.deepEqual(resolveOpponentFields('defensive', 'product'), clampProfile('defensive', HEURISTIC_PROFILES.defensive));
    assert.deepEqual(resolveOpponentFields('defensive', 'baseline'), clampProfile('defensive', HEURISTIC_IMPROVEMENT_BASELINE.defensive));
    assert.notDeepEqual(resolveOpponentFields('defensive', 'product'), resolveOpponentFields('defensive', 'baseline'));
    assert.equal(resolveOpponentFields('defensive', 'hunt'), null);
    assert.throws(() => resolveOpponentFields('defensive', 'rule-based'), /opponent/);
});

async function shortMatch(opponent) {
    return runMatch({
        profile: 'balanced',
        seed: 17,
        setup: resolveHeuristicBenchmarkSetup(1),
        candidateFields: HEURISTIC_PROFILES.balanced,
        candidateSlot: 1,
        maxTicks: 90,
        opponent,
    });
}

test('against the standard Hunt bot only the candidate slot runs the heuristic policy', async () => {
    const result = await shortMatch('hunt');
    assert.equal(result.opponent, 'hunt');
    // The menu default "Auto" resolves to the Hunt bridge policy in 3D, as in the game.
    assert.deepEqual(result.policyTypes, ['hunt-3d', 'heuristic', 'hunt-3d', 'hunt-3d']);
});

test('against product or baseline profiles every slot runs the heuristic policy', async () => {
    for (const opponent of ['product', 'baseline']) {
        const result = await shortMatch(opponent);
        assert.equal(result.opponent, opponent);
        assert.deepEqual(result.policyTypes, ['heuristic', 'heuristic', 'heuristic', 'heuristic']);
    }
});

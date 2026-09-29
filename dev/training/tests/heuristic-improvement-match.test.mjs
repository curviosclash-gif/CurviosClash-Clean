import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFIG_BASE } from '../../../src/core/Config.js';
import { createRuntimeConfigSnapshot } from '../../../src/core/RuntimeConfig.js';
import { createBenchmarkFightSettings } from '../scripts/heuristic-improvement-match.mjs';
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

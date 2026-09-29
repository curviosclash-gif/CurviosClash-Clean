import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { HEURISTIC_PROFILES } from '../../../src/entities/ai/HeuristicBotPolicyOps.js';
import { HEURISTIC_SEARCH_STATE_VERSION } from '../scripts/heuristic-improvement-acceptance.mjs';
import { formatHeuristicSearchStatus } from '../scripts/heuristic-improvement-status.mjs';
import { TUNABLE_FIELDS } from '../scripts/heuristic-improvement-match.mjs';

function sampleState() {
    return {
        version: HEURISTIC_SEARCH_STATE_VERSION,
        profileCursor: 1,
        fieldCursorByProfile: { defensive: 3, balanced: 2, aggressive: 2 },
        stepIndex: 1,
        plateauRounds: 1,
        profiles: {
            defensive: { ...HEURISTIC_PROFILES.defensive, attackWindow: 0.64 },
            balanced: { ...HEURISTIC_PROFILES.balanced },
            aggressive: { ...HEURISTIC_PROFILES.aggressive },
        },
        verifiedRatios: {
            defensive: { survival: 1.21, kills: 1.08, damage: 1.12, candidateDamage: 410, baselineDamage: 366 },
        },
        history: [
            { at: '2026-09-29T10:00:00.000Z', profile: 'defensive', field: 'attackWindow', value: 0.64, decision: 'accept' },
            { at: '2026-09-29T10:20:00.000Z', profile: 'balanced', field: 'opportunistBias', value: 0.5, decision: 'inert-skip' },
        ],
    };
}

test('status names the state file, the next step and the plateau count', () => {
    const text = formatHeuristicSearchStatus(sampleState(), { statePath: 'C:/tmp/state.json' });
    assert.match(text, /state: C:\/tmp\/state\.json \(version 21, current\)/);
    assert.match(text, new RegExp(`next: balanced ${TUNABLE_FIELDS[2]} \\(field 3/${TUNABLE_FIELDS.length}\\), step 10 %`));
    assert.match(text, /plateau rounds: 1\/3/);
});

test('status lists the last decisions and every field that differs from the shipped profile', () => {
    const text = formatHeuristicSearchStatus(sampleState(), { statePath: 'x' });
    assert.match(text, /2026-09-29T10:00:00\.000Z defensive attackWindow=0\.6400 accept/);
    assert.match(text, /2026-09-29T10:20:00\.000Z balanced opportunistBias=0\.5000 inert-skip/);
    assert.match(text, /defensive: attackWindow 0\.58 -> 0\.64/);
    assert.match(text, /balanced: same as product/);
    assert.match(text, /defensive: survival 1\.210 kills 1\.080 damage 1\.120/);
    assert.match(text, /balanced: not verified yet/);
});

test('status warns when the state file belongs to another search version', () => {
    const text = formatHeuristicSearchStatus({ ...sampleState(), version: 3 }, { statePath: 'x' });
    assert.match(text, /version 3, current is 21: the next iteration starts from scratch/);
});

test('bot:improve:status reports a missing state file instead of failing', () => {
    const statePath = path.join(os.tmpdir(), `heuristic-status-missing-${process.pid}.json`);
    const child = spawnSync(process.execPath, [
        fileURLToPath(new URL('../scripts/heuristic-improvement-loop.mjs', import.meta.url)), '--status',
    ], { env: { ...process.env, HEURISTIC_LOOP_STATE_PATH: statePath }, encoding: 'utf8', timeout: 30000 });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /no search state at .*heuristic-status-missing/);
});

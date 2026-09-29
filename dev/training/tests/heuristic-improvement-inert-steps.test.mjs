import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
    HEURISTIC_SEARCH_STATE_VERSION, isInertTacticStep, TACTIC_STRENGTH_FIELDS, TACTIC_SWITCH_FIELDS,
} from '../scripts/heuristic-improvement-acceptance.mjs';
import { HEURISTIC_IMPROVEMENT_BASELINE } from '../scripts/heuristic-improvement-baseline.mjs';
import { TUNABLE_FIELDS } from '../scripts/heuristic-improvement-match.mjs';

test('tactic steps that stay at or below the neutral 0.5 change nothing', () => {
    for (const field of [...TACTIC_STRENGTH_FIELDS, ...TACTIC_SWITCH_FIELDS]) {
        assert.equal(isInertTacticStep(field, 0.5, 0.4), true, field);
        assert.equal(isInertTacticStep(field, 0.45, 0.5), true, field);
        assert.equal(isInertTacticStep(field, 0.5, 0.6), false, field);
        assert.equal(isInertTacticStep(field, 0.6, 0.48), false, field);
    }
});

test('switch tactics only matter when a step crosses 0.5, strength tactics keep scaling above it', () => {
    for (const field of TACTIC_SWITCH_FIELDS) assert.equal(isInertTacticStep(field, 0.6, 0.72), true, field);
    for (const field of TACTIC_STRENGTH_FIELDS) assert.equal(isInertTacticStep(field, 0.6, 0.72), false, field);
});

test('continuous fields are never skipped', () => {
    for (const field of ['predictiveSafetyBias', 'attackWindow', 'safetyDistance']) {
        assert.equal(isInertTacticStep(field, 0.4, 0.3), false, field);
    }
});

// The skip is only safe while the bot reads these fields the way the lists above assume.
test('product bot code reads switch tactics as on/off at 0.5 and strength tactics above 0.5', () => {
    const aiDirectory = fileURLToPath(new URL('../../../src/entities/ai/', import.meta.url));
    const sources = fs.readdirSync(aiDirectory)
        .filter((name) => name.endsWith('.js') && name !== 'HeuristicBotPolicyOps.js')
        .map((name) => fs.readFileSync(path.join(aiDirectory, name), 'utf8'))
        .join('\n');
    for (const source of sources.match(/const NEUTRAL_TACTIC_BIAS = [^;]+;/g) || []) {
        assert.equal(source, 'const NEUTRAL_TACTIC_BIAS = 0.5;');
    }
    assert.match(sources, /return clamp\(\(Number\(value\) - NEUTRAL_TACTIC_BIAS\) \* 2, 0, 1\);/);
    for (const field of TACTIC_SWITCH_FIELDS) {
        const reads = sources.match(new RegExp(`[^\\n]*\\b${field}\\b[^\\n]*`, 'g')) || [];
        assert.ok(reads.length > 0, `${field} is read nowhere`);
        for (const read of reads) {
            assert.match(read, new RegExp(`${field}\\) (>|<=) NEUTRAL_TACTIC_BIAS`), `${field}: ${read.trim()}`);
        }
    }
    for (const field of TACTIC_STRENGTH_FIELDS) {
        const reads = sources.match(new RegExp(`[^\\n]*\\b${field}\\b[^\\n]*`, 'g')) || [];
        assert.ok(reads.length > 0, `${field} is read nowhere`);
        for (const read of reads) {
            assert.match(read, new RegExp(`resolveTacticStrength\\(policy\\.profile\\.${field}\\)`), `${field}: ${read.trim()}`);
        }
    }
});

test('an iteration whose every step is inert plays no match and moves on', () => {
    const statePath = path.join(os.tmpdir(), `heuristic-inert-${process.pid}.json`);
    const field = 'openingHookBias';
    const profiles = Object.fromEntries(['defensive', 'balanced', 'aggressive']
        .map((name) => [name, { ...HEURISTIC_IMPROVEMENT_BASELINE[name] }]));
    profiles.defensive[field] = 0.9;
    fs.writeFileSync(statePath, JSON.stringify({
        version: HEURISTIC_SEARCH_STATE_VERSION,
        profileCursor: 0,
        fieldCursorByProfile: { defensive: TUNABLE_FIELDS.indexOf(field), balanced: 0, aggressive: 0 },
        stepIndex: 0,
        profiles,
    }));
    try {
        const child = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/heuristic-improvement-loop.mjs', import.meta.url))], {
            env: { ...process.env, HEURISTIC_LOOP_STATE_PATH: statePath, HEURISTIC_LOOP_WORKERS: '1' },
            encoding: 'utf8',
            timeout: 60000,
        });
        assert.equal(child.status, 0, child.stderr);
        assert.match(child.stdout, /profile=defensive candidate=openingHookBias:0\.9000 decision=inert-skip/);
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        assert.equal(state.fieldCursorByProfile.defensive, TUNABLE_FIELDS.indexOf(field) + 1);
        assert.equal(state.profileCursor, 1);
    } finally {
        fs.rmSync(statePath, { force: true });
    }
});

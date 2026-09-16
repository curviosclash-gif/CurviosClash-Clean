import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const sourceUrl = new URL('../scripts/heuristic-improvement-loop.mjs', import.meta.url);
const source = fs.readFileSync(sourceUrl, 'utf8');

test('heuristic improvement loop reuses the booted headless match lifecycle', () => {
    const entityManagerIndex = source.indexOf('const em = runtime.session.entityManager;');
    const botReadIndex = source.indexOf('const bots = em.bots || [];', entityManagerIndex);

    assert.ok(entityManagerIndex >= 0);
    assert.ok(botReadIndex > entityManagerIndex);
    assert.doesNotMatch(source, /em\.spawnAll\?\.\(\)/);
});

test('heuristic improvement loop records candidate and baseline death causes and trail-death share', () => {
    assert.match(source, /em\.onPlayerDied = \(deadPlayer, rawCause\) =>/);
    assert.match(source, /candidateDeathCauses/);
    assert.match(source, /baselineDeathCauses/);
    assert.match(source, /candidateTrailDeathShare: trailDeathShare\(candidateDeathCauses\)/);
    assert.match(source, /TRAIL_SELF/);
    assert.match(source, /TRAIL_OTHER/);
});

test('heuristic coordinate ascent evaluates the accumulated candidate profile', () => {
    assert.match(source, /const fields = perturb\(current, field, direction\);/);
    assert.match(source, /state\.profiles\[profile\] = selected\.fields;/);
});

test('heuristic candidate injection preserves the complete named profile', () => {
    assert.match(source, /const result = \{ \.\.\.baseProfile \};/);
    assert.match(source, /clampProfile\(profile, candidateFields\)/);
    assert.match(source, /clampScalar\(field, source\[field\], baseProfile\[field\]\)/);
    assert.match(source, /bot\.ai\.profile = baselineFields/);
    assert.match(source, /benchmark profile injection lost/);
});

test('heuristic improvement state keeps raw values behind survival and kill ratios', () => {
    assert.match(source, /candidateSurvival: result\.candidateSurvival/);
    assert.match(source, /baselineSurvival: result\.baselineSurvival/);
    assert.match(source, /candidateKills: result\.candidateKills/);
    assert.match(source, /baselineKills: result\.baselineKills/);
    assert.match(source, /candidateDeathCauses: result\.candidateDeathCauses/);
    assert.match(source, /baselineDeathCauses: result\.baselineDeathCauses/);
    assert.match(source, /state\.verifiedRatios\[profile\] = toRatioRecord\(reported\)/);
    assert.match(source, /command === '--verify'/);
    assert.match(source, /command === '--probe-coarse' \|\| command === '--probe-full' \|\| command === '--try-full' \|\| command === '--probe-short'/);
});

test('heuristic improvement loop separates coarse training from rotated holdout validation', () => {
    assert.match(source, /TRAINING_SEEDS = Object\.freeze\(\[2, 5, 13, 29\]\)/);
    assert.match(source, /HOLDOUT_SEEDS = Object\.freeze\(\[3, 7, 11, 17, 23, 31, 41, 53, 67, 79, 97, 113\]\)/);
    assert.match(source, /coarseSlots = \[\.\.\.new Set\(\[0, Math\.max\(0, NUM_BOTS - 1\)\]\)\]/);
    assert.match(source, /fullSlots = Array\.from\(\{ length: NUM_BOTS \}/);
    assert.match(source, /isStrictlyBetterOnBoth\(fullCandidate, fullCurrent\)/);
    assert.match(source, /candidate\.survivalRatio > current\.survivalRatio \+ MIN_CONFIRMED_GAIN/);
    assert.match(source, /candidate\.killRatio > current\.killRatio \+ MIN_CONFIRMED_GAIN/);
    assert.match(source, /state\.holdoutCache\[profile\]\?\.key === currentCacheKey/);
    assert.match(source, /holdoutCacheKey\(current, HOLDOUT_SEEDS, fullSlots, FULL_MAX_TICKS\)/);
    assert.match(source, /JSON\.stringify\(\[BENCHMARK_FINGERPRINT, fields, seeds, slots, maxTicks\]\)/);
    assert.match(source, /respawnEnabled: false/);
    assert.match(source, /MIN_ELIMINATION_SURVIVAL_RETENTION/);
    assert.match(source, /createHeuristicLifeTracker\(\)/);
    assert.match(source, /FINAL_SEEDS = Object\.freeze\(\[293, 307, 317, 331, 347, 359, 373, 389, 401, 419, 433, 449\]\)/);
    assert.match(source, /CONFIRMATION_SEEDS = Object\.freeze\(\[457, 461, 479, 487, 499, 503, 521, 541, 557, 569, 587, 601\]\)/);
    assert.match(source, /verifyCurrentProfiles\(CONFIRMATION_SEEDS, false\)/);
    assert.match(source, /verifyCurrentProfiles\(CONFIRMATION_SEEDS, false, true\)/);
    assert.match(source, /verifyCurrentProfiles\(FINAL_SEEDS, false, true\)/);
    assert.match(source, /product \? HEURISTIC_PROFILES\[profile\] : state\.profiles\[profile\]/);
    assert.match(source, /if \(!persist\) return;/);
    assert.match(source, /em\.matchSeed !== seed/);
    assert.match(source, /human\.entitySlotActive = false/);
    assert.match(source, /human\.kill\(\)/);
    assert.match(source, /benchmark match ended early/);
});

test('heuristic improvement loop keeps state outside the repository and emits no report', () => {
    assert.match(source, /path\.join\(os\.tmpdir\(\), 'curviosclash-heuristic-improvement-state\.json'\)/);
    assert.doesNotMatch(source, /reports[\\/]|buildReport|report-/);
});

test('match replay is stable for one seed and changes for another seed', () => {
    const replay = (seed, command = '--replay') => {
        const child = spawnSync(process.execPath, [fileURLToPath(sourceUrl), command, 'defensive', String(seed), '0'], {
            env: {
                ...process.env,
                HEURISTIC_LOOP_COARSE_MAX_TICKS: '180',
                HEURISTIC_LOOP_STATE_PATH: path.join(os.tmpdir(), `heuristic-replay-test-${process.pid}.json`),
            },
            encoding: 'utf8',
            timeout: 15000,
        });
        assert.equal(child.status, 0, child.stderr);
        return JSON.parse(child.stdout.trim());
    };
    const first = replay(127);
    assert.deepEqual(replay(127), first);
    assert(first.actionTrace.updates > 0);
    assert.equal(
        Object.values(first.actionTrace.safetyStates).reduce((sum, count) => sum + count, 0),
        first.actionTrace.updates
    );
    assert.equal(
        Object.values(first.actionTrace.modes).reduce((sum, count) => sum + count, 0),
        first.actionTrace.updates
    );
    assert.equal(
        Object.values(first.actionTrace.turnChoices).reduce((sum, count) => sum + count, 0),
        first.actionTrace.updates
    );
    assert(Array.isArray(first.actionTrace.deaths));
    assert(first.actionTrace.deaths.every((death) => typeof death.candidateKill === 'boolean'));
    assert(first.actionTrace.recentSafety.length <= 8);
    assert(first.actionTrace.deaths.every((death) => death.victim !== 'candidate'
        || (Array.isArray(death.recentSafety) && death.recentSafety.length <= 8)));
    assert(first.actionTrace.mgShots <= first.actionTrace.updates);
    const other = replay(139);
    assert.deepEqual(replay(127, '--replay-product'), replay(127, '--replay-product'));
    assert.equal(first.matchSeed, 127);
    assert.equal(other.matchSeed, 139);
    assert.notEqual(first.endPositionSignature, other.endPositionSignature);
});

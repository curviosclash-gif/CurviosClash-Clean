import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

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
    assert.match(source, /const result = \{ \.\.\.baseProfile, \.\.\.source \};/);
    assert.match(source, /clampProfile\(profile, candidateFields\)/);
    assert.match(source, /clampScalar\(field, source\[field\], baseProfile\[field\]\)/);
});

test('heuristic improvement state keeps raw values behind survival and kill ratios', () => {
    assert.match(source, /candidateSurvival: reported\.candidateSurvival/);
    assert.match(source, /baselineSurvival: reported\.baselineSurvival/);
    assert.match(source, /candidateKills: reported\.candidateKills/);
    assert.match(source, /baselineKills: reported\.baselineKills/);
    assert.match(source, /candidateDeathCauses: reported\.candidateDeathCauses/);
    assert.match(source, /baselineDeathCauses: reported\.baselineDeathCauses/);
});

test('heuristic improvement loop separates coarse training from rotated holdout validation', () => {
    assert.match(source, /TRAINING_SEEDS = Object\.freeze\(\[2, 5, 13, 29\]\)/);
    assert.match(source, /HOLDOUT_SEEDS = Object\.freeze\(\[3, 7, 11, 17, 23, 31, 41, 53, 67, 79, 97, 113\]\)/);
    assert.match(source, /coarseSlots = \[\.\.\.new Set\(\[0, Math\.max\(0, NUM_BOTS - 1\)\]\)\]/);
    assert.match(source, /fullSlots = Array\.from\(\{ length: NUM_BOTS \}/);
    assert.match(source, /isStrictlyBetterOnBoth\(fullCandidate, fullCurrent\)/);
});

test('heuristic improvement loop keeps state outside the repository and emits no report', () => {
    assert.match(source, /path\.join\(os\.tmpdir\(\), 'curviosclash-heuristic-improvement-state\.json'\)/);
    assert.doesNotMatch(source, /reports[\\/]|buildReport|report-/);
});

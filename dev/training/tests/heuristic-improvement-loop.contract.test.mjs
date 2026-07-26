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

test('heuristic improvement loop records bot death causes and trail-death share', () => {
    assert.match(source, /em\.onPlayerDied = \(deadPlayer, rawCause\) =>/);
    assert.match(source, /botDeathCauseCounts\[cause\]/);
    assert.match(source, /trailDeathShare: trailDeathShare\(botDeathCauseCounts\)/);
    assert.match(source, /TRAIL_SELF/);
    assert.match(source, /TRAIL_OTHER/);
});

test('heuristic coordinate ascent evaluates the accumulated candidate profile', () => {
    assert.match(source, /const candidateFields = \{ \.\.\.current, \[field\]: cand\.value \};/);
});
